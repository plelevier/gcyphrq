import type { GraphFile } from './lib';
import type { GraphIndexes } from './types/cypher';
import type { GraphInstance } from './graph';

// ── Index construction ───────────────────────────────────────────────────────

/**
 * Build pre-computed indexes directly from a Graphology graph instance.
 *
 * Iterates nodes and edges on the graph to build label, property, and
 * edge-type adjacency indexes. No original `GraphFile` data is required.
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
export function buildGraphIndexesFromGraph(graph: GraphInstance): GraphIndexes {
  const labelIndex = new Map<string, Set<string>>();
  const propertyIndex = new Map<string, Map<string, Set<string>>>();
  const edgeOut = new Map<string, Map<string, Array<{ target: string; edgeId: string }>>>();
  const edgeIn = new Map<string, Map<string, Array<{ source: string; edgeId: string }>>>();

  // Build label and property indexes by iterating nodes
  const allNodes = graph.filterNodes(() => true);
  for (const id of allNodes) {
    const attrs = graph.getNodeAttributes(id);
    const label = attrs.label;

    // Label index
    if (label && typeof label === 'string') {
      let labelSet = labelIndex.get(label);
      if (!labelSet) {
        labelSet = new Set();
        labelIndex.set(label, labelSet);
      }
      labelSet.add(id);
    }

    // Property index (all attrs except id and label)
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'id' || key === 'label') continue;
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

  // Edge type adjacency index
  graph.forEachEdge((edgeId, attrs, source, target) => {
    const edgeType = (attrs.type && typeof attrs.type === 'string') ? attrs.type : '__UNTYPED__';

    // Outgoing: source → [target]
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

    // Incoming: target → [source]
    let inMap = edgeIn.get(edgeType);
    if (!inMap) {
      inMap = new Map();
      edgeIn.set(edgeType, inMap);
    }
    let inList = inMap.get(target);
    if (!inList) {
      inList = [];
      edgeIn.set(target, inList);
    }
    inList.push({ source, edgeId });
  });

  return {
    labelIndex,
    propertyIndex,
    edgeTypeIndex: { out: edgeOut, in: edgeIn },
  };
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
export function buildGraphIndexesFromData(data: GraphFile, graph: GraphInstance): GraphIndexes {
  const labelIndex = new Map<string, Set<string>>();
  const propertyIndex = new Map<string, Map<string, Set<string>>>();
  const edgeOut = new Map<string, Map<string, Array<{ target: string; edgeId: string }>>>();
  const edgeIn = new Map<string, Map<string, Array<{ source: string; edgeId: string }>>>();

  for (const node of data.nodes) {
    const { id, label, ...props } = node;

    // Label index
    if (label && typeof label === 'string') {
      let labelSet = labelIndex.get(label);
      if (!labelSet) {
        labelSet = new Set();
        labelIndex.set(label, labelSet);
      }
      labelSet.add(id);
    }

    // Property index (index all non-id, non-label scalar properties)
    for (const [key, value] of Object.entries(props)) {
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

  // Edge type adjacency index — iterate the graph to get real Graphology edge IDs
  graph.forEachEdge((edgeId, attrs, source, target) => {
    const edgeType = (attrs.type && typeof attrs.type === 'string') ? attrs.type : '__UNTYPED__';

    // Outgoing: source → [target]
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

    // Incoming: target → [source]
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
  });

  return {
    labelIndex,
    propertyIndex,
    edgeTypeIndex: { out: edgeOut, in: edgeIn },
  };
}
