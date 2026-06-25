import type { ArithmeticExpression, CypherValue, Expression } from './types/cypher';

/**
 * Core arithmetic evaluation shared between parser (static) and engine (runtime).
 * 
 * @param expr - Arithmetic expression to evaluate
 * @param evalOperand - Function to evaluate operand expressions
 * @returns Evaluated numeric value, or null for null operands / division by zero
 */
export function evaluateArithmeticCore(
  expr: ArithmeticExpression,
  evalOperand: (e: Expression) => CypherValue | undefined,
): CypherValue {
  const rightVal = evalOperand(expr.right);
  if (rightVal == null) return null;

  // Unary operators
  if (expr.operator === 'UNARY_MINUS') {
    const num = Number(rightVal);
    return Number.isFinite(num) ? -num : null;
  }
  if (expr.operator === 'UNARY_PLUS') {
    const num = Number(rightVal);
    return Number.isFinite(num) ? num : null;
  }

  const leftVal = expr.left ? evalOperand(expr.left) : 0;
  if (leftVal == null) return null;

  // Support string concatenation for + operator (check before numeric conversion)
  if (expr.operator === '+' && typeof leftVal === 'string' && typeof rightVal === 'string') {
    return leftVal + rightVal;
  }

  const left = Number(leftVal);
  const right = Number(rightVal);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;

  switch (expr.operator) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/': return right === 0 ? null : left / right;
    case '%': return right === 0 ? null : left % right;
    case '^': return Math.pow(left, right);
    default: return null;
  }
}
