import { describe, it, expect } from 'vitest';
import { createGraph, executeQuery, Graph, buildGraphIndexes, GraphEngine, parseCypher } from '../src/lib';

// ── Undirected graph tests ──────────────────────────────────────────────────

describe('Undirected graphs', () => {
  const undirectedGraph = {
    options: { type: 'undirected' } as const,
    nodes: [
      { key: 'a', attributes: { label: 'Person', name: 'Alice' } },
      { key: 'b', attributes: { label: 'Person', name: 'Bob' } },
      { key: 'c', attributes: { label: 'Person', name: 'Charlie' } },
    ],
    edges: [
      { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
      { source: 'b', target: 'c', attributes: { type: 'KNOWS' } },
    ],
  };

  it('creates graph with correct type', () => {
    const graph = createGraph(undirectedGraph);
    expect(graph.type).toBe('undirected');
    expect(graph.order).toBe(3);
  });

  it('traverses edges in both directions with ->', () => {
    const results = executeQuery(undirectedGraph, 'MATCH (a)-[:KNOWS]->(b) RETURN a.name, b.name ORDER BY a.name');
    // In undirected graphs, -> traverses all incident edges
    expect(results.length).toBe(4); // a->b, b->a, b->c, c->b
  });

  it('traverses edges in both directions with <-', () => {
    const results = executeQuery(undirectedGraph, 'MATCH (a)<-[:KNOWS]-(b) RETURN a.name, b.name ORDER BY a.name');
    expect(results.length).toBe(4);
  });

  it('traverses edges in both directions with -', () => {
    const results = executeQuery(undirectedGraph, 'MATCH (a)-[:KNOWS]-(b) RETURN a.name, b.name ORDER BY a.name');
    expect(results.length).toBe(4);
  });

  it('finds paths in both directions', () => {
    const results = executeQuery(undirectedGraph, 'MATCH (c:Person)-[:KNOWS*1..2]-(a:Person) WHERE c.name = "Charlie" AND a.name = "Alice" RETURN c.name, a.name');
    expect(results.length).toBe(1);
    expect(results[0]['a.name']).toBe('Alice');
  });

  it('variable-length paths work bidirectionally', () => {
    const results = executeQuery(undirectedGraph, 'MATCH (a:Person)-[:KNOWS*1..3]-(b:Person) WHERE a.name = \'Alice\' RETURN a.name, b.name ORDER BY b.name');
    expect(results.length).toBe(2); // Alice-Bob (1 hop), Alice-Charlie (2 hops via Bob)
  });

  it('creates graph programmatically', () => {
    const graph = new Graph({ type: 'undirected' });
    graph.addNode('a', { label: 'Person', name: 'Alice' });
    graph.addNode('b', { label: 'Person', name: 'Bob' });
    graph.addEdge('a', 'b', { type: 'KNOWS' });

    const results = executeQuery(graph, 'MATCH (a)-[:KNOWS]->(b) RETURN a.name, b.name');
    expect(results.length).toBe(2); // Both directions
  });
});

// ── Mixed graph tests ───────────────────────────────────────────────────────

describe('Mixed graphs', () => {
  const mixedGraph = {
    options: { type: 'mixed' } as const,
    nodes: [
      { key: 'a', attributes: { label: 'Person', name: 'Alice' } },
      { key: 'b', attributes: { label: 'Person', name: 'Bob' } },
      { key: 'c', attributes: { label: 'Person', name: 'Charlie' } },
      { key: 'd', attributes: { label: 'Person', name: 'Diana' } },
    ],
    edges: [
      // Directed: a -> b
      { source: 'a', target: 'b', attributes: { type: 'FOLLOWS' } },
      // Undirected: b - c
      { source: 'b', target: 'c', attributes: { type: 'FRIENDS' }, undirected: true },
      // Directed: c -> d
      { source: 'c', target: 'd', attributes: { type: 'FOLLOWS' } },
      // Undirected: a - d
      { source: 'a', target: 'd', attributes: { type: 'FRIENDS' }, undirected: true },
    ],
  };

  it('creates graph with correct type', () => {
    const graph = createGraph(mixedGraph);
    expect(graph.type).toBe('mixed');
    expect(graph.order).toBe(4);
  });

  it('traverses directed edges in correct direction', () => {
    const results = executeQuery(mixedGraph, 'MATCH (a:Person)-[:FOLLOWS]->(b:Person) RETURN a.name, b.name ORDER BY a.name');
    expect(results.length).toBe(2); // a->b, c->d
    expect(results[0]['a.name']).toBe('Alice');
    expect(results[0]['b.name']).toBe('Bob');
    expect(results[1]['a.name']).toBe('Charlie');
    expect(results[1]['b.name']).toBe('Diana');
  });

  it('traverses directed edges in reverse with <-', () => {
    const results = executeQuery(mixedGraph, 'MATCH (a:Person)<-[:FOLLOWS]-(b:Person) RETURN a.name, b.name ORDER BY a.name');
    expect(results.length).toBe(2); // b<-a, d<-c
  });

  it('traverses undirected edges in both directions with ->', () => {
    const results = executeQuery(mixedGraph, 'MATCH (a:Person)-[:FRIENDS]->(b:Person) RETURN a.name, b.name ORDER BY a.name, b.name');
    // Undirected edges should be traversable in both directions
    expect(results.length).toBe(4); // b->c, c->b, a->d, d->a
  });

  it('traverses undirected edges with -', () => {
    const results = executeQuery(mixedGraph, 'MATCH (a:Person)-[:FRIENDS]-(b:Person) RETURN a.name, b.name ORDER BY a.name, b.name');
    expect(results.length).toBe(4);
  });

  it('mixed traversal: directed + undirected edges', () => {
    const results = executeQuery(mixedGraph, "MATCH (a:Person)-[*1]-(b:Person) WHERE a.name = 'Alice' RETURN a.name, b.name ORDER BY b.name");
    // Alice has: directed out to Bob (FOLLOWS), undirected to Diana (FRIENDS)
    // With undirected traversal (-), Alice should reach Bob (via FOLLOWS both ways) and Diana (via FRIENDS)
    expect(results.length).toBe(2);
    const names = results.map((r) => r['b.name']).sort();
    expect(names).toEqual(['Bob', 'Diana']);
  });

  it('path through mixed edges', () => {
    const results = executeQuery(mixedGraph, "MATCH (a:Person)-[*1..3]-(d:Person) WHERE a.name = 'Alice' AND d.name = 'Diana' RETURN a.name, d.name");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('creates mixed graph programmatically', () => {
    const graph = new Graph({ type: 'mixed' });
    graph.addNode('a', { label: 'N' });
    graph.addNode('b', { label: 'N' });
    graph.addNode('c', { label: 'N' });
    graph.addEdge('a', 'b', { type: 'DIRECTED' }); // directed by default
    graph.addEdge('a', 'c', { type: 'UNDIRECTED', undirected: true }); // undirected

    const dirResults = executeQuery(graph, 'MATCH (a)-[:DIRECTED]->(b) RETURN a.id, b.id');
    expect(dirResults.length).toBe(1); // Only a->b

    const undirResults = executeQuery(graph, 'MATCH (a)-[:UNDIRECTED]->(b) RETURN a.id, b.id');
    expect(undirResults.length).toBe(2); // Both directions: a->c and c->a
  });
});

// ── GraphEngine with undirected/mixed graphs ────────────────────────────────

describe('GraphEngine with undirected/mixed graphs', () => {
  it('works with undirected graph via GraphEngine', () => {
    const graph = createGraph({
      options: { type: 'undirected' },
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [{ source: 'a', target: 'b', attributes: { type: 'E' } }],
    });
    const indexes = buildGraphIndexes(graph);
    const engine = new GraphEngine(graph, indexes);
    const ast = parseCypher('MATCH (a)-[:E]->(b) RETURN a.id, b.id');

    const results = engine.execute(ast);
    expect(results.length).toBe(2);
  });

  it('works with mixed graph via GraphEngine', () => {
    const graph = createGraph({
      options: { type: 'mixed' },
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
        { key: 'c', attributes: { label: 'N' } },
      ],
      edges: [
        { source: 'a', target: 'b', attributes: { type: 'D' } },
        { source: 'a', target: 'c', attributes: { type: 'U', undirected: true } },
      ],
    });
    const indexes = buildGraphIndexes(graph);
    const engine = new GraphEngine(graph, indexes);

    const dirAst = parseCypher('MATCH (a)-[:D]->(b) RETURN a.id, b.id');
    const dirResults = engine.execute(dirAst);
    expect(dirResults.length).toBe(1);

    const undirAst = parseCypher('MATCH (a)-[:U]->(b) RETURN a.id, b.id');
    const undirResults = engine.execute(undirAst);
    expect(undirResults.length).toBe(2);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('Undirected/mixed edge cases', () => {
  it('warns about undirected edges in directed graphs', () => {
    const warnings: string[] = [];
    createGraph({
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [{ source: 'a', target: 'b', attributes: { type: 'E' }, undirected: true }],
    }, { onWarning: (w) => warnings.push(w) });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('undirected');
  });

  it('no warning for undirected edges in mixed graphs', () => {
    const warnings: string[] = [];
    createGraph({
      options: { type: 'mixed' },
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [{ source: 'a', target: 'b', attributes: { type: 'E' }, undirected: true }],
    }, { onWarning: (w) => warnings.push(w) });
    expect(warnings.length).toBe(0);
  });

  it('detects duplicate undirected edges', () => {
    expect(() =>
      createGraph({
        options: { type: 'undirected' },
        nodes: [
          { key: 'a', attributes: { label: 'N' } },
          { key: 'b', attributes: { label: 'N' } },
        ],
        edges: [
          { source: 'a', target: 'b', attributes: { type: 'E' } },
          { source: 'b', target: 'a', attributes: { type: 'E' } },
        ],
      }),
    ).toThrow(/duplicate edge/);
  });

  it('buildGraphIndexes two-arg form preserves edge IDs for raw graphs', () => {
    // Verify that indexes built from a raw Graphology graph use the graph's
    // actual edge IDs (not from a wrapped copy), so GraphEngine can look them up.
    const graphology = require('graphology');
    const rawGraph = new graphology.Graph({ type: 'mixed' });
    rawGraph.addNode('a', { label: 'N' });
    rawGraph.addNode('b', { label: 'N' });
    rawGraph.addEdge('a', 'b', { type: 'E', undirected: true });

    const graphData = {
      options: { type: 'mixed' } as const,
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [{ source: 'a', target: 'b', attributes: { type: 'E' }, undirected: true }],
    };

    const indexes = buildGraphIndexes(graphData, rawGraph as any);
    // Index edge IDs should match the raw graph's edge IDs
    const indexedEdgeIds = new Set<string>();
    for (const [, map] of indexes.edgeTypeIndex.out) {
      for (const neighbors of map.values()) {
        for (const n of neighbors) indexedEdgeIds.add(n.edgeId);
      }
    }
    const rawEdgeIds = new Set<string>();
    rawGraph.forEachEdge((id: string) => rawEdgeIds.add(id));
    expect(indexedEdgeIds).toEqual(rawEdgeIds);
  });

  it('defaults to directed graph type', () => {
    const graph = new Graph();
    expect(graph.type).toBe('directed');
  });

  it('buildGraphIndexes from data preserves graph type', () => {
    const indexes = buildGraphIndexes({
      options: { type: 'undirected' },
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [{ source: 'a', target: 'b', attributes: { type: 'E' } }],
    });
    expect(indexes.labelIndex.get('N')?.size).toBe(2);
  });

  it('handles self-loops in undirected graphs', () => {
    const graph = createGraph({
      options: { type: 'undirected' },
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [
        { source: 'a', target: 'a', attributes: { type: 'SELF' } },
        { source: 'a', target: 'b', attributes: { type: 'E' } },
      ],
    });
    // Self-loop should appear once, not duplicated
    const results = executeQuery(graph, 'MATCH (a)-[:SELF]->(b) RETURN a.id, b.id');
    expect(results.length).toBe(1);
    expect(results[0]['a.id']).toBe(results[0]['b.id']);
  });

  it('single-quoted string literals work in WHERE clauses', () => {
    const graph = createGraph({
      options: { type: 'directed' },
      nodes: [
        { key: 'a', attributes: { label: 'Person', name: 'Alice' } },
        { key: 'b', attributes: { label: 'Person', name: 'Bob' } },
      ],
      edges: [{ source: 'a', target: 'b', attributes: { type: 'KNOWS' } }],
    });
    const results = executeQuery(graph, "MATCH (a:Person) WHERE a.name = 'Alice' RETURN a.name");
    expect(results.length).toBe(1);
    expect(results[0]['name']).toBe('Alice');
  });

  it('single-quoted string literals work in inline property filters', () => {
    const graph = createGraph({
      options: { type: 'directed' },
      nodes: [
        { key: 'a', attributes: { label: 'Person', name: 'Alice' } },
        { key: 'b', attributes: { label: 'Person', name: 'Bob' } },
      ],
      edges: [{ source: 'a', target: 'b', attributes: { type: 'KNOWS' } }],
    });
    const results = executeQuery(graph, "MATCH (a:Person {name: 'Alice'})-[r]->(b:Person) RETURN a.name, b.name");
    expect(results.length).toBe(1);
    expect(results[0]['a.name']).toBe('Alice');
    expect(results[0]['b.name']).toBe('Bob');
  });
});
