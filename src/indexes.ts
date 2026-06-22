import type { GraphIndexes, GraphConfig } from './types/cypher';
import type { GraphInstance } from './graph';
import type { NormalizedGraphFile } from './lib';

// ── Index construction ───────────────────────────────────────────────────────

/**
 * Build pre-computed indexes from an iterable of node entries and a graph.
 *
 * Shared implementation used by both `buildGraphIndexesFromGraph` and
 * `buildGraphIndexesFromData`. Avoids duplicating the label, property,
 * and edge-type index logic.
 *
 * Note: property values are coerced to strings via `String(value)`, so
 * `true`/`false` become `"true"`/`"false"` and `0` becomes `"0"`.
 */
function buildIndexes(
  nodeIterator: Iterable<[string, Record<string, unknown>]>,
  graph: GraphInstance,
  config: GraphConfig,
  onWarning?: (message: string) => void,
): GraphIndexes {
  const labelIndex = new Map<string, Set<string>>();
  const propertyIndex = new Map<string, Map<string, Set<string>>>();
  const edgeOut = new Map<string, Map<string, Array<{ target: string; edgeId: string }>>>();
  const edgeIn = new Map<string, Map<string, Array<{ source: string; edgeId: string }>>>();
  let hasLabelProperty = false;
  let hasEdgeTypeProperty = false;
  let edgeCount = 0;

  // Build label and property indexes
  for (const [id, attrs] of nodeIterator) {
    const label = attrs[config.labelProperty];

    if (label && typeof label === 'string') {
      hasLabelProperty = true;
      let labelSet = labelIndex.get(label);
      if (!labelSet) {
        labelSet = new Set();
        labelIndex.set(label, labelSet);
      }
      labelSet.add(id);
    }

    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'id' || key === config.labelProperty) continue;
      if (value === null || value === undefined || typeof value === 'object') continue;
      let valMap = propertyIndex.get(key);
      if (!valMap) {
        valMap = new Map();
        propertyIndex.set(key, valMap);
      }
      const valKey = String(value);
      let nodeSet = valMap.get(valKey);
      if (!nodeSet) {
        nodeSet = new Set();
        valMap.set(valKey, nodeSet);
      }
      nodeSet.add(id);
    }
  }

  // Build edge type adjacency index
  const isUndirectedGraph = graph.type === 'undirected';
  const edgeTypeKey = config.edgeTypeProperty;
  graph.forEachEdge((edgeId, attrs, source, target) => {
    edgeCount++;
    const rawType = attrs[edgeTypeKey];
    if (rawType && typeof rawType === 'string') hasEdgeTypeProperty = true;
    const edgeType = (rawType && typeof rawType === 'string') ? rawType : '__UNTYPED__';
    const isUndirectedEdge = isUndirectedGraph || attrs.undirected === true;

    // Canonical direction: source → target
    let outMap = edgeOut.get(edgeType);
    if (!outMap) {
      outMap = new Map();
      edgeOut.set(edgeType, outMap);
    }
    let outList = outMap.get(source);
    if (!outList) {
      outList = [];
      outMap.set(source, outList);
    }
    outList.push({ target, edgeId });

    let inMap = edgeIn.get(edgeType);
    if (!inMap) {
      inMap = new Map();
      edgeIn.set(edgeType, inMap);
    }
    let inList = inMap.get(target);
    if (!inList) {
      inList = [];
      inMap.set(target, inList);
    }
    inList.push({ source, edgeId });

    // For undirected edges (undirected graphs or undirected edges in mixed graphs),
    // also add the reverse direction so traversal works from both sides.
    // Skip self-loops (source === target) as they're already in both directions.
    if (isUndirectedEdge && source !== target) {
      let revOutMap = edgeOut.get(edgeType);
      if (!revOutMap) {
        revOutMap = new Map();
        edgeOut.set(edgeType, revOutMap);
      }
      let revOutList = revOutMap.get(target);
      if (!revOutList) {
        revOutList = [];
        revOutMap.set(target, revOutList);
      }
      revOutList.push({ target: source, edgeId });

      let revInMap = edgeIn.get(edgeType);
      if (!revInMap) {
        revInMap = new Map();
        edgeIn.set(edgeType, revInMap);
      }
      let revInList = revInMap.get(source);
      if (!revInList) {
        revInList = [];
        revInMap.set(source, revInList);
      }
      revInList.push({ source: target, edgeId });
    }
  });

  // Warn if configured property names don't exist in the graph
  // Always emit via onWarning or console.warn as a last resort
  const warn = onWarning ?? ((msg: string) => console.warn(msg));
  if (!hasLabelProperty) {
    warn(`No nodes have a "${config.labelProperty}" property. Label-based matching (e.g. MATCH (n:Label)) will return no results.`);
  }
  if (edgeCount > 0 && !hasEdgeTypeProperty) {
    warn(`No edges have a "${config.edgeTypeProperty}" property. Relationship-type matching (e.g. -[:TYPE]->) will not use the adjacency index and will scan all edges instead.`);
  }

  return {
    labelIndex,
    propertyIndex,
    edgeTypeIndex: { out: edgeOut, in: edgeIn },
    config,
  };
}

/**
 * Build pre-computed indexes directly from a Graphology graph instance.
 *
 * Iterates nodes and edges on the graph to build label, property, and
 * edge-type adjacency indexes. No original graph data is required.
 *
 * This is the preferred path when you already have a Graphology `Graph`
 * (e.g. built externally or programmatically) and want to use it with
 * `GraphEngine` for optimal query performance.
 *
 * Note: property values are coerced to strings via `String(value)`, so
 * `true`/`false` become `"true"`/`"false"` and `0` becomes `"0"`.
 *
 * @param graph - Any Graphology graph instance (must satisfy `GraphInstance`)
 * @returns Indexes for use with `GraphEngine`
 */
export function buildGraphIndexesFromGraph(
  graph: GraphInstance,
  config: GraphConfig,
  onWarning?: (message: string) => void,
): GraphIndexes {
  const allNodes = graph.filterNodes(() => true);
  const nodeEntries: [string, Record<string, unknown>][] = allNodes.map((id) => [id, graph.getNodeAttributes(id)]);
  return buildIndexes(nodeEntries, graph, config, onWarning);
}

/**
 * Build pre-computed indexes from validated graph data and a constructed graph.
 *
 * Indexes enable O(1) label/property lookups and typed adjacency traversal,
 * avoiding full-graph scans during query execution.
 *
 * The graph instance is required to get real Graphology edge IDs for the
 * edge-type adjacency index.
 *
 * Note: property values are coerced to strings via `String(value)`, so
 * `true`/`false` become `"true"`/`"false"` and `0` becomes `"0"`.
 *
 * @param data - Validated graph data (nodes + edges)
 * @param graph - Constructed Graphology graph (provides real edge IDs)
 * @returns Indexes for use with `GraphEngine`
 */
export function buildGraphIndexesFromData(
  data: NormalizedGraphFile,
  graph: GraphInstance,
  config: GraphConfig,
  onWarning?: (message: string) => void,
): GraphIndexes {
  const nodeEntries: [string, Record<string, unknown>][] = data.nodes.map((node) => [node.id, node]);
  return buildIndexes(nodeEntries, graph, config, onWarning);
}
