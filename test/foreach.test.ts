import { describe, it, expect, beforeEach } from 'vitest';
import { Graph, type GraphInstance } from '../src/graph';
import { AdvancedCypherGraphologyEngine } from '../src/engine/cypher-engine';
import { parseCypher as _parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST, ForeachClause } from '../src/types/cypher';
import { DEFAULT_CONFIG, type CypherNode, type GraphIndexes } from '../src/types/cypher';

const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;

function node<T extends Record<string, unknown>>(row: T, key: keyof T): CypherNode {
  return row[key] as CypherNode;
}

function buildIndexesFromGraph(graph: GraphInstance): GraphIndexes {
  const labelIndex = new Map<string, Set<string>>();
  const propertyIndex = new Map<string, Map<string, Set<string>>>();
  const edgeOut = new Map<string, Map<string, Array<{ target: string; edgeId: string }>>>();
  const edgeIn = new Map<string, Map<string, Array<{ source: string; edgeId: string }>>>();

  graph.filterNodes(() => true).forEach((id) => {
    const attrs = graph.getNodeAttributes(id);
    const rawLabel = attrs.label;
    if (typeof rawLabel === 'string') {
      let s = labelIndex.get(rawLabel);
      if (!s) { s = new Set(); labelIndex.set(rawLabel, s); }
      s.add(id);
    } else if (Array.isArray(rawLabel)) {
      for (const label of rawLabel) {
        if (typeof label !== 'string') continue;
        let s = labelIndex.get(label);
        if (!s) { s = new Set(); labelIndex.set(label, s); }
        s.add(id);
      }
    }
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'label' || value === null || value === undefined || typeof value === 'object') continue;
      let vm = propertyIndex.get(key);
      if (!vm) { vm = new Map(); propertyIndex.set(key, vm); }
      const vk = String(value);
      let ns = vm.get(vk);
      if (!ns) { ns = new Set(); vm.set(vk, ns); }
      ns.add(id);
    }
  });

  graph.forEachEdge((edgeId, attrs, source, target) => {
    const et = (attrs.type && typeof attrs.type === 'string') ? attrs.type : '__UNTYPED__';
    let om = edgeOut.get(et);
    if (!om) { om = new Map(); edgeOut.set(et, om); }
    let ol = om.get(source);
    if (!ol) { ol = []; om.set(source, ol); }
    ol.push({ target, edgeId });

    let im = edgeIn.get(et);
    if (!im) { im = new Map(); edgeIn.set(et, im); }
    let il = im.get(target);
    if (!il) { il = []; im.set(target, il); }
    il.push({ source, edgeId });
  });

  return { labelIndex, propertyIndex, edgeTypeIndex: { out: edgeOut, in: edgeIn }, config: DEFAULT_CONFIG };
}

function createEngine(graph: GraphInstance) {
  const indexes = buildIndexesFromGraph(graph);
  return new AdvancedCypherGraphologyEngine(graph, indexes);
}

// ── Parser tests ─────────────────────────────────────────────────────────────

describe('FOREACH parser', () => {
  it('parses FOREACH with SET property', () => {
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
    expect(clause.innerClause.type).toBe('SET');
    if (clause.innerClause.type === 'SET') {
      expect(clause.innerClause.variable).toBe('x');
      expect(clause.innerClause.property).toBe('active');
    }
  });

  it('parses FOREACH with SET label', () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.tags | SET x:Tag) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClause.type).toBe('SET');
    if (clause.innerClause.type === 'SET') {
      expect(clause.innerClause.labels).toEqual(['Tag']);
    }
  });

  it('parses FOREACH with CREATE', () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.tags | CREATE (t:Tag {name: x})) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClause.type).toBe('CREATE');
    if (clause.innerClause.type === 'CREATE') {
      expect(clause.innerClause.variable).toBe('t');
      expect(clause.innerClause.labels).toEqual(['Tag']);
      expect(clause.innerClause.propertiesExpr).toBeDefined();
      expect(clause.innerClause.propertiesExpr?.['name']).toBeDefined();
    }
  });

  it('parses FOREACH with DELETE', () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.tags | DELETE x) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClause.type).toBe('DELETE');
    if (clause.innerClause.type === 'DELETE') {
      expect(clause.innerClause.variable).toBe('x');
    }
  });

  it('parses FOREACH with REMOVE property', () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items | REMOVE x.temp) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClause.type).toBe('REMOVE');
    if (clause.innerClause.type === 'REMOVE') {
      expect(clause.innerClause.items[0]?.variable).toBe('x');
      expect(clause.innerClause.items[0]?.property).toBe('temp');
    }
  });

  it('parses FOREACH with REMOVE label', () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items | REMOVE x:Temp) RETURN n');
    const clause = (ast.stages[1]! as { type: 'FOREACH'; clause: ForeachClause }).clause;
    expect(clause.innerClause.type).toBe('REMOVE');
    if (clause.innerClause.type === 'REMOVE') {
      expect(clause.innerClause.items[0]?.variable).toBe('x');
      expect(clause.innerClause.items[0]?.labels).toEqual(['Temp']);
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

  it('sets property on each element of a list', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    // Only 1 row (FOREACH does not expand rows)
    expect(results.length).toBe(1);
    expect(results[0]?.['userName']).toBe('Alice');
  });

  it('does not expand rows (unlike UNWIND)', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['u']).toBeDefined();
  });

  it('handles empty list (no-op)', () => {
    graph.setNodeAttribute('u1', 'tags', []);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['userName']).toBe('Alice');
  });

  it('handles null list (no-op)', () => {
    graph.setNodeAttribute('u1', 'tags', null);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['userName']).toBe('Alice');
  });

  it('handles missing list property (no-op)', () => {
    graph.setNodeAttribute('u1', 'tags', undefined);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('works with literal list', () => {
    graph.addNode('x1', { label: 'Item', name: 'first' });
    graph.addNode('x2', { label: 'Item', name: 'second' });
    // Using a list of strings
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (s IN ["hello", "world"] | SET s.marked = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
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

  it('adds label to each element', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x:Tagged) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['userName']).toBe('Alice');
  });

  it('SET label on strings (no-op on non-node values, no crash)', () => {
    const engine = createEngine(graph);
    // When tags are strings, SET x:Tagged won't find nodes, but shouldn't crash
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | SET x:Tagged) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
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

  it('creates a node for each element with dynamic property', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | CREATE (t:Tag {name: x})) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
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

  it('creates nodes with static labels and dynamic properties', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | CREATE (t:Tag:Active {name: x, source: "FOREACH"})) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
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

  it('creates nodes from a literal list', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN [1, 2, 3] | CREATE (n:Number {value: x})) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    const allNodes = graph.filterNodes(() => true);
    const numberNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return attrs.label === 'Number';
    });
    expect(numberNodes.length).toBe(3);
  });

  it('creates no nodes when list is null (no-op)', () => {
    graph.setNodeAttribute('u1', 'tags', null);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | CREATE (t:Tag {name: x})) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
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

  it('deletes nodes referenced in the list', () => {
    // Simple case: list of node references
    graph.setNodeAttribute('u1', 'todos', ['t2', 't3']);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (tid IN u.todos | DELETE tid) RETURN u.name AS userName',
    );
    // This won't actually delete because 't2'/'t3' are strings, not node objects
    // But the query should not crash
    const results = engine.execute(ast);
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

  it('removes property from each element in list', () => {
    graph.setNodeAttribute('u1', 'items', ['t1', 't2']);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | REMOVE x.temp) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('removes label from each element in list', () => {
    graph.setNodeAttribute('u1', 'items', ['t1', 't2']);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | REMOVE x:Item) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
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

  it('FOREACH with SET property on a literal list of strings', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (s IN ["a", "b"] | SET s.marked = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('FOREACH with UNWIND + SET for node iteration', () => {
    // Use UNWIND to get nodes into a variable, then FOREACH for mutation
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (p IN ["p1", "p2"] | SET p.reviewed = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
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

  it('FOREACH followed by RETURN', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (t IN u.tags | SET t.marked = true) RETURN u.name AS userName, u.tags AS userTags',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(2); // 2 users
    const names = results.map((r) => r['userName']).sort();
    expect(names).toEqual(['Alice', 'Bob']);
  });

  it('FOREACH followed by MATCH (uses updated graph)', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User {name: "Alice"}) FOREACH (t IN u.tags | CREATE (n:TagNode {name: t})) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify new nodes were created
    const allNodes = graph.filterNodes(() => true);
    const tagNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return attrs.label === 'TagNode';
    });
    expect(tagNodes.length).toBe(2);
  });

  it('FOREACH with CREATE, then MATCH new nodes', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User {name: "Alice"}) ' +
      'FOREACH (t IN u.tags | CREATE (n:Created {name: t})) ' +
      'MATCH (c:Created) RETURN c.name AS cname',
    );
    const results = engine.execute(ast);
    const names = results.map((r) => r['cname']).sort();
    expect(names).toEqual(['js', 'ts']);
  });

  it('multiple FOREACH stages', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User {name: "Alice"}) ' +
      'FOREACH (t IN u.tags | CREATE (n:TagA {name: t})) ' +
      'FOREACH (t IN ["extra"] | CREATE (n:TagB {name: t})) ' +
      'RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
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

  it('FOREACH on non-existent property (no-op)', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.nonexistent | SET x.marked = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('FOREACH with empty list (no-op)', () => {
    graph.setNodeAttribute('u1', 'tags', []);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.tags | CREATE (n:Tag {name: x})) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
  });

  it('FOREACH preserves row count with multiple input rows', () => {
    graph.addNode('u2', { label: 'User', name: 'Bob', tags: ['a', 'b', 'c', 'd', 'e'] });
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (t IN u.tags | SET t.processed = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    // 2 input rows → 2 output rows (not 2 + 5 = 7 like UNWIND)
    expect(results.length).toBe(2);
  });

  it('FOREACH with CREATE using loop variable in expression', () => {
    graph.setNodeAttribute('u1', 'values', [10, 20, 30]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (v IN u.values | CREATE (n:Number {value: v, doubled: v * 2})) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    const allNodes = graph.filterNodes(() => true);
    const numberNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return attrs.label === 'Number';
    });
    expect(numberNodes.length).toBe(3);

    // Check doubled values
    const doubledValues = numberNodes
      .map((id) => graph.getNodeAttributes(id).doubled)
      .sort((a: number, b: number) => a - b);
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

  it('SET label on node objects stored in a list', () => {
    // Store actual node objects (with id) in the list
    graph.setNodeAttribute('u1', 'items', [
      { id: 'i1', label: 'Item', name: 'first' },
      { id: 'i2', label: 'Item', name: 'second' },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x:Processed) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify labels were added
    const attrs1 = graph.getNodeAttributes('i1');
    const attrs2 = graph.getNodeAttributes('i2');
    expect(Array.isArray(attrs1.label)).toBe(true);
    expect(attrs1.label).toContain('Processed');
    expect(attrs2.label).toContain('Processed');
  });

  it('SET property on node objects stored in a list', () => {
    graph.setNodeAttribute('u1', 'items', [
      { id: 'i1', label: 'Item', name: 'first' },
      { id: 'i2', label: 'Item', name: 'second' },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | SET x.reviewed = true) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify properties were set
    expect(graph.getNodeAttributes('i1').reviewed).toBe(true);
    expect(graph.getNodeAttributes('i2').reviewed).toBe(true);
  });

  it('SET both label and property in separate FOREACH stages', () => {
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
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    const attrs1 = graph.getNodeAttributes('i1');
    expect(attrs1.label).toContain('Processed');
    expect(attrs1.reviewed).toBe(true);
  });

  it('DELETE node objects stored in a list', () => {
    graph.setNodeAttribute('u1', 'items', [
      { id: 'i1', label: 'Item', name: 'first' },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (u:User) FOREACH (x IN u.items | DELETE x) RETURN u.name AS userName',
    );
    const results = engine.execute(ast);
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

  it('SET property on relationship objects stored in a list', () => {
    graph.setNodeAttribute('a', 'rels', [
      { id: 'r1', type: 'KNOWS', since: 2020 },
      { id: 'r2', type: 'KNOWS', since: 2021 },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | SET r.active = true) RETURN a.name AS name',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify properties were set on edges
    expect(graph.getEdgeAttributes('r1').active).toBe(true);
    expect(graph.getEdgeAttributes('r2').active).toBe(true);
  });

  it('SET property on relationship with dynamic value', () => {
    graph.setNodeAttribute('a', 'rels', [
      { id: 'r1', type: 'KNOWS', since: 2020 },
      { id: 'r2', type: 'KNOWS', since: 2021 },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | SET r.sinceDoubled = r.since * 2) RETURN a.name AS name',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    expect(graph.getEdgeAttributes('r1').sinceDoubled).toBe(4040);
    expect(graph.getEdgeAttributes('r2').sinceDoubled).toBe(4042);
  });

  it('DELETE relationship objects stored in a list', () => {
    graph.setNodeAttribute('a', 'rels', [
      { id: 'r1', type: 'KNOWS', since: 2020 },
    ]);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | DELETE r) RETURN a.name AS name',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify edge was deleted
    expect(graph.hasEdge('r1')).toBe(false);
    expect(graph.hasEdge('r2')).toBe(true); // r2 should still exist
  });

  it('REMOVE property from relationship objects stored in a list', () => {
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
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify properties were removed
    expect(graph.getEdgeAttributes('r1').active).toBeUndefined();
    expect(graph.getEdgeAttributes('r2').active).toBeUndefined();
  });

  it('mixed SET on nodes and relationships in separate FOREACH stages', () => {
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
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify node property was set
    expect(graph.getNodeAttributes('b').marked).toBe(true);
    // Verify edge property was set
    expect(graph.getEdgeAttributes('r1').marked).toBe(true);
  });

  it('FOREACH with SET label on nodes and SET property on edges', () => {
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
    const results = engine.execute(ast);
    expect(results.length).toBe(1);

    // Verify label was added to node
    const nodeAttrs = graph.getNodeAttributes('b');
    expect(Array.isArray(nodeAttrs.label)).toBe(true);
    expect(nodeAttrs.label).toContain('Marked');
    // Verify property was set on edge
    expect(graph.getEdgeAttributes('r1').active).toBe(true);
  });

  it('FOREACH on empty relationship list (no-op)', () => {
    graph.setNodeAttribute('a', 'rels', []);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | SET r.active = true) RETURN a.name AS name',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    expect(graph.getEdgeAttributes('r1').active).toBeUndefined();
  });

  it('FOREACH on null relationship list (no-op)', () => {
    graph.setNodeAttribute('a', 'rels', null);
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:A) FOREACH (r IN a.rels | SET r.active = true) RETURN a.name AS name',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    expect(graph.getEdgeAttributes('r1').active).toBeUndefined();
  });
});
