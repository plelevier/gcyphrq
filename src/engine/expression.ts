import { evaluateArithmeticCore } from '../arithmetic';
import type { CypherEdge, CypherNode, CypherValue, Expression, GraphConfig, QueryContext, WhereExpression } from '../types/cypher';

/**
 * Normalize a value for list operations. Strings are treated as lists of characters.
 * Returns null if the value cannot be treated as a list.
 */
export function asList(value: CypherValue): CypherValue[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [...value];
  return null;
}

/** Evaluate an expression against a context. */
export function evaluateExpression(
  expr: Expression,
  context: QueryContext,
  config: GraphConfig,
  evalFunc: (name: string, args: CypherValue[]) => CypherValue,
  evalWhere?: (w: WhereExpression, ctx: QueryContext) => boolean,
  evalPatternComprehension?: (expr: Extract<Expression, { type: 'PatternComprehension' }>, ctx: QueryContext) => CypherValue,
): CypherValue | undefined {
  if (expr.type === 'PropertyAccess') {
    const obj = context[expr.variable];
    if (obj === undefined) return undefined;
    if (obj === null) return null;
    if (expr.property) return (obj as Record<string, unknown>)[expr.property] as CypherValue | undefined;
    return obj as CypherValue;
  }
  if (expr.type === 'Literal') return expr.value;
  if (expr.type === 'ListLiteral') {
    const values: CypherValue[] = [];
    for (const le of expr.values) { const val = evaluateExpression(le, context, config, evalFunc, evalWhere, evalPatternComprehension); values.push(val as CypherValue); }
    return values as CypherValue;
  }
  if (expr.type === 'MapLiteral') {
    const values: Record<string, CypherValue> = {};
    for (const entry of expr.entries) { const val = evaluateExpression(entry.value, context, config, evalFunc, evalWhere, evalPatternComprehension); values[entry.key] = val as CypherValue; }
    return values as CypherValue;
  }
  if (expr.type === 'Aggregation') return undefined;
  if (expr.type === 'FunctionCall') {
    const args = expr.arguments.map((a) => evaluateExpression(a, context, config, evalFunc, evalWhere, evalPatternComprehension));
    return evalFunc(expr.functionName, args);
  }
  if (expr.type === 'ListSlice') {
    const listRaw = evaluateExpression(expr.list, context, config, evalFunc, evalWhere, evalPatternComprehension);
    const wasString = typeof listRaw === 'string';
    const list = asList(listRaw);
    if (!list) return null;
    const startVal = evaluateExpression(expr.start, context, config, evalFunc, evalWhere, evalPatternComprehension);
    const endVal = evaluateExpression(expr.end, context, config, evalFunc, evalWhere, evalPatternComprehension);
    if (expr.start === expr.end) {
      const idx = startVal != null ? Number(startVal) : 0;
      const adjIdx = idx < 0 ? list.length + idx : idx;
      if (adjIdx < 0 || adjIdx >= list.length) return null;
      return list[adjIdx] as CypherValue;
    }
    const start = startVal != null ? Number(startVal) : 0;
    const end = endVal != null ? Number(endVal) : list.length;
    const adjStart = start < 0 ? Math.max(0, list.length + start) : start;
    const adjEnd = end < 0 ? list.length + end : Math.min(end, list.length);
    const sliced = list.slice(adjStart, adjEnd);
    if (wasString) return sliced.join('') as CypherValue;
    return sliced as unknown as CypherValue;
  }
  if (expr.type === 'Arithmetic') {
    return evaluateArithmeticCore(expr, (e) => evaluateExpression(e, context, config, evalFunc, evalWhere, evalPatternComprehension));
  }
  if (expr.type === 'Case') {
    return evaluateCase(expr, context, config, evalFunc, evalWhere, evalPatternComprehension);
  }
  if (expr.type === 'Path') return undefined; // handled separately
  if (expr.type === 'Exists') {
    const value = evaluateExpression(expr.expression, context, config, evalFunc, evalWhere, evalPatternComprehension);
    return value !== null && value !== undefined;
  }
  if (expr.type === 'ListComprehension') {
    return evaluateListComprehension(expr, context, config, evalFunc, evalWhere, evalPatternComprehension);
  }
  if (expr.type === 'PatternComprehension') {
    // Pattern comprehensions require graph access — delegated via callback
    if (evalPatternComprehension) return evalPatternComprehension(expr, context);
    return undefined;
  }
  if (expr.type === 'Reduce') {
    return evaluateReduce(expr, context, config, evalFunc, evalWhere, evalPatternComprehension);
  }
  if (expr.type === 'Quantifier') {
    if (!evalWhere) return undefined;
    return evaluateQuantifier(expr, context, config, evalFunc, evalWhere, evalPatternComprehension);
  }
  return undefined;
}

/** Evaluate a list comprehension: `[var IN list [WHERE predicate] | generator]`. */
function evaluateListComprehension(
  expr: Extract<Expression, { type: 'ListComprehension' }>,
  context: QueryContext,
  config: GraphConfig,
  evalFunc: (name: string, args: CypherValue[]) => CypherValue,
  evalWhere?: (w: WhereExpression, ctx: QueryContext) => boolean,
  evalPatternComprehension?: (expr: Extract<Expression, { type: 'PatternComprehension' }>, ctx: QueryContext) => CypherValue,
): CypherValue {
  const listRaw = evaluateExpression(expr.list, context, config, evalFunc, evalWhere, evalPatternComprehension);
  const list = asList(listRaw);
  if (!list) return [] as CypherValue;

  const result: CypherValue[] = [];
  for (const element of list) {
    const loopContext: QueryContext = { ...context, [expr.loopVariable]: element };

    // If there's a WHERE predicate, skip elements that don't match
    if (expr.predicate) {
      if (!evalWhere) return [] as CypherValue;
      const predicateResult = evalWhere(expr.predicate, loopContext);
      if (!predicateResult) continue;
    }

    const genValue = evaluateExpression(expr.generator, loopContext, config, evalFunc, evalWhere, evalPatternComprehension);
    result.push(genValue as CypherValue);
  }

  return result as CypherValue;
}

/** Evaluate a reduce expression. */
function evaluateReduce(
  expr: Extract<Expression, { type: 'Reduce' }>,
  context: QueryContext,
  config: GraphConfig,
  evalFunc: (name: string, args: CypherValue[]) => CypherValue,
  evalWhere?: (w: WhereExpression, ctx: QueryContext) => boolean,
  evalPatternComprehension?: (expr: Extract<Expression, { type: 'PatternComprehension' }>, ctx: QueryContext) => CypherValue,
): CypherValue {
  const evalExpr = (e: Expression, ctx?: QueryContext) => evaluateExpression(e, ctx ?? context, config, evalFunc, evalWhere, evalPatternComprehension);

  let accumulator = evalExpr(expr.initial);
  if (accumulator === null || accumulator === undefined) return null;

  const listRaw = evalExpr(expr.list);
  const list = asList(listRaw);
  if (!list) return accumulator;

  for (const element of list) {
    const loopContext: QueryContext = { ...context, [expr.accumulator]: accumulator, [expr.loopVariable]: element };
    const bodyValue = evaluateExpression(expr.body, loopContext, config, evalFunc, evalWhere, evalPatternComprehension);
    if (bodyValue === null || bodyValue === undefined) {
      accumulator = null;
      break;
    }
    accumulator = bodyValue;
  }

  return accumulator;
}

/** Evaluate a quantifier expression: ALL/ANY/SINGLE/NONE(x IN list WHERE predicate). */
function evaluateQuantifier(
  expr: Extract<Expression, { type: 'Quantifier' }>,
  context: QueryContext,
  config: GraphConfig,
  evalFunc: (name: string, args: CypherValue[]) => CypherValue,
  evalWhere: (w: WhereExpression, ctx: QueryContext) => boolean,
  evalPatternComprehension?: (expr: Extract<Expression, { type: 'PatternComprehension' }>, ctx: QueryContext) => CypherValue,
): boolean {
  const listRaw = evaluateExpression(expr.list, context, config, evalFunc, evalWhere, evalPatternComprehension);
  const list = asList(listRaw);
  if (!list) return false;

  // Empty list semantics:
  // ALL: true (vacuous truth)
  // ANY: false
  // SINGLE: false
  // NONE: true (vacuous truth)
  if (list.length === 0) {
    return expr.quantifierType === 'ALL' || expr.quantifierType === 'NONE';
  }

  let matchCount = 0;
  for (const element of list) {
    const loopContext: QueryContext = { ...context, [expr.loopVariable]: element };
    const predicateResult = evalWhere(expr.predicate, loopContext);
    if (predicateResult) {
      matchCount++;
      // Early exit for ANY (found at least one match)
      if (expr.quantifierType === 'ANY') return true;
      // Early exit for ALL (found a non-matching element)
    } else if (expr.quantifierType === 'ALL') {
      return false;
    }
  }

  switch (expr.quantifierType) {
    case 'ALL': return true; // All elements matched
    case 'ANY': return false; // No element matched
    case 'SINGLE': return matchCount === 1;
    case 'NONE': return matchCount === 0;
    default: return false;
  }
}

/** Evaluate a CASE expression. */
export function evaluateCase(expr: Extract<Expression, { type: 'Case' }>, context: QueryContext, config: GraphConfig, evalFunc: (name: string, args: CypherValue[]) => CypherValue, evalWhere?: (w: WhereExpression, ctx: QueryContext) => boolean, evalPatternComprehension?: (expr: Extract<Expression, { type: 'PatternComprehension' }>, ctx: QueryContext) => CypherValue): CypherValue {
  const evalExpr = (e: Expression) => evaluateExpression(e, context, config, evalFunc, evalWhere, evalPatternComprehension);

  if (expr.subject !== undefined) {
    const subjectVal = evalExpr(expr.subject);
    for (const branch of expr.branches) {
      const whenVal = evalExpr(branch.condition as Expression);
      if (subjectVal === whenVal) return evalExpr(branch.result) ?? null;
    }
  } else {
    for (const branch of expr.branches) {
      const cond = branch.condition;
      let condResult: boolean;
      if (cond.type === 'Literal' && typeof cond.value === 'boolean') { condResult = cond.value; }
      else if (cond.type === 'BinaryExpression' || cond.type === 'LogicalExpression' || cond.type === 'NotExpression' || cond.type === 'IsNull') {
        if (evalWhere) { condResult = evalWhere(cond as WhereExpression, context); }
        else { condResult = false; }
      } else { condResult = false; }
      if (condResult) return evalExpr(branch.result) ?? null;
    }
  }
  if (expr.elseResult) return evalExpr(expr.elseResult) ?? null;
  return null;
}

// ── Temporal helper types ──────────────────────────────────────────────

/** Internal representation of a temporal value. */
interface TemporalParts {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
  millisecond?: number;
  /** Timezone offset string (e.g., 'Z', '+02:00', '-05:00') or null. */
  timezone?: string | null;
}

/** Parse a timezone offset from a string. Returns 'Z', '+HH:MM', '-HH:MM', or null. */
function parseTimezoneOffset(str: string): string | null {
  if (str.endsWith('Z')) return 'Z';
  const tzMatch = str.match(/[+-](\d{2}):?(\d{2})$/);
  if (tzMatch) {
    const [, h, m] = tzMatch;
    const idx = str.lastIndexOf(h!);
    const sign = str[idx - 1];
    return `${sign}${h!}:${m!}`;
  }
  return null;
}

/** Convert timezone offset string to total minutes. */
function timezoneOffsetToMinutes(tz: string | null | undefined): number {
  if (!tz || tz === 'Z') return 0;
  const m = tz.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10));
}

/** Parse a temporal string (ISO 8601 datetime/date/time) into components. */
function parseTemporalValue(input: CypherValue): TemporalParts | null {
  if (input == null) return null;
  const str = typeof input === 'string' ? input : String(input);

  // Try parsing as a full datetime (ISO 8601 with T separator)
  // Allow optional timezone suffix (Z, +HH:MM, -HH:MM, +HHMM, -HHMM)
  const dateTimeMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (dateTimeMatch) {
    const [, year, month, day, hour, minute, second, ms] = dateTimeMatch;
    const timezone = parseTimezoneOffset(str);
    return {
      year: parseInt(year!, 10),
      month: parseInt(month!, 10),
      day: parseInt(day!, 10),
      hour: parseInt(hour!, 10),
      minute: parseInt(minute!, 10),
      second: parseInt(second!, 10),
      millisecond: ms ? Math.round(parseFloat(`0.${ms}`) * 1000) : 0,
      timezone,
    };
  }

  // Try parsing as a date only (YYYY-MM-DD)
  const dateMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    return {
      year: parseInt(year!, 10),
      month: parseInt(month!, 10),
      day: parseInt(day!, 10),
      timezone: null,
    };
  }

  // Try parsing as a time only (HH:MM:SS or HH:MM:SS.mmm)
  // Allow optional timezone offset for time values
  const timeMatch = str.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (timeMatch) {
    const [, hour, minute, second, ms] = timeMatch;
    const timezone = parseTimezoneOffset(str);
    return {
      hour: parseInt(hour!, 10),
      minute: parseInt(minute!, 10),
      second: parseInt(second!, 10),
      millisecond: ms ? Math.round(parseFloat(`0.${ms}`) * 1000) : 0,
      timezone,
    };
  }

  // Try parsing as a number (epoch seconds or milliseconds)
  if (typeof input === 'number') {
    const d = new Date(input > 1e12 ? input : input * 1000);
    if (!isNaN(d.getTime())) {
      return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        second: d.getUTCSeconds(),
        millisecond: d.getUTCMilliseconds(),
        timezone: 'Z',
      };
    }
  }

  return null;
}

/** Format a Date as the appropriate temporal string based on kind. */
function formatTemporalFromDate(
  kind: string,
  d: Date,
  useLocalTime: boolean = false,
  explicitTimezone?: string,
): CypherValue {
  const formatTimePart = (date: Date, local: boolean): string => {
    const h = local ? String(date.getHours()).padStart(2, '0') : String(date.getUTCHours()).padStart(2, '0');
    const m = local ? String(date.getMinutes()).padStart(2, '0') : String(date.getUTCMinutes()).padStart(2, '0');
    const s = local ? String(date.getSeconds()).padStart(2, '0') : String(date.getUTCSeconds()).padStart(2, '0');
    const ms = local ? date.getMilliseconds() : date.getUTCMilliseconds();
    return ms > 0 ? `${h}:${m}:${s}.${String(ms).padStart(3, '0')}` : `${h}:${m}:${s}`;
  };

  const formatDatePart = (date: Date, local: boolean): string => {
    const y = local ? date.getFullYear() : date.getUTCFullYear();
    const mo = String(local ? date.getMonth() + 1 : date.getUTCMonth() + 1).padStart(2, '0');
    const dy = String(local ? date.getDate() : date.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${dy}`;
  };

  switch (kind) {
    case 'datetime':
      return d.toISOString();
    case 'date':
      return d.toISOString().slice(0, 10);
    case 'time':
      return formatTimePart(d, false);
    case 'localdatetime':
      return `${formatDatePart(d, true)}T${formatTimePart(d, true)}`;
    case 'localtime':
      return formatTimePart(d, true);
    case 'datetimewithtimezone': {
      const tz = explicitTimezone ?? 'Z';
      return `${d.toISOString().slice(0, 23)}${tz}`;
    }
    case 'timewithzone': {
      const tz = explicitTimezone ?? 'Z';
      return `${formatTimePart(d, false)}${tz}`;
    }
    default:
      return null;
  }
}

/** Format local time components directly (no Date conversion). */
function formatLocalTime(hour: number, minute: number, second: number, millisecond: number): string {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  const s = String(second).padStart(2, '0');
  return millisecond > 0 ? `${h}:${m}:${s}.${String(millisecond).padStart(3, '0')}` : `${h}:${m}:${s}`;
}

/** Format local datetime components directly (no Date conversion). */
function formatLocalDateTime(year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number): string {
  const y = String(year).padStart(4, '0');
  const mo = String(month).padStart(2, '0');
  const dy = String(day).padStart(2, '0');
  const h = String(hour).padStart(2, '0');
  const mi = String(minute).padStart(2, '0');
  const s = String(second).padStart(2, '0');
  return millisecond > 0
    ? `${y}-${mo}-${dy}T${h}:${mi}:${s}.${String(millisecond).padStart(3, '0')}`
    : `${y}-${mo}-${dy}T${h}:${mi}:${s}`;
}

/** Build a temporal value from arguments (components or map). */
function buildTemporal(
  kind: 'datetime' | 'date' | 'time' | 'localdatetime' | 'localtime' | 'datetimewithtimezone' | 'timewithzone',
  args: CypherValue[],
  useLocalTime: boolean = false,
): CypherValue {
  if (args.length === 0) return null;

  const firstArg = args[0];

  // Number-based construction: datetime(1672531200) from epoch seconds/milliseconds
  // Only when there's exactly one numeric argument (multi-arg = component-based)
  if (args.length === 1 && typeof firstArg === 'number') {
    const isMillis = firstArg > 1e12;
    const d = new Date(isMillis ? firstArg : firstArg * 1000);
    if (isNaN(d.getTime())) return null;
    return formatTemporalFromDate(kind, d, useLocalTime);
  }

  // Map-based construction: datetime({year: 2023, month: 1, day: 1})
  if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
    const map = firstArg as Record<string, unknown>;
    const year = (map.year as number) ?? 1970;
    const month = (map.month as number) ?? 1;
    const day = (map.day as number) ?? 1;
    const hour = (map.hour as number) ?? 0;
    const minute = (map.minute as number) ?? 0;
    const second = (map.second as number) ?? 0;
    const millisecond = (map.millisecond as number) ?? 0;
    const timezone = map.timezone as string | undefined;

    // For localdatetime/localtime, components are local time — format directly
    if (kind === 'localdatetime') {
      return formatLocalDateTime(year, month, day, hour, minute, second, millisecond);
    }
    if (kind === 'localtime') {
      return formatLocalTime(hour, minute, second, millisecond);
    }

    const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
    if (isNaN(d.getTime())) return null;
    return formatTemporalFromDate(kind, d, useLocalTime, timezone);
  }

  // String-based construction: datetime('2023-01-01') or time('14:30:45')
  if (typeof firstArg === 'string') {
    // For time/localtime, check if it's a time-only string first
    if (kind === 'time' || kind === 'localtime' || kind === 'timewithzone') {
      const timeMatch = firstArg.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
      if (timeMatch) {
        const [, h, m, s, ms] = timeMatch;
        const hour = parseInt(h!, 10);
        const minute = parseInt(m!, 10);
        const second = parseInt(s!, 10);
        const millisecond = ms ? Math.round(parseFloat(`0.${ms}`) * 1000) : 0;
        // For timewithzone, preserve timezone from input string
        const tz = parseTimezoneOffset(firstArg);
        if (kind === 'timewithzone') {
          return `${formatLocalTime(hour, minute, second, millisecond)}${tz ?? 'Z'}`;
        }
        if (kind === 'localtime') {
          return formatLocalTime(hour, minute, second, millisecond);
        }
        const d = new Date(Date.UTC(1970, 0, 1, hour, minute, second, millisecond));
        if (isNaN(d.getTime())) return null;
        return formatTemporalFromDate(kind, d, useLocalTime);
      }
    }

    // For datetimewithtimezone, parse components directly from string to preserve local time
    if (kind === 'datetimewithtimezone') {
      const dateTimeMatch = firstArg.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
      if (dateTimeMatch) {
        const [, y, mo, d, h, m, s, ms] = dateTimeMatch;
        const year = parseInt(y!, 10);
        const month = parseInt(mo!, 10);
        const day = parseInt(d!, 10);
        const hour = parseInt(h!, 10);
        const minute = parseInt(m!, 10);
        const second = parseInt(s!, 10);
        const millisecond = ms ? Math.round(parseFloat(`0.${ms}`) * 1000) : 0;
        const tz = parseTimezoneOffset(firstArg);
        return `${formatLocalDateTime(year, month, day, hour, minute, second, millisecond)}${tz ?? 'Z'}`;
      }
    }

    const d = new Date(firstArg);
    if (isNaN(d.getTime())) return null;
    // Preserve timezone from input string for withtimezone variants
    const tz = parseTimezoneOffset(firstArg);
    return formatTemporalFromDate(kind, d, useLocalTime, tz ?? undefined);
  }

  // Component-based construction
  const nums = args.map((a) => (a != null ? Number(a) : 0));

  // time() and localtime() use (hour, minute, second, millisecond) not (year, month, day, ...)
  if (kind === 'time' || kind === 'localtime' || kind === 'timewithzone') {
    const hour = nums[0] ?? 0;
    const minute = nums[1] ?? 0;
    const second = nums[2] ?? 0;
    const millisecond = nums[3] ?? 0;
    // For localtime, components are already local time — format directly
    if (kind === 'localtime') {
      return formatLocalTime(hour, minute, second, millisecond);
    }
    const d = new Date(Date.UTC(1970, 0, 1, hour, minute, second, millisecond));
    if (isNaN(d.getTime())) return null;
    return formatTemporalFromDate(kind, d, useLocalTime);
  }

  const year = nums[0] ?? 1970;
  const month = nums[1] ?? 1;
  const day = nums[2] ?? 1;
  const hour = nums[3] ?? 0;
  const minute = nums[4] ?? 0;
  const second = nums[5] ?? 0;
  const millisecond = nums[6] ?? 0;

  // For localdatetime, components are already local time — format directly
  if (kind === 'localdatetime') {
    return formatLocalDateTime(year, month, day, hour, minute, second, millisecond);
  }

  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (isNaN(d.getTime())) return null;

  return formatTemporalFromDate(kind, d, useLocalTime);
}

// ── Duration helpers ───────────────────────────────────────────────────

/** Parsed ISO 8601 duration components. */
interface DurationParts {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

/** Parse an ISO 8601 duration string (e.g., 'P1Y2M3DT4H5M6S'). */
function parseDurationString(iso: string): DurationParts | null {
  const match = iso.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!match || iso === 'P' || iso === 'PT') return null;
  const [, y, mo, d, h, mi, s] = match;
  return {
    years: parseInt(y!, 10) || 0,
    months: parseInt(mo!, 10) || 0,
    days: parseInt(d!, 10) || 0,
    hours: parseInt(h!, 10) || 0,
    minutes: parseInt(mi!, 10) || 0,
    seconds: s ? Math.floor(parseFloat(s)) : 0,
    milliseconds: s ? Math.round((parseFloat(s) - Math.floor(parseFloat(s))) * 1000) : 0,
  };
}

/** Build a duration string from a map argument. */
function buildDuration(args: CypherValue[]): CypherValue {
  if (args.length === 0) return null;
  const firstArg = args[0];

  // Map-based: duration({years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6, milliseconds: 7})
  if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
    const map = firstArg as Record<string, number>;
    const years = map.years ?? 0;
    const months = map.months ?? 0;
    const days = map.days ?? 0;
    const hours = map.hours ?? 0;
    const minutes = map.minutes ?? 0;
    const seconds = map.seconds ?? 0;
    const milliseconds = map.milliseconds ?? 0;

    let iso = 'P';
    if (years) iso += `${years}Y`;
    if (months) iso += `${months}M`;
    if (days) iso += `${days}D`;

    let hasTime = hours || minutes || seconds || milliseconds;
    if (hasTime) iso += 'T';
    if (hours) iso += `${hours}H`;
    if (minutes) iso += `${minutes}M`;
    if (seconds || milliseconds) {
      const totalSec = seconds + milliseconds / 1000;
      iso += `${totalSec % 1 === 0 ? totalSec : totalSec.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}S`;
    }

    return iso === 'P' || iso === 'PT' ? 'P0D' : iso;
  }

  // String-based: duration('P1Y2M3DT4H5M6S') — validate
  if (typeof firstArg === 'string') {
    const parsed = parseDurationString(firstArg);
    if (!parsed) return null;
    return firstArg;
  }

  return null;
}

/** Extract a component from a duration string. */
function extractDurationComponent(component: string, input: CypherValue): CypherValue {
  if (input == null) return null;
  const str = typeof input === 'string' ? input : String(input);
  const parts = parseDurationString(str);
  if (!parts) return null;

  switch (component) {
    case 'years': return parts.years;
    case 'months': return parts.months;
    case 'days': return parts.days;
    case 'hours': return parts.hours;
    case 'minutes': return parts.minutes;
    case 'seconds': return parts.seconds;
    case 'milliseconds': return parts.milliseconds;
    case 'totalseconds':
      return parts.hours * 3600 + parts.minutes * 60 + parts.seconds + parts.milliseconds / 1000;
    case 'totalminutes':
      return parts.hours * 60 + parts.minutes + (parts.seconds + parts.milliseconds / 1000) / 60;
    default: return null;
  }
}

/** Extract a component from a temporal value. */
function extractTemporalComponent(component: string, input: CypherValue): CypherValue {
  if (input == null) return null;

  // If input is a number, treat as epoch seconds or milliseconds
  if (typeof input === 'number') {
    const isMillis = input > 1e12;
    if (component === 'epochseconds') return isMillis ? Math.floor(input / 1000) : Math.floor(input);
    if (component === 'epochmillisecond') return isMillis ? Math.floor(input) : Math.floor(input * 1000);
    const d = new Date(isMillis ? input : input * 1000);
    if (isNaN(d.getTime())) return null;
    return getComponentFromDate(d, component);
  }

  // If input is a string, parse it
  const parts = parseTemporalValue(input);
  if (!parts) return null;

  switch (component) {
    case 'year': return parts.year ?? null;
    case 'month': return parts.month ?? null;
    case 'day': return parts.day ?? null;
    case 'hour': return parts.hour ?? null;
    case 'minute': return parts.minute ?? null;
    case 'second': return parts.second ?? null;
    case 'millisecond': return parts.millisecond ?? null;
    case 'timezone': {
      // Return the parsed timezone from parts, or parse from original string
      if (parts.timezone !== undefined) return parts.timezone;
      const str = typeof input === 'string' ? input : String(input);
      return parseTimezoneOffset(str);
    }
    case 'epochseconds': {
      const d = buildDateFromParts(parts);
      return d ? Math.floor(d.getTime() / 1000) : null;
    }
    case 'epochmillisecond': {
      const d = buildDateFromParts(parts);
      return d ? d.getTime() : null;
    }
    default: return null;
  }
}

/** Get a component from a Date object. */
function getComponentFromDate(d: Date, component: string): CypherValue {
  switch (component) {
    case 'year': return d.getUTCFullYear();
    case 'month': return d.getUTCMonth() + 1;
    case 'day': return d.getUTCDate();
    case 'hour': return d.getUTCHours();
    case 'minute': return d.getUTCMinutes();
    case 'second': return d.getUTCSeconds();
    case 'millisecond': return d.getUTCMilliseconds();
    case 'timezone': return 'Z';
    case 'epochseconds': return Math.floor(d.getTime() / 1000);
    case 'epochmillisecond': return d.getTime();
    default: return null;
  }
}

/** Build a Date from temporal parts. */
function buildDateFromParts(parts: TemporalParts): Date | null {
  const year = parts.year ?? 1970;
  const month = parts.month ?? 1;
  const day = parts.day ?? 1;
  const hour = parts.hour ?? 0;
  const minute = parts.minute ?? 0;
  const second = parts.second ?? 0;
  const millisecond = parts.millisecond ?? 0;
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Check if a value is a recognized temporal string (datetime, date, or time).
 */
function isTemporalString(value: CypherValue): boolean {
  if (typeof value !== 'string') return false;
  // ISO datetime: 2023-06-15T14:30:45.000Z or 2023-06-15T14:30:45+02:00
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return true;
  // ISO date: 2023-06-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  // ISO time: 14:30:45 or 14:30:45.123
  if (/^\d{2}:\d{2}:\d{2}/.test(value)) return true;
  return false;
}

/**
 * Compare two temporal values chronologically. Returns -1, 0, or 1.
 * Converts both to epoch milliseconds for accurate comparison.
 */
function compareTemporalValues(a: CypherValue, b: CypherValue): number | null {
  const aEpoch = temporalToEpochMillis(a);
  const bEpoch = temporalToEpochMillis(b);
  if (aEpoch === null || bEpoch === null) return null;
  return aEpoch < bEpoch ? -1 : aEpoch > bEpoch ? 1 : 0;
}

/**
 * Convert a temporal value to epoch milliseconds for comparison.
 */
function temporalToEpochMillis(value: CypherValue): number | null {
  if (typeof value === 'number') {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value !== 'string') return null;
  const parts = parseTemporalValue(value);
  if (!parts) return null;
  const d = buildDateFromParts(parts);
  if (!d) return null;
  // Adjust for timezone offset if present
  const tzMinutes = timezoneOffsetToMinutes(parts.timezone);
  return d.getTime() - tzMinutes * 60 * 1000;
}

/** Evaluate a scalar function. */
export function evaluateStringFunction(name: string, args: CypherValue[], config: GraphConfig): CypherValue {
  switch (name) {
    case 'tolower': { const val = args[0]; return val == null ? null : String(val).toLowerCase(); }
    case 'toupper': { const val = args[0]; return val == null ? null : String(val).toUpperCase(); }
    case 'substring': {
      const val = args[0]; if (val == null) return null;
      const str = String(val); const start = args[1] != null ? Number(args[1]) : 0; const end = args[2] != null ? Number(args[2]) : str.length;
      return str.substring(start, end);
    }
    case 'split': { const val = args[0]; const delimiter = args[1]; if (val == null || delimiter == null) return null; return String(val).split(String(delimiter)); }
    case 'repl': {
      const val = args[0]; const search = args[1]; const replacement = args[2];
      if (val == null || search == null) return null;
      return String(val).split(String(search)).join(String(replacement ?? ''));
    }
    case 'trim': { const val = args[0]; return val == null ? null : String(val).trim(); }
    case 'ltrim': { const val = args[0]; return val == null ? null : String(val).trimStart(); }
    case 'rtrim': { const val = args[0]; return val == null ? null : String(val).trimEnd(); }
    case 'length': { const val = args[0]; if (val == null) return null; if (Array.isArray(val)) return val.length; return String(val).length; }
    case 'head': { const list = asList(args[0]); if (!list) return null; return list.length > 0 ? list[0] : null; }
    case 'last': { const list = asList(args[0]); if (!list) return null; return list.length > 0 ? list[list.length - 1] : null; }
    case 'tail': {
      const val = args[0];
      const list = asList(val);
      if (!list) return null;
      if (list.length <= 1) return typeof val === 'string' ? '' : [];
      const sliced = list.slice(1);
      if (typeof val === 'string') return sliced.join('') as CypherValue;
      return sliced as unknown as CypherValue;
    }
    case 'id': { const val = args[0]; if (!val || typeof val !== 'object') return null; return (val as { id?: string }).id ?? null; }
    case 'labels':
    case 'labelsof': {
      const val = args[0]; if (!val || typeof val !== 'object') return [];
      const node = val as CypherNode; const raw = node[config.labelProperty];
      if (typeof raw === 'string') return [raw]; if (Array.isArray(raw)) return raw; return [];
    }
    case 'reltype':
    case 'type': {
      const val = args[0]; if (!val || typeof val !== 'object') return null;
      if (Array.isArray(val)) {
        const edges = val as CypherEdge[];
        if (edges.length === 1) return edges[0]![config.edgeTypeProperty] ?? null;
        return edges.map((e) => e[config.edgeTypeProperty] ?? null);
      }
      const edge = val as CypherEdge; return edge[config.edgeTypeProperty] ?? null;
    }
    case 'startnode': { const val = args[0]; if (!val || typeof val !== 'object') return null; return (val as CypherEdge).source ?? null; }
    case 'endnode': { const val = args[0]; if (!val || typeof val !== 'object') return null; return (val as CypherEdge).target ?? null; }
    case 'reverse': {
      const val = args[0];
      const list = asList(val);
      if (!list) return null;
      const reversed = [...list].reverse();
      if (typeof val === 'string') return reversed.join('') as CypherValue;
      return reversed as unknown as CypherValue;
    }
    case 'size': { const val = args[0]; if (val == null) return null; if (Array.isArray(val)) return val.length; return String(val).length; }
    case 'nodes': {
      const val = args[0]; if (!val || typeof val !== 'object') return [];
      if (Array.isArray(val)) return val as unknown as CypherValue;
      const obj = val as Record<string, unknown>;
      if (Array.isArray(obj.nodes)) return obj.nodes as unknown as CypherValue;
      if ('id' in obj) return [obj as CypherNode] as unknown as CypherValue;
      return [];
    }
    case 'relationships': {
      const val = args[0]; if (!val || typeof val !== 'object') return [];
      if (Array.isArray(val)) return val as unknown as CypherValue;
      const obj = val as Record<string, unknown>;
      if (Array.isArray(obj.relationships)) return obj.relationships as unknown as CypherValue;
      if ('source' in obj && 'target' in obj) return [obj as CypherEdge] as unknown as CypherValue;
      return [];
    }
    case 'coalesce': { for (const arg of args) { if (arg != null) return arg; } return null; }
    case 'tostring': { const val = args[0]; return val == null ? null : String(val); }
    case 'tointeger':
    case 'toint': { const val = args[0]; if (val == null) return null; if (typeof val === 'number') return Math.trunc(val); return parseInt(String(val), 10) ?? null; }
    case 'tofloat': { const val = args[0]; if (val == null) return null; if (typeof val === 'number') return val; return parseFloat(String(val)) ?? null; }
    case 'toboolean': {
      const val = args[0];
      if (val == null) return null;
      if (typeof val === 'boolean') return val;
      if (typeof val === 'number') return val !== 0;
      if (typeof val === 'string') return val !== '';
      return true; // maps, lists, etc. are truthy
    }
    case 'keys': {
      const val = args[0];
      if (val == null) return null;
      if (typeof val === 'object' && !Array.isArray(val)) {
        return Object.keys(val) as unknown as CypherValue;
      }
      return null;
    }
    // ── Temporal constructors ──────────────────────────────────────────
    case 'timestamp': {
      return Math.floor(Date.now() / 1000);
    }
    case 'datetime': {
      if (args.length === 0) {
        return new Date().toISOString();
      }
      return buildTemporal('datetime', args);
    }
    case 'date': {
      if (args.length === 0) {
        return new Date().toISOString().slice(0, 10);
      }
      return buildTemporal('date', args);
    }
    case 'time': {
      if (args.length === 0) {
        return new Date().toISOString().slice(11, 23);
      }
      return buildTemporal('time', args);
    }
    case 'localdatetime': {
      if (args.length === 0) {
        const d = new Date();
        return formatTemporalFromDate('localdatetime', d, true);
      }
      return buildTemporal('localdatetime', args, true);
    }
    case 'localtime': {
      if (args.length === 0) {
        const d = new Date();
        return formatTemporalFromDate('localtime', d, true);
      }
      return buildTemporal('localtime', args, true);
    }
    case 'datetimewithtimezone': {
      if (args.length === 0) {
        return new Date().toISOString();
      }
      return buildTemporal('datetimewithtimezone', args);
    }
    case 'timewithzone': {
      if (args.length === 0) {
        const d = new Date();
        return formatTemporalFromDate('timewithzone', d, false);
      }
      return buildTemporal('timewithzone', args);
    }
    case 'duration': {
      if (args.length === 0) return null;
      return buildDuration(args);
    }

    // ── Temporal extractors ────────────────────────────────────────────
    case 'year': { return extractTemporalComponent('year', args[0]); }
    case 'month': { return extractTemporalComponent('month', args[0]); }
    case 'day': { return extractTemporalComponent('day', args[0]); }
    case 'hour': { return extractTemporalComponent('hour', args[0]); }
    case 'minute': { return extractTemporalComponent('minute', args[0]); }
    case 'second': { return extractTemporalComponent('second', args[0]); }
    case 'millisecond': { return extractTemporalComponent('millisecond', args[0]); }
    case 'timezone': { return extractTemporalComponent('timezone', args[0]); }
    case 'epochseconds': { return extractTemporalComponent('epochseconds', args[0]); }
    case 'epochmillisecond': { return extractTemporalComponent('epochmillisecond', args[0]); }

    // ── Duration extractors ────────────────────────────────────────────
    case 'totalseconds': { return extractDurationComponent('totalseconds', args[0]); }
    case 'totalminutes': { return extractDurationComponent('totalminutes', args[0]); }

    // ── Temporal comparison helpers (for use in WHERE via coalesce trick) ──
    case 'temporalepoch': { return temporalToEpochMillis(args[0]); }

    // ── Random function ────────────────────────────────────────────────
    case 'random': {
      return Math.random();
    }

    default: throw new Error(`Function "${name}()" is not supported`);
  }
}

// ── Re-export temporal helpers for use by WHERE comparator ─────────────

export { isTemporalString, compareTemporalValues, temporalToEpochMillis };
