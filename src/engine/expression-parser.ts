import type {
  Expression,
  FunctionCallExpression,
  ListSliceExpression,
  ReduceExpression,
  QuantifierExpression,
  ExistsExpression,
  CypherLiteral,
  CypherValue,
  WhereExpression,
} from '../types/cypher';
import type { ParseTreeNode } from 'antlr4';
import { evaluateArithmeticCore } from '../arithmetic';
import {
  Ctx,
  AGGREGATION_FUNCTIONS,
  findPropertyLookup,
  findChild,
  findAllChildren,
  hasTerminal,
  getTerminalText,
  getSymbolicName,
  findArithmeticOperators,
  splitChildrenByOperators,
  findDescendant,
  unescapeStringLiteral,
} from './tree-utils';
import type { TreeNode } from './tree-utils';
import { extractPathExpression } from './pattern-parser';

// ── Arithmetic expression extraction ─────────────────────────────────────────

export function extractArithmeticExpression(exprCtx: TreeNode): Expression | undefined {
  if (!exprCtx) return undefined;

  let ctx: TreeNode = exprCtx;
  for (const wrapper of [Ctx.OrExpression, Ctx.XorExpression, Ctx.AndExpression, Ctx.NotExpression, Ctx.ComparisonExpression]) {
    const child = findChild(ctx, wrapper);
    if (child) ctx = child;
  }

  let addSubCtx = (ctx.constructor.name === Ctx.AddOrSubtractExpression) ? ctx : findChild(ctx, Ctx.AddOrSubtractExpression);
  if (addSubCtx && addSubCtx.children) {
    const addOps = findArithmeticOperators(addSubCtx).filter((o) => o.operator === '+' || o.operator === '-');
    if (addOps.length > 0) {
      const segments = splitChildrenByOperators(addSubCtx.children, addOps.map((o) => o.index));
      const operands = segments.map((seg) => extractArithmeticOperand(seg));
      if (operands.includes(undefined)) return undefined;
      const expressions = operands as Expression[];
      if (expressions.length >= 2) {
        let result: Expression = expressions[0]!;
        for (let i = 0; i < addOps.length && i < expressions.length - 1; i++) {
          result = { type: 'Arithmetic' as const, operator: addOps[i]!.operator, left: result, right: expressions[i + 1]! };
        }
        return result;
      }
    }
    if (addSubCtx !== ctx) {
      const inner = extractArithmeticExpression(addSubCtx);
      if (inner) return inner;
    }
  }

  let mulDivCtx = (ctx.constructor.name === Ctx.MultiplyDivideModuloExpression) ? ctx : findChild(ctx, Ctx.MultiplyDivideModuloExpression);
  if (mulDivCtx && mulDivCtx.children) {
    const mulOps = findArithmeticOperators(mulDivCtx).filter((o) => o.operator === '*' || o.operator === '/' || o.operator === '%');
    if (mulOps.length > 0) {
      const segments = splitChildrenByOperators(mulDivCtx.children, mulOps.map((o) => o.index));
      const operands = segments.map((seg) => extractArithmeticOperand(seg));
      if (operands.includes(undefined)) return undefined;
      const expressions = operands as Expression[];
      if (expressions.length >= 2) {
        let result: Expression = expressions[0]!;
        for (let i = 0; i < mulOps.length && i < expressions.length - 1; i++) {
          result = { type: 'Arithmetic' as const, operator: mulOps[i]!.operator, left: result, right: expressions[i + 1]! };
        }
        return result;
      }
    }
    if (mulDivCtx !== ctx) {
      const inner = extractArithmeticExpression(mulDivCtx);
      if (inner) return inner;
    }
  }

  let powCtx = (ctx.constructor.name === Ctx.PowerOfExpression) ? ctx : findChild(ctx, Ctx.PowerOfExpression);
  if (powCtx && powCtx.children) {
    const powOps = findArithmeticOperators(powCtx).filter((o) => o.operator === '^');
    if (powOps.length > 0) {
      const segments = splitChildrenByOperators(powCtx.children, powOps.map((o) => o.index));
      const operands = segments.map((seg) => extractArithmeticOperand(seg));
      if (operands.includes(undefined)) return undefined;
      const expressions = operands as Expression[];
      if (expressions.length >= 2) {
        let result: Expression = expressions[0]!;
        for (let i = 0; i < powOps.length && i < expressions.length - 1; i++) {
          result = { type: 'Arithmetic' as const, operator: powOps[i]!.operator, left: result, right: expressions[i + 1]! };
        }
        return result;
      }
    }
    if (powCtx !== ctx) {
      const inner = extractArithmeticExpression(powCtx);
      if (inner) return inner;
    }
  }

  const unaryCtx = findChild(ctx, Ctx.UnaryAddOrSubtractExpression);
  if (unaryCtx && unaryCtx.children && unaryCtx.children.length >= 2) {
    const firstChild = unaryCtx.children[0];
    if (firstChild && firstChild.constructor.name === Ctx.TerminalNode) {
      const op = firstChild.symbol?.text;
      if (op === '-' || op === '+') {
        const innerSeg = unaryCtx.children.slice(1).filter((c: ParseTreeNode) => {
          if (c.constructor.name === Ctx.TerminalNode) return c.symbol?.text && c.symbol.text.trim() !== '';
          return true;
        });
        if (innerSeg.length > 0) {
          const inner = extractArithmeticOperand(innerSeg);
          if (inner) {
            return { type: 'Arithmetic' as const, operator: op === '-' ? 'UNARY_MINUS' : 'UNARY_PLUS', left: undefined, right: inner };
          }
        }
      }
    }
  }

  return undefined;
}

export function extractArithmeticOperand(segment: ParseTreeNode[]): Expression | undefined {
  if (segment.length === 0) return undefined;
  const arith = extractArithmeticExpression(segment[0]);
  if (arith) return arith;
  const atom = getAtom(segment[0]);
  if (atom) {
    const base = evaluateExpressionFromAtom(atom, segment[0]);
    if (base) return base;
  }
  return undefined;
}

// ── Expression navigation ────────────────────────────────────────────────────

export function getAtom(exprCtx: TreeNode): ParseTreeNode | null {
  if (!exprCtx) return null;
  let currentLevel = [(exprCtx as ParseTreeNode)];
  while (currentLevel.length > 0) {
    const nextLevel: ParseTreeNode[] = [];
    for (const node of currentLevel) {
      if (node.constructor.name === Ctx.Atom) return node;
      if (node.children) {
        for (const child of node.children) {
          nextLevel.push(child as ParseTreeNode);
        }
      }
    }
    currentLevel = nextLevel;
  }
  return null;
}

export function findPropOrLabelsWithParent(ctx: TreeNode): { propOrLabels: ParseTreeNode; parent: ParseTreeNode } | undefined {
  if (!ctx) return undefined;
  const walk = (node: ParseTreeNode, parent: ParseTreeNode | null): { propOrLabels: ParseTreeNode; parent: ParseTreeNode } | undefined => {
    if (node.constructor.name === Ctx.PropertyOrLabelsExpression && parent) {
      return { propOrLabels: node, parent };
    }
    if (node.children) {
      for (const child of node.children) {
        const found = walk(child, node);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(ctx as ParseTreeNode, null);
}

export function evaluateSliceIndex(exprCtx: TreeNode): Expression | undefined {
  if (!exprCtx) return undefined;

  const unaryCtx = findDescendant(exprCtx, Ctx.UnaryAddOrSubtractExpression);
  if (unaryCtx && unaryCtx.children) {
    const children = unaryCtx.children;
    if (children[0]?.constructor.name === 'TerminalNodeImpl' && children[0]?.symbol?.text === '-') {
      const innerExprCtx = children[1];
      const innerExpr = evaluateExpression(innerExprCtx);
      if (innerExpr && innerExpr.type === 'Literal' && typeof innerExpr.value === 'number') {
        return { type: 'Literal' as const, value: -innerExpr.value };
      }
    }
  }

  return evaluateExpression(exprCtx);
}

export function extractListSlice(parentCtx: ParseTreeNode): ListSliceExpression | undefined {
  if (!parentCtx.children) return undefined;
  const children = parentCtx.children;

  let propIdx = -1;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child && child.constructor.name === Ctx.PropertyOrLabelsExpression) {
      propIdx = i;
      break;
    }
  }
  if (propIdx < 0) return undefined;

  const bracketOpen = children[propIdx + 1];
  if (!bracketOpen || bracketOpen.constructor.name !== 'TerminalNodeImpl' || bracketOpen.symbol?.text !== '[') {
    return undefined;
  }

  const propOrLabelsCtx = children[propIdx];
  const baseExpr = extractValueExpressionFromPropertyOrLabels(propOrLabelsCtx);
  if (!baseExpr) return undefined;

  const afterBracket = children[propIdx + 2];
  if (!afterBracket) return undefined;

  if (afterBracket.constructor.name === 'TerminalNodeImpl' && afterBracket.symbol?.text === '..') {
    const endExprCtx = children[propIdx + 3];
    const endExpr = endExprCtx ? evaluateSliceIndex(endExprCtx) : undefined;
    return {
      type: 'ListSlice' as const,
      list: baseExpr,
      start: { type: 'Literal' as const, value: null as CypherLiteral },
      end: endExpr ?? { type: 'Literal' as const, value: null as CypherLiteral },
    };
  }

  const startExpr = evaluateSliceIndex(afterBracket);
  if (!startExpr) return undefined;

  const dotDot = children[propIdx + 3];
  if (dotDot && dotDot.constructor.name === 'TerminalNodeImpl' && dotDot.symbol?.text === '..') {
    const endExprCtx = children[propIdx + 4];
    const endExpr = endExprCtx ? evaluateSliceIndex(endExprCtx) : undefined;
    return {
      type: 'ListSlice' as const,
      list: baseExpr,
      start: startExpr,
      end: endExpr ?? { type: 'Literal' as const, value: null as CypherLiteral },
    };
  }

  return {
    type: 'ListSlice' as const,
    list: baseExpr,
    start: startExpr,
    end: startExpr,
  };
}

/**
 * Detect `count(*)` pattern in an Atom context.
 * The ANTLR grammar parses `count(*)` as an Atom with terminals `count`, `(`, `*`, `)`
 * (no FunctionInvocation because `*` is not a valid expression argument).
 */
function extractCountStar(atom: TreeNode): Expression | undefined {
  if (!atom || !atom.children) return undefined;

  const terminals = atom.children.filter((c: ParseTreeNode) =>
    c.constructor.name === Ctx.TerminalNode && c.symbol?.text && c.symbol.text.trim() !== ''
  );

  if (terminals.length >= 3) {
    const texts = terminals.map((c: ParseTreeNode) => c.symbol!.text.trim().toLowerCase());
    // Look for pattern: count, (, *, )
    for (let i = 0; i < texts.length - 2; i++) {
      if (texts[i] === 'count' && texts[i + 1] === '(' && texts[i + 2] === '*') {
        return {
          type: 'Aggregation' as const,
          aggregationType: 'COUNT' as const,
          variable: '*',
          property: undefined,
          distinct: false,
          isStar: true,
        };
      }
    }
  }
  return undefined;
}

/**
 * Extract a `reduce(initial, var IN list | body)` expression from a ReduceFunction context.
 */
function extractReduceExpression(reduceCtx: TreeNode): ReduceExpression | undefined {
  if (!reduceCtx || !reduceCtx.children) return undefined;

  const children = reduceCtx.children;

  // Find the accumulator variable (first Variable in the context)
  const accVarCtx = findChild(reduceCtx, Ctx.Variable);
  const accumulator = accVarCtx ? getSymbolicName(accVarCtx) : undefined;
  if (!accumulator) return undefined;

  // Find the initial value expression (first Expression after the `=` sign)
  const eqIndex = children.findIndex((c: ParseTreeNode) =>
    c.constructor.name === Ctx.TerminalNode && c.symbol?.text === '='
  );
  if (eqIndex === -1) return undefined;

  // The initial expression is the first ExpressionContext after the `=`
  let initialExpr: Expression | undefined;
  for (let i = eqIndex + 1; i < children.length; i++) {
    const child = children[i];
    if (child && child.constructor.name === Ctx.Expression) {
      initialExpr = evaluateExpression(child);
      break;
    }
  }
  if (!initialExpr) return undefined;

  // Find the IdInColl context (var IN list)
  const idInCollCtx = findChild(reduceCtx, Ctx.IdInColl);
  if (!idInCollCtx || !idInCollCtx.children) return undefined;

  // Extract loop variable and list expression from IdInColl
  const loopVarCtx = findChild(idInCollCtx, Ctx.Variable);
  const loopVariable = loopVarCtx ? getSymbolicName(loopVarCtx) : undefined;
  if (!loopVariable) return undefined;

  const listExprCtx = findChild(idInCollCtx, Ctx.Expression);
  const listExpr = listExprCtx ? evaluateExpression(listExprCtx) : undefined;
  if (!listExpr) return undefined;

  // Find the body expression (after the `|` pipe)
  const pipeIndex = children.findIndex((c: ParseTreeNode) =>
    c.constructor.name === Ctx.TerminalNode && c.symbol?.text === '|'
  );
  if (pipeIndex === -1) return undefined;

  let bodyExpr: Expression | undefined;
  for (let i = pipeIndex + 1; i < children.length; i++) {
    const child = children[i];
    if (child && child.constructor.name === Ctx.Expression) {
      bodyExpr = evaluateExpression(child);
      break;
    }
  }
  if (!bodyExpr) return undefined;

  return {
    type: 'Reduce' as const,
    accumulator,
    initial: initialExpr,
    loopVariable,
    list: listExpr,
    body: bodyExpr,
  };
}

/**
 * Extract a quantifier expression: ALL/ANY/SINGLE/NONE(x IN list WHERE predicate).
 */
export function extractQuantifierExpression(
  atom: TreeNode,
  extractWhere?: (ctx: TreeNode) => WhereExpression | undefined,
): QuantifierExpression | undefined {
  if (!atom) return undefined;

  const quantifierMap: Array<{ contextName: string; quantifierType: 'ALL' | 'ANY' | 'SINGLE' | 'NONE' }> = [
    { contextName: Ctx.AllFunction, quantifierType: 'ALL' },
    { contextName: Ctx.AnyFunction, quantifierType: 'ANY' },
    { contextName: Ctx.SingleFunction, quantifierType: 'SINGLE' },
    { contextName: Ctx.NoneFunction, quantifierType: 'NONE' },
  ];

  for (const { contextName, quantifierType } of quantifierMap) {
    const quantifierCtx = findChild(atom, contextName);
    if (!quantifierCtx) continue;

    // Find the FilterExpression child (contains IdInColl + Where)
    const filterExprCtx = findChild(quantifierCtx, Ctx.FilterExpression);
    if (!filterExprCtx) continue;

    // Extract loop variable and list from IdInColl
    const idInCollCtx = findChild(filterExprCtx, Ctx.IdInColl);
    if (!idInCollCtx) continue;

    const loopVarCtx = findChild(idInCollCtx, Ctx.Variable);
    const loopVariable = loopVarCtx ? getSymbolicName(loopVarCtx) : undefined;
    if (!loopVariable) continue;

    const listExprCtx = findChild(idInCollCtx, Ctx.Expression);
    const listExpr = listExprCtx ? evaluateExpression(listExprCtx) : undefined;
    if (!listExpr) continue;

    // Extract WHERE predicate
    const whereCtx = findChild(filterExprCtx, Ctx.Where);
    if (!whereCtx || !extractWhere) continue;

    const whereExprCtx = findChild(whereCtx, Ctx.Expression);
    const predicate = whereExprCtx ? extractWhere(whereExprCtx) : undefined;
    if (!predicate) continue;

    return {
      type: 'Quantifier' as const,
      quantifierType,
      loopVariable,
      list: listExpr,
      predicate,
    };
  }

  return undefined;
}

/**
 * Extract an EXISTS(expression) expression.
 */
export function extractExistsExpression(atom: TreeNode): ExistsExpression | undefined {
  if (!atom) return undefined;

  const existsCtx = findChild(atom, Ctx.ExistsFunction);
  if (!existsCtx) return undefined;

  const exprCtx = findChild(existsCtx, Ctx.Expression);
  const innerExpr = exprCtx ? evaluateExpression(exprCtx) : undefined;
  if (!innerExpr) return undefined;

  return {
    type: 'Exists' as const,
    expression: innerExpr,
  };
}

/**
 * Evaluate an expression from an Atom context (without slice detection).
 * Optional `extractWhere` callback is used for CASE expressions.
 */
export function evaluateExpressionFromAtom(
  atom: TreeNode,
  fullCtx?: TreeNode,
  extractWhere?: (ctx: TreeNode) => WhereExpression | undefined,
): Expression | undefined {
  if (!atom) return undefined;

  const parenCtx = findChild(atom, Ctx.ParenthesizedExpression);
  if (parenCtx) {
    const innerExpr = findChild(parenCtx, Ctx.Expression);
    if (innerExpr) return evaluateExpression(innerExpr);
  }

  const spCtx = findChild(atom, Ctx.ShortestPathPatternFunction);
  if (spCtx) {
    const pathExpr = extractPathExpression(spCtx);
    if (pathExpr) return pathExpr;
  }

  const reduceCtx = findChild(atom, Ctx.ReduceFunction);
  if (reduceCtx) {
    const reduceExpr = extractReduceExpression(reduceCtx);
    if (reduceExpr) return reduceExpr;
  }

  // Quantifier functions: ALL, ANY, SINGLE, NONE
  const quantifierExpr = extractQuantifierExpression(atom, extractWhere);
  if (quantifierExpr) return quantifierExpr;

  // EXISTS function
  const existsExpr = extractExistsExpression(atom);
  if (existsExpr) return existsExpr;

  const funcCtx = findChild(atom, Ctx.FunctionInvocation);
  if (funcCtx) {
    const bodyCtx = findChild(funcCtx, Ctx.FunctionInvocationBody);
    const funcNameCtx = findChild(bodyCtx, Ctx.FunctionName);
    const funcName = getTerminalText(funcNameCtx);

    const argExpr = findChild(funcCtx, Ctx.Expression);
    const argAtom = getAtom(argExpr ?? undefined);
    const argVar = argAtom ? findChild(argAtom, Ctx.Variable) : null;
    const argName = getSymbolicName(argVar);

    let argProperty: string | undefined;
    if (argAtom) {
      const propLookup = findChild(argAtom, Ctx.PropertyLookup);
      if (!propLookup) {
        const parentPropLookup = findPropertyLookup(argExpr);
        if (parentPropLookup) {
          const pkCtx = findChild(parentPropLookup, Ctx.PropertyKey);
          argProperty = getSymbolicName(pkCtx);
        }
      } else {
        const pkCtx = findChild(propLookup, Ctx.PropertyKey);
        argProperty = getSymbolicName(pkCtx);
      }
    }

    const hasDistinct = hasTerminal(funcCtx, 'DISTINCT');

    if (funcName && argName && AGGREGATION_FUNCTIONS.has(funcName.toLowerCase())) {
      return {
        type: 'Aggregation' as const,
        aggregationType: funcName.toUpperCase() as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COLLECT',
        variable: argName,
        property: argProperty,
        distinct: !!hasDistinct,
      };
    }

    if (funcName) {
      const funcCall = extractFunctionCall(funcCtx, funcName);
      if (funcCall) return funcCall;
    }
  }

  // Detect `count(*)` — parsed as Atom with terminals `count`, `(`, `*`, `)` (no FunctionInvocation)
  const countStarExpr = extractCountStar(atom);
  if (countStarExpr) return countStarExpr;

  const caseCtx = findChild(atom, Ctx.CaseExpression);
  if (caseCtx && extractWhere) {
    const caseExpr = extractCaseExpression(caseCtx, extractWhere);
    if (caseExpr) return caseExpr;
  }

  const varCtx = findChild(atom, Ctx.Variable);
  if (varCtx) {
    const name = getSymbolicName(varCtx);
    if (name) {
      const propLookup = findPropertyLookup(fullCtx ?? atom);
      if (propLookup) {
        const propName = getSymbolicName(findChild(propLookup, Ctx.PropertyKey));
        if (propName) {
          return { type: 'PropertyAccess' as const, variable: name, property: propName };
        }
      }
      return { type: 'PropertyAccess' as const, variable: name, property: undefined };
    }
  }

  const literalCtx = findChild(atom, Ctx.Literal);
  if (literalCtx) {
    const mapLitCtx = findChild(literalCtx, Ctx.MapLiteral);
    if (mapLitCtx) {
      const mapExpr = extractMapLiteralExpressionFromCtx(mapLitCtx);
      if (mapExpr) return mapExpr;
    }
    const listLitCtx = findChild(literalCtx, Ctx.ListLiteral);
    if (listLitCtx) {
      const listExpr = extractListLiteralExpressionFromCtx(listLitCtx);
      if (listExpr) return listExpr;
    }
    const literal = extractLiteral(literalCtx);
    if (literal) return literal;
  }

  return undefined;
}

export function evaluateExpression(
  exprCtx: TreeNode,
  extractWhere?: (ctx: TreeNode) => WhereExpression | undefined,
): Expression | undefined {
  if (!exprCtx) return undefined;

  const withParent = findPropOrLabelsWithParent(exprCtx);
  if (withParent) {
    const slice = extractListSlice(withParent.parent);
    if (slice) return slice;
  }

  const arith = extractArithmeticExpression(exprCtx);
  if (arith) return arith;

  const atom = getAtom(exprCtx);
  if (!atom) return undefined;

  return evaluateExpressionFromAtom(atom, exprCtx, extractWhere);
}

// ── Literal extraction ───────────────────────────────────────────────────────

export function extractLiteral(literalCtx: TreeNode): Expression | undefined {
  if (!literalCtx) return undefined;

  const stringLit = findChild(literalCtx, Ctx.StringLiteral);
  if (stringLit) {
    const raw = getTerminalText(stringLit);
    if (raw) return { type: 'Literal' as const, value: unescapeStringLiteral(raw) as CypherLiteral };
  }

  const numLit = findChild(literalCtx, Ctx.NumberLiteral);
  if (numLit) {
    const intLit = findChild(numLit, Ctx.IntegerLiteral);
    if (intLit) {
      const text = getTerminalText(intLit);
      if (text) return { type: 'Literal' as const, value: parseInt(text, 10) as CypherLiteral };
    }
    const floatLit = findChild(numLit, Ctx.FloatLiteral);
    if (floatLit) {
      const text = getTerminalText(floatLit);
      if (text) return { type: 'Literal' as const, value: parseFloat(text) as CypherLiteral };
    }
  }

  const boolLit = findChild(literalCtx, Ctx.BooleanLiteral);
  if (boolLit) {
    const text = getTerminalText(boolLit);
    if (text === 'true') return { type: 'Literal' as const, value: true as CypherLiteral };
    if (text === 'false') return { type: 'Literal' as const, value: false as CypherLiteral };
  }

  if (hasTerminal(literalCtx, 'null') || hasTerminal(literalCtx, 'NULL')) {
    return { type: 'Literal' as const, value: null as CypherLiteral };
  }

  return undefined;
}

// ── Pseudo-procedure call extraction ─────────────────────────────────────────

const PSEUDO_PROCEDURE_NAMES = new Set(['labels', 'nodes', 'relationships']);

export function extractPseudoProcedureCall(procCtx: TreeNode): FunctionCallExpression | undefined {
  if (!procCtx) return undefined;

  const bodyCtx = findChild(procCtx, Ctx.ProcedureInvocationBody);
  const procNameCtx = findChild(bodyCtx, Ctx.ProcedureName);
  const procName = procNameCtx ? getSymbolicName(procNameCtx) : undefined;

  if (!procName || !PSEUDO_PROCEDURE_NAMES.has(procName.toLowerCase())) return undefined;

  const argExprs: Expression[] = [];
  const procArgsCtx = findChild(procCtx, Ctx.ProcedureArguments);
  if (procArgsCtx && procArgsCtx.children) {
    for (const child of procArgsCtx.children) {
      if (child.constructor.name === Ctx.Expression) {
        const expr = evaluateExpression(child);
        if (expr) argExprs.push(expr);
      }
    }
  }

  if (argExprs.length === 0) return undefined;

  return {
    type: 'FunctionCall' as const,
    functionName: procName.toLowerCase(),
    arguments: argExprs,
  };
}

// ── Function call extraction ─────────────────────────────────────────────────

export function extractFunctionCall(funcCtx: TreeNode, funcName: string): FunctionCallExpression | undefined {
  if (!funcCtx) return undefined;

  const argExpressions: Expression[] = [];
  const children = funcCtx.children;
  if (!children) return undefined;

  for (const child of children) {
    if (child.constructor.name === Ctx.Expression) {
      const expr = evaluateExpression(child);
      if (expr && expr.type !== 'Aggregation') {
        argExpressions.push(expr);
      }
    }
  }

  if (argExpressions.length === 0) return undefined;

  return {
    type: 'FunctionCall' as const,
    functionName: funcName.toLowerCase(),
    arguments: argExpressions,
  };
}

// ── CASE expression extraction ──────────────────────────────────────────────

export function extractCaseExpression(
  caseCtx: TreeNode,
  extractWhere: (ctx: TreeNode) => WhereExpression | undefined,
): Expression | undefined {
  if (!caseCtx || !caseCtx.children) return undefined;

  // Create a bound evaluateExpr that preserves extractWhere for nested CASE expressions
  const evaluateExpr = (ctx: TreeNode) => evaluateExpression(ctx, extractWhere);

  const children = caseCtx.children;
  const branches: { condition: Expression | WhereExpression; result: Expression }[] = [];
  let subject: Expression | undefined;
  let elseResult: Expression | undefined;

  let startIndex = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;
    if (child.constructor.name === Ctx.TerminalNode) {
      if (child.symbol?.text === 'CASE') continue;
      if (child.symbol?.text && child.symbol.text.trim() === '') continue;
      break;
    }
    if (child.constructor.name === Ctx.Expression) {
      const subjectExpr = evaluateExpr(child);
      if (subjectExpr) subject = subjectExpr;
      startIndex = i + 1;
      break;
    }
    break;
  }

  const alternatives = findAllChildren(caseCtx, Ctx.CaseAlternatives);
  for (const alt of alternatives) {
    const exprChildren = findAllChildren(alt, Ctx.Expression);
    if (exprChildren.length < 2) continue;

    const result = evaluateExpr(exprChildren[1]);
    if (!result) continue;

    let condition: Expression | WhereExpression;
    if (subject) {
      const condExpr = evaluateExpr(exprChildren[0]);
      if (!condExpr) continue;
      condition = condExpr;
    } else {
      const condWhere = extractWhere(exprChildren[0]);
      if (condWhere) {
        condition = condWhere;
      } else {
        const condExpr = evaluateExpr(exprChildren[0]);
        if (!condExpr) continue;
        condition = condExpr;
      }
    }

    branches.push({ condition, result });
  }

  let foundElse = false;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;
    if (child.constructor.name === Ctx.TerminalNode && child.symbol?.text === 'ELSE') {
      foundElse = true;
      for (let j = i + 1; j < children.length; j++) {
        const nextChild = children[j];
        if (!nextChild) continue;
        if (nextChild.constructor.name === Ctx.Expression) {
          elseResult = evaluateExpr(nextChild);
          break;
        }
      }
      break;
    }
  }

  if (branches.length === 0 && !elseResult) return undefined;

  return { type: 'Case' as const, subject, branches, elseResult };
}

// ── Value expression extraction (for WHERE operands) ────────────────────────

export function extractListLiteralExpressionFromCtx(listLitCtx: ParseTreeNode): Expression | undefined {
  const listExprs = findAllChildren(listLitCtx, Ctx.Expression);
  const values: Expression[] = [];
  for (const le of listExprs) {
    const val = evaluateExpression(le);
    if (val) values.push(val);
  }
  return { type: 'ListLiteral' as const, values };
}

export function extractMapLiteralExpressionFromCtx(mapLitCtx: ParseTreeNode): Expression | undefined {
  const entries = findAllChildren(mapLitCtx, Ctx.LiteralEntry);
  const result: { key: string; value: Expression }[] = [];
  for (const entry of entries) {
    const keyCtx = findChild(entry, Ctx.PropertyKey);
    const key = getSymbolicName(keyCtx);
    const exprCtx = findChild(entry, Ctx.Expression);
    const valueExpr = evaluateExpression(exprCtx);

    if (key && valueExpr) {
      result.push({ key, value: valueExpr });
    }
  }
  return { type: 'MapLiteral' as const, entries: result };
}

export function extractValueExpressionFromPropertyOrLabels(ctx: TreeNode): Expression | undefined {
  if (!ctx) return undefined;

  const atom = getAtom(ctx);
  if (!atom) return undefined;

  const varCtx = findChild(atom, Ctx.Variable);
  if (varCtx) {
    const name = getSymbolicName(varCtx);
    if (name) {
      const propLookup = findPropertyLookup(ctx);
      if (propLookup) {
        const propName = getSymbolicName(findChild(propLookup, Ctx.PropertyKey));
        if (propName) {
          return { type: 'PropertyAccess' as const, variable: name, property: propName };
        }
      }
      return { type: 'PropertyAccess' as const, variable: name, property: undefined };
    }
  }

  const funcCtx = findChild(atom, Ctx.FunctionInvocation);
  if (funcCtx) {
    const bodyCtx = findChild(funcCtx, Ctx.FunctionInvocationBody);
    const funcNameCtx = findChild(bodyCtx, Ctx.FunctionName);
    const funcName = getTerminalText(funcNameCtx);
    if (funcName) {
      const funcCall = extractFunctionCall(funcCtx, funcName);
      if (funcCall) return funcCall;
    }
  }

  const literalCtx = findChild(atom, Ctx.Literal);
  if (literalCtx) {
    const mapLitCtx = findChild(literalCtx, Ctx.MapLiteral);
    if (mapLitCtx) {
      const mapExpr = extractMapLiteralExpressionFromCtx(mapLitCtx);
      if (mapExpr) return mapExpr;
    }
    const listLitCtx = findChild(literalCtx, Ctx.ListLiteral);
    if (listLitCtx) {
      const listExpr = extractListLiteralExpressionFromCtx(listLitCtx);
      if (listExpr) return listExpr;
    }
    return extractLiteral(literalCtx);
  }
  return undefined;
}

export function extractValueExpression(ctx: TreeNode): Expression | undefined {
  if (!ctx) return undefined;

  const withParent = findPropOrLabelsWithParent(ctx);
  if (withParent) {
    const slice = extractListSlice(withParent.parent);
    if (slice) return slice;
  }

  const arith = extractArithmeticExpression(ctx);
  if (arith) return arith;

  const atom = getAtom(ctx);
  if (!atom) return undefined;

  const varCtx = findChild(atom, Ctx.Variable);
  if (varCtx) {
    const name = getSymbolicName(varCtx);
    if (name) {
      const propLookup = findPropertyLookup(ctx);
      if (propLookup) {
        const propName = getSymbolicName(findChild(propLookup, Ctx.PropertyKey));
        if (propName) {
          return { type: 'PropertyAccess' as const, variable: name, property: propName };
        }
      }
      return { type: 'PropertyAccess' as const, variable: name, property: undefined };
    }
  }

  const funcCtx = findChild(atom, Ctx.FunctionInvocation);
  if (funcCtx) {
    const bodyCtx = findChild(funcCtx, Ctx.FunctionInvocationBody);
    const funcNameCtx = findChild(bodyCtx, Ctx.FunctionName);
    const funcName = getTerminalText(funcNameCtx);
    if (funcName) {
      const funcCall = extractFunctionCall(funcCtx, funcName);
      if (funcCall) return funcCall;
    }
  }

  const literalCtx = findChild(atom, Ctx.Literal);
  if (literalCtx) {
    const mapLitCtx = findChild(literalCtx, Ctx.MapLiteral);
    if (mapLitCtx) {
      const mapExpr = extractMapLiteralExpressionFromCtx(mapLitCtx);
      if (mapExpr) return mapExpr;
    }
    const listLitCtx = findChild(literalCtx, Ctx.ListLiteral);
    if (listLitCtx) {
      const listExpr = extractListLiteralExpressionFromCtx(listLitCtx);
      if (listExpr) return listExpr;
    }
    return extractLiteral(literalCtx);
  }
  return undefined;
}
