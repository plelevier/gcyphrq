import { evaluateArithmeticCore } from '../arithmetic';
import type { CypherEdge, CypherNode, CypherValue, Expression, GraphConfig, QueryContext, WhereExpression } from '../types/cypher';

/** Evaluate an expression against a context. */
export function evaluateExpression(
  expr: Expression,
  context: QueryContext,
  config: GraphConfig,
  evalFunc: (name: string, args: CypherValue[]) => CypherValue,
  evalWhere?: (w: WhereExpression, ctx: QueryContext) => boolean,
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
    for (const le of expr.values) { const val = evaluateExpression(le, context, config, evalFunc, evalWhere); values.push(val as CypherValue); }
    return values as CypherValue;
  }
  if (expr.type === 'MapLiteral') {
    const values: Record<string, CypherValue> = {};
    for (const entry of expr.entries) { const val = evaluateExpression(entry.value, context, config, evalFunc, evalWhere); values[entry.key] = val as CypherValue; }
    return values as CypherValue;
  }
  if (expr.type === 'Aggregation') return undefined;
  if (expr.type === 'FunctionCall') {
    const args = expr.arguments.map((a) => evaluateExpression(a, context, config, evalFunc, evalWhere));
    return evalFunc(expr.functionName, args);
  }
  if (expr.type === 'ListSlice') {
    const list = evaluateExpression(expr.list, context, config, evalFunc, evalWhere);
    if (!Array.isArray(list)) return null;
    const startVal = evaluateExpression(expr.start, context, config, evalFunc, evalWhere);
    const endVal = evaluateExpression(expr.end, context, config, evalFunc, evalWhere);
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
    return list.slice(adjStart, adjEnd) as unknown as CypherValue;
  }
  if (expr.type === 'Arithmetic') {
    return evaluateArithmeticCore(expr, (e) => evaluateExpression(e, context, config, evalFunc, evalWhere));
  }
  if (expr.type === 'Case') {
    return evaluateCase(expr, context, config, evalFunc, evalWhere);
  }
  if (expr.type === 'Path') return undefined; // handled separately
  if (expr.type === 'Reduce') {
    return evaluateReduce(expr, context, config, evalFunc, evalWhere);
  }
  if (expr.type === 'Quantifier') {
    if (!evalWhere) return undefined;
    return evaluateQuantifier(expr, context, config, evalFunc, evalWhere);
  }
  if (expr.type === 'Exists') {
    const value = evaluateExpression(expr.expression, context, config, evalFunc, evalWhere);
    return value !== null && value !== undefined;
  }
  return undefined;
}

/** Evaluate a reduce expression. */
function evaluateReduce(
  expr: Extract<Expression, { type: 'Reduce' }>,
  context: QueryContext,
  config: GraphConfig,
  evalFunc: (name: string, args: CypherValue[]) => CypherValue,
  evalWhere?: (w: WhereExpression, ctx: QueryContext) => boolean,
): CypherValue {
  const evalExpr = (e: Expression, ctx?: QueryContext) => evaluateExpression(e, ctx ?? context, config, evalFunc, evalWhere);

  let accumulator = evalExpr(expr.initial);
  if (accumulator === null || accumulator === undefined) return null;

  const list = evalExpr(expr.list);
  if (!Array.isArray(list)) return accumulator;

  for (const element of list) {
    const loopContext: QueryContext = { ...context, [expr.accumulator]: accumulator, [expr.loopVariable]: element };
    const bodyValue = evaluateExpression(expr.body, loopContext, config, evalFunc, evalWhere);
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
): boolean {
  const list = evaluateExpression(expr.list, context, config, evalFunc, evalWhere);
  if (!Array.isArray(list)) return false;

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
export function evaluateCase(expr: Extract<Expression, { type: 'Case' }>, context: QueryContext, config: GraphConfig, evalFunc: (name: string, args: CypherValue[]) => CypherValue, evalWhere?: (w: WhereExpression, ctx: QueryContext) => boolean): CypherValue {
  const evalExpr = (e: Expression) => evaluateExpression(e, context, config, evalFunc, evalWhere);

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
        // Will be handled by caller via evaluateWhere
        condResult = false;
      } else { condResult = false; }
      if (condResult) return evalExpr(branch.result) ?? null;
    }
  }
  if (expr.elseResult) return evalExpr(expr.elseResult) ?? null;
  return null;
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
    case 'head': { const val = args[0]; if (!Array.isArray(val)) return null; return val.length > 0 ? val[0] : null; }
    case 'last': { const val = args[0]; if (!Array.isArray(val)) return null; return val.length > 0 ? val[val.length - 1] : null; }
    case 'tail': { const val = args[0]; if (!Array.isArray(val)) return null; return val.length > 1 ? val.slice(1) : []; }
    case 'id': { const val = args[0]; if (!val || typeof val !== 'object') return null; return (val as { id?: string }).id ?? null; }
    case 'labels':
    case 'labelsof': {
      const val = args[0]; if (!val || typeof val !== 'object') return [];
      const node = val as CypherNode; const raw = node[config.labelProperty];
      if (typeof raw === 'string') return [raw]; if (Array.isArray(raw)) return raw; return [];
    }
    case 'reltype': {
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
    case 'reverse': { const val = args[0]; if (!Array.isArray(val)) return null; return [...val].reverse() as unknown as CypherValue; }
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
    case 'tointeger': { const val = args[0]; if (val == null) return null; if (typeof val === 'number') return Math.trunc(val); return parseInt(String(val), 10) ?? null; }
    case 'tofloat': { const val = args[0]; if (val == null) return null; if (typeof val === 'number') return val; return parseFloat(String(val)) ?? null; }
    default: throw new Error(`Function "${name}()" is not supported`);
  }
}
