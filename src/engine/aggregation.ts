import type { AggregationExpression, CypherNode, CypherValue, Expression, Projection, QueryContext, WhereExpression } from '../types/cypher';

/** Check if an expression contains any aggregation. */
export function containsAggregation(expr: Expression): boolean {
  if (expr.type === 'Aggregation') return true;
  if (expr.type === 'Arithmetic') { if (expr.left && containsAggregation(expr.left)) return true; return containsAggregation(expr.right); }
  if (expr.type === 'FunctionCall') return expr.arguments.some((a) => containsAggregation(a));
  if (expr.type === 'ListLiteral') return expr.values.some((v) => containsAggregation(v));
  if (expr.type === 'MapLiteral') return expr.entries.some((e) => containsAggregation(e.value));
  if (expr.type === 'ListSlice') { if (containsAggregation(expr.list)) return true; if (containsAggregation(expr.start)) return true; return containsAggregation(expr.end); }
  if (expr.type === 'Case') {
    if (expr.subject && containsAggregation(expr.subject)) return true;
    if (expr.branches.some((b) => containsAggregationInWhere(b.condition) || containsAggregation(b.result))) return true;
    if (expr.elseResult && containsAggregation(expr.elseResult)) return true;
  }
  return false;
}

/** Check if a WhereExpression contains any aggregation. */
export function containsAggregationInWhere(expr: Expression | WhereExpression): boolean {
  if (expr.type === 'LogicalExpression') return containsAggregationInWhere((expr as any).left) || containsAggregationInWhere((expr as any).right);
  if (expr.type === 'NotExpression') return containsAggregationInWhere((expr as any).expression);
  if (expr.type === 'IsNull') return containsAggregation((expr as any).expression);
  return containsAggregation(expr as Expression);
}

/** Collect all AggregationExpression nodes from an expression tree. */
export function collectAggregations(expr: Expression): AggregationExpression[] {
  const results: AggregationExpression[] = [];
  if (expr.type === 'Aggregation') { results.push(expr); }
  else if (expr.type === 'Arithmetic') { if (expr.left) results.push(...collectAggregations(expr.left)); results.push(...collectAggregations(expr.right)); }
  else if (expr.type === 'FunctionCall') { expr.arguments.forEach((a) => results.push(...collectAggregations(a))); }
  else if (expr.type === 'ListLiteral') { expr.values.forEach((v) => results.push(...collectAggregations(v))); }
  else if (expr.type === 'MapLiteral') { expr.entries.forEach((e) => results.push(...collectAggregations(e.value))); }
  else if (expr.type === 'ListSlice') { results.push(...collectAggregations(expr.list)); results.push(...collectAggregations(expr.start)); results.push(...collectAggregations(expr.end)); }
  else if (expr.type === 'Case') {
    if (expr.subject) results.push(...collectAggregations(expr.subject));
    expr.branches.forEach((b) => { results.push(...collectAggregationsInWhere(b.condition)); results.push(...collectAggregations(b.result)); });
    if (expr.elseResult) results.push(...collectAggregations(expr.elseResult));
  }
  return results;
}

/** Collect aggregations from a WhereExpression. */
export function collectAggregationsInWhere(expr: Expression | WhereExpression): AggregationExpression[] {
  if (expr.type === 'LogicalExpression') return [...collectAggregationsInWhere((expr as any).left), ...collectAggregationsInWhere((expr as any).right)];
  if (expr.type === 'NotExpression') return collectAggregationsInWhere((expr as any).expression);
  if (expr.type === 'IsNull') return collectAggregations((expr as any).expression);
  return collectAggregations(expr as Expression);
}

/** Compute aggregations for a group of rows. */
export function computeAggregations(
  baseContext: QueryContext,
  rows: QueryContext[],
  aggrProjections: Projection[],
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
  evalExprWithAgg: (expr: Expression, ctx: QueryContext, aggResults: Map<string, CypherValue>) => CypherValue,
): QueryContext {
  const newContext = { ...baseContext };

  const aggVars = new Map<string, AggregationExpression>();
  aggrProjections.forEach((p) => { const aggs = collectAggregations(p.expression); aggs.forEach((agg) => { const key = `${agg.variable}:${agg.property ?? ''}`; aggVars.set(key, agg); }); });

  const numericCache = new Map<string, number[]>();
  const nonNullCache = new Map<string, number>();
  const distinctSeen = new Map<string, Set<string>>();

  for (const row of rows) {
    for (const expr of aggVars.values()) {
      const key = `${expr.variable}:${expr.property ?? ''}`;
      const baseVal = row[expr.variable];
      const val = expr.property ? (baseVal as CypherNode | undefined)?.[expr.property] : baseVal;
      if (val !== null && val !== undefined) { nonNullCache.set(key, (nonNullCache.get(key) ?? 0) + 1); }
      if (expr.distinct) {
        if (!distinctSeen.has(key)) distinctSeen.set(key, new Set());
        const seen = distinctSeen.get(key)!;
        const valStr = JSON.stringify(val);
        if (!seen.has(valStr)) { seen.add(valStr); if (typeof val === 'number') { if (!numericCache.has(key)) numericCache.set(key, []); const arr = numericCache.get(key); if (arr) arr.push(val); } }
      } else if (typeof val === 'number') { if (!numericCache.has(key)) numericCache.set(key, []); const arr = numericCache.get(key); if (arr) arr.push(val); }
    }
  }

  const allAggExprs = new Map<string, AggregationExpression>();
  aggrProjections.forEach((p) => { const aggs = collectAggregations(p.expression); aggs.forEach((agg) => { const aggKey = `${agg.variable}:${agg.property ?? ''}:${agg.aggregationType}:${agg.distinct}`; allAggExprs.set(aggKey, agg); }); });

  const aggResults = new Map<string, CypherValue>();
  allAggExprs.forEach((expr, aggKey) => {
    const key = `${expr.variable}:${expr.property ?? ''}`;
    const numericValues = numericCache.get(key) ?? [];
    const nonNullCount = nonNullCache.get(key) ?? 0;
    if (expr.aggregationType === 'COUNT') aggResults.set(aggKey, expr.distinct ? (distinctSeen.get(key)?.size ?? 0) : nonNullCount);
    else if (expr.aggregationType === 'SUM') aggResults.set(aggKey, numericValues.reduce((a, b) => a + b, 0));
    else if (expr.aggregationType === 'AVG') aggResults.set(aggKey, numericValues.length > 0 ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length : null);
    else if (expr.aggregationType === 'MIN') aggResults.set(aggKey, numericValues.length > 0 ? Math.min(...numericValues) : null);
    else if (expr.aggregationType === 'MAX') aggResults.set(aggKey, numericValues.length > 0 ? Math.max(...numericValues) : null);
  });

  aggrProjections.forEach((p) => {
    if (p.expression.type === 'Aggregation') {
      const key = `${p.expression.variable}:${p.expression.property ?? ''}`;
      const aggKey = `${key}:${p.expression.aggregationType}:${p.expression.distinct}`;
      newContext[p.alias] = aggResults.get(aggKey) ?? null;
    } else {
      newContext[p.alias] = evalExprWithAgg(p.expression, newContext, aggResults);
    }
  });

  return newContext;
}
