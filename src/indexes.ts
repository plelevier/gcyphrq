import type { GraphFile } from './lib';
import type { GraphIndexes } from './types/cypher';
import type { GraphInstance } from './graph';

// ── Index construction ───────────────────────────────────────────────────────

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
export function buildGraphIndexes(data: GraphFile, graph: GraphInstance): GraphIndexes {
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
