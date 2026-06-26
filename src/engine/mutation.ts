import { randomUUID } from 'crypto';
import type { GraphInstance } from '../graph';
import type { CypherEdge, CypherNode, CypherValue, Expression, MergeAction, MergeClause, MergeSetAction, NodePattern, QueryContext, RelationPattern, RemoveItem, WriteClause } from '../types/cypher';
import type { GraphConfig } from '../types/cypher';
import { isContextChain, materialiseChain, resolveChainValue, type ContextChain, CHAIN_BASE, CHAIN_OVERRIDES } from './context-chain';
import { getMatchingNodeIds, matchNodeCriteria, deepEquals, matchDynamicProperties } from './match';

/** Execute a WRITE mutation (CREATE, SET, DELETE, REMOVE). */
export function executeWrite(
  graph: GraphInstance,
  config: GraphConfig,
  clause: WriteClause,
  contexts: (QueryContext | ContextChain)[],
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
): void {
  for (let i = 0; i < contexts.length; i++) { const ctx = contexts[i]; if (ctx && isContextChain(ctx)) contexts[i] = materialiseChain(ctx); }
  const materialised = contexts as QueryContext[];

  if (clause.type === 'CREATE') {
    if (clause.hasChain && clause.relationPattern && clause.targetPattern) {
      for (const context of materialised) {
        let sourceNode: CypherNode;
        const sourceWasBound = clause.variable in context && context[clause.variable] && (context[clause.variable] as CypherNode).id && graph.hasNode((context[clause.variable] as CypherNode).id);
        if (sourceWasBound) { sourceNode = { id: (context[clause.variable] as CypherNode).id, ...graph.getNodeAttributes((context[clause.variable] as CypherNode).id) } as CypherNode; }
        else {
          const newSourceId = randomUUID();
          const labelValue = clause.labels && clause.labels.length > 0 ? (clause.labels.length === 1 ? clause.labels[0]! : clause.labels) : undefined;
          let props: Record<string, CypherValue> = clause.properties ?? {};
          if (clause.propertiesExpr) { props = {}; for (const [key, expr] of Object.entries(clause.propertiesExpr)) props[key] = evalExpr(expr, context) as CypherValue; }
          graph.addNode(newSourceId, { [config.labelProperty]: labelValue, ...props });
          sourceNode = { id: newSourceId, [config.labelProperty]: labelValue, ...props } as CypherNode;
          context[clause.variable] = sourceNode;
        }

        let targetNode: CypherNode;
        const targetWasBound = clause.targetPattern.variable in context && context[clause.targetPattern.variable] && (context[clause.targetPattern.variable] as CypherNode).id && graph.hasNode((context[clause.targetPattern.variable] as CypherNode).id) && !(clause.targetPattern.variable === clause.variable && !sourceWasBound);
        if (targetWasBound) { targetNode = { id: (context[clause.targetPattern.variable] as CypherNode).id, ...graph.getNodeAttributes((context[clause.targetPattern.variable] as CypherNode).id) } as CypherNode; }
        else {
          const newTargetId = randomUUID();
          const targetLabelValue = clause.targetPattern.labels && clause.targetPattern.labels.labels.length > 0 ? (clause.targetPattern.labels.labels.length === 1 ? clause.targetPattern.labels.labels[0]! : clause.targetPattern.labels.labels) : undefined;
          let targetProps: Record<string, CypherValue> = clause.targetPattern.properties ?? {};
          if (clause.targetPattern.propertiesExpr) { targetProps = {}; for (const [key, expr] of Object.entries(clause.targetPattern.propertiesExpr)) targetProps[key] = evalExpr(expr, context) as CypherValue; }
          graph.addNode(newTargetId, { [config.labelProperty]: targetLabelValue, ...targetProps });
          targetNode = { id: newTargetId, [config.labelProperty]: targetLabelValue, ...targetProps } as CypherNode;
          context[clause.targetPattern.variable] = targetNode;
        }

        let edgeSource: string; let edgeTarget: string;
        const direction = clause.relationPattern.direction;
        if (direction === 'OUT') { edgeSource = sourceNode.id; edgeTarget = targetNode.id; }
        else if (direction === 'IN') { edgeSource = targetNode.id; edgeTarget = sourceNode.id; }
        else { edgeSource = sourceNode.id; edgeTarget = targetNode.id; }

        const newEdgeId = randomUUID();
        const edgeAttrs: Record<string, unknown> = {};
        if (clause.relationPattern.type) edgeAttrs[config.edgeTypeProperty] = clause.relationPattern.type;
        let edgeProps: Record<string, CypherValue> = clause.edgeProperties ?? {};
        if (clause.edgePropertiesExpr) { edgeProps = {}; for (const [key, expr] of Object.entries(clause.edgePropertiesExpr)) edgeProps[key] = evalExpr(expr, context) as CypherValue; }
        Object.assign(edgeAttrs, edgeProps);
        graph.addEdgeWithKey(newEdgeId, edgeSource, edgeTarget, edgeAttrs);
        const edge: CypherEdge = { id: newEdgeId, source: edgeSource, target: edgeTarget, ...edgeAttrs } as CypherEdge;
        if (clause.relationPattern.variable) context[clause.relationPattern.variable] = [edge];
      }
    } else {
      for (const context of materialised) {
        const newId = randomUUID();
        const labelValue = clause.labels && clause.labels.length > 0 ? (clause.labels.length === 1 ? clause.labels[0]! : clause.labels) : undefined;
        let props: Record<string, CypherValue> = clause.properties ?? {};
        if (clause.propertiesExpr) { props = {}; for (const [key, expr] of Object.entries(clause.propertiesExpr)) props[key] = evalExpr(expr, context) as CypherValue; }
        graph.addNode(newId, { [config.labelProperty]: labelValue, ...props });
        const newNode = { id: newId, [config.labelProperty]: labelValue, ...props } as CypherNode;
        context[clause.variable] = newNode;
      }
    }
  } else if (clause.type === 'SET') {
    for (const item of clause.items) {
      if (item.labels && item.labels.length > 0) {
        for (const context of materialised) {
          const target = context[item.variable] as CypherNode | undefined;
          if (target && target.id && graph.hasNode(target.id)) {
            const nodeId = target.id; const attrs = graph.getNodeAttributes(nodeId);
            const currentRaw = attrs[config.labelProperty];
            const existingLabels = typeof currentRaw === 'string' ? [currentRaw] : Array.isArray(currentRaw) ? currentRaw.filter((l: unknown): l is string => typeof l === 'string') : [];
            const merged = [...new Set([...existingLabels, ...item.labels])];
            if (merged.length === 0) { /* no-op */ }
            else if (merged.length === 1) graph.setNodeAttribute(nodeId, config.labelProperty, merged[0]);
            else graph.setNodeAttribute(nodeId, config.labelProperty, merged);
          }
        }
      }
      if (item.property && item.value) {
        const nodeIds = new Set<string>(); const edgeIds = new Set<string>();
        for (const context of materialised) {
          const target = context[item.variable] as CypherNode | CypherEdge | undefined;
          if (target && target.id) { if (graph.hasNode(target.id)) nodeIds.add(target.id); else if (graph.hasEdge(target.id)) edgeIds.add(target.id); }
        }
        for (const nodeId of nodeIds) {
          const ctx = materialised.find((c) => { const t = c[item.variable] as CypherNode | CypherEdge | undefined; return t && t.id === nodeId; });
          const evaluatedValue = ctx ? evalExpr(item.value, ctx) : undefined;
          graph.setNodeAttribute(nodeId, item.property, evaluatedValue);
        }
        for (const edgeId of edgeIds) {
          const ctx = materialised.find((c) => { const t = c[item.variable] as CypherNode | CypherEdge | undefined; return t && t.id === edgeId; });
          const evaluatedValue = ctx ? evalExpr(item.value, ctx) : undefined;
          graph.setEdgeAttribute(edgeId, item.property, evaluatedValue);
        }
      }
    }
    // Refresh context for all variables referenced in SET items
    const allVariables = new Set(clause.items.map((item) => item.variable));
    for (const variable of allVariables) {
      for (const context of materialised) {
        const target = context[variable] as CypherNode | CypherEdge | undefined;
        if (target && target.id) {
          if (graph.hasNode(target.id)) context[variable] = { id: target.id, ...graph.getNodeAttributes(target.id) } as CypherNode;
          else if (graph.hasEdge(target.id)) { const edgeInfo = graph.getEdgeEndpoints(target.id); context[variable] = { id: target.id, source: edgeInfo.source, target: edgeInfo.target, ...graph.getEdgeAttributes(target.id) } as CypherEdge; }
        }
      }
    }
  } else if (clause.type === 'DELETE') {
    const nodeIds = new Set<string>(); const edgeIds = new Set<string>();
    for (const varName of clause.variables) {
      for (const context of materialised) {
        const target = context[varName] as CypherNode | CypherEdge | (CypherNode | CypherEdge)[] | undefined;
        if (Array.isArray(target)) { for (const item of target) { if (item.id) { if (graph.hasNode(item.id)) nodeIds.add(item.id); else if (graph.hasEdge(item.id)) edgeIds.add(item.id); } } }
        else if (target && target.id) { if (graph.hasNode(target.id)) nodeIds.add(target.id); else if (graph.hasEdge(target.id)) edgeIds.add(target.id); }
      }
    }
    if (clause.detach) { for (const nodeId of nodeIds) graph.forEachEdge(nodeId, (edgeId) => { edgeIds.add(edgeId); }); }
    for (const edgeId of edgeIds) graph.dropEdge(edgeId);
    for (const nodeId of nodeIds) graph.dropNode(nodeId);
    for (const varName of clause.variables) {
      for (const context of materialised) {
        const target = context[varName] as CypherNode | CypherEdge | (CypherNode | CypherEdge)[] | undefined;
        if (Array.isArray(target)) { let anyDeleted = false; for (const item of target) { if (item.id && (nodeIds.has(item.id) || edgeIds.has(item.id))) { anyDeleted = true; break; } } if (anyDeleted) context[varName] = null; }
        else if (target && target.id && (nodeIds.has(target.id) || edgeIds.has(target.id))) context[varName] = null;
      }
    }
  } else if (clause.type === 'REMOVE') {
    const nodeMap = new Map<string, Set<string>>(); const edgeMap = new Map<string, Set<string>>();
    for (const item of clause.items) {
      for (const context of materialised) {
        const target = context[item.variable] as CypherNode | CypherEdge | CypherEdge[] | undefined;
        if (Array.isArray(target)) { for (const edge of target) { if (edge.id && graph.hasEdge(edge.id)) { if (!edgeMap.has(item.variable)) edgeMap.set(item.variable, new Set()); edgeMap.get(item.variable)!.add(edge.id); } } }
        else if (target && target.id) { if (graph.hasNode(target.id)) { if (!nodeMap.has(item.variable)) nodeMap.set(item.variable, new Set()); nodeMap.get(item.variable)!.add(target.id); } else if (graph.hasEdge(target.id)) { if (!edgeMap.has(item.variable)) edgeMap.set(item.variable, new Set()); edgeMap.get(item.variable)!.add(target.id); } }
      }
    }
    for (const item of clause.items) {
      const nodeIds = nodeMap.get(item.variable); const edgeIds = edgeMap.get(item.variable);
      if (nodeIds && item.property) for (const nodeId of nodeIds) graph.setNodeAttribute(nodeId, item.property, undefined);
      if (edgeIds && item.property) for (const edgeId of edgeIds) graph.setEdgeAttribute(edgeId, item.property, undefined);
      if (nodeIds && item.labels && item.labels.length > 0) {
        const removeLabels = item.labels;
        for (const nodeId of nodeIds) {
          const attrs = graph.getNodeAttributes(nodeId); const currentRaw = attrs[config.labelProperty];
          if (typeof currentRaw === 'string') { if (removeLabels.some((l) => l === currentRaw)) graph.setNodeAttribute(nodeId, config.labelProperty, undefined); }
          else if (Array.isArray(currentRaw)) { const remaining = currentRaw.filter((l: string) => !removeLabels.includes(l)); if (remaining.length === 0) graph.setNodeAttribute(nodeId, config.labelProperty, undefined); else if (remaining.length === 1) graph.setNodeAttribute(nodeId, config.labelProperty, remaining[0]); else graph.setNodeAttribute(nodeId, config.labelProperty, remaining); }
        }
      }
    }
    for (const [variable, nodeIds] of nodeMap) { for (const context of materialised) { const target = context[variable] as CypherNode | CypherEdge | undefined; if (target && target.id && nodeIds.has(target.id)) context[variable] = { id: target.id, ...graph.getNodeAttributes(target.id) } as CypherNode; } }
    for (const [variable, edgeIds] of edgeMap) { for (const context of materialised) { const target = context[variable] as CypherNode | CypherEdge | undefined; if (target && target.id && edgeIds.has(target.id)) { const edgeInfo = graph.getEdgeEndpoints(target.id); context[variable] = { id: target.id, source: edgeInfo.source, target: edgeInfo.target, ...graph.getEdgeAttributes(target.id) } as CypherEdge; } } }
  }
}

/** Execute a MERGE stage. */
export function executeMerge(
  graph: GraphInstance,
  indexes: any,
  config: GraphConfig,
  clause: MergeClause,
  incomingContexts: (QueryContext | ContextChain)[],
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
  evaluateWhere: (whereNode: any, context: QueryContext) => boolean,
  warnedNoLabels: boolean,
  onWarning?: (message: string) => void,
): { contexts: (QueryContext | ContextChain)[]; warnedNoLabels: boolean } {
  const { sourcePattern, relationPattern, targetPattern, hasChains, onCreate, onMatch } = clause;
  const outgoingContexts: (QueryContext | ContextChain)[] = [];
  let warnedNoLabelsOut = warnedNoLabels;

  for (const context of incomingContexts) {
    let created = false;
    const overrides: QueryContext = {};

    if (!hasChains) {
      const { id: sourceId, created: sourceCreated } = findOrCreateSingleNode(graph, indexes, config, sourcePattern, context, evalExpr, warnedNoLabelsOut, onWarning);
      warnedNoLabelsOut = sourceCreated ? warnedNoLabelsOut : warnedNoLabelsOut; // no change
      created = sourceCreated;
      const sourceAttr = graph.getNodeAttributes(sourceId);
      overrides[sourcePattern.variable] = { id: sourceId, ...sourceAttr } as CypherNode;
    } else {
      const result = findOrCreateChain(graph, indexes, config, sourcePattern, relationPattern, targetPattern, context, evalExpr, warnedNoLabelsOut, onWarning);
      warnedNoLabelsOut = result.warnedNoLabels;
      created = result.created;
      overrides[sourcePattern.variable] = result.sourceNode;
      overrides[targetPattern.variable] = result.targetNode;
      if (relationPattern.variable) overrides[relationPattern.variable] = result.edges;
    }

    const chain: ContextChain = { [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: overrides };

    let isMatch = !created;
    if (clause.where) {
      const flat = materialiseChain(chain);
      if (!evaluateWhere(clause.where, flat)) { if (!created) isMatch = false; }
    }

    const action = isMatch ? onMatch : onCreate;
    if (action && (action.setActions.length > 0 || action.deleteVariables.length > 0 || action.detachDeleteVariables.length > 0 || action.removeItems.length > 0)) {
      applyMergeActions(graph, config, action, chain, hasChains ? relationPattern.variable : undefined, evalExpr);
    }

    outgoingContexts.push(chain);
  }

  return { contexts: outgoingContexts, warnedNoLabels: warnedNoLabelsOut };
}

function findOrCreateSingleNode(
  graph: GraphInstance, indexes: any, config: GraphConfig, pattern: NodePattern,
  context: QueryContext | ContextChain, evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
  warnedNoLabels: boolean, onWarning?: (message: string) => void,
): { id: string; created: boolean } {
  let { ids: candidates, warned } = getMatchingNodeIds(graph, indexes, config, pattern, warnedNoLabels, onWarning);
  // Filter by dynamic properties (propertiesExpr) if present
  if (pattern.propertiesExpr && evalExpr) {
    const flatCtx = isContextChain(context) ? materialiseChain(context) : context;
    candidates = candidates.filter((id) => matchDynamicProperties(pattern.propertiesExpr!, graph.getNodeAttributes(id), flatCtx, evalExpr));
  }
  if (candidates.length > 0) return { id: candidates[0]!, created: false };
  const newId = randomUUID();
  const attrs: Record<string, unknown> = { ...pattern.properties };
  const andLabels = pattern.labels?.labels;
  if (andLabels && andLabels.length > 0) attrs[config.labelProperty] = andLabels.length === 1 ? andLabels[0]! : andLabels;
  graph.addNode(newId, attrs);
  return { id: newId, created: true };
}

function findOrCreateChain(
  graph: GraphInstance, indexes: any, config: GraphConfig,
  sourcePattern: NodePattern, relationPattern: RelationPattern, targetPattern: NodePattern,
  context: QueryContext | ContextChain, evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
  warnedNoLabels: boolean, onWarning?: (message: string) => void,
): { sourceNode: CypherNode; targetNode: CypherNode; edges: CypherEdge[]; created: boolean; warnedNoLabels: boolean } {
  let sourceId: string | undefined;
  const boundSource = resolveChainValue(context, sourcePattern.variable);
  if (boundSource && typeof boundSource === 'object' && !Array.isArray(boundSource) && 'id' in boundSource) sourceId = (boundSource as CypherNode).id;

  let sourceCreated = false;
  let warnedNoLabelsOut = warnedNoLabels;
  const flatCtx = isContextChain(context) ? materialiseChain(context) : context;
  if (!sourceId) { const result = findOrCreateSingleNode(graph, indexes, config, sourcePattern, context, evalExpr, warnedNoLabelsOut, onWarning); sourceId = result.id; sourceCreated = result.created; warnedNoLabelsOut = warnedNoLabelsOut; }
  else {
    const freshAttrs = graph.getNodeAttributes(sourceId);
    if (!matchNodeCriteria(freshAttrs, config, sourcePattern) || (sourcePattern.propertiesExpr && !matchDynamicProperties(sourcePattern.propertiesExpr, freshAttrs, flatCtx, evalExpr))) { const result = findOrCreateSingleNode(graph, indexes, config, sourcePattern, context, evalExpr, warnedNoLabelsOut, onWarning); sourceId = result.id; sourceCreated = result.created; warnedNoLabelsOut = warnedNoLabelsOut; }
  }

  let targetId: string | undefined;
  const boundTarget = resolveChainValue(context, targetPattern.variable);
  if (boundTarget && typeof boundTarget === 'object' && !Array.isArray(boundTarget) && 'id' in boundTarget) targetId = (boundTarget as CypherNode).id;

  let targetCreated = false;
  if (!targetId) { const result = findOrCreateSingleNode(graph, indexes, config, targetPattern, context, evalExpr, warnedNoLabelsOut, onWarning); targetId = result.id; targetCreated = result.created; warnedNoLabelsOut = warnedNoLabelsOut; }
  else {
    const freshAttrs = graph.getNodeAttributes(targetId);
    if (!matchNodeCriteria(freshAttrs, config, targetPattern) || (targetPattern.propertiesExpr && !matchDynamicProperties(targetPattern.propertiesExpr, freshAttrs, flatCtx, evalExpr))) { const result = findOrCreateSingleNode(graph, indexes, config, targetPattern, context, evalExpr, warnedNoLabelsOut, onWarning); targetId = result.id; targetCreated = result.created; warnedNoLabelsOut = warnedNoLabelsOut; }
  }

  let edgeId: string | undefined;
  let edgeSource = sourceId; let edgeTarget = targetId;
  if (relationPattern.direction === 'OUT') edgeId = findEdgeBetween(graph, config, sourceId, targetId, relationPattern.type);
  else if (relationPattern.direction === 'IN') { edgeId = findEdgeBetween(graph, config, targetId, sourceId, relationPattern.type); edgeSource = targetId; edgeTarget = sourceId; }
  else {
    edgeId = findEdgeBetween(graph, config, sourceId, targetId, relationPattern.type);
    if (edgeId) { edgeSource = sourceId; edgeTarget = targetId; }
    else { edgeId = findEdgeBetween(graph, config, targetId, sourceId, relationPattern.type); if (edgeId) { edgeSource = targetId; edgeTarget = sourceId; } }
  }

  let edges: CypherEdge[];
  if (edgeId) { const edgeAttrs = graph.getEdgeAttributes(edgeId); edges = [{ id: edgeId, source: edgeSource, target: edgeTarget, ...edgeAttrs } as CypherEdge]; }
  else {
    const newEdgeId = randomUUID(); const edgeAttrs: Record<string, unknown> = {};
    if (relationPattern.type) edgeAttrs[config.edgeTypeProperty] = relationPattern.type;
    graph.addEdgeWithKey(newEdgeId, edgeSource, edgeTarget, edgeAttrs);
    edges = [{ id: newEdgeId, source: edgeSource, target: edgeTarget, ...edgeAttrs } as CypherEdge];
  }

  return {
    sourceNode: { id: sourceId, ...graph.getNodeAttributes(sourceId) } as CypherNode,
    targetNode: { id: targetId, ...graph.getNodeAttributes(targetId) } as CypherNode,
    edges, created: sourceCreated || targetCreated || !edgeId,
    warnedNoLabels: warnedNoLabelsOut,
  };
}

function findEdgeBetween(graph: GraphInstance, config: GraphConfig, sourceId: string, targetId: string, type?: string): string | undefined {
  let foundEdgeId: string | undefined;
  graph.forEachOutboundEdge(sourceId, (edgeId, attrs, src, tgt) => { if (foundEdgeId) return; if (tgt === targetId && (!type || attrs[config.edgeTypeProperty] === type)) foundEdgeId = edgeId; });
  if (!foundEdgeId) { graph.forEachEdge((edgeId, attrs, src, tgt) => { if (foundEdgeId) return; if (src === sourceId && tgt === targetId && (!type || attrs[config.edgeTypeProperty] === type)) foundEdgeId = edgeId; }); }
  return foundEdgeId;
}

export function applyMergeActions(
  graph: GraphInstance, config: GraphConfig,
  action: MergeAction, chain: ContextChain, relationVariable?: string,
  evalExpr?: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
): void {
  const context = materialiseChain(chain);

  for (const setAction of action.setActions) {
    const varName = setAction.variable;
    const value = evalExpr ? evalExpr(setAction.value, context) : undefined;
    if (relationVariable && varName === relationVariable) {
      const edgeArray = chain[CHAIN_OVERRIDES][varName] as CypherEdge[] | undefined;
      if (edgeArray && edgeArray.length > 0) { const edge = edgeArray[0]!; if (edge.id) { graph.setEdgeAttribute(edge.id, setAction.property, value); const freshAttrs = graph.getEdgeAttributes(edge.id); edgeArray[0] = { id: edge.id, source: edge.source, target: edge.target, ...freshAttrs } as CypherEdge; } }
      continue;
    }
    const targetNode = chain[CHAIN_OVERRIDES][varName] as CypherNode | undefined;
    if (targetNode && targetNode.id) { graph.setNodeAttribute(targetNode.id, setAction.property, value); chain[CHAIN_OVERRIDES][varName] = { id: targetNode.id, ...graph.getNodeAttributes(targetNode.id) } as CypherNode; }
  }

  const nodeIds = new Set<string>(); const edgeIds = new Set<string>(); const detachNodeIds = new Set<string>();
  for (const varName of action.deleteVariables) {
    const target = chain[CHAIN_OVERRIDES][varName];
    if (!target || typeof target !== 'object') continue;
    if (Array.isArray(target)) { for (const edge of target as CypherEdge[]) { if (edge.id && graph.hasEdge(edge.id)) edgeIds.add(edge.id); } }
    else if ('id' in target) { const id = (target as CypherNode | CypherEdge).id; if (graph.hasNode(id)) nodeIds.add(id); else if (graph.hasEdge(id)) edgeIds.add(id); }
  }
  for (const varName of action.detachDeleteVariables) {
    const target = chain[CHAIN_OVERRIDES][varName];
    if (!target || typeof target !== 'object') continue;
    if (Array.isArray(target)) { for (const edge of target as CypherEdge[]) { if (edge.id && graph.hasEdge(edge.id)) edgeIds.add(edge.id); } }
    else if ('id' in target) { const id = (target as CypherNode | CypherEdge).id; if (graph.hasNode(id)) { detachNodeIds.add(id); graph.forEachEdge(id, (edgeId) => { edgeIds.add(edgeId); }); } else if (graph.hasEdge(id)) edgeIds.add(id); }
  }
  for (const edgeId of edgeIds) graph.dropEdge(edgeId);
  for (const nodeId of [...nodeIds, ...detachNodeIds]) graph.dropNode(nodeId);
  for (const varName of action.deleteVariables) {
    const target = chain[CHAIN_OVERRIDES][varName];
    if (Array.isArray(target)) { for (const edge of target as CypherEdge[]) { if (edge.id && edgeIds.has(edge.id)) { chain[CHAIN_OVERRIDES][varName] = null; break; } } }
    else if (target && typeof target === 'object' && 'id' in target) { const id = (target as CypherNode | CypherEdge).id; if (nodeIds.has(id) || edgeIds.has(id)) chain[CHAIN_OVERRIDES][varName] = null; }
  }
  for (const varName of action.detachDeleteVariables) {
    const target = chain[CHAIN_OVERRIDES][varName];
    if (Array.isArray(target)) { for (const edge of target as CypherEdge[]) { if (edge.id && edgeIds.has(edge.id)) { chain[CHAIN_OVERRIDES][varName] = null; break; } } }
    else if (target && typeof target === 'object' && 'id' in target) { const id = (target as CypherNode | CypherEdge).id; if (detachNodeIds.has(id) || edgeIds.has(id)) chain[CHAIN_OVERRIDES][varName] = null; }
  }

  const nodeMap = new Map<string, Set<string>>(); const edgeMap = new Map<string, Set<string>>();
  for (const item of action.removeItems) {
    const target = chain[CHAIN_OVERRIDES][item.variable];
    if (!target || typeof target !== 'object') continue;
    if (Array.isArray(target)) { for (const edge of target as CypherEdge[]) { if (edge.id && graph.hasEdge(edge.id)) { if (!edgeMap.has(item.variable)) edgeMap.set(item.variable, new Set()); edgeMap.get(item.variable)!.add(edge.id); } } }
    else if ('id' in target) { const id = (target as CypherNode | CypherEdge).id; if (graph.hasNode(id)) { if (!nodeMap.has(item.variable)) nodeMap.set(item.variable, new Set()); nodeMap.get(item.variable)!.add(id); } else if (graph.hasEdge(id)) { if (!edgeMap.has(item.variable)) edgeMap.set(item.variable, new Set()); edgeMap.get(item.variable)!.add(id); } }
  }
  for (const item of action.removeItems) {
    const nodeIdsToRemove = nodeMap.get(item.variable); const edgeIdsToRemove = edgeMap.get(item.variable);
    if (nodeIdsToRemove && item.property) for (const nodeId of nodeIdsToRemove) graph.setNodeAttribute(nodeId, item.property, undefined);
    if (edgeIdsToRemove && item.property) for (const edgeId of edgeIdsToRemove) graph.setEdgeAttribute(edgeId, item.property, undefined);
    if (nodeIdsToRemove && item.labels && item.labels.length > 0) {
      const removeLabels = item.labels;
      for (const nodeId of nodeIdsToRemove) {
        const attrs = graph.getNodeAttributes(nodeId); const currentRaw = attrs[config.labelProperty];
        if (typeof currentRaw === 'string') { if (removeLabels.some((l) => l === currentRaw)) graph.setNodeAttribute(nodeId, config.labelProperty, undefined); }
        else if (Array.isArray(currentRaw)) { const remaining = currentRaw.filter((l: string) => !removeLabels.includes(l)); if (remaining.length === 0) graph.setNodeAttribute(nodeId, config.labelProperty, undefined); else if (remaining.length === 1) graph.setNodeAttribute(nodeId, config.labelProperty, remaining[0]); else graph.setNodeAttribute(nodeId, config.labelProperty, remaining); }
      }
    }
  }
  for (const [variable, nodeIds] of nodeMap) { const target = chain[CHAIN_OVERRIDES][variable]; if (target && typeof target === 'object' && !Array.isArray(target) && 'id' in target) { const id = (target as CypherNode).id; if (nodeIds.has(id)) chain[CHAIN_OVERRIDES][variable] = { id, ...graph.getNodeAttributes(id) } as CypherNode; } }
  for (const [variable, edgeIds] of edgeMap) {
    const target = chain[CHAIN_OVERRIDES][variable];
    if (Array.isArray(target)) { for (const edge of target as CypherEdge[]) { if (edge.id && edgeIds.has(edge.id)) { const edgeInfo = graph.getEdgeEndpoints(edge.id); const idx = (target as CypherEdge[]).indexOf(edge); if (idx >= 0) (target as CypherEdge[])[idx] = { id: edge.id, source: edgeInfo.source, target: edgeInfo.target, ...graph.getEdgeAttributes(edge.id) } as CypherEdge; } } }
    else if (target && typeof target === 'object' && 'id' in target) { const id = (target as CypherEdge).id; if (edgeIds.has(id)) { const edgeInfo = graph.getEdgeEndpoints(id); chain[CHAIN_OVERRIDES][variable] = { id, source: edgeInfo.source, target: edgeInfo.target, ...graph.getEdgeAttributes(id) } as CypherEdge; } }
  }
}
