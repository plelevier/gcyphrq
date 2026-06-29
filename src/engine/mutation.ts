import { randomUUID } from 'crypto';
import type { GraphInstance } from '../graph';
import type { CypherEdge, CypherNode, CypherValue, Expression, MergeAction, MergeClause, MergeSetAction, NodePattern, QueryContext, RelationPattern, RemoveItem, WriteClause } from '../types/cypher';
import type { GraphConfig } from '../types/cypher';
import { isContextChain, materialiseChain, resolveChainValue, type ContextChain, CHAIN_BASE, CHAIN_OVERRIDES } from './context-chain';
import { getMatchingNodeIds, matchNodeCriteria, deepEquals, matchDynamicProperties } from './match';

/** Resolve a node: use existing if bound, otherwise create new. */
function resolveOrCreateNode(
  graph: GraphInstance,
  config: GraphConfig,
  pattern: NodePattern,
  context: QueryContext,
  evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
): CypherNode {
  const bound = context[pattern.variable];
  if (bound && typeof bound === 'object' && !Array.isArray(bound) && 'id' in bound && graph.hasNode((bound as CypherNode).id)) {
    const attrs = graph.getNodeAttributes((bound as CypherNode).id);
    return { id: (bound as CypherNode).id, ...attrs } as CypherNode;
  }
  const newId = randomUUID();
  const labelExpr = pattern.labels;
  const labelValue = labelExpr?.labels && labelExpr.labels.length > 0
    ? (labelExpr.labels.length === 1 ? labelExpr.labels[0]! : labelExpr.labels)
    : undefined;
  let props: Record<string, CypherValue> = pattern.properties ?? {};
  if (pattern.propertiesExpr) {
    props = {};
    for (const [key, expr] of Object.entries(pattern.propertiesExpr)) {
      props[key] = evalExpr(expr, context) as CypherValue;
    }
  }
  graph.addNode(newId, { [config.labelProperty]: labelValue, ...props });
  const newNode = { id: newId, [config.labelProperty]: labelValue, ...props } as CypherNode;
  if (pattern.variable) context[pattern.variable] = newNode;
  return newNode;
}

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
    for (const context of materialised) {
      const hops = clause.hops;
      for (let hopIdx = 0; hopIdx < hops.length; hopIdx++) {
        const hop = hops[hopIdx]!;
        hop._hasChain = hopIdx === 0 && !clause.hasChain ? false : true;

        if (!hop._hasChain) {
          // Single node pattern
          resolveOrCreateNode(graph, config, hop.sourcePattern, context, evalExpr);
          continue;
        }

        // Resolve source node (bound from context or previous hop)
        const sourceNode = resolveOrCreateNode(graph, config, hop.sourcePattern, context, evalExpr);

        // Resolve target node (bound from context or create new)
        const targetNode = resolveOrCreateNode(graph, config, hop.targetPattern, context, evalExpr);

        // Determine edge direction
        let edgeSource: string;
        let edgeTarget: string;
        const direction = hop.relationPattern.direction;
        if (direction === 'OUT') { edgeSource = sourceNode.id; edgeTarget = targetNode.id; }
        else if (direction === 'IN') { edgeSource = targetNode.id; edgeTarget = sourceNode.id; }
        else { edgeSource = sourceNode.id; edgeTarget = targetNode.id; }

        // Create edge
        const newEdgeId = randomUUID();
        const edgeAttrs: Record<string, unknown> = {};
        if (hop.relationPattern.type) edgeAttrs[config.edgeTypeProperty] = hop.relationPattern.type;
        let edgeProps: Record<string, CypherValue> = hop.edgeProperties ?? {};
        if (hop.edgePropertiesExpr) {
          edgeProps = {};
          for (const [key, expr] of Object.entries(hop.edgePropertiesExpr)) {
            edgeProps[key] = evalExpr(expr, context) as CypherValue;
          }
        }
        Object.assign(edgeAttrs, edgeProps);
        graph.addEdgeWithKey(newEdgeId, edgeSource, edgeTarget, edgeAttrs);
        const edge: CypherEdge = { id: newEdgeId, source: edgeSource, target: edgeTarget, ...edgeAttrs } as CypherEdge;
        if (hop.relationPattern.variable) context[hop.relationPattern.variable] = edge;
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

/** Execute a MERGE stage (supports multi-hop patterns). */
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
  const { hops, hasChains, onCreate, onMatch } = clause;
  const outgoingContexts: (QueryContext | ContextChain)[] = [];
  let warnedNoLabelsOut = warnedNoLabels;

  for (const context of incomingContexts) {
    let created = false;
    const overrides: QueryContext = {};
    const flatCtx = isContextChain(context) ? materialiseChain(context) : context;

    if (!hasChains) {
      // Single node MERGE
      const firstHop = hops[0]!;
      const { id: sourceId, created: sourceCreated, warned: sourceWarned } = findOrCreateSingleNode(graph, indexes, config, firstHop.sourcePattern, context, evalExpr, warnedNoLabelsOut, onWarning);
      warnedNoLabelsOut = sourceWarned;
      created = sourceCreated;
      const sourceAttr = graph.getNodeAttributes(sourceId);
      overrides[firstHop.sourcePattern.variable] = { id: sourceId, ...sourceAttr } as CypherNode;
    } else {
      // Chain MERGE: process hops sequentially
      let warnedLocal = warnedNoLabelsOut;
      for (let hopIdx = 0; hopIdx < hops.length; hopIdx++) {
        const hop = hops[hopIdx]!;
        hop._hasChain = hopIdx === 0 ? hasChains : true;

        // Resolve source node
        let sourceId: string;
        let sourceCreated = false;

        // For multi-hop: use previous hop's target as source
        let prevTargetVar = '';
        if (hopIdx > 0) {
          prevTargetVar = hops[hopIdx - 1]!.targetPattern.variable;
        }
        const boundSource = resolveChainValue(context, hop.sourcePattern.variable) || overrides[hop.sourcePattern.variable] || (prevTargetVar ? overrides[prevTargetVar] : undefined);
        if (boundSource && typeof boundSource === 'object' && !Array.isArray(boundSource) && 'id' in boundSource) {
          sourceId = (boundSource as CypherNode).id;
          const freshAttrs = graph.getNodeAttributes(sourceId);
          if (!matchNodeCriteria(freshAttrs, config, hop.sourcePattern) || (hop.sourcePattern.propertiesExpr && !matchDynamicProperties(hop.sourcePattern.propertiesExpr, freshAttrs, flatCtx, evalExpr))) {
            const result = findOrCreateSingleNode(graph, indexes, config, hop.sourcePattern, context, evalExpr, warnedLocal, onWarning);
            sourceId = result.id;
            sourceCreated = result.created;
            warnedLocal = result.warned;
          }
        } else {
          const result = findOrCreateSingleNode(graph, indexes, config, hop.sourcePattern, context, evalExpr, warnedLocal, onWarning);
          sourceId = result.id;
          sourceCreated = result.created;
          warnedLocal = result.warned;
        }
        created = created || sourceCreated;
        const sourceAttr = graph.getNodeAttributes(sourceId);
        overrides[hop.sourcePattern.variable] = { id: sourceId, ...sourceAttr } as CypherNode;

        if (!hop._hasChain) continue;

        // Resolve target node
        let targetId: string;
        let targetCreated = false;
        const boundTarget = resolveChainValue(context, hop.targetPattern.variable) || overrides[hop.targetPattern.variable];
        if (boundTarget && typeof boundTarget === 'object' && !Array.isArray(boundTarget) && 'id' in boundTarget) {
          targetId = (boundTarget as CypherNode).id;
          const freshAttrs = graph.getNodeAttributes(targetId);
          if (!matchNodeCriteria(freshAttrs, config, hop.targetPattern) || (hop.targetPattern.propertiesExpr && !matchDynamicProperties(hop.targetPattern.propertiesExpr, freshAttrs, flatCtx, evalExpr))) {
            const result = findOrCreateSingleNode(graph, indexes, config, hop.targetPattern, context, evalExpr, warnedLocal, onWarning);
            targetId = result.id;
            targetCreated = result.created;
            warnedLocal = result.warned;
          }
        } else {
          const result = findOrCreateSingleNode(graph, indexes, config, hop.targetPattern, context, evalExpr, warnedLocal, onWarning);
          targetId = result.id;
          targetCreated = result.created;
          warnedLocal = result.warned;
        }
        // Prevent self-loops: if target resolved to the same node as source and no explicit match, create new
        if (targetId === sourceId && !boundTarget) {
          const newResult = findOrCreateSingleNode(graph, indexes, config, hop.targetPattern, context, evalExpr, warnedLocal, onWarning);
          // If it still returns the same node (all nodes match), we need a truly new one
          if (newResult.id === sourceId) {
            const newId = randomUUID();
            const attrs: Record<string, unknown> = { ...hop.targetPattern.properties };
            const andLabels = hop.targetPattern.labels?.labels;
            if (andLabels && andLabels.length > 0) attrs[config.labelProperty] = andLabels.length === 1 ? andLabels[0]! : andLabels;
            graph.addNode(newId, attrs);
            targetId = newId;
            targetCreated = true;
          } else {
            targetId = newResult.id;
            targetCreated = newResult.created;
            warnedLocal = newResult.warned;
          }
        }
        created = created || targetCreated;
        const targetAttr = graph.getNodeAttributes(targetId);
        overrides[hop.targetPattern.variable] = { id: targetId, ...targetAttr } as CypherNode;

        // Find or create edge
        let edgeId: string | undefined;
        let edgeSource = sourceId;
        let edgeTarget = targetId;
        if (hop.relationPattern.direction === 'OUT') {
          edgeId = findEdgeBetween(graph, config, sourceId, targetId, hop.relationPattern.type);
        } else if (hop.relationPattern.direction === 'IN') {
          edgeId = findEdgeBetween(graph, config, targetId, sourceId, hop.relationPattern.type);
          if (edgeId) { edgeSource = targetId; edgeTarget = sourceId; }
        } else {
          edgeId = findEdgeBetween(graph, config, sourceId, targetId, hop.relationPattern.type);
          if (edgeId) { edgeSource = sourceId; edgeTarget = targetId; }
          else { edgeId = findEdgeBetween(graph, config, targetId, sourceId, hop.relationPattern.type); if (edgeId) { edgeSource = targetId; edgeTarget = sourceId; } }
        }

        let edge: CypherEdge;
        if (edgeId) {
          const edgeAttrs = graph.getEdgeAttributes(edgeId);
          edge = { id: edgeId, source: edgeSource, target: edgeTarget, ...edgeAttrs } as CypherEdge;
        } else {
          const newEdgeId = randomUUID();
          const edgeAttrs: Record<string, unknown> = {};
          if (hop.relationPattern.type) edgeAttrs[config.edgeTypeProperty] = hop.relationPattern.type;
          graph.addEdgeWithKey(newEdgeId, edgeSource, edgeTarget, edgeAttrs);
          edge = { id: newEdgeId, source: edgeSource, target: edgeTarget, ...edgeAttrs } as CypherEdge;
          created = true;
        }
        if (hop.relationPattern.variable) overrides[hop.relationPattern.variable] = edge;
      }
      warnedNoLabelsOut = warnedLocal;
    }

    const chain: ContextChain = { [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: overrides };

    let isMatch = !created;
    if (clause.where) {
      const flat = materialiseChain(chain);
      if (!evaluateWhere(clause.where, flat)) { if (!created) isMatch = false; }
    }

    const action = isMatch ? onMatch : onCreate;
    if (action && (action.setActions.length > 0 || action.deleteVariables.length > 0 || action.detachDeleteVariables.length > 0 || action.removeItems.length > 0)) {
      // Collect all relationship variables for applyMergeActions
      const relVars = hops.filter((h) => h.relationPattern.variable).map((h) => h.relationPattern.variable!);
      applyMergeActions(graph, config, action, chain, relVars, evalExpr);
    }

    outgoingContexts.push(chain);
  }

  return { contexts: outgoingContexts, warnedNoLabels: warnedNoLabelsOut };
}

function findOrCreateSingleNode(
  graph: GraphInstance, indexes: any, config: GraphConfig, pattern: NodePattern,
  context: QueryContext | ContextChain, evalExpr: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
  warnedNoLabels: boolean, onWarning?: (message: string) => void,
): { id: string; created: boolean; warned: boolean } {
  let { ids: candidates, warned } = getMatchingNodeIds(graph, indexes, config, pattern, warnedNoLabels, onWarning);
  // Filter by dynamic properties (propertiesExpr) if present
  if (pattern.propertiesExpr && evalExpr) {
    const flatCtx = isContextChain(context) ? materialiseChain(context) : context;
    candidates = candidates.filter((id) => matchDynamicProperties(pattern.propertiesExpr!, graph.getNodeAttributes(id), flatCtx, evalExpr));
  }
  if (candidates.length > 0) return { id: candidates[0]!, created: false, warned };
  const newId = randomUUID();
  const attrs: Record<string, unknown> = { ...pattern.properties };
  const andLabels = pattern.labels?.labels;
  if (andLabels && andLabels.length > 0) attrs[config.labelProperty] = andLabels.length === 1 ? andLabels[0]! : andLabels;
  graph.addNode(newId, attrs);
  return { id: newId, created: true, warned };
}

function findEdgeBetween(graph: GraphInstance, config: GraphConfig, sourceId: string, targetId: string, type?: string): string | undefined {
  let foundEdgeId: string | undefined;
  graph.forEachOutboundEdge(sourceId, (edgeId, attrs, src, tgt) => { if (foundEdgeId) return; if (tgt === targetId && (!type || attrs[config.edgeTypeProperty] === type)) foundEdgeId = edgeId; });
  if (!foundEdgeId) { graph.forEachEdge((edgeId, attrs, src, tgt) => { if (foundEdgeId) return; if (src === sourceId && tgt === targetId && (!type || attrs[config.edgeTypeProperty] === type)) foundEdgeId = edgeId; }); }
  return foundEdgeId;
}

export function applyMergeActions(
  graph: GraphInstance, config: GraphConfig,
  action: MergeAction, chain: ContextChain, relationVariables?: string[],
  evalExpr?: (expr: Expression, ctx: QueryContext) => CypherValue | undefined,
): void {
  const context = materialiseChain(chain);

  for (const setAction of action.setActions) {
    const varName = setAction.variable;
    const value = evalExpr ? evalExpr(setAction.value, context) : undefined;
    if (relationVariables?.includes(varName)) {
      const edge = chain[CHAIN_OVERRIDES][varName] as CypherEdge | undefined;
      if (edge && edge.id) {
        graph.setEdgeAttribute(edge.id, setAction.property, value);
        const freshAttrs = graph.getEdgeAttributes(edge.id);
        const freshEdge = { id: edge.id, source: edge.source, target: edge.target, ...freshAttrs } as CypherEdge;
        chain[CHAIN_OVERRIDES][varName] = freshEdge;
      }
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
