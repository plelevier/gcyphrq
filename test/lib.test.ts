import { describe, it, expect, vi } from 'vitest';
import Graphology from 'graphology';
import {
  executeQuery,
  createGraph,
  parseCypher as _parseCypher,
  GraphEngine,
  Graph,
  GraphError,
  buildGraphIndexes,
} from '../src/lib';

const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;
import type {
  GraphologyFile,
  GraphologyNode,
  GraphologyEdge,
  GraphologyGraphOptions,
  GraphInput,
  GraphInstance,
  AdvancedCypherAST,
  ResultRow,
  CypherNode,
  CypherEdge,
  CypherValue,
  CypherLiteral,
  MatchClause,
  WithClause,
  ReturnClause,
  NodePattern,
  RelationPattern,
  Expression,
  Projection,
  OrderByItem,
  Stage,
  Direction,
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

describe('createGraph', () => {
  it('builds a GraphInstance from graph data', () => {
    const graph = createGraph(sampleGraph);
    expect(graph.order).toBe(3);
    expect(graph.hasNode('alice')).toBe(true);
    expect(graph.hasNode('bob')).toBe(true);
  });

  it('preserves node attributes', () => {
    const graph = createGraph(sampleGraph);
    const attrs = graph.getNodeAttributes('alice');
    expect(attrs.label).toBe('User');
    expect(attrs.name).toBe('Alice');
    expect(attrs.age).toBe(30);
  });

  it('preserves edge attributes', () => {
    const graph = createGraph(sampleGraph);
    let capturedAttrs: Record<string, unknown> | undefined;
    graph.forEachEdge('alice', (_e, attrs) => { capturedAttrs = attrs; });
    expect(capturedAttrs!.type).toBe('FRIEND');
  });

  it('throws GraphError for missing nodes array', () => {
    expect(() => createGraph({ edges: [] } as unknown as GraphologyFile)).toThrow(GraphError);
  });

  it('throws GraphError for duplicate node ids', () => {
    expect(() => createGraph({
      nodes: [{ key: 'a', attributes: { label: 'X' } }, { key: 'a', attributes: { label: 'Y' } }],
      edges: [],
    })).toThrow(GraphError);
  });

  it('throws GraphError for edge referencing unknown node', () => {
    expect(() => createGraph({
      nodes: [{ key: 'a', attributes: { label: 'X' } }],
      edges: [{ source: 'a', target: 'unknown', attributes: {} }],
    })).toThrow(GraphError);
  });
});

describe('parseCypher', () => {
  it('returns an AdvancedCypherAST', () => {
    const ast = parseCypher('MATCH (u:User) RETURN u');
    expect(ast.type).toBe('Query');
    expect(ast.stages.length).toBe(1);
    expect(ast.stages[0]!.type).toBe('MATCH');
  });

  it('parses MATCH with labels and properties', () => {
    const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u');
    const clause = ast.stages[0] as { type: 'MATCH'; clause: MatchClause };
    expect(clause.clause.sourcePattern.labels).toEqual({ labels: ['User'], orLabels: [], notLabels: [], orNotLabels: [] });
    expect(clause.clause.sourcePattern.properties).toEqual({ name: 'Alice' });
  });

  it('throws for invalid syntax', () => {
    expect(() => parseCypher('NOT VALID CYPHER @#$')).toThrow();
  });
});

describe('GraphEngine', () => {
  it('is the same class as AdvancedCypherGraphologyEngine', () => {
    const graph = createGraph(sampleGraph);
    const engine = new GraphEngine(graph);
    const ast = parseCypher('MATCH (u:User) RETURN u.name');
    const results = engine.execute(ast);
    expect(results.length).toBe(3);
  });

  it('supports multiple queries on the same engine', () => {
    const graph = createGraph(sampleGraph);
    const engine = new GraphEngine(graph);

    const users = engine.execute(parseCypher('MATCH (u:User) RETURN u.name'));
    expect(users.length).toBe(3);

    const count = engine.execute(parseCypher('MATCH (u:User) RETURN count(u)'));
    expect(count).toEqual([{ 'COUNT(u)': 3 }]);
  });
});

describe('Graph', () => {
  it('can be used to build a graph programmatically', () => {
    const graph = new Graph();
    graph.addNode('x', { label: 'Test', value: 42 });
    graph.addNode('y', { label: 'Test' });
    graph.addEdge('x', 'y', { type: 'LINK' });

    expect(graph.order).toBe(2);
    expect(graph.hasNode('x')).toBe(true);
  });

  it('works with GraphEngine for query execution', () => {
    const graph = new Graph();
    graph.addNode('a', { label: 'Node', name: 'Alpha' });
    const engine = new GraphEngine(graph);
    const results = engine.execute(parseCypher('MATCH (n:Node) RETURN n.name'));
    expect(results).toEqual([{ name: 'Alpha' }]);
  });
});

describe('GraphError', () => {
  it('is a subclass of Error', () => {
    const err = new GraphError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GraphError);
    expect(err.name).toBe('GraphError');
    expect(err.message).toBe('test');
  });

  it('is thrown by createGraph on invalid data', () => {
    expect(() => createGraph({ nodes: [{}] as unknown as GraphologyNode[], edges: [] } as unknown as GraphologyFile)).toThrow(GraphError);
  });
});

describe('mutations', () => {
  it('supports CREATE mutation via GraphEngine', () => {
    const graph = new Graph();
    graph.addNode('a', { label: 'User', name: 'Alice' });
    const engine = new GraphEngine(graph);

    engine.execute(parseCypher('CREATE (n:User {name: "Charlie"}) RETURN n'));

    const results = engine.execute(parseCypher('MATCH (u:User) RETURN u.name'));
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(['Alice', 'Charlie']);
  });

  it('supports SET mutation via GraphEngine', () => {
    const graph = createGraph(sampleGraph);
    const engine = new GraphEngine(graph);

    engine.execute(parseCypher('MATCH (u:User {name: "Alice"}) SET u.age = 31 RETURN u'));

    const results = engine.execute(parseCypher('MATCH (u:User {name: "Alice"}) RETURN u.age'));
    expect(results).toEqual([{ age: 31 }]);
  });

  it('supports REMOVE mutation via GraphEngine', () => {
    const graph = createGraph(sampleGraph);
    const engine = new GraphEngine(graph);

    engine.execute(parseCypher('MATCH (u:User {name: "Alice"}) REMOVE u:User'));

    // Alice should no longer match :User
    const results = engine.execute(parseCypher('MATCH (u:User {name: "Alice"}) RETURN u.name'));
    expect(results).toEqual([]);

    // But the node still exists (just without the label)
    const allResults = engine.execute(parseCypher('MATCH (u {name: "Alice"}) RETURN u.name'));
    expect(allResults).toEqual([{ name: 'Alice' }]);
  });

  it('supports mutation followed by query via executeQuery', () => {
    const graph = createGraph(sampleGraph);
    const engine = new GraphEngine(graph);

    engine.execute(parseCypher('CREATE (n:User {name: "Diana", age: 28})'));

    const count = engine.execute(parseCypher('MATCH (u:User) RETURN count(u)'));
    expect(count).toEqual([{ 'COUNT(u)': 4 }]);
  });
});

describe('buildGraphIndexes from GraphInstance', () => {
  it('builds indexes from an existing Graph instance', () => {
    const graph = new Graph();
    graph.addNode('alice', { label: 'User', name: 'Alice', age: 30 });
    graph.addNode('bob', { label: 'User', name: 'Bob', age: 25 });
    graph.addEdge('alice', 'bob', { type: 'FRIEND' });

    const indexes = buildGraphIndexes(graph);

    // Label index works
    expect(indexes.labelIndex.get('User')?.size).toBe(2);
    // Property index works
    expect(indexes.propertyIndex.get('name')?.get('Alice')?.size).toBe(1);
    // Edge type index works
    expect(indexes.edgeTypeIndex.out.get('FRIEND')?.get('alice')?.length).toBe(1);
  });

  it('works with GraphEngine for indexed queries', () => {
    const graph = new Graph();
    graph.addNode('alice', { label: 'User', name: 'Alice', age: 30 });
    graph.addNode('bob', { label: 'User', name: 'Bob', age: 25 });
    graph.addNode('charlie', { label: 'User', name: 'Charlie', age: 35 });
    graph.addEdge('alice', 'bob', { type: 'FRIEND' });
    graph.addEdge('bob', 'charlie', { type: 'FRIEND' });

    const indexes = buildGraphIndexes(graph);
    const engine = new GraphEngine(graph, indexes);

    const results = engine.execute(parseCypher('MATCH (u:User) RETURN u.name'));
    expect(results.length).toBe(3);

    const traversal = engine.execute(parseCypher('MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN b.name'));
    expect(traversal).toEqual([{ name: 'Bob' }]);
  });

  it('two-argument form still works (backward compat)', () => {
    const graph = createGraph(sampleGraph);
    const indexes = buildGraphIndexes(sampleGraph, graph);
    expect(indexes.labelIndex.get('User')?.size).toBe(3);
  });

  it('single-argument data form builds graph internally', () => {
    const indexes = buildGraphIndexes(sampleGraph);
    expect(indexes.labelIndex.get('User')?.size).toBe(3);
    expect(indexes.propertyIndex.get('name')?.get('Alice')?.size).toBe(1);
    expect(indexes.edgeTypeIndex.out.get('FRIEND')?.get('alice')?.length).toBe(1);
  });
});

describe('executeQuery with raw graphology Graph', () => {
  // Proves the library works with any external Graphology graph,
  // not just the library's own Graph wrapper.

  it('accepts a raw graphology Graph in executeQuery', () => {
    const graph = new Graphology();
    graph.addNode('alice', { label: 'User', name: 'Alice', age: 30 });
    graph.addNode('bob', { label: 'User', name: 'Bob', age: 25 });
    graph.addEdge('alice', 'bob', { type: 'FRIEND' });

    const results = executeQuery(graph as unknown as GraphInstance, 'MATCH (u:User) RETURN u.name');
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(['Alice', 'Bob']);
  });

  it('executes traversal on raw graphology Graph via GraphEngine', () => {
    const graph = new Graphology();
    graph.addNode('alice', { label: 'User', name: 'Alice' });
    graph.addNode('bob', { label: 'User', name: 'Bob' });
    graph.addNode('charlie', { label: 'User', name: 'Charlie' });
    graph.addEdge('alice', 'bob', { type: 'FRIEND' });
    graph.addEdge('bob', 'charlie', { type: 'FRIEND' });

    const indexes = buildGraphIndexes(graph as unknown as GraphInstance);
    const engine = new GraphEngine(graph as unknown as GraphInstance, indexes);

    const results = engine.execute(
      parseCypher('MATCH (a:User {name: "Alice"})-[r:FRIEND*1..2]->(b:User) RETURN b.name'),
    );
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(['Bob', 'Charlie']);
  });

  it('executes OPTIONAL MATCH on raw graphology Graph', () => {
    const graph = new Graphology();
    graph.addNode('alice', { label: 'User', name: 'Alice' });
    graph.addNode('bob', { label: 'User', name: 'Bob' });
    graph.addNode('lonely', { label: 'User', name: 'Lonely' });
    graph.addEdge('alice', 'bob', { type: 'FRIEND' });

    const results = executeQuery(
      graph as unknown as GraphInstance,
      'MATCH (u:User) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) RETURN u.name, f.name',
    );
    const rows = results
      .map((r) => [r['u.name'], r['f.name']])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(rows).toEqual([
      ['Alice', 'Bob'],
      ['Bob', null],
      ['Lonely', null],
    ]);
  });

  it('executes mutations on raw graphology Graph', () => {
    const graph = new Graphology();
    graph.addNode('alice', { label: 'User', name: 'Alice', age: 30 });

    const engine = new GraphEngine(graph as unknown as GraphInstance);
    engine.execute(parseCypher('CREATE (n:User {name: "Bob", age: 25})'));

    const results = engine.execute(parseCypher('MATCH (u:User) RETURN count(u)'));
    expect(results).toEqual([{ 'COUNT(u)': 2 }]);

    // Verify the node was actually added to the raw graphology graph
    expect(graph.hasNode('alice')).toBe(true);
    expect(graph.order).toBe(2);

    // Verify the created node has correct attributes (query by property,
    // since CREATE generates a random UUID for the node id)
    const bobResults = engine.execute(
      parseCypher('MATCH (u:User {name: "Bob"}) RETURN u.age'),
    );
    expect(bobResults).toEqual([{ age: 25 }]);
  });

  it('buildGraphIndexes(rawGraph) produces correct indexes', () => {
    const graph = new Graphology();
    graph.addNode('a', { label: 'Service', name: 'api', port: 8080 });
    graph.addNode('b', { label: 'Service', name: 'web', port: 443 });
    graph.addNode('c', { label: 'Database', name: 'postgres', port: 5432 });
    graph.addEdge('a', 'b', { type: 'CALLS' });
    graph.addEdge('a', 'c', { type: 'CONNECTS' });

    const indexes = buildGraphIndexes(graph as unknown as GraphInstance);

    expect(indexes.labelIndex.get('Service')?.size).toBe(2);
    expect(indexes.labelIndex.get('Database')?.size).toBe(1);
    expect(indexes.propertyIndex.get('name')?.get('api')?.size).toBe(1);
    expect(indexes.edgeTypeIndex.out.get('CALLS')?.get('a')?.length).toBe(1);
    expect(indexes.edgeTypeIndex.out.get('CONNECTS')?.get('a')?.length).toBe(1);
    expect(indexes.edgeTypeIndex.in.get('CALLS')?.get('b')?.length).toBe(1);
  });
});

describe('executeQuery with GraphInstance (library Graph wrapper)', () => {
  it('executes aggregation queries on Graph wrapper instance', () => {
    const graph = new Graph();
    graph.addNode('a', { label: 'Node', value: 10 });
    graph.addNode('b', { label: 'Node', value: 20 });
    graph.addNode('c', { label: 'Node', value: 30 });

    const results = executeQuery(graph, 'MATCH (n:Node) RETURN sum(n.value)');
    expect(results).toEqual([{ 'SUM(n)': 60 }]);
  });

  it('executes queries on Graphology format', () => {
    const results = executeQuery(sampleGraph, 'MATCH (u:User) RETURN count(u)');
    expect(results).toEqual([{ 'COUNT(u)': 3 }]);
  });
});

describe('type exports', () => {
  // These tests verify that all types are importable (compile-time check).
  // Runtime assertions are trivially true but ensure the imports resolve.

  it('exports Graphology format types', () => {
    const node: GraphologyNode = { key: 'a', attributes: { label: 'X' } };
    const edge: GraphologyEdge = { source: 'a', target: 'b', attributes: { type: 'LINK' } };
    const file: GraphologyFile = { nodes: [node], edges: [edge] };
    expect(file.nodes.length).toBe(1);
  });

  it('exports GraphInstance type', () => {
    const graph: GraphInstance = createGraph(sampleGraph);
    expect(graph.order).toBe(3);
  });

  it('exports AST types', () => {
    const ast: AdvancedCypherAST = parseCypher('MATCH (u:User) RETURN u');
    expect(ast.type).toBe('Query');
  });

  it('exports ResultRow type', () => {
    const results: ResultRow[] = executeQuery(sampleGraph, 'MATCH (u:User) RETURN u.name');
    expect(results.length).toBe(3);
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

  it('throws for unsupported options.allowSelfLoops', () => {
    expect(() =>
      createGraph({
        options: { type: 'directed', allowSelfLoops: true },
        nodes: [{ key: 'a', attributes: { label: 'N' } }],
        edges: [],
      }),
    ).toThrow(/Unsupported graph option:.*"allowSelfLoops"/);
  });

  it('throws for unsupported options.multi', () => {
    expect(() =>
      createGraph({
        options: { type: 'directed', multi: true },
        nodes: [{ key: 'a', attributes: { label: 'N' } }],
        edges: [],
      }),
    ).toThrow(/Unsupported graph option:.*"multi"/);
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
