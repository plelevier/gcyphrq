import type { QueryContext, CypherValue, Expression, Projection, OrderByItem, ReturnClause, WithClause, WhereExpression, AggregationExpression, UnwindClause } from '../types/cypher';
import { isContextChain, materialiseChain, type ContextChain, CHAIN_BASE, CHAIN_OVERRIDES } from './context-chain';
import { containsAggregation, collectAggregations, getAggKey } from './aggregation';
import { compareValuesWithNulls } from './where';

// ── Pipeline row ─────────────────────────────────────────────────────────────

export interface PipelineRow {
  context: QueryContext | ContextChain;
}

export type RowGenerator = AsyncGenerator<PipelineRow, void, void>;

// ── Generator helpers ────────────────────────────────────────────────────────

/** Convert any iterable of contexts into a generator. */
export async function* fromContexts(contexts: (QueryContext | ContextChain)[]): RowGenerator {
  for (const ctx of contexts) yield { context: ctx };
}

/** Collect a generator back into an array (for stages that need it). */
export async function collect(gen: RowGenerator): Promise<(QueryContext | ContextChain)[]> {
  const results: (QueryContext | ContextChain)[] = [];
  for await (const { context } of gen) results.push(context);
  return results;
}

// ── Abort signal for early termination ───────────────────────────────────────

export class AbortSignal {
  private _aborted = false;
  abort(): void { this._aborted = true; }
  get aborted(): boolean { return this._aborted; }
}

// ── Heuristic: should we use the lazy pipeline? ──────────────────────────────

/**
 * Decide whether to use the lazy (generator-based) pipeline.
 *
 * Lazy is beneficial when:
 * - LIMIT is present (short-circuit or streamed aggregation)
 * - Aggregation is present without collect/DISTINCT (streamed accumulators)
 *
 * Eager is simpler (and faster for small result sets) when:
 * - DISTINCT without LIMIT/agg (must see all rows)
 * - ORDER BY without LIMIT/agg (must see all rows)
 * - collect() or DISTINCT aggregations (inherently materialising)
 */
export function shouldLazy(ast: { return?: ReturnClause | undefined; stages: { type: string }[] }): boolean {
  const returnClause = ast.return;
  if (!returnClause) return false;

  const hasLimit = returnClause.limit !== undefined && returnClause.limit !== null;
  const hasAgg = returnClause.projections.some((p) => containsAggregation(p.expression));
  const hasDistinct = returnClause.projections.some((p) => p.distinct);

  // Check for collect() or DISTINCT aggregations that force materialisation
  let hasCollectDistinct = false;
  if (hasAgg) {
    for (const p of returnClause.projections) {
      const aggs = collectAggregations(p.expression);
      for (const agg of aggs) {
        if (agg.aggregationType === 'COLLECT' || agg.distinct) {
          hasCollectDistinct = true;
          break;
        }
      }
      if (hasCollectDistinct) break;
    }
  }

  if (hasLimit) return true;                                       // short-circuit or streamed agg
  if (hasAgg && !hasCollectDistinct) return true;                  // streamed aggregation
  return false;                                                     // DISTINCT / collect / ORDER BY → eager
}

// ── Streaming grouped aggregation ────────────────────────────────────────────

/** Accumulator state for a single aggregation function within a group. */
interface AggAccumulator {
  type: string;
  count?: number;
  sum?: number;
  min?: number;
  max?: number;
  collect?: CypherValue[];
  distinctSet?: Set<string>;
}

/** Group state: group key values + per-aggregation accumulators. */
export interface GroupState {
  keyValues: QueryContext;
  accumulators: Map<string, AggAccumulator>;
}

/** Create initial accumulator state for an aggregation expression. */
function createAccumulator(agg: AggregationExpression): AggAccumulator {
  const base: AggAccumulator = { type: agg.aggregationType };
  if (agg.aggregationType === 'COUNT') base.count = 0;
  if (agg.aggregationType === 'SUM') base.sum = 0;
  if (agg.aggregationType === 'AVG') { base.sum = 0; base.count = 0; }
  if (agg.aggregationType === 'COLLECT') base.collect = [];
  if (agg.distinct) base.distinctSet = new Set();
  return base;
}

/** Update accumulator with one row's contribution. */
function updateAccumulator(
  acc: AggAccumulator,
  agg: AggregationExpression,
  ctx: QueryContext,
  evalExpr: (e: Expression, c: QueryContext) => CypherValue | undefined,
): void {
  // count(*) — just increment, no value to evaluate
  if (agg.isStar) {
    acc.count = (acc.count ?? 0) + 1;
    return;
  }

  // count((pattern)) — sum array lengths incrementally
  if (agg.isPattern) {
    const result = evalExpr(agg.expression!, ctx);
    if (Array.isArray(result)) {
      acc.count = (acc.count ?? 0) + result.length;
    }
    return;
  }

  // Evaluate the value for this row
  let val: CypherValue | undefined;
  if (agg.expression) {
    val = evalExpr(agg.expression, ctx);
  } else if (agg.variable) {
    const baseVal = ctx[agg.variable];
    val = (agg.property ? (baseVal as Record<string, unknown> | undefined)?.[agg.property] : baseVal) as CypherValue | undefined;
  } else {
    val = undefined;
  }

  // DISTINCT: skip if already seen
  if (agg.distinct) {
    const key = JSON.stringify(val);
    if (acc.distinctSet!.has(key)) return;
    acc.distinctSet!.add(key);
  }

  // Update based on aggregation type
  switch (acc.type) {
    case 'COUNT':
      if (val !== null && val !== undefined) {
        acc.count = (acc.count ?? 0) + 1;
      }
      break;
    case 'SUM':
      if (typeof val === 'number') {
        acc.sum = (acc.sum ?? 0) + val;
      }
      break;
    case 'AVG':
      if (typeof val === 'number') {
        acc.sum = (acc.sum ?? 0) + val;
        acc.count = (acc.count ?? 0) + 1;
      }
      break;
    case 'MIN':
      if (typeof val === 'number' && val !== null) {
        acc.min = acc.min === undefined ? val : Math.min(acc.min, val);
      }
      break;
    case 'MAX':
      if (typeof val === 'number' && val !== null) {
        acc.max = acc.max === undefined ? val : Math.max(acc.max, val);
      }
      break;
    case 'COLLECT':
      acc.collect!.push(val as CypherValue);
      break;
  }
}

/** Convert accumulator to final value. */
function finaliseAccumulator(acc: AggAccumulator): CypherValue {
  switch (acc.type) {
    case 'COUNT':
      return acc.count ?? 0;
    case 'SUM':
      return acc.sum ?? 0;
    case 'AVG':
      return acc.count && acc.count > 0 ? (acc.sum ?? 0) / acc.count : null;
    case 'MIN':
      return acc.min ?? null;
    case 'MAX':
      return acc.max ?? null;
    case 'COLLECT':
      return (acc.collect ?? []) as unknown as CypherValue;
    default:
      return null;
  }
}

/**
 * Stream rows through grouped aggregation using per-group accumulators.
 *
 * This is the core optimisation: instead of collecting all rows into a
 * `Map<groupKey, rows[]>`, we maintain `Map<groupKey, accumulators>` and
 * feed each row through one-at-a-time.
 */
export async function streamGroupedAggregation(
  gen: RowGenerator,
  projections: Projection[],
  signal: AbortSignal,
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
): Promise<GroupState[]> {
  const keysSimple = projections.filter((p) => !containsAggregation(p.expression));
  const keysAggr = projections.filter((p) => containsAggregation(p.expression));

  const groups = new Map<string, GroupState>();

  for await (const { context } of gen) {
    if (signal.aborted) break;
    const flat = isContextChain(context) ? materialiseChain(context) : context;

    // Evaluate group key
    const groupKeyObj: QueryContext = {};
    keysSimple.forEach((p) => { groupKeyObj[p.alias] = evalExpr(p.expression, flat); });
    const groupKeyStr = JSON.stringify(Object.entries(groupKeyObj).sort());

    let group = groups.get(groupKeyStr);
    if (!group) {
      group = { keyValues: groupKeyObj, accumulators: new Map() };
      groups.set(groupKeyStr, group);
    }

    // Update each aggregation accumulator
    if (keysAggr.length > 0) {
      for (const proj of keysAggr) {
        const aggs = collectAggregations(proj.expression);
        for (const agg of aggs) {
          const aggKey = `${getAggKey(agg)}:${agg.aggregationType}:${agg.distinct}`;
          let acc = group.accumulators.get(aggKey);
          if (!acc) {
            acc = createAccumulator(agg);
            group.accumulators.set(aggKey, acc);
          }
          updateAccumulator(acc, agg, flat, evalExpr);
        }
      }
    }
  }

  // Finalise: convert accumulators to final values
  const results: GroupState[] = [];
  for (const group of groups.values()) {
    const finalValues: QueryContext = { ...group.keyValues };
    for (const [aggKey, acc] of group.accumulators) {
      finalValues[aggKey] = finaliseAccumulator(acc);
    }
    group.keyValues = finalValues;
    results.push(group);
  }
  return results;
}

/** Build default aggregation values for the empty-input case. */
export function buildEmptyAggDefaults(
  projections: Projection[],
): QueryContext {
  const emptyCtx: QueryContext = {};
  const keysAggr = projections.filter((p) => containsAggregation(p.expression));
  for (const proj of keysAggr) {
    const aggs = collectAggregations(proj.expression);
    for (const agg of aggs) {
      const aggKey = `${getAggKey(agg)}:${agg.aggregationType}:${agg.distinct}`;
      if (agg.isStar || agg.isPattern || agg.aggregationType === 'COUNT') emptyCtx[aggKey] = 0;
      else if (agg.aggregationType === 'SUM') emptyCtx[aggKey] = 0;
      else if (agg.aggregationType === 'AVG') emptyCtx[aggKey] = null;
      else if (agg.aggregationType === 'MIN' || agg.aggregationType === 'MAX') emptyCtx[aggKey] = null;
      else if (agg.aggregationType === 'COLLECT') emptyCtx[aggKey] = [];
    }
  }
  return emptyCtx;
}

// ── Streaming stage implementations ──────────────────────────────────────────

/** Stream UNWIND: expand lists into individual rows, yielding immediately. */
export async function* executeUnwindStream(
  gen: RowGenerator,
  clause: UnwindClause,
  signal: AbortSignal,
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
  evaluateWhere: (whereNode: WhereExpression, context: QueryContext) => boolean,
): RowGenerator {
  for await (const { context } of gen) {
    if (signal.aborted) break;
    const flat = isContextChain(context) ? materialiseChain(context) : context;
    const listValue = evalExpr(clause.expression, flat);
    if (listValue === null || listValue === undefined) continue;
    const list: CypherValue[] = typeof listValue === 'string'
      ? [...listValue]
      : Array.isArray(listValue)
        ? listValue
        : [listValue];

    for (const element of list) {
      const unwoundContext: QueryContext = { ...flat, [clause.variable]: element };
      if (clause.where && !evaluateWhere(clause.where, unwoundContext)) continue;
      yield { context: { [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: { [clause.variable]: element } } };
    }
  }
}

/** Stream WITH clause (non-aggregation path). */
export async function* executeWithStream(
  gen: RowGenerator,
  clause: WithClause,
  signal: AbortSignal,
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
  evaluateWhere: (whereNode: WhereExpression, context: QueryContext) => boolean,
): RowGenerator {
  // Passthrough WITH (no projections) — collect for ORDER BY / SKIP / LIMIT
  if (clause.projections.length === 0) {
    const rows: ProjectedRow[] = [];
    for await (const { context } of gen) {
      if (signal.aborted) break;
      const flat = isContextChain(context) ? materialiseChain(context) : context;
      if (clause.where && !evaluateWhere(clause.where, flat)) continue;
      rows.push({ row: flat, context: flat });
    }
    const processed = applyPostProcessing(
      rows, [], clause.orderBy, clause.skip, clause.limit,
      evalExpr,
    );
    for (const { row } of processed) yield { context: row };
    return;
  }

  // Project and yield each row
  const projected: ProjectedRow[] = [];
  for await (const { context } of gen) {
    if (signal.aborted) break;
    const flat = isContextChain(context) ? materialiseChain(context) : context;
    const row: QueryContext = {};
    clause.projections.forEach((p) => { row[p.alias] = evalExpr(p.expression, flat); });

    if (clause.where && !evaluateWhere(clause.where, row)) continue;
    projected.push({ row, context: row });
  }

  // Apply ORDER BY, SKIP, LIMIT
  const processed = applyPostProcessing(
    projected, clause.projections, clause.orderBy, clause.skip, clause.limit,
    evalExpr,
  );
  for (const { row } of processed) yield { context: row };
}

/**
 * Apply post-processing (DISTINCT, ORDER BY, SKIP, LIMIT) to a set of projected rows.
 * Used by the eager path when full materialisation is required.
 */
export interface ProjectedRow {
  row: Record<string, CypherValue>;
  context: QueryContext;
}

export function applyPostProcessing(
  projected: ProjectedRow[],
  projections: Projection[],
  orderBy: OrderByItem[] | undefined,
  skip: number | undefined,
  limit: number | undefined,
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
): ProjectedRow[] {
  const hasDistinct = projections.some((p) => p.distinct);
  if (hasDistinct) {
    const seen = new Set<string>();
    const deduped: ProjectedRow[] = [];
    for (const { row, context } of projected) {
      const key = projections.map((p) => JSON.stringify(row[p.alias])).join('\0');
      if (!seen.has(key)) { seen.add(key); deduped.push({ row, context }); }
    }
    projected = deduped;
  }

  if (orderBy && orderBy.length > 0) {
    const keyed = projected.map(({ row, context }) => ({
      row,
      context,
      keys: orderBy.map((item) => evalExpr(item.expression, context)),
    }));
    keyed.sort((a, b) => {
      for (let i = 0; i < orderBy.length; i++) {
        const item = orderBy[i];
        if (!item) continue;
        const cmp = compareValuesWithNulls(a.keys[i], b.keys[i], item);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
    projected = keyed.map((k) => ({ row: k.row, context: k.context }));
  }

  if (skip !== undefined && skip !== null) projected = projected.slice(skip);
  if (limit !== undefined && limit !== null) projected = projected.slice(0, limit);

  return projected;
}
