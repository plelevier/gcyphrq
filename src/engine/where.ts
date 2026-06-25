import type { CypherValue, Expression, WhereExpression, BinaryExpression, IsNullExpression, LogicalExpression, NotExpression, OrderByItem, QueryContext } from '../types/cypher';

/**
 * Evaluate a WHERE expression against a context.
 */
export function evaluateWhere(
  whereNode: WhereExpression,
  evalExpr: (e: Expression) => CypherValue,
  extractList: (e: Expression) => CypherValue[],
  mapsEq: (a: CypherValue, b: CypherValue) => boolean,
): boolean {
  return evaluateWhereCore(whereNode, evalExpr, extractList, mapsEq);
}

export function evaluateWhereCore(
  whereNode: WhereExpression,
  evalExpr: (e: Expression) => CypherValue,
  extractList: (e: Expression) => CypherValue[],
  mapsEqual: (a: CypherValue, b: CypherValue) => boolean,
): boolean {
  if (whereNode.type === 'LogicalExpression') {
    const left = evaluateWhereCore(whereNode.left, evalExpr, extractList, mapsEqual);
    const right = evaluateWhereCore(whereNode.right, evalExpr, extractList, mapsEqual);
    if (whereNode.operator === 'AND') return left && right;
    if (whereNode.operator === 'OR') return left || right;
    return false;
  }
  if (whereNode.type === 'NotExpression') {
    return !evaluateWhereCore(whereNode.expression, evalExpr, extractList, mapsEqual);
  }
  if (whereNode.type === 'IsNull') {
    const value = evalExpr(whereNode.expression);
    const isNull = value === null || value === undefined;
    return whereNode.negated ? !isNull : isNull;
  }
  if (whereNode.type === 'Quantifier') {
    const value = evalExpr(whereNode);
    return !!value;
  }
  if (whereNode.type === 'Exists') {
    const value = evalExpr(whereNode);
    return !!value;
  }

  // BinaryExpression
  const leftValue = evalExpr(whereNode.left);
  const rightValue = evalExpr(whereNode.right);
  if (leftValue == null || rightValue == null) return false;
  switch (whereNode.operator) {
    case '=':
      if (leftValue === rightValue) return true;
      return mapsEqual(leftValue, rightValue);
    case '>':
      if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue > rightValue;
      if (typeof leftValue === 'string' && typeof rightValue === 'string') return leftValue > rightValue;
      throw new Error(`WHERE comparison "${whereNode.operator}" requires numeric or string values, got ${JSON.stringify(leftValue)} and ${JSON.stringify(rightValue)}`);
    case '>=':
      if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue >= rightValue;
      if (typeof leftValue === 'string' && typeof rightValue === 'string') return leftValue >= rightValue;
      throw new Error(`WHERE comparison "${whereNode.operator}" requires numeric or string values, got ${JSON.stringify(leftValue)} and ${JSON.stringify(rightValue)}`);
    case '<':
      if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue < rightValue;
      if (typeof leftValue === 'string' && typeof rightValue === 'string') return leftValue < rightValue;
      throw new Error(`WHERE comparison "${whereNode.operator}" requires numeric or string values, got ${JSON.stringify(leftValue)} and ${JSON.stringify(rightValue)}`);
    case '<=':
      if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue <= rightValue;
      if (typeof leftValue === 'string' && typeof rightValue === 'string') return leftValue <= rightValue;
      throw new Error(`WHERE comparison "${whereNode.operator}" requires numeric or string values, got ${JSON.stringify(leftValue)} and ${JSON.stringify(rightValue)}`);
    case '<>':
      if (leftValue === rightValue) return false;
      return !mapsEqual(leftValue, rightValue);
    case 'CONTAINS': return String(leftValue).includes(String(rightValue));
    case 'STARTS WITH': return String(leftValue).startsWith(String(rightValue));
    case 'ENDS WITH': return String(leftValue).endsWith(String(rightValue));
    case 'IN': {
      const rightList = extractList(whereNode.right);
      for (const item of rightList) { if (item === leftValue || mapsEqual(leftValue, item)) return true; }
      return false;
    }
    default: return false;
  }
}

/** Check if a value is a valid WhereExpression (including quantifier/exists expressions). */
export function isWhereExpression(value: Expression | WhereExpression): value is WhereExpression {
  return value.type === 'BinaryExpression' || value.type === 'LogicalExpression' || value.type === 'NotExpression' || value.type === 'IsNull' || value.type === 'Quantifier' || value.type === 'Exists';
}

/** Extract list values from expression. */
export function extractListValues(expr: Expression, evalExpr: (e: Expression) => CypherValue): CypherValue[] {
  if (expr.type === 'ListLiteral') {
    const values: CypherValue[] = [];
    for (const le of expr.values) { values.push(evalExpr(le) as CypherValue); }
    return values;
  }
  if (expr.type === 'Literal') return [expr.value];
  if (expr.type === 'PropertyAccess' || expr.type === 'FunctionCall' || expr.type === 'Case') {
    const val = evalExpr(expr);
    if (Array.isArray(val)) return val;
    if (val !== undefined && val !== null) return [val as CypherValue];
    return [];
  }
  return [];
}

/** Check if two values match for WHERE comparison. */
export function mapsEqual(left: CypherValue, right: CypherValue, selfMapsEqual: (a: CypherValue, b: CypherValue) => boolean): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) { if (!selfMapsEqual(left[i] as CypherValue, right[i] as CypherValue)) return false; }
    }
    return true;
  }
  const leftMap = typeof left === 'object' && left !== null && !Array.isArray(left) ? left : undefined;
  const rightMap = typeof right === 'object' && right !== null && !Array.isArray(right) ? right : undefined;
  if (!leftMap || !rightMap) return false;
  const rightKeys = Object.keys(rightMap);
  if (rightKeys.length === 0) return true;
  for (const key of rightKeys) {
    const lv = (leftMap as Record<string, unknown>)[key];
    const rv = (rightMap as Record<string, unknown>)[key];
    if (lv === undefined) return false;
    if (lv !== rv) { if (!selfMapsEqual(lv as CypherValue, rv as CypherValue)) return false; }
  }
  return true;
}

/** Compare two values for sorting. */
export function compareValues(a: CypherValue | undefined, b: CypherValue | undefined): number {
  if (a === null || a === undefined) { if (b === null || b === undefined) return 0; return -1; }
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : (a ? -1 : 1);
  const aStr = String(a);
  const bStr = String(b);
  return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
}

/** Apply ORDER BY to flat result rows. */
export function applyOrderByToRows(
  rows: Record<string, CypherValue>[],
  orderBy: OrderByItem[],
  evalExpr: (e: Expression, ctx: QueryContext) => CypherValue,
): Record<string, CypherValue>[] {
  const keyed = rows.map((row) => {
    const ctx: QueryContext = {};
    for (const [key, val] of Object.entries(row)) ctx[key] = val;
    return { row, keys: orderBy.map((item) => evalExpr(item.expression, ctx)) };
  });

  keyed.sort((a, b) => {
    for (let i = 0; i < orderBy.length; i++) {
      const cmp = compareValues(a.keys[i], b.keys[i]);
      const item = orderBy[i];
      if (cmp !== 0 && item) return item.direction === 'DESC' ? -cmp : cmp;
    }
    return 0;
  });

  return keyed.map((k) => k.row);
}

/** Apply ORDER BY to context array. */
export function applyOrderByToContexts(
  contexts: QueryContext[],
  orderBy: OrderByItem[],
  evalExpr: (e: Expression, ctx: QueryContext) => CypherValue,
): QueryContext[] {
  const keyed = contexts.map((ctx) => ({ ctx, keys: orderBy.map((item) => evalExpr(item.expression, ctx)) }));

  keyed.sort((a, b) => {
    for (let i = 0; i < orderBy.length; i++) {
      const cmp = compareValues(a.keys[i], b.keys[i]);
      const item = orderBy[i];
      if (cmp !== 0 && item) return item.direction === 'DESC' ? -cmp : cmp;
    }
    return 0;
  });

  return keyed.map((k) => k.ctx);
}
