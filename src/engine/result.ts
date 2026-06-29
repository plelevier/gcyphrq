import type { CypherValue, Expression, OrderByItem, Projection, QueryContext, ReturnClause, WithClause, WhereExpression } from '../types/cypher';
import { isContextChain, materialiseChain, type ContextChain } from './context-chain';
import { containsAggregation, collectAggregations } from './aggregation';
import { applyOrderByToContexts, compareValuesWithNulls } from './where';

type ProjectedRow = { row: Record<string, CypherValue>; context: QueryContext };

/** Apply DISTINCT, ORDER BY, SKIP, LIMIT to a list of projected rows. */
function applyPostProcessing(
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
    projected.splice(0, projected.length, ...deduped);
  }

  if (orderBy && orderBy.length > 0) {
    const keyed = projected.map(({ row, context }) => ({ row, context, keys: orderBy.map((item) => evalExpr(item.expression, context)) }));
    keyed.sort((a, b) => {
      for (let i = 0; i < orderBy.length; i++) {
        const item = orderBy[i];
        if (!item) continue;
        const cmp = compareValuesWithNulls(a.keys[i], b.keys[i], item);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
    projected.splice(0, projected.length, ...keyed.map((k) => ({ row: k.row, context: k.context })));
  }

  if (skip !== undefined && skip !== null) projected.splice(0, skip);
  if (limit !== undefined && limit !== null) projected.length = Math.min(projected.length, limit);

  return projected;
}

/** Build a grouping map from rows, keyed by non-aggregated projection values. */
function buildGroups(
  materialised: QueryContext[],
  keysSimple: Projection[],
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
): Map<string, { simpleValues: QueryContext; rows: QueryContext[] }> {
  const groups = new Map<string, { simpleValues: QueryContext; rows: QueryContext[] }>();

  for (const context of materialised) {
    const groupKeyObj: QueryContext = {};
    keysSimple.forEach((p) => { groupKeyObj[p.alias] = evalExpr(p.expression, context); });
    const sortedKeys = Object.keys(groupKeyObj).sort();
    const groupKeyStr = sortedKeys.map((k) => JSON.stringify([k, groupKeyObj[k]])).join(',');
    if (!groups.has(groupKeyStr)) groups.set(groupKeyStr, { simpleValues: groupKeyObj, rows: [] });
    groups.get(groupKeyStr)!.rows.push(context);
  }

  return groups;
}

/** Execute a RETURN projection stage. */
export function executeReturn(
  clause: ReturnClause,
  contexts: (QueryContext | ContextChain)[],
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
  evalExprWithAgg: (expr: Expression, ctx: QueryContext, aggResults: Map<string, CypherValue>) => CypherValue,
  computeAggregations: (baseContext: QueryContext, rows: QueryContext[], aggrProjections: Projection[], evalExpr: any, evalExprWithAgg: any) => QueryContext,
): Record<string, CypherValue>[] {
  const keysSimple = clause.projections.filter((p) => !containsAggregation(p.expression));
  const keysAggr = clause.projections.filter((p) => containsAggregation(p.expression));

  if (keysAggr.length > 0) {
    const materialised = contexts.map((c) => materialiseChain(c));

    // When there are no input rows but aggregations are present, produce one row with defaults
    if (materialised.length === 0) {
      const emptyResult = computeAggregations({}, [], keysAggr, evalExpr, evalExprWithAgg);
      const row: Record<string, CypherValue> = {};
      clause.projections.forEach((p) => { row[p.alias] = emptyResult[p.alias]; });
      return [row];
    }

    const groups = buildGroups(materialised, keysSimple, evalExpr);

    const groupedContexts: QueryContext[] = [];
    groups.forEach(({ simpleValues, rows }) => { groupedContexts.push(computeAggregations(simpleValues, rows, keysAggr, evalExpr, evalExprWithAgg)); });

    // Build projected rows from grouped contexts
    const projected = groupedContexts.map((ctx) => {
      const row: Record<string, CypherValue> = {};
      clause.projections.forEach((p) => { row[p.alias] = ctx[p.alias]; });
      return { row, context: ctx };
    });

    return applyPostProcessing(projected, clause.projections, clause.orderBy, clause.skip, clause.limit, evalExpr).map((p) => p.row);
  }

  const materialised = contexts.map((c) => materialiseChain(c));

  const projected = materialised.map((context) => {
    const row: Record<string, CypherValue> = {};
    clause.projections.forEach((p) => { row[p.alias] = evalExpr(p.expression, context); });
    return { row, context };
  });

  return applyPostProcessing(projected, clause.projections, clause.orderBy, clause.skip, clause.limit, evalExpr).map((p) => p.row);
}

/** Execute a WITH clause. */
export function executeWith(
  clause: WithClause,
  contexts: (QueryContext | ContextChain)[],
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
  evalExprWithAgg: (expr: Expression, ctx: QueryContext, aggResults: Map<string, CypherValue>) => CypherValue,
  computeAggregations: (baseContext: QueryContext, rows: QueryContext[], aggrProjections: Projection[], evalExpr: any, evalExprWithAgg: any) => QueryContext,
  evaluateWhere: (whereNode: WhereExpression, context: QueryContext) => boolean,
): QueryContext[] {
  const keysSimple = clause.projections.filter((p) => !containsAggregation(p.expression));
  const keysAggr = clause.projections.filter((p) => containsAggregation(p.expression));

  if (clause.projections.length === 0) {
    let newContexts = contexts.map((c) => materialiseChain(c));
    if (clause.where) newContexts = newContexts.filter((ctx) => evaluateWhere(clause.where!, ctx));
    if (clause.orderBy && clause.orderBy.length > 0) newContexts = applyOrderByToContexts(newContexts, clause.orderBy, evalExpr);
    if (clause.skip !== undefined && clause.skip !== null) newContexts = newContexts.slice(clause.skip);
    if (clause.limit !== undefined && clause.limit !== null) newContexts = newContexts.slice(0, clause.limit);
    return newContexts;
  }

  const materialised = contexts.map((c) => materialiseChain(c));

  // When there are no input rows but aggregations are present, produce one row with defaults
  if (materialised.length === 0 && keysAggr.length > 0) {
    const emptyResult = computeAggregations({}, [], keysAggr, evalExpr, evalExprWithAgg);
    let newContexts = [emptyResult];
    if (clause.where) newContexts = newContexts.filter((ctx) => evaluateWhere(clause.where!, ctx));
    if (clause.orderBy && clause.orderBy.length > 0) newContexts = applyOrderByToContexts(newContexts, clause.orderBy, evalExpr);
    if (clause.skip !== undefined && clause.skip !== null) newContexts = newContexts.slice(clause.skip);
    if (clause.limit !== undefined && clause.limit !== null) newContexts = newContexts.slice(0, clause.limit);
    return newContexts;
  }

  const groups = buildGroups(materialised, keysSimple, evalExpr);

  let newContexts: QueryContext[] = [];
  groups.forEach(({ simpleValues, rows }) => { newContexts.push(computeAggregations(simpleValues, rows, keysAggr, evalExpr, evalExprWithAgg)); });

  if (clause.where) newContexts = newContexts.filter((ctx) => evaluateWhere(clause.where!, ctx));
  if (clause.orderBy && clause.orderBy.length > 0) newContexts = applyOrderByToContexts(newContexts, clause.orderBy, evalExpr);
  if (clause.skip !== undefined && clause.skip !== null) newContexts = newContexts.slice(clause.skip);
  if (clause.limit !== undefined && clause.limit !== null) newContexts = newContexts.slice(0, clause.limit);

  return newContexts;
}
