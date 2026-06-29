import { describe, it, expect, beforeEach } from 'vitest';
import { Graph, type GraphInstance } from '../src/graph';
import { AdvancedCypherGraphologyEngine } from '../src/engine/cypher-engine';
import { parseCypher as _parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST, ForeachClause } from '../src/types/cypher';
import { buildIndexesFromGraph, node } from './helpers';

const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;

function createEngine(graph: GraphInstance) {
  const indexes = buildIndexesFromGraph(graph);
  return new AdvancedCypherGraphologyEngine(graph, indexes);
}

// ── Parser tests ─────────────────────────────────────────────────────────────

describe('FOREACH parser', () => {
  it('parses FOREACH with SET property', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.tags | SET x.active = true) RETURN n');
    expect(ast.stages.length).toBe(2);
    expect(ast.stages[0]?.type).toBe('MATCH');
    expect(ast.stages[1]?.type).toBe('FOREACH');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.variable).toBe('x');
    expect(clause.expression.type).toBe('PropertyAccess');
    if (clause.expression.type === 'PropertyAccess') {
      expect(clause.expression.variable).toBe('n');
      expect(clause.expression.property).toBe('tags');
    }
    expect(clause.innerClauses.length).toBe(1);
    expect(clause.innerClauses[0]?.type).toBe('SET');
    if (clause.innerClauses[0]?.type === 'SET') {
      expect(clause.innerClauses[0].items[0]?.variable).toBe('x');
      expect(clause.innerClauses[0].items[0]?.property).toBe('active');
    }
  });

  it('parses FOREACH with SET label', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.tags | SET x:Tag) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClauses[0]?.type).toBe('SET');
    if (clause.innerClauses[0]?.type === 'SET') {
      expect(clause.innerClauses[0].items[0]?.labels).toEqual(['Tag']);
    }
  });

  it('parses FOREACH with CREATE', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.tags | CREATE (t:Tag {name: x})) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClauses[0]?.type).toBe('CREATE');
    if (clause.innerClauses[0]?.type === 'CREATE') {
      expect(clause.innerClauses[0].hops[0]?.sourcePattern.variable).toBe('t');
      expect(clause.innerClauses[0].hops[0]?.sourcePattern.labels?.labels).toEqual(['Tag']);
      expect(clause.innerClauses[0].hops[0]?.sourcePattern.propertiesExpr).toBeDefined();
      expect(clause.innerClauses[0].hops[0]?.sourcePattern.propertiesExpr?.['name']).toBeDefined();
    }
  });

  it('parses FOREACH with DELETE', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.tags | DELETE x) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClauses[0]?.type).toBe('DELETE');
    if (clause.innerClauses[0]?.type === 'DELETE') {
      expect(clause.innerClauses[0].variables).toEqual(['x']);
    }
  });

  it('parses FOREACH with REMOVE property', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items | REMOVE x.temp) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClauses[0]?.type).toBe('REMOVE');
    if (clause.innerClauses[0]?.type === 'REMOVE') {
      expect(clause.innerClauses[0].items[0]?.variable).toBe('x');
      expect(clause.innerClauses[0].items[0]?.property).toBe('temp');
    }
  });

  it('parses FOREACH with REMOVE label', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items | REMOVE x:Temp) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClauses[0]?.type).toBe('REMOVE');
    if (clause.innerClauses[0]?.type === 'REMOVE') {
      expect(clause.innerClauses[0].items[0]?.variable).toBe('x');
      expect(clause.innerClauses[0].items[0]?.labels).toEqual(['Temp']);
    }
  });
});

// ── Engine tests: FOREACH with SET property ──────────────────────────────────

describe('FOREACH engine: SET property', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice', tags: ['a', 'b', 'c'] });
    graph.addNode('a', { label: 'Item', value: 1 });
    graph.addNode('b', { label: 'Item', value: 2 });
    graph.addNode('c', { label: 'Item', value: 3 });
  });

  it('sets property on each element of a list', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    // Only 1 row (FOREACH does not expand rows)
    expect(results.length).toBe(1);
    expect(results[0]?.['userName']).toBe('Alice');
  });

  it('does not expand rows (unlike UNWIND)', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['u']).toBeDefined();
  });

  it('handles empty list (no-op)', async () => {
    graph.setNodeAttribute('u1', 'tags', []);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['userName']).toBe('Alice');
  });

  it('handles null list (no-op)', async () => {
    graph.setNodeAttribute('u1', 'tags', null);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['userName']).toBe('Alice');
  });

  it('handles missing list property (no-op)', async () => {
    graph.setNodeAttribute('u1', 'tags', undefined);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('works with literal list', async () => {
    graph.addNode('x1', { label: 'Item', name: 'first' });
    graph.addNode('x2', { label: 'Item', name: 'second' });
    // Using a list of strings
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (s IN ["hello", "world"] | SET s.marked = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });
});

// ── Engine tests: FOREACH with SET label ─────────────────────────────────────

describe('FOREACH engine: SET label', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice', tags: ['a', 'b'] });
    graph.addNode('a', { label: 'Item', value: 1 });
    graph.addNode('b', { label: 'Item', value: 2 });
  });

  it('adds label to each element', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x:Tagged) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['userName']).toBe('Alice');
  });

  it('SET label on strings (no-op on non-node values, no crash)', async () => {
    const engine = createEngine(graph);
    // When tags are strings, SET x:Tagged won't find nodes, but shouldn't crash
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x:Tagged) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });
});

// ── Engine tests: FOREACH with CREATE ────────────────────────────────────────

describe('FOREACH engine: CREATE', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice', tags: ['a', 'b', 'c'] });
  });

  it('creates a node for each element with dynamic property', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | CREATE (t:Tag {name: x})) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['userName']).toBe('Alice');

    // Verify 3 new Tag nodes were created
    const allNodes = graph.filterNodes(() => true);
    const tagNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return attrs.label === 'Tag';
    });
    expect(tagNodes.length).toBe(3);

    // Verify each tag has the correct name
    const names = tagNodes.map((id) => graph.getNodeAttributes(id).name).sort();
    expect(names).toEqual(['a', 'b', 'c']);
  });

  it('creates nodes with static labels and dynamic properties', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | CREATE (t:Tag:Active {name: x, source: "FOREACH"})) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    const allNodes = graph.filterNodes(() => true);
    const tagNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return Array.isArray(attrs.label) && attrs.label.includes('Tag');
    });
    expect(tagNodes.length).toBe(3);

    // Check that dynamic and static properties are both set
    for (const id of tagNodes) {
      const attrs = graph.getNodeAttributes(id);
      expect(attrs.source).toBe('FOREACH');
    }
  });

  it('creates nodes from a literal list', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN [1, 2, 3] | CREATE (n:Number {value: x})) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    const allNodes = graph.filterNodes(() => true);
    const numberNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return attrs.label === 'Number';
    });
    expect(numberNodes.length).toBe(3);
  });

  it('creates no nodes when list is null (no-op)', async () => {
    graph.setNodeAttribute('u1', 'tags', null);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | CREATE (t:Tag {name: x})) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    const allNodes = graph.filterNodes(() => true);
    const tagNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return attrs.label === 'Tag';
    });
    expect(tagNodes.length).toBe(0);
  });
});

// ── Engine tests: FOREACH with DELETE ────────────────────────────────────────

describe('FOREACH engine: DELETE', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice' });
    graph.addNode('t1', { label: 'Todo', text: 'task1', done: false });
    graph.addNode('t2', { label: 'Todo', text: 'task2', done: true });
    graph.addNode('t3', { label: 'Todo', text: 'task3', done: true });
    graph.setNodeAttribute('u1', 'todos', [
      { id: 't1', text: 'task1' },
      { id: 't2', text: 'task2' },
    ]);
  });

  it('deletes nodes referenced in the list', async () => {
    // Simple case: list of node references
    graph.setNodeAttribute('u1', 'todos', ['t2', 't3']);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (tid IN u.todos | DELETE tid) RETURN u.name AS userName',
    );
    // This won't actually delete because 't2'/'t3' are strings, not node objects
    // But the query should not crash
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });
});

// ── Engine tests: FOREACH with REMOVE ────────────────────────────────────────

describe('FOREACH engine: REMOVE', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice' });
    graph.addNode('t1', { label: 'Item', name: 'item1', temp: true });
    graph.addNode('t2', { label: 'Item', name: 'item2', temp: true });
    graph.setNodeAttribute('u1', 'items', ['t1', 't2']);
  });

  it('removes property from each element in list', async () => {
    graph.setNodeAttribute('u1', 'items', ['t1', 't2']);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | REMOVE x.temp) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('removes label from each element in list', async () => {
    graph.setNodeAttribute('u1', 'items', ['t1', 't2']);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | REMOVE x:Item) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });
});

// ── Engine tests: FOREACH with node lists ────────────────────────────────────

describe('FOREACH engine: node lists', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice' });
    graph.addNode('p1', { label: 'Project', name: 'Alpha', status: 'active' });
    graph.addNode('p2', { label: 'Project', name: 'Beta', status: 'active' });
    graph.addNode('p3', { label: 'Project', name: 'Gamma', status: 'inactive' });
  });

  it('FOREACH with SET property on a literal list of strings', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (s IN ["a", "b"] | SET s.marked = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('FOREACH with UNWIND + SET for node iteration', async () => {
    // Use UNWIND to get nodes into a variable, then FOREACH for mutation
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (p IN ["p1", "p2"] | SET p.reviewed = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });
});

// ── Integration tests: FOREACH in multi-stage queries ────────────────────────

describe('FOREACH integration', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice', tags: ['js', 'ts'] });
    graph.addNode('u2', { label: 'User', name: 'Bob', tags: ['py'] });
    graph.addNode('t1', { label: 'Tag', name: 'js' });
    graph.addNode('t2', { label: 'Tag', name: 'ts' });
    graph.addEdge('u1', 't1', { type: 'HAS_TAG' });
    graph.addEdge('u1', 't2', { type: 'HAS_TAG' });
  });

  it('FOREACH followed by RETURN', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (t IN u.tags | SET t.marked = true) RETURN u.name AS userName, u.tags AS userTags',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(2); // 2 users
    const names = results.map((r) => r['userName']).sort();
    expect(names).toEqual(['Alice', 'Bob']);
  });

  it('FOREACH followed by MATCH (uses updated graph)', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User {name: "Alice"}) FOREACH (t IN u.tags | CREATE (n:TagNode {name: t})) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify new nodes were created
    const allNodes = graph.filterNodes(() => true);
    const tagNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return attrs.label === 'TagNode';
    });
    expect(tagNodes.length).toBe(2);
  });

  it('FOREACH with CREATE, then MATCH new nodes', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User {name: "Alice"}) ' +
      'FOREACH (t IN u.tags | CREATE (n:Created {name: t})) ' +
      'MATCH (c:Created) RETURN c.name AS cname',
    );
    const results = await engine.execute(ast);
    const names = results.map((r) => r['cname']).sort();
    expect(names).toEqual(['js', 'ts']);
  });

  it('multiple FOREACH stages', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User {name: "Alice"}) ' +
      'FOREACH (t IN u.tags | CREATE (n:TagA {name: t})) ' +
      'FOREACH (t IN ["extra"] | CREATE (n:TagB {name: t})) ' +
      'RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    const allNodes = graph.filterNodes(() => true);
    const tagA = allNodes.filter((id) => graph.getNodeAttributes(id).label === 'TagA');
    const tagB = allNodes.filter((id) => graph.getNodeAttributes(id).label === 'TagB');
    expect(tagA.length).toBe(2);
    expect(tagB.length).toBe(1);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('FOREACH edge cases', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice' });
  });

  it('FOREACH on non-existent property (no-op)', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.nonexistent | SET x.marked = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('FOREACH with empty list (no-op)', async () => {
    graph.setNodeAttribute('u1', 'tags', []);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | CREATE (n:Tag {name: x})) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('FOREACH preserves row count with multiple input rows', async () => {
    graph.addNode('u2', { label: 'User', name: 'Bob', tags: ['a', 'b', 'c', 'd', 'e'] });
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (t IN u.tags | SET t.processed = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    // 2 input rows → 2 output rows (not 2 + 5 = 7 like UNWIND)
    expect(results.length).toBe(2);
  });

  it('FOREACH with CREATE using loop variable in expression', async () => {
    graph.setNodeAttribute('u1', 'values', [10, 20, 30]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (v IN u.values | CREATE (n:Number {value: v, doubled: v * 2})) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    const allNodes = graph.filterNodes(() => true);
    const numberNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return attrs.label === 'Number';
    });
    expect(numberNodes.length).toBe(3);

    // Check doubled values
    const doubledValues = numberNodes
      .map((id) => graph.getNodeAttributes(id).doubled as number)
      .sort((a, b) => a - b);
    expect(doubledValues).toEqual([20, 40, 60]);
  });
});

// ── Engine tests: FOREACH with node objects in lists ─────────────────────────

describe('FOREACH engine: node objects in lists', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice' });
    graph.addNode('i1', { label: 'Item', name: 'first' });
    graph.addNode('i2', { label: 'Item', name: 'second' });
  });

  it('SET label on node objects stored in a list', async () => {
    // Store actual node objects (with id) in the list
    graph.setNodeAttribute('u1', 'items', [
      { id: 'i1', label: 'Item', name: 'first' },
      { id: 'i2', label: 'Item', name: 'second' },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x:Processed) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify labels were added
    const attrs1 = graph.getNodeAttributes('i1');
    const attrs2 = graph.getNodeAttributes('i2');
    expect(Array.isArray(attrs1.label)).toBe(true);
    expect(attrs1.label).toContain('Processed');
    expect(attrs2.label).toContain('Processed');
  });

  it('SET property on node objects stored in a list', async () => {
    graph.setNodeAttribute('u1', 'items', [
      { id: 'i1', label: 'Item', name: 'first' },
      { id: 'i2', label: 'Item', name: 'second' },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x.reviewed = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify properties were set
    expect(graph.getNodeAttributes('i1').reviewed).toBe(true);
    expect(graph.getNodeAttributes('i2').reviewed).toBe(true);
  });

  it('SET both label and property in separate FOREACH stages', async () => {
    graph.setNodeAttribute('u1', 'items', [
      { id: 'i1', label: 'Item', name: 'first' },
      { id: 'i2', label: 'Item', name: 'second' },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) ' +
      'FOREACH (x IN u.items | SET x:Processed) ' +
      'FOREACH (x IN u.items | SET x.reviewed = true) ' +
      'RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    const attrs1 = graph.getNodeAttributes('i1');
    expect(attrs1.label).toContain('Processed');
    expect(attrs1.reviewed).toBe(true);
  });

  it('DELETE node objects stored in a list', async () => {
    graph.setNodeAttribute('u1', 'items', [
      { id: 'i1', label: 'Item', name: 'first' },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | DELETE x) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify node was deleted
    expect(graph.hasNode('i1')).toBe(false);
  });
});

// ── Engine tests: FOREACH with relationship objects in lists ─────────────────

describe('FOREACH engine: relationship objects in lists', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('a', { label: 'A', name: 'Alice' });
    graph.addNode('b', { label: 'B', name: 'Bob' });
    graph.addNode('c', { label: 'C', name: 'Charlie' });
    graph.addEdgeWithKey('r1', 'a', 'b', { type: 'KNOWS', since: 2020 });
    graph.addEdgeWithKey('r2', 'a', 'c', { type: 'KNOWS', since: 2021 });
  });

  it('SET property on relationship objects stored in a list', async () => {
    graph.setNodeAttribute('a', 'rels', [
      { id: 'r1', type: 'KNOWS', since: 2020 },
      { id: 'r2', type: 'KNOWS', since: 2021 },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | SET r.active = true) RETURN a.name AS name',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify properties were set on edges
    expect(graph.getEdgeAttributes('r1').active).toBe(true);
    expect(graph.getEdgeAttributes('r2').active).toBe(true);
  });

  it('SET property on relationship with dynamic value', async () => {
    graph.setNodeAttribute('a', 'rels', [
      { id: 'r1', type: 'KNOWS', since: 2020 },
      { id: 'r2', type: 'KNOWS', since: 2021 },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | SET r.sinceDoubled = r.since * 2) RETURN a.name AS name',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    expect(graph.getEdgeAttributes('r1').sinceDoubled).toBe(4040);
    expect(graph.getEdgeAttributes('r2').sinceDoubled).toBe(4042);
  });

  it('DELETE relationship objects stored in a list', async () => {
    graph.setNodeAttribute('a', 'rels', [
      { id: 'r1', type: 'KNOWS', since: 2020 },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | DELETE r) RETURN a.name AS name',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify edge was deleted
    expect(graph.hasEdge('r1')).toBe(false);
    expect(graph.hasEdge('r2')).toBe(true); // r2 should still exist
  });

  it('REMOVE property from relationship objects stored in a list', async () => {
    graph.setEdgeAttribute('r1', 'active', true);
    graph.setEdgeAttribute('r2', 'active', true);
    graph.setNodeAttribute('a', 'rels', [
      { id: 'r1', type: 'KNOWS', since: 2020, active: true },
      { id: 'r2', type: 'KNOWS', since: 2021, active: true },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | REMOVE r.active) RETURN a.name AS name',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify properties were removed
    expect(graph.getEdgeAttributes('r1').active).toBeUndefined();
    expect(graph.getEdgeAttributes('r2').active).toBeUndefined();
  });

  it('mixed SET on nodes and relationships in separate FOREACH stages', async () => {
    graph.setNodeAttribute('a', 'nodes', [
      { id: 'b', label: 'B', name: 'Bob' },
    ]);
    graph.setNodeAttribute('a', 'rels', [
      { id: 'r1', type: 'KNOWS', since: 2020 },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) ' +
      'FOREACH (n IN a.nodes | SET n.marked = true) ' +
      'FOREACH (r IN a.rels | SET r.marked = true) ' +
      'RETURN a.name AS name',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify node property was set
    expect(graph.getNodeAttributes('b').marked).toBe(true);
    // Verify edge property was set
    expect(graph.getEdgeAttributes('r1').marked).toBe(true);
  });

  it('FOREACH with SET label on nodes and SET property on edges', async () => {
    graph.setNodeAttribute('a', 'nodes', [
      { id: 'b', label: 'B', name: 'Bob' },
    ]);
    graph.setNodeAttribute('a', 'rels', [
      { id: 'r1', type: 'KNOWS', since: 2020 },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) ' +
      'FOREACH (n IN a.nodes | SET n:Marked) ' +
      'FOREACH (r IN a.rels | SET r.active = true) ' +
      'RETURN a.name AS name',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify label was added to node
    const nodeAttrs = graph.getNodeAttributes('b');
    expect(Array.isArray(nodeAttrs.label)).toBe(true);
    expect(nodeAttrs.label).toContain('Marked');
    // Verify property was set on edge
    expect(graph.getEdgeAttributes('r1').active).toBe(true);
  });

  it('FOREACH on empty relationship list (no-op)', async () => {
    graph.setNodeAttribute('a', 'rels', []);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | SET r.active = true) RETURN a.name AS name',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    expect(graph.getEdgeAttributes('r1').active).toBeUndefined();
  });

  it('FOREACH on null relationship list (no-op)', async () => {
    graph.setNodeAttribute('a', 'rels', null);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | SET r.active = true) RETURN a.name AS name',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
    expect(graph.getEdgeAttributes('r1').active).toBeUndefined();
  });
});

// ── Parser tests: FOREACH with WHERE ─────────────────────────────────────────

describe('FOREACH parser: WHERE', () => {
  it('parses FOREACH with WHERE filter', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.tags WHERE x <> "admin" | SET x:Tagged) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.variable).toBe('x');
    expect(clause.where).toBeDefined();
    expect(clause.where?.type).toBe('BinaryExpression');
    if (clause.where?.type === 'BinaryExpression') {
      expect(clause.where.operator).toBe('<>');
    }
    expect(clause.innerClauses.length).toBe(1);
    expect(clause.innerClauses[0]?.type).toBe('SET');
  });

  it('parses FOREACH with WHERE using numeric comparison', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.values WHERE x > 0 | SET x.positive = true) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.where).toBeDefined();
    expect(clause.where?.type).toBe('BinaryExpression');
    if (clause.where?.type === 'BinaryExpression') {
      expect(clause.where.operator).toBe('>');
    }
  });

  it('parses FOREACH with WHERE using CONTAINS', async () => {
    const ast = parseCypher("MATCH (n) FOREACH (x IN n.tags WHERE x CONTAINS 'test' | SET x:Tested) RETURN n");
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.where).toBeDefined();
    expect(clause.where?.type).toBe('BinaryExpression');
    if (clause.where?.type === 'BinaryExpression') {
      expect(clause.where.operator).toBe('CONTAINS');
    }
  });

  it('parses FOREACH without WHERE (no filter)', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.tags | SET x:Tagged) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.where).toBeUndefined();
  });

  it('parses FOREACH with bare property in WHERE', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items WHERE x.active | SET x:Active) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.where).toBeDefined();
    expect(clause.where?.type).toBe('PropertyAccess');
    if (clause.where?.type === 'PropertyAccess') {
      expect(clause.where.variable).toBe('x');
      expect(clause.where.property).toBe('active');
    }
  });

  it('parses FOREACH with bare variable in WHERE', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items WHERE x | SET x:Active) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.where).toBeDefined();
    expect(clause.where?.type).toBe('PropertyAccess');
    if (clause.where?.type === 'PropertyAccess') {
      expect(clause.where.variable).toBe('x');
    }
  });

  it('parses FOREACH with bare property AND comparison', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items WHERE x.active AND x.val > 0 | SET x:Active) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.where).toBeDefined();
    expect(clause.where?.type).toBe('LogicalExpression');
    if (clause.where?.type === 'LogicalExpression') {
      expect(clause.where.operator).toBe('AND');
      expect(clause.where.left.type).toBe('PropertyAccess');
      expect(clause.where.right.type).toBe('BinaryExpression');
    }
  });

  it('parses FOREACH with NOT bare property', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items WHERE NOT x.active | SET x:Inactive) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.where).toBeDefined();
    expect(clause.where?.type).toBe('NotExpression');
    if (clause.where?.type === 'NotExpression') {
      expect(clause.where.expression.type).toBe('PropertyAccess');
    }
  });
});

// ── Parser tests: FOREACH with multiple inner statements ─────────────────────

describe('FOREACH parser: multiple inner statements', () => {
  it('parses FOREACH with two SET statements', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items | SET x:Tagged, SET x.active = true) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClauses.length).toBe(2);
    expect(clause.innerClauses[0]?.type).toBe('SET');
    expect(clause.innerClauses[1]?.type).toBe('SET');
    if (clause.innerClauses[0]?.type === 'SET') {
      expect(clause.innerClauses[0].items[0]?.labels).toEqual(['Tagged']);
    }
    if (clause.innerClauses[1]?.type === 'SET') {
      expect(clause.innerClauses[1].items[0]?.property).toBe('active');
    }
  });

  it('parses FOREACH with SET and CREATE', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.tags | SET x:Tagged, CREATE (t:Tag {name: x})) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClauses.length).toBe(2);
    expect(clause.innerClauses[0]?.type).toBe('SET');
    expect(clause.innerClauses[1]?.type).toBe('CREATE');
  });

  it('parses FOREACH with SET and DELETE', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items | SET x.deleted = true, DELETE x) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClauses.length).toBe(2);
    expect(clause.innerClauses[0]?.type).toBe('SET');
    expect(clause.innerClauses[1]?.type).toBe('DELETE');
  });

  it('parses FOREACH with WHERE and multiple inner statements', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items WHERE x > 0 | SET x:Positive, SET x.marked = true) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.where).toBeDefined();
    expect(clause.innerClauses.length).toBe(2);
    expect(clause.innerClauses[0]?.type).toBe('SET');
    expect(clause.innerClauses[1]?.type).toBe('SET');
  });

  it('parses FOREACH with three inner statements', async () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items | SET x:Tagged, SET x.active = true, SET x.count = x.count + 1) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClauses.length).toBe(3);
    expect(clause.innerClauses[0]?.type).toBe('SET');
    expect(clause.innerClauses[1]?.type).toBe('SET');
    expect(clause.innerClauses[2]?.type).toBe('SET');
  });
});

// ── Engine tests: FOREACH with WHERE ─────────────────────────────────────────

describe('FOREACH engine: WHERE filter', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice', values: [1, -2, 3, -4, 5] });
    graph.addNode('p1', { label: 'Item', val: 1 });
    graph.addNode('p2', { label: 'Item', val: 3 });
    graph.addNode('p3', { label: 'Item', val: 5 });
  });

  it('executes inner clause only when WHERE predicate is true', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.values WHERE x > 0 | SET x.positive = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('skips elements that do not match WHERE predicate', async () => {
    graph.addNode('a', { label: 'Item', val: 1 });
    graph.addNode('b', { label: 'Item', val: -2 });
    graph.addNode('c', { label: 'Item', val: 3 });
    graph.setNodeAttribute('u1', 'items', [
      { id: 'a', label: 'Item', val: 1 },
      { id: 'b', label: 'Item', val: -2 },
      { id: 'c', label: 'Item', val: 3 },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items WHERE x.val > 0 | SET x:Positive) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Only items with val > 0 should have the label
    const attrsA = graph.getNodeAttributes('a');
    const attrsB = graph.getNodeAttributes('b');
    const attrsC = graph.getNodeAttributes('c');
    expect(Array.isArray(attrsA.label)).toBe(true);
    expect(attrsA.label).toContain('Positive');
    // b should NOT have the label (val = -2)
    expect(attrsB.label).toBe('Item');
    expect(Array.isArray(attrsC.label)).toBe(true);
    expect(attrsC.label).toContain('Positive');
  });

  it('WHERE with string comparison', async () => {
    graph.addNode('t1', { label: 'Tag', name: 'admin' });
    graph.addNode('t2', { label: 'Tag', name: 'user' });
    graph.addNode('t3', { label: 'Tag', name: 'guest' });
    graph.setNodeAttribute('u1', 'tags', [
      { id: 't1', label: 'Tag', name: 'admin' },
      { id: 't2', label: 'Tag', name: 'user' },
      { id: 't3', label: 'Tag', name: 'guest' },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      "MATCH (u:User) FOREACH (x IN u.tags WHERE x.name <> 'admin' | SET x:Processed) RETURN u.name AS userName",
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // admin should NOT be processed
    const attrsT1 = graph.getNodeAttributes('t1');
    expect(attrsT1.label).toBe('Tag');
    // user and guest should be processed
    const attrsT2 = graph.getNodeAttributes('t2');
    const attrsT3 = graph.getNodeAttributes('t3');
    expect(Array.isArray(attrsT2.label)).toBe(true);
    expect(attrsT2.label).toContain('Processed');
    expect(Array.isArray(attrsT3.label)).toBe(true);
    expect(attrsT3.label).toContain('Processed');
  });

  it('WHERE with CONTAINS', async () => {
    graph.setNodeAttribute('u1', 'tags', ['hello', 'world', 'testing', 'test']);
    // With strings, WHERE filters but SET on strings won't modify graph nodes
    const engine = createEngine(graph);
    const ast = parseCypher(
      "MATCH (u:User) FOREACH (x IN u.tags WHERE x CONTAINS 'test' | SET x.matched = true) RETURN u.name AS userName",
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('WHERE with AND condition', async () => {
    graph.setNodeAttribute('u1', 'items', [
      { id: 'p1', label: 'Item', val: 1, active: true },
      { id: 'p2', label: 'Item', val: 3, active: false },
      { id: 'p3', label: 'Item', val: 5, active: true },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items WHERE x.val > 0 AND x.active = true | SET x:Selected) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    const attrsP1 = graph.getNodeAttributes('p1');
    const attrsP2 = graph.getNodeAttributes('p2');
    const attrsP3 = graph.getNodeAttributes('p3');
    expect(Array.isArray(attrsP1.label)).toBe(true);
    expect(attrsP1.label).toContain('Selected');
    expect(attrsP2.label).toBe('Item'); // active = false, should not match
    expect(Array.isArray(attrsP3.label)).toBe(true);
    expect(attrsP3.label).toContain('Selected');
  });

  it('WHERE with OR condition', async () => {
    graph.setNodeAttribute('u1', 'items', [
      { id: 'p1', label: 'Item', val: 1, active: true },
      { id: 'p2', label: 'Item', val: -3, active: true },
      { id: 'p3', label: 'Item', val: 5, active: false },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items WHERE x.val > 0 OR x.active = true | SET x:Selected) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    const attrsP1 = graph.getNodeAttributes('p1');
    const attrsP2 = graph.getNodeAttributes('p2');
    const attrsP3 = graph.getNodeAttributes('p3');
    expect(Array.isArray(attrsP1.label)).toBe(true);
    expect(attrsP1.label).toContain('Selected');
    expect(Array.isArray(attrsP2.label)).toBe(true);
    expect(attrsP2.label).toContain('Selected');
    expect(Array.isArray(attrsP3.label)).toBe(true);
    expect(attrsP3.label).toContain('Selected');
  });

  it('WHERE with IS NOT NULL', async () => {
    graph.setNodeAttribute('u1', 'items', [
      { id: 'p1', label: 'Item', val: 1, name: 'first' },
      { id: 'p2', label: 'Item', val: 2 },
      { id: 'p3', label: 'Item', val: 3, name: 'third' },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items WHERE x.name IS NOT NULL | SET x:Named) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    const attrsP1 = graph.getNodeAttributes('p1');
    const attrsP2 = graph.getNodeAttributes('p2');
    const attrsP3 = graph.getNodeAttributes('p3');
    expect(Array.isArray(attrsP1.label)).toBe(true);
    expect(attrsP1.label).toContain('Named');
    expect(attrsP2.label).toBe('Item'); // no name property
    expect(Array.isArray(attrsP3.label)).toBe(true);
    expect(attrsP3.label).toContain('Named');
  });

  it('WHERE with all elements filtered out (no-op)', async () => {
    graph.setNodeAttribute('u1', 'items', [
      { id: 'p1', label: 'Item', val: -1 },
      { id: 'p2', label: 'Item', val: -2 },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items WHERE x.val > 0 | SET x:Positive) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // No items should have the label
    const attrsP1 = graph.getNodeAttributes('p1');
    const attrsP2 = graph.getNodeAttributes('p2');
    expect(attrsP1.label).toBe('Item');
    expect(attrsP2.label).toBe('Item');
  });

  it('WHERE with bare property (truthy check)', async () => {
    graph.addNode('a', { label: 'Item', active: true });
    graph.addNode('b', { label: 'Item', active: false });
    graph.addNode('c', { label: 'Item', active: true });
    graph.setNodeAttribute('u1', 'items', [
      { id: 'a', label: 'Item', active: true },
      { id: 'b', label: 'Item', active: false },
      { id: 'c', label: 'Item', active: true },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items WHERE x.active | SET x:Active) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Only items with active = true should have the label
    const attrsA = graph.getNodeAttributes('a');
    const attrsB = graph.getNodeAttributes('b');
    const attrsC = graph.getNodeAttributes('c');
    expect(Array.isArray(attrsA.label)).toBe(true);
    expect(attrsA.label).toContain('Active');
    expect(attrsB.label).toBe('Item'); // active = false, should not match
    expect(Array.isArray(attrsC.label)).toBe(true);
    expect(attrsC.label).toContain('Active');
  });
});

// ── Engine tests: FOREACH with multiple inner statements ─────────────────────

describe('FOREACH engine: multiple inner statements', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice' });
    graph.addNode('i1', { label: 'Item', name: 'first', val: 10 });
    graph.addNode('i2', { label: 'Item', name: 'second', val: 20 });
    graph.setNodeAttribute('u1', 'items', [
      { id: 'i1', label: 'Item', name: 'first', val: 10 },
      { id: 'i2', label: 'Item', name: 'second', val: 20 },
    ]);
  });

  it('executes two SET statements', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x:Processed, SET x.reviewed = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify both SET operations were applied
    const attrsI1 = graph.getNodeAttributes('i1');
    expect(Array.isArray(attrsI1.label)).toBe(true);
    expect(attrsI1.label).toContain('Processed');
    expect(attrsI1.reviewed).toBe(true);

    const attrsI2 = graph.getNodeAttributes('i2');
    expect(Array.isArray(attrsI2.label)).toBe(true);
    expect(attrsI2.label).toContain('Processed');
    expect(attrsI2.reviewed).toBe(true);
  });

  it('executes SET and CREATE', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x:Processed, CREATE (n:Log {item: x.name, val: x.val})) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify SET was applied
    const attrsI1 = graph.getNodeAttributes('i1');
    expect(Array.isArray(attrsI1.label)).toBe(true);
    expect(attrsI1.label).toContain('Processed');

    // Verify CREATE was applied (2 new Log nodes)
    const allNodes = graph.filterNodes(() => true);
    const logNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return attrs.label === 'Log';
    });
    expect(logNodes.length).toBe(2);
    const logItems = logNodes.map((id) => graph.getNodeAttributes(id).item).sort();
    expect(logItems).toEqual(['first', 'second']);
  });

  it('executes three SET statements', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x:Processed, SET x.reviewed = true, SET x.count = x.val * 2) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    const attrsI1 = graph.getNodeAttributes('i1');
    expect(Array.isArray(attrsI1.label)).toBe(true);
    expect(attrsI1.label).toContain('Processed');
    expect(attrsI1.reviewed).toBe(true);
    expect(attrsI1.count).toBe(20);

    const attrsI2 = graph.getNodeAttributes('i2');
    expect(attrsI2.count).toBe(40);
  });

  it('executes SET and REMOVE', async () => {
    graph.setNodeAttribute('i1', 'temp', 'toRemove');
    graph.setNodeAttribute('i2', 'temp', 'toRemove');
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x:Processed, REMOVE x.temp) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    const attrsI1 = graph.getNodeAttributes('i1');
    expect(Array.isArray(attrsI1.label)).toBe(true);
    expect(attrsI1.label).toContain('Processed');
    expect(attrsI1.temp).toBeUndefined();

    const attrsI2 = graph.getNodeAttributes('i2');
    expect(attrsI2.temp).toBeUndefined();
  });
});

// ── Engine tests: FOREACH with WHERE and multiple inner statements ───────────

describe('FOREACH engine: WHERE + multiple inner statements', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('u1', { label: 'User', name: 'Alice' });
    graph.addNode('i1', { label: 'Item', name: 'first', val: 10 });
    graph.addNode('i2', { label: 'Item', name: 'second', val: -5 });
    graph.addNode('i3', { label: 'Item', name: 'third', val: 30 });
    graph.setNodeAttribute('u1', 'items', [
      { id: 'i1', label: 'Item', name: 'first', val: 10 },
      { id: 'i2', label: 'Item', name: 'second', val: -5 },
      { id: 'i3', label: 'Item', name: 'third', val: 30 },
    ]);
  });

  it('WHERE filter + two SET statements', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items WHERE x.val > 0 | SET x:Positive, SET x.marked = true) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // i1 (val=10) and i3 (val=30) should be processed
    const attrsI1 = graph.getNodeAttributes('i1');
    expect(Array.isArray(attrsI1.label)).toBe(true);
    expect(attrsI1.label).toContain('Positive');
    expect(attrsI1.marked).toBe(true);

    // i2 (val=-5) should NOT be processed
    const attrsI2 = graph.getNodeAttributes('i2');
    expect(attrsI2.label).toBe('Item');
    expect(attrsI2.marked).toBeUndefined();

    // i3 (val=30) should be processed
    const attrsI3 = graph.getNodeAttributes('i3');
    expect(Array.isArray(attrsI3.label)).toBe(true);
    expect(attrsI3.label).toContain('Positive');
    expect(attrsI3.marked).toBe(true);
  });

  it('WHERE filter + SET and CREATE', async () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items WHERE x.val > 0 | SET x:Positive, CREATE (n:Log {item: x.name})) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Only 2 Log nodes should be created (for i1 and i3)
    const allNodes = graph.filterNodes(() => true);
    const logNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return attrs.label === 'Log';
    });
    expect(logNodes.length).toBe(2);
    const logItems = logNodes.map((id) => graph.getNodeAttributes(id).item).sort();
    expect(logItems).toEqual(['first', 'third']);
  });

  it('WHERE with AND + multiple inner statements', async () => {
    graph.setNodeAttribute('i1', 'active', true);
    graph.setNodeAttribute('i2', 'active', true);
    graph.setNodeAttribute('i3', 'active', false);
    graph.setNodeAttribute('u1', 'items', [
      { id: 'i1', label: 'Item', name: 'first', val: 10, active: true },
      { id: 'i2', label: 'Item', name: 'second', val: -5, active: true },
      { id: 'i3', label: 'Item', name: 'third', val: 30, active: false },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items WHERE x.val > 0 AND x.active = true | SET x:Selected, SET x.score = x.val * 2) RETURN u.name AS userName',
    );
    const results = await engine.execute(ast);
    expect(results.length).toBe(1);

    // Only i1 should be selected (val > 0 AND active = true)
    const attrsI1 = graph.getNodeAttributes('i1');
    expect(Array.isArray(attrsI1.label)).toBe(true);
    expect(attrsI1.label).toContain('Selected');
    expect(attrsI1.score).toBe(20);

    // i2 should NOT be selected (val <= 0)
    const attrsI2 = graph.getNodeAttributes('i2');
    expect(attrsI2.label).toBe('Item');
    expect(attrsI2.score).toBeUndefined();

    // i3 should NOT be selected (active = false)
    const attrsI3 = graph.getNodeAttributes('i3');
    expect(attrsI3.label).toBe('Item');
    expect(attrsI3.score).toBeUndefined();
  });
});
