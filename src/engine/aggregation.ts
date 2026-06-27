import type { AggregationExpression, CypherNode, CypherValue, Expression, ListComprehensionExpression, PatternComprehensionExpression, Projection, QueryContext, WhereExpression, ReduceExpression } from '../types/cypher';

/**
 * Count pattern matches across all rows in a group.
 * For `count((pattern))`, each row contributes the number of pattern matches (0+).
 * The total is the sum of all match counts across the group.
 */
function computePatternCount(
  rows: QueryContext[],
  expr: AggregationExpression,
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
): number {
  let total = 0;
  for (const row of rows) {
    const result = evalExpr(expr.expression!, row);
    if (Array.isArray(result)) {
      total += result.length;
    }
  }
  return total;
}

/** Check if an expression contains any aggregation (excluding bare reduce). */
export function containsAggregation(expr: Expression): boolean {
  if (expr.type === 'Aggregation') return true;
  // Reduce itself is NOT an aggregation — it only contains one if its sub-expressions do
  if (expr.type === 'Reduce') {
    return containsAggregation(expr.initial) || containsAggregation(expr.list) || containsAggregation(expr.body);
  }
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
  if (expr.type === 'ListComprehension') {
    if (containsAggregation(expr.list)) return true;
    if (containsAggregation(expr.generator)) return true;
    if (expr.predicate && containsAggregationInWhere(expr.predicate)) return true;
  }
  if (expr.type === 'PatternComprehension') {
    if (containsAggregation(expr.generator)) return true;
    if (expr.predicate && containsAggregationInWhere(expr.predicate)) return true;
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
  else if (expr.type === 'Reduce') {
    results.push(...collectAggregations(expr.initial));
    results.push(...collectAggregations(expr.list));
    results.push(...collectAggregations(expr.body));
  }
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
  else if (expr.type === 'ListComprehension') {
    results.push(...collectAggregations(expr.list));
    results.push(...collectAggregations(expr.generator));
    if (expr.predicate) results.push(...collectAggregationsInWhere(expr.predicate));
  }
  else if (expr.type === 'PatternComprehension') {
    results.push(...collectAggregations(expr.generator));
    if (expr.predicate) results.push(...collectAggregationsInWhere(expr.predicate));
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

/** Generate a unique key for an aggregation expression. */
export function getAggKey(expr: AggregationExpression): string {
  if (expr.expression) {
    return `__expr__:${JSON.stringify(expr.expression)}`;
  }
  return `${expr.variable ?? ''}:${expr.property ?? ''}`;
}

/** Evaluate the value for an aggregation across a single row. */
function evalAggValue(
  expr: AggregationExpression,
  row: QueryContext,
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
): CypherValue | undefined {
  if (expr.isStar) return true; // sentinel for count(*)
  if (expr.expression) {
    return evalExpr(expr.expression, row);
  }
  const baseVal = expr.variable ? row[expr.variable] : undefined;
  return (expr.property ? (baseVal as CypherNode | undefined)?.[expr.property] : baseVal) as CypherValue | undefined;
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
  aggrProjections.forEach((p) => { const aggs = collectAggregations(p.expression); aggs.forEach((agg) => { const key = getAggKey(agg); aggVars.set(key, agg); }); });

  const numericCache = new Map<string, number[]>();
  const nonNullCache = new Map<string, number>();
  const allValuesCache = new Map<string, CypherValue[]>();
  const distinctSeen = new Map<string, Set<string>>();

  for (const row of rows) {
    for (const expr of aggVars.values()) {
      const key = getAggKey(expr);
      const val = evalAggValue(expr, row, evalExpr);

      // For count(*), count all rows
      if (expr.isStar) {
        nonNullCache.set(key, (nonNullCache.get(key) ?? 0) + 1);
        continue;
      }

      if (val !== null && val !== undefined) {
        nonNullCache.set(key, (nonNullCache.get(key) ?? 0) + 1);
      }

      // Collect all values for COLLECT
      if (!allValuesCache.has(key)) allValuesCache.set(key, []);
      allValuesCache.get(key)!.push(val as CypherValue);

      if (expr.distinct) {
        if (!distinctSeen.has(key)) distinctSeen.set(key, new Set());
        const seen = distinctSeen.get(key)!;
        const valStr = JSON.stringify(val);
        if (!seen.has(valStr)) {
          seen.add(valStr);
          if (typeof val === 'number') {
            if (!numericCache.has(key)) numericCache.set(key, []);
            const arr = numericCache.get(key);
            if (arr) arr.push(val);
          }
        }
      } else if (typeof val === 'number') {
        if (!numericCache.has(key)) numericCache.set(key, []);
        const arr = numericCache.get(key);
        if (arr) arr.push(val);
      }
    }
  }

  const allAggExprs = new Map<string, AggregationExpression>();
  aggrProjections.forEach((p) => { const aggs = collectAggregations(p.expression); aggs.forEach((agg) => { const aggKey = `${getAggKey(agg)}:${agg.aggregationType}:${agg.distinct}`; allAggExprs.set(aggKey, agg); }); });

  const aggResults = new Map<string, CypherValue>();
  allAggExprs.forEach((expr, aggKey) => {
    const key = getAggKey(expr);
    const numericValues = numericCache.get(key) ?? [];
    const nonNullCount = nonNullCache.get(key) ?? 0;

    if (expr.isStar) {
      // count(*) counts all rows
      aggResults.set(aggKey, rows.length);
    } else if (expr.isPattern) {
      // count((pattern)) — sum of pattern match counts across all rows in the group
      aggResults.set(aggKey, computePatternCount(rows, expr, evalExpr));
    } else if (expr.aggregationType === 'COUNT') {
      aggResults.set(aggKey, expr.distinct ? (distinctSeen.get(key)?.size ?? 0) : nonNullCount);
    } else if (expr.aggregationType === 'COLLECT') {
      const allValues = allValuesCache.get(key) ?? [];
      if (expr.distinct) {
        const seen = new Set<string>();
        const unique: CypherValue[] = [];
        for (const v of allValues) {
          const vStr = JSON.stringify(v);
          if (!seen.has(vStr)) { seen.add(vStr); unique.push(v); }
        }
        aggResults.set(aggKey, unique as unknown as CypherValue);
      } else {
        aggResults.set(aggKey, allValues as unknown as CypherValue);
      }
    } else if (expr.aggregationType === 'SUM') {
      aggResults.set(aggKey, numericValues.reduce((a, b) => a + b, 0));
    } else if (expr.aggregationType === 'AVG') {
      aggResults.set(aggKey, numericValues.length > 0 ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length : null);
    } else if (expr.aggregationType === 'MIN') {
      aggResults.set(aggKey, numericValues.length > 0 ? Math.min(...numericValues) : null);
    } else if (expr.aggregationType === 'MAX') {
      aggResults.set(aggKey, numericValues.length > 0 ? Math.max(...numericValues) : null);
    }
  });

  aggrProjections.forEach((p) => {
    if (p.expression.type === 'Aggregation') {
      const key = getAggKey(p.expression);
      const aggKey = `${key}:${p.expression.aggregationType}:${p.expression.distinct}`;
      newContext[p.alias] = aggResults.get(aggKey) ?? (p.expression.isStar ? 0 : null);
    } else if (p.expression.type === 'Reduce') {
      // Evaluate reduce expression with the group rows
      newContext[p.alias] = evalExprWithAgg(p.expression, newContext, aggResults);
    } else {
      newContext[p.alias] = evalExprWithAgg(p.expression, newContext, aggResults);
    }
  });

  return newContext;
}
