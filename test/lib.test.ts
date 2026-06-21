import { describe, it, expect } from 'vitest';
import {
  executeQuery,
  createGraph,
  parseCypher,
  GraphEngine,
  Graph,
  GraphError,
  buildGraphIndexes,
} from '../src/lib';
import type {
  GraphFile,
  GraphFileNode,
  GraphFileEdge,
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

const sampleGraph: GraphFile = {
  nodes: [
    { id: 'alice', label: 'User', name: 'Alice', age: 30 },
    { id: 'bob', label: 'User', name: 'Bob', age: 25 },
    { id: 'charlie', label: 'User', name: 'Charlie', age: 35 },
  ],
  edges: [
    { source: 'alice', target: 'bob', type: 'FRIEND' },
    { source: 'bob', target: 'charlie', type: 'FRIEND' },
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
    expect(() => executeQuery({ nodes: [{ id: '' }], edges: [] }, 'MATCH (n) RETURN n')).toThrow(GraphError);
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
    expect(() => createGraph({ edges: [] } as unknown as GraphFile)).toThrow(GraphError);
  });

  it('throws GraphError for duplicate node ids', () => {
    expect(() => createGraph({
      nodes: [{ id: 'a', label: 'X' }, { id: 'a', label: 'Y' }],
      edges: [],
    })).toThrow(GraphError);
  });

  it('throws GraphError for edge referencing unknown node', () => {
    expect(() => createGraph({
      nodes: [{ id: 'a', label: 'X' }],
      edges: [{ source: 'a', target: 'unknown' }],
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
    expect(clause.clause.sourcePattern.label).toBe('User');
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
    expect(() => createGraph({ nodes: [{}], edges: [] } as unknown as GraphFile)).toThrow(GraphError);
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

describe('executeQuery with GraphInstance', () => {
  it('accepts an existing Graph instance instead of GraphFile data', () => {
    const graph = new Graph();
    graph.addNode('alice', { label: 'User', name: 'Alice', age: 30 });
    graph.addNode('bob', { label: 'User', name: 'Bob', age: 25 });
    graph.addEdge('alice', 'bob', { type: 'FRIEND' });

    const results = executeQuery(graph, 'MATCH (u:User) RETURN u.name');
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(['Alice', 'Bob']);
  });

  it('executes traversal queries on existing graph instance', () => {
    const graph = new Graph();
    graph.addNode('alice', { label: 'User', name: 'Alice' });
    graph.addNode('bob', { label: 'User', name: 'Bob' });
    graph.addNode('charlie', { label: 'User', name: 'Charlie' });
    graph.addEdge('alice', 'bob', { type: 'FRIEND' });
    graph.addEdge('bob', 'charlie', { type: 'FRIEND' });

    const results = executeQuery(graph, 'MATCH (a:User {name: "Alice"})-[r:FRIEND*1..2]->(b:User) RETURN b.name');
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(['Bob', 'Charlie']);
  });

  it('executes aggregation queries on existing graph instance', () => {
    const graph = new Graph();
    graph.addNode('a', { label: 'Node', value: 10 });
    graph.addNode('b', { label: 'Node', value: 20 });
    graph.addNode('c', { label: 'Node', value: 30 });

    const results = executeQuery(graph, 'MATCH (n:Node) RETURN sum(n.value)');
    expect(results).toEqual([{ 'SUM(n)': 60 }]);
  });

  it('original GraphFile overload still works (backward compat)', () => {
    const results = executeQuery(sampleGraph, 'MATCH (u:User) RETURN count(u)');
    expect(results).toEqual([{ 'COUNT(u)': 3 }]);
  });
});

describe('type exports', () => {
  // These tests verify that all types are importable (compile-time check).
  // Runtime assertions are trivially true but ensure the imports resolve.

  it('exports GraphFile types', () => {
    const node: GraphFileNode = { id: 'a' };
    const edge: GraphFileEdge = { source: 'a', target: 'b' };
    const file: GraphFile = { nodes: [node], edges: [edge] };
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
