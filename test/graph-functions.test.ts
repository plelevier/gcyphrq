import { describe, it, expect } from 'vitest';
import { Graph, AdvancedCypherGraphologyEngine, buildIndexesFromGraph } from './engine-setup';
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

/** Complete directed graph (4 nodes, all pairs connected) */
function createCompleteGraph() {
  const g = new Graph();
  const nodes = ['a', 'b', 'c', 'd'];
  for (const n of nodes) g.addNode(n, { label: 'Node', name: n });
  for (const s of nodes) {
    for (const t of nodes) {
      if (s !== t) g.addEdge(s, t, { type: 'LINK' });
    }
  }
  return g;
}

/** Small undirected triangle */
function createUndirectedTriangle() {
  const g = new Graph({ type: 'undirected' });
  g.addNode('a', { label: 'Node', name: 'A' });
  g.addNode('b', { label: 'Node', name: 'B' });
  g.addNode('c', { label: 'Node', name: 'C' });
  g.addEdge('a', 'b', { type: 'LINK' });
  g.addEdge('b', 'c', { type: 'LINK' });
  g.addEdge('a', 'c', { type: 'LINK' });
  return g;
}

/** Disconnected graph: A-B and C-D (no path between them) */
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
  const indexes = buildIndexesFromGraph(graph);
  return new AdvancedCypherGraphologyEngine(graph, indexes);
}

// ── numNodes() ───────────────────────────────────────────────────────────────

describe('numNodes()', () => {
  it('returns correct count for line graph', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN numNodes() AS count');
    const results = await e.execute(ast);
    expect(results[0]!.count).toBe(4);
  });

  it('returns correct count for star graph', async () => {
    const g = createStarGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN numNodes() AS count');
    const results = await e.execute(ast);
    expect(results[0]!.count).toBe(4);
  });

  it('returns 0 for empty graph', async () => {
    const g = new Graph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN numNodes() AS count');
    const results = await e.execute(ast);
    expect(results[0]!.count).toBe(0);
  });

  it('returns 1 for single node graph', async () => {
    const g = new Graph();
    g.addNode('x', { label: 'Node', name: 'X' });
    const e = createEngine(g);
    const ast = parseCypher('RETURN numNodes() AS count');
    const results = await e.execute(ast);
    expect(results[0]!.count).toBe(1);
  });
});

// ── numRelationships() ───────────────────────────────────────────────────────

describe('numRelationships()', () => {
  it('returns correct count for line graph', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN numRelationships() AS count');
    const results = await e.execute(ast);
    expect(results[0]!.count).toBe(3);
  });

  it('returns correct count for complete graph (4 nodes * 3 edges = 12)', async () => {
    const g = createCompleteGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN numRelationships() AS count');
    const results = await e.execute(ast);
    expect(results[0]!.count).toBe(12);
  });

  it('returns 0 for empty graph', async () => {
    const g = new Graph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN numRelationships() AS count');
    const results = await e.execute(ast);
    expect(results[0]!.count).toBe(0);
  });

  it('returns correct count for undirected triangle', async () => {
    const g = createUndirectedTriangle();
    const e = createEngine(g);
    const ast = parseCypher('RETURN numRelationships() AS count');
    const results = await e.execute(ast);
    expect(results[0]!.count).toBe(3);
  });
});

// ── density() ────────────────────────────────────────────────────────────────

describe('density()', () => {
  it('returns 0 for empty graph', async () => {
    const g = new Graph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN density() AS d');
    const results = await e.execute(ast);
    expect(results[0]!.d).toBe(0);
  });

  it('returns 0 for single node graph', async () => {
    const g = new Graph();
    g.addNode('x', { label: 'Node', name: 'X' });
    const e = createEngine(g);
    const ast = parseCypher('RETURN density() AS d');
    const results = await e.execute(ast);
    expect(results[0]!.d).toBe(0);
  });

  it('returns 1 for complete directed graph', async () => {
    const g = createCompleteGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN density() AS d');
    const results = await e.execute(ast);
    // 12 edges / (4 * 3) = 12 / 12 = 1
    expect(results[0]!.d).toBe(1);
  });

  it('returns correct density for line graph (directed)', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN density() AS d');
    const results = await e.execute(ast);
    // 3 edges / (4 * 3) = 3 / 12 = 0.25
    expect(results[0]!.d).toBe(0.25);
  });

  it('returns correct density for undirected triangle', async () => {
    const g = createUndirectedTriangle();
    const e = createEngine(g);
    const ast = parseCypher('RETURN density() AS d');
    const results = await e.execute(ast);
    // 3 edges / (3 * 2 / 2) = 3 / 3 = 1
    expect(results[0]!.d).toBe(1);
  });

  it('returns correct density for star graph (directed)', async () => {
    const g = createStarGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN density() AS d');
    const results = await e.execute(ast);
    // 3 edges / (4 * 3) = 3 / 12 = 0.25
    expect(results[0]!.d).toBe(0.25);
  });
});

// ── averageDegree() ──────────────────────────────────────────────────────────

describe('averageDegree()', () => {
  it('returns 0 for empty graph', async () => {
    const g = new Graph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN averageDegree() AS d');
    const results = await e.execute(ast);
    expect(results[0]!.d).toBe(0);
  });

  it('returns 0 for single node graph', async () => {
    const g = new Graph();
    g.addNode('x', { label: 'Node', name: 'X' });
    const e = createEngine(g);
    const ast = parseCypher('RETURN averageDegree() AS d');
    const results = await e.execute(ast);
    expect(results[0]!.d).toBe(0);
  });

  it('returns correct average degree for line graph', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN averageDegree() AS d');
    const results = await e.execute(ast);
    // A: out=1, in=0 => 1; B: out=1, in=1 => 2; C: out=1, in=1 => 2; D: out=0, in=1 => 1
    // Average = (1+2+2+1)/4 = 1.5
    expect(results[0]!.d).toBe(1.5);
  });

  it('returns correct average degree for star graph', async () => {
    const g = createStarGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN averageDegree() AS d');
    const results = await e.execute(ast);
    // center: out=3, in=0 => 3; leaf1: out=0, in=1 => 1; leaf2: out=0, in=1 => 1; leaf3: out=0, in=1 => 1
    // Average = (3+1+1+1)/4 = 1.5
    expect(results[0]!.d).toBe(1.5);
  });

  it('returns correct average degree for complete graph', async () => {
    const g = createCompleteGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN averageDegree() AS d');
    const results = await e.execute(ast);
    // Each node: out=3, in=3 => 6. Average = 6
    expect(results[0]!.d).toBe(6);
  });

  it('returns correct average degree for undirected triangle', async () => {
    const g = createUndirectedTriangle();
    const e = createEngine(g);
    const ast = parseCypher('RETURN averageDegree() AS d');
    const results = await e.execute(ast);
    // Each node has degree 2 (connected to 2 others). Average = 2
    expect(results[0]!.d).toBe(2);
  });
});

// ── diameter() ───────────────────────────────────────────────────────────────

describe('diameter()', () => {
  it('returns 0 for empty graph', async () => {
    const g = new Graph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN diameter() AS d');
    const results = await e.execute(ast);
    expect(results[0]!.d).toBe(0);
  });

  it('returns 0 for single node graph', async () => {
    const g = new Graph();
    g.addNode('x', { label: 'Node', name: 'X' });
    const e = createEngine(g);
    const ast = parseCypher('RETURN diameter() AS d');
    const results = await e.execute(ast);
    expect(results[0]!.d).toBe(0);
  });

  it('returns -1 for disconnected graph', async () => {
    const g = createDisconnectedGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN diameter() AS d');
    const results = await e.execute(ast);
    expect(results[0]!.d).toBe(-1);
  });

  it('returns correct diameter for line graph', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN diameter() AS d');
    const results = await e.execute(ast);
    // A->B->C->D: diameter = 3
    expect(results[0]!.d).toBe(3);
  });

  it('returns correct diameter for star graph', async () => {
    const g = createStarGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN diameter() AS d');
    const results = await e.execute(ast);
    // center->leaf: distance 1. leaf to leaf via center: distance 2
    // Diameter treats edges as bidirectional
    expect(results[0]!.d).toBe(2);
  });

  it('returns correct diameter for complete graph', async () => {
    const g = createCompleteGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN diameter() AS d');
    const results = await e.execute(ast);
    // Every node directly connected to every other: diameter = 1
    expect(results[0]!.d).toBe(1);
  });

  it('returns correct diameter for undirected triangle', async () => {
    const g = createUndirectedTriangle();
    const e = createEngine(g);
    const ast = parseCypher('RETURN diameter() AS d');
    const results = await e.execute(ast);
    // Every node directly connected to every other: diameter = 1
    expect(results[0]!.d).toBe(1);
  });
});

// ── pagerank() ───────────────────────────────────────────────────────────────

describe('pagerank()', () => {
  it('returns a map of scores for all nodes', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN pagerank() AS scores');
    const results = await e.execute(ast);
    const scores = results[0]!.scores as Record<string, number>;
    expect(Object.keys(scores)).toHaveLength(4);
    // All scores should be positive
    for (const [, v] of Object.entries(scores)) {
      expect(v).toBeGreaterThan(0);
    }
    // Scores should sum to approximately 1
    const sum = Object.values(scores).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  it('returns score for a specific node', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "A"}) RETURN pagerank(n) AS score');
    const results = await e.execute(ast);
    expect(typeof results[0]!.score).toBe('number');
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('returns higher score for sink node in line graph', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n) RETURN pagerank(n) AS score, n.name AS name ORDER BY name');
    const results = await e.execute(ast);
    const scores: Record<string, number> = {};
    for (const r of results) {
      scores[r.name as string] = r.score as number;
    }
    // In a line graph A->B->C->D, D (sink) should have highest PageRank
    expect(scores['D']!).toBeGreaterThan(scores['A']!);
  });

  it('returns equal scores for symmetric graph', async () => {
    const g = createCompleteGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN pagerank() AS scores');
    const results = await e.execute(ast);
    const scores = results[0]!.scores as Record<string, number>;
    const values = Object.values(scores);
    // All scores should be approximately equal (1/4 each)
    for (const v of values) {
      expect(v).toBeCloseTo(0.25, 3);
    }
  });

  it('returns null for empty graph', async () => {
    const g = new Graph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN pagerank() AS scores');
    const results = await e.execute(ast);
    expect(results[0]!.scores).toEqual({});
  });

  it('returns null for unknown node', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN pagerank({id: "nonexistent"}) AS score');
    const results = await e.execute(ast);
    expect(results[0]!.score).toBeNull();
  });
});

// ── degreeCentrality() ───────────────────────────────────────────────────────

describe('degreeCentrality()', () => {
  it('returns a map of scores for all nodes', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN degreeCentrality() AS scores');
    const results = await e.execute(ast);
    const scores = results[0]!.scores as Record<string, number>;
    expect(Object.keys(scores)).toHaveLength(4);
  });

  it('returns score for a specific node', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "A"}) RETURN degreeCentrality(n) AS score');
    const results = await e.execute(ast);
    expect(typeof results[0]!.score).toBe('number');
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('returns correct centrality for line graph', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n) RETURN degreeCentrality(n) AS score, n.name AS name ORDER BY name');
    const results = await e.execute(ast);
    const scores: Record<string, number> = {};
    for (const r of results) {
      scores[r.name as string] = r.score as number;
    }
    // Max degree = 3 (v-1). A: 1 neighbor (B), B: 2 (A,C), C: 2 (B,D), D: 1 (C)
    expect(scores['A']).toBeCloseTo(1 / 3, 4); // 1/3
    expect(scores['B']).toBeCloseTo(2 / 3, 4); // 2/3
    expect(scores['C']).toBeCloseTo(2 / 3, 4); // 2/3
    expect(scores['D']).toBeCloseTo(1 / 3, 4); // 1/3
  });

  it('returns highest centrality for center in star graph', async () => {
    const g = createStarGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n) RETURN degreeCentrality(n) AS score, n.name AS name ORDER BY name');
    const results = await e.execute(ast);
    const scores: Record<string, number> = {};
    for (const r of results) {
      scores[r.name as string] = r.score as number;
    }
    // Center has 3 neighbors out of 3 max = 1.0
    expect(scores['Center']).toBeCloseTo(1, 4);
    // Each leaf has 1 neighbor (center) = 1/3
    expect(scores['Leaf1']).toBeCloseTo(1 / 3, 4);
  });

  it('returns 0 for single node graph', async () => {
    const g = new Graph();
    g.addNode('x', { label: 'Node', name: 'X' });
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n) RETURN degreeCentrality(n) AS score');
    const results = await e.execute(ast);
    expect(results[0]!.score).toBe(0);
  });

  it('returns equal centrality for complete graph', async () => {
    const g = createCompleteGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN degreeCentrality() AS scores');
    const results = await e.execute(ast);
    const scores = results[0]!.scores as Record<string, number>;
    const values = Object.values(scores);
    // All nodes connected to all others: centrality = 1.0
    for (const v of values) {
      expect(v).toBeCloseTo(1, 4);
    }
  });
});

// ── betweennessCentrality() ──────────────────────────────────────────────────

describe('betweennessCentrality()', () => {
  it('returns a map of scores for all nodes', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN betweennessCentrality() AS scores');
    const results = await e.execute(ast);
    const scores = results[0]!.scores as Record<string, number>;
    expect(Object.keys(scores)).toHaveLength(4);
  });

  it('returns score for a specific node', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n {name: "B"}) RETURN betweennessCentrality(n) AS score');
    const results = await e.execute(ast);
    expect(typeof results[0]!.score).toBe('number');
  });

  it('returns highest betweenness for middle nodes in line graph', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n) RETURN betweennessCentrality(n) AS score, n.name AS name ORDER BY name');
    const results = await e.execute(ast);
    const scores: Record<string, number> = {};
    for (const r of results) {
      scores[r.name as string] = r.score as number;
    }
    // In A->B->C->D: B and C are on shortest paths between A and D
    // A and D have 0 betweenness (endpoints)
    expect(scores['A']).toBe(0);
    expect(scores['D']).toBe(0);
    expect(scores['B']).toBeGreaterThan(0);
    expect(scores['C']).toBeGreaterThan(0);
  });

  it('returns 0 for all nodes in complete graph', async () => {
    const g = createCompleteGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN betweennessCentrality() AS scores');
    const results = await e.execute(ast);
    const scores = results[0]!.scores as Record<string, number>;
    // In complete graph, every pair has a direct edge, so no node is "between" others
    for (const [, v] of Object.entries(scores)) {
      expect(v).toBe(0);
    }
  });

  it('returns 0 for all nodes in undirected triangle', async () => {
    const g = createUndirectedTriangle();
    const e = createEngine(g);
    const ast = parseCypher('RETURN betweennessCentrality() AS scores');
    const results = await e.execute(ast);
    const scores = results[0]!.scores as Record<string, number>;
    for (const [, v] of Object.entries(scores)) {
      expect(v).toBe(0);
    }
  });

  it('returns 0 for single node graph', async () => {
    const g = new Graph();
    g.addNode('x', { label: 'Node', name: 'X' });
    const e = createEngine(g);
    const ast = parseCypher('MATCH (n) RETURN betweennessCentrality(n) AS score');
    const results = await e.execute(ast);
    expect(results[0]!.score).toBe(0);
  });

  it('returns 0 for empty graph', async () => {
    const g = new Graph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN betweennessCentrality() AS scores');
    const results = await e.execute(ast);
    expect(results[0]!.scores).toEqual({});
  });
});

// ── Integration tests ────────────────────────────────────────────────────────

describe('graph functions integration', () => {
  it('can use multiple graph functions in one query', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher(
      'RETURN numNodes() AS nodes, numRelationships() AS edges, density() AS d',
    );
    const results = await e.execute(ast);
    expect(results[0]!.nodes).toBe(4);
    expect(results[0]!.edges).toBe(3);
    expect(results[0]!.d).toBe(0.25);
  });

  it('can combine graph functions with MATCH', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher(
      'MATCH (n) RETURN n.name AS name, numNodes() AS totalNodes',
    );
    const results = await e.execute(ast);
    expect(results.length).toBe(4);
    for (const r of results) {
      expect(r.totalNodes).toBe(4);
    }
  });

  it('works with undirected graph', async () => {
    const g = createUndirectedTriangle();
    const e = createEngine(g);
    const ast = parseCypher(
      'RETURN numNodes() AS nodes, numRelationships() AS edges, density() AS d, averageDegree() AS avgDeg, diameter() AS diam',
    );
    const results = await e.execute(ast);
    expect(results[0]!.nodes).toBe(3);
    expect(results[0]!.edges).toBe(3);
    expect(results[0]!.d).toBe(1);
    expect(results[0]!.avgDeg).toBe(2);
    expect(results[0]!.diam).toBe(1);
  });

  it('pagerank on undirected graph', async () => {
    const g = createUndirectedTriangle();
    const e = createEngine(g);
    const ast = parseCypher('RETURN pagerank() AS scores');
    const results = await e.execute(ast);
    const scores = results[0]!.scores as Record<string, number>;
    const values = Object.values(scores);
    // All nodes should have approximately equal PageRank in a symmetric graph
    for (const v of values) {
      expect(v).toBeCloseTo(1 / 3, 3);
    }
  });

  it('degreeCentrality on undirected graph', async () => {
    const g = createUndirectedTriangle();
    const e = createEngine(g);
    const ast = parseCypher('RETURN degreeCentrality() AS scores');
    const results = await e.execute(ast);
    const scores = results[0]!.scores as Record<string, number>;
    // Each node has 2 neighbors out of max 2 = 1.0
    for (const [, v] of Object.entries(scores)) {
      expect(v).toBeCloseTo(1, 4);
    }
  });

  it('betweennessCentrality on undirected graph', async () => {
    const g = createUndirectedTriangle();
    const e = createEngine(g);
    const ast = parseCypher('RETURN betweennessCentrality() AS scores');
    const results = await e.execute(ast);
    const scores = results[0]!.scores as Record<string, number>;
    // All betweenness should be 0 in a triangle
    for (const [, v] of Object.entries(scores)) {
      expect(v).toBe(0);
    }
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('graph functions edge cases', () => {
  it('handles two-node graph', async () => {
    const g = new Graph();
    g.addNode('a', { label: 'Node', name: 'A' });
    g.addNode('b', { label: 'Node', name: 'B' });
    g.addEdge('a', 'b', { type: 'LINK' });
    const e = createEngine(g);

    const ast = parseCypher(
      'RETURN numNodes() AS nodes, numRelationships() AS edges, density() AS d, averageDegree() AS avgDeg, diameter() AS diam',
    );
    const results = await e.execute(ast);
    expect(results[0]!.nodes).toBe(2);
    expect(results[0]!.edges).toBe(1);
    expect(results[0]!.d).toBe(0.5); // 1 / (2*1) = 0.5
    expect(results[0]!.avgDeg).toBe(1); // (1+1)/2 = 1
    expect(results[0]!.diam).toBe(1);
  });

  it('pagerank with null argument returns null', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN pagerank(null) AS score');
    const results = await e.execute(ast);
    expect(results[0]!.score).toBeNull();
  });

  it('degreeCentrality with null argument returns null', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN degreeCentrality(null) AS score');
    const results = await e.execute(ast);
    expect(results[0]!.score).toBeNull();
  });

  it('betweennessCentrality with null argument returns null', async () => {
    const g = createLineGraph();
    const e = createEngine(g);
    const ast = parseCypher('RETURN betweennessCentrality(null) AS score');
    const results = await e.execute(ast);
    expect(results[0]!.score).toBeNull();
  });
});
