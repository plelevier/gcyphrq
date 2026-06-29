import { describe, it, expect, beforeEach } from 'vitest';
import { Graph, type GraphInstance } from '../src/graph';
import { AdvancedCypherGraphologyEngine } from '../src/engine/cypher-engine';
import { parseCypher as _parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST, CypherEdge } from '../src/types/cypher';
import { buildIndexesFromGraph } from './helpers';

const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;

function createEngine(graph: GraphInstance) {
  const indexes = buildIndexesFromGraph(graph);
  return new AdvancedCypherGraphologyEngine(graph, indexes);
}

function countEdges(graph: GraphInstance): number {
  let count = 0;
  graph.forEachEdge(() => count++);
  return count;
}

function getEdgeEndpoints(graph: GraphInstance, edgeId: string): { source: string; target: string } {
  return graph.getEdgeEndpoints(edgeId);
}

// ── Parser tests ─────────────────────────────────────────────────────────────

describe('CREATE chain parser', () => {
  it('parses CREATE with relationship chain (a)-[r:TYPE]->(b)', async () => {
    const ast = parseCypher('CREATE (a:Person)-[r:KNOWS]->(b:Person) RETURN a, r, b');
    expect(ast.stages.length).toBe(1);
    expect(ast.stages[0]?.type).toBe('WRITE');
    const create = ast.stages[0]! as { type: 'WRITE'; clause: any };
    expect(create.clause.type).toBe('CREATE');
    expect(create.clause.hasChains).toBe(true);
    expect(create.clause.hops[0]?.sourcePattern.variable).toBe('a');
    expect(create.clause.hops[0]?.sourcePattern.labels?.labels).toEqual(['Person']);
    expect(create.clause.hops[0]?.relationPattern.variable).toBe('r');
    expect(create.clause.hops[0]?.relationPattern.type).toBe('KNOWS');
    expect(create.clause.hops[0]?.relationPattern.direction).toBe('OUT');
    expect(create.clause.hops[0]?.targetPattern.variable).toBe('b');
    expect(ast.return).toBeDefined();
  });

  it('parses CREATE with incoming direction (a)<-[r:TYPE]-(b)', async () => {
    const ast = parseCypher('CREATE (a:Person)<-[r:KNOWS]-(b:Person) RETURN a, b');
    const create = ast.stages[0]! as { type: 'WRITE'; clause: any };
    expect(create.clause.hops[0]?.relationPattern.direction).toBe('IN');
  });

  it('parses CREATE with undirected edge (a)-[r]-(b)', async () => {
    const ast = parseCypher('CREATE (a:Person)-[r]-(b:Person) RETURN a, b');
    const create = ast.stages[0]! as { type: 'WRITE'; clause: any };
    expect(create.clause.hops[0]?.relationPattern.direction).toBe('UNDIRECTED');
  });

  it('parses CREATE chain with inline properties', async () => {
    const ast = parseCypher('CREATE (a:Person {name: "Alice"})-[r:KNOWS {since: 2020}]->(b:Person {name: "Bob"}) RETURN a, b');
    const create = ast.stages[0]! as { type: 'WRITE'; clause: any };
    expect(create.clause.hasChains).toBe(true);
    expect(create.clause.hops[0]?.sourcePattern.properties).toEqual({ name: 'Alice' });
    expect(create.clause.hops[0]?.targetPattern.properties).toEqual({ name: 'Bob' });
    expect(create.clause.hops[0]?.edgeProperties).toEqual({ since: 2020 });
  });

  it('parses CREATE chain with MATCH prefix', async () => {
    const ast = parseCypher('MATCH (a:Person) CREATE (a)-[r:FRIEND]->(b:Person) RETURN a, r, b');
    expect(ast.stages.length).toBe(2);
    expect(ast.stages[0]?.type).toBe('MATCH');
    expect(ast.stages[1]?.type).toBe('WRITE');
  });
});

// ── Engine tests: CREATE with relationship chain ─────────────────────────────

describe('CREATE chain engine', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
  });

  it('creates both nodes and edge from scratch', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher('CREATE (a:Person)-[r:KNOWS]->(b:Person) RETURN a, r, b');
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    const a = results[0]!.a as any;
    const r = results[0]!.r as CypherEdge;
    const b = results[0]!.b as any;
    expect(a).toBeDefined();
    expect(r).toBeDefined();
    expect(r.id).toBeDefined();
    expect(b).toBeDefined();
    expect(a.id).not.toBe(b.id);
    expect(graph.order).toBe(2);
    expect(countEdges(graph)).toBe(1);
  });

  it('creates edge between existing nodes (MATCH + CREATE)', async () => {
    graph.addNode('alice', { label: 'Person', name: 'Alice' });
    graph.addNode('bob', { label: 'Person', name: 'Bob' });
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (a:Person {name: "Alice"}) MATCH (b:Person {name: "Bob"}) CREATE (a)-[r:KNOWS]->(b) RETURN r');
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    const r = results[0]!.r as CypherEdge;
    expect(r).toBeDefined();
    expect(r.id).toBeDefined();
    expect(graph.order).toBe(2);
    expect(countEdges(graph)).toBe(1);
  });

  it('creates target node when source is bound', async () => {
    graph.addNode('alice', { label: 'Person', name: 'Alice' });
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (a:Person {name: "Alice"}) CREATE (a)-[r:KNOWS]->(b:Person) RETURN b');
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    const b = results[0]!.b as any;
    expect(b).toBeDefined();
    expect(graph.order).toBe(2);
    expect(countEdges(graph)).toBe(1);
  });

  it('creates source node when target is bound', async () => {
    graph.addNode('bob', { label: 'Person', name: 'Bob' });
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (b:Person {name: "Bob"}) CREATE (a:Person)-[r:KNOWS]->(b) RETURN a');
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    const a = results[0]!.a as any;
    expect(a).toBeDefined();
    expect(graph.order).toBe(2);
    expect(countEdges(graph)).toBe(1);
  });

  it('respects incoming direction (a)<-[r]-(b)', async () => {
    graph.addNode('alice', { label: 'Person', name: 'Alice' });
    graph.addNode('bob', { label: 'Person', name: 'Bob' });
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (a:Person {name: "Alice"}) MATCH (b:Person {name: "Bob"}) CREATE (a)<-[r:KNOWS]-(b) RETURN r');
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    const r = results[0]!.r as CypherEdge;
    expect(r).toBeDefined();
    // For IN direction: edge goes from b -> a (bob -> alice)
    const endpoints = getEdgeEndpoints(graph, r.id);
    expect(endpoints.source).toBe('bob');
    expect(endpoints.target).toBe('alice');
  });

  it('creates with inline node properties', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher('CREATE (a:Person {name: "Alice"})-[r:KNOWS]->(b:Person {name: "Bob"}) RETURN a, b');
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    const a = results[0]!.a as any;
    const b = results[0]!.b as any;
    expect(a.name).toBe('Alice');
    expect(b.name).toBe('Bob');
  });

  it('creates with typed edge and returns edge type', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher('CREATE (a:Person)-[r:KNOWS]->(b:Person) RETURN r');
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    const r = results[0]!.r as CypherEdge;
    expect(r).toBeDefined();
    expect(r.id).toBeDefined();
    const edgeAttrs = graph.getEdgeAttributes(r.id);
    expect(edgeAttrs.type).toBe('KNOWS');
  });

  it('creates edge without type when no type specified', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher('CREATE (a:Person)-[r]->(b:Person) RETURN r');
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    const r = results[0]!.r as CypherEdge;
    expect(r).toBeDefined();
    const edgeId = r.id;
    const edgeAttrs = graph.getEdgeAttributes(edgeId!);
    expect(edgeAttrs.type).toBeUndefined();
  });

  it('creates edge with inline properties', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher('CREATE (a:Person)-[r:KNOWS {since: 2020, strength: "strong"}]->(b:Person) RETURN r');
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    const r = results[0]!.r as CypherEdge;
    expect(r).toBeDefined();
    const edgeId = r.id;
    const edgeAttrs = graph.getEdgeAttributes(edgeId!);
    expect(edgeAttrs.type).toBe('KNOWS');
    expect(edgeAttrs.since).toBe(2020);
    expect(edgeAttrs.strength).toBe('strong');
  });

  it('creates undirected edge (a)-[r]-(b)', async () => {
    graph.addNode('alice', { label: 'Person', name: 'Alice' });
    graph.addNode('bob', { label: 'Person', name: 'Bob' });
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (a:Person {name: "Alice"}) MATCH (b:Person {name: "Bob"}) CREATE (a)-[r:KNOWS]-(b) RETURN r');
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    const r = results[0]!.r as CypherEdge;
    expect(r).toBeDefined();
    // UNDIRECTED: stored as source (alice) → target (bob)
    const endpoints = getEdgeEndpoints(graph, r.id);
    expect(endpoints.source).toBe('alice');
    expect(endpoints.target).toBe('bob');
  });

  it('creates edge with dynamic properties via FOREACH', async () => {
    graph.addNode('alice', { label: 'Person', name: 'Alice' });
    const engine = createEngine(graph);
    // Dynamic edge properties in FOREACH: the edgePropertiesExpr path
    // is exercised when CREATE chain is inside FOREACH with loop variable refs.
    // Note: variables bound inside FOREACH are not visible outside (Neo4j semantics),
    // so we verify graph state instead of returning the edge variable.
    const ast = parseCypher(
      'MATCH (a:Person {name: "Alice"}) UNWIND [{name: "Bob"}] AS bInfo FOREACH (dummy IN [1] | CREATE (a)-[r:KNOWS {target: bInfo.name}]->(b:Person {name: bInfo.name}))',
    );
await engine.execute(ast);
    // Verify edge was created with dynamic property
    expect(countEdges(graph)).toBe(1);
    let edgeId: string | undefined;
    graph.forEachEdge((id) => { edgeId = id; });
    expect(edgeId).toBeDefined();
    const edgeAttrs = graph.getEdgeAttributes(edgeId!);
    expect(edgeAttrs.type).toBe('KNOWS');
    expect(edgeAttrs.target).toBe('Bob');
    // Verify target node was created with dynamic property
    expect(graph.order).toBe(2);
    let targetName: string | undefined;
    graph.filterNodes(() => true).forEach((id) => {
      if (id !== 'alice') targetName = (graph.getNodeAttributes(id) as any).name;
    });
    expect(targetName).toBe('Bob');
  });

  it('creates self-loop edge when source and target are the same node', async () => {
    const g = new Graph({ allowSelfLoops: true });
    g.addNode('alice', { label: 'Person', name: 'Alice' });
    const engine = createEngine(g);
    const ast = parseCypher(
      'MATCH (a:Person {name: "Alice"}) CREATE (a)-[r:SELF]->(a) RETURN r',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    expect(countEdges(g)).toBe(1);
  });

  it('creates parallel edges in multi-graph', async () => {
    const g = new Graph({ multi: true });
    g.addNode('alice', { label: 'Person', name: 'Alice' });
    g.addNode('bob', { label: 'Person', name: 'Bob' });
    g.addEdge('alice', 'bob', { type: 'KNOWS' });
    const engine = createEngine(g);
    const ast = parseCypher(
      'MATCH (a:Person {name: "Alice"}) MATCH (b:Person {name: "Bob"}) CREATE (a)-[r:FRIEND]->(b) RETURN r',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    expect(countEdges(g)).toBe(2);
  });

  it('MATCH returns all parallel edges in multi-graph', async () => {
    const g = new Graph({ multi: true });
    g.addNode('alice', { label: 'Person', name: 'Alice' });
    g.addNode('bob', { label: 'Person', name: 'Bob' });
    g.addEdge('alice', 'bob', { type: 'KNOWS' });
    g.addEdge('alice', 'bob', { type: 'FRIEND' });
    const engine = createEngine(g);
    const ast = parseCypher(
      'MATCH (a:Person {name: "Alice"})-[r]->(b:Person {name: "Bob"}) RETURN r',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(2);
  });

  it('MATCH with type filter returns matching parallel edges', async () => {
    const g = new Graph({ multi: true });
    g.addNode('alice', { label: 'Person', name: 'Alice' });
    g.addNode('bob', { label: 'Person', name: 'Bob' });
    g.addEdge('alice', 'bob', { type: 'KNOWS' });
    g.addEdge('alice', 'bob', { type: 'KNOWS' });
    g.addEdge('alice', 'bob', { type: 'FRIEND' });
    const engine = createEngine(g);
    const ast = parseCypher(
      'MATCH (a:Person {name: "Alice"})-[r:KNOWS]->(b:Person {name: "Bob"}) RETURN r',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(2);
  });

  it('MERGE matches existing edge instead of creating duplicate in multi-graph', async () => {
    const g = new Graph({ multi: true });
    g.addNode('alice', { label: 'Person', name: 'Alice' });
    g.addNode('bob', { label: 'Person', name: 'Bob' });
    g.addEdge('alice', 'bob', { type: 'KNOWS' });
    const engine = createEngine(g);
    const ast = parseCypher(
      'MERGE (a:Person {name: "Alice"})-[r:KNOWS]->(b:Person {name: "Bob"}) RETURN r',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    // MERGE should match the existing edge, not create a new one
    expect(countEdges(g)).toBe(1);
  });

  it('MERGE creates new edge when no matching type exists in multi-graph', async () => {
    const g = new Graph({ multi: true });
    g.addNode('alice', { label: 'Person', name: 'Alice' });
    g.addNode('bob', { label: 'Person', name: 'Bob' });
    g.addEdge('alice', 'bob', { type: 'KNOWS' });
    const engine = createEngine(g);
    const ast = parseCypher(
      'MERGE (a:Person {name: "Alice"})-[r:FRIEND]->(b:Person {name: "Bob"}) RETURN r',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    // MERGE should create a new FRIEND edge alongside the existing KNOWS edge
    expect(countEdges(g)).toBe(2);
  });

  it('DELETE removes a specific edge by ID in multi-graph', async () => {
    const g = new Graph({ multi: true });
    g.addNode('alice', { label: 'Person', name: 'Alice' });
    g.addNode('bob', { label: 'Person', name: 'Bob' });
    g.addEdge('alice', 'bob', { type: 'KNOWS' });
    g.addEdge('alice', 'bob', { type: 'FRIEND' });
    const engine = createEngine(g);
    const ast = parseCypher(
      'MATCH (a:Person {name: "Alice"})-[r:KNOWS]->(b:Person {name: "Bob"}) DELETE r RETURN a.name, b.name',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    // One KNOWS edge deleted, FRIEND edge remains
    expect(countEdges(g)).toBe(1);
    let remainingEdgeId: string | undefined;
    g.forEachEdge((e) => { remainingEdgeId = e; });
    expect(remainingEdgeId).toBeDefined();
    expect(g.getEdgeAttributes(remainingEdgeId!).type).toBe('FRIEND');
  });

  it('DELETE removes all matching parallel edges', async () => {
    const g = new Graph({ multi: true });
    g.addNode('alice', { label: 'Person', name: 'Alice' });
    g.addNode('bob', { label: 'Person', name: 'Bob' });
    g.addEdge('alice', 'bob', { type: 'KNOWS' });
    g.addEdge('alice', 'bob', { type: 'KNOWS' });
    g.addEdge('alice', 'bob', { type: 'FRIEND' });
    const engine = createEngine(g);
    const ast = parseCypher(
      'MATCH (a:Person {name: "Alice"})-[r:KNOWS]->(b:Person {name: "Bob"}) DELETE r RETURN a.name',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(2); // two KNOWS edges matched
    // Both KNOWS edges deleted, FRIEND remains
    expect(countEdges(g)).toBe(1);
  });
});
