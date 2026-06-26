import type {
  MatchClause,
  MergeClause,
  MergeAction,
  WithClause,
  WriteClause,
  UnwindClause,
  ForeachClause,
  CallClause,
  ReturnClause,
  Projection,
  OrderByItem,
  WhereExpression,
  BinaryExpression,
  IsNullExpression,
  RemoveClause,
  RemoveItem,
  Expression,
  CypherAST,
  CypherLiteral,
  AdvancedCypherAST,
} from '../types/cypher';
import type { ParseTreeNode } from 'antlr4';
import {
  Ctx,
  findChild,
  findAllChildren,
  hasTerminal,
  getTerminalText,
  getSymbolicName,
  findDescendant,
  findDescendantOutsideCompound,
  buildSyntheticTree,
  hasNotTerminal,
  countNotTerminals,
  wrapInNotExpressions,
} from './tree-utils';
import type { TreeNode } from './tree-utils';
import {
  getAtom,
  evaluateExpression,
  extractFunctionCall,
  extractFunctionCallFromAtom,
  extractPseudoProcedureCall,
  extractValueExpression,
  extractValueExpressionFromPropertyOrLabels,
  extractListLiteralExpressionFromCtx,
  extractMapLiteralExpressionFromCtx,
  extractCaseExpression,
  extractQuantifierExpression,
  extractExistsExpression,
} from './expression-parser';
import {
  extractNodePattern,
  extractRelationPattern,
  extractLabelExpression,
  extractProperties,
  extractDynamicProperties,
} from './pattern-parser';
import { createRequire } from 'module';
import { ErrorCollector } from './tree-utils';

const _require = createRequire(import.meta.url);
const antlr4 = _require('antlr4').default;
const { CypherLexer, CypherParser } = _require('@neo4j-cypher/antlr4');
import { splitRespectingBrackets } from './tree-utils';

// ── MATCH clause extraction ──────────────────────────────────────────────────

export function extractMatchClause(clauseCtx: ParseTreeNode): MatchClause {
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

  const sourcePattern = nodePatterns[0] ? extractNodePattern(nodePatterns[0]) : { variable: '', labels: undefined, properties: undefined, propertiesExpr: undefined };

  let relationPattern = extractRelationPattern(null);
  let targetPattern: import('../types/cypher').NodePattern = { variable: '', labels: undefined, properties: undefined, propertiesExpr: undefined };

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

  let pathVariable: string | undefined;
  if (patternPart) {
    const partChildren = patternPart.children;
    if (partChildren) {
      for (let i = 0; i < partChildren.length; i++) {
        const child = partChildren[i];
        if (child && child.constructor.name === Ctx.Variable) {
          for (let j = i + 1; j < partChildren.length; j++) {
            const next = partChildren[j];
            if (next?.constructor.name === Ctx.TerminalNode) {
              if (next.symbol?.text === '=') {
                pathVariable = getSymbolicName(child);
              }
              break;
            }
            if (next?.symbol?.text && next.symbol.text.trim() !== '') {
              break;
            }
          }
          break;
        }
      }
    }
  }

  const whereCtx = findChild(matchCtx, Ctx.Where);
  const whereExpr = findChild(whereCtx, Ctx.Expression);
  const where = whereExpr ? extractWhereExpression(whereExpr) : undefined;

  return { optional: !!optional, hasChains, sourcePattern, relationPattern, targetPattern, where: where ?? undefined, pathVariable };
}

// ── Projection helpers ───────────────────────────────────────────────────────

function computeDefaultAlias(expr: Expression): string {
  if (expr.type === 'PropertyAccess') {
    return expr.property ?? expr.variable;
  }
  if (expr.type === 'Aggregation') {
    if (expr.isStar) return 'count(*)';
    return `${expr.aggregationType}(${expr.variable}${expr.property ? `.${expr.property}` : ''})`;
  }
  if (expr.type === 'Reduce') {
    return `reduce()`;
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
  if (expr.type === 'Path') {
    return `${expr.functionName}()`;
  }
  if (expr.type === 'Quantifier') {
    return `${expr.quantifierType}()`;
  }
  if (expr.type === 'Exists') {
    return 'EXISTS()';
  }
  if (expr.type === 'ListComprehension') {
    return '[...]';
  }
  return String(expr.value);
}

interface ParsedItem {
  expr: Expression;
  hasAs: boolean;
  asAlias: string | undefined;
}

export function extractReturnBody(returnBody: ParseTreeNode | null): Projection[] {
  if (!returnBody) return [];

  const returnItems = findChild(returnBody, Ctx.ReturnItems);
  if (!returnItems) return [];

  const allItems: ParseTreeNode[] = [];
  if (returnItems.children) {
    for (const child of returnItems.children) {
      const cname = child.constructor.name;
      if (cname === Ctx.ReturnItem || cname === Ctx.Func) {
        allItems.push(child);
      }
    }
  }

  const parsedItems: ParsedItem[] = [];
  for (const item of allItems) {
    const funcCtx = item.constructor.name === Ctx.Func ? item : findChild(item, Ctx.Func);
    let expr: Expression | undefined;
    if (funcCtx) {
      const procCtx = findChild(funcCtx, Ctx.ProcedureInvocation);
      if (procCtx) {
        const procCall = extractPseudoProcedureCall(procCtx);
        if (procCall) expr = procCall;
      }
    }
    if (!expr) {
      const exprCtx = findChild(item, Ctx.Expression);
      expr = evaluateExpression(exprCtx, extractWhereExpression);
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

  const aliasCounts = new Map<string, number>();
  for (const { expr, hasAs, asAlias } of parsedItems) {
    if (hasAs) continue;
    const alias = computeDefaultAlias(expr);
    aliasCounts.set(alias, (aliasCounts.get(alias) ?? 0) + 1);
  }

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

    if ((aliasCounts.get(alias) ?? 0) > 1 && expr.type === 'PropertyAccess' && expr.property) {
      alias = `${expr.variable}.${expr.property}`;
    }

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

export function extractOrderBy(
  returnBody: ParseTreeNode | null,
  nullsDirections?: Map<number, 'NULLS FIRST' | 'NULLS LAST'>,
): OrderByItem[] | undefined {
  const orderCtx = findChild(returnBody, Ctx.Order);
  if (!orderCtx) return undefined;

  const sortItems = findAllChildren(orderCtx, Ctx.SortItem);
  if (sortItems.length === 0) return undefined;

  const items: OrderByItem[] = [];
  for (let i = 0; i < sortItems.length; i++) {
    const sortItem = sortItems[i]!;
    const exprCtx = findChild(sortItem, Ctx.Expression);
    const expr = evaluateExpression(exprCtx, extractWhereExpression);
    if (!expr) continue;

    const hasDesc = hasTerminal(sortItem, 'DESC');
    const direction = hasDesc ? 'DESC' : 'ASC';

    const nullsDir = nullsDirections?.get(i);
    items.push({ expression: expr, direction, nullsDirection: nullsDir });
  }

  return items.length > 0 ? items : undefined;
}

export function extractLimit(returnBody: ParseTreeNode | null): number | undefined {
  const limitCtx = findChild(returnBody, Ctx.Limit);
  if (!limitCtx) return undefined;

  const exprCtx = findChild(limitCtx, Ctx.Expression);
  const expr = evaluateExpression(exprCtx, extractWhereExpression);
  if (expr && expr.type === 'Literal' && typeof expr.value === 'number') {
    return expr.value;
  }
  return undefined;
}

export function extractSkip(returnBody: ParseTreeNode | null): number | undefined {
  const skipCtx = findChild(returnBody, Ctx.Skip);
  if (!skipCtx) return undefined;

  const exprCtx = findChild(skipCtx, Ctx.Expression);
  const expr = evaluateExpression(exprCtx, extractWhereExpression);
  if (expr && expr.type === 'Literal' && typeof expr.value === 'number') {
    return expr.value;
  }
  return undefined;
}

// ── RETURN / WITH clause extraction ──────────────────────────────────────────

export function extractReturnClause(clauseCtx: ParseTreeNode, nullsDirections?: Map<number, 'NULLS FIRST' | 'NULLS LAST'>): ReturnClause | undefined {
  const returnCtx = findChild(clauseCtx, Ctx.ReturnClause);
  if (!returnCtx) return undefined;

  const returnBody = findChild(returnCtx, Ctx.ReturnBody);
  let projections = extractReturnBody(returnBody);
  const orderBy = extractOrderBy(returnBody, nullsDirections);
  const skip = extractSkip(returnBody);
  const limit = extractLimit(returnBody);

  const hasDistinct = hasTerminal(returnCtx, 'DISTINCT');
  if (hasDistinct) {
    projections = projections.map((p) => ({ ...p, distinct: true }));
  }

  return { projections, orderBy, skip, limit };
}

export function extractWithClause(clauseCtx: ParseTreeNode, nullsDirections?: Map<number, 'NULLS FIRST' | 'NULLS LAST'>): WithClause | undefined {
  const withCtx = findChild(clauseCtx, Ctx.WithClause);
  if (!withCtx) return undefined;

  const returnBody = findChild(withCtx, Ctx.ReturnBody);
  const projections = extractReturnBody(returnBody);
  const orderBy = extractOrderBy(returnBody, nullsDirections);
  const skip = extractSkip(returnBody);
  const limit = extractLimit(returnBody);

  const whereCtx = findChild(withCtx, Ctx.Where);
  const whereExpr = findChild(whereCtx, Ctx.Expression);
  const where = whereExpr ? extractWhereExpression(whereExpr) : undefined;

  return { projections, where, orderBy, skip, limit };
}

// ── WHERE expression extraction ──────────────────────────────────────────────

export function extractWhereExpression(exprCtx: TreeNode): WhereExpression | undefined {
  if (!exprCtx) return undefined;

  if (exprCtx.constructor.name === Ctx.NotExpression && !hasNotTerminal(exprCtx)) {
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

  const orCtx = findDescendantOutsideCompound(exprCtx, Ctx.OrExpression);
  if (orCtx) return extractLogicalExpression(orCtx, Ctx.XorExpression, 'OR');

  const xorCtx = findDescendantOutsideCompound(exprCtx, Ctx.XorExpression);
  if (xorCtx) return extractLogicalExpression(xorCtx, Ctx.AndExpression, 'XOR');

  const andCtx = findDescendantOutsideCompound(exprCtx, Ctx.AndExpression);
  if (andCtx) return extractLogicalExpression(andCtx, Ctx.NotExpression, 'AND');

  const notCtx = findDescendantOutsideCompound(exprCtx, Ctx.NotExpression);
  if (notCtx && hasNotTerminal(notCtx)) {
    const notCount = countNotTerminals(notCtx);
    const innerCtx = findChild(notCtx, Ctx.OrExpression) || findChild(notCtx, Ctx.XorExpression) || findChild(notCtx, Ctx.AndExpression) || findChild(notCtx, Ctx.ComparisonExpression);
    if (innerCtx) {
      const inner = extractWhereExpressionFromChild(innerCtx);
      if (inner) return wrapInNotExpressions(inner, notCount);
    }
  }

  const compCtx = findDescendantOutsideCompound(exprCtx, Ctx.ComparisonExpression);
  if (compCtx) {
    const compResult = extractComparison(compCtx);
    if (compResult) return compResult;
  }

  // Fallback: check if this is a quantifier, exists, or function call expression (they evaluate to boolean)
  const atom = getAtom(exprCtx);
  if (atom) {
    const quantifierExpr = extractQuantifierExpression(atom, extractWhereExpression);
    if (quantifierExpr) return quantifierExpr;
    const existsExpr = extractExistsExpression(atom);
    if (existsExpr) return existsExpr;
    const funcCallExpr = extractFunctionCallFromAtom(atom, extractWhereExpression);
    if (funcCallExpr) return funcCallExpr;
  }

  return undefined;
}

function extractLogicalExpression(
  ctx: TreeNode,
  childName: string,
  operator: 'AND' | 'OR' | 'XOR',
): WhereExpression | undefined {
  if (!ctx) return undefined;

  const children = ctx.children;
  if (!children) return undefined;

  const operatorIndices: number[] = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c && c.constructor.name === Ctx.TerminalNode && c.symbol?.text === operator) {
      operatorIndices.push(i);
    }
  }

  if (operatorIndices.length === 0) {
    const child = findChild(ctx, childName);
    if (child) return extractWhereExpressionFromChild(child);
    return undefined;
  }

  const segments: ParseTreeNode[][] = [];
  let start = 0;
  for (const idx of operatorIndices) {
    segments.push(children.slice(start, idx));
    start = idx + 1;
  }
  segments.push(children.slice(start));

  const expressions: WhereExpression[] = [];
  for (const segment of segments) {
    const segmentCtx = buildSyntheticTree(segment);
    const expr = extractWhereExpression(segmentCtx);
    if (expr) {
      expressions.push(expr);
    }
  }

  if (expressions.length < 2) return undefined;

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

function extractWhereExpressionFromChild(ctx: TreeNode): WhereExpression | undefined {
  if (!ctx) return undefined;

  if (ctx.constructor.name === Ctx.NotExpression && hasNotTerminal(ctx)) {
    const innerCtx = findChild(ctx, Ctx.OrExpression) || findChild(ctx, Ctx.XorExpression) || findChild(ctx, Ctx.AndExpression) || findChild(ctx, Ctx.ComparisonExpression);
    if (innerCtx) {
      const inner = extractWhereExpressionFromChild(innerCtx);
      if (inner) return wrapInNotExpressions(inner, countNotTerminals(ctx));
    }
    return undefined;
  }

  if (ctx.constructor.name === Ctx.NotExpression) {
    const directComp = findChild(ctx, Ctx.ComparisonExpression);
    if (directComp) {
      const compResult = extractComparison(directComp);
      if (compResult) return compResult;
    }
    // Fallback for quantifier/exists (NotExpression may be a transparent wrapper without NOT keyword)
    const notAtom = getAtom(ctx);
    if (notAtom) {
      const qe = extractQuantifierExpression(notAtom, extractWhereExpression);
      if (qe) return hasNotTerminal(ctx) ? wrapInNotExpressions(qe, countNotTerminals(ctx)) : qe;
      const ee = extractExistsExpression(notAtom);
      if (ee) return hasNotTerminal(ctx) ? wrapInNotExpressions(ee, countNotTerminals(ctx)) : ee;
    }
    return undefined;
  }

  if (ctx.constructor.name === Ctx.ComparisonExpression) {
    const nestedOr = findDescendantOutsideCompound(ctx, Ctx.OrExpression);
    if (nestedOr) return extractLogicalExpression(nestedOr, Ctx.XorExpression, 'OR');
    const nestedXor = findDescendantOutsideCompound(ctx, Ctx.XorExpression);
    if (nestedXor) return extractLogicalExpression(nestedXor, Ctx.AndExpression, 'XOR');
    const nestedAnd = findDescendantOutsideCompound(ctx, Ctx.AndExpression);
    if (nestedAnd) return extractLogicalExpression(nestedAnd, Ctx.NotExpression, 'AND');
    const compResult = extractComparison(ctx);
    if (compResult) return compResult;
    // Fallback for quantifier/exists (NotExpression may be a transparent wrapper)
    const compAtom = getAtom(ctx);
    if (compAtom) {
      const qe = extractQuantifierExpression(compAtom, extractWhereExpression);
      if (qe) return qe;
      const ee = extractExistsExpression(compAtom);
      if (ee) return ee;
    }
    return undefined;
  }

  if (ctx.constructor.name === Ctx.AndExpression) {
    return extractLogicalExpression(ctx, Ctx.NotExpression, 'AND');
  }
  if (ctx.constructor.name === Ctx.OrExpression) {
    return extractLogicalExpression(ctx, Ctx.XorExpression, 'OR');
  }
  if (ctx.constructor.name === Ctx.XorExpression) {
    return extractLogicalExpression(ctx, Ctx.AndExpression, 'XOR');
  }

  const andCtx = findDescendantOutsideCompound(ctx, Ctx.AndExpression);
  if (andCtx) return extractLogicalExpression(andCtx, Ctx.NotExpression, 'AND');

  const orCtx = findDescendantOutsideCompound(ctx, Ctx.OrExpression);
  if (orCtx) return extractLogicalExpression(orCtx, Ctx.XorExpression, 'OR');

  const compCtx = findDescendantOutsideCompound(ctx, Ctx.ComparisonExpression);
  if (compCtx) {
    const compResult = extractComparison(compCtx);
    if (compResult) return compResult;
  }

  // Fallback for quantifier/exists
  const fallbackAtom = getAtom(ctx);
  if (fallbackAtom) {
    const qe = extractQuantifierExpression(fallbackAtom, extractWhereExpression);
    if (qe) return qe;
    const ee = extractExistsExpression(fallbackAtom);
    if (ee) return ee;
  }

  return undefined;
}

function extractComparison(compCtx: TreeNode): BinaryExpression | IsNullExpression | undefined {
  if (!compCtx) return undefined;

  const partialCtx = findChild(compCtx, Ctx.PartialComparisonExpression);
  if (partialCtx) {
    const operatorTerm = findChild(partialCtx, Ctx.TerminalNode);
    const operator = operatorTerm?.symbol?.text as '>' | '<' | '>=' | '<=' | '=' | '<>';
    if (!operator) return undefined;

    const leftExprCtx = findChild(compCtx, Ctx.AddOrSubtractExpression);
    const left = extractValueExpression(leftExprCtx, extractWhereExpression);

    const rightExprCtx = findChild(partialCtx, Ctx.AddOrSubtractExpression);
    const right = extractValueExpression(rightExprCtx, extractWhereExpression);

    if (left && right) {
      return { type: 'BinaryExpression' as const, operator, left, right };
    }
    return undefined;
  }

  const strCtx = findDescendant(compCtx, Ctx.StringListNullOperatorExpression);
  if (strCtx && strCtx.children) {
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
        const expr = extractValueExpressionFromPropertyOrLabels(propExprs[0], extractWhereExpression);
        if (expr) {
          const hasNot = strCtx.children.some((c: ParseTreeNode) =>
            c.constructor.name === Ctx.TerminalNode && c.symbol?.text === 'NOT',
          );
          return {
            type: 'IsNull' as const,
            expression: expr,
            negated: hasNot,
          };
        }
      }
    }

    const propExprs = strCtx.children!.filter(
      (c: ParseTreeNode) => c.constructor.name === Ctx.PropertyOrLabelsExpression,
    ) as ParseTreeNode[];

    if (propExprs.length >= 2) {
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
        const left = extractValueExpressionFromPropertyOrLabels(propExprs[0], extractWhereExpression);
        const right = extractValueExpressionFromPropertyOrLabels(propExprs[1], extractWhereExpression);
        if (left && right) {
          return { type: 'BinaryExpression' as const, operator: 'CONTAINS', left, right };
        }
      }

      if (hasStartsWith) {
        const left = extractValueExpressionFromPropertyOrLabels(propExprs[0], extractWhereExpression);
        const right = extractValueExpressionFromPropertyOrLabels(propExprs[1], extractWhereExpression);
        if (left && right) {
          return { type: 'BinaryExpression' as const, operator: 'STARTS WITH', left, right };
        }
      }

      if (hasEndsWith) {
        const left = extractValueExpressionFromPropertyOrLabels(propExprs[0], extractWhereExpression);
        const right = extractValueExpressionFromPropertyOrLabels(propExprs[1], extractWhereExpression);
        if (left && right) {
          return { type: 'BinaryExpression' as const, operator: 'ENDS WITH', left, right };
        }
      }

      if (hasIn) {
        const left = extractValueExpressionFromPropertyOrLabels(propExprs[0], extractWhereExpression);
        const right = extractValueExpressionFromPropertyOrLabels(propExprs[1], extractWhereExpression);
        if (left && right) {
          return { type: 'BinaryExpression' as const, operator: 'IN', left, right };
        }
      }
    }
  }

  return undefined;
}

// ── REMOVE clause extraction ─────────────────────────────────────────────────

export function extractRemoveClause(clauseCtx: ParseTreeNode): RemoveClause {
  const removeCtx = findChild(clauseCtx, Ctx.RemoveClause);
  if (!removeCtx) throw new Error('Failed to parse REMOVE: missing RemoveClause node.');

  const removeItems = findAllChildren(removeCtx, Ctx.RemoveItem);
  if (!removeItems.length) throw new Error('Failed to parse REMOVE: missing RemoveItem nodes.');

  const items: RemoveItem[] = [];
  for (const removeItem of removeItems) {
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

// ── WRITE clause extraction (SET / CREATE / DELETE / REMOVE) ─────────────────

export function extractWriteClause(clauseCtx: ParseTreeNode): WriteClause | undefined {
  // SET clause
  const setCtx = findChild(clauseCtx, Ctx.SetClause);
  if (setCtx) {
    const setItems = findAllChildren(setCtx, Ctx.SetItem);
    if (setItems.length === 0) throw new Error('Failed to parse SET: missing SetItem node in AST.');

    const items: import('../types/cypher').SetItem[] = [];
    for (const setItem of setItems) {
      const labelsCtx = findChild(setItem, Ctx.NodeLabels);
      const labelCtxs = labelsCtx ? findAllChildren(labelsCtx, Ctx.NodeLabel) : [];
      const labels = labelCtxs.length > 0
        ? labelCtxs.map((lc) => getSymbolicName(findChild(lc, Ctx.LabelName))).filter((l): l is string => !!l)
        : undefined;

      const propExpr = findChild(setItem, Ctx.PropertyExpression);
      if (propExpr) {
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
        const valueExpr = evaluateExpression(exprCtx, extractWhereExpression);
        if (!valueExpr) {
          throw new Error(`Failed to parse SET: could not extract value for "${variable}.${property}".`);
        }
        items.push({ variable, property, value: valueExpr, labels });
      } else if (labels && labels.length > 0) {
        const varCtx = findChild(setItem, Ctx.Variable);
        const variable = getSymbolicName(varCtx);
        if (!variable) throw new Error('Failed to parse SET: missing variable name.');
        items.push({ variable, property: undefined, value: undefined, labels });
      } else {
        throw new Error('Failed to parse SET: unsupported SET form.');
      }
    }
    return { type: 'SET' as const, items };
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
    const labels = labelExpr && labelExpr.labels.length > 0 ? labelExpr.labels : undefined;

    const propsCtx = findChild(nodePatternCtx, Ctx.Properties);
    const mapLitCtx = findChild(propsCtx, Ctx.MapLiteral);
    const properties = extractProperties(mapLitCtx);
    const propertiesExpr = extractDynamicProperties(mapLitCtx);

    const chains = findAllChildren(element, Ctx.PatternElementChain);
    const hasChain = chains.length > 0;

    if (hasChain) {
      if (chains.length > 1) {
        throw new Error('Multi-hop CREATE patterns are not supported. Use multiple CREATE stages.');
      }
      const chain = chains[0];
      const relPatternCtx = findChild(chain, Ctx.RelationshipPattern);
      const relationPattern = extractRelationPattern(relPatternCtx);

      const relDetailCtx = findChild(relPatternCtx, Ctx.RelationshipDetail);
      const edgePropsCtx = relDetailCtx ? findChild(relDetailCtx, Ctx.Properties) : undefined;
      const edgeMapLitCtx = findChild(edgePropsCtx, Ctx.MapLiteral);
      const edgeProperties = extractProperties(edgeMapLitCtx);
      const edgePropertiesExpr = extractDynamicProperties(edgeMapLitCtx);

      const targetNodeCtx = findChild(chain, Ctx.NodePattern);
      const targetPattern = targetNodeCtx ? extractNodePattern(targetNodeCtx) : { variable: '', labels: undefined, properties: undefined, propertiesExpr: undefined };

      return {
        type: 'CREATE' as const,
        variable,
        labels,
        properties,
        propertiesExpr,
        hasChain: true,
        relationPattern,
        targetPattern,
        edgeProperties,
        edgePropertiesExpr,
      };
    }

    return { type: 'CREATE' as const, variable, labels, properties, propertiesExpr, hasChain: false };
  }

  // DELETE clause
  const deleteCtx = findChild(clauseCtx, Ctx.DeleteClause);
  if (deleteCtx) {
    const isDetach = hasTerminal(deleteCtx, 'DETACH');

    const exprCtxs = findAllChildren(deleteCtx, Ctx.Expression);
    if (exprCtxs.length === 0) throw new Error('Failed to parse DELETE: missing Expression node in AST.');
    const atoms = exprCtxs.map((e) => getAtom(e)).filter(Boolean);
    if (atoms.length === 0) throw new Error('Failed to parse DELETE: missing Atom node in AST.');
    const variables: string[] = [];
    for (const atom of atoms) {
      const varCtx = findChild(atom, Ctx.Variable);
      const variable = getSymbolicName(varCtx);
      if (!variable) throw new Error('Failed to parse DELETE: missing variable name.');
      variables.push(variable);
    }

    return { type: 'DELETE' as const, variables, detach: isDetach };
  }

  // REMOVE clause
  const removeCtx = findChild(clauseCtx, Ctx.RemoveClause);
  if (removeCtx) {
    return extractRemoveClause(clauseCtx);
  }

  return undefined;
}

// ── UNWIND clause extraction ─────────────────────────────────────────────────

export function extractUnwindClause(clauseCtx: ParseTreeNode, rawQuery?: string): UnwindClause | undefined {
  const unwindCtx = findChild(clauseCtx, Ctx.UnwindClause);
  if (!unwindCtx) return undefined;

  const exprCtx = findChild(unwindCtx, Ctx.Expression);
  const expr = evaluateExpression(exprCtx, extractWhereExpression);
  if (!expr) throw new Error('Failed to parse UNWIND: missing list expression.');

  const varCtx = findChild(unwindCtx, Ctx.Variable);
  const variable = getSymbolicName(varCtx);
  if (!variable) throw new Error('Failed to parse UNWIND: missing variable after AS.');

  // Extract WHERE after UNWIND from raw text (ANTLR4 parses it but doesn't associate it with UNWIND)
  let where: WhereExpression | undefined;
  if (rawQuery) {
    where = extractWhereAfterUnwind(rawQuery, unwindCtx, extractWhereExpression);
  }

  return { type: 'UNWIND' as const, expression: expr, variable, where };
}

/** Extract a WHERE clause that appears after UNWIND in the raw query text. */
function extractWhereAfterUnwind(rawQuery: string, unwindCtx: ParseTreeNode, extractWhereExpr: (ctx: TreeNode) => WhereExpression | undefined): WhereExpression | undefined {
  // Find the position of the UNWIND clause end in the raw query
  const unwindEnd = unwindCtx.stop?.stop ?? -1;
  if (unwindEnd === -1) return undefined;

  const afterUnwind = rawQuery.slice(unwindEnd + 1);
  // Use a smarter regex that doesn't stop at WITH when it's part of STARTS WITH / ENDS WITH
  const whereMatch = afterUnwind.match(/^\s*WHERE\s+(.+?)(?=\s+(?:RETURN|MATCH|MERGE|(?<!ENDS )(?<!STARTS )WITH|UNWIND|FOREACH|CALL|CREATE|SET|DELETE|REMOVE|ORDER|SKIP|LIMIT|;|\bCALL\b)|$)/is);
  if (!whereMatch) return undefined;

  const whereText = whereMatch[1]!.trim();
  if (!whereText) return undefined;

  // Parse the WHERE expression via synthetic query
  try {
    const syntheticQuery = `MATCH (x) WHERE ${whereText} RETURN x`;
    const antlr4mod = createRequire(import.meta.url)('antlr4').default;
    const antlr4Lib = createRequire(import.meta.url)('@neo4j-cypher/antlr4');
    const syntheticChars = antlr4mod.CharStreams.fromString(syntheticQuery);
    const syntheticLexer = new antlr4Lib.CypherLexer(syntheticChars);
    const syntheticTokens = new antlr4mod.CommonTokenStream(syntheticLexer);
    const syntheticParser = new antlr4Lib.CypherParser(syntheticTokens);
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
    if (whereCtx) {
      const exprCtx = findChild(whereCtx, Ctx.Expression);
      if (exprCtx) return extractWhereExpr(exprCtx);
    }
  } catch {
    // If parsing fails, skip WHERE
  }
  return undefined;
}

// ── FOREACH clause extraction ────────────────────────────────────────────────

export function extractForeachClause(clauseCtx: ParseTreeNode): ForeachClause | undefined {
  const foreachCtx = findChild(clauseCtx, Ctx.ForeachClause);
  if (!foreachCtx) return undefined;

  const varCtx = findChild(foreachCtx, Ctx.Variable);
  const variable = getSymbolicName(varCtx);
  if (!variable) throw new Error('Failed to parse FOREACH: missing loop variable.');

  const exprCtx = findChild(foreachCtx, Ctx.Expression);
  const expr = evaluateExpression(exprCtx, extractWhereExpression);
  if (!expr) throw new Error('Failed to parse FOREACH: missing list expression.');

  const innerClauseCtxs = findAllChildren(foreachCtx, Ctx.Clause);
  if (innerClauseCtxs.length === 0) {
    throw new Error('Failed to parse FOREACH: missing inner update clause.');
  }
  const innerClauseCtx = innerClauseCtxs[innerClauseCtxs.length - 1]!;

  const innerClause = extractWriteClause(innerClauseCtx);
  if (!innerClause) {
    throw new Error('Failed to parse FOREACH: unsupported inner clause. Only SET, CREATE, DELETE, and REMOVE are supported.');
  }

  return { type: 'FOREACH' as const, variable, expression: expr, innerClause };
}

// ── CALL { ... } subquery clause extraction ──────────────────────────────────

function extractCallBodyFromQuery(queryText: string, callIndex: number): string | undefined {
  const afterCall = queryText.slice(callIndex + 4);
  const braceMatch = afterCall.match(/^\s*\{/);
  if (!braceMatch) return undefined;

  const openBraceIndex = callIndex + 4 + braceMatch.index! + braceMatch[0]!.length - 1;
  let depth = 0;
  let closeBraceIndex = -1;
  let inStr = false;
  let strChar = '';
  for (let i = openBraceIndex; i < queryText.length; i++) {
    const ch = queryText.charAt(i);
    if (inStr) {
      if (ch === strChar && (i === 0 || queryText.charAt(i - 1) !== '\\')) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strChar = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { closeBraceIndex = i; break; }
    }
  }
  if (closeBraceIndex === -1) return undefined;
  return queryText.slice(openBraceIndex + 1, closeBraceIndex).trim() || undefined;
}

function extractYieldVariables(queryText: string, callIndex: number): string[] | undefined {
  const afterCall = queryText.slice(callIndex + 4);
  const braceMatch = afterCall.match(/^\s*\{/);
  if (!braceMatch) return undefined;

  const openBraceIndex = callIndex + 4 + braceMatch.index! + braceMatch[0]!.length - 1;
  let depth = 0;
  let closeBraceIndex = -1;
  for (let i = openBraceIndex; i < queryText.length; i++) {
    const ch = queryText.charAt(i);
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { closeBraceIndex = i; break; }
    }
  }
  if (closeBraceIndex === -1) return undefined;

  const afterBrace = queryText.slice(closeBraceIndex + 1);
  const yieldMatch = afterBrace.match(/^\s*YIELD\s+(.+?)(?:\s*(?:RETURN|MATCH|MERGE|WITH|UNWIND|FOREACH|CALL|WHERE|;|ORDER|SKIP|LIMIT|$))/i);
  if (!yieldMatch) return undefined;

  const yieldText = yieldMatch[1]!.trim();
  const variables = yieldText.split(',').map((v) => v.trim()).filter(Boolean);
  return variables.length > 0 ? variables : undefined;
}

export function extractCallClause(clauseCtx: ParseTreeNode, rawQuery: string, parseQuery: (query: string) => CypherAST): CallClause | undefined {
  const callCtx = findChild(clauseCtx, Ctx.CallContext);
  if (!callCtx) return undefined;

  const callIndex = rawQuery.search(/\bCALL\b/i);
  if (callIndex === -1) {
    throw new Error('Failed to parse CALL: could not locate CALL keyword in query.');
  }

  const afterCall = rawQuery.slice(callIndex + 4);
  const hasBrace = /\s*\{/.test(afterCall);

  const procCtx = findChild(callCtx, Ctx.ProcedureInvocation);
  if (procCtx && !hasBrace) {
    throw new Error('Stored procedure calls (CALL db.xxx()) are not supported. Use CALL { ... } subqueries instead.');
  }

  if (!hasBrace) return undefined;

  const innerText = extractCallBodyFromQuery(rawQuery, callIndex);
  if (!innerText) {
    throw new Error('Failed to parse CALL: could not extract subquery body between { }.');
  }

  const innerAST = parseQuery(innerText) as AdvancedCypherAST;

  const yieldVariables = extractYieldVariables(rawQuery, callIndex);

  return { type: 'CALL' as const, innerQuery: innerAST, inline: true, yieldVariables };
}

// ── MERGE clause extraction ──────────────────────────────────────────────────

function extractMergeSetActions(setCtx: TreeNode): import('../types/cypher').MergeSetAction[] {
  if (!setCtx) return [];
  const actions: import('../types/cypher').MergeSetAction[] = [];
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
    const valueExpr = evaluateExpression(exprCtx, extractWhereExpression);
    if (!valueExpr) continue;

    actions.push({ variable, property, value: valueExpr });
  }
  return actions;
}

export function extractMergeAction(actionCtx: TreeNode): MergeAction | undefined {
  if (!actionCtx) return undefined;

  const onCreate = hasTerminal(actionCtx, 'CREATE');
  const onMatch = hasTerminal(actionCtx, 'MATCH');

  if (!onCreate && !onMatch) return undefined;

  const setCtx = findChild(actionCtx, Ctx.SetClause);
  const setActions = setCtx ? extractMergeSetActions(setCtx) : [];

  const deleteCtx = findChild(actionCtx, Ctx.DeleteClause);
  const deleteVariables: string[] = [];
  const detachDeleteVariables: string[] = [];
  if (deleteCtx) {
    const isDetach = hasTerminal(deleteCtx, 'DETACH');
    const exprCtx = findChild(deleteCtx, Ctx.Expression);
    if (exprCtx) {
      const atom = getAtom(exprCtx);
      if (atom) {
        const varCtx = findChild(atom, Ctx.Variable);
        const variable = getSymbolicName(varCtx);
        if (variable) {
          if (isDetach) detachDeleteVariables.push(variable);
          else deleteVariables.push(variable);
        }
      }
    }
  }

  const removeCtx = findChild(actionCtx, Ctx.RemoveClause);
  const removeItems: RemoveItem[] = [];
  if (removeCtx) {
    const removeItemsCtxs = findAllChildren(removeCtx, Ctx.RemoveItem);
    for (const removeItem of removeItemsCtxs) {
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
    detachDeleteVariables,
    removeItems,
  };
}

export function extractMergeClause(clauseCtx: ParseTreeNode): MergeClause {
  const mergeCtx = findChild(clauseCtx, Ctx.MergeClause);
  if (!mergeCtx) throw new Error('Failed to parse MERGE: missing MergeClause node.');

  const patternPart = findChild(mergeCtx, Ctx.PatternPart);
  if (!patternPart) throw new Error('Failed to parse MERGE: missing PatternPart node.');
  const anonPart = findChild(patternPart, Ctx.AnonymousPatternPart);
  if (!anonPart) throw new Error('Failed to parse MERGE: missing AnonymousPatternPart node.');
  const element = findChild(anonPart, Ctx.PatternElement);
  if (!element) throw new Error('Failed to parse MERGE: missing PatternElement node.');

  const nodePatterns = findAllChildren(element, Ctx.NodePattern);
  const chains = findAllChildren(element, Ctx.PatternElementChain);

  const sourcePattern = nodePatterns[0] ? extractNodePattern(nodePatterns[0]) : { variable: '', labels: undefined, properties: undefined, propertiesExpr: undefined };

  let relationPattern = extractRelationPattern(null);
  let targetPattern: import('../types/cypher').NodePattern = { variable: '', labels: undefined, properties: undefined, propertiesExpr: undefined };

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

  const whereCtx = findChild(mergeCtx, Ctx.Where);
  const whereExpr = findChild(whereCtx, Ctx.Expression);
  const where = whereExpr ? extractWhereExpression(whereExpr) : undefined;

  return { type: 'MERGE', hasChains, sourcePattern, relationPattern, targetPattern, where, onCreate, onMatch };
}

// ── MERGE action extraction from raw text (ANTLR4 workaround) ────────────────

export function extractMergeActionFromText(text: string, actionType: 'CREATE' | 'MATCH'): MergeAction | undefined {
  const setActions: import('../types/cypher').MergeSetAction[] = [];
  const deleteVariables: string[] = [];
  const detachDeleteVariables: string[] = [];
  const removeItems: RemoveItem[] = [];

  const setMatch = text.match(/SET\s+(.+?)(?:\s+DETACH\s+DELETE|\s+DELETE|\s+REMOVE|\s*$)/i);
  if (setMatch) {
    const setText = setMatch[1]!.trim();
    for (const assignment of splitRespectingBrackets(setText)) {
      const setPartMatch = assignment.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+)\s*=\s*(.+)$/);
      if (setPartMatch) {
        const varName = setPartMatch[1]!;
        const property = setPartMatch[2]!;
        const valueText = setPartMatch[3]!.trim();
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

  const detachDeleteMatch = text.match(/DETACH\s+DELETE\s+(.+?)(?:\s+REMOVE|\s*$)/i);
  if (detachDeleteMatch) {
    const deleteText = detachDeleteMatch[1]!.trim();
    for (const varRef of deleteText.split(/,\s*/)) {
      const v = varRef.trim();
      if (v) detachDeleteVariables.push(v);
    }
  } else {
    const deleteMatch = text.match(/DELETE\s+(.+?)(?:\s+REMOVE|\s*$)/i);
    if (deleteMatch) {
      const deleteText = deleteMatch[1]!.trim();
      for (const varRef of deleteText.split(/,\s*/)) {
        const v = varRef.trim();
        if (v) deleteVariables.push(v);
      }
    }
  }

  const removeMatch = text.match(/REMOVE\s+(.+?)(?:\s*$)/i);
  if (removeMatch) {
    const removeText = removeMatch[1]!.trim();
    for (const item of splitRespectingBrackets(removeText)) {
      const itemText = item.trim();
      const labelMatch = itemText.match(/^([a-zA-Z_][a-zA-Z0-9_]*):(.+)$/);
      if (labelMatch) {
        removeItems.push({ variable: labelMatch[1]!, labels: labelMatch[2]!.split(/\s*,\s*/), property: undefined });
      } else {
        const propMatch = itemText.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(\w+)$/);
        if (propMatch) {
          removeItems.push({ variable: propMatch[1]!, labels: undefined, property: propMatch[2]! });
        }
      }
    }
  }

  if (setActions.length === 0 && deleteVariables.length === 0 && detachDeleteVariables.length === 0 && removeItems.length === 0) {
    return undefined;
  }

  return { actionType, setActions, deleteVariables, detachDeleteVariables, removeItems };
}
