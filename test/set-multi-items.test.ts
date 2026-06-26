import { describe, it, expect, beforeEach } from 'vitest';
import { Graph, type GraphInstance } from '../src/graph';
import { AdvancedCypherGraphologyEngine } from '../src/engine/cypher-engine';
import { parseCypher as _parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST, ForeachClause, SetClause } from '../src/types/cypher';
import { buildIndexesFromGraph } from './helpers';

const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;

function createEngine(graph: GraphInstance) {
  const indexes = buildIndexesFromGraph(graph);
  return new AdvancedCypherGraphologyEngine(graph, indexes);
}

// ── Parser tests ─────────────────────────────────────────────────────────────

describe('SET multi-items parser', () => {
  it('parses SET with label only', () => {
    const ast = parseCypher('MATCH (n) SET n:Label RETURN n');
    const clause = (ast.stages[1]! as { type: 'WRITE'; clause: SetClause }).clause;
    expect(clause.type).toBe('SET');
    expect(clause.items.length).toBe(1);
    expect(clause.items[0]?.variable).toBe('n');
    expect(clause.items[0]?.labels).toEqual(['Label']);
    expect(clause.items[0]?.property).toBeUndefined();
  });

  it('parses SET with property only', () => {
    const ast = parseCypher('MATCH (n) SET n.prop = val RETURN n');
    const clause = (ast.stages[1]! as { type: 'WRITE'; clause: SetClause }).clause;
    expect(clause.type).toBe('SET');
    expect(clause.items.length).toBe(1);
    expect(clause.items[0]?.variable).toBe('n');
    expect(clause.items[0]?.property).toBe('prop');
    expect(clause.items[0]?.value?.type).toBe('PropertyAccess');
    expect(clause.items[0]?.labels).toBeUndefined();
  });

  it('parses SET with label + property', () => {
    const ast = parseCypher('MATCH (n) SET n:Label, n.prop = val RETURN n');
    const clause = (ast.stages[1]! as { type: 'WRITE'; clause: SetClause }).clause;
    expect(clause.type).toBe('SET');
    expect(clause.items.length).toBe(2);
    expect(clause.items[0]?.labels).toEqual(['Label']);
    expect(clause.items[1]?.property).toBe('prop');
  });

  it('parses SET with property + label (reversed)', () => {
    const ast = parseCypher('MATCH (n) SET n.prop = val, n:Label RETURN n');
    const clause = (ast.stages[1]! as { type: 'WRITE'; clause: SetClause }).clause;
    expect(clause.type).toBe('SET');
    expect(clause.items.length).toBe(2);
    expect(clause.items[0]?.property).toBe('prop');
    expect(clause.items[1]?.labels).toEqual(['Label']);
  });

  it('parses SET with multiple properties', () => {
    const ast = parseCypher('MATCH (n) SET n.prop1 = val1, n.prop2 = val2 RETURN n');
    const clause = (ast.stages[1]! as { type: 'WRITE'; clause: SetClause }).clause;
    expect(clause.type).toBe('SET');
    expect(clause.items.length).toBe(2);
    expect(clause.items[0]?.property).toBe('prop1');
    expect(clause.items[1]?.property).toBe('prop2');
  });

  it('parses SET with label + multiple properties', () => {
    const ast = parseCypher('MATCH (n) SET n:Label, n.prop1 = val1, n.prop2 = val2 RETURN n');
    const clause = (ast.stages[1]! as { type: 'WRITE'; clause: SetClause }).clause;
    expect(clause.type).toBe('SET');
    expect(clause.items.length).toBe(3);
    expect(clause.items[0]?.labels).toEqual(['Label']);
    expect(clause.items[1]?.property).toBe('prop1');
    expect(clause.items[2]?.property).toBe('prop2');
  });

  it('parses SET with multiple labels', () => {
    const ast = parseCypher('MATCH (n) SET n:Label1:Label2 RETURN n');
    const clause = (ast.stages[1]! as { type: 'WRITE'; clause: SetClause }).clause;
    expect(clause.type).toBe('SET');
    expect(clause.items.length).toBe(1);
    expect(clause.items[0]?.labels).toEqual(['Label1', 'Label2']);
  });
});

// ── Engine tests: SET multi-items ────────────────────────────────────────────

describe('SET multi-items engine', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('n1', { label: 'Node', name: 'Alice' });
  });

  it('sets label and property in one SET', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (n:Node) SET n:NewLabel, n.active = true RETURN n.name AS name');
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs = graph.getNodeAttributes('n1');
    expect(Array.isArray(attrs.label)).toBe(true);
    expect(attrs.label).toContain('NewLabel');
    expect(attrs.active).toBe(true);
  });

  it('sets property and label in reversed order', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (n:Node) SET n.active = true, n:NewLabel RETURN n.name AS name');
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs = graph.getNodeAttributes('n1');
    expect(Array.isArray(attrs.label)).toBe(true);
    expect(attrs.label).toContain('NewLabel');
    expect(attrs.active).toBe(true);
  });

  it('sets multiple properties', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (n:Node) SET n.active = true, n.count = 5, n.status = "done" RETURN n.name AS name');
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs = graph.getNodeAttributes('n1');
    expect(attrs.active).toBe(true);
    expect(attrs.count).toBe(5);
    expect(attrs.status).toBe('done');
  });

  it('sets label + multiple properties', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (n:Node) SET n:NewLabel, n.active = true, n.count = 5 RETURN n.name AS name');
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs = graph.getNodeAttributes('n1');
    expect(Array.isArray(attrs.label)).toBe(true);
    expect(attrs.label).toContain('NewLabel');
    expect(attrs.active).toBe(true);
    expect(attrs.count).toBe(5);
  });

  it('sets multiple labels', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (n:Node) SET n:Label1:Label2 RETURN n.name AS name');
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs = graph.getNodeAttributes('n1');
    expect(Array.isArray(attrs.label)).toBe(true);
    expect(attrs.label).toContain('Label1');
    expect(attrs.label).toContain('Label2');
  });

  it('sets on different variables via chained MATCH', () => {
    graph.addNode('n2', { label: 'Node', name: 'Bob' });
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:Node {name: "Alice"}) MATCH (b:Node {name: "Bob"}) ' +
      'SET a:First, b:Second, a.active = true, b.active = false ' +
      'RETURN a.name AS aName, b.name AS bName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs1 = graph.getNodeAttributes('n1');
    const attrs2 = graph.getNodeAttributes('n2');
    expect(Array.isArray(attrs1.label)).toBe(true);
    expect(attrs1.label).toContain('First');
    expect(attrs1.active).toBe(true);
    expect(Array.isArray(attrs2.label)).toBe(true);
    expect(attrs2.label).toContain('Second');
    expect(attrs2.active).toBe(false);
  });
});

// ── Engine tests: FOREACH with SET multi-items ───────────────────────────────

describe('FOREACH with SET multi-items', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice' });
    graph.addNode('i1', { label: 'Item', name: 'first' });
    graph.addNode('i2', { label: 'Item', name: 'second' });
    graph.setNodeAttribute('u1', 'items', [
      { id: 'i1', label: 'Item', name: 'first' },
      { id: 'i2', label: 'Item', name: 'second' },
    ]);
  });

  it('FOREACH SET label + property', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x:Processed, x.reviewed = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs1 = graph.getNodeAttributes('i1');
    const attrs2 = graph.getNodeAttributes('i2');
    expect(Array.isArray(attrs1.label)).toBe(true);
    expect(attrs1.label).toContain('Processed');
    expect(attrs1.reviewed).toBe(true);
    expect(Array.isArray(attrs2.label)).toBe(true);
    expect(attrs2.label).toContain('Processed');
    expect(attrs2.reviewed).toBe(true);
  });

  it('FOREACH SET property + label (reversed)', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x.reviewed = true, x:Processed) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs1 = graph.getNodeAttributes('i1');
    expect(Array.isArray(attrs1.label)).toBe(true);
    expect(attrs1.label).toContain('Processed');
    expect(attrs1.reviewed).toBe(true);
  });

  it('FOREACH SET label + multiple properties', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x:Processed, x.reviewed = true, x.count = 10) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs1 = graph.getNodeAttributes('i1');
    expect(Array.isArray(attrs1.label)).toBe(true);
    expect(attrs1.label).toContain('Processed');
    expect(attrs1.reviewed).toBe(true);
    expect(attrs1.count).toBe(10);
  });

  it('FOREACH SET label on collected nodes via WITH', () => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice' });
    graph.addNode('i1', { label: 'Item', name: 'first' });
    graph.addNode('i2', { label: 'Item', name: 'second' });
    graph.addEdge('u1', 'i1', { type: 'HAS' });
    graph.addEdge('u1', 'i2', { type: 'HAS' });

    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User)-[:HAS]->(i:Item) ' +
      'WITH u, collect(i) AS items ' +
      'FOREACH (x IN items | SET x:Processed, x.reviewed = true) ' +
      'RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs1 = graph.getNodeAttributes('i1');
    const attrs2 = graph.getNodeAttributes('i2');
    expect(Array.isArray(attrs1.label)).toBe(true);
    expect(attrs1.label).toContain('Processed');
    expect(attrs1.reviewed).toBe(true);
    expect(Array.isArray(attrs2.label)).toBe(true);
    expect(attrs2.label).toContain('Processed');
    expect(attrs2.reviewed).toBe(true);
  });

  it('FOREACH SET on relationship objects', () => {
    graph = new Graph();
    graph.addNode('a', { label: 'A', name: 'Alice' });
    graph.addNode('b', { label: 'B', name: 'Bob' });
    graph.addEdgeWithKey('r1', 'a', 'b', { type: 'KNOWS', since: 2020 });
    graph.setNodeAttribute('a', 'rels', [
      { id: 'r1', type: 'KNOWS', since: 2020 },
    ]);

    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | SET r.active = true, r.updated = true) RETURN a.name AS name',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const edgeAttrs = graph.getEdgeAttributes('r1');
    expect(edgeAttrs.active).toBe(true);
    expect(edgeAttrs.updated).toBe(true);
  });

  it('FOREACH with empty list (no-op)', () => {
    graph.setNodeAttribute('u1', 'items', []);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x:Processed, x.reviewed = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    // Labels should not be modified
    const attrs1 = graph.getNodeAttributes('i1');
    expect(attrs1.label).toBe('Item');
  });

  it('FOREACH with null list (no-op)', () => {
    graph.setNodeAttribute('u1', 'items', null);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x:Processed, x.reviewed = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('FOREACH preserves row count (not expanded like UNWIND)', () => {
    graph.addNode('u2', { label: 'User', name: 'Bob', items: ['a', 'b', 'c'] });
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x.marked = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    // 2 input rows → 2 output rows
    expect(results.length).toBe(2);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('SET multi-items edge cases', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('n1', { label: 'Node', name: 'Alice' });
  });

  it('SET with duplicate label (idempotent)', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (n:Node) SET n:Node, n.active = true RETURN n.name AS name');
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs = graph.getNodeAttributes('n1');
    // 'Node' should appear only once (stored as string since it's the only label)
    expect(attrs.label).toBe('Node');
    expect(attrs.active).toBe(true);
  });

  it('SET with dynamic value expression', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (n:Node) SET n:NewLabel, n.doubled = n.name * 2 RETURN n.name AS name');
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs = graph.getNodeAttributes('n1');
    expect(Array.isArray(attrs.label)).toBe(true);
    expect(attrs.label).toContain('NewLabel');
    // name is "Alice" (string), so * 2 should be null or NaN
  });

  it('SET with literal value', () => {
    const engine = createEngine(graph);
    const ast = parseCypher("MATCH (n:Node) SET n:NewLabel, n.count = 42, n.status = 'active' RETURN n.name AS name");
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    const attrs = graph.getNodeAttributes('n1');
    expect(attrs.count).toBe(42);
    expect(attrs.status).toBe('active');
  });

  it('SET on non-existent node (no-op, no crash)', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('MATCH (n:NonExistent) SET n:NewLabel, n.active = true RETURN n');
    const results = engine.execute(ast);
    expect(results.length).toBe(0);
  });
});
