import { createRequire } from 'module';
import type { ParseTreeNode, RecognitionException, BaseErrorListener } from 'antlr4';

const _require = createRequire(import.meta.url);
const antlr4 = _require('antlr4').default;
const { CypherLexer, CypherParser } = _require('@neo4j-cypher/antlr4');

// ── Context name constants ───────────────────────────────────────────────────
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
  DoubleLiteral: 'DoubleLiteralContext',
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
  CallContext: 'CallContext',
  ShortestPathPatternFunction: 'ShortestPathPatternFunctionContext',
  ShortestPathFunctionName: 'ShortestPathFunctionNameContext',
  AllShortestPathFunctionName: 'AllShortestPathFunctionNameContext',
  ReduceFunction: 'ReduceFunctionContext',
  ReduceFunctionName: 'ReduceFunctionNameContext',
  IdInColl: 'IdInCollContext',
  AllFunction: 'AllFunctionContext',
  AllFunctionName: 'AllFunctionNameContext',
  AnyFunction: 'AnyFunctionContext',
  AnyFunctionName: 'AnyFunctionNameContext',
  SingleFunction: 'SingleFunctionContext',
  SingleFunctionName: 'SingleFunctionNameContext',
  NoneFunction: 'NoneFunctionContext',
  NoneFunctionName: 'NoneFunctionNameContext',
  ExistsFunction: 'ExistsFunctionContext',
  ExistsFunctionName: 'ExistsFunctionNameContext',
  FilterExpression: 'FilterExpressionContext',
  ListComprehension: 'ListComprehensionContext',
  PatternComprehension: 'PatternComprehensionContext',
  RelationshipsPattern: 'RelationshipsPatternContext',
} as const;

export { Ctx };

/**
 * Sanity-check: verify that core ANTLR4 context classes are present.
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

  const required = [
    Ctx.CypherQuery, Ctx.Statement, Ctx.Query, Ctx.RegularQuery, Ctx.SingleQuery,
    Ctx.Clause, Ctx.MatchClause, Ctx.ReturnClause, Ctx.ReturnBody, Ctx.ReturnItems,
    Ctx.ReturnItem, Ctx.Expression, Ctx.Atom, Ctx.Variable, Ctx.SymbolicName,
    Ctx.Pattern, Ctx.PatternPart, Ctx.AnonymousPatternPart, Ctx.PatternElement,
    Ctx.NodePattern, Ctx.TerminalNode,
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

export function ensureContextNamesValid(): void {
  if (contextNamesValidated) return;
  if (process.env.NODE_ENV === 'test') return;
  validateContextNames();
  contextNamesValidated = true;
}

if (process.env.NODE_ENV === 'development') {
  validateContextNames();
}

// ── Error listener ───────────────────────────────────────────────────────────

/** Collects ANTLR4 parse errors so we can throw a clean message instead of crashing. */
export class ErrorCollector implements BaseErrorListener {
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

  reportAmbiguity(): void {}
  reportAttemptingFullContext(): void {}
  reportContextSensitivity(): void {}
}

// Set of aggregation function names (case-insensitive check at call site).
export const AGGREGATION_FUNCTIONS = new Set(['count', 'sum', 'avg', 'min', 'max', 'collect']);

// ── Tree helpers ─────────────────────────────────────────────────────────────

export type TreeNode = ParseTreeNode | null | undefined;

// Re-export WhereExpression for use by clause-parser
import type { WhereExpression } from '../types/cypher';


export function findPropertyLookup(exprCtx: TreeNode): ParseTreeNode | null {
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

export function findChild(ctx: TreeNode, name: string): ParseTreeNode | null {
  if (!ctx?.children) return null;
  return ctx.children.find((c: ParseTreeNode) => c.constructor.name === name) ?? null;
}

export function findAllChildren(ctx: TreeNode, name: string): ParseTreeNode[] {
  if (!ctx?.children) return [];
  return ctx.children.filter((c: ParseTreeNode) => c.constructor.name === name);
}

export function hasTerminal(ctx: TreeNode, text: string): boolean {
  if (!ctx?.children) return false;
  return ctx.children.some((c: ParseTreeNode) => c.symbol?.text === text);
}

export function getTerminalText(ctx: TreeNode): string | undefined {
  if (!ctx) return undefined;
  const term = findChild(ctx, Ctx.TerminalNode);
  return term?.symbol?.text;
}

export function getSymbolicName(ctx: TreeNode): string | undefined {
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

// ── Arithmetic operator helpers ──────────────────────────────────────────────

export type ArithOperator = '+' | '-' | '*' | '/' | '%' | '^';

/** Find operator terminals at a given context level. Returns { operator, index } pairs. */
export function findArithmeticOperators(ctx: TreeNode): { operator: ArithOperator; index: number }[] {
  if (!ctx?.children) return [];
  const operators: ArithOperator[] = ['+', '-', '*', '/', '%', '^'];
  const results: { operator: ArithOperator; index: number }[] = [];
  for (let i = 0; i < ctx.children!.length; i++) {
    const c = ctx.children![i];
    if (c?.constructor.name === Ctx.TerminalNode && operators.includes(c.symbol?.text as ArithOperator)) {
      results.push({ operator: c.symbol!.text as ArithOperator, index: i });
    }
  }
  return results;
}

/** Split children into segments separated by operator indices. */
export function splitChildrenByOperators(children: ParseTreeNode[], operatorIndices: number[]): ParseTreeNode[][] {
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

// ── Descendant helpers ───────────────────────────────────────────────────────

/** Find the first descendant with the given constructor name (depth-first). */
export function findDescendant(ctx: TreeNode, name: string): ParseTreeNode | undefined {
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

/** Find the first descendant with the given constructor name, stopping at ListLiteral, FunctionInvocation, ListComprehension, PatternComprehension, and quantifier/exists function boundaries. */
export function findDescendantOutsideCompound(ctx: TreeNode, name: string): ParseTreeNode | undefined {
  if (!ctx) return undefined;
  if (ctx.constructor.name === name) return ctx as ParseTreeNode;
  if (ctx.children) {
    for (const child of ctx.children) {
      if (child.constructor.name === Ctx.ListLiteral) continue;
      if (child.constructor.name === Ctx.FunctionInvocation) continue;
      if (child.constructor.name === Ctx.ListComprehension) continue;
      if (child.constructor.name === Ctx.PatternComprehension) continue;
      if (child.constructor.name === Ctx.ExistsFunction) continue;
      if (child.constructor.name === Ctx.AllFunction) continue;
      if (child.constructor.name === Ctx.AnyFunction) continue;
      if (child.constructor.name === Ctx.SingleFunction) continue;
      if (child.constructor.name === Ctx.NoneFunction) continue;
      const found = findDescendantOutsideCompound(child, name);
      if (found) return found;
    }
  }
  return undefined;
}

// ── Synthetic tree builder ───────────────────────────────────────────────────

/** Build a synthetic ParseTreeNode from an array of child nodes. */
export function buildSyntheticTree(children: ParseTreeNode[]): ParseTreeNode {
  const filtered = children.filter((c: ParseTreeNode) => {
    if (c.constructor.name === Ctx.TerminalNode) {
      return c.symbol?.text && c.symbol.text.trim() !== '';
    }
    return true;
  });

  const nonTerminals = filtered.filter((c: ParseTreeNode) => c.constructor.name !== Ctx.TerminalNode);
  if (nonTerminals.length === 1) return nonTerminals[0]!;
  if (filtered.length > 0) return filtered[0]!;
  return { constructor: { name: 'SyntheticNode' }, children: filtered } as unknown as ParseTreeNode;
}

// ── NOT helpers ──────────────────────────────────────────────────────────────

/** Check if a NotExpression actually has a NOT terminal (vs being a transparent wrapper). */
export function hasNotTerminal(ctx: TreeNode): boolean {
  if (!ctx || ctx.constructor.name !== Ctx.NotExpression || !ctx.children) return false;
  return ctx.children.some((c: ParseTreeNode) =>
    c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'NOT',
  );
}

/** Count NOT terminals in a NotExpression (for double/triple NOT support). */
export function countNotTerminals(ctx: TreeNode): number {
  if (!ctx || ctx.constructor.name !== Ctx.NotExpression || !ctx.children) return 0;
  return ctx.children.filter((c: ParseTreeNode) =>
    c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'NOT',
  ).length;
}

/** Wrap an inner expression in N NotExpression nodes (for double/triple NOT). */
export function wrapInNotExpressions(inner: WhereExpression, count: number): WhereExpression {
  let result: WhereExpression = inner;
  for (let i = 0; i < count; i++) {
    result = { type: 'NotExpression' as const, expression: result };
  }
  return result;
}

// ── String helpers ───────────────────────────────────────────────────────────

/**
 * Strip surrounding quotes and handle common escape sequences in a string literal.
 */
export function unescapeStringLiteral(raw: string): string {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }
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

// ── Bracket-aware string splitting ───────────────────────────────────────────

/**
 * Split a comma-separated string while respecting parentheses, brackets, and strings.
 */
export function splitRespectingBrackets(text: string): string[] {
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
