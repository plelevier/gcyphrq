import { describe, it, expect, vi } from 'vitest';
import Graphology from 'graphology';
import {
  executeQuery,
  createGraph,
  Graph,
  GraphError,
  buildGraphIndexes,
} from '../src/lib';
import type {
  GraphologyFile,
  GraphologyNode,
  GraphologyEdge,
  GraphologyGraphOptions,
  GraphInput,
  GraphInstance,
  CypherEdge,
} from '../src/lib';

const sampleGraph: GraphologyFile = {
  nodes: [
    { key: 'alice', attributes: { label: 'User', name: 'Alice', age: 30 } },
    { key: 'bob', attributes: { label: 'User', name: 'Bob', age: 25 } },
    { key: 'charlie', attributes: { label: 'User', name: 'Charlie', age: 35 } },
  ],
  edges: [
    { source: 'alice', target: 'bob', attributes: { type: 'FRIEND' } },
    { source: 'bob', target: 'charlie', attributes: { type: 'FRIEND' } },
  ],
};

describe('executeQuery', () => {
  it('executes a simple MATCH query', () => {
    const results = executeQuery(sampleGraph, 'MATCH (u:User) RETURN u.name');
    expect(results.length).toBe(3);
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('executes a query with property filter', () => {
    const results = executeQuery(sampleGraph, 'MATCH (u:User {name: "Alice"}) RETURN u.age');
    expect(results).toEqual([{ age: 30 }]);
  });

  it('executes a traversal query', () => {
    const results = executeQuery(sampleGraph, 'MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN b.name');
    expect(results).toEqual([{ name: 'Bob' }]);
  });

  it('executes an aggregation query', () => {
    const results = executeQuery(sampleGraph, 'MATCH (u:User) RETURN count(u)');
    expect(results).toEqual([{ 'COUNT(u)': 3 }]);
  });

  it('throws GraphError for invalid graph data', () => {
    expect(() => executeQuery({ nodes: [{ key: '', attributes: {} }], edges: [] }, 'MATCH (n) RETURN n')).toThrow(GraphError);
  });

  it('throws Error for invalid query', () => {
    expect(() => executeQuery(sampleGraph, 'INVALID QUERY')).toThrow();
  });
});

describe('Graphology JSON format', () => {
  const graphologyGraph: GraphologyFile = {
    options: {
      type: 'directed',
      allowSelfLoops: false,
      multi: false,
    },
    attributes: {
      name: 'Test Graph',
      description: 'A test graph in Graphology JSON format',
    },
    nodes: [
      { key: 'alice', attributes: { label: 'User', name: 'Alice', age: 30 } },
      { key: 'bob', attributes: { label: 'User', name: 'Bob', age: 25 } },
      { key: 'charlie', attributes: { label: 'User', name: 'Charlie', age: 35 } },
    ],
    edges: [
      {
        key: 'alice-friend-bob',
        source: 'alice',
        target: 'bob',
        undirected: false,
        attributes: { type: 'FRIEND' },
      },
      {
        key: 'bob-friend-charlie',
        source: 'bob',
        target: 'charlie',
        undirected: false,
        attributes: { type: 'FRIEND' },
      },
    ],
  };

  it('accepts Graphology JSON format in createGraph', () => {
    const graph = createGraph(graphologyGraph);
    expect(graph.order).toBe(3);
    expect(graph.hasNode('alice')).toBe(true);
    expect(graph.hasNode('bob')).toBe(true);
  });

  it('preserves node attributes from Graphology format', () => {
    const graph = createGraph(graphologyGraph);
    const attrs = graph.getNodeAttributes('alice');
    expect(attrs.label).toBe('User');
    expect(attrs.name).toBe('Alice');
    expect(attrs.age).toBe(30);
  });

  it('preserves edge attributes from Graphology format', () => {
    const graph = createGraph(graphologyGraph);
    let capturedAttrs: Record<string, unknown> | undefined;
    graph.forEachEdge('alice', (_e, attrs) => { capturedAttrs = attrs; });
    expect(capturedAttrs!.type).toBe('FRIEND');
  });

  it('executes queries on Graphology JSON format', () => {
    const results = executeQuery(graphologyGraph, 'MATCH (u:User) RETURN u.name');
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('executes traversal on Graphology JSON format', () => {
    const results = executeQuery(
      graphologyGraph,
      'MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN b.name',
    );
    expect(results).toEqual([{ name: 'Bob' }]);
  });

  it('builds indexes from Graphology JSON format', () => {
    const indexes = buildGraphIndexes(graphologyGraph);
    expect(indexes.labelIndex.get('User')?.size).toBe(3);
    expect(indexes.propertyIndex.get('name')?.get('Alice')?.size).toBe(1);
    expect(indexes.edgeTypeIndex.out.get('FRIEND')?.get('alice')?.length).toBe(1);
  });

  it('works without optional options/attributes fields', () => {
    const minimalGraph: GraphologyFile = {
      nodes: [
        { key: 'a', attributes: { label: 'Node', name: 'A' } },
        { key: 'b', attributes: { label: 'Node', name: 'B' } },
      ],
      edges: [
        {
          source: 'a',
          target: 'b',
          attributes: { type: 'LINK' },
        },
      ],
    };
    const results = executeQuery(minimalGraph, 'MATCH (n:Node) RETURN count(n)');
    expect(results).toEqual([{ 'COUNT(n)': 2 }]);
  });

  it('exports Graphology format types', () => {
    const node: GraphologyNode = { key: 'a', attributes: { label: 'X' } };
    const edge: GraphologyEdge = { source: 'a', target: 'b', attributes: { type: 'LINK' } };
    const options: GraphologyGraphOptions = { type: 'directed' };
    const file: GraphologyFile = { nodes: [node], edges: [edge], options };
    const input: GraphInput = file;
    expect(input.nodes.length).toBe(1);
  });

  it('detects empty Graphology format via options field', () => {
    const emptyGraph: GraphologyFile = {
      options: { type: 'directed' },
      nodes: [],
      edges: [],
    };
    const graph = createGraph(emptyGraph);
    expect(graph.order).toBe(0);
  });

  it('throws for invalid options.type', () => {
    expect(() =>
      createGraph({
        // @ts-expect-error testing invalid type
        options: { type: 'invalid' },
        nodes: [{ key: 'a', attributes: { label: 'N' } }],
        edges: [],
      }),
    ).toThrow(/Unsupported graph option:.*"type"/);
  });

  it('accepts options.type undirected', () => {
    const graph = createGraph({
      options: { type: 'undirected' },
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [{ source: 'a', target: 'b', attributes: { type: 'KNOWS' } }],
    });
    expect(graph.type).toBe('undirected');
    expect(graph.order).toBe(2);
  });

  it('accepts options.type mixed', () => {
    const graph = createGraph({
      options: { type: 'mixed' },
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [{ source: 'a', target: 'b', attributes: { type: 'KNOWS' } }],
    });
    expect(graph.type).toBe('mixed');
    expect(graph.order).toBe(2);
  });

  it('supports options.allowSelfLoops', () => {
    const graph = createGraph({
      options: { type: 'directed', allowSelfLoops: true },
      nodes: [{ key: 'a', attributes: { label: 'N' } }],
      edges: [{ source: 'a', target: 'a', attributes: { type: 'SELF' } }],
    });
    expect(graph.order).toBe(1);
    // Verify self-loop edge exists by iterating edges
    let edgeCount = 0;
    graph.forEachEdge((id, attrs, source, target) => {
      if (source === 'a' && target === 'a') edgeCount++;
    });
    expect(edgeCount).toBe(1);
  });

  it('supports options.multi for parallel edges', () => {
    const graph = createGraph({
      options: { type: 'directed', multi: true },
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [
        { source: 'a', target: 'b', attributes: { type: 'TCP' } },
        { source: 'a', target: 'b', attributes: { type: 'UDP' } },
      ],
    });
    expect(graph.order).toBe(2);
    let edgeCount = 0;
    graph.forEachEdge(() => edgeCount++);
    expect(edgeCount).toBe(2);
  });

  it('rejects duplicate edges when multi is false', () => {
    expect(() =>
      createGraph({
        options: { type: 'directed' },
        nodes: [
          { key: 'a', attributes: { label: 'N' } },
          { key: 'b', attributes: { label: 'N' } },
        ],
        edges: [
          { source: 'a', target: 'b', attributes: { type: 'TCP' } },
          { source: 'a', target: 'b', attributes: { type: 'UDP' } },
        ],
      }),
    ).toThrow(/duplicate edge.*a->b/);
  });

  it('executeQuery with multi-graph JSON returns all parallel edges', () => {
    const results = executeQuery({
      options: { type: 'directed', multi: true },
      nodes: [
        { key: 'a', attributes: { label: 'N', name: 'A' } },
        { key: 'b', attributes: { label: 'N', name: 'B' } },
      ],
      edges: [
        { source: 'a', target: 'b', attributes: { type: 'TCP' } },
        { source: 'a', target: 'b', attributes: { type: 'UDP' } },
        { source: 'a', target: 'b', attributes: { type: 'TCP' } },
      ],
    }, 'MATCH (a:N)-[r]->(b:N) RETURN a.name, r.type, b.name');
    expect(results.length).toBe(3);
  });

  it('supports multi with undirected graph type', () => {
    const graph = createGraph({
      options: { type: 'undirected', multi: true },
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [
        { source: 'a', target: 'b', attributes: { type: 'E1' } },
        { source: 'a', target: 'b', attributes: { type: 'E2' } },
      ],
    });
    expect(graph.type).toBe('undirected');
    let edgeCount = 0;
    graph.forEachEdge(() => edgeCount++);
    expect(edgeCount).toBe(2);
  });

  it('wrapExternalGraph preserves multi for parallel edges', () => {
    const raw = new (Graphology as any).MultiDirectedGraph();
    raw.addNode('a', { label: 'N' });
    raw.addNode('b', { label: 'N' });
    raw.addEdge('a', 'b', { type: 'TCP' });
    raw.addEdge('a', 'b', { type: 'UDP' });
    // executeQuery wraps external graphs via wrapExternalGraph
    const results = executeQuery(raw, 'MATCH (a)-[r]->(b) RETURN r.type');
    expect(results.length).toBe(2);
  });

  it('warns about unsupported edge undirected via onWarning callback', () => {
    const warnings: string[] = [];
    createGraph({
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [
        { key: 'e1', source: 'a', target: 'b', undirected: true, attributes: { type: 'LINK' } },
      ],
    }, { onWarning: (w) => warnings.push(w) });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('"undirected"');
  });

  it('warns about duplicate edge keys (once) via onWarning callback', () => {
    const warnings: string[] = [];
    createGraph({
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
        { key: 'c', attributes: { label: 'N' } },
      ],
      edges: [
        { key: 'dup', source: 'a', target: 'b', attributes: { type: 'LINK' } },
        { key: 'dup', source: 'b', target: 'c', attributes: { type: 'OTHER' } },
      ],
    }, { onWarning: (w) => warnings.push(w) });
    const dupWarnings = warnings.filter((w) => w.includes('Duplicate edge key'));
    expect(dupWarnings.length).toBe(1);
  });

  it('does not emit warnings when no onWarning callback is provided', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      createGraph({
        nodes: [
          { key: 'a', attributes: { label: 'N' } },
          { key: 'b', attributes: { label: 'N' } },
        ],
        edges: [
          { key: 'e1', source: 'a', target: 'b', undirected: true, attributes: { type: 'LINK' } },
        ],
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not error for supported options', () => {
    expect(() =>
      createGraph({
        options: { type: 'directed', allowSelfLoops: false, multi: false },
        nodes: [{ key: 'a', attributes: { label: 'N' } }],
        edges: [],
      }),
    ).not.toThrow();
  });

  it('detects format by node structure even without options', () => {
    const graph: GraphologyFile = {
      nodes: [{ key: 'a', attributes: { label: 'N' } }],
      edges: [],
    };
    expect(() => createGraph(graph)).not.toThrow();
  });

  it('throws descriptive error for missing node key', () => {
    expect(() =>
      createGraph({
        options: { type: 'directed' },
        nodes: [{ key: '', attributes: { label: 'N' } }],
        edges: [],
      }),
    ).toThrow(/"key"/);
  });
});

describe('Graphology format edge cases', () => {
  it('throws for null node attributes', () => {
    const data = {
      nodes: [{ key: 'a', attributes: null }],
      edges: [],
    };
    expect(() => createGraph(data as unknown as GraphologyFile)).toThrow();
  });
});

describe('edge key preservation', () => {
  it('creates edges with user-provided keys via addEdgeWithKey', () => {
    const graph = createGraph({
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [
        { key: 'my-custom-edge', source: 'a', target: 'b', attributes: { type: 'LINK' } },
      ],
    });

    // Verify via query that the edge id is the original key
    const results = executeQuery(
      graph,
      'MATCH ()-[r]->() RETURN r',
    );
    const edges = results[0]!.r as CypherEdge[];
    expect(edges[0]!.id).toBe('my-custom-edge');
  });

  it('auto-generates edge ids when no key is provided', () => {
    const graph = createGraph({
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
      ],
      edges: [
        { source: 'a', target: 'b', attributes: { type: 'LINK' } },
      ],
    });

    const results = executeQuery(
      graph,
      'MATCH ()-[r]->() RETURN r',
    );
    const edges = results[0]!.r as CypherEdge[];
    // Auto-generated ids start with "geid_"
    expect(edges[0]!.id).toMatch(/^geid_/);
  });

  it('handles mixed edges (some with keys, some without)', () => {
    const graph = createGraph({
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
        { key: 'c', attributes: { label: 'N' } },
      ],
      edges: [
        { key: 'edge-1', source: 'a', target: 'b', attributes: { type: 'LINK' } },
        { source: 'b', target: 'c', attributes: { type: 'LINK' } },
      ],
    });

    const results = executeQuery(
      graph,
      'MATCH ()-[r]->() RETURN r',
    );
    expect(results.length).toBe(2);

    const ids = results.flatMap((r) => (r.r as CypherEdge[]).map((e) => e.id));
    expect(ids).toContain('edge-1');
    // The other edge should have an auto-generated id
    expect(ids.some((id) => id.startsWith('geid_'))).toBe(true);
  });

  it('preserves edge keys through variable-length paths', () => {
    const graph = createGraph({
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
        { key: 'c', attributes: { label: 'N' } },
      ],
      edges: [
        { key: 'first-edge', source: 'a', target: 'b', attributes: { type: 'LINK' } },
        { key: 'second-edge', source: 'b', target: 'c', attributes: { type: 'LINK' } },
      ],
    });

    const results = executeQuery(
      graph,
      'MATCH (a)-[r*1..2]->(c) RETURN r',
    );
    // 3 paths: a->b (len 1), a->b->c (len 2), b->c (len 1)
    expect(results.length).toBe(3);

    // Find the path with two edges (a->b->c)
    const twoEdgePath = results.find(
      (r) => (r.r as CypherEdge[]).length === 2,
    );
    expect(twoEdgePath).toBeDefined();
    const edges = twoEdgePath!.r as CypherEdge[];
    expect(edges[0]!.id).toBe('first-edge');
    expect(edges[1]!.id).toBe('second-edge');
  });

  it('handles duplicate edge keys gracefully (first wins)', () => {
    const warnings: string[] = [];
    const graph = createGraph({
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
        { key: 'c', attributes: { label: 'N' } },
      ],
      edges: [
        { key: 'dup', source: 'a', target: 'b', attributes: { type: 'FIRST' } },
        { key: 'dup', source: 'b', target: 'c', attributes: { type: 'SECOND' } },
      ],
    }, { onWarning: (w) => warnings.push(w) });

    // First edge should have key "dup", second should be auto-generated
    const results = executeQuery(
      graph,
      'MATCH ()-[r]->() RETURN r',
    );
    expect(results.length).toBe(2);

    const ids = results.flatMap((r) => (r.r as CypherEdge[]).map((e) => e.id));
    expect(ids).toContain('dup');
    // Second edge falls back to auto-generated id
    expect(ids.some((id) => id.startsWith('geid_'))).toBe(true);
    // Warning was emitted via callback
    expect(warnings.some((w) => w.includes('Duplicate edge key'))).toBe(true);
  });
});
