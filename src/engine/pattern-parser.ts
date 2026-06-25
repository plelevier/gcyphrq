import type {
  NodePattern,
  RelationPattern,
  Direction,
  LabelExpression,
  PathExpression,
  CypherValue,
  Expression,
} from '../types/cypher';
import type { ParseTreeNode } from 'antlr4';
import { evaluateArithmeticCore } from '../arithmetic';
import {
  Ctx,
  findChild,
  findAllChildren,
  hasTerminal,
  getTerminalText,
  getSymbolicName,
  findDescendant,
} from './tree-utils';
import type { TreeNode } from './tree-utils';
import { getAtom, extractFunctionCall, evaluateExpression, extractLiteral } from './expression-parser';
import { extractWhereExpression } from './clause-parser';

// ── Node pattern extraction ──────────────────────────────────────────────────

export function extractNodePattern(nodePatternCtx: TreeNode): NodePattern {
  if (!nodePatternCtx) return { variable: '', labels: undefined, properties: undefined, propertiesExpr: undefined };

  const variable = getSymbolicName(findChild(nodePatternCtx, Ctx.Variable)) ?? '';

  const labelExpr = extractLabelExpression(nodePatternCtx);

  const propsCtx = findChild(nodePatternCtx, Ctx.Properties);
  const mapLitCtx = findChild(propsCtx, Ctx.MapLiteral);
  const properties = extractProperties(mapLitCtx);
  const propertiesExpr = extractDynamicProperties(mapLitCtx);

  return { variable, labels: labelExpr, properties, propertiesExpr };
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
export function extractLabelExpression(nodePatternCtx: TreeNode): LabelExpression | undefined {
  if (!nodePatternCtx || !nodePatternCtx.children) return undefined;

  const labels: string[] = [];
  const orLabels: string[] = [];
  const notLabels: string[] = [];
  const orNotLabels: string[] = [];

  // 1. Collect labels from the standard NodeLabels/NodeLabel children.
  const labelsCtx = findChild(nodePatternCtx, Ctx.NodeLabels);
  const labelCtxs = findAllChildren(labelsCtx, Ctx.NodeLabel);
  for (const lc of labelCtxs) {
    const labelNameCtx = findChild(lc, Ctx.LabelName);
    if (!labelNameCtx) continue;

    const errorNode = findDescendant(labelNameCtx, 'ErrorNodeImpl');
    const hasNegation = errorNode?.symbol?.text === '!';

    const name = getSymbolicName(labelNameCtx);
    if (name) {
      const cleanName = name.startsWith('!') ? name.slice(1) : name;
      if (hasNegation) {
        notLabels.push(cleanName);
      } else {
        labels.push(cleanName);
      }
    }
  }

  // 2. Collect additional labels from ErrorNodeImpl children of NodePattern.
  const errorNodes = nodePatternCtx.children.filter(
    (c: ParseTreeNode) => c.constructor.name === 'ErrorNodeImpl',
  ) as ParseTreeNode[];

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
      negated = false;
    } else if (text && !text.includes(')')) {
      if (negated) {
        if (sawPipe) {
          orNotLabels.push(text);
        } else {
          notLabels.push(text);
        }
      } else if (sawPipe) {
        orLabels.push(text);
      } else {
        labels.push(text);
      }
      negated = false;
    }
  }

  if (labels.length === 0 && orLabels.length === 0 && notLabels.length === 0 && orNotLabels.length === 0) return undefined;
  return { labels, orLabels, notLabels, orNotLabels };
}

/** Evaluate a static arithmetic expression (all operands must be literals). */
function evaluateStaticArithmetic(expr: Expression): CypherValue {
  if (expr.type === 'Literal') return expr.value;
  if (expr.type !== 'Arithmetic') {
    throw new Error(`Non-static expression in CREATE properties is not supported: ${expr.type}`);
  }
  const result = evaluateArithmeticCore(expr, (e) => evaluateStaticArithmetic(e as Expression));
  if (result === null) throw new Error('Static arithmetic evaluation failed (non-numeric operands)');
  return result;
}

export function extractProperties(mapLiteralCtx: TreeNode): Record<string, CypherValue> | undefined {
  if (!mapLiteralCtx) return undefined;

  const entries = findAllChildren(mapLiteralCtx, Ctx.LiteralEntry);
  if (entries.length === 0) return undefined;

  const props: Record<string, CypherValue> = {};
  for (const entry of entries) {
    const keyCtx = findChild(entry, Ctx.PropertyKey);
    const key = getSymbolicName(keyCtx);
    const exprCtx = findChild(entry, Ctx.Expression);
    const value = evaluateExpression(exprCtx, extractWhereExpression);

    if (!key || !value) continue;

    if (value.type === 'Literal') {
      props[key] = value.value;
    } else if (value.type === 'Arithmetic') {
      try {
        props[key] = evaluateStaticArithmetic(value);
      } catch {
        // Non-static — skip (propertiesExpr will handle it)
      }
    } else if (value.type === 'ListLiteral') {
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
      const mapVals: Record<string, CypherValue> = {};
      for (const me of value.entries) {
        if (me.value.type === 'Literal') mapVals[me.key] = me.value.value;
      }
      props[key] = mapVals;
    }
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

/** Extract unevaluated property expressions from a MapLiteral (for dynamic CREATE inside FOREACH). */
export function extractDynamicProperties(mapLiteralCtx: TreeNode): Record<string, Expression> | undefined {
  if (!mapLiteralCtx) return undefined;

  const entries = findAllChildren(mapLiteralCtx, Ctx.LiteralEntry);
  if (entries.length === 0) return undefined;

  const props: Record<string, Expression> = {};
  for (const entry of entries) {
    const keyCtx = findChild(entry, Ctx.PropertyKey);
    const key = getSymbolicName(keyCtx);
    const exprCtx = findChild(entry, Ctx.Expression);
    const value = evaluateExpression(exprCtx, extractWhereExpression);

    if (key && value) {
      props[key] = value;
    }
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

// ── Relationship pattern extraction ──────────────────────────────────────────

export function extractRelationPattern(relPatternCtx: TreeNode): RelationPattern {
  if (!relPatternCtx) return { variable: undefined, type: undefined, minDepth: undefined, maxDepth: undefined, variableLength: false, direction: 'UNDIRECTED' };

  const direction = extractDirection(relPatternCtx);
  const detailCtx = findChild(relPatternCtx, Ctx.RelationshipDetail);

  const variable = detailCtx ? getSymbolicName(findChild(detailCtx, Ctx.Variable)) : undefined;

  const typesCtx = findChild(detailCtx, Ctx.RelationshipTypes);
  const typeCtx = findChild(typesCtx, Ctx.RelationshipType);
  const typeNameCtx = findChild(typeCtx, Ctx.RelTypeName);
  const type = getSymbolicName(typeNameCtx);

  const rangeCtx = findChild(detailCtx, Ctx.RangeLiteral);
  if (rangeCtx) {
    let minDepth: number | undefined;
    let maxDepth: number | undefined;

    const children = rangeCtx.children || [];
    const intLits = children.filter((c: ParseTreeNode) => c.constructor.name === Ctx.IntegerLiteral);
    const rangeOpIdx = children.findIndex((c: ParseTreeNode) => c.symbol?.text === '..');

    if (intLits.length === 1) {
      const text = getTerminalText(intLits[0]);
      const val = text ? parseInt(text, 10) : 0;
      if (rangeOpIdx < 0) {
        minDepth = val;
        maxDepth = val;
      } else if (intLits[0] === children[rangeOpIdx - 1]) {
        minDepth = val;
      } else {
        maxDepth = val;
      }
    } else if (intLits.length === 2) {
      const values = intLits.map((ic) => {
        const text = getTerminalText(ic);
        return text ? parseInt(text, 10) : 0;
      });
      minDepth = values[0];
      maxDepth = values[1];
    }

    return {
      variable,
      type,
      minDepth,
      maxDepth,
      variableLength: true,
      direction,
    };
  }

  return { variable, type, minDepth: undefined, maxDepth: undefined, variableLength: false, direction };
}

export function extractDirection(relPatternCtx: TreeNode): Direction {
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

// ── Path expression extraction (shortestPath / allShortestPaths) ─────────────

export function extractPathExpression(spCtx: TreeNode): PathExpression | undefined {
  if (!spCtx) return undefined;

  const spNameCtx = findChild(spCtx, Ctx.ShortestPathFunctionName);
  const aspNameCtx = findChild(spCtx, Ctx.AllShortestPathFunctionName);
  const functionName = spNameCtx
    ? 'shortestPath' as const
    : aspNameCtx
      ? 'allShortestPaths' as const
      : undefined;
  if (!functionName) return undefined;

  const patternElement = findChild(spCtx, Ctx.PatternElement);
  if (!patternElement) return undefined;

  const nodePatterns = findAllChildren(patternElement, Ctx.NodePattern);
  const sourcePattern = nodePatterns[0] ? extractNodePattern(nodePatterns[0]) : {
    variable: '',
    labels: undefined,
    properties: undefined,
    propertiesExpr: undefined,
  };

  const chains = findAllChildren(patternElement, Ctx.PatternElementChain);
  let relationPattern: RelationPattern = {
    variable: undefined,
    type: undefined,
    minDepth: undefined,
    maxDepth: undefined,
    variableLength: false,
    direction: 'UNDIRECTED',
  };
  let targetPattern: NodePattern = {
    variable: '',
    labels: undefined,
    properties: undefined,
    propertiesExpr: undefined,
  };

  if (chains.length > 0) {
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

  return { type: 'Path' as const, functionName, sourcePattern, relationPattern, targetPattern };
}
