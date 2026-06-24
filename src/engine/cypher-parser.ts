import { createRequire } from 'module';
import { evaluateArithmeticCore } from '../arithmetic';
import type {
  AdvancedCypherAST,
  UnionQueryAST,
  UnionType,
  CypherAST,
  FunctionCallExpression,
  LabelExpression,
  ListSliceExpression,
  MatchClause,
  MergeClause,
  MergeAction,
  MergeSetAction,
  NodePattern,
  OrderByItem,
  RelationPattern,
  Direction,
  WithClause,
  WriteClause,
  UnwindClause,
  ForeachClause,
  Expression,
  BinaryExpression,
  ListLiteralExpression,
  MapLiteralExpression,
  WhereExpression,
  IsNullExpression,
  ReturnClause,
  CypherLiteral,
  CypherValue,
  Projection,
  RemoveClause,
  RemoveItem,
} from '../types/cypher';
import type { ParseTreeNode, RecognitionException, BaseErrorListener } from 'antlr4';

const _require = createRequire(import.meta.url);
const antlr4 = _require('antlr4').default;
const { CypherLexer, CypherParser } = _require('@neo4j-cypher/antlr4');

// ── Context name constants ───────────────────────────────────────────────────
// Centralised so a typo or ANTLR4 rename is caught at one site.
// Each constant is validated at module load against the actual parser classes.
const Ctx = {
  Atom: 'AtomContext',
  AddOrSubtractExpression: 'AddOrSubtractExpressionContext',
  AndExpression: 'AndExpressionContext',
  MultiplyDivideModuloExpression: 'MultiplyDivideModuloExpressionContext',
  PowerOfExpression: 'PowerOfExpressionContext',
  BooleanLiteral: 'BooleanLiteralContext',
  AnonymousPatternPart: 'AnonymousPatternPartContext',
  Clause: 'ClauseContext',
  ComparisonExpression: 'ComparisonExpressionContext',
  CreateClause: 'CreateClauseContext',
  CypherQuery: 'CypherQueryContext',
  DeleteClause: 'DeleteClauseContext',
  Expression: 'ExpressionContext',
  FloatLiteral: 'FloatLiteralContext',
  FunctionInvocation: 'FunctionInvocationContext',
  FunctionInvocationBody: 'FunctionInvocationBodyContext',
  FunctionName: 'FunctionNameContext',
  Func: 'FuncContext',
  ProcedureInvocation: 'ProcedureInvocationContext',
  ProcedureInvocationBody: 'ProcedureInvocationBodyContext',
  ProcedureName: 'ProcedureNameContext',
  ProcedureArguments: 'ProcedureArgumentsContext',
  IntegerLiteral: 'IntegerLiteralContext',
  Keyword: 'KeywordContext',
  LabelName: 'LabelNameContext',
  LeftArrowHead: 'LeftArrowHeadContext',
  Literal: 'LiteralContext',
  ListLiteral: 'ListLiteralContext',
  LiteralEntry: 'LiteralEntryContext',
  MapLiteral: 'MapLiteralContext',
  MatchClause: 'MatchClauseContext',
  MergeClause: 'MergeClauseContext',
  MergeAction: 'MergeActionContext',
  NodeLabel: 'NodeLabelContext',
  NodeLabels: 'NodeLabelsContext',
  NodePattern: 'NodePatternContext',
  NotExpression: 'NotExpressionContext',
  NumberLiteral: 'NumberLiteralContext',
  OrExpression: 'OrExpressionContext',
  ParenthesizedExpression: 'ParenthesizedExpressionContext',
  PartialComparisonExpression: 'PartialComparisonExpressionContext',
  Pattern: 'PatternContext',
  PatternElement: 'PatternElementContext',
  PatternElementChain: 'PatternElementChainContext',
  PatternPart: 'PatternPartContext',
  Properties: 'PropertiesContext',
  PropertyExpression: 'PropertyExpressionContext',
  PropertyKey: 'PropertyKeyNameContext',
  PropertyLookup: 'PropertyLookupContext',
  PropertyOrLabelsExpression: 'PropertyOrLabelsExpressionContext',
  RangeLiteral: 'RangeLiteralContext',
  RelTypeName: 'RelTypeNameContext',
  RelationshipDetail: 'RelationshipDetailContext',
  RelationshipPattern: 'RelationshipPatternContext',
  RelationshipPatternEnd: 'RelationshipPatternEndContext',
  RelationshipPatternStart: 'RelationshipPatternStartContext',
  RelationshipType: 'RelationshipTypeContext',
  RelationshipTypes: 'RelationshipTypesContext',
  RemoveClause: 'RemoveClauseContext',
  RemoveItem: 'RemoveItemContext',
  RegularQuery: 'RegularQueryContext',
  Query: 'QueryContext',
  RightArrowHead: 'RightArrowHeadContext',
  Limit: 'LimitContext',
  Order: 'OrderContext',
  Skip: 'SkipContext',
  ReturnBody: 'ReturnBodyContext',
  ReturnClause: 'ReturnClauseContext',
  ReturnItem: 'ReturnItemContext',
  ReturnItems: 'ReturnItemsContext',
  SortItem: 'SortItemContext',
  SetClause: 'SetClauseContext',
  SetItem: 'SetItemContext',
  SingleQuery: 'SingleQueryContext',
  Statement: 'StatementContext',
  StringListNullOperatorExpression: 'StringListNullOperatorExpressionContext',
  Union: 'UnionContext',
  StringLiteral: 'StringLiteralContext',
  SymbolicName: 'SymbolicNameContext',
  TerminalNode: 'TerminalNodeImpl',
  Variable: 'VariableContext',
  Where: 'WhereContext',
  WithClause: 'WithClauseContext',
  XorExpression: 'XorExpressionContext',
  UnwindClause: 'UnwindClauseContext',
  UnaryAddOrSubtractExpression: 'UnaryAddOrSubtractExpressionContext',
  ForeachClause: 'ForeachClauseContext',
  CaseExpression: 'CaseExpressionContext',
  CaseAlternatives: 'CaseAlternativesContext',
} as const;

/**
 * Sanity-check: verify that core ANTLR4 context classes are present.
 * Uses a rich query to exercise as many context types as possible.
 * Only validates contexts that are expected to appear; others are skipped.
 */
function validateContextNames(): void {
  const richQuery = 'MATCH (a:User {name: "Alice"})-[r:FRIEND*1..2]->(b:User) WITH a.name AS name, count(b) AS cnt WHERE cnt > 0 RETURN name, cnt';
  const chars = antlr4.CharStreams.fromString(richQuery);
  const lexer = new CypherLexer(chars);
  const tokens = new antlr4.CommonTokenStream(lexer);
  const parser = new CypherParser(tokens);
  const tree = parser.cypher();

  const allNames = new Set<string>();
  const collect = (ctx: ParseTreeNode): void => {
    allNames.add(ctx.constructor.name);
    if (ctx.children) {
      for (const child of ctx.children) collect(child);
    }
  };
  collect(tree);

  // Core contexts that MUST appear in any useful ANTLR4 Cypher grammar.
  // If these are missing, the grammar has changed incompatibly.
  const required = [
    Ctx.CypherQuery,
    Ctx.Statement,
    Ctx.Query,
    Ctx.RegularQuery,
    Ctx.SingleQuery,
    Ctx.Clause,
    Ctx.MatchClause,
    Ctx.ReturnClause,
    Ctx.ReturnBody,
    Ctx.ReturnItems,
    Ctx.ReturnItem,
    Ctx.Expression,
    Ctx.Atom,
    Ctx.Variable,
    Ctx.SymbolicName,
    Ctx.Pattern,
    Ctx.PatternPart,
    Ctx.AnonymousPatternPart,
    Ctx.PatternElement,
    Ctx.NodePattern,
    Ctx.TerminalNode,
  ];

  const missing = required.filter((name) => !allNames.has(name));

  if (missing.length > 0) {
    throw new Error(
      `ANTLR4 context name mismatch. Core contexts missing: ${missing.join(', ')}. ` +
        `Available: ${[...allNames].join(', ')}`,
    );
  }
}

let contextNamesValidated = false;

function ensureContextNamesValid(): void {
  if (contextNamesValidated) return;
  if (process.env.NODE_ENV === 'test') return;
  validateContextNames();
  contextNamesValidated = true;
}

// Validate lazily on first parse call (avoids startup overhead for simple invocations)
// Also run a quick eager check in dev so broken grammars are caught immediately.
if (process.env.NODE_ENV === 'development') {
  validateContextNames();
}

// ── Error listener ───────────────────────────────────────────────────────────

/** Collects ANTLR4 parse errors so we can throw a clean message instead of crashing. */
class ErrorCollector implements BaseErrorListener {
  errors: string[] = [];

  syntaxError<T, U>(
    _recognizer: T,
    _offendingSymbol: U,
    line: number,
    column: number,
    message: string,
    _e: RecognitionException | undefined,
  ): void {
    this.errors.push(`line ${line}:${column} ${message}`);
  }

  // no-op — we only care about syntax errors
  reportAmbiguity(): void {}
  reportAttemptingFullContext(): void {}
  reportContextSensitivity(): void {}
}

// Set of aggregation function names (case-insensitive check at call site).
const AGGREGATION_FUNCTIONS = new Set(['count', 'sum', 'avg', 'min', 'max']);

// ── Tree helpers ─────────────────────────────────────────────────────────────

type TreeNode = ParseTreeNode | null | undefined;

function findPropertyLookup(exprCtx: TreeNode): ParseTreeNode | null {
  if (!exprCtx) return null;
  const walk = (ctx: ParseTreeNode): ParseTreeNode | null => {
    if (!ctx.children) return null;
    for (const child of ctx.children) {
      if (child.constructor.name === Ctx.PropertyLookup) return child;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(exprCtx);
}

function findChild(ctx: TreeNode, name: string): ParseTreeNode | null {
  if (!ctx?.children) return null;
  return ctx.children.find((c: ParseTreeNode) => c.constructor.name === name) ?? null;
}

function findAllChildren(ctx: TreeNode, name: string): ParseTreeNode[] {
  if (!ctx?.children) return [];
  return ctx.children.filter((c: ParseTreeNode) => c.constructor.name === name);
}

function hasTerminal(ctx: TreeNode, text: string): boolean {
  if (!ctx?.children) return false;
  return ctx.children.some((c: ParseTreeNode) => c.symbol?.text === text);
}

function getTerminalText(ctx: TreeNode): string | undefined {
  if (!ctx) return undefined;
  const term = findChild(ctx, Ctx.TerminalNode);
  return term?.symbol?.text;
}

function getSymbolicName(ctx: TreeNode): string | undefined {
  if (!ctx) return undefined;
  const sym = findChild(ctx, Ctx.SymbolicName);
  if (!sym) return getTerminalText(ctx);

  const term = findChild(sym, Ctx.TerminalNode);
  if (term) return term.symbol?.text;

  const keyword = findChild(sym, Ctx.Keyword);
  if (keyword) {
    const keywordTerm = findChild(keyword, Ctx.TerminalNode);
    return keywordTerm?.symbol?.text;
  }

  return sym.getText();
}

// ── Arithmetic expression extraction ─────────────────────────────────────────
// The ANTLR4 Cypher grammar defines an arithmetic hierarchy:
//   AddOrSubtractExpression (+, -)
//     MultiplyDivideModuloExpression (*, /, %)
//       PowerOfExpression (^)
//         UnaryAddOrSubtractExpression (unary +, -)
//           StringListNullOperatorExpression
//             PropertyOrLabelsExpression
//               Atom
//
// We walk down this hierarchy, extracting binary/unary arithmetic at each level.
// Comparison boundaries (PartialComparisonExpression, StringListNullOperatorExpression)
// are respected so arithmetic in WHERE operands is extracted correctly.

type ArithOperator = '+' | '-' | '*' | '/' | '%' | '^';

/** Find operator terminals at a given context level. Returns { operator, index } pairs. */
function findArithmeticOperators(ctx: TreeNode): { operator: ArithOperator; index: number }[] {
  if (!ctx?.children) return [];
  const operators: ArithOperator[] = ['+', '-', '*', '/', '%', '^'];
  const results: { operator: ArithOperator; index: number }[] = [];
  for (let i = 0; i < ctx.children.length; i++) {
    const c = ctx.children[i];
    if (c?.constructor.name === Ctx.TerminalNode && operators.includes(c.symbol?.text as ArithOperator)) {
      results.push({ operator: c.symbol!.text as ArithOperator, index: i });
    }
  }
  return results;
}

/** Split children into segments separated by operator indices. Filters whitespace-only terminals. */
function splitChildrenByOperators(children: ParseTreeNode[], operatorIndices: number[]): ParseTreeNode[][] {
  const segments: ParseTreeNode[][] = [];
  let start = 0;
  for (const idx of operatorIndices) {
    segments.push(
      children.slice(start, idx).filter((c: ParseTreeNode) => {
        if (c.constructor.name === Ctx.TerminalNode) return c.symbol?.text && c.symbol.text.trim() !== '';
        return true;
      }),
    );
    start = idx + 1;
  }
  segments.push(
    children.slice(start).filter((c: ParseTreeNode) => {
      if (c.constructor.name === Ctx.TerminalNode) return c.symbol?.text && c.symbol.text.trim() !== '';
      return true;
    }),
  );
  return segments;
}

/**
 * Extract an arithmetic expression by walking the ANTLR4 arithmetic hierarchy.
 * Returns undefined if no arithmetic operator is found (falls through to atom/literal).
 */
function extractArithmeticExpression(exprCtx: TreeNode): Expression | undefined {
  if (!exprCtx) return undefined;

  // Walk down through logical/comparison wrappers to reach arithmetic level
  let ctx: TreeNode = exprCtx;
  for (const wrapper of [Ctx.OrExpression, Ctx.XorExpression, Ctx.AndExpression, Ctx.NotExpression, Ctx.ComparisonExpression]) {
    const child = findChild(ctx, wrapper);
    if (child) ctx = child;
  }

  // ── Addition / Subtraction ──────────────────────────────────────────────
  // Use ctx directly if already at AddOrSubtractExpression level, otherwise find child
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
    // No + or - at this level — descend deeper (only if we found it as a child, not ctx itself)
    if (addSubCtx !== ctx) {
      const inner = extractArithmeticExpression(addSubCtx);
      if (inner) return inner;
    }
  }

  // ── Multiplication / Division / Modulo ──────────────────────────────────
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

  // ── Power Of ────────────────────────────────────────────────────────────
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

  // ── Unary + / - ─────────────────────────────────────────────────────────
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

  // No arithmetic found — return undefined so caller falls through to atom/literal
  return undefined;
}

/** Extract an arithmetic operand from a segment (children between operators).
 * Tries arithmetic first, then falls back to base expression (atom/literal/variable).
 * Returns undefined if no valid expression can be extracted (no silent fallback to 0). */
function extractArithmeticOperand(segment: ParseTreeNode[]): Expression | undefined {
  if (segment.length === 0) return undefined;
  const arith = extractArithmeticExpression(segment[0]);
  if (arith) return arith;
  // Fall back to base expression via atom extraction
  const atom = getAtom(segment[0]);
  if (atom) {
    const base = evaluateExpressionFromAtom(atom, segment[0]);
    if (base) return base;
  }
  return undefined;
}

// ── Expression navigation ────────────────────────────────────────────────────

function getAtom(exprCtx: TreeNode): ParseTreeNode | null {
  if (!exprCtx) return null;
  // BFS to find the shallowest (outermost) Atom, avoiding inner atoms inside nested literals
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

/**
 * Find the first PropertyOrLabelsExpression and its parent context.
 * Used for list slice detection where brackets are siblings of PropertyOrLabelsExpression.
 */
function findPropOrLabelsWithParent(ctx: TreeNode): { propOrLabels: ParseTreeNode; parent: ParseTreeNode } | undefined {
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

/**
 * Extract a list slice expression by checking the parent of a PropertyOrLabelsExpression.
 *
 * ANTLR4 tree structure for `[1,2,3][0..2]`:
 *   StringListNullOperatorExpressionContext
 *     PropertyOrLabelsExpressionContext
 *       AtomContext
 *         LiteralContext
 *           ListLiteralContext [1,2,3]
 *     TerminalNodeImpl [[]
 *     ExpressionContext (0)
 *     TerminalNodeImpl [..]
 *     ExpressionContext (2)
 *     TerminalNodeImpl []]
 *
 * For single index `n.tags[0]`:
 *   StringListNullOperatorExpressionContext
 *     PropertyOrLabelsExpressionContext
 *       AtomContext (n.tags)
 *     TerminalNodeImpl [[]
 *     ExpressionContext (0)
 *     TerminalNodeImpl []]
 */

/**
 * Evaluate a slice index expression, handling unary minus for negative indices.
 *
 * ANTLR4 parses `-2` as:
 *   ExpressionContext
 *     OrExpression -> ... -> UnaryAddOrSubtractExpressionContext
 *       TerminalNodeImpl [-]
 *       StringListNullOperatorExpressionContext
 *         PropertyOrLabelsExpressionContext
 *           AtomContext
 *             LiteralContext
 *               NumberLiteralContext
 *                 IntegerLiteralContext
 *                   TerminalNodeImpl [2]
 *
 * Regular `evaluateExpression` would find the Atom (containing `2`) and lose the `-`.
 * This helper detects the unary minus at the top level and produces a negative literal.
 */
function evaluateSliceIndex(exprCtx: TreeNode): Expression | undefined {
  if (!exprCtx) return undefined;

  // Walk down to the UnaryAddOrSubtractExpression
  const unaryCtx = findDescendant(exprCtx, Ctx.UnaryAddOrSubtractExpression);
  if (unaryCtx && unaryCtx.children) {
    const children = unaryCtx.children;
    // Check for unary minus: first child is `-` terminal
    if (children[0]?.constructor.name === 'TerminalNodeImpl' && children[0]?.symbol?.text === '-') {
      // Get the inner expression (everything after `-`)
      const innerExprCtx = children[1];
      const innerExpr = evaluateExpression(innerExprCtx);
      if (innerExpr && innerExpr.type === 'Literal' && typeof innerExpr.value === 'number') {
        return { type: 'Literal' as const, value: -innerExpr.value };
      }
    }
  }

  // No unary minus — use normal evaluation
  return evaluateExpression(exprCtx);
}

function extractListSlice(parentCtx: ParseTreeNode): ListSliceExpression | undefined {
  if (!parentCtx.children) return undefined;
  const children = parentCtx.children;

  // Find PropertyOrLabelsExpression and check for [ after it
  let propIdx = -1;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child && child.constructor.name === Ctx.PropertyOrLabelsExpression) {
      propIdx = i;
      break;
    }
  }
  if (propIdx < 0) return undefined;

  // Check for [ terminal after the PropertyOrLabelsExpression
  const bracketOpen = children[propIdx + 1];
  if (!bracketOpen || bracketOpen.constructor.name !== 'TerminalNodeImpl' || bracketOpen.symbol?.text !== '[') {
    return undefined;
  }

  // Extract base expression from the PropertyOrLabelsExpression
  const propOrLabelsCtx = children[propIdx];
  const baseExpr = extractValueExpressionFromPropertyOrLabels(propOrLabelsCtx);
  if (!baseExpr) return undefined;

  // Check for range slice: [start..end], [..end], [start..], or single index: [index]
  const afterBracket = children[propIdx + 2];
  if (!afterBracket) return undefined;

  // Check if this is [..end] (start omitted)
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

  // Otherwise it's [start..end] or [index]
  const startExpr = evaluateSliceIndex(afterBracket);
  if (!startExpr) return undefined;

  // Check for .. (range slice)
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

  // Single index: treat as slice [index..index+1]
  return {
    type: 'ListSlice' as const,
    list: baseExpr,
    start: startExpr,
    end: startExpr, // Will be handled by engine to return single element
  };
}

/** Evaluate an expression from an Atom context (without slice detection). fullCtx is used for property lookup. */
function evaluateExpressionFromAtom(atom: TreeNode, fullCtx?: TreeNode): Expression | undefined {
  if (!atom) return undefined;

  // Parenthesized expression: unwrap and evaluate the inner expression
  const parenCtx = findChild(atom, Ctx.ParenthesizedExpression);
  if (parenCtx) {
    const innerExpr = findChild(parenCtx, Ctx.Expression);
    if (innerExpr) return evaluateExpression(innerExpr);
  }

  // Function invocation (e.g., count(f))
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

    // Check for DISTINCT keyword inside the function invocation
    const hasDistinct = hasTerminal(funcCtx, 'DISTINCT');

    // Only treat known aggregation functions as aggregations
    if (funcName && argName && AGGREGATION_FUNCTIONS.has(funcName.toLowerCase())) {
      return {
        type: 'Aggregation' as const,
        aggregationType: funcName.toUpperCase() as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
        variable: argName,
        property: argProperty,
        distinct: !!hasDistinct,
      };
    }

    // Non-aggregation function call (e.g., toLower(n.name), substring(n.name, 0, 5))
    if (funcName) {
      const funcCall = extractFunctionCall(funcCtx, funcName);
      if (funcCall) return funcCall;
    }
  }

  // CASE expression: CASE WHEN cond THEN result [WHEN cond THEN result ...] [ELSE result] END
  const caseCtx = findChild(atom, Ctx.CaseExpression);
  if (caseCtx) {
    const caseExpr = extractCaseExpression(caseCtx);
    if (caseExpr) return caseExpr;
  }

  // Variable reference (with optional property access, e.g., u.name)
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

  // Literal: find the LiteralContext that is a direct child of this Atom,
  // then check if it contains a MapLiteral, ListLiteral, or regular literal.
  // This avoids matching nested literals inside other literals.
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
    // Fall through to regular literal (string, number, boolean, null)
    const literal = extractLiteral(literalCtx);
    if (literal) return literal;
  }

  return undefined;
}

/**
 * Evaluate an expression from an ExpressionContext.
 * Checks for list slice syntax first, then falls back to atom-based evaluation.
 */
function evaluateExpression(exprCtx: TreeNode): Expression | undefined {
  if (!exprCtx) return undefined;

  // Check for list slice syntax (e.g., n.tags[0..2], [1,2,3][0..2])
  // The slice brackets are siblings of PropertyOrLabelsExpression in the parent
  const withParent = findPropOrLabelsWithParent(exprCtx);
  if (withParent) {
    const slice = extractListSlice(withParent.parent);
    if (slice) return slice;
  }

  // Arithmetic expressions: walk the ANTLR4 arithmetic hierarchy
  // (AddOrSubtract > MultiplyDivideModulo > PowerOf > UnaryAddOrSubtract > Atom)
  const arith = extractArithmeticExpression(exprCtx);
  if (arith) return arith;

  // Fall back to atom-based evaluation
  const atom = getAtom(exprCtx);
  if (!atom) return undefined;

  return evaluateExpressionFromAtom(atom, exprCtx);
}

/**
 * Strip surrounding quotes and handle common escape sequences in a string literal.
 * ANTLR4 returns the raw token text including quotes, e.g. `"He said \"hi\""`.
 */
function unescapeStringLiteral(raw: string): string {
  // Strip surrounding quotes (double or single)
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }
  // Handle escape sequences: \", \\, \n, \t, \r, \/
  return raw.replace(/\\(.)/g, (match, char: string, offset: number) => {
    switch (char) {
      case '"': return '"';
      case '\\': return '\\';
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case 'b': return '\b';
      case 'f': return '\f';
      case '/': return '/';
      case 'u': {
        const hex = raw.slice(offset + 2, offset + 6);
        return hex.length === 4 ? String.fromCharCode(parseInt(hex, 16)) : `\\u${hex}`;
      }
      default: return `\\${char}`;
    }
  });
}

/** Shared literal extraction used by both evaluateExpression and extractValueExpression. */
function extractLiteral(literalCtx: TreeNode): Expression | undefined {
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

  // Boolean literals (true / false) appear as terminals at the literal level
  const boolLit = findChild(literalCtx, Ctx.BooleanLiteral);
  if (boolLit) {
    const text = getTerminalText(boolLit);
    if (text === 'true') return { type: 'Literal' as const, value: true as CypherLiteral };
    if (text === 'false') return { type: 'Literal' as const, value: false as CypherLiteral };
  }

  // Null literal
  if (hasTerminal(literalCtx, 'null') || hasTerminal(literalCtx, 'NULL')) {
    return { type: 'Literal' as const, value: null as CypherLiteral };
  }

  return undefined;
}

// ── Pseudo-procedure call extraction ─────────────────────────────────────────
// ANTLR4 parses `labels(n)`, `nodes(p)`, `relationships(p)` as ProcedureInvocation
// (because these are Cypher keywords), not as FunctionInvocation.
// We extract them as FunctionCallExpression so the engine can handle them normally.

/** Keywords that are parsed as procedures but should be treated as scalar functions. */
const PSEUDO_PROCEDURE_NAMES = new Set(['labels', 'nodes', 'relationships']);

function extractPseudoProcedureCall(procCtx: TreeNode): FunctionCallExpression | undefined {
  if (!procCtx) return undefined;

  const bodyCtx = findChild(procCtx, Ctx.ProcedureInvocationBody);
  const procNameCtx = findChild(bodyCtx, Ctx.ProcedureName);
  const procName = procNameCtx ? getSymbolicName(procNameCtx) : undefined;

  if (!procName || !PSEUDO_PROCEDURE_NAMES.has(procName.toLowerCase())) return undefined;

  // Find the Expression inside ProcedureArguments
  // ANTLR4 structure: ProcedureInvocation > ProcedureArguments > Expression
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

/**
 * Extract a function call expression from a FunctionInvocation context.
 * Handles functions with 1–N arguments: toLower(n.name), substring(n.name, 0, 5), etc.
 *
 * ANTLR4 tree structure:
 *   FunctionInvocationContext
 *     FunctionInvocationBodyContext (contains FunctionName)
 *     TerminalNodeImpl [(]
 *     ExpressionContext  <-- arg 1
 *     TerminalNodeImpl [,]
 *     ExpressionContext  <-- arg 2
 *     ...
 *     TerminalNodeImpl [)]
 *
 * Expression children are direct children of FunctionInvocationContext.
 */
function extractFunctionCall(funcCtx: TreeNode, funcName: string): FunctionCallExpression | undefined {
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

/**
 * Extract a CASE expression from a CaseExpressionContext.
 *
 * Supports both forms:
 *   General CASE: CASE WHEN cond THEN result [WHEN cond THEN result ...] [ELSE result] END
 *   Simple CASE:  CASE expr WHEN value THEN result [WHEN value THEN result ...] [ELSE result] END
 *
 * ANTLR4 tree structure (general CASE):
 *   CaseExpressionContext
 *     TerminalNodeImpl [CASE]
 *     CaseAlternativesContext
 *       TerminalNodeImpl [WHEN]
 *       ExpressionContext (condition)
 *       TerminalNodeImpl [THEN]
 *       ExpressionContext (result)
 *     CaseAlternativesContext  (repeated...)
 *     TerminalNodeImpl [ELSE]  (optional)
 *     ExpressionContext (else result) (optional)
 *     TerminalNodeImpl [END]
 *
 * ANTLR4 tree structure (simple CASE):
 *   CaseExpressionContext
 *     TerminalNodeImpl [CASE]
 *     ExpressionContext (subject)
 *     CaseAlternativesContext
 *       TerminalNodeImpl [WHEN]
 *       ExpressionContext (value to compare)
 *       TerminalNodeImpl [THEN]
 *       ExpressionContext (result)
 *     ...
 *     TerminalNodeImpl [END]
 */
function extractCaseExpression(caseCtx: TreeNode): Expression | undefined {
  if (!caseCtx || !caseCtx.children) return undefined;

  const children = caseCtx.children;
  const branches: { condition: Expression | WhereExpression; result: Expression }[] = [];
  let subject: Expression | undefined;
  let elseResult: Expression | undefined;

  // Determine if this is a simple CASE (has subject) or general CASE.
  // Relies on ANTLR4 grammar structure:
  //   Simple CASE:  CASE <ExpressionContext> <CaseAlternativesContext> ...
  //   General CASE: CASE <CaseAlternativesContext> ...
  // We scan children after the CASE keyword terminal, skipping whitespace terminals,
  // and check whether the first non-terminal is an ExpressionContext (simple) or
  // CaseAlternativesContext (general).
  let startIndex = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;
    // Skip CASE keyword terminal and whitespace
    if (child.constructor.name === Ctx.TerminalNode) {
      if (child.symbol?.text === 'CASE') continue;
      if (child.symbol?.text && child.symbol.text.trim() === '') continue;
      break;
    }
    // First meaningful non-terminal after CASE
    if (child.constructor.name === Ctx.Expression) {
      // This is a simple CASE — the subject expression
      const subjectExpr = evaluateExpression(child);
      if (subjectExpr) subject = subjectExpr;
      startIndex = i + 1;
      break;
    }
    // If first non-terminal is CaseAlternatives, it's a general CASE
    break;
  }

  // Collect WHEN ... THEN ... pairs from CaseAlternativesContext children
  const alternatives = findAllChildren(caseCtx, Ctx.CaseAlternatives);
  for (const alt of alternatives) {
    // CaseAlternatives has two ExpressionContext children: WHEN condition and THEN result
    const exprChildren = findAllChildren(alt, Ctx.Expression);
    if (exprChildren.length < 2) continue;

    const result = evaluateExpression(exprChildren[1]);
    if (!result) continue;

    let condition: Expression | WhereExpression;
    if (subject) {
      // Simple CASE: WHEN value is compared for equality against subject
      const condExpr = evaluateExpression(exprChildren[0]);
      if (!condExpr) continue;
      condition = condExpr;
    } else {
      // General CASE: WHEN condition is a boolean expression (comparison, logical, etc.)
      const condWhere = extractWhereExpression(exprChildren[0]);
      if (condWhere) {
        condition = condWhere;
      } else {
        // Bare boolean literal (e.g., CASE WHEN true) or other expression.
        // Stored as-is (Expression) and handled directly in evaluateCase.
        const condExpr = evaluateExpression(exprChildren[0]);
        if (!condExpr) continue;
        condition = condExpr;
      }
    }

    branches.push({ condition, result });
  }

  // Check for optional ELSE clause
  // ELSE appears as a terminal "ELSE" followed by an ExpressionContext, before "END"
  // We need to find ELSE terminal and the ExpressionContext that follows it
  let foundElse = false;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;
    if (child.constructor.name === Ctx.TerminalNode && child.symbol?.text === 'ELSE') {
      foundElse = true;
      // The next ExpressionContext after ELSE is the else result
      for (let j = i + 1; j < children.length; j++) {
        const nextChild = children[j];
        if (!nextChild) continue;
        if (nextChild.constructor.name === Ctx.Expression) {
          elseResult = evaluateExpression(nextChild);
          break;
        }
      }
      break;
    }
  }

  if (branches.length === 0 && !elseResult) return undefined;

  return { type: 'Case' as const, subject, branches, elseResult };
}

// ── Node pattern extraction ──────────────────────────────────────────────────

function extractNodePattern(nodePatternCtx: TreeNode): NodePattern {
  if (!nodePatternCtx) return { variable: '', labels: undefined, properties: undefined };

  const variable = getSymbolicName(findChild(nodePatternCtx, Ctx.Variable)) ?? '';

  const labelExpr = extractLabelExpression(nodePatternCtx);

  const propsCtx = findChild(nodePatternCtx, Ctx.Properties);
  const mapLitCtx = findChild(propsCtx, Ctx.MapLiteral);
  const properties = extractProperties(mapLitCtx);

  return { variable, labels: labelExpr, properties };
}

/**
 * Extract a LabelExpression from a NodePattern context.
 *
 * The ANTLR4 grammar doesn't support label expressions (|, !), so they appear
 * as ErrorNodeImpl children of NodePattern. We parse them alongside the
 * standard NodeLabels/NodeLabel children.
 *
 * Labels from NodeLabels (first expression) use AND semantics.
 * Labels from error nodes after `|` use OR semantics.
 * Negated labels (!) use NOT semantics.
 *
 * Supported forms:
 *   :Movie              → { labels: ['Movie'], orLabels: [], notLabels: [], orNotLabels: [] }
 *   :Movie:Action       → { labels: ['Movie','Action'], orLabels: [], notLabels: [], orNotLabels: [] } (AND)
 *   :Movie|Person       → { labels: ['Movie'], orLabels: ['Person'], notLabels: [], orNotLabels: [] } (OR)
 *   :!Movie             → { labels: [], orLabels: [], notLabels: ['Movie'], orNotLabels: [] }
 *   :Movie|!Person      → { labels: ['Movie'], orLabels: [], notLabels: [], orNotLabels: ['Person'] }
 */
function extractLabelExpression(nodePatternCtx: TreeNode): LabelExpression | undefined {
  if (!nodePatternCtx || !nodePatternCtx.children) return undefined;

  const labels: string[] = [];        // positive labels from NodeLabels (AND semantics)
  const orLabels: string[] = [];      // positive labels from | (OR semantics)
  const notLabels: string[] = [];     // negated labels from first expression (AND NOT)
  const orNotLabels: string[] = [];   // negated labels from | alternatives (OR NOT)

  // 1. Collect labels from the standard NodeLabels/NodeLabel children.
  //    Each NodeLabel may contain an ErrorNodeImpl [!] inside its LabelName
  //    (e.g. :!Movie), so we check for that.
  //    Negated labels from the first expression are AND NOT.
  const labelsCtx = findChild(nodePatternCtx, Ctx.NodeLabels);
  const labelCtxs = findAllChildren(labelsCtx, Ctx.NodeLabel);
  for (const lc of labelCtxs) {
    const labelNameCtx = findChild(lc, Ctx.LabelName);
    if (!labelNameCtx) continue;

    // Check if the LabelName contains an ErrorNodeImpl [!] (negated label)
    // The ! may be nested inside SymbolicNameContext, so search recursively
    const errorNode = findDescendant(labelNameCtx, 'ErrorNodeImpl');
    const hasNegation = errorNode?.symbol?.text === '!';

    const name = getSymbolicName(labelNameCtx);
    if (name) {
      // getSymbolicName may include the '!' prefix — strip it
      const cleanName = name.startsWith('!') ? name.slice(1) : name;
      if (hasNegation) {
        notLabels.push(cleanName);  // AND NOT (from first expression)
      } else {
        labels.push(cleanName);
      }
    }
  }

  // 2. Collect additional labels from ErrorNodeImpl children of NodePattern.
  //    After the first label, the grammar produces error nodes for |, !, :
  //    and bare identifiers (e.g. | Person | Actor or :!Person).
  const errorNodes = nodePatternCtx.children.filter(
    (c: ParseTreeNode) => c.constructor.name === 'ErrorNodeImpl',
  ) as ParseTreeNode[];

  // Walk error nodes left-to-right, tracking state
  let sawPipe = false;
  let negated = false;
  for (const err of errorNodes) {
    const text = err.symbol?.text;
    if (text === '|') {
      sawPipe = true;
      negated = false;
    } else if (text === '!') {
      negated = true;
    } else if (text === ':') {
      // Standalone ':' before a negated label (e.g. :!Person)
      // If we've seen a pipe, this is part of the OR expression
      // If not, this is part of the AND expression
      negated = false;
    } else if (text && !text.includes(')')) {
      // This is a label name
      if (negated) {
        if (sawPipe) {
          orNotLabels.push(text);  // OR NOT (from | alternative)
        } else {
          notLabels.push(text);    // AND NOT (from first expression)
        }
      } else if (sawPipe) {
        orLabels.push(text);
      } else {
        // No pipe seen — this label is part of the AND expression
        labels.push(text);
      }
      negated = false;
    }
  }

  if (labels.length === 0 && orLabels.length === 0 && notLabels.length === 0 && orNotLabels.length === 0) return undefined;
  return { labels, orLabels, notLabels, orNotLabels };
}

/** Evaluate a static arithmetic expression (all operands must be literals). Throws for non-static expressions. */
function evaluateStaticArithmetic(expr: Expression): CypherValue {
  if (expr.type === 'Literal') return expr.value;
  if (expr.type !== 'Arithmetic') {
    throw new Error(`Non-static expression in CREATE properties is not supported: ${expr.type}`);
  }
  const result = evaluateArithmeticCore(expr, (e) => evaluateStaticArithmetic(e as Expression));
  if (result === null) throw new Error('Static arithmetic evaluation failed (non-numeric operands)');
  return result;
}

function extractProperties(mapLiteralCtx: TreeNode): Record<string, CypherValue> | undefined {
  if (!mapLiteralCtx) return undefined;

  const entries = findAllChildren(mapLiteralCtx, Ctx.LiteralEntry);
  if (entries.length === 0) return undefined;

  const props: Record<string, CypherValue> = {};
  for (const entry of entries) {
    const keyCtx = findChild(entry, Ctx.PropertyKey);
    const key = getSymbolicName(keyCtx);
    const exprCtx = findChild(entry, Ctx.Expression);
    const value = evaluateExpression(exprCtx);

    if (!key || !value) continue;

    if (value.type === 'Literal') {
      props[key] = value.value;
    } else if (value.type === 'Arithmetic') {
      // Try to evaluate static arithmetic at parse time.
      // For non-static expressions (e.g., property access in FOREACH CREATE),
      // skip silently — they'll be handled via propertiesExpr at runtime.
      try {
        props[key] = evaluateStaticArithmetic(value);
      } catch {
        // Non-static — skip (propertiesExpr will handle it)
      }
    } else if (value.type === 'ListLiteral') {
      // Evaluate list entries at parse time for CREATE (static values)
      const listValues: CypherValue[] = [];
      for (const le of value.values) {
        if (le.type === 'Literal') listValues.push(le.value);
        else if (le.type === 'MapLiteral') {
          const mapVals: Record<string, CypherValue> = {};
          for (const me of le.entries) {
            if (me.value.type === 'Literal') mapVals[me.key] = me.value.value;
          }
          listValues.push(mapVals);
        }
      }
      props[key] = listValues as CypherValue;
    } else if (value.type === 'MapLiteral') {
      // Evaluate map entries at parse time for CREATE (static values)
      const mapVals: Record<string, CypherValue> = {};
      for (const me of value.entries) {
        if (me.value.type === 'Literal') mapVals[me.key] = me.value.value;
      }
      props[key] = mapVals;
    }
    // Non-static expressions (PropertyAccess, FunctionCall, etc.) are skipped here
    // and handled via propertiesExpr at runtime (e.g., in FOREACH CREATE)
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

/** Extract unevaluated property expressions from a MapLiteral (for dynamic CREATE inside FOREACH). */
function extractDynamicProperties(mapLiteralCtx: TreeNode): Record<string, Expression> | undefined {
  if (!mapLiteralCtx) return undefined;

  const entries = findAllChildren(mapLiteralCtx, Ctx.LiteralEntry);
  if (entries.length === 0) return undefined;

  const props: Record<string, Expression> = {};
  for (const entry of entries) {
    const keyCtx = findChild(entry, Ctx.PropertyKey);
    const key = getSymbolicName(keyCtx);
    const exprCtx = findChild(entry, Ctx.Expression);
    const value = evaluateExpression(exprCtx);

    if (key && value) {
      props[key] = value;
    }
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

// ── Relationship pattern extraction ──────────────────────────────────────────

function extractRelationPattern(relPatternCtx: TreeNode): RelationPattern {
  if (!relPatternCtx) return { variable: undefined, type: undefined, minDepth: undefined, maxDepth: undefined, direction: 'UNDIRECTED' };

  const direction = extractDirection(relPatternCtx);
  const detailCtx = findChild(relPatternCtx, Ctx.RelationshipDetail);

  const variable = detailCtx ? getSymbolicName(findChild(detailCtx, Ctx.Variable)) : undefined;

  const typesCtx = findChild(detailCtx, Ctx.RelationshipTypes);
  const typeCtx = findChild(typesCtx, Ctx.RelationshipType);
  const typeNameCtx = findChild(typeCtx, Ctx.RelTypeName);
  const type = getSymbolicName(typeNameCtx);

  // Variable-length paths (*1..3)
  const rangeCtx = findChild(detailCtx, Ctx.RangeLiteral);
  if (rangeCtx) {
    const intLits = findAllChildren(rangeCtx, Ctx.IntegerLiteral);
    const values = intLits.map((ic) => {
      const text = getTerminalText(ic);
      return text ? parseInt(text, 10) : 0;
    });
    if (values.length >= 1) {
      return {
        variable,
        type,
        minDepth: values[0],
        maxDepth: values.length >= 2 ? values[1] : values[0],
        direction,
      };
    }
  }

  return { variable, type, minDepth: undefined, maxDepth: undefined, direction };
}

function extractDirection(relPatternCtx: TreeNode): Direction {
  if (!relPatternCtx) return 'UNDIRECTED';

  const startCtx = findChild(relPatternCtx, Ctx.RelationshipPatternStart);
  const endCtx = findChild(relPatternCtx, Ctx.RelationshipPatternEnd);

  const hasStartArrow = !!findChild(startCtx, Ctx.LeftArrowHead);
  const hasEndArrow = !!findChild(endCtx, Ctx.RightArrowHead);

  if (hasStartArrow && hasEndArrow) return 'UNDIRECTED';
  if (hasStartArrow) return 'IN';
  if (hasEndArrow) return 'OUT';
  return 'UNDIRECTED';
}

// ── Clause extraction ────────────────────────────────────────────────────────

function extractMatchClause(clauseCtx: ParseTreeNode): MatchClause {
  const matchCtx = findChild(clauseCtx, Ctx.MatchClause);
  const optional = hasTerminal(clauseCtx, 'OPTIONAL') || (matchCtx && hasTerminal(matchCtx, 'OPTIONAL'));

  const patternCtx = findChild(matchCtx, Ctx.Pattern);
  if (!patternCtx) throw new Error('Failed to parse MATCH: missing Pattern node.');
  const patternPart = findChild(patternCtx, Ctx.PatternPart);
  if (!patternPart) throw new Error('Failed to parse MATCH: missing PatternPart node.');
  const anonPart = findChild(patternPart, Ctx.AnonymousPatternPart);
  if (!anonPart) throw new Error('Failed to parse MATCH: missing AnonymousPatternPart node.');
  const element = findChild(anonPart, Ctx.PatternElement);
  if (!element) throw new Error('Failed to parse MATCH: missing PatternElement node.');

  const nodePatterns = findAllChildren(element, Ctx.NodePattern);
  const chains = findAllChildren(element, Ctx.PatternElementChain);

  const sourcePattern = nodePatterns[0] ? extractNodePattern(nodePatterns[0]) : { variable: '', labels: undefined, properties: undefined };

  let relationPattern: RelationPattern = { variable: undefined, type: undefined, minDepth: undefined, maxDepth: undefined, direction: 'UNDIRECTED' };
  let targetPattern: NodePattern = { variable: '', labels: undefined, properties: undefined };

  const hasChains = chains.length > 0;

  if (chains.length > 1) {
    throw new Error('Multi-hop patterns (more than one relationship chain) are not supported. Use multiple MATCH stages or a WITH clause.');
  }

  if (hasChains) {
    const chain = chains[0];
    const relPatternCtx = findChild(chain, Ctx.RelationshipPattern);
    relationPattern = extractRelationPattern(relPatternCtx);

    const targetNodeCtx = findChild(chain, Ctx.NodePattern);
    if (targetNodeCtx) {
      targetPattern = extractNodePattern(targetNodeCtx);
    }
  } else if (nodePatterns.length > 1) {
    targetPattern = extractNodePattern(nodePatterns[1]);
  }

  // Extract path variable (if present): `MATCH path = (a)-[r]->(b)`
  // The path variable appears as a VariableContext child of PatternPartContext,
  // followed by a `=` terminal, then the AnonymousPatternPartContext.
  let pathVariable: string | undefined;
  if (patternPart) {
    // Check if there's a VariableContext before the AnonymousPatternPart
    // (indicating a path variable assignment)
    const partChildren = patternPart.children;
    if (partChildren) {
      for (let i = 0; i < partChildren.length; i++) {
        const child = partChildren[i];
        if (child && child.constructor.name === Ctx.Variable) {
          // Check if next non-whitespace child is `=`
          for (let j = i + 1; j < partChildren.length; j++) {
            const next = partChildren[j];
            if (next?.constructor.name === Ctx.TerminalNode) {
              if (next.symbol?.text === '=') {
                pathVariable = getSymbolicName(child);
              }
              break; // stop at first terminal
            }
            if (next?.symbol?.text && next.symbol.text.trim() !== '') {
              break; // non-whitespace, non-terminal — not a path var
            }
          }
          break;
        }
      }
    }
  }

  // Extract WHERE clause (if present)
  const whereCtx = findChild(matchCtx, Ctx.Where);
  const whereExpr = findChild(whereCtx, Ctx.Expression);
  const where = whereExpr ? extractWhereExpression(whereExpr) : undefined;

  return { optional: !!optional, hasChains, sourcePattern, relationPattern, targetPattern, where: where ?? undefined, pathVariable };
}

function computeDefaultAlias(expr: Expression): string {
  if (expr.type === 'PropertyAccess') {
    return expr.property ?? expr.variable;
  }
  if (expr.type === 'Aggregation') {
    return `${expr.aggregationType}(${expr.variable})`;
  }
  if (expr.type === 'FunctionCall') {
    const argAliases = expr.arguments.map((a) => computeDefaultAlias(a));
    return `${expr.functionName}(${argAliases.join(', ')})`;
  }
  if (expr.type === 'ListSlice') {
    return `${computeDefaultAlias(expr.list)}[]`;
  }
  if (expr.type === 'ListLiteral') {
    return 'list';
  }
  if (expr.type === 'MapLiteral') {
    return 'map';
  }
  if (expr.type === 'Arithmetic') {
    if (expr.operator === 'UNARY_MINUS' || expr.operator === 'UNARY_PLUS') {
      return `${expr.operator === 'UNARY_MINUS' ? '-' : '+'}${computeDefaultAlias(expr.right)}`;
    }
    const leftAlias = computeDefaultAlias(expr.left!);
    const rightAlias = computeDefaultAlias(expr.right);
    return `${leftAlias} ${expr.operator} ${rightAlias}`;
  }
  if (expr.type === 'Case') {
    return 'CASE';
  }
  return String(expr.value);
}

interface ParsedItem {
  expr: Expression;
  hasAs: boolean;
  asAlias: string | undefined;
}

function extractReturnBody(returnBody: ParseTreeNode | null): Projection[] {
  if (!returnBody) return [];

  const returnItems = findChild(returnBody, Ctx.ReturnItems);
  if (!returnItems) return [];

  // ReturnItems can contain ReturnItemContext (regular expressions) and
  // FuncContext (pseudo-procedures like labels/nodes/relationships).
  // Collect all item-like children.
  const allItems: ParseTreeNode[] = [];
  if (returnItems.children) {
    for (const child of returnItems.children) {
      const cname = child.constructor.name;
      if (cname === Ctx.ReturnItem || cname === Ctx.Func) {
        allItems.push(child);
      }
    }
  }
  // Single pass: parse each item once
  const parsedItems: ParsedItem[] = [];
  for (const item of allItems) {
    // Check for "pseudo-procedure" calls (labels, nodes, relationships)
    // which ANTLR4 parses as ProcedureInvocation, not FunctionInvocation.
    const funcCtx = item.constructor.name === Ctx.Func ? item : findChild(item, Ctx.Func);
    let expr: Expression | undefined;
    if (funcCtx) {
      const procCtx = findChild(funcCtx, Ctx.ProcedureInvocation);
      if (procCtx) {
        const procCall = extractPseudoProcedureCall(procCtx);
        if (procCall) expr = procCall;
      }
    }
    // Fall back to regular expression
    if (!expr) {
      const exprCtx = findChild(item, Ctx.Expression);
      expr = evaluateExpression(exprCtx);
    }
    if (!expr) continue;

    const hasAs = hasTerminal(item, 'AS');
    let asAlias: string | undefined;
    if (hasAs) {
      const aliasVar = findChild(item, Ctx.Variable);
      asAlias = getSymbolicName(aliasVar);
    }
    parsedItems.push({ expr, hasAs, asAlias });
  }

  // Compute collision counts from default aliases
  const aliasCounts = new Map<string, number>();
  for (const { expr, hasAs, asAlias } of parsedItems) {
    if (hasAs) continue;
    const alias = computeDefaultAlias(expr);
    aliasCounts.set(alias, (aliasCounts.get(alias) ?? 0) + 1);
  }

  // Build projections, resolving collisions symmetrically
  const projections: Projection[] = [];
  const usedAliases = new Set<string>();
  for (const { expr, hasAs, asAlias } of parsedItems) {
    if (hasAs) {
      if (asAlias) {
        projections.push({ expression: expr, alias: asAlias, distinct: false });
        usedAliases.add(asAlias);
      }
      continue;
    }

    let alias = computeDefaultAlias(expr);

    // If this alias collides with others, use var.prop form for PropertyAccess
    if ((aliasCounts.get(alias) ?? 0) > 1 && expr.type === 'PropertyAccess' && expr.property) {
      alias = `${expr.variable}.${expr.property}`;
    }

    // If still colliding (e.g., same var.prop or non-PropertyAccess), append index
    if (usedAliases.has(alias)) {
      let idx = 1;
      alias = `${alias}_${idx}`;
      while (usedAliases.has(alias)) {
        idx++;
        alias = `${alias.slice(0, -String(idx).length - 1)}_${idx}`;
      }
    }
    usedAliases.add(alias);

    projections.push({ expression: expr, alias, distinct: false });
  }

  return projections;
}

function extractOrderBy(returnBody: ParseTreeNode | null): OrderByItem[] | undefined {
  const orderCtx = findChild(returnBody, Ctx.Order);
  if (!orderCtx) return undefined;

  const sortItems = findAllChildren(orderCtx, Ctx.SortItem);
  if (sortItems.length === 0) return undefined;

  const items: OrderByItem[] = [];
  for (const sortItem of sortItems) {
    const exprCtx = findChild(sortItem, Ctx.Expression);
    const expr = evaluateExpression(exprCtx);
    if (!expr) continue;

    // Check for explicit ASC/DESC direction (default is ASC)
    const hasDesc = hasTerminal(sortItem, 'DESC');
    const direction = hasDesc ? 'DESC' : 'ASC';

    items.push({ expression: expr, direction });
  }

  return items.length > 0 ? items : undefined;
}

function extractLimit(returnBody: ParseTreeNode | null): number | undefined {
  const limitCtx = findChild(returnBody, Ctx.Limit);
  if (!limitCtx) return undefined;

  const exprCtx = findChild(limitCtx, Ctx.Expression);
  const expr = evaluateExpression(exprCtx);
  if (expr && expr.type === 'Literal' && typeof expr.value === 'number') {
    return expr.value;
  }
  return undefined;
}

function extractSkip(returnBody: ParseTreeNode | null): number | undefined {
  const skipCtx = findChild(returnBody, Ctx.Skip);
  if (!skipCtx) return undefined;

  const exprCtx = findChild(skipCtx, Ctx.Expression);
  const expr = evaluateExpression(exprCtx);
  if (expr && expr.type === 'Literal' && typeof expr.value === 'number') {
    return expr.value;
  }
  return undefined;
}

function extractReturnClause(clauseCtx: ParseTreeNode): ReturnClause | undefined {
  const returnCtx = findChild(clauseCtx, Ctx.ReturnClause);
  if (!returnCtx) return undefined;

  const returnBody = findChild(returnCtx, Ctx.ReturnBody);
  let projections = extractReturnBody(returnBody);
  const orderBy = extractOrderBy(returnBody);
  const skip = extractSkip(returnBody);
  const limit = extractLimit(returnBody);

  // Check for DISTINCT keyword at the ReturnClause level
  const hasDistinct = hasTerminal(returnCtx, 'DISTINCT');
  if (hasDistinct) {
    projections = projections.map((p) => ({ ...p, distinct: true }));
  }

  return { projections, orderBy, skip, limit };
}

function extractWithClause(clauseCtx: ParseTreeNode): WithClause | undefined {
  const withCtx = findChild(clauseCtx, Ctx.WithClause);
  if (!withCtx) return undefined;

  const returnBody = findChild(withCtx, Ctx.ReturnBody);
  const projections = extractReturnBody(returnBody);
  const orderBy = extractOrderBy(returnBody);
  const skip = extractSkip(returnBody);
  const limit = extractLimit(returnBody);

  const whereCtx = findChild(withCtx, Ctx.Where);
  const whereExpr = findChild(whereCtx, Ctx.Expression);
  const where = whereExpr ? extractWhereExpression(whereExpr) : undefined;

  return { projections, where, orderBy, skip, limit };
}

function extractWhereExpression(exprCtx: TreeNode): WhereExpression | undefined {
  if (!exprCtx) return undefined;

  // For NotExpression without NOT terminal (transparent wrapper),
  // directly use its direct child BEFORE using findDescendant, because
  // findDescendant can find OrExpression/XorExpression/AndExpression
  // inside list literals like [Alice, Bob]
  if (exprCtx.constructor.name === Ctx.NotExpression && !hasNotTerminal(exprCtx)) {
    // Use extractWhereExpressionFromChild for direct children to properly
    // handle nested logical expressions (e.g., ComparisonExpression wrapping OrExpression)
    const directOr = findChild(exprCtx, Ctx.OrExpression);
    if (directOr) return extractWhereExpressionFromChild(directOr);
    const directXor = findChild(exprCtx, Ctx.XorExpression);
    if (directXor) return extractWhereExpressionFromChild(directXor);
    const directAnd = findChild(exprCtx, Ctx.AndExpression);
    if (directAnd) return extractWhereExpressionFromChild(directAnd);
    const directComp = findChild(exprCtx, Ctx.ComparisonExpression);
    if (directComp) return extractWhereExpressionFromChild(directComp);
    return undefined;
  }

  // Walk down to OrExpression (top of boolean expression hierarchy).
  // The ANTLR4 Cypher grammar defines: Or > Xor > And > Not > Comparison.
  // Cypher itself has no XOR operator — XorExpression is an intermediate
  // grammar production (the grammar uses "OR" at the top level and
  // "XOR" as the recursive rule name). We map XorExpression → OR because
  // the actual operator text in the tree is always "OR".
  const orCtx = findDescendantOutsideCompound(exprCtx, Ctx.OrExpression);
  if (orCtx) return extractLogicalExpression(orCtx, Ctx.XorExpression, 'OR');

  const xorCtx = findDescendantOutsideCompound(exprCtx, Ctx.XorExpression);
  if (xorCtx) return extractLogicalExpression(xorCtx, Ctx.AndExpression, 'XOR');

  const andCtx = findDescendantOutsideCompound(exprCtx, Ctx.AndExpression);
  if (andCtx) return extractLogicalExpression(andCtx, Ctx.NotExpression, 'AND');

  // Check for top-level NOT (e.g., from a segment in extractLogicalExpression)
  const notCtx = findDescendantOutsideCompound(exprCtx, Ctx.NotExpression);
  if (notCtx && hasNotTerminal(notCtx)) {
    const notCount = countNotTerminals(notCtx);
    // Find the actual inner expression (skip NOT terminals and whitespace)
    const innerCtx = findChild(notCtx, Ctx.OrExpression) || findChild(notCtx, Ctx.XorExpression) || findChild(notCtx, Ctx.AndExpression) || findChild(notCtx, Ctx.ComparisonExpression);
    if (innerCtx) {
      const inner = extractWhereExpressionFromChild(innerCtx);
      if (inner) return wrapInNotExpressions(inner, notCount);
    }
  }

  const compCtx = findDescendantOutsideCompound(exprCtx, Ctx.ComparisonExpression);
  if (compCtx) return extractComparison(compCtx);

  return undefined;
}

/** Find the first descendant with the given constructor name (depth-first). */
function findDescendant(ctx: TreeNode, name: string): ParseTreeNode | undefined {
  if (!ctx) return undefined;
  if (ctx.constructor.name === name) return ctx as ParseTreeNode;
  if (ctx.children) {
    for (const child of ctx.children) {
      const found = findDescendant(child, name);
      if (found) return found;
    }
  }
  return undefined;
}

/** Find the first descendant with the given constructor name, stopping at ListLiteral and FunctionInvocation boundaries.
 * This prevents finding OrExpression/XorExpression/AndExpression inside list literals like [Alice, Bob]
 * or inside function call arguments like length(p.name). */
function findDescendantOutsideCompound(ctx: TreeNode, name: string): ParseTreeNode | undefined {
  if (!ctx) return undefined;
  if (ctx.constructor.name === name) return ctx as ParseTreeNode;
  if (ctx.children) {
    for (const child of ctx.children) {
      // Stop at ListLiteral boundaries to avoid finding expressions inside lists
      if (child.constructor.name === Ctx.ListLiteral) continue;
      // Stop at FunctionInvocation boundaries to avoid finding expressions inside function args
      if (child.constructor.name === Ctx.FunctionInvocation) continue;
      const found = findDescendantOutsideCompound(child, name);
      if (found) return found;
    }
  }
  return undefined;
}

/** Extract a logical (AND/OR) expression from its context node.
 * Handles multiple operators at the same level (e.g., a AND b AND c) by
 * building a left-associative chain.
 */
function extractLogicalExpression(
  ctx: TreeNode,
  childName: string,
  operator: 'AND' | 'OR' | 'XOR',
): WhereExpression | undefined {
  if (!ctx) return undefined;

  const children = ctx.children;
  if (!children) return undefined;

  // Find all operator terminals at this level
  const operatorIndices: number[] = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c && c.constructor.name === Ctx.TerminalNode && c.symbol?.text === operator) {
      operatorIndices.push(i);
    }
  }

  if (operatorIndices.length === 0) {
    // Single operand (no logical operator) — extract as a single expression
    const child = findChild(ctx, childName);
    if (child) return extractWhereExpressionFromChild(child);
    return undefined;
  }

  // Split children into segments separated by the operator
  // e.g., [left1, AND, right1, AND, right2] → [left1], [right1], [right2]
  const segments: ParseTreeNode[][] = [];
  let start = 0;
  for (const idx of operatorIndices) {
    segments.push(children.slice(start, idx));
    start = idx + 1;
  }
  segments.push(children.slice(start));

  // Convert segments to expressions
  const expressions: WhereExpression[] = [];
  for (const segment of segments) {
    const segmentCtx = buildSyntheticTree(segment);
    const expr = extractWhereExpression(segmentCtx);
    if (expr) {
      expressions.push(expr);
    }
  }

  if (expressions.length < 2) return undefined;

  // Build left-associative chain: ((a OP b) OP c) OP d
  let result: WhereExpression = expressions[0]!;
  for (let i = 1; i < expressions.length; i++) {
    result = {
      type: 'LogicalExpression' as const,
      operator: operator === 'XOR' ? 'OR' : operator,
      left: result,
      right: expressions[i]!,
    };
  }
  return result;
}

/** Build a synthetic ParseTreeNode from an array of child nodes. */
function buildSyntheticTree(children: ParseTreeNode[]): ParseTreeNode {
  // Filter out whitespace-only terminal nodes
  const filtered = children.filter((c: ParseTreeNode) => {
    if (c.constructor.name === Ctx.TerminalNode) {
      return c.symbol?.text && c.symbol.text.trim() !== '';
    }
    return true;
  });

  // If there's a single non-terminal child, return it directly
  const nonTerminals = filtered.filter((c: ParseTreeNode) => c.constructor.name !== Ctx.TerminalNode);
  if (nonTerminals.length === 1) return nonTerminals[0]!;

  // Otherwise, return the first meaningful child (should be a proper context)
  if (filtered.length > 0) return filtered[0]!;

  // Fallback: create a minimal node
  return { constructor: { name: 'SyntheticNode' }, children: filtered } as unknown as ParseTreeNode;
}

/** Check if a NotExpression actually has a NOT terminal (vs being a transparent wrapper). */
function hasNotTerminal(ctx: TreeNode): boolean {
  if (!ctx || ctx.constructor.name !== Ctx.NotExpression || !ctx.children) return false;
  return ctx.children.some((c: ParseTreeNode) =>
    c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'NOT',
  );
}

/** Count NOT terminals in a NotExpression (for double/triple NOT support). */
function countNotTerminals(ctx: TreeNode): number {
  if (!ctx || ctx.constructor.name !== Ctx.NotExpression || !ctx.children) return 0;
  return ctx.children.filter((c: ParseTreeNode) =>
    c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'NOT',
  ).length;
}

/** Wrap an inner expression in N NotExpression nodes (for double/triple NOT). */
function wrapInNotExpressions(inner: WhereExpression, count: number): WhereExpression {
  let result: WhereExpression = inner;
  for (let i = 0; i < count; i++) {
    result = { type: 'NotExpression' as const, expression: result };
  }
  return result;
}

/** Extract a where expression from a child context (handles NotExpression and similar wrappers). */
function extractWhereExpressionFromChild(ctx: TreeNode): WhereExpression | undefined {
  if (!ctx) return undefined;

  // If it's a NotExpression with an actual NOT terminal, wrap the inner expression
  if (ctx.constructor.name === Ctx.NotExpression && hasNotTerminal(ctx)) {
    // Find the actual inner expression (skip NOT terminals and whitespace)
    const innerCtx = findChild(ctx, Ctx.OrExpression) || findChild(ctx, Ctx.XorExpression) || findChild(ctx, Ctx.AndExpression) || findChild(ctx, Ctx.ComparisonExpression);
    if (innerCtx) {
      const inner = extractWhereExpressionFromChild(innerCtx);
      if (inner) return wrapInNotExpressions(inner, countNotTerminals(ctx));
    }
    return undefined;
  }

  // Transparent NotExpression (no NOT terminal) — unwrap to inner expression
  if (ctx.constructor.name === Ctx.NotExpression) {
    // Use direct child to avoid findDescendant finding ComparisonExpression
    // inside list literals like [Alice, Bob]
    const directComp = findChild(ctx, Ctx.ComparisonExpression);
    if (directComp) return extractComparison(directComp);
    return undefined;
  }

  // If ctx itself is a ComparisonExpression, first check for nested logical expressions
  // (e.g., NOT (a OR b) where the parentheses create a ComparisonExpression wrapping an OrExpression)
  if (ctx.constructor.name === Ctx.ComparisonExpression) {
    const nestedOr = findDescendantOutsideCompound(ctx, Ctx.OrExpression);
    if (nestedOr) return extractLogicalExpression(nestedOr, Ctx.XorExpression, 'OR');
    const nestedXor = findDescendantOutsideCompound(ctx, Ctx.XorExpression);
    if (nestedXor) return extractLogicalExpression(nestedXor, Ctx.AndExpression, 'XOR');
    const nestedAnd = findDescendantOutsideCompound(ctx, Ctx.AndExpression);
    if (nestedAnd) return extractLogicalExpression(nestedAnd, Ctx.NotExpression, 'AND');
    return extractComparison(ctx);
  }

  // Handle AndExpression and OrExpression directly (when called from extractLogicalExpression)
  if (ctx.constructor.name === Ctx.AndExpression) {
    return extractLogicalExpression(ctx, Ctx.NotExpression, 'AND');
  }
  if (ctx.constructor.name === Ctx.OrExpression) {
    return extractLogicalExpression(ctx, Ctx.XorExpression, 'OR');
  }
  if (ctx.constructor.name === Ctx.XorExpression) {
    return extractLogicalExpression(ctx, Ctx.AndExpression, 'XOR');
  }

  // If it's an AndExpression or OrExpression, handle recursively
  const andCtx = findDescendantOutsideCompound(ctx, Ctx.AndExpression);
  if (andCtx) return extractLogicalExpression(andCtx, Ctx.NotExpression, 'AND');

  const orCtx = findDescendantOutsideCompound(ctx, Ctx.OrExpression);
  if (orCtx) return extractLogicalExpression(orCtx, Ctx.XorExpression, 'OR');

  const compCtx = findDescendantOutsideCompound(ctx, Ctx.ComparisonExpression);
  if (compCtx) return extractComparison(compCtx);

  return undefined;
}

function extractComparison(compCtx: TreeNode): BinaryExpression | IsNullExpression | undefined {
  if (!compCtx) return undefined;

  // Standard comparison operators (>, <, =, <>, etc.) use PartialComparisonExpression
  const partialCtx = findChild(compCtx, Ctx.PartialComparisonExpression);
  if (partialCtx) {
    const operatorTerm = findChild(partialCtx, Ctx.TerminalNode);
    const operator = operatorTerm?.symbol?.text as '>' | '<' | '>=' | '<=' | '=' | '<>';
    if (!operator) return undefined;

    const leftExprCtx = findChild(compCtx, Ctx.AddOrSubtractExpression);
    const left = extractValueExpression(leftExprCtx);

    const rightExprCtx = findChild(partialCtx, Ctx.AddOrSubtractExpression);
    const right = extractValueExpression(rightExprCtx);

    if (left && right) {
      return { type: 'BinaryExpression' as const, operator, left, right };
    }
    return undefined;
  }

  // StringListNullOperatorExpression handles CONTAINS, STARTS WITH, ENDS WITH, IN, IS NULL, and IS NOT NULL
  const strCtx = findDescendant(compCtx, Ctx.StringListNullOperatorExpression);
  if (strCtx && strCtx.children) {
    // Check for IS NULL / IS NOT NULL first (single PropertyOrLabelsExpression + IS [+ NOT] + NULL)
    const hasIs = strCtx.children.some((c: ParseTreeNode) =>
      c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'IS',
    );
    const hasNull = strCtx.children.some((c: ParseTreeNode) =>
      c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'NULL',
    );
    if (hasIs && hasNull) {
      const propExprs = strCtx.children!.filter(
        (c: ParseTreeNode) => c.constructor.name === Ctx.PropertyOrLabelsExpression,
      ) as ParseTreeNode[];

      if (propExprs.length >= 1) {
        const expr = extractValueExpressionFromPropertyOrLabels(propExprs[0]);
        if (expr) {
          const hasNot = strCtx.children.some((c: ParseTreeNode) =>
            c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'NOT',
          );
          const isNullExpr: IsNullExpression = {
            type: 'IsNull' as const,
            expression: expr,
            negated: hasNot,
          };
          return isNullExpr;
        }
      }
    }

    // Two-operand operators: CONTAINS, STARTS WITH, ENDS WITH, IN
    const propExprs = strCtx.children!.filter(
      (c: ParseTreeNode) => c.constructor.name === Ctx.PropertyOrLabelsExpression,
    ) as ParseTreeNode[];

    if (propExprs.length >= 2) {
      // Check operator terminals
      const hasContains = strCtx.children.some((c: ParseTreeNode) =>
        c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'CONTAINS',
      );
      const hasStartsWith = strCtx.children.some((c: ParseTreeNode) =>
        c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'STARTS',
      );
      const hasEndsWith = strCtx.children.some((c: ParseTreeNode) =>
        c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'ENDS',
      );
      const hasIn = strCtx.children.some((c: ParseTreeNode) =>
        c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'IN',
      );

      if (hasContains) {
        const left = extractValueExpressionFromPropertyOrLabels(propExprs[0]);
        const right = extractValueExpressionFromPropertyOrLabels(propExprs[1]);
        if (left && right) {
          return { type: 'BinaryExpression' as const, operator: 'CONTAINS', left, right };
        }
      }

      if (hasStartsWith) {
        const left = extractValueExpressionFromPropertyOrLabels(propExprs[0]);
        const right = extractValueExpressionFromPropertyOrLabels(propExprs[1]);
        if (left && right) {
          return { type: 'BinaryExpression' as const, operator: 'STARTS WITH', left, right };
        }
      }

      if (hasEndsWith) {
        const left = extractValueExpressionFromPropertyOrLabels(propExprs[0]);
        const right = extractValueExpressionFromPropertyOrLabels(propExprs[1]);
        if (left && right) {
          return { type: 'BinaryExpression' as const, operator: 'ENDS WITH', left, right };
        }
      }

      if (hasIn) {
        const left = extractValueExpressionFromPropertyOrLabels(propExprs[0]);
        const right = extractValueExpressionFromPropertyOrLabels(propExprs[1]);
        if (left && right) {
          return { type: 'BinaryExpression' as const, operator: 'IN', left, right };
        }
      }
    }
  }

  return undefined;
}

/** Extract a list literal expression from a ListLiteralContext. */
function extractListLiteralExpressionFromCtx(listLitCtx: ParseTreeNode): ListLiteralExpression | undefined {
  const listExprs = findAllChildren(listLitCtx, Ctx.Expression);
  const values: Expression[] = [];
  for (const le of listExprs) {
    const val = evaluateExpression(le);
    if (val) values.push(val);
  }
  return { type: 'ListLiteral' as const, values };
}

/** Extract a map literal expression from a MapLiteralContext. */
function extractMapLiteralExpressionFromCtx(mapLitCtx: ParseTreeNode): MapLiteralExpression | undefined {
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

/** Extract a value expression from a PropertyOrLabelsExpression (used for CONTAINS/IN/STARTS WITH/ENDS WITH RHS). */
function extractValueExpressionFromPropertyOrLabels(ctx: TreeNode): Expression | undefined {
  if (!ctx) return undefined;

  const atom = getAtom(ctx);
  if (!atom) return undefined;

  // Variable with optional property access
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

  // Function invocation
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

  // Literal: find LiteralContext child of Atom, check for map/list/regular literal
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

function extractValueExpression(ctx: TreeNode): Expression | undefined {
  if (!ctx) return undefined;

  // Check for list slice syntax (e.g., n.tags[0..2])
  const withParent = findPropOrLabelsWithParent(ctx);
  if (withParent) {
    const slice = extractListSlice(withParent.parent);
    if (slice) return slice;
  }

  // Arithmetic expressions (e.g., n.score * 2 in WHERE comparisons)
  const arith = extractArithmeticExpression(ctx);
  if (arith) return arith;

  const atom = getAtom(ctx);
  if (!atom) return undefined;

  const varCtx = findChild(atom, Ctx.Variable);
  if (varCtx) {
    const name = getSymbolicName(varCtx);
    if (name) {
      // Check for property access (e.g., u.name)
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

  // Function invocation
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

  // Literal: find LiteralContext child of Atom, check for map/list/regular literal
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

function extractRemoveClause(clauseCtx: ParseTreeNode): RemoveClause {
  const removeCtx = findChild(clauseCtx, Ctx.RemoveClause);
  if (!removeCtx) throw new Error('Failed to parse REMOVE: missing RemoveClause node.');

  const removeItems = findAllChildren(removeCtx, Ctx.RemoveItem);
  if (!removeItems.length) throw new Error('Failed to parse REMOVE: missing RemoveItem nodes.');

  const items: RemoveItem[] = [];
  for (const removeItem of removeItems) {
    // Check for property removal: PropertyExpression > Atom > Variable + PropertyLookup
    const propExpr = findChild(removeItem, Ctx.PropertyExpression);
    if (propExpr) {
      const atom = findChild(propExpr, Ctx.Atom);
      if (!atom) throw new Error('Failed to parse REMOVE property: missing Atom node.');
      const varCtx = findChild(atom, Ctx.Variable);
      const variable = getSymbolicName(varCtx);
      if (!variable) throw new Error('Failed to parse REMOVE property: missing variable name.');

      const propLookup = findChild(propExpr, Ctx.PropertyLookup);
      if (!propLookup) throw new Error('Failed to parse REMOVE property: missing PropertyLookup node.');
      const propKeyCtx = findChild(propLookup, Ctx.PropertyKey);
      const property = getSymbolicName(propKeyCtx);
      if (!property) throw new Error('Failed to parse REMOVE property: missing property name.');

      items.push({ variable, labels: undefined, property });
      continue;
    }

    // Label removal: Variable + NodeLabels
    const varCtx = findChild(removeItem, Ctx.Variable);
    const variable = getSymbolicName(varCtx);
    if (!variable) throw new Error('Failed to parse REMOVE label: missing variable name.');

    const labelsCtx = findChild(removeItem, Ctx.NodeLabels);
    const labelCtxs = labelsCtx ? findAllChildren(labelsCtx, Ctx.NodeLabel) : [];
    const labels = labelCtxs.length > 0
      ? labelCtxs.map((lc) => getSymbolicName(findChild(lc, Ctx.LabelName))).filter((l): l is string => !!l)
      : undefined;

    items.push({ variable, labels, property: undefined });
  }

  if (!items.length) throw new Error('Failed to parse REMOVE: no valid remove items found.');
  return { type: 'REMOVE' as const, items };
}

function extractWriteClause(clauseCtx: ParseTreeNode): WriteClause | undefined {
  // SET clause
  const setCtx = findChild(clauseCtx, Ctx.SetClause);
  if (setCtx) {
    const setItem = findChild(setCtx, Ctx.SetItem);
    if (!setItem) throw new Error('Failed to parse SET: missing SetItem node in AST.');

    // Check for SET with labels: SET n:Label (no PropertyExpression, just Variable + NodeLabels)
    const labelsCtx = findChild(setItem, Ctx.NodeLabels);
    const labelCtxs = labelsCtx ? findAllChildren(labelsCtx, Ctx.NodeLabel) : [];
    const labels = labelCtxs.length > 0
      ? labelCtxs.map((lc) => getSymbolicName(findChild(lc, Ctx.LabelName))).filter((l): l is string => !!l)
      : undefined;

    const propExpr = findChild(setItem, Ctx.PropertyExpression);
    if (propExpr) {
      // SET n.prop = val (property assignment)
      const atom = findChild(propExpr, Ctx.Atom);
      if (!atom) throw new Error('Failed to parse SET: missing Atom node in AST.');
      const varCtx = findChild(atom, Ctx.Variable);
      const variable = getSymbolicName(varCtx);
      if (!variable) throw new Error('Failed to parse SET: missing variable name.');

      const propLookup = findChild(propExpr, Ctx.PropertyLookup);
      if (!propLookup) throw new Error('Failed to parse SET: missing PropertyLookup node in AST.');
      const propKeyCtx = findChild(propLookup, Ctx.PropertyKey);
      const property = getSymbolicName(propKeyCtx);
      if (!property) throw new Error('Failed to parse SET: missing property name.');

      const exprCtx = findChild(setItem, Ctx.Expression);
      const valueExpr = evaluateExpression(exprCtx);
      if (!valueExpr) {
        throw new Error(`Failed to parse SET: could not extract value for "${variable}.${property}".`);
      }
      return { type: 'SET' as const, variable, property, value: valueExpr, labels };
    }

    if (labels && labels.length > 0) {
      // SET n:Label (label addition only, no property)
      const varCtx = findChild(setItem, Ctx.Variable);
      const variable = getSymbolicName(varCtx);
      if (!variable) throw new Error('Failed to parse SET: missing variable name.');
      return { type: 'SET' as const, variable, property: '', value: { type: 'Literal' as const, value: null as CypherLiteral }, labels };
    }

    throw new Error('Failed to parse SET: unsupported SET form.');
  }

  // CREATE clause
  const createCtx = findChild(clauseCtx, Ctx.CreateClause);
  if (createCtx) {
    const patternCtx = findChild(createCtx, Ctx.Pattern);
    if (!patternCtx) throw new Error('Failed to parse CREATE: missing Pattern node in AST.');
    const patternPart = findChild(patternCtx, Ctx.PatternPart);
    if (!patternPart) throw new Error('Failed to parse CREATE: missing PatternPart node in AST.');
    const anonPart = findChild(patternPart, Ctx.AnonymousPatternPart);
    if (!anonPart) throw new Error('Failed to parse CREATE: missing AnonymousPatternPart node in AST.');
    const element = findChild(anonPart, Ctx.PatternElement);
    if (!element) throw new Error('Failed to parse CREATE: missing PatternElement node in AST.');
    const nodePatternCtx = findChild(element, Ctx.NodePattern);
    if (!nodePatternCtx) throw new Error('Failed to parse CREATE: missing NodePattern node in AST.');

    const variable = getSymbolicName(findChild(nodePatternCtx, Ctx.Variable)) ?? '';
    const labelExpr = extractLabelExpression(nodePatternCtx);
    // CREATE only uses positive labels from the first expression (negation/union doesn't apply)
    const labels = labelExpr && labelExpr.labels.length > 0 ? labelExpr.labels : undefined;

    const propsCtx = findChild(nodePatternCtx, Ctx.Properties);
    const mapLitCtx = findChild(propsCtx, Ctx.MapLiteral);
    const properties = extractProperties(mapLitCtx);

    // Also extract dynamic property expressions (for FOREACH where values reference loop variables)
    const propertiesExpr = extractDynamicProperties(mapLitCtx);

    // Check for relationship chain: CREATE (a)-[r:TYPE]->(b)
    const nodePatterns = findAllChildren(element, Ctx.NodePattern);
    const chains = findAllChildren(element, Ctx.PatternElementChain);
    const hasChain = chains.length > 0;

    if (hasChain) {
      if (chains.length > 1) {
        throw new Error('Multi-hop CREATE patterns are not supported. Use multiple CREATE stages.');
      }
      const chain = chains[0];
      const relPatternCtx = findChild(chain, Ctx.RelationshipPattern);
      const relationPattern = extractRelationPattern(relPatternCtx);

      const targetNodeCtx = findChild(chain, Ctx.NodePattern);
      const targetPattern = targetNodeCtx ? extractNodePattern(targetNodeCtx) : { variable: '', labels: undefined, properties: undefined };

      // Extract target node properties separately
      const targetPropsCtx = findChild(targetNodeCtx, Ctx.Properties);
      const targetMapLitCtx = findChild(targetPropsCtx, Ctx.MapLiteral);
      const targetProperties = extractProperties(targetMapLitCtx);
      const targetPropertiesExpr = extractDynamicProperties(targetMapLitCtx);

      return {
        type: 'CREATE' as const,
        variable,
        labels,
        properties,
        propertiesExpr,
        hasChain: true,
        relationPattern,
        targetPattern,
        targetProperties,
        targetPropertiesExpr,
      };
    }

    // Single-node CREATE (backward compatible)
    return { type: 'CREATE' as const, variable, labels, properties, propertiesExpr, hasChain: false };
  }

  // DELETE clause
  const deleteCtx = findChild(clauseCtx, Ctx.DeleteClause);
  if (deleteCtx) {
    const exprCtx = findChild(deleteCtx, Ctx.Expression);
    if (!exprCtx) throw new Error('Failed to parse DELETE: missing Expression node in AST.');
    const atom = getAtom(exprCtx);
    if (!atom) throw new Error('Failed to parse DELETE: missing Atom node in AST.');
    const varCtx = findChild(atom, Ctx.Variable);
    const variable = getSymbolicName(varCtx);
    if (!variable) throw new Error('Failed to parse DELETE: missing variable name.');

    return { type: 'DELETE' as const, variable };
  }

  // REMOVE clause
  const removeCtx = findChild(clauseCtx, Ctx.RemoveClause);
  if (removeCtx) {
    return extractRemoveClause(clauseCtx);
  }

  return undefined;
}

function extractUnwindClause(clauseCtx: ParseTreeNode): UnwindClause | undefined {
  const unwindCtx = findChild(clauseCtx, Ctx.UnwindClause);
  if (!unwindCtx) return undefined;

  // Expression: the list to unwind (e.g., [1, 2, 3] or a variable reference)
  const exprCtx = findChild(unwindCtx, Ctx.Expression);
  const expr = evaluateExpression(exprCtx);
  if (!expr) throw new Error('Failed to parse UNWIND: missing list expression.');

  // Variable: the alias after AS (e.g., AS x)
  const varCtx = findChild(unwindCtx, Ctx.Variable);
  const variable = getSymbolicName(varCtx);
  if (!variable) throw new Error('Failed to parse UNWIND: missing variable after AS.');

  return { type: 'UNWIND' as const, expression: expr, variable };
}

// ── FOREACH clause extraction ────────────────────────────────────────────────

function extractForeachClause(clauseCtx: ParseTreeNode): ForeachClause | undefined {
  const foreachCtx = findChild(clauseCtx, Ctx.ForeachClause);
  if (!foreachCtx) return undefined;

  // Variable: loop variable (e.g., "x" in FOREACH (x IN ...))
  const varCtx = findChild(foreachCtx, Ctx.Variable);
  const variable = getSymbolicName(varCtx);
  if (!variable) throw new Error('Failed to parse FOREACH: missing loop variable.');

  // Expression: the list to iterate (e.g., n.tags)
  const exprCtx = findChild(foreachCtx, Ctx.Expression);
  const expr = evaluateExpression(exprCtx);
  if (!expr) throw new Error('Failed to parse FOREACH: missing list expression.');

  // Inner clause: the update clause after | (SET, CREATE, DELETE, REMOVE)
  // The inner Clause is a direct child of ForeachClauseContext
  const innerClauseCtxs = findAllChildren(foreachCtx, Ctx.Clause);
  if (innerClauseCtxs.length === 0) {
    throw new Error('Failed to parse FOREACH: missing inner update clause.');
  }
  const innerClauseCtx = innerClauseCtxs[innerClauseCtxs.length - 1]!; // last Clause child

  const innerClause = extractWriteClause(innerClauseCtx);
  if (!innerClause) {
    throw new Error('Failed to parse FOREACH: unsupported inner clause. Only SET, CREATE, DELETE, and REMOVE are supported.');
  }

  return { type: 'FOREACH' as const, variable, expression: expr, innerClause };
}

// ── MERGE clause extraction ──────────────────────────────────────────────────

function extractMergeSetActions(setCtx: TreeNode): MergeSetAction[] {
  if (!setCtx) return [];
  const actions: MergeSetAction[] = [];
  const setItems = findAllChildren(setCtx, Ctx.SetItem);
  for (const item of setItems) {
    const propExpr = findChild(item, Ctx.PropertyExpression);
    if (!propExpr) continue;
    const atom = findChild(propExpr, Ctx.Atom);
    if (!atom) continue;
    const varCtx = findChild(atom, Ctx.Variable);
    const variable = getSymbolicName(varCtx);
    if (!variable) continue;

    const propLookup = findChild(propExpr, Ctx.PropertyLookup);
    if (!propLookup) continue;
    const propKeyCtx = findChild(propLookup, Ctx.PropertyKey);
    const property = getSymbolicName(propKeyCtx);
    if (!property) continue;

    const exprCtx = findChild(item, Ctx.Expression);
    const valueExpr = evaluateExpression(exprCtx);
    if (!valueExpr) continue;

    actions.push({ variable, property, value: valueExpr });
  }
  return actions;
}

function extractMergeAction(actionCtx: TreeNode): MergeAction | undefined {
  if (!actionCtx) return undefined;

  const onCreate = hasTerminal(actionCtx, 'CREATE');
  const onMatch = hasTerminal(actionCtx, 'MATCH');

  if (!onCreate && !onMatch) return undefined;

  const setCtx = findChild(actionCtx, Ctx.SetClause);
  const setActions = setCtx ? extractMergeSetActions(setCtx) : [];

  // Extract DELETE variables from DeleteClause inside the action
  const deleteCtx = findChild(actionCtx, Ctx.DeleteClause);
  const deleteVariables: string[] = [];
  if (deleteCtx) {
    const exprCtx = findChild(deleteCtx, Ctx.Expression);
    if (exprCtx) {
      const atom = getAtom(exprCtx);
      if (atom) {
        const varCtx = findChild(atom, Ctx.Variable);
        const variable = getSymbolicName(varCtx);
        if (variable) deleteVariables.push(variable);
      }
    }
  }

  // Extract REMOVE items from RemoveClause inside the action
  const removeCtx = findChild(actionCtx, Ctx.RemoveClause);
  const removeItems: RemoveItem[] = [];
  if (removeCtx) {
    const removeItemsCtxs = findAllChildren(removeCtx, Ctx.RemoveItem);
    for (const removeItem of removeItemsCtxs) {
      // Property removal: PropertyExpression > Atom > Variable + PropertyLookup
      const propExpr = findChild(removeItem, Ctx.PropertyExpression);
      if (propExpr) {
        const atom = findChild(propExpr, Ctx.Atom);
        if (atom) {
          const varCtx = findChild(atom, Ctx.Variable);
          const variable = getSymbolicName(varCtx);
          if (variable) {
            const propLookup = findChild(propExpr, Ctx.PropertyLookup);
            const propKeyCtx = propLookup ? findChild(propLookup, Ctx.PropertyKey) : null;
            const property = getSymbolicName(propKeyCtx);
            if (property) {
              removeItems.push({ variable, labels: undefined, property });
            }
          }
        }
        continue;
      }

      // Label removal: Variable + NodeLabels
      const varCtx = findChild(removeItem, Ctx.Variable);
      const variable = getSymbolicName(varCtx);
      if (variable) {
        const labelsCtx = findChild(removeItem, Ctx.NodeLabels);
        const labelCtxs = labelsCtx ? findAllChildren(labelsCtx, Ctx.NodeLabel) : [];
        const labels = labelCtxs.length > 0
          ? labelCtxs.map((lc) => getSymbolicName(findChild(lc, Ctx.LabelName))).filter((l): l is string => !!l)
          : undefined;
        removeItems.push({ variable, labels, property: undefined });
      }
    }
  }

  return {
    actionType: onCreate ? 'CREATE' : 'MATCH',
    setActions,
    deleteVariables,
    removeItems,
  };
}

function extractMergeClause(clauseCtx: ParseTreeNode): MergeClause {
  const mergeCtx = findChild(clauseCtx, Ctx.MergeClause);
  if (!mergeCtx) throw new Error('Failed to parse MERGE: missing MergeClause node.');

  // MERGE has PatternPart directly (not wrapped in Pattern like MATCH does)
  const patternPart = findChild(mergeCtx, Ctx.PatternPart);
  if (!patternPart) throw new Error('Failed to parse MERGE: missing PatternPart node.');
  const anonPart = findChild(patternPart, Ctx.AnonymousPatternPart);
  if (!anonPart) throw new Error('Failed to parse MERGE: missing AnonymousPatternPart node.');
  const element = findChild(anonPart, Ctx.PatternElement);
  if (!element) throw new Error('Failed to parse MERGE: missing PatternElement node.');

  const nodePatterns = findAllChildren(element, Ctx.NodePattern);
  const chains = findAllChildren(element, Ctx.PatternElementChain);

  const sourcePattern = nodePatterns[0] ? extractNodePattern(nodePatterns[0]) : { variable: '', labels: undefined, properties: undefined };

  let relationPattern: RelationPattern = { variable: undefined, type: undefined, minDepth: undefined, maxDepth: undefined, direction: 'UNDIRECTED' };
  let targetPattern: NodePattern = { variable: '', labels: undefined, properties: undefined };

  const hasChains = chains.length > 0;

  if (chains.length > 1) {
    throw new Error('Multi-hop MERGE patterns are not supported. Use multiple MERGE stages.');
  }

  if (hasChains) {
    const chain = chains[0];
    const relPatternCtx = findChild(chain, Ctx.RelationshipPattern);
    relationPattern = extractRelationPattern(relPatternCtx);

    const targetNodeCtx = findChild(chain, Ctx.NodePattern);
    if (targetNodeCtx) {
      targetPattern = extractNodePattern(targetNodeCtx);
    }
  } else if (nodePatterns.length > 1) {
    targetPattern = extractNodePattern(nodePatterns[1]);
  }

  // Extract ON CREATE / ON MATCH actions
  const mergeActions = findAllChildren(mergeCtx, Ctx.MergeAction);
  let onCreate: MergeAction | undefined;
  let onMatch: MergeAction | undefined;

  for (const actionCtx of mergeActions) {
    const action = extractMergeAction(actionCtx);
    if (!action) continue;
    if (action.actionType === 'CREATE') {
      if (onCreate) throw new Error('Multiple ON CREATE actions are not supported in MERGE.');
      onCreate = action;
    } else {
      if (onMatch) throw new Error('Multiple ON MATCH actions are not supported in MERGE.');
      onMatch = action;
    }
  }

  // Extract WHERE clause (if present)
  const whereCtx = findChild(mergeCtx, Ctx.Where);
  const whereExpr = findChild(whereCtx, Ctx.Expression);
  const where = whereExpr ? extractWhereExpression(whereExpr) : undefined;

  return { type: 'MERGE', hasChains, sourcePattern, relationPattern, targetPattern, where, onCreate, onMatch };
}

// ── Main parser ──────────────────────────────────────────────────────────────

/**
 * Cache for synthetic ANTLR4 parsing results. Key is the synthetic query text.
 * Avoids re-parsing the same synthetic queries multiple times within a single parseCypher call.
 * Cleared at the end of each parseCypher call to prevent unbounded memory growth.
 */
const syntheticParseCache = new Map<string, { whereExpr: WhereExpression | undefined, returnClause: ReturnClause | undefined }>();

/**
 * Extract a WHERE expression from raw query text by tracking parentheses and strings.
 * More robust than regex for edge cases like `n.on = true` or keywords in strings.
 */
function extractWhereFromQuery(queryText: string): string | undefined {
  const whereIndex = queryText.search(/\)\s+WHERE\s+/i);
  if (whereIndex === -1) return undefined;

  // Skip past "WHERE "
  let start = queryText.indexOf('WHERE', whereIndex);
  if (start === -1) return undefined;
  start += 5; // Skip "WHERE"
  while (start < queryText.length && /\s/.test(queryText.charAt(start))) start++;

  // Find the end of the WHERE expression by tracking parentheses, brackets, and strings
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let stringChar = '';
  let end = start;

  while (end < queryText.length) {
    const char = queryText.charAt(end);

    if (inString) {
      if (char === stringChar && (end === 0 || queryText.charAt(end - 1) !== '\\')) {
        inString = false;
      }
    } else if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
    } else if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth--;
    } else if (char === '[') {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth--;
    } else if (parenDepth === 0 && bracketDepth === 0 && /\s/.test(char)) {
      // Check for top-level keywords
      const remaining = queryText.slice(end).trim();
      if (/^(ON\s+(CREATE|MATCH)|RETURN|MATCH|MERGE|WITH|UNWIND|FOREACH|;|$)/i.test(remaining)) {
        break;
      }
    }
    end++;
  }

  return queryText.slice(start, end).trim() || undefined;
}

/**
 * Extract an ON MATCH/ON CREATE action body from raw query text by tracking parentheses, brackets, and strings.
 */
function extractOnActionFromQuery(queryText: string, actionType: 'MATCH' | 'CREATE'): string | undefined {
  const regex = new RegExp(`ON\\s+${actionType}\\s+`, 'i');
  const match = queryText.match(regex);
  if (!match) return undefined;

  let start = match.index! + match[0].length;

  // Find the end by tracking parentheses, brackets, and strings
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let stringChar = '';
  let end = start;

  while (end < queryText.length) {
    const char = queryText.charAt(end);

    if (inString) {
      if (char === stringChar && (end === 0 || queryText.charAt(end - 1) !== '\\')) {
        inString = false;
      }
    } else if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
    } else if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth--;
    } else if (char === '[') {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth--;
    } else if (parenDepth === 0 && bracketDepth === 0 && /\s/.test(char)) {
      const remaining = queryText.slice(end).trim();
      const otherAction = actionType === 'MATCH' ? 'ON\s+CREATE' : 'ON\s+MATCH';
      if (new RegExp(`^(?:${otherAction}|RETURN|MATCH|MERGE|WITH|UNWIND|FOREACH|;|$)`, 'i').test(remaining)) {
        break;
      }
    }
    end++;
  }

  return queryText.slice(start, end).trim() || undefined;
}

/**
 * Split a comma-separated string while respecting parentheses, brackets, and strings.
 * Used to split SET assignments and REMOVE items without breaking list literals.
 */
function splitRespectingBrackets(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      current += char;
      if (char === stringChar && (i === 0 || text[i - 1] !== '\\')) {
        inString = false;
      }
    } else if (char === '"' || char === "'") {
      current += char;
      inString = true;
      stringChar = char;
    } else if (char === '(') {
      current += char;
      parenDepth++;
    } else if (char === ')') {
      current += char;
      parenDepth--;
    } else if (char === '[') {
      current += char;
      bracketDepth++;
    } else if (char === ']') {
      current += char;
      bracketDepth--;
    } else if (char === ',' && parenDepth === 0 && bracketDepth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Extract SET/DELETE/REMOVE from raw ON MATCH/ON CREATE text using regex.
 * Used as fallback when ANTLR4 crashes on DELETE/REMOVE in ON MATCH/ON CREATE.
 */
function extractMergeActionFromText(text: string, actionType: 'CREATE' | 'MATCH'): MergeAction | undefined {
  const setActions: MergeSetAction[] = [];
  const deleteVariables: string[] = [];
  const removeItems: RemoveItem[] = [];

  // Extract SET actions: SET var.prop = expr [, var2.prop2 = expr2]
  const setMatch = text.match(/SET\s+(.+?)(?:\s+DELETE|\s+REMOVE|\s*$)/i);
  if (setMatch) {
    const setText = setMatch[1]!.trim();
    // Parse each SET assignment using bracket-aware split
    for (const assignment of splitRespectingBrackets(setText)) {
      const setPartMatch = assignment.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+)\s*=\s*(.+)$/);
      if (setPartMatch) {
        const varName = setPartMatch[1]!;
        const property = setPartMatch[2]!;
        const valueText = setPartMatch[3]!.trim();
        // Parse the value expression using synthetic query
        const syntheticQuery = `MATCH (x) RETURN ${valueText} AS _v`;
        try {
          const syntheticChars = antlr4.CharStreams.fromString(syntheticQuery);
          const syntheticLexer = new CypherLexer(syntheticChars);
          const syntheticTokens = new antlr4.CommonTokenStream(syntheticLexer);
          const syntheticParser = new CypherParser(syntheticTokens);
          syntheticParser.removeErrorListeners();
          syntheticParser.addErrorListener(new ErrorCollector());
          const syntheticTree = syntheticParser.cypher();

          const findReturn = (node: any): any => {
            if (node.constructor.name === Ctx.ReturnClause) return node;
            if (node.children) {
              for (const child of node.children) {
                const found = findReturn(child);
                if (found) return found;
              }
            }
            return null;
          };

          const returnCtx = findReturn(syntheticTree);
          if (returnCtx) {
            const returnBody = findChild(returnCtx, Ctx.ReturnBody);
            const projections = extractReturnBody(returnBody);
            if (projections.length > 0) {
              setActions.push({ variable: varName, property, value: projections[0]!.expression });
            }
          }
        } catch {
          // Skip this SET action if parsing fails
        }
      }
    }
  }

  // Extract DELETE variables: DELETE var1, var2
  const deleteMatch = text.match(/DELETE\s+(.+?)(?:\s+REMOVE|\s*$)/i);
  if (deleteMatch) {
    const deleteText = deleteMatch[1]!.trim();
    for (const varRef of deleteText.split(/,\s*/)) {
      const v = varRef.trim();
      if (v) deleteVariables.push(v);
    }
  }

  // Extract REMOVE items: REMOVE var:Label1,Label2 or var.prop
  // Labels can be comma-separated (var:Label1,Label2) or dot-separated (var.prop).
  // We handle label removal by finding the first var:Label pattern and parsing
  // all labels after the colon until we hit a dot-separated property or end of text.
  const removeMatch = text.match(/REMOVE\s+(.+?)(?:\s*$)/i);
  if (removeMatch) {
    const removeText = removeMatch[1]!.trim();
    // Use bracket-aware split to handle complex expressions
    for (const item of splitRespectingBrackets(removeText)) {
      const itemText = item.trim();
      // Check for label removal: var:Label1,Label2
      const labelMatch = itemText.match(/^([a-zA-Z_][a-zA-Z0-9_]*):(.+)$/);
      if (labelMatch) {
        removeItems.push({ variable: labelMatch[1]!, labels: labelMatch[2]!.split(/\s*,\s*/), property: undefined });
      } else {
        // Property removal: var.prop
        const propMatch = itemText.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+)$/);
        if (propMatch) {
          removeItems.push({ variable: propMatch[1]!, labels: undefined, property: propMatch[2]! });
        }
      }
    }
  }

  if (setActions.length === 0 && deleteVariables.length === 0 && removeItems.length === 0) {
    return undefined;
  }

  return { actionType, setActions, deleteVariables, removeItems };
}

/**
 * Extract stages + return clause from a SingleQuery node.
 * Shared by both single-query and UNION branch parsing.
 */
function extractSingleQuery(singleQuery: ParseTreeNode, rawQuery?: string): AdvancedCypherAST {
  const stages: AdvancedCypherAST['stages'] = [];
  let returnClause: ReturnClause | undefined;

  const clauses = findAllChildren(singleQuery, Ctx.Clause);

  for (const clause of clauses) {
    if (findChild(clause, Ctx.MatchClause)) {
      stages.push({ type: 'MATCH', clause: extractMatchClause(clause) });
    } else if (findChild(clause, Ctx.ReturnClause)) {
      returnClause = extractReturnClause(clause);
    } else if (findChild(clause, Ctx.WithClause)) {
      const withClause = extractWithClause(clause);
      if (withClause) stages.push({ type: 'WITH', clause: withClause });
    } else if (findChild(clause, Ctx.SetClause)) {
      const writeClause = extractWriteClause(clause);
      if (writeClause) stages.push({ type: 'WRITE', clause: writeClause });
    } else if (findChild(clause, Ctx.CreateClause)) {
      const writeClause = extractWriteClause(clause);
      if (writeClause) stages.push({ type: 'WRITE', clause: writeClause });
    } else if (findChild(clause, Ctx.DeleteClause)) {
      const writeClause = extractWriteClause(clause);
      if (writeClause) stages.push({ type: 'WRITE', clause: writeClause });
    } else if (findChild(clause, Ctx.RemoveClause)) {
      const writeClause = extractWriteClause(clause);
      if (writeClause) stages.push({ type: 'WRITE', clause: writeClause });
    } else if (findChild(clause, Ctx.MergeClause)) {
      const mergeClause = extractMergeClause(clause);
      stages.push({ type: 'MERGE', clause: mergeClause });
    } else if (findChild(clause, Ctx.UnwindClause)) {
      const unwindClause = extractUnwindClause(clause);
      if (unwindClause) stages.push({ type: 'UNWIND', clause: unwindClause });
    } else if (findChild(clause, Ctx.ForeachClause)) {
      const foreachClause = extractForeachClause(clause);
      if (foreachClause) stages.push({ type: 'FOREACH', clause: foreachClause });
    }
  }

  // ── Post-process: re-associate DELETE/REMOVE after MERGE ON MATCH/ON CREATE ──
  // ANTLR4 parses "ON MATCH DELETE n" as: MergeAction (empty) + separate DeleteClause.
  // We detect DELETE/REMOVE clauses that follow a MERGE and attach them to the MERGE action.
  const queryText = rawQuery ?? singleQuery.getText();
  for (let i = 0; i < stages.length - 1; i++) {
    if (stages[i]?.type !== 'MERGE') continue;
    const mergeClause = stages[i]!.clause as MergeClause;
    const nextStage = stages[i + 1];

    // Check if next stage is a WRITE (DELETE/REMOVE) that should belong to the MERGE action
    if (nextStage?.type === 'WRITE') {
      const writeClause = nextStage.clause as WriteClause;
      // Determine target action: prefer ON MATCH, fallback to ON CREATE.
      // If neither exists, check raw query for ON MATCH/ON CREATE and create empty action.
      let targetAction = mergeClause.onMatch || mergeClause.onCreate;
      if (!targetAction) {
        // Check raw query for ON MATCH/ON CREATE (ANTLR4 might have dropped them)
        const hasOnMatch = /ON\s+MATCH\b/i.test(queryText);
        const hasOnCreate = /ON\s+CREATE\b/i.test(queryText);
        if (hasOnMatch) {
          mergeClause.onMatch = { actionType: 'MATCH', setActions: [], deleteVariables: [], removeItems: [] };
          targetAction = mergeClause.onMatch;
        } else if (hasOnCreate) {
          mergeClause.onCreate = { actionType: 'CREATE', setActions: [], deleteVariables: [], removeItems: [] };
          targetAction = mergeClause.onCreate;
        }
      }
      if (targetAction) {
        if (writeClause.type === 'DELETE') {
          targetAction.deleteVariables.push(writeClause.variable);
          stages.splice(i + 1, 1);
          i--; // Adjust index after splice
        } else if (writeClause.type === 'REMOVE') {
          targetAction.removeItems.push(...writeClause.items);
          stages.splice(i + 1, 1);
          i--; // Adjust index after splice
        }
      }
    }
  }

  // ── Post-process: extract WHERE + ON CREATE/ON MATCH from raw query for MERGE clauses ──
  // ANTLR4 drops WHERE after MERGE entirely (and everything after it), so we extract
  // both WHERE and ON CREATE/ON MATCH from the raw query text.
  for (const stage of stages) {
    if (stage.type !== 'MERGE') continue;
    const mergeClause = stage.clause as MergeClause;

    // Extract WHERE from raw query using smart extraction (handles edge cases)
    if (!mergeClause.where) {
      const whereText = extractWhereFromQuery(queryText);
      if (whereText) {
        const syntheticQuery = `MATCH (x) WHERE ${whereText} RETURN x`;
        // Check cache first
        let cachedResult = syntheticParseCache.get(syntheticQuery);
        if (!cachedResult) {
          try {
            const syntheticChars = antlr4.CharStreams.fromString(syntheticQuery);
            const syntheticLexer = new CypherLexer(syntheticChars);
            const syntheticTokens = new antlr4.CommonTokenStream(syntheticLexer);
            const syntheticParser = new CypherParser(syntheticTokens);
            syntheticParser.removeErrorListeners();
            syntheticParser.addErrorListener(new ErrorCollector());
            const syntheticTree = syntheticParser.cypher();

            const findWhere = (node: any): any => {
              if (node.constructor.name === Ctx.Where) return node;
              if (node.children) {
                for (const child of node.children) {
                  const found = findWhere(child);
                  if (found) return found;
                }
              }
              return null;
            };

            const whereCtx = findWhere(syntheticTree);
            let whereExpr: WhereExpression | undefined;
            if (whereCtx) {
              const expr = findChild(whereCtx, Ctx.Expression);
              whereExpr = expr ? extractWhereExpression(expr) : undefined;
            }
            cachedResult = { whereExpr, returnClause: undefined };
            syntheticParseCache.set(syntheticQuery, cachedResult);
          } catch {
            // If parsing fails, silently skip WHERE extraction
            cachedResult = { whereExpr: undefined, returnClause: undefined };
            syntheticParseCache.set(syntheticQuery, cachedResult);
          }
        }
        if (cachedResult.whereExpr) {
          mergeClause.where = cachedResult.whereExpr;
        }
      }
    }

    // Extract ON CREATE/ON MATCH from raw query (when ANTLR4 dropped them due to WHERE)
    if (!mergeClause.onCreate || !mergeClause.onMatch) {
      const onMatchText = extractOnActionFromQuery(queryText, 'MATCH');
      const onCreateText = extractOnActionFromQuery(queryText, 'CREATE');

      // Extract SET/DELETE/REMOVE from raw text using regex.
      // ANTLR4 drops WHERE after MERGE (and everything after it), so we extract
      // ON CREATE/ON MATCH from the raw query text directly.
      if (onMatchText && !mergeClause.onMatch) {
        const fromText = extractMergeActionFromText(onMatchText, 'MATCH');
        if (fromText) {
          mergeClause.onMatch = fromText;
        }
      }
      if (onCreateText && !mergeClause.onCreate) {
        const fromText = extractMergeActionFromText(onCreateText, 'CREATE');
        if (fromText) {
          mergeClause.onCreate = fromText;
        }
      }
    }
  }

  // ── Post-process: extract RETURN from raw query when ANTLR4 dropped it ──
  // ANTLR4 drops RETURN after MERGE with WHERE, so extract from raw query.
  if (!returnClause) {
    const returnMatch = queryText.match(/RETURN\s+(.+?)(?:\s*;|\s*$)/i);
    if (returnMatch) {
      const returnText = returnMatch[1]!.trim();
      const syntheticQuery = `MATCH (x) RETURN ${returnText}`;
      // Check cache first
      let cachedResult = syntheticParseCache.get(syntheticQuery);
      if (!cachedResult) {
        try {
          const syntheticChars = antlr4.CharStreams.fromString(syntheticQuery);
          const syntheticLexer = new CypherLexer(syntheticChars);
          const syntheticTokens = new antlr4.CommonTokenStream(syntheticLexer);
          const syntheticParser = new CypherParser(syntheticTokens);
          syntheticParser.removeErrorListeners();
          syntheticParser.addErrorListener(new ErrorCollector());
          const syntheticTree = syntheticParser.cypher();

          const findReturn = (node: any): any => {
            if (node.constructor.name === Ctx.ReturnClause) return node;
            if (node.children) {
              for (const child of node.children) {
                const found = findReturn(child);
                if (found) return found;
              }
            }
            return null;
          };

          const returnCtx = findReturn(syntheticTree);
          let extractedReturn: ReturnClause | undefined;
          if (returnCtx) {
            // Extract directly from ReturnClauseContext (extractReturnClause expects ClauseContext)
            const returnBody = findChild(returnCtx, Ctx.ReturnBody);
            let projections = extractReturnBody(returnBody);
            const orderBy = extractOrderBy(returnBody);
            const skip = extractSkip(returnBody);
            const limit = extractLimit(returnBody);
            const hasDistinct = hasTerminal(returnCtx, 'DISTINCT');
            if (hasDistinct) {
              projections = projections.map((p) => ({ ...p, distinct: true }));
            }
            extractedReturn = { projections, orderBy, skip, limit };
          }
          cachedResult = { whereExpr: undefined, returnClause: extractedReturn };
          syntheticParseCache.set(syntheticQuery, cachedResult);
        } catch {
          // If parsing fails, silently skip RETURN extraction
          cachedResult = { whereExpr: undefined, returnClause: undefined };
          syntheticParseCache.set(syntheticQuery, cachedResult);
        }
      }
      if (cachedResult.returnClause) {
        returnClause = cachedResult.returnClause;
      }
    }
  }

  return { type: 'Query', stages, return: returnClause };
}

export function parseCypher(query: string): CypherAST {
  ensureContextNamesValid();

  const chars = antlr4.CharStreams.fromString(query);
  const lexer = new CypherLexer(chars);
  const tokens = new antlr4.CommonTokenStream(lexer);
  const parser = new CypherParser(tokens);

  const collector = new ErrorCollector();
  parser.removeErrorListeners();
  parser.addErrorListener(collector);

  const tree = parser.cypher();

  // Filter out "expected" errors from label expressions (|, !) which the ANTLR4
  // grammar doesn't support but we handle via ErrorNodeImpl parsing.
  // Only suppress errors that look like they originate from a node pattern.
  const unexpectedErrors = collector.errors.filter((err) => {
    // Label union pipe: expects '{' or ')' after a label
    const isLabelUnionPipe = err.includes("mismatched input '|'") &&
      (err.includes("expecting {'{") || err.includes("expecting {')"));
    // Label negation: the expected tokens start with CYPHER (statement-level).
    // WHERE !x errors also say "extraneous input '!'," but include expression
    // tokens ('-', '+') before CYPHER in the expected list.
    const isLabelNegation = err.includes("extraneous input '!'") &&
      err.includes("expecting {CYPHER");
    // Label colon: expects '{' or ')' after a label
    const isLabelColon = (err.includes("mismatched input ':'") || err.includes("extraneous input ':'")) &&
      (err.includes("expecting {'{") || err.includes("expecting {')"));
    // WHERE on MERGE: ANTLR4 grammar doesn't support WHERE after MERGE pattern
    const isMergeWhere = err.includes("mismatched input 'WHERE'") &&
      (err.includes("expecting {<EOF>") || err.includes("expecting {';'}"));
    // DELETE/REMOVE in ON CREATE/ON MATCH: ANTLR4 expects SET but we support DELETE/REMOVE too
    const isMergeDeleteOrRemove = (err.includes("missing SET at 'DELETE'") || err.includes("missing SET at 'REMOVE'"));
    if (isLabelUnionPipe || isLabelNegation || isLabelColon || isMergeWhere || isMergeDeleteOrRemove) return false;
    return true;
  });

  if (unexpectedErrors.length > 0) {
    throw new Error(`Failed to parse Cypher query: ${unexpectedErrors.join('; ')}`);
  }

  const cypherPart = tree.children?.[0];
  const cypherQuery = findChild(cypherPart, Ctx.CypherQuery);
  const statement = findChild(cypherQuery, Ctx.Statement);
  const queryCtx = findChild(statement, Ctx.Query);
  const regularQuery = findChild(queryCtx, Ctx.RegularQuery);

  // Check for UNION branches at the RegularQuery level.
  // The ANTLR4 grammar structures UNION as:
  //   RegularQuery → SingleQuery (TerminalNode[SP] Union)*
  // where Union → UNION [ALL] SingleQuery
  // The first SingleQuery is a direct child of RegularQuery.
  // Subsequent SingleQueries are inside each Union context.
  const rqChildren = regularQuery?.children;
  if (rqChildren) {
    const unions = rqChildren.filter(
      (c: ParseTreeNode) => c.constructor.name === Ctx.Union,
    ) as ParseTreeNode[];

    if (unions.length > 0) {
      const branches: AdvancedCypherAST[] = [];
      const unionTypes: (UnionType | null)[] = [null]; // first branch

      // First branch: direct SingleQuery child of RegularQuery
      const firstSingleQuery = rqChildren.find(
        (c: ParseTreeNode) => c.constructor.name === Ctx.SingleQuery,
      ) as ParseTreeNode | undefined;
      if (firstSingleQuery) {
        branches.push(extractSingleQuery(firstSingleQuery, query));
      }

      // Subsequent branches: SingleQuery inside each Union
      for (let i = 0; i < unions.length; i++) {
        const union = unions[i]!;
        const isUnionAll = hasTerminal(union, 'ALL');
        // Push the union type that precedes the next branch
        unionTypes.push(isUnionAll ? 'UNION ALL' : 'UNION');

        const branchQuery = findChild(union, Ctx.SingleQuery);
        if (branchQuery) {
          branches.push(extractSingleQuery(branchQuery, query));
        }
      }

      // Extract ORDER BY / SKIP / LIMIT from the last branch's RETURN clause.
      // In the ANTLR4 grammar, these are attached to the last SingleQuery's
      // ReturnClause, but semantically they apply to the entire UNION result.
      const lastBranch = branches[branches.length - 1];
      let unionOrderBy: OrderByItem[] | undefined;
      let unionSkip: number | undefined;
      let unionLimit: number | undefined;
      if (lastBranch?.return) {
        const ret = lastBranch.return;
        if (ret.orderBy || ret.skip !== undefined || ret.limit !== undefined) {
          unionOrderBy = ret.orderBy;
          unionSkip = ret.skip;
          unionLimit = ret.limit;
          // Clear from last branch so they're not applied twice
          lastBranch.return = { ...ret, orderBy: undefined, skip: undefined, limit: undefined };
        }
      }

      syntheticParseCache.clear();
      return { type: 'UnionQuery', branches, unionTypes, orderBy: unionOrderBy, skip: unionSkip, limit: unionLimit };
    }
  }

  // Single query (no UNION)
  const singleQuery = findChild(regularQuery, Ctx.SingleQuery);
  if (!singleQuery) {
    syntheticParseCache.clear();
    return { type: 'Query', stages: [], return: undefined };
  }

  const result = extractSingleQuery(singleQuery, query);
  syntheticParseCache.clear();
  return result;
}
