import type { CypherValue, Expression, OrderByItem, Projection, QueryContext, ReturnClause, WithClause, WhereExpression } from '../types/cypher';
import { isContextChain, materialiseChain, type ContextChain } from './context-chain';
import { containsAggregation, collectAggregations } from './aggregation';
import { applyOrderByToContexts, applyOrderByToRows } from './where';

/** Execute a RETURN projection stage. */
export function executeReturn(
  clause: ReturnClause,
  contexts: (QueryContext | ContextChain)[],
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
  evalExprWithAgg: (expr: Expression, ctx: QueryContext, aggResults: Map<string, CypherValue>) => CypherValue,
  computeAggregations: (baseContext: QueryContext, rows: QueryContext[], aggrProjections: Projection[], evalExpr: any, evalExprWithAgg: any) => QueryContext,
  compareValues: (a: CypherValue | undefined, b: CypherValue | undefined) => number,
): Record<string, CypherValue>[] {
  const keysSimple = clause.projections.filter((p) => !containsAggregation(p.expression));
  const keysAggr = clause.projections.filter((p) => containsAggregation(p.expression));

  if (keysAggr.length > 0) {
    const materialised = contexts.map((c) => materialiseChain(c));
    const result: Record<string, CypherValue> = {};

    keysSimple.forEach((p) => {
      const values = materialised.map((ctx) => evalExpr(p.expression, ctx));
      const uniqueValues = new Set(values.map((v) => JSON.stringify(v)));
      if (uniqueValues.size > 1) throw new Error(`Mixed aggregation and non-aggregation in RETURN without WITH: "${p.alias}" has different values across rows. Use a WITH clause to group first.`);
      result[p.alias] = values[0] as CypherValue;
    });

    const aggResult = computeAggregations(result, materialised, keysAggr, evalExpr, evalExprWithAgg);
    return [aggResult as Record<string, CypherValue>];
  }

  const materialised = contexts.map((c) => materialiseChain(c));

  const projected = materialised.map((context) => {
    const row: Record<string, CypherValue> = {};
    clause.projections.forEach((p) => { row[p.alias] = evalExpr(p.expression, context); });
    return { row, context };
  });

  const hasDistinct = clause.projections.some((p) => p.distinct);
  if (hasDistinct) {
    const seen = new Set<string>();
    const deduped: typeof projected = [];
    for (const { row, context } of projected) {
      const key = clause.projections.map((p) => JSON.stringify(row[p.alias])).join('\0');
      if (!seen.has(key)) { seen.add(key); deduped.push({ row, context }); }
    }
    projected.splice(0, projected.length, ...deduped);
  }

  if (clause.orderBy && clause.orderBy.length > 0) {
    const keyed = projected.map(({ row, context }) => ({ row, context, keys: clause.orderBy!.map((item) => evalExpr(item.expression, context)) }));
    keyed.sort((a, b) => {
      for (let i = 0; i < clause.orderBy!.length; i++) {
        const cmp = compareValues(a.keys[i], b.keys[i]);
        const item = clause.orderBy![i];
        if (cmp !== 0 && item) return item.direction === 'DESC' ? -cmp : cmp;
      }
      return 0;
    });
    projected.splice(0, projected.length, ...keyed.map((k) => ({ row: k.row, context: k.context })));
  }

  if (clause.skip !== undefined && clause.skip !== null) projected.splice(0, clause.skip);
  if (clause.limit !== undefined && clause.limit !== null) projected.length = Math.min(projected.length, clause.limit);

  return projected.map((p) => p.row);
}

/** Execute a WITH clause. */
export function executeWith(
  clause: WithClause,
  contexts: (QueryContext | ContextChain)[],
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
  evalExprWithAgg: (expr: Expression, ctx: QueryContext, aggResults: Map<string, CypherValue>) => CypherValue,
  computeAggregations: (baseContext: QueryContext, rows: QueryContext[], aggrProjections: Projection[], evalExpr: any, evalExprWithAgg: any) => QueryContext,
  evaluateWhere: (whereNode: WhereExpression, context: QueryContext) => boolean,
  compareValues: (a: CypherValue | undefined, b: CypherValue | undefined) => number,
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

  const groups = new Map<string, { simpleValues: QueryContext; rows: QueryContext[] }>();
  const materialised = contexts.map((c) => materialiseChain(c));

  for (const context of materialised) {
    const groupKeyObj: QueryContext = {};
    keysSimple.forEach((p) => { groupKeyObj[p.alias] = evalExpr(p.expression, context); });
    const sortedKeys = Object.keys(groupKeyObj).sort();
    const groupKeyStr = sortedKeys.map((k) => JSON.stringify([k, groupKeyObj[k]])).join(',');
    if (!groups.has(groupKeyStr)) groups.set(groupKeyStr, { simpleValues: groupKeyObj, rows: [] });
    groups.get(groupKeyStr)!.rows.push(context);
  }

  let newContexts: QueryContext[] = [];
  groups.forEach(({ simpleValues, rows }) => { newContexts.push(computeAggregations(simpleValues, rows, keysAggr, evalExpr, evalExprWithAgg)); });

  if (clause.where) newContexts = newContexts.filter((ctx) => evaluateWhere(clause.where!, ctx));
  if (clause.orderBy && clause.orderBy.length > 0) newContexts = applyOrderByToContexts(newContexts, clause.orderBy, evalExpr);
  if (clause.skip !== undefined && clause.skip !== null) newContexts = newContexts.slice(clause.skip);
  if (clause.limit !== undefined && clause.limit !== null) newContexts = newContexts.slice(0, clause.limit);

  return newContexts;
}
