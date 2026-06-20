import { createRequire } from 'module';
import type {
  AdvancedCypherAST,
  MatchClause,
  NodePattern,
  OrderByItem,
  RelationPattern,
  Direction,
  WithClause,
  WriteClause,
  Expression,
  BinaryExpression,
  ReturnClause,
  CypherLiteral,
  Projection,
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
  LiteralEntry: 'LiteralEntryContext',
  MapLiteral: 'MapLiteralContext',
  MatchClause: 'MatchClauseContext',
  NodeLabel: 'NodeLabelContext',
  NodeLabels: 'NodeLabelsContext',
  NodePattern: 'NodePatternContext',
  NumberLiteral: 'NumberLiteralContext',
  PartialComparisonExpression: 'PartialComparisonExpressionContext',
  Pattern: 'PatternContext',
  PatternElement: 'PatternElementContext',
  PatternElementChain: 'PatternElementChainContext',
  PatternPart: 'PatternPartContext',
  Properties: 'PropertiesContext',
  PropertyExpression: 'PropertyExpressionContext',
  PropertyKey: 'PropertyKeyNameContext',
  PropertyLookup: 'PropertyLookupContext',
  RangeLiteral: 'RangeLiteralContext',
  RelTypeName: 'RelTypeNameContext',
  RelationshipDetail: 'RelationshipDetailContext',
  RelationshipPattern: 'RelationshipPatternContext',
  RelationshipPatternEnd: 'RelationshipPatternEndContext',
  RelationshipPatternStart: 'RelationshipPatternStartContext',
  RelationshipType: 'RelationshipTypeContext',
  RelationshipTypes: 'RelationshipTypesContext',
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
  StringLiteral: 'StringLiteralContext',
  SymbolicName: 'SymbolicNameContext',
  TerminalNode: 'TerminalNodeImpl',
  Variable: 'VariableContext',
  Where: 'WhereContext',
  WithClause: 'WithClauseContext',
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

// ── Tree index (optimisation #6) ────────────────────────────────────────────
// Flat index: maps context class names → arrays of node indices.
// Provides positional navigation for the main parseCypher flow; individual
// child lookups are still O(n) within a parent's children but avoids repeated
// tree traversal for the top-level clause extraction path.

interface TreeIndex {
  nodes: ParseTreeNode[];
  byName: Map<string, number[]>;
}

/**
 * Build a flat index from a parse tree. Walks the tree once (BFS),
 * recording each node's index and building a name→indices map.
 */
function buildTreeIndex(root: ParseTreeNode): TreeIndex {
  const nodes: ParseTreeNode[] = [];
  const byName = new Map<string, number[]>();
  const queue: ParseTreeNode[] = [root];
  let idx = 0;

  while (queue.length > 0) {
    const node = queue.shift()!;
    const pos = idx++;
    nodes.push(node);

    const name = node.constructor.name;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(pos);

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        queue.push(node.children[i] as ParseTreeNode);
      }
    }
  }

  return { nodes, byName };
}

/** Find children of a specific type within a parent's direct children. */
function idxFindChildren(idx: TreeIndex, parentPos: number, name: string): number[] {
  const node = idx.nodes[parentPos];
  if (!node?.children) return [];
  const results: number[] = [];
  for (let i = 0; i < node.children.length; i++) {
    if (node.children[i]!.constructor.name === name) {
      // Find the child's position in the flat index
      const childName = node.children[i]!.constructor.name;
      const positions = idx.byName.get(childName);
      if (positions) {
        for (const p of positions) {
          if (idx.nodes[p] === node.children[i]) {
            results.push(p);
            break;
          }
        }
      }
    }
  }
  return results;
}

/** Find first child of a specific type. Returns flat index position or -1. */
function idxFindChild(idx: TreeIndex, parentPos: number, name: string): number {
  const node = idx.nodes[parentPos];
  if (!node?.children) return -1;
  for (let i = 0; i < node.children.length; i++) {
    if (node.children[i]!.constructor.name === name) {
      // Linear scan through the position list for this type
      const positions = idx.byName.get(name);
      if (positions) {
        for (const p of positions) {
          if (idx.nodes[p] === node.children[i]) return p;
        }
      }
      return -1;
    }
  }
  return -1;
}

/** Get the ParseTreeNode at a flat index position. */
function idxNode(idx: TreeIndex, pos: number): ParseTreeNode | null {
  return idx.nodes[pos] ?? null;
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

    if (funcName && argName) {
      return {
        type: 'Aggregation' as const,
        aggregationType: funcName.toUpperCase() as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
        variable: argName,
        property: argProperty,
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
  // Strip surrounding double quotes
  if (raw.startsWith('"') && raw.endsWith('"')) {
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

  return { optional: !!optional, hasChains, sourcePattern, relationPattern, targetPattern };
}

function computeDefaultAlias(expr: Expression): string {
  if (expr.type === 'PropertyAccess') {
    return expr.property ?? expr.variable;
  }
  if (expr.type === 'Aggregation') {
    return `${expr.aggregationType}(${expr.variable})`;
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
        projections.push({ expression: expr, alias: asAlias });
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

    projections.push({ expression: expr, alias });
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
  const projections = extractReturnBody(returnBody);
  const orderBy = extractOrderBy(returnBody);
  const skip = extractSkip(returnBody);
  const limit = extractLimit(returnBody);

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
  const where = whereExpr ? extractComparison(whereExpr) : undefined;

  return { projections, where, orderBy, skip, limit };
}

function extractComparison(exprCtx: TreeNode): BinaryExpression | undefined {
  if (!exprCtx) return undefined;

  // Walk the tree recursively to find a PartialComparisonExpressionContext
  let foundPartial: ParseTreeNode | undefined;
  let foundComp: ParseTreeNode | undefined;
  const walk = (ctx: ParseTreeNode): void => {
    if (ctx.constructor.name === Ctx.PartialComparisonExpression) {
      foundPartial = ctx;
    } else if (ctx.constructor.name === Ctx.ComparisonExpression) {
      foundComp = ctx;
    }
    if (ctx.children) {
      for (const child of ctx.children) {
        walk(child);
      }
    }
  };
  walk(exprCtx as ParseTreeNode);

  if (!foundPartial || !foundComp) return undefined;

  const operatorTerm = findChild(foundPartial, Ctx.TerminalNode);
  const operator = operatorTerm?.symbol?.text as '>' | '<' | '=' | 'CONTAINS';
  if (!operator) return undefined;

  const leftExprCtx = findChild(foundComp, Ctx.AddOrSubtractExpression);
  const left = extractValueExpression(leftExprCtx);

  const rightExprCtx = findChild(foundPartial, Ctx.AddOrSubtractExpression);
  const right = extractValueExpression(rightExprCtx);

  if (left && right) {
    return { type: 'BinaryExpression' as const, operator, left, right };
  }
  return undefined;
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

  return undefined;
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

  // Build flat tree index for O(1) type-based lookups (optimisation #6)
  const idx = buildTreeIndex(tree);

  const stages: AdvancedCypherAST['stages'] = [];
  let returnClause: ReturnClause | undefined;

  // Navigate to singleQuery using index lookups
  // Tree structure: CypherContext → CypherPartContext → CypherQueryContext → ...
  const rootPos = 0;
  const cypherPartPos = idxFindChild(idx, rootPos, 'CypherPartContext');
  if (cypherPartPos < 0) return { type: 'Query', stages, return: returnClause };
  const cypherQueryPos = idxFindChild(idx, cypherPartPos, Ctx.CypherQuery);
  if (cypherQueryPos < 0) return { type: 'Query', stages, return: returnClause };
  const statementPos = idxFindChild(idx, cypherQueryPos, Ctx.Statement);
  if (statementPos < 0) return { type: 'Query', stages, return: returnClause };
  const queryCtxPos = idxFindChild(idx, statementPos, Ctx.Query);
  if (queryCtxPos < 0) return { type: 'Query', stages, return: returnClause };
  const regularQueryPos = idxFindChild(idx, queryCtxPos, Ctx.RegularQuery);
  if (regularQueryPos < 0) return { type: 'Query', stages, return: returnClause };
  const singleQueryPos = idxFindChild(idx, regularQueryPos, Ctx.SingleQuery);
  if (singleQueryPos < 0) return { type: 'Query', stages, return: returnClause };

  const singleQuery = idxNode(idx, singleQueryPos);
  if (!singleQuery) return { type: 'Query', stages, return: returnClause };

  const clausePositions = idxFindChildren(idx, singleQueryPos, Ctx.Clause);

  for (const clausePos of clausePositions) {
    const clause = idxNode(idx, clausePos);
    if (!clause) continue;

    if (idxFindChild(idx, clausePos, Ctx.MatchClause) >= 0) {
      stages.push({ type: 'MATCH', clause: extractMatchClause(clause) });
    } else if (idxFindChild(idx, clausePos, Ctx.ReturnClause) >= 0) {
      returnClause = extractReturnClause(clause);
    } else if (idxFindChild(idx, clausePos, Ctx.WithClause) >= 0) {
      const withClause = extractWithClause(clause);
      if (withClause) stages.push({ type: 'WITH', clause: withClause });
    } else if (idxFindChild(idx, clausePos, Ctx.SetClause) >= 0) {
      const writeClause = extractWriteClause(clause);
      if (writeClause) stages.push({ type: 'WRITE', clause: writeClause });
    } else if (idxFindChild(idx, clausePos, Ctx.CreateClause) >= 0) {
      const writeClause = extractWriteClause(clause);
      if (writeClause) stages.push({ type: 'WRITE', clause: writeClause });
    } else if (idxFindChild(idx, clausePos, Ctx.DeleteClause) >= 0) {
      const writeClause = extractWriteClause(clause);
      if (writeClause) stages.push({ type: 'WRITE', clause: writeClause });
    }
  }

  return { type: 'Query', stages, return: returnClause };
}
