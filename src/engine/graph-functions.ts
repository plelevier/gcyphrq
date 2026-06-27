import type { GraphInstance } from '../graph';
import type { CypherNode, CypherValue } from '../types/cypher';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract a node ID from a CypherValue (node object). */
function extractNodeId(value: CypherValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id === 'string' && obj.id) return obj.id;
  return null;
}

/** Count total edges in the graph. */
function countEdges(graph: GraphInstance): number {
  let count = 0;
  graph.forEachEdge(() => { count++; });
  return count;
}

/**
 * Iterate over neighbors of a node, treating all edges as bidirectional.
 * Used by betweenness centrality which operates on the underlying undirected structure.
 */
function forEachNeighbor(
  graph: GraphInstance,
  nodeId: string,
  cb: (neighborId: string) => void,
): void {
  graph.forEachOutboundEdge(nodeId, (_e, _a, _s, t) => {
    cb(t!);
  });
  graph.forEachInboundEdge(nodeId, (_e, _a, s, _t) => {
    cb(s!);
  });
}

// ── Graph Statistics Functions ───────────────────────────────────────────────

/**
 * `numNodes()` — Returns the total number of nodes in the graph.
 */
export function numNodes(graph: GraphInstance): number {
  return graph.order;
}

/**
 * `numRelationships()` — Returns the total number of edges (relationships) in the graph.
 */
export function numRelationships(graph: GraphInstance): number {
  return countEdges(graph);
}

/**
 * `density()` — Returns the graph density as a ratio between 0 and 1.
 *
 * For directed graphs:  E / (V * (V - 1))
 * For undirected graphs: E / (V * (V - 1) / 2) = 2E / (V * (V - 1))
 * For mixed graphs: treated as directed.
 *
 * Returns 0 for graphs with 0 or 1 nodes.
 */
export function density(graph: GraphInstance): number {
  const v = graph.order;
  if (v <= 1) return 0;

  const e = countEdges(graph);
  const isUndirected = graph.type === 'undirected';

  if (isUndirected) {
    return e / (v * (v - 1) / 2);
  }
  // Directed or mixed
  return e / (v * (v - 1));
}

/**
 * `averageDegree()` — Returns the average degree of all nodes.
 *
 * Degree is the number of incident edges (inbound + outbound for directed,
 * just incident for undirected). For mixed graphs, undirected edges count
 * once per incident node and directed edges count for both source and target.
 *
 * Returns 0 for graphs with 0 nodes.
 */
export function averageDegree(graph: GraphInstance): number {
  const v = graph.order;
  if (v === 0) return 0;

  const isUndirected = graph.type === 'undirected';
  const isMixed = graph.type === 'mixed';
  const degrees = new Map<string, number>();

  // Initialize all nodes with degree 0
  graph.filterNodes(() => true).forEach((id) => {
    degrees.set(id, 0);
  });

  // Count degrees from edges
  graph.forEachEdge((_edgeId, attrs, source, target) => {
    const s = source as string;
    const t = target as string;
    const isUndirectedEdge = isUndirected || (isMixed && attrs.undirected === true);

    if (isUndirectedEdge) {
      // Undirected edge: adds 1 to degree of each endpoint
      degrees.set(s, (degrees.get(s) ?? 0) + 1);
      if (s !== t) {
        degrees.set(t, (degrees.get(t) ?? 0) + 1);
      }
    } else {
      // Directed edge: outbound adds to source, inbound adds to target
      degrees.set(s, (degrees.get(s) ?? 0) + 1);
      degrees.set(t, (degrees.get(t) ?? 0) + 1);
    }
  });

  let totalDegree = 0;
  for (const [, deg] of degrees) {
    totalDegree += deg;
  }

  return totalDegree / v;
}

/**
 * `diameter()` — Returns the diameter of the graph (longest shortest path).
 *
 * Uses BFS from every node to find all-pairs shortest paths, then returns
 * the maximum distance. For disconnected graphs, returns -1.
 * All edges are treated as bidirectional (standard for graph analytics).
 *
 * Returns 0 for graphs with 0 or 1 nodes.
 */
export function diameter(graph: GraphInstance): number {
  const v = graph.order;
  if (v <= 1) return 0;

  const nodeIds = graph.filterNodes(() => true);
  let maxDist = 0;

  for (const sourceId of nodeIds) {
    const dist = new Map<string, number>();
    dist.set(sourceId, 0);
    const queue: string[] = [sourceId];
    let head = 0;

    while (head < queue.length) {
      const current = queue[head++]!;
      const currentDist = dist.get(current)!;

      // Treat all edges as bidirectional for diameter
      graph.forEachOutboundEdge(current, (_e, _a, _s, t) => {
        const tid = t!;
        if (!dist.has(tid)) {
          dist.set(tid, currentDist + 1);
          queue.push(tid);
        }
      });
      graph.forEachInboundEdge(current, (_e, _a, s, _t) => {
        const sid = s!;
        if (!dist.has(sid)) {
          dist.set(sid, currentDist + 1);
          queue.push(sid);
        }
      });
    }

    // If not all nodes are reachable, graph is disconnected
    if (dist.size < v) return -1;

    // Find max distance from this source
    for (const [, d] of dist) {
      if (d > maxDist) maxDist = d;
    }
  }

  return maxDist;
}

// ── Centrality Functions ─────────────────────────────────────────────────────

/**
 * `pagerank()` — Computes PageRank centrality for all nodes.
 *
 * Uses the power iteration method with damping factor 0.85.
 * Returns a map `{ nodeId: score }` when called without arguments.
 * When called with a node argument, returns the PageRank score for that node.
 */
export function pagerank(graph: GraphInstance, nodeArg?: CypherValue): CypherValue {
  const v = graph.order;
  if (v === 0) return nodeArg !== undefined ? null : {};

  const nodeIds = graph.filterNodes(() => true);
  const damping = 0.85;
  const tolerance = 1e-6;
  const maxIterations = 100;

  // Build adjacency list (outbound for directed, both directions for undirected/mixed)
  const outEdges = new Map<string, string[]>();
  for (const id of nodeIds) {
    outEdges.set(id, []);
  }

  graph.forEachEdge((_edgeId, attrs, source, target) => {
    const s = source as string;
    const t = target as string;
    const isUndirected = graph.type === 'undirected' || (graph.type === 'mixed' && attrs.undirected === true);

    // Always add source -> target
    outEdges.get(s)!.push(t);

    // For undirected edges, also add target -> source
    if (isUndirected && s !== t) {
      outEdges.get(t)!.push(s);
    }
  });

  // Initialize PageRank scores uniformly
  const rank = new Map<string, number>();
  const initialRank = 1 / v;
  for (const id of nodeIds) {
    rank.set(id, initialRank);
  }

  // Power iteration
  for (let iter = 0; iter < maxIterations; iter++) {
    const newRank = new Map<string, number>();
    let danglingSum = 0;

    // Sum ranks of dangling nodes (nodes with no outbound edges)
    for (const id of nodeIds) {
      if (outEdges.get(id)!.length === 0) {
        danglingSum += rank.get(id)!;
      }
    }

    for (const id of nodeIds) {
      let sum = 0;
      // Sum contributions from nodes that link to this node
      for (const otherId of nodeIds) {
        const neighbors = outEdges.get(otherId)!;
        const outDegree = neighbors.length;
        if (outDegree > 0 && neighbors.includes(id)) {
          sum += rank.get(otherId)! / outDegree;
        }
      }
      newRank.set(id, (1 - damping) / v + damping * (sum + danglingSum / v));
    }

    // Check convergence
    let diff = 0;
    for (const id of nodeIds) {
      diff += Math.abs(newRank.get(id)! - rank.get(id)!);
    }
    rank.clear();
    for (const [id, r] of newRank) {
      rank.set(id, r);
    }
    if (diff < tolerance) break;
  }

  // If a specific node was requested, return its score
  if (nodeArg !== undefined) {
    const nodeId = extractNodeId(nodeArg);
    if (!nodeId) return null;
    return rank.get(nodeId) ?? null;
  }

  // Return full map
  const result: Record<string, number> = {};
  for (const [id, r] of rank) {
    result[id] = r;
  }
  return result as CypherValue;
}

/**
 * `degreeCentrality()` — Computes degree centrality for all nodes.
 *
 * Degree centrality is the fraction of nodes a given node is connected to.
 * For directed graphs, uses total degree (in + out). For undirected graphs,
 * uses the number of neighbors.
 *
 * Returns a map `{ nodeId: score }` when called without arguments.
 * When called with a node argument, returns the degree centrality for that node.
 */
export function degreeCentrality(graph: GraphInstance, nodeArg?: CypherValue): CypherValue {
  const v = graph.order;
  if (v === 0) return nodeArg !== undefined ? null : {};

  const nodeIds = graph.filterNodes(() => true);
  const maxDegree = v - 1; // Maximum possible degree
  if (maxDegree === 0) {
    // Single node graph: centrality is 0
    const result: Record<string, number> = {};
    for (const id of nodeIds) {
      result[id] = 0;
    }
    if (nodeArg !== undefined) {
      const nodeId = extractNodeId(nodeArg);
      if (!nodeId) return null;
      return 0;
    }
    return result as CypherValue;
  }

  // Compute degree for each node using sets of unique neighbors
  const neighbors = new Map<string, Set<string>>();
  for (const id of nodeIds) {
    neighbors.set(id, new Set());
  }

  graph.forEachEdge((_edgeId, attrs, source, target) => {
    const s = source as string;
    const t = target as string;
    const isUndirected = graph.type === 'undirected' || (graph.type === 'mixed' && attrs.undirected === true);

    // Source has target as neighbor (outbound)
    neighbors.get(s)!.add(t);

    if (isUndirected && s !== t) {
      // Undirected: target also has source as neighbor
      neighbors.get(t)!.add(s);
    } else if (!isUndirected) {
      // Directed: target has source as neighbor (inbound)
      neighbors.get(t)!.add(s);
    }
  });

  const result: Record<string, number> = {};
  for (const id of nodeIds) {
    const degree = neighbors.get(id)!.size;
    result[id] = degree / maxDegree;
  }

  if (nodeArg !== undefined) {
    const nodeId = extractNodeId(nodeArg);
    if (!nodeId) return null;
    return result[nodeId] ?? null;
  }

  return result as CypherValue;
}

/**
 * `betweennessCentrality()` — Computes betweenness centrality for all nodes.
 *
 * Uses Brandes' algorithm. Betweenness centrality measures how often a node
 * appears on shortest paths between other nodes. All edges are treated as
 * bidirectional (standard for graph analytics).
 *
 * Returns a map `{ nodeId: score }` when called without arguments.
 * When called with a node argument, returns the betweenness centrality for that node.
 */
export function betweennessCentrality(graph: GraphInstance, nodeArg?: CypherValue): CypherValue {
  const v = graph.order;
  if (v === 0) return nodeArg !== undefined ? null : {};

  const nodeIds = graph.filterNodes(() => true);
  const centrality = new Map<string, number>();
  for (const id of nodeIds) {
    centrality.set(id, 0);
  }

  if (v <= 2) {
    // For 0-2 nodes, all betweenness values are 0
    const result: Record<string, number> = {};
    for (const id of nodeIds) {
      result[id] = 0;
    }
    if (nodeArg !== undefined) {
      const nodeId = extractNodeId(nodeArg);
      if (!nodeId) return null;
      return 0;
    }
    return result as CypherValue;
  }

  // Brandes' algorithm (treats all edges as bidirectional)
  for (const source of nodeIds) {
    // Single-source shortest paths
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>(); // Number of shortest paths
    const dist = new Map<string, number>();

    for (const n of nodeIds) {
      dist.set(n, -1);
      sigma.set(n, 0);
      pred.set(n, []);
    }
    dist.set(source, 0);
    sigma.set(source, 1);

    const queue: string[] = [source];
    let head = 0;

    while (head < queue.length) {
      const currentNode = queue[head++]!;
      stack.push(currentNode);

      forEachNeighbor(graph, currentNode, (w) => {
        // Path discovery
        if (dist.get(w) === -1) {
          dist.set(w, dist.get(currentNode)! + 1);
          queue.push(w);
        }

        // Path counting
        if (dist.get(w) === dist.get(currentNode)! + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(currentNode) ?? 0));
          pred.get(w)!.push(currentNode);
        }
      });
    }

    // Accumulation
    const delta = new Map<string, number>();
    for (const n of nodeIds) {
      delta.set(n, 0);
    }

    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const p of pred.get(w)!) {
        delta.set(p, (delta.get(p) ?? 0) + (sigma.get(p) ?? 0) / (sigma.get(w) ?? 1) * (1 + delta.get(w)!));
      }
      if (w !== source) {
        centrality.set(w, (centrality.get(w) ?? 0) + delta.get(w)!);
      }
    }
  }

  // Normalize: for undirected treatment, each pair counted twice
  for (const id of nodeIds) {
    centrality.set(id, (centrality.get(id) ?? 0) / 2);
  }

  const result: Record<string, number> = {};
  for (const id of nodeIds) {
    result[id] = centrality.get(id) ?? 0;
  }

  if (nodeArg !== undefined) {
    const nodeId = extractNodeId(nodeArg);
    if (!nodeId) return null;
    return result[nodeId] ?? null;
  }

  return result as CypherValue;
}
