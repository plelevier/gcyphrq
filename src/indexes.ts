import type { GraphIndexes } from './types/cypher';
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
): GraphIndexes {
  const labelIndex = new Map<string, Set<string>>();
  const propertyIndex = new Map<string, Map<string, Set<string>>>();
  const edgeOut = new Map<string, Map<string, Array<{ target: string; edgeId: string }>>>();
  const edgeIn = new Map<string, Map<string, Array<{ source: string; edgeId: string }>>>();

  // Build label and property indexes
  for (const [id, attrs] of nodeIterator) {
    const label = attrs.label;

    if (label && typeof label === 'string') {
      let labelSet = labelIndex.get(label);
      if (!labelSet) {
        labelSet = new Set();
        labelIndex.set(label, labelSet);
      }
      labelSet.add(id);
    }

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

  // Build edge type adjacency index
  graph.forEachEdge((edgeId, attrs, source, target) => {
    const edgeType = (attrs.type && typeof attrs.type === 'string') ? attrs.type : '__UNTYPED__';

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
  });

  return {
    labelIndex,
    propertyIndex,
    edgeTypeIndex: { out: edgeOut, in: edgeIn },
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
export function buildGraphIndexesFromGraph(graph: GraphInstance): GraphIndexes {
  const allNodes = graph.filterNodes(() => true);
  const nodeEntries: [string, Record<string, unknown>][] = allNodes.map((id) => [id, graph.getNodeAttributes(id)]);
  return buildIndexes(nodeEntries, graph);
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
export function buildGraphIndexesFromData(data: NormalizedGraphFile, graph: GraphInstance): GraphIndexes {
  const nodeEntries: [string, Record<string, unknown>][] = data.nodes.map((node) => [node.id, node]);
  return buildIndexes(nodeEntries, graph);
}
