import { describe, it, expect } from 'vitest';
import { Graph, AdvancedCypherGraphologyEngine } from './engine-setup';
import { parseCypher as _parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST } from '../src/types/cypher';

const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;

// ── Test graph fixtures ──────────────────────────────────────────────────────

/** Simple directed line: A -> B -> C -> D */
function createLineGraph() {
  const g = new Graph();
  g.addNode('a', { label: 'Node', name: 'A' });
  g.addNode('b', { label: 'Node', name: 'B' });
  g.addNode('c', { label: 'Node', name: 'C' });
  g.addNode('d', { label: 'Node', name: 'D' });
  g.addEdge('a', 'b', { type: 'LINK' });
  g.addEdge('b', 'c', { type: 'LINK' });
  g.addEdge('c', 'd', { type: 'LINK' });
  return g;
}

/** Star graph: center connected to 3 leaves (directed outward) */
function createStarGraph() {
  const g = new Graph();
  g.addNode('center', { label: 'Node', name: 'Center' });
  g.addNode('leaf1', { label: 'Node', name: 'Leaf1' });
  g.addNode('leaf2', { label: 'Node', name: 'Leaf2' });
  g.addNode('leaf3', { label: 'Node', name: 'Leaf3' });
  g.addEdge('center', 'leaf1', { type: 'LINK' });
  g.addEdge('center', 'leaf2', { type: 'LINK' });
  g.addEdge('center', 'leaf3', { type: 'LINK' });
  return g;
}

/** Triangle with extra node: A-B-C triangle, D isolated */
function createTriangleWithIsolated() {
  const g = new Graph();
  g.addNode('a', { label: 'Node', name: 'A' });
  g.addNode('b', { label: 'Node', name: 'B' });
  g.addNode('c', { label: 'Node', name: 'C' });
  g.addNode('d', { label: 'Node', name: 'D' });
  g.addEdge('a', 'b', { type: 'LINK' });
  g.addEdge('b', 'c', { type: 'LINK' });
  g.addEdge('c', 'a', { type: 'LINK' });
  return g;
}

/** Two disconnected components: A-B and C-D */
function createDisconnectedGraph() {
  const g = new Graph();
  g.addNode('a', { label: 'Node', name: 'A' });
  g.addNode('b', { label: 'Node', name: 'B' });
  g.addNode('c', { label: 'Node', name: 'C' });
  g.addNode('d', { label: 'Node', name: 'D' });
  g.addEdge('a', 'b', { type: 'LINK' });
  g.addEdge('c', 'd', { type: 'LINK' });
  return g;
}

function createEngine(graph: InstanceType<typeof Graph>) {
  return new AdvancedCypherGraphologyEngine(graph);
}

// ── subgraph() ───────────────────────────────────────────────────────────────

describe('subgraph()', () => {
  it('extracts induced subgraph from collect()', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n) WHERE n.name IN ["A","B","C"] WITH collect(n) AS nodes RETURN subgraph(nodes) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: Array<{ id: string; source: string; target: string }> };
    expect(sg.nodes.length).toBe(3);
    const nodeNames = sg.nodes.map((n) => n.name).sort();
    expect(nodeNames).toEqual(['A', 'B', 'C']);
    // Edges between A-B, B-C should be included (C-D excluded since D not in set)
    expect(sg.edges.length).toBe(2);
  });

  it('returns empty result for empty list', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN subgraph([]) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: unknown[]; edges: unknown[] };
    expect(sg.nodes.length).toBe(0);
    expect(sg.edges.length).toBe(0);
  });

  it('returns null for non-array input', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN subgraph("not-an-array") AS sg');
    const results = await e.execute(ast);
    expect(results[0]!.sg).toBeNull();
  });

  it('includes edges in both directions', async () => {
    const g = createTriangleWithIsolated();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n) WHERE n.name IN ["A","B","C"] WITH collect(n) AS nodes RETURN subgraph(nodes) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> };
    expect(sg.nodes.length).toBe(3);
    // A->B, B->C, C->A: 3 edges
    expect(sg.edges.length).toBe(3);
  });

  it('excludes edges to nodes not in the list', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    // Only A and D (no edge directly between them, no intermediate nodes)
    const ast = parseCypher('MATCH (n) WHERE n.name IN ["A","D"] WITH collect(n) AS nodes RETURN subgraph(nodes) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> };
    expect(sg.nodes.length).toBe(2);
    expect(sg.edges.length).toBe(0); // No direct edge between A and D
  });

  it('preserves node attributes', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "A"}) WITH collect(n) AS nodes RETURN subgraph(nodes) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string; label: string }>; edges: unknown[] };
    expect(sg.nodes.length).toBe(1);
    expect(sg.nodes[0]!.id).toBe('a');
    expect(sg.nodes[0]!.name).toBe('A');
    expect(sg.nodes[0]!.label).toBe('Node');
  });

  it('preserves edge attributes', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n) WHERE n.name IN ["A","B"] WITH collect(n) AS nodes RETURN subgraph(nodes) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: unknown[]; edges: Array<{ id: string; source: string; target: string; type: string }> };
    expect(sg.edges.length).toBe(1);
    expect(sg.edges[0]!.source).toBe('a');
    expect(sg.edges[0]!.target).toBe('b');
    expect(sg.edges[0]!.type).toBe('LINK');
  });
});

// ── egoGraph() ───────────────────────────────────────────────────────────────

describe('egoGraph()', () => {
  it('returns 1-hop ego network', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "B"}) RETURN egoGraph(n, 1) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: Array<{ source: string; target: string }> };
    // B's 1-hop neighbors (bidirectional): A (inbound), C (outbound)
    expect(sg.nodes.length).toBe(3); // B, A, C
    const nodeNames = sg.nodes.map((n) => n.name).sort();
    expect(nodeNames).toEqual(['A', 'B', 'C']);
    // Edges: A->B, B->C
    expect(sg.edges.length).toBe(2);
  });

  it('returns 2-hop ego network', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "B"}) RETURN egoGraph(n, 2) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: Array<{ source: string; target: string }> };
    // B's 2-hop neighbors: A (1-hop), C (1-hop), D (2-hop via C)
    expect(sg.nodes.length).toBe(4); // B, A, C, D
    const nodeNames = sg.nodes.map((n) => n.name).sort();
    expect(nodeNames).toEqual(['A', 'B', 'C', 'D']);
    // Edges: A->B, B->C, C->D
    expect(sg.edges.length).toBe(3);
  });

  it('returns k=0 ego network (just the node itself)', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "B"}) RETURN egoGraph(n, 0) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: unknown[] };
    expect(sg.nodes.length).toBe(1);
    expect(sg.nodes[0]!.name).toBe('B');
    expect(sg.edges.length).toBe(0);
  });

  it('defaults to k=1 when no k provided', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "B"}) RETURN egoGraph(n) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: unknown[] };
    expect(sg.nodes.length).toBe(3); // B, A, C (1-hop)
  });

  it('works on star graph center', async () => {
    const g = createStarGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "Center"}) RETURN egoGraph(n, 1) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: Array<{ source: string; target: string }> };
    // Center + 3 leaves = 4 nodes
    expect(sg.nodes.length).toBe(4);
    // 3 edges from center to leaves
    expect(sg.edges.length).toBe(3);
  });

  it('works on star graph leaf', async () => {
    const g = createStarGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "Leaf1"}) RETURN egoGraph(n, 1) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: unknown[] };
    // Leaf1 + Center = 2 nodes (leaf is 1-hop from center via inbound edge)
    expect(sg.nodes.length).toBe(2);
  });

  it('returns null for nonexistent node', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN egoGraph({id: "nonexistent"}) AS sg');
    const results = await e.execute(ast);
    expect(results[0]!.sg).toBeNull();
  });

  it('returns null for null node', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN egoGraph(null) AS sg');
    const results = await e.execute(ast);
    expect(results[0]!.sg).toBeNull();
  });

  it('returns null for negative k', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "A"}) RETURN egoGraph(n, -1) AS sg');
    const results = await e.execute(ast);
    expect(results[0]!.sg).toBeNull();
  });

  it('preserves node and edge attributes', async () => {
    const g = createStarGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "Center"}) RETURN egoGraph(n, 1) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string; label: string }>; edges: Array<{ source: string; target: string; type: string }> };
    const centerNode = sg.nodes.find((n) => n.id === 'center');
    expect(centerNode).toBeDefined();
    expect(centerNode!.name).toBe('Center');
    expect(centerNode!.label).toBe('Node');
    // All edges should have type LINK
    for (const edge of sg.edges) {
      expect(edge.type).toBe('LINK');
    }
  });
});

// ── connectedComponent() ─────────────────────────────────────────────────────

describe('connectedComponent()', () => {
  it('returns full component for connected graph', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "A"}) RETURN connectedComponent(n) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: Array<{ source: string; target: string }> };
    // All 4 nodes reachable from A
    expect(sg.nodes.length).toBe(4);
    const nodeNames = sg.nodes.map((n) => n.name).sort();
    expect(nodeNames).toEqual(['A', 'B', 'C', 'D']);
    // All 3 edges
    expect(sg.edges.length).toBe(3);
  });

  it('returns partial component for disconnected graph', async () => {
    const g = createDisconnectedGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "A"}) RETURN connectedComponent(n) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: Array<{ source: string; target: string }> };
    // Only A and B (C and D are in a separate component)
    expect(sg.nodes.length).toBe(2);
    const nodeNames = sg.nodes.map((n) => n.name).sort();
    expect(nodeNames).toEqual(['A', 'B']);
    // Only 1 edge: A->B
    expect(sg.edges.length).toBe(1);
  });

  it('returns other component for disconnected graph', async () => {
    const g = createDisconnectedGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "C"}) RETURN connectedComponent(n) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: Array<{ source: string; target: string }> };
    // Only C and D
    expect(sg.nodes.length).toBe(2);
    const nodeNames = sg.nodes.map((n) => n.name).sort();
    expect(nodeNames).toEqual(['C', 'D']);
    expect(sg.edges.length).toBe(1);
  });

  it('returns single node for isolated node', async () => {
    const g = createTriangleWithIsolated();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "D"}) RETURN connectedComponent(n) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: unknown[] };
    expect(sg.nodes.length).toBe(1);
    expect(sg.nodes[0]!.name).toBe('D');
    expect(sg.edges.length).toBe(0);
  });

  it('returns full triangle component', async () => {
    const g = createTriangleWithIsolated();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "A"}) RETURN connectedComponent(n) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string }>; edges: Array<{ source: string; target: string }> };
    expect(sg.nodes.length).toBe(3);
    const nodeNames = sg.nodes.map((n) => n.name).sort();
    expect(nodeNames).toEqual(['A', 'B', 'C']);
    expect(sg.edges.length).toBe(3);
  });

  it('returns null for nonexistent node', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN connectedComponent({id: "nonexistent"}) AS sg');
    const results = await e.execute(ast);
    expect(results[0]!.sg).toBeNull();
  });

  it('returns null for null node', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN connectedComponent(null) AS sg');
    const results = await e.execute(ast);
    expect(results[0]!.sg).toBeNull();
  });

  it('preserves node and edge attributes', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "A"}) RETURN connectedComponent(n) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string; name: string; label: string }>; edges: Array<{ source: string; target: string; type: string }> };
    const aNode = sg.nodes.find((n) => n.id === 'a');
    expect(aNode).toBeDefined();
    expect(aNode!.name).toBe('A');
    expect(aNode!.label).toBe('Node');
    for (const edge of sg.edges) {
      expect(edge.type).toBe('LINK');
    }
  });
});

// ── Integration tests ────────────────────────────────────────────────────────

describe('subgraph functions integration', () => {
  it('can use subgraph with collect in pipeline', async () => {
    const g = createStarGraph();
    const e = createEngine(g);
    const ast = parseCypher(
      'MATCH (n:Node) WITH collect(n) AS allNodes RETURN subgraph(allNodes) AS sg',
    );
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> };
    expect(sg.nodes.length).toBe(4);
    expect(sg.edges.length).toBe(3);
  });

  it('can combine egoGraph with size()', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher(
      'MATCH (n {name: "B"}) WITH egoGraph(n, 1) AS sg RETURN size(sg.nodes) AS egoSize',
    );
    const results = await e.execute(ast);
    expect(results[0]!.egoSize).toBe(3);
  });

  it('can use connectedComponent in WHERE via WITH', async () => {
    const g = createDisconnectedGraph();
    const e = createEngine(g);
    const ast = parseCypher(
      'MATCH (n) WITH n, connectedComponent(n) AS cc WHERE size(cc.nodes) = 2 RETURN n.name AS name ORDER BY name',
    );
    const results = await e.execute(ast);
    // All nodes have component size 2
    expect(results.length).toBe(4);
  });

  it('egoGraph with large k covers entire graph', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher(
      'MATCH (n {name: "A"}) RETURN egoGraph(n, 10) AS sg',
    );
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> };
    expect(sg.nodes.length).toBe(4); // Entire graph
    expect(sg.edges.length).toBe(3);
  });

  it('subgraph on undirected graph', async () => {
    const g = new Graph({ type: 'undirected' });
    g.addNode('a', { label: 'Node', name: 'A' });
    g.addNode('b', { label: 'Node', name: 'B' });
    g.addNode('c', { label: 'Node', name: 'C' });
    g.addEdge('a', 'b', { type: 'LINK' });
    g.addEdge('b', 'c', { type: 'LINK' });
    const e = createEngine(g);
    const ast = parseCypher(
      'MATCH (n) WHERE n.name IN ["A","B"] WITH collect(n) AS nodes RETURN subgraph(nodes) AS sg',
    );
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> };
    expect(sg.nodes.length).toBe(2);
    expect(sg.edges.length).toBe(1);
  });

  it('egoGraph on undirected graph', async () => {
    const g = new Graph({ type: 'undirected' });
    g.addNode('a', { label: 'Node', name: 'A' });
    g.addNode('b', { label: 'Node', name: 'B' });
    g.addNode('c', { label: 'Node', name: 'C' });
    g.addEdge('a', 'b', { type: 'LINK' });
    g.addEdge('b', 'c', { type: 'LINK' });
    const e = createEngine(g);
    const ast = parseCypher(
      'MATCH (n {name: "B"}) RETURN egoGraph(n, 1) AS sg',
    );
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> };
    expect(sg.nodes.length).toBe(3); // B + A + C
    expect(sg.edges.length).toBe(2); // A-B, B-C
  });

  it('connectedComponent on undirected graph', async () => {
    const g = new Graph({ type: 'undirected' });
    g.addNode('a', { label: 'Node', name: 'A' });
    g.addNode('b', { label: 'Node', name: 'B' });
    g.addNode('c', { label: 'Node', name: 'C' });
    g.addEdge('a', 'b', { type: 'LINK' });
    g.addEdge('b', 'c', { type: 'LINK' });
    const e = createEngine(g);
    const ast = parseCypher(
      'MATCH (n {name: "A"}) RETURN connectedComponent(n) AS sg',
    );
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> };
    expect(sg.nodes.length).toBe(3);
    expect(sg.edges.length).toBe(2);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('subgraph functions edge cases', () => {
  it('subgraph with list containing non-node items', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "A"}) WITH collect(n) AS nodes RETURN subgraph(nodes) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: unknown[] };
    expect(sg.nodes.length).toBe(1);
    expect(sg.edges.length).toBe(0);
  });

  it('subgraph with duplicate nodes in list', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "A"}) RETURN subgraph([n, n]) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: unknown[] };
    expect(sg.nodes.length).toBe(1); // Deduplicated
  });

  it('subgraph with nodes not in graph', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN subgraph([{id: "nonexistent"}, {id: "a"}]) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: unknown[] };
    expect(sg.nodes.length).toBe(1);
    expect(sg.nodes[0]!.id).toBe('a');
  });

  it('egoGraph on single node graph', async () => {
    const g = new Graph();
    g.addNode('x', { label: 'Node', name: 'X' });
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n) RETURN egoGraph(n, 1) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: unknown[] };
    expect(sg.nodes.length).toBe(1);
    expect(sg.edges.length).toBe(0);
  });

  it('connectedComponent on single node graph', async () => {
    const g = new Graph();
    g.addNode('x', { label: 'Node', name: 'X' });
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n) RETURN connectedComponent(n) AS sg');
    const results = await e.execute(ast);
    const sg = results[0]!.sg as { nodes: Array<{ id: string }>; edges: unknown[] };
    expect(sg.nodes.length).toBe(1);
    expect(sg.edges.length).toBe(0);
  });
});
