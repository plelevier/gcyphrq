import type { GraphInstance } from '../graph';
import type {
  CypherNode,
  CypherEdge,
  CypherValue,
  Expression,
  GraphIndexes,
  GraphConfig,
  QueryContext,
  MatchClause,
  RelationPattern,
  NodePattern,
} from '../types/cypher';
import { isContextChain, materialiseChain, resolveChainValue, type ContextChain, CHAIN_BASE, CHAIN_OVERRIDES } from './context-chain';

/**
 * Resolve node IDs matching a pattern using indexes when available.
 * Falls back to full-graph scan when indexes are absent.
 */
export function getMatchingNodeIds(
  graph: GraphInstance,
  indexes: GraphIndexes | undefined,
  config: GraphConfig,
  pattern: NodePattern,
  warnedNoLabels: boolean,
  onWarning?: (message: string) => void,
): { ids: string[]; warned: boolean } {
  let warned = warnedNoLabels;
  if (!indexes) {
    return { ids: graph.filterNodes((_node: string, attr: Record<string, unknown>) => matchNodeCriteria(attr, config, pattern)), warned };
  }

  const { labelIndex, propertyIndex } = indexes;
  const labelExpr = pattern.labels;
  const props = pattern.properties;
  const propKeys = props ? Object.keys(props) : [];
  const hasProps = propKeys.length > 0;
  const hasAndLabels = labelExpr?.labels.length ?? 0 > 0;
  const hasOrLabels = labelExpr?.orLabels.length ?? 0 > 0;
  const hasAndNotLabels = labelExpr?.notLabels.length ?? 0 > 0;
  const hasOrNotLabels = labelExpr?.orNotLabels.length ?? 0 > 0;
  const hasAnyLabels = hasAndLabels || hasOrLabels || hasAndNotLabels || hasOrNotLabels;

  if (hasAnyLabels && !warned && labelIndex.size === 0) {
    warned = true;
    const warn = onWarning ?? console.warn;
    warn(`No nodes have a "${config.labelProperty}" property. Label-based matching (e.g. MATCH (n:Label)) will return no results.`);
  }

  let labelCandidates: Set<string> | undefined;

  // Step 1: AND labels (intersect)
  let andCandidates: Set<string> | undefined;
  if (hasAndLabels && labelExpr) {
    for (const label of labelExpr.labels) {
      const labelSet = labelIndex.get(label);
      if (!labelSet || labelSet.size === 0) { andCandidates = new Set(); break; }
      if (!andCandidates) { andCandidates = new Set(labelSet); }
      else {
        const smaller = andCandidates.size < labelSet.size ? andCandidates : labelSet;
        const larger = andCandidates.size < labelSet.size ? labelSet : andCandidates;
        andCandidates = new Set([...smaller].filter((id) => larger.has(id)));
        if (!andCandidates.size) break;
      }
    }
  }
  if (andCandidates?.size === 0) andCandidates = undefined;

  // Step 2: AND NOT labels
  if (hasAndNotLabels && labelExpr) {
    const andNotIds = new Set<string>();
    for (const label of labelExpr.notLabels) {
      const labelSet = labelIndex.get(label);
      if (labelSet) for (const id of labelSet) andNotIds.add(id);
    }
    if (andCandidates) { for (const id of andNotIds) andCandidates.delete(id); }
    else { andCandidates = new Set(graph.filterNodes((id) => !andNotIds.has(id))); }
  }
  if (andCandidates?.size === 0) andCandidates = undefined;

  // Step 3: OR labels (union)
  let orCandidates: Set<string> | undefined;
  if (hasOrLabels && labelExpr) {
    for (const label of labelExpr.orLabels) {
      const labelSet = labelIndex.get(label);
      if (!labelSet) continue;
      if (!orCandidates) { orCandidates = new Set(labelSet); }
      else { for (const id of labelSet) orCandidates.add(id); }
    }
  }
  if (orCandidates?.size === 0) orCandidates = undefined;

  // Step 4: OR NOT labels
  if (hasOrNotLabels && labelExpr) {
    const orNotIds = new Set<string>();
    for (const label of labelExpr.orNotLabels) {
      const labelSet = labelIndex.get(label);
      if (labelSet) for (const id of labelSet) orNotIds.add(id);
    }
    const allNotCandidates = new Set(graph.filterNodes((id) => !orNotIds.has(id)));
    if (orCandidates) { for (const id of allNotCandidates) orCandidates.add(id); }
    else { orCandidates = allNotCandidates; }
  }

  // Step 5: Combine AND and OR
  if (andCandidates && orCandidates) { labelCandidates = new Set(andCandidates); for (const id of orCandidates) labelCandidates.add(id); }
  else if (andCandidates) { labelCandidates = andCandidates; }
  else if (orCandidates) { labelCandidates = orCandidates; }

  const hasLabels = hasAnyLabels && (labelCandidates?.size ?? 0) > 0;
  if (hasAnyLabels && !hasLabels) return { ids: [], warned };

  if (hasLabels && hasProps && props && labelCandidates) {
    const firstKey = propKeys[0];
    if (!firstKey) return { ids: [], warned };
    const firstVal = props[firstKey];
    const useIndex = firstVal !== null && firstVal !== undefined && typeof firstVal !== 'object';
    if (useIndex) {
      const propSet = propertyIndex.get(firstKey)?.get(String(firstVal));
      if (!propSet || propSet.size === 0) return { ids: [], warned };
      const candidates = propSet.size < labelCandidates.size
        ? [...propSet].filter((id) => labelCandidates.has(id))
        : [...labelCandidates].filter((id) => propSet.has(id));
      if (propKeys.length <= 1) return { ids: candidates, warned };
      return { ids: candidates.filter((id) => propKeys.slice(1).every((k) => deepEquals(graph.getNodeAttributes(id)[k], props[k]))), warned };
    }
    return { ids: [...labelCandidates].filter((id) => propKeys.every((k) => deepEquals(graph.getNodeAttributes(id)[k], props[k]))), warned };
  }

  if (hasLabels && labelCandidates) return { ids: [...labelCandidates], warned };

  if (hasProps && props) {
    const firstKey = propKeys[0];
    if (!firstKey) return { ids: [], warned };
    const firstVal = props[firstKey];
    const useIndex = firstVal !== null && firstVal !== undefined && typeof firstVal !== 'object';
    if (useIndex) {
      const propSet = propertyIndex.get(firstKey)?.get(String(firstVal));
      if (!propSet) return { ids: [], warned };
      if (propKeys.length === 1) return { ids: [...propSet], warned };
      return { ids: [...propSet].filter((id) => propKeys.slice(1).every((k) => deepEquals(graph.getNodeAttributes(id)[k], props[k]))), warned };
    }
    return { ids: graph.filterNodes((id) => propKeys.every((k) => deepEquals(graph.getNodeAttributes(id)[k], props[k]))), warned };
  }

  return { ids: graph.filterNodes(() => true), warned };
}

/**
 * Evaluate dynamic property expressions (propertiesExpr) against a node.
 * Returns true if all dynamic properties match the node attributes.
 */
export function matchDynamicProperties(
  propertiesExpr: Record<string, Expression>,
  nodeAttr: Record<string, unknown>,
  context: QueryContext,
  evalExpr: (e: Expression, ctx: QueryContext) => CypherValue | undefined,
): boolean {
  for (const [key, expr] of Object.entries(propertiesExpr)) {
    const expected = evalExpr(expr, context);
    if (expected === undefined) return false;
    if (!deepEquals(nodeAttr[key], expected)) return false;
  }
  return true;
}

/**
 * Execute a MATCH or OPTIONAL MATCH stage.
 */
export function executeMatch(
  graph: GraphInstance,
  indexes: GraphIndexes | undefined,
  config: GraphConfig,
  clause: MatchClause,
  incomingContexts: (QueryContext | ContextChain)[],
  evaluateWhere: (whereNode: any, context: QueryContext) => boolean,
  warnedNoLabels: boolean,
  warnedNoEdgeTypes: boolean,
  onWarning?: (message: string) => void,
  evalExpr?: (e: Expression, ctx: QueryContext) => CypherValue | undefined,
): { contexts: (QueryContext | ContextChain)[]; warnedNoLabels: boolean; warnedNoEdgeTypes: boolean } {
  const { sourcePattern, relationPattern, targetPattern, optional, hasChains, pathVariable } = clause;
  const outgoingContexts: (QueryContext | ContextChain)[] = [];

  const buildPath = (source: CypherNode, edges: CypherEdge[]): CypherValue => {
    const pathNodes: CypherNode[] = [source];
    for (const step of edges) {
      const tAttr = graph.getNodeAttributes(step.target);
      pathNodes.push({ id: step.target, ...tAttr } as CypherNode);
    }
    return { nodes: pathNodes, relationships: edges } as unknown as CypherValue;
  };

  const nullVar = hasChains ? targetPattern.variable : sourcePattern.variable;

  let warnedNoLabelsOut = warnedNoLabels;
  const targetResult = getMatchingNodeIds(graph, indexes, config, targetPattern, warnedNoLabelsOut, onWarning);
  warnedNoLabelsOut = targetResult.warned;
  const eligibleTargetIds = new Set(targetResult.ids);

  const getNeighbors = buildNeighborGetter(graph, indexes, config, relationPattern, warnedNoEdgeTypes, onWarning);
  let warnedNoEdgeTypesOut = warnedNoEdgeTypes;

  // Check if target pattern has dynamic properties (needs per-context filtering)
  const hasTargetDynamicProps = targetPattern.propertiesExpr && evalExpr;

  for (const context of incomingContexts) {
    let startNodeIds: string[] = [];
    const boundNode = resolveChainValue(context, sourcePattern.variable);
    if (boundNode && typeof boundNode === 'object' && !Array.isArray(boundNode) && 'id' in boundNode) {
      const boundId = (boundNode as CypherNode).id;
      if (graph.hasNode(boundId)) {
        const freshAttrs = graph.getNodeAttributes(boundId);
        if (matchNodeCriteria(freshAttrs, config, sourcePattern)) {
          // Also check dynamic properties against the current context
          if (!sourcePattern.propertiesExpr || matchDynamicProperties(sourcePattern.propertiesExpr, freshAttrs, isContextChain(context) ? materialiseChain(context) : context, evalExpr!)) {
            startNodeIds = [boundId];
          }
        }
      }
    } else {
      const result = getMatchingNodeIds(graph, indexes, config, sourcePattern, warnedNoLabelsOut, onWarning);
      startNodeIds = result.ids;
      warnedNoLabelsOut = result.warned;
      // Filter by dynamic properties (propertiesExpr) if present
      if (sourcePattern.propertiesExpr && evalExpr) {
        const flatCtx = isContextChain(context) ? materialiseChain(context) : context;
        startNodeIds = startNodeIds.filter((id) => matchDynamicProperties(sourcePattern.propertiesExpr!, graph.getNodeAttributes(id), flatCtx, evalExpr));
      }
    }

    let matchFoundForThisContext = false;

    startNodeIds.forEach((startId) => {
      const sourceAttr = graph.getNodeAttributes(startId);
      const sourceNode = { id: startId, ...sourceAttr } as CypherNode;

      if (!hasChains) {
        matchFoundForThisContext = true;
        const overrides: QueryContext = { [sourcePattern.variable]: sourceNode };
        if (pathVariable) overrides[pathVariable] = buildPath(sourceNode, []);
        outgoingContexts.push({ [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: overrides });
        return;
      }

      const minDepth = relationPattern.minDepth ?? 1;
      const maxDepth = relationPattern.maxDepth ?? (relationPattern.variableLength ? 100 : minDepth);

      const onStack = new Set<string>();
      type EdgeStep = { edgeId: string; source: string; target: string };
      const edgeHistory: EdgeStep[] = [];

      const explore = (currentId: string) => {
        if (onStack.has(currentId)) return;
        onStack.add(currentId);

        if (edgeHistory.length >= minDepth && eligibleTargetIds.has(currentId)) {
          const targetAttr = graph.getNodeAttributes(currentId);
          // Check dynamic target properties if present
          if (hasTargetDynamicProps && !matchDynamicProperties(targetPattern.propertiesExpr!, targetAttr, isContextChain(context) ? materialiseChain(context) : context, evalExpr!)) return;
          matchFoundForThisContext = true;
          const targetNode = { id: currentId, ...targetAttr } as CypherNode;
          const edges = edgeHistory.map(({ edgeId, source, target }) => ({ id: edgeId, source, target, ...graph.getEdgeAttributes(edgeId) } as CypherEdge));
          const matchOverrides: QueryContext = { [sourcePattern.variable]: sourceNode, [targetPattern.variable]: targetNode };
          if (relationPattern.variable) matchOverrides[relationPattern.variable] = edges;
          if (pathVariable) matchOverrides[pathVariable] = buildPath(sourceNode, edges);
          outgoingContexts.push({ [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: matchOverrides });
        }

        if (edgeHistory.length >= maxDepth) { onStack.delete(currentId); return; }

        getNeighbors(currentId, (neighborId, edgeId) => {
          if (neighborId === currentId) {
            if (edgeHistory.length + 1 >= minDepth && eligibleTargetIds.has(currentId)) {
              const targetAttr = graph.getNodeAttributes(currentId);
              // Check dynamic target properties if present
              if (hasTargetDynamicProps && !matchDynamicProperties(targetPattern.propertiesExpr!, targetAttr, isContextChain(context) ? materialiseChain(context) : context, evalExpr!)) return;
              matchFoundForThisContext = true;
              const targetNode = { id: currentId, ...targetAttr } as CypherNode;
              const allSteps = [...edgeHistory, { edgeId, source: currentId, target: currentId }];
              const edges = allSteps.map(({ edgeId: eid, source, target }) => ({ id: eid, source, target, ...graph.getEdgeAttributes(eid) } as CypherEdge));
              const selfLoopOverrides: QueryContext = { [sourcePattern.variable]: sourceNode, [targetPattern.variable]: targetNode };
              if (relationPattern.variable) selfLoopOverrides[relationPattern.variable] = edges;
              if (pathVariable) selfLoopOverrides[pathVariable] = buildPath(sourceNode, edges);
              outgoingContexts.push({ [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: selfLoopOverrides });
            }
            return;
          }
          edgeHistory.push({ edgeId, source: currentId, target: neighborId });
          explore(neighborId);
          edgeHistory.pop();
        });

        onStack.delete(currentId);
      };

      explore(startId);
    });

    if (optional && !matchFoundForThisContext) {
      const nullChain: ContextChain = { [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: { [nullVar]: null } };
      if (relationPattern.variable) nullChain[CHAIN_OVERRIDES][relationPattern.variable] = [];
      if (pathVariable) nullChain[CHAIN_OVERRIDES][pathVariable] = null;
      outgoingContexts.push(nullChain);
    }
  }

  if (clause.where) {
    const filtered = outgoingContexts.filter((ctx) => {
      const flat = isContextChain(ctx) ? materialiseChain(ctx) : ctx;
      return evaluateWhere(clause.where!, flat);
    });

    if (optional) {
      const matchedBases = new Set<QueryContext | ContextChain>();
      for (const ctx of filtered) { const base = isContextChain(ctx) ? ctx[CHAIN_BASE] : ctx; if (base) matchedBases.add(base); }
      for (const context of incomingContexts) {
        if (!matchedBases.has(context)) {
          const nullChain: ContextChain = { [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: { [nullVar]: null } };
          if (relationPattern.variable) nullChain[CHAIN_OVERRIDES][relationPattern.variable] = [];
          if (pathVariable) nullChain[CHAIN_OVERRIDES][pathVariable] = null;
          filtered.push(nullChain);
        }
      }
    }
    return { contexts: filtered, warnedNoLabels: warnedNoLabelsOut, warnedNoEdgeTypes: warnedNoEdgeTypesOut };
  }

  return { contexts: outgoingContexts, warnedNoLabels: warnedNoLabelsOut, warnedNoEdgeTypes: warnedNoEdgeTypesOut };
}

/** Build a neighbor iterator using the edge-type adjacency index when available. */
export function buildNeighborGetter(
  graph: GraphInstance,
  indexes: GraphIndexes | undefined,
  config: GraphConfig,
  relation: RelationPattern,
  warnedNoEdgeTypes: boolean,
  onWarning?: (message: string) => void,
): (nodeId: string, cb: (neighborId: string, edgeId: string) => void) => void {
  const edgeType = relation.type;
  const hasIndex = indexes !== undefined && edgeType !== undefined;

  if (edgeType && indexes && !warnedNoEdgeTypes) {
    const allKeys = [...indexes.edgeTypeIndex.out.keys()];
    if (allKeys.length > 0 && allKeys.every((k) => k === '__UNTYPED__')) {
      const warn = onWarning ?? console.warn;
      warn(`No edges have a "${config.edgeTypeProperty}" property. Relationship-type matching (e.g. -[:TYPE]->) will not use the adjacency index and will scan all edges instead.`);
    }
  }

  if (hasIndex && edgeType && relation.direction === 'OUT') {
    const adj = indexes.edgeTypeIndex.out.get(edgeType);
    return (nodeId, cb) => { const neighbors = adj?.get(nodeId); if (!neighbors) return; for (const n of neighbors) cb(n.target, n.edgeId); };
  }
  if (hasIndex && edgeType && relation.direction === 'IN') {
    const adj = indexes.edgeTypeIndex.in.get(edgeType);
    return (nodeId, cb) => { const neighbors = adj?.get(nodeId); if (!neighbors) return; for (const n of neighbors) cb(n.source, n.edgeId); };
  }
  if (hasIndex && edgeType && relation.direction === 'UNDIRECTED') {
    const adjOut = indexes.edgeTypeIndex.out.get(edgeType);
    const adjIn = indexes.edgeTypeIndex.in.get(edgeType);
    return (nodeId, cb) => {
      const seen = new Set<string>();
      const outNeighbors = adjOut?.get(nodeId);
      if (outNeighbors) for (const n of outNeighbors) { if (!seen.has(n.edgeId)) { seen.add(n.edgeId); cb(n.target, n.edgeId); } }
      const inNeighbors = adjIn?.get(nodeId);
      if (inNeighbors) for (const n of inNeighbors) { if (!seen.has(n.edgeId)) { seen.add(n.edgeId); cb(n.source, n.edgeId); } }
    };
  }

  return (nodeId, cb) => {
    const iterator = (id: string, edgeCb: (e: string, a: Record<string, unknown>, s: string, t: string) => void) => {
      if (relation.direction === 'OUT') graph.forEachOutboundEdge(id, edgeCb);
      else if (relation.direction === 'IN') graph.forEachInboundEdge(id, edgeCb);
      else graph.forEachEdge(id, edgeCb);
    };
    iterator(nodeId, (edgeId, edgeAttr, source, target) => {
      if (relation.type && edgeAttr[config.edgeTypeProperty] !== relation.type) return;
      const neighborId = nodeId === source ? target : source;
      cb(neighborId, edgeId);
    });
  };
}

export function matchNodeCriteria(nodeAttr: Record<string, unknown>, config: GraphConfig, pattern: NodePattern): boolean {
  if (pattern.labels) {
    const nodeLabels = getNodeLabels(nodeAttr, config);
    const { labels, orLabels, notLabels, orNotLabels } = pattern.labels;
    const hasAndLabels = labels.length > 0;
    const hasOrLabels = orLabels.length > 0;
    let andMatch = true;
    let orMatch = false;
    if (hasAndLabels) {
      andMatch = labels.every((l) => nodeLabels.has(l));
      if (andMatch && notLabels.length > 0) andMatch = !notLabels.some((l) => nodeLabels.has(l));
    } else if (notLabels.length > 0) { andMatch = !notLabels.some((l) => nodeLabels.has(l)); }
    if (hasOrLabels) { orMatch = orLabels.some((l) => nodeLabels.has(l)); }
    if (orNotLabels.length > 0) { orMatch = orMatch || !orNotLabels.some((l) => nodeLabels.has(l)); }
    if (!andMatch && !orMatch) return false;
  }
  const props = pattern.properties;
  if (props) return Object.keys(props).every((k) => deepEquals(nodeAttr[k], props[k]));
  return true;
}

export function getNodeLabels(nodeAttr: Record<string, unknown>, config: GraphConfig): Set<string> {
  const raw = nodeAttr[config.labelProperty];
  if (typeof raw === 'string') return new Set([raw]);
  if (Array.isArray(raw)) return new Set(raw.filter((l): l is string => typeof l === 'string'));
  return new Set();
}

export function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) return false; return a.every((v, i) => deepEquals(v, b[i])); }
  return false;
}
