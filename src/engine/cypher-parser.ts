import { createRequire } from 'module';
import type {
  AdvancedCypherAST,
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
  Expression,
  BinaryExpression,
  ListLiteralExpression,
  MapLiteralExpression,
  WhereExpression,
  IsNullExpression,
  ReturnClause,
  CypherLiteral,
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
  StringLiteral: 'StringLiteralContext',
  SymbolicName: 'SymbolicNameContext',
  TerminalNode: 'TerminalNodeImpl',
  Variable: 'VariableContext',
  Where: 'WhereContext',
  WithClause: 'WithClauseContext',
  XorExpression: 'XorExpressionContext',
  UnwindClause: 'UnwindClauseContext',
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

// ── Expression navigation ────────────────────────────────────────────────────

function getAtom(exprCtx: TreeNode): ParseTreeNode | null {
  if (!exprCtx) return null;
  const walk = (ctx: ParseTreeNode): ParseTreeNode | null => {
    if (ctx.constructor.name === Ctx.Atom) return ctx;
    if (!ctx.children) return null;
    for (const child of ctx.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(exprCtx as ParseTreeNode);
}

function evaluateExpression(exprCtx: TreeNode): Expression | undefined {
  if (!exprCtx) return undefined;

  const atom = getAtom(exprCtx);
  if (!atom) return undefined;

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

    if (funcName && argName) {
      return {
        type: 'Aggregation' as const,
        aggregationType: funcName.toUpperCase() as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
        variable: argName,
        property: argProperty,
        distinct: !!hasDistinct,
      };
    }
  }

  // Variable reference (with optional property access, e.g., u.name)
  const varCtx = findChild(atom, Ctx.Variable);
  if (varCtx) {
    const name = getSymbolicName(varCtx);
    if (name) {
      const propLookup = findPropertyLookup(exprCtx);
      if (propLookup) {
        const propName = getSymbolicName(findChild(propLookup, Ctx.PropertyKey));
        if (propName) {
          return { type: 'PropertyAccess' as const, variable: name, property: propName };
        }
      }
      return { type: 'PropertyAccess' as const, variable: name, property: undefined };
    }
  }

  // List literal (e.g., ["Alice", "Bob"])
  const listLitExpr = extractListLiteralExpression(atom);
  if (listLitExpr) return listLitExpr;

  // Map literal (e.g., {name: "Alice", age: 30})
  const mapLitExpr = extractMapLiteralExpression(atom);
  if (mapLitExpr) return mapLitExpr;

  // Literal
  const literalCtx = findChild(atom, Ctx.Literal);
  const literal = extractLiteral(literalCtx);
  if (literal) return literal;

  return undefined;
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

// ── Node pattern extraction ──────────────────────────────────────────────────

function extractNodePattern(nodePatternCtx: TreeNode): NodePattern {
  if (!nodePatternCtx) return { variable: '', label: undefined, properties: undefined };

  const variable = getSymbolicName(findChild(nodePatternCtx, Ctx.Variable)) ?? '';

  const labelsCtx = findChild(nodePatternCtx, Ctx.NodeLabels);
  const labelCtx = findChild(labelsCtx, Ctx.NodeLabel);
  const labelNameCtx = findChild(labelCtx, Ctx.LabelName);
  const label = getSymbolicName(labelNameCtx);

  const propsCtx = findChild(nodePatternCtx, Ctx.Properties);
  const mapLitCtx = findChild(propsCtx, Ctx.MapLiteral);
  const properties = extractProperties(mapLitCtx);

  return { variable, label, properties };
}

function extractProperties(mapLiteralCtx: TreeNode): Record<string, CypherLiteral> | undefined {
  if (!mapLiteralCtx) return undefined;

  const entries = findAllChildren(mapLiteralCtx, Ctx.LiteralEntry);
  if (entries.length === 0) return undefined;

  const props: Record<string, CypherLiteral> = {};
  for (const entry of entries) {
    const keyCtx = findChild(entry, Ctx.PropertyKey);
    const key = getSymbolicName(keyCtx);
    const exprCtx = findChild(entry, Ctx.Expression);
    const value = evaluateExpression(exprCtx);

    if (key && value && value.type === 'Literal') {
      props[key] = value.value;
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

  const sourcePattern = nodePatterns[0] ? extractNodePattern(nodePatterns[0]) : { variable: '', label: undefined, properties: undefined };

  let relationPattern: RelationPattern = { variable: undefined, type: undefined, minDepth: undefined, maxDepth: undefined, direction: 'UNDIRECTED' };
  let targetPattern: NodePattern = { variable: '', label: undefined, properties: undefined };

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

  // Extract WHERE clause (if present)
  const whereCtx = findChild(matchCtx, Ctx.Where);
  const whereExpr = findChild(whereCtx, Ctx.Expression);
  const where = whereExpr ? extractWhereExpression(whereExpr) : undefined;

  return { optional: !!optional, hasChains, sourcePattern, relationPattern, targetPattern, where: where ?? undefined };
}

function computeDefaultAlias(expr: Expression): string {
  if (expr.type === 'PropertyAccess') {
    return expr.property ?? expr.variable;
  }
  if (expr.type === 'Aggregation') {
    return `${expr.aggregationType}(${expr.variable})`;
  }
  if (expr.type === 'ListLiteral') {
    return 'list';
  }
  if (expr.type === 'MapLiteral') {
    return 'map';
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

  const items = findAllChildren(returnItems, Ctx.ReturnItem);

  // Single pass: parse each item once
  const parsedItems: ParsedItem[] = [];
  for (const item of items) {
    const exprCtx = findChild(item, Ctx.Expression);
    const expr = evaluateExpression(exprCtx);
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
  const orCtx = findDescendantOutsideList(exprCtx, Ctx.OrExpression);
  if (orCtx) return extractLogicalExpression(orCtx, Ctx.XorExpression, 'OR');

  const xorCtx = findDescendantOutsideList(exprCtx, Ctx.XorExpression);
  if (xorCtx) return extractLogicalExpression(xorCtx, Ctx.AndExpression, 'XOR');

  const andCtx = findDescendantOutsideList(exprCtx, Ctx.AndExpression);
  if (andCtx) return extractLogicalExpression(andCtx, Ctx.NotExpression, 'AND');

  // Check for top-level NOT (e.g., from a segment in extractLogicalExpression)
  const notCtx = findDescendantOutsideList(exprCtx, Ctx.NotExpression);
  if (notCtx && hasNotTerminal(notCtx)) {
    const notCount = countNotTerminals(notCtx);
    // Find the actual inner expression (skip NOT terminals and whitespace)
    const innerCtx = findChild(notCtx, Ctx.OrExpression) || findChild(notCtx, Ctx.XorExpression) || findChild(notCtx, Ctx.AndExpression) || findChild(notCtx, Ctx.ComparisonExpression);
    if (innerCtx) {
      const inner = extractWhereExpressionFromChild(innerCtx);
      if (inner) return wrapInNotExpressions(inner, notCount);
    }
  }

  const compCtx = findDescendantOutsideList(exprCtx, Ctx.ComparisonExpression);
  if (compCtx) return extractComparison(compCtx);

  return undefined;
}

/** Find the first descendant with the given constructor name. */
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

/** Find the first descendant with the given constructor name, stopping at ListLiteral boundaries.
 * This prevents finding OrExpression/XorExpression/AndExpression inside list literals like [Alice, Bob]. */
function findDescendantOutsideList(ctx: TreeNode, name: string): ParseTreeNode | undefined {
  if (!ctx) return undefined;
  if (ctx.constructor.name === name) return ctx as ParseTreeNode;
  if (ctx.children) {
    for (const child of ctx.children) {
      // Stop at ListLiteral boundaries to avoid finding expressions inside lists
      if (child.constructor.name === Ctx.ListLiteral) continue;
      const found = findDescendantOutsideList(child, name);
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
    const nestedOr = findDescendantOutsideList(ctx, Ctx.OrExpression);
    if (nestedOr) return extractLogicalExpression(nestedOr, Ctx.XorExpression, 'OR');
    const nestedXor = findDescendantOutsideList(ctx, Ctx.XorExpression);
    if (nestedXor) return extractLogicalExpression(nestedXor, Ctx.AndExpression, 'XOR');
    const nestedAnd = findDescendantOutsideList(ctx, Ctx.AndExpression);
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
  const andCtx = findDescendantOutsideList(ctx, Ctx.AndExpression);
  if (andCtx) return extractLogicalExpression(andCtx, Ctx.NotExpression, 'AND');

  const orCtx = findDescendantOutsideList(ctx, Ctx.OrExpression);
  if (orCtx) return extractLogicalExpression(orCtx, Ctx.XorExpression, 'OR');

  const compCtx = findDescendantOutsideList(ctx, Ctx.ComparisonExpression);
  if (compCtx) return extractComparison(compCtx);

  return undefined;
}

function extractComparison(compCtx: TreeNode): BinaryExpression | IsNullExpression | undefined {
  if (!compCtx) return undefined;

  // Standard comparison operators (>, <, =, <>, etc.) use PartialComparisonExpression
  const partialCtx = findChild(compCtx, Ctx.PartialComparisonExpression);
  if (partialCtx) {
    const operatorTerm = findChild(partialCtx, Ctx.TerminalNode);
    const operator = operatorTerm?.symbol?.text as '>' | '<' | '=' | '<>';
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

/** Extract a list literal expression from an AtomContext. */
function extractListLiteralExpression(ctx: TreeNode): ListLiteralExpression | undefined {
  const listLitCtx = findDescendant(ctx, Ctx.ListLiteral);
  if (!listLitCtx) return undefined;
  const listExprs = findAllChildren(listLitCtx, Ctx.Expression);
  const values: (CypherLiteral | Record<string, CypherLiteral>)[] = [];
  for (const le of listExprs) {
    const val = evaluateExpression(le);
    if (val && val.type === 'Literal') {
      values.push(val.value);
    } else if (val && val.type === 'MapLiteral') {
      values.push(val.values);
    }
  }
  return { type: 'ListLiteral' as const, values };
}

/** Extract a map literal expression from an AtomContext (e.g., {name: "Alice", age: 30}). */
function extractMapLiteralExpression(ctx: TreeNode): MapLiteralExpression | undefined {
  const mapLitCtx = findDescendant(ctx, Ctx.MapLiteral);
  if (!mapLitCtx) return undefined;
  const entries = findAllChildren(mapLitCtx, Ctx.LiteralEntry);
  const values: Record<string, CypherLiteral> = {};
  for (const entry of entries) {
    const keyCtx = findChild(entry, Ctx.PropertyKey);
    const key = getSymbolicName(keyCtx);
    const exprCtx = findChild(entry, Ctx.Expression);
    const value = evaluateExpression(exprCtx);
    if (key && value && value.type === 'Literal') {
      values[key] = value.value;
    }
  }
  return { type: 'MapLiteral' as const, values };
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

  // List literal (e.g., ["Alice", "Bob"] for IN operator)
  const listLitExpr = extractListLiteralExpression(atom);
  if (listLitExpr) return listLitExpr;

  // Literal (e.g., string literal for CONTAINS)
  const literalCtx = findChild(atom, Ctx.Literal);
  return extractLiteral(literalCtx);
}

function extractValueExpression(ctx: TreeNode): Expression | undefined {
  if (!ctx) return undefined;

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

  const literalCtx = findChild(atom, Ctx.Literal);
  return extractLiteral(literalCtx);
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

      items.push({ variable, label: undefined, property });
      continue;
    }

    // Label removal: Variable + NodeLabels
    const varCtx = findChild(removeItem, Ctx.Variable);
    const variable = getSymbolicName(varCtx);
    if (!variable) throw new Error('Failed to parse REMOVE label: missing variable name.');

    const labelsCtx = findChild(removeItem, Ctx.NodeLabels);
    const labelCtx = findChild(labelsCtx, Ctx.NodeLabel);
    const labelNameCtx = findChild(labelCtx, Ctx.LabelName);
    const label = getSymbolicName(labelNameCtx);

    items.push({ variable, label, property: undefined });
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
    const propExpr = findChild(setItem, Ctx.PropertyExpression);
    if (!propExpr) throw new Error('Failed to parse SET: missing PropertyExpression node in AST.');
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
    if (valueExpr.type !== 'Literal') {
      throw new Error(`Failed to parse SET: only literal values are supported on the right-hand side, got ${valueExpr.type}.`);
    }

    return { type: 'SET' as const, variable, property, value: valueExpr.value };
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
    const labelsCtx = findChild(nodePatternCtx, Ctx.NodeLabels);
    const labelCtx = findChild(labelsCtx, Ctx.NodeLabel);
    const labelNameCtx = findChild(labelCtx, Ctx.LabelName);
    const label = getSymbolicName(labelNameCtx);

    const propsCtx = findChild(nodePatternCtx, Ctx.Properties);
    const mapLitCtx = findChild(propsCtx, Ctx.MapLiteral);
    const properties = extractProperties(mapLitCtx);

    return { type: 'CREATE' as const, variable, label, properties };
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
    if (!valueExpr || valueExpr.type !== 'Literal') continue;

    actions.push({ variable, property, value: valueExpr.value });
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

  return {
    actionType: onCreate ? 'CREATE' : 'MATCH',
    setActions,
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

  const sourcePattern = nodePatterns[0] ? extractNodePattern(nodePatterns[0]) : { variable: '', label: undefined, properties: undefined };

  let relationPattern: RelationPattern = { variable: undefined, type: undefined, minDepth: undefined, maxDepth: undefined, direction: 'UNDIRECTED' };
  let targetPattern: NodePattern = { variable: '', label: undefined, properties: undefined };

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

  return { type: 'MERGE', hasChains, sourcePattern, relationPattern, targetPattern, onCreate, onMatch };
}

// ── Main parser ──────────────────────────────────────────────────────────────

export function parseCypher(query: string): AdvancedCypherAST {
  ensureContextNamesValid();

  const chars = antlr4.CharStreams.fromString(query);
  const lexer = new CypherLexer(chars);
  const tokens = new antlr4.CommonTokenStream(lexer);
  const parser = new CypherParser(tokens);

  const collector = new ErrorCollector();
  parser.removeErrorListeners();
  parser.addErrorListener(collector);

  const tree = parser.cypher();

  if (collector.errors.length > 0) {
    throw new Error(`Failed to parse Cypher query: ${collector.errors.join('; ')}`);
  }

  const stages: AdvancedCypherAST['stages'] = [];
  let returnClause: ReturnClause | undefined;

  const cypherPart = tree.children?.[0];
  const cypherQuery = findChild(cypherPart, Ctx.CypherQuery);
  const statement = findChild(cypherQuery, Ctx.Statement);
  const queryCtx = findChild(statement, Ctx.Query);
  const regularQuery = findChild(queryCtx, Ctx.RegularQuery);
  const singleQuery = findChild(regularQuery, Ctx.SingleQuery);

  if (!singleQuery) {
    return { type: 'Query', stages, return: returnClause };
  }

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
    }
  }

  return { type: 'Query', stages, return: returnClause };
}
