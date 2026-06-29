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
  MatchHop,
  RelationPattern,
  NodePattern,
} from '../types/cypher';
import { DEFAULT_MAX_VAR_LENGTH_DEPTH, DEFAULT_MAX_VAR_LENGTH_PATHS } from '../types/cypher';
import { isContextChain, materialiseChain, resolveChainValue, type ContextChain, CHAIN_BASE, CHAIN_OVERRIDES } from './context-chain';

/**
 * Bind a relationship variable according to Neo4j semantics:
 * - Single-hop (non-variable-length): store a single CypherEdge
 * - Variable-length: store an array of CypherEdge[]
 */
function bindRelationshipVariable(edges: CypherEdge[], relation: RelationPattern): CypherValue {
  if (relation.variableLength) return edges as unknown as CypherValue;
  return edges[0] ?? null;
}

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
 * Result of executing a single hop: list of context overrides + accumulated edges.
 */
interface HopResult {
  overrides: QueryContext;
  edges: CypherEdge[];
  sourceNode: CypherNode;
  targetNode: CypherNode;
}

/**
 * Execute a single hop: traverse from given start node IDs through edges to target nodes.
 * For multi-hop: startNodeIds are the targets from the previous hop.
 */
function executeSingleHop(
  graph: GraphInstance,
  indexes: GraphIndexes | undefined,
  config: GraphConfig,
  hop: MatchHop,
  startNodeIds: string[],
  context: QueryContext,
  warnedNoLabels: boolean,
  warnedNoEdgeTypes: boolean,
  onWarning?: (message: string) => void,
  evalExpr?: (e: Expression, ctx: QueryContext) => CypherValue | undefined,
): { results: HopResult[]; warnedNoLabels: boolean; warnedNoEdgeTypes: boolean } {
  const { sourcePattern, relationPattern, targetPattern } = hop;
  let warnedNoLabelsOut = warnedNoLabels;
  let warnedNoEdgeTypesOut = warnedNoEdgeTypes;

  // No chain: just bind source node (single node pattern)
  if (!hop._hasChain) {
    const results: HopResult[] = [];
    for (const startId of startNodeIds) {
      const sourceAttr = graph.getNodeAttributes(startId);
      const sourceNode = { id: startId, ...sourceAttr } as CypherNode;
      results.push({ overrides: { [sourcePattern.variable]: sourceNode }, edges: [], sourceNode, targetNode: sourceNode });
    }
    return { results, warnedNoLabels: warnedNoLabelsOut, warnedNoEdgeTypes: warnedNoEdgeTypesOut };
  }

  // Get eligible target node IDs (for filtering during BFS)
  const targetResult = getMatchingNodeIds(graph, indexes, config, targetPattern, warnedNoLabelsOut, onWarning);
  warnedNoLabelsOut = targetResult.warned;
  const eligibleTargetIds = new Set(targetResult.ids);

  const getNeighbors = buildNeighborGetter(graph, indexes, config, relationPattern, warnedNoEdgeTypesOut, onWarning);

  const hasTargetDynamicProps = targetPattern.propertiesExpr && evalExpr;
  const results: HopResult[] = [];

  const minDepth = relationPattern.minDepth ?? 1;
  const effectiveMaxDepth = config.maxVariableLengthDepth ?? DEFAULT_MAX_VAR_LENGTH_DEPTH;
  const maxDepth = relationPattern.maxDepth ?? (relationPattern.variableLength ? effectiveMaxDepth : minDepth);

  // Warn on unbounded variable-length patterns (no explicit maxDepth in query)
  if (relationPattern.variableLength && relationPattern.maxDepth === undefined) {
    const warn = onWarning ?? console.warn;
    warn(`gcyphrq: Unbounded variable-length pattern [*${minDepth}..] detected. Using max depth of ${effectiveMaxDepth}. Add an explicit upper bound (e.g. [*${minDepth}..20]) or increase the limit via config to avoid missing results.`);
  }

  // Safety cap: abort if too many paths are emitted (prevents OOM on dense graphs)
  const maxPaths = config.maxVariableLengthPaths ?? DEFAULT_MAX_VAR_LENGTH_PATHS;

  for (const startId of startNodeIds) {
    const sourceAttr = graph.getNodeAttributes(startId);
    const sourceNode = { id: startId, ...sourceAttr } as CypherNode;

    const onStack = new Set<string>();
    type EdgeStep = { edgeId: string; source: string; target: string };
    const edgeHistory: EdgeStep[] = [];
    let limitReached = false;

    const emitResult = (edges: CypherEdge[], targetNode: CypherNode) => {
      const overrides: QueryContext = { [sourcePattern.variable]: sourceNode, [targetPattern.variable]: targetNode };
      if (relationPattern.variable) overrides[relationPattern.variable] = bindRelationshipVariable(edges, relationPattern);
      results.push({ overrides, edges, sourceNode, targetNode });
      if (results.length >= maxPaths) {
        const warn = onWarning ?? console.warn;
        warn(`gcyphrq: Variable-length traversal exceeded ${maxPaths} paths limit. Results may be incomplete. Add more constraints (label, WHERE, upper bound) or use shortestPath() instead.`);
        limitReached = true;
      }
    };

    const explore = (currentId: string) => {
      if (limitReached || onStack.has(currentId)) return;
      onStack.add(currentId);

      if (edgeHistory.length >= minDepth && eligibleTargetIds.has(currentId)) {
        const targetAttr = graph.getNodeAttributes(currentId);
        if (hasTargetDynamicProps && !matchDynamicProperties(targetPattern.propertiesExpr!, targetAttr, context, evalExpr!)) {
          // Not a valid target via dynamic props — still explore neighbors below
        } else {
          const targetNode = { id: currentId, ...targetAttr } as CypherNode;
          const edges = edgeHistory.map(({ edgeId, source, target }) => ({ id: edgeId, source, target, ...graph.getEdgeAttributes(edgeId) } as CypherEdge));
          emitResult(edges, targetNode);
        }
      }

      if (limitReached || edgeHistory.length >= maxDepth) { onStack.delete(currentId); return; }

      getNeighbors(currentId, (neighborId, edgeId) => {
        if (limitReached) return;
        if (neighborId === currentId) {
          if (edgeHistory.length + 1 >= minDepth && eligibleTargetIds.has(currentId)) {
            const targetAttr = graph.getNodeAttributes(currentId);
            if (hasTargetDynamicProps && !matchDynamicProperties(targetPattern.propertiesExpr!, targetAttr, context, evalExpr!)) return;
            const targetNode = { id: currentId, ...targetAttr } as CypherNode;
            const allSteps = [...edgeHistory, { edgeId, source: currentId, target: currentId }];
            const edges = allSteps.map(({ edgeId: eid, source, target }) => ({ id: eid, source, target, ...graph.getEdgeAttributes(eid) } as CypherEdge));
            emitResult(edges, targetNode);
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
    if (limitReached) break;
  }

  return { results, warnedNoLabels: warnedNoLabelsOut, warnedNoEdgeTypes: warnedNoEdgeTypesOut };
}

/**
 * Execute a MATCH or OPTIONAL MATCH stage (supports multi-hop patterns).
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
  const { hops, optional, pathVariable } = clause;
  const hasChains = clause.hasChains;
  const outgoingContexts: (QueryContext | ContextChain)[] = [];

  const buildPath = (source: CypherNode, edges: CypherEdge[]): CypherValue => {
    const pathNodes: CypherNode[] = [source];
    for (const step of edges) {
      const tAttr = graph.getNodeAttributes(step.target);
      pathNodes.push({ id: step.target, ...tAttr } as CypherNode);
    }
    return { nodes: pathNodes, relationships: edges } as unknown as CypherValue;
  };

  // Collect all nullable variables for OPTIONAL MATCH
  const nullVars: string[] = [];
  for (const hop of hops) {
    if (hop.sourcePattern.variable) nullVars.push(hop.sourcePattern.variable);
    if (hop.relationPattern.variable) nullVars.push(hop.relationPattern.variable);
    if (hop.targetPattern.variable) nullVars.push(hop.targetPattern.variable);
  }

  let warnedNoLabelsOut = warnedNoLabels;
  let warnedNoEdgeTypesOut = warnedNoEdgeTypes;

  for (const context of incomingContexts) {
    const flatContext = isContextChain(context) ? materialiseChain(context) : context;

    // Resolve start node IDs for the first hop
    let startNodeIds: string[] = [];
    const firstHop = hops[0]!;
    const boundNode = resolveChainValue(context, firstHop.sourcePattern.variable);
    if (boundNode && typeof boundNode === 'object' && !Array.isArray(boundNode) && 'id' in boundNode) {
      const boundId = (boundNode as CypherNode).id;
      if (graph.hasNode(boundId)) {
        const freshAttrs = graph.getNodeAttributes(boundId);
        if (matchNodeCriteria(freshAttrs, config, firstHop.sourcePattern)) {
          if (!firstHop.sourcePattern.propertiesExpr || matchDynamicProperties(firstHop.sourcePattern.propertiesExpr, freshAttrs, flatContext, evalExpr!)) {
            startNodeIds = [boundId];
          }
        }
      }
    } else {
      const result = getMatchingNodeIds(graph, indexes, config, firstHop.sourcePattern, warnedNoLabelsOut, onWarning);
      startNodeIds = result.ids;
      warnedNoLabelsOut = result.warned;
      if (firstHop.sourcePattern.propertiesExpr && evalExpr) {
        startNodeIds = startNodeIds.filter((id) => matchDynamicProperties(firstHop.sourcePattern.propertiesExpr!, graph.getNodeAttributes(id), flatContext, evalExpr));
      }
    }

    // Chain hops: each hop produces results that seed the next hop
    interface ChainState {
      overrides: QueryContext;
      allEdges: CypherEdge[];
      firstSourceNode: CypherNode;
      lastTargetId: string;
    }
    let chainStates: ChainState[] = [];

    for (let hopIdx = 0; hopIdx < hops.length; hopIdx++) {
      const hop = hops[hopIdx]!;
      const isChain = hopIdx === 0 ? hasChains : true;

      const nextStates: ChainState[] = [];

      // Collect start node IDs for this hop
      let hopStartIds: string[] = [];
      if (hopIdx === 0) {
        hopStartIds = startNodeIds;
      } else {
        // Use lastTargetId from each chain state for start nodes.
        // This works for both bound and unbound intermediate nodes.
        const seen = new Set<string>();
        for (const state of chainStates) {
          seen.add(state.lastTargetId);
        }
        hopStartIds = [...seen];
      }

      // Execute this hop
      const { results, warnedNoLabels, warnedNoEdgeTypes } = executeSingleHop(
        graph, indexes, config, { ...hop, _hasChain: isChain }, hopStartIds, flatContext,
        warnedNoLabelsOut, warnedNoEdgeTypesOut, onWarning, evalExpr,
      );
      warnedNoLabelsOut = warnedNoLabels;
      warnedNoEdgeTypesOut = warnedNoEdgeTypes;

      if (hopIdx === 0) {
        // First hop: create initial chain states
        for (const result of results) {
          nextStates.push({
            overrides: { ...result.overrides },
            allEdges: [...result.edges],
            firstSourceNode: result.sourceNode,
            lastTargetId: result.targetNode.id,
          });
        }
      } else {
        // Subsequent hops: merge with previous chain states
        // Pre-group results by source node ID for O(1) lookup
        const resultsBySource = new Map<string, HopResult[]>();
        for (const result of results) {
          const key = result.sourceNode.id;
          const group = resultsBySource.get(key);
          if (group) group.push(result);
          else resultsBySource.set(key, [result]);
        }

        for (const state of chainStates) {
          // Use the tracked lastTargetId from this chain state
          const prevTargetId = state.lastTargetId;

          const matchingResults = resultsBySource.get(prevTargetId) || [];

          for (const result of matchingResults) {
            const mergedOverrides: QueryContext = { ...state.overrides, ...result.overrides };
            nextStates.push({
              overrides: mergedOverrides,
              allEdges: [...state.allEdges, ...result.edges],
              firstSourceNode: state.firstSourceNode,
              lastTargetId: result.targetNode.id,
            });
          }
        }
      }

      if (nextStates.length === 0) break;
      chainStates = nextStates;
    }

    if (chainStates.length > 0) {
      for (const state of chainStates) {
        const overrides = { ...state.overrides };
        if (pathVariable && state.firstSourceNode) {
          overrides[pathVariable] = buildPath(state.firstSourceNode, state.allEdges);
        }
        outgoingContexts.push({ [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: overrides });
      }
    } else if (optional) {
      // OPTIONAL MATCH — emit null row
      const nullOverrides: QueryContext = {};
      for (const v of nullVars) {
        const relHop = hops.find((h) => h.relationPattern.variable === v);
        if (relHop) nullOverrides[v] = relHop.relationPattern.variableLength ? [] : null;
        else nullOverrides[v] = null;
      }
      if (pathVariable) nullOverrides[pathVariable] = null;
      outgoingContexts.push({ [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: nullOverrides });
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
          const nullOverrides: QueryContext = {};
          for (const v of nullVars) {
            const relHop = hops.find((h) => h.relationPattern.variable === v);
            if (relHop) nullOverrides[v] = relHop.relationPattern.variableLength ? [] : null;
            else nullOverrides[v] = null;
          }
          if (pathVariable) nullOverrides[pathVariable] = null;
          filtered.push({ [CHAIN_BASE]: context, [CHAIN_OVERRIDES]: nullOverrides });
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
