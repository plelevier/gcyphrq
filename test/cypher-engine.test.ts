import { describe, it, expect, beforeEach } from 'vitest';
import { Graph, type GraphInstance } from '../src/graph';
import { AdvancedCypherGraphologyEngine } from '../src/engine/cypher-engine';
import { parseCypher } from '../src/engine/cypher-parser';
import { DEFAULT_CONFIG, type CypherNode, type GraphIndexes } from '../src/types/cypher';

/** Cast a result-row value to CypherNode for test assertions. */
function node<T extends Record<string, unknown>>(row: T, key: keyof T): CypherNode {
  return row[key] as CypherNode;
}

/** Build simple indexes from a Graphology graph (for mutation tests). */
function buildIndexesFromGraph(graph: GraphInstance): GraphIndexes {
  const labelIndex = new Map<string, Set<string>>();
  const propertyIndex = new Map<string, Map<string, Set<string>>>();
  const edgeOut = new Map<string, Map<string, Array<{ target: string; edgeId: string }>>>();
  const edgeIn = new Map<string, Map<string, Array<{ source: string; edgeId: string }>>>();

  graph.filterNodes(() => true).forEach((id) => {
    const attrs = graph.getNodeAttributes(id);
    const label = attrs.label as string | undefined;
    if (label) {
      let s = labelIndex.get(label);
      if (!s) { s = new Set(); labelIndex.set(label, s); }
      s.add(id);
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

function createTestGraph() {
  const graph = new Graph();

  graph.addNode('alice', { label: 'User', name: 'Alice', age: 30 });
  graph.addNode('bob', { label: 'User', name: 'Bob', age: 25 });
  graph.addNode('charlie', { label: 'User', name: 'Charlie', age: 35 });
  graph.addNode('dave', { label: 'User', name: 'Dave', age: 28 });

  graph.addEdge('alice', 'bob', { type: 'FRIEND' });
  graph.addEdge('bob', 'charlie', { type: 'FRIEND' });
  graph.addEdge('alice', 'dave', { type: 'KNOWS' });

  return graph;
}

describe('AdvancedCypherGraphologyEngine', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createTestGraph();
    engine = new AdvancedCypherGraphologyEngine(graph);
  });

  describe('execute - MATCH', () => {
    it('finds all nodes matching a label', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('finds nodes matching a label and property', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('traverses outbound relationships', () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN a, b');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'a').name).toBe('Alice');
      expect(node(results[0]!, 'b').name).toBe('Bob');
    });

    it('traverses inbound relationships', () => {
      const ast = parseCypher('MATCH (a:User)<-[r:FRIEND]-(b:User {name: "Bob"}) RETURN a');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      // (a)<-[FRIEND]-(b=Bob) means FRIEND goes b→a, i.e., Bob→Charlie, so a=Charlie
      expect(node(results[0]!, 'a').name).toBe('Charlie');
    });

    it('traverses inbound relationships from known node', () => {
      const ast = parseCypher('MATCH (a:User {name: "Bob"})<-[r:FRIEND]-(b:User) RETURN b');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      // Bob has inbound FRIEND from Alice, so b=Alice
      expect(node(results[0]!, 'b').name).toBe('Alice');
    });

    it('traverses undirected relationships', () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r:FRIEND]-(b:User) RETURN b');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'b').name).toBe('Bob');
    });

    it('traverses variable-length paths (min=1, max=2)', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"})-[r:FRIEND*1..2]->(f:User) RETURN u, f');
      const results = engine.execute(ast);
      // Alice -> Bob (depth 1), Alice -> Bob -> Charlie (depth 2)
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'f').name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('handles OPTIONAL MATCH with no match', () => {
      const ast = parseCypher('MATCH (u:User {name: "Charlie"}) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) RETURN u, f');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
      expect(results[0]!.f).toBeNull();
    });

    it('handles OPTIONAL MATCH with a match', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) RETURN u, f');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
      expect(node(results[0]!, 'f').name).toBe('Bob');
    });

    it('filters by relationship type', () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r:KNOWS]->(b:User) RETURN b');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'b').name).toBe('Dave');
    });
  });

  describe('execute - RETURN', () => {
    it('returns projected properties with AS alias', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u.name AS name, u.age AS age');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.age).toBe(30);
    });

    it('returns projected properties using property name as default alias', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u.name, u.age');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.age).toBe(30);
    });

    it('returns full node objects', () => {
      const ast = parseCypher('MATCH (u:User {name: "Bob"}) RETURN u');
      const results = engine.execute(ast);
      expect(node(results[0]!, 'u').name).toBe('Bob');
      expect(node(results[0]!, 'u').age).toBe(25);
    });

    it('returns literal values', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u.name AS name, "Hello" AS greeting');
      const results = engine.execute(ast);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.greeting).toBe('Hello');
    });
  });

  describe('execute - WITH', () => {
    it('groups and aggregates with COUNT', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount RETURN name, friendCount'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.friendCount).toBe(1);
      const bobResult = results.find(r => r.name === 'Bob');
      expect(bobResult?.friendCount).toBe(1);
    });

    it('filters aggregated results with WHERE', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount WHERE friendCount > 0 RETURN name, friendCount'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('aggregates with SUM', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, sum(b.age) AS totalAge RETURN name, totalAge'
      );
      const results = engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.totalAge).toBe(25); // Bob's age
    });

    it('aggregates with AVG', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, avg(b.age) AS avgAge RETURN name, avgAge'
      );
      const results = engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.avgAge).toBe(25); // Only Bob (age 25)
    });

    it('aggregates with AVG across multiple values', () => {
      // Alice has 2 undirected connections: Bob (age 25) and Dave (age 28)
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r]-(other:User) WITH a.name AS name, avg(other.age) AS avgAge RETURN name, avgAge'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.avgAge).toBe(26.5); // (25 + 28) / 2
    });

    it('aggregates with MIN', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, min(b.age) AS minAge RETURN name, minAge'
      );
      const results = engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.minAge).toBe(25); // Bob's age
    });

    it('aggregates with MIN across multiple values', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r]-(other:User) WITH a.name AS name, min(other.age) AS minAge RETURN name, minAge'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.minAge).toBe(25); // min(25, 28)
    });

    it('aggregates with MAX', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, max(b.age) AS maxAge RETURN name, maxAge'
      );
      const results = engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.maxAge).toBe(25); // Bob's age
    });

    it('aggregates with MAX across multiple values', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r]-(other:User) WITH a.name AS name, max(other.age) AS maxAge RETURN name, maxAge'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.maxAge).toBe(28); // max(25, 28)
    });

    it('AVG returns null when no numeric values in group', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: null });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:Item) WITH n.label AS label, avg(n.value) AS avgVal RETURN label, avgVal');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.avgVal).toBeNull();
    });

    it('MIN returns null when no numeric values in group', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: null });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:Item) WITH n.label AS label, min(n.value) AS minVal RETURN label, minVal');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.minVal).toBeNull();
    });

    it('MAX returns null when no numeric values in group', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: null });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:Item) WITH n.label AS label, max(n.value) AS maxVal RETURN label, maxVal');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.maxVal).toBeNull();
    });
  });

  describe('execute - WRITE', () => {
    it('creates a new node with CREATE', () => {
      const ast = parseCypher('CREATE (n:User {name: "Eve", age: 22}) RETURN n');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const n = node(results[0]!, 'n');
      expect(n.name).toBe('Eve');
      expect(n.label).toBe('User');
      expect(typeof n.id).toBe('string');
      expect(graph.hasNode(n.id)).toBe(true);
    });

    it('sets a property on a node with SET', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) SET u.age = 31 RETURN u');
      const results = engine.execute(ast);
      expect(node(results[0]!, 'u').age).toBe(31);
    });

    it('deletes a node with DELETE', () => {
      const daveId = 'dave';
      const ast = parseCypher('MATCH (u:User {name: "Dave"}) DELETE u');
      engine.execute(ast);
      expect(graph.hasNode(daveId)).toBe(false);
    });
  });

  describe('execute - multi-stage queries', () => {
    it('executes MATCH-WITH-RETURN pipeline', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount RETURN name, friendCount'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('executes MATCH-CREATE-RETURN', () => {
      const initialCount = graph.order;
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) CREATE (n:User {name: "Eve"}) RETURN u, n');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
      expect(node(results[0]!, 'n').name).toBe('Eve');
      expect(graph.order).toBe(initialCount + 1);
    });
  });

  describe('edge cases', () => {
    it('returns empty array when no match is found', () => {
      const ast = parseCypher('MATCH (u:User {name: "NonExistent"}) RETURN u');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('returns empty array when no RETURN clause exists', () => {
      const ast = parseCypher('MATCH (u:User)');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('traverses undirected relationship without type or variable', () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r]-(b:User) RETURN a.name AS from, b.name AS to');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => `${r.from}->${r.to}`).sort();
      expect(names).toEqual(['Alice->Bob', 'Alice->Dave']);
    });

    it('resolves alias collisions with var.prop fallback', () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a.name, b.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!).toHaveProperty('a.name');
      expect(results[0]!).toHaveProperty('b.name');
    });

    it('aggregates with COUNT in RETURN without WITH', () => {
      const ast = parseCypher('MATCH (u:User) RETURN count(u) AS total');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.total).toBe(4);
    });

    it('aggregates with SUM in RETURN without WITH', () => {
      const ast = parseCypher('MATCH (u:User) RETURN sum(u.age) AS totalAge');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.totalAge).toBe(118);
    });

    it('aggregates with AVG in RETURN without WITH', () => {
      const ast = parseCypher('MATCH (u:User) RETURN avg(u.age) AS avgAge');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.avgAge).toBe(29.5); // (30 + 25 + 35 + 28) / 4
    });

    it('aggregates with MIN in RETURN without WITH', () => {
      const ast = parseCypher('MATCH (u:User) RETURN min(u.age) AS minAge');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.minAge).toBe(25); // Bob
    });

    it('aggregates with MAX in RETURN without WITH', () => {
      const ast = parseCypher('MATCH (u:User) RETURN max(u.age) AS maxAge');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.maxAge).toBe(35); // Charlie
    });

    it('aggregates with multiple functions in RETURN without WITH', () => {
      const ast = parseCypher('MATCH (u:User) RETURN count(u) AS total, avg(u.age) AS avgAge, min(u.age) AS minAge, max(u.age) AS maxAge');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.total).toBe(4);
      expect(results[0]!.avgAge).toBe(29.5);
      expect(results[0]!.minAge).toBe(25);
      expect(results[0]!.maxAge).toBe(35);
    });

    it('handles multiple matches from different start nodes', () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a.name AS from, b.name AS to');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const pairs = results.map(r => `${r.from}->${r.to}`).sort();
      expect(pairs).toEqual(['Alice->Bob', 'Bob->Charlie']);
    });

    it('captures relationship data when variable is bound', () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN a, b, r');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.r).toBeDefined();
      expect(Array.isArray(results[0]!.r)).toBe(true);
    });
  });

  describe('execute - WHERE operators', () => {
    it('filters with WHERE = operator', () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name, count(u) AS cnt WHERE cnt = 1 RETURN name',
      );
      const results = engine.execute(ast);
      // All users have count 1, so all pass
      expect(results.length).toBe(4);
    });

    it('filters with WHERE < operator', () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name, count(u) AS cnt WHERE cnt < 2 RETURN name',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('filters with WHERE < operator that excludes all', () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name, count(u) AS cnt WHERE cnt < 0 RETURN name',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });

    // TODO: CONTAINS is not yet extracted by the parser's extractComparison function.
    // The ANTLR grammar places CONTAINS in a different tree position than >, <, =.
    // it('filters with WHERE CONTAINS operator (match found)', () => { ... });
    // it('filters with WHERE CONTAINS operator (no match)', () => { ... });
  });

  describe('execute - WHERE CONTAINS', () => {
    it('filters with WHERE CONTAINS operator (match found)', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "Ali" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('filters with WHERE CONTAINS operator (no match)', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "xyz" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE CONTAINS on WITH clause', () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name WHERE name CONTAINS "ob" RETURN name',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Bob');
    });

    it('filters with WHERE CONTAINS partial match', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "ar" RETURN u',
      );
      const results = engine.execute(ast);
      // Charlie contains "ar"
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
    });

    it('filters with WHERE CONTAINS case-sensitive', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "alice" RETURN u',
      );
      const results = engine.execute(ast);
      // "Alice" does not contain "alice" (case-sensitive)
      expect(results.length).toBe(0);
    });

    it('filters with WHERE CONTAINS on relationship traversal', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WHERE a.name CONTAINS "Ali" RETURN a, b',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'a').name).toBe('Alice');
      expect(node(results[0]!, 'b').name).toBe('Bob');
    });
  });

  describe('execute - WHERE AND', () => {
    it('filters with WHERE AND (both conditions true)', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age > 25 AND u.age < 35 RETURN u',
      );
      const results = engine.execute(ast);
      // Alice (30), Dave (28) match; Bob (25) does not (> 25, not >=); Charlie (35) does not (< 35)
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Dave']);
    });

    it('filters with WHERE AND (one condition false)', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age > 30 AND u.name = "Alice" RETURN u',
      );
      const results = engine.execute(ast);
      // Alice is 30, not > 30
      expect(results.length).toBe(0);
    });

    it('filters with WHERE AND (both conditions false)', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age > 100 AND u.age < 5 RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE AND on WITH clause', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS cnt WHERE cnt > 0 AND name = "Alice" RETURN name, cnt',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.cnt).toBe(1);
    });

    it('filters with WHERE AND combining CONTAINS and comparison', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "li" AND u.age > 20 RETURN u',
      );
      const results = engine.execute(ast);
      // Alice (30, contains "li"), Charlie (35, contains "li")
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('filters with WHERE AND combining CONTAINS and equality', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "ob" AND u.age = 25 RETURN u',
      );
      const results = engine.execute(ast);
      // Bob (25, contains "ob")
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Bob');
    });

    it('filters with WHERE AND multiple conditions', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age > 20 AND u.age < 35 AND u.name CONTAINS "li" RETURN u',
      );
      const results = engine.execute(ast);
      // Alice (30, contains "li"), Dave doesn't contain "li", Charlie (35) not < 35
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });
  });

  describe('execute - WHERE OR', () => {
    it('filters with WHERE OR (first condition true)', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name = "Alice" OR u.age > 100 RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('filters with WHERE OR (second condition true)', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name = "Unknown" OR u.age > 29 RETURN u',
      );
      const results = engine.execute(ast);
      // Alice (30), Charlie (35)
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('filters with WHERE OR (both conditions true for some)', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name = "Alice" OR u.age > 30 RETURN u',
      );
      const results = engine.execute(ast);
      // Alice (name="Alice"), Charlie (age=35 > 30)
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('filters with WHERE OR (no match)', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name = "Unknown" OR u.age > 100 RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE OR on WITH clause', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS cnt WHERE cnt > 1 OR name = "Alice" RETURN name, cnt',
      );
      const results = engine.execute(ast);
      // Alice has cnt=1 (matches name="Alice"), Bob has cnt=1 (no match)
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('filters with WHERE OR combining CONTAINS', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "Ali" OR u.name CONTAINS "ob" RETURN u',
      );
      const results = engine.execute(ast);
      // Alice (contains "Ali"), Bob (contains "ob")
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob']);
    });

    it('filters with WHERE OR combining CONTAINS and comparison', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "ob" OR u.age > 32 RETURN u',
      );
      const results = engine.execute(ast);
      // Bob (contains "ob"), Charlie (35 > 32)
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('filters with WHERE OR multiple conditions', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name = "Alice" OR u.name = "Bob" OR u.name = "Charlie" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });
  });

  describe('execute - WHERE AND + OR combined', () => {
    it('evaluates AND before OR (AND has higher precedence)', () => {
      // n.age > 25 AND n.name = "Alice" OR n.age < 26
      // Should be: (n.age > 25 AND n.name = "Alice") OR n.age < 26
      // Alice (30 > 25 AND name="Alice") = true, Bob (25 < 26) = true
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age > 25 AND u.name = "Alice" OR u.age < 26 RETURN u',
      );
      const results = engine.execute(ast);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob']);
    });

    it('evaluates parenthesized OR before AND', () => {
      // (n.age > 32 OR n.age < 26) AND n.name CONTAINS "a"
      // Alice (30, not > 32 and not < 26) = false
      // Bob (25 < 26, name="Bob" doesn't contain "a") = false
      // Charlie (35 > 32, name="Charlie" contains "a") = true
      // Dave (28, not > 32 and not < 26) = false
      const ast = parseCypher(
        'MATCH (u:User) WHERE (u.age > 32 OR u.age < 26) AND u.name CONTAINS "a" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
    });

    it('evaluates complex WHERE with AND, OR, and CONTAINS', () => {
      // (n.name CONTAINS "Ali" OR n.name CONTAINS "ob") AND n.age > 20
      // Alice (contains "Ali", 30 > 20) = true
      // Bob (contains "ob", 25 > 20) = true
      const ast = parseCypher(
        'MATCH (u:User) WHERE (u.name CONTAINS "Ali" OR u.name CONTAINS "ob") AND u.age > 20 RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob']);
    });

    it('evaluates WHERE with AND, OR on WITH clause', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS cnt WHERE (cnt > 0 OR name = "Charlie") AND name <> "Bob" RETURN name, cnt',
      );
      const results = engine.execute(ast);
      // Alice (cnt=1 > 0, name != "Bob") = true
      // Bob (cnt=1 > 0, name = "Bob") = false
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('evaluates WHERE with AND combining two CONTAINS', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "a" AND u.name CONTAINS "r" RETURN u',
      );
      const results = engine.execute(ast);
      // Charlie contains both "a" and "r"
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
    });
  });

  describe('execute - bare node pattern', () => {
    it('matches all nodes with bare pattern (no label)', () => {
      const ast = parseCypher('MATCH (n) RETURN n');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('matches all nodes with bare pattern and property filter', () => {
      const ast = parseCypher('MATCH (n {age: 30}) RETURN n');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'n').name).toBe('Alice');
    });
  });

  describe('execute - WHERE on MATCH', () => {
    it('filters by equality on a property', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.name = "Alice" RETURN u');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('filters by greater-than on a numeric property', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.age > 28 RETURN u');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('filters by less-than on a numeric property', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.age < 30 RETURN u');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Dave']);
    });

    it('filters on a relationship traversal', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WHERE a.name = "Alice" RETURN a, b',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'a').name).toBe('Alice');
      expect(node(results[0]!, 'b').name).toBe('Bob');
    });

    it('returns empty results when no match', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.name = "Unknown" RETURN u');
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with bare pattern (no label) and WHERE', () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN n');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'n').name).toBe('Alice');
    });

    it('filters with bare pattern and WHERE on numeric property', () => {
      const ast = parseCypher('MATCH (n) WHERE n.age > 29 RETURN n');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'n').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('OPTIONAL MATCH with WHERE returns null when no match', () => {
      const ast = parseCypher('OPTIONAL MATCH (u:User) WHERE u.name = "Unknown" RETURN u');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.u).toBeNull();
    });

    it('OPTIONAL MATCH with WHERE returns match when found', () => {
      const ast = parseCypher('OPTIONAL MATCH (u:User) WHERE u.name = "Alice" RETURN u');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('OPTIONAL MATCH with chain and WHERE returns null when no match', () => {
      const ast = parseCypher(
        'MATCH (a:User) OPTIONAL MATCH (a)-[r:FRIEND]->(b:User) WHERE b.name = "Unknown" RETURN a, b',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
      for (const row of results) expect(row.b).toBeNull();
    });

    it('OPTIONAL MATCH with chain and WHERE returns match when found', () => {
      const ast = parseCypher(
        'MATCH (a:User) OPTIONAL MATCH (a)-[r:FRIEND]->(b:User) WHERE b.name = "Bob" RETURN a, b',
      );
      const results = engine.execute(ast);
      // Alice→Bob matches, Bob→Charlie doesn't match WHERE, Charlie has no FRIEND outbound
      expect(results.length).toBe(4);
      const matches = results.filter((r) => r.b !== null);
      expect(matches.length).toBe(1);
      expect(node(matches[0]!, 'a').name).toBe('Alice');
      expect(node(matches[0]!, 'b').name).toBe('Bob');
    });
  });

  describe('execute - edge attributes', () => {
    it('returns edge attributes when relationship variable is bound', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN r',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const edges = results[0]!.r as Array<{ type: string }>;
      expect(Array.isArray(edges)).toBe(true);
      expect(edges[0]!.type).toBe('FRIEND');
    });

    it('returns edge id in relationship data', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN r',
      );
      const results = engine.execute(ast);
      const edges = results[0]!.r as Array<{ id: string }>;
      expect(edges[0]!.id).toBeDefined();
      expect(typeof edges[0]!.id).toBe('string');
    });
  });

  describe('execute - self-loops', () => {
    it('handles self-loop edges correctly', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addEdge('a', 'a', { type: 'SELF' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (a:Node)-[r:SELF]->(b:Node) RETURN a.name AS from, b.name AS to');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.from).toBe('A');
      expect(results[0]!.to).toBe('A');
    });

    it('handles self-loop with variable-length path (cycle guard prevents depth 2)', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addEdge('a', 'a', { type: 'SELF' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (a:Node)-[r:SELF*1..2]->(b:Node) RETURN a, b');
      const results = e.execute(ast);
      // DFS visited set prevents re-visiting A, so only depth-1 match is found
      expect(results.length).toBe(1);
    });
  });

  describe('execute - multiple WRITE stages', () => {
    it('executes SET then DELETE in sequence', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Dave"}) SET u.age = 99 DELETE u',
      );
      engine.execute(ast);
      expect(graph.hasNode('dave')).toBe(false);
    });

    it('executes CREATE then SET on different nodes', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) CREATE (n:User {name: "Eve", age: 22}) SET u.age = 99 RETURN u, n',
      );
      const results = engine.execute(ast);
      expect(node(results[0]!, 'u').age).toBe(99);
      expect(node(results[0]!, 'n').name).toBe('Eve');
    });

    it('executes CREATE then SET on the created node', () => {
      const ast = parseCypher(
        'CREATE (n:User {name: "Eve", age: 22}) SET n.age = 25 RETURN n',
      );
      const results = engine.execute(ast);
      expect(node(results[0]!, 'n').age).toBe(25);
    });
  });

  describe('execute - mixed aggregation error', () => {
    it('throws when non-aggregation varies across rows in RETURN without WITH', () => {
      const ast = parseCypher(
        'MATCH (u:User) RETURN u.name AS name, count(u) AS total',
      );
      expect(() => engine.execute(ast)).toThrow(/Mixed aggregation/i);
    });

    it('does not throw when non-aggregation is constant in RETURN without WITH', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User) RETURN u.name AS name, count(u) AS total',
      );
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.total).toBe(1);
    });
  });

  describe('execute - OPTIONAL MATCH edge cases', () => {
    it('preserves source variable in OPTIONAL MATCH with no match', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Charlie"}) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) RETURN u.name AS name, f',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Charlie');
      expect(results[0]!.f).toBeNull();
    });

    it('nulls relationship variable in OPTIONAL MATCH with no match', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Charlie"}) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) RETURN u, r',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.r).toEqual([]);
    });

    it('handles OPTIONAL MATCH with multiple possible matches', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) OPTIONAL MATCH (u)-[r]-(other:User) RETURN u.name AS name, other.name AS otherName',
      );
      const results = engine.execute(ast);
      // Alice has 2 undirected connections: Bob (FRIEND) and Dave (KNOWS)
      expect(results.length).toBe(2);
      const otherNames = results.map(r => r.otherName).sort();
      expect(otherNames).toEqual(['Bob', 'Dave']);
    });
  });

  describe('execute - diamond-graph DFS paths', () => {
    // Diamond: A─►D, A─►B─►D, A─►C─►D
    let diamondGraph: GraphInstance;
    let diamondEngine: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      diamondGraph = new Graph();
      diamondGraph.addNode('a', { label: 'Node', name: 'A' });
      diamondGraph.addNode('b', { label: 'Node', name: 'B' });
      diamondGraph.addNode('c', { label: 'Node', name: 'C' });
      diamondGraph.addNode('d', { label: 'Node', name: 'D' });
      diamondGraph.addEdge('a', 'd', { type: 'LINK' });
      diamondGraph.addEdge('a', 'b', { type: 'LINK' });
      diamondGraph.addEdge('b', 'd', { type: 'LINK' });
      diamondGraph.addEdge('a', 'c', { type: 'LINK' });
      diamondGraph.addEdge('c', 'd', { type: 'LINK' });
      diamondEngine = new AdvancedCypherGraphologyEngine(diamondGraph);
    });

    it('finds all three paths in a diamond graph with [*1..2]', () => {
      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..2]->(d:Node {name: "D"}) RETURN a, d');
      const results = diamondEngine.execute(ast);
      // A→D (depth 1), A→B→D (depth 2), A→C→D (depth 2)
      expect(results.length).toBe(3);
    });

    it('finds only the direct edge in diamond graph with [*1..1]', () => {
      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..1]->(d:Node {name: "D"}) RETURN a, d');
      const results = diamondEngine.execute(ast);
      expect(results.length).toBe(1);
    });

    it('finds all paths in complex diamond with [*1..3]', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addNode('b', { label: 'Node', name: 'B' });
      g.addNode('c', { label: 'Node', name: 'C' });
      g.addNode('d', { label: 'Node', name: 'D' });
      g.addEdge('a', 'b', { type: 'LINK' });
      g.addEdge('a', 'c', { type: 'LINK' });
      g.addEdge('b', 'd', { type: 'LINK' });
      g.addEdge('b', 'c', { type: 'LINK' });
      g.addEdge('c', 'd', { type: 'LINK' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..3]->(d:Node {name: "D"}) RETURN a, d');
      const results = e.execute(ast);
      // A→B→D, A→C→D, A→B→C→D
      expect(results.length).toBe(3);
    });

    it('captures correct edge history for each diamond path', () => {
      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..2]->(d:Node {name: "D"}) RETURN a, d, r');
      const results = diamondEngine.execute(ast);
      expect(results.length).toBe(3);
      for (const row of results) {
        expect(Array.isArray(row.r)).toBe(true);
        expect((row.r as Array<{ id: string }>).length).toBeGreaterThanOrEqual(1);
        expect((row.r as Array<{ id: string }>).length).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('execute - SET mutation across duplicate contexts', () => {
    // X─►Z, Y─►Z  (two contexts both binding z to the same node)
    let sharedGraph: GraphInstance;
    let sharedEngine: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      sharedGraph = new Graph();
      sharedGraph.addNode('x', { label: 'Source', name: 'X', value: 10 });
      sharedGraph.addNode('y', { label: 'Source', name: 'Y', value: 20 });
      sharedGraph.addNode('z', { label: 'Target', name: 'Z', value: 100 });
      sharedGraph.addEdge('x', 'z', { type: 'REF' });
      sharedGraph.addEdge('y', 'z', { type: 'REF' });
      sharedEngine = new AdvancedCypherGraphologyEngine(sharedGraph);
    });

    it('updates shared node in all contexts after SET', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) SET z.value = 999 RETURN z.value AS zVal');
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      for (const row of results) {
        expect(row.zVal).toBe(999);
      }
    });

    it('reflects SET in a subsequent MATCH stage', () => {
      const ast = parseCypher(
        'MATCH (s:Source)-[r:REF]->(z:Target) SET z.value = 999 MATCH (z:Target {value: 999}) RETURN z.name AS zName',
      );
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      for (const row of results) {
        expect(row.zName).toBe('Z');
      }
    });

    it('reflects SET in RETURN after MATCH-SET pipeline', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) SET z.value = 999 RETURN s.name AS source, z.value AS zVal');
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      expect(results.map((r) => r.source).sort()).toEqual(['X', 'Y']);
      for (const row of results) {
        expect(row.zVal).toBe(999);
      }
    });
  });

  describe('execute - ORDER BY', () => {
    it('sorts results in ascending order by default', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name');
      const results = engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    });

    it('sorts results in ascending order with explicit ASC', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name ASC');
      const results = engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    });

    it('sorts results in descending order with DESC', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name DESC');
      const results = engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Dave', 'Charlie', 'Bob', 'Alice']);
    });

    it('sorts by numeric property ascending', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC');
      const results = engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Bob', 'Dave', 'Alice', 'Charlie']); // 25, 28, 30, 35
    });

    it('sorts by numeric property descending', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC');
      const results = engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Charlie', 'Alice', 'Dave', 'Bob']); // 35, 30, 28, 25
    });

    it('sorts by multiple columns', () => {
      // Create graph with same ages to test secondary sort
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', age: 30 });
      g.addNode('b', { label: 'User', name: 'Bob', age: 30 });
      g.addNode('c', { label: 'User', name: 'Charlie', age: 25 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC, u.name ASC');
      const results = e.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Charlie', 'Alice', 'Bob']); // Charlie(25), Alice(30), Bob(30)
    });

    it('sorts with multiple columns where secondary sort is DESC', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', age: 30 });
      g.addNode('b', { label: 'User', name: 'Bob', age: 30 });
      g.addNode('c', { label: 'User', name: 'Charlie', age: 25 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC, u.name DESC');
      const results = e.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Charlie', 'Bob', 'Alice']); // Charlie(25), Bob(30), Alice(30)
    });

    it('handles ORDER BY with no matching results', () => {
      const ast = parseCypher('MATCH (u:User {name: "NonExistent"}) RETURN u.name ORDER BY u.name');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('handles ORDER BY on aggregated results', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount RETURN name, friendCount ORDER BY friendCount DESC, name ASC'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      // Both have friendCount=1, so secondary sort by name ASC
      expect(results[0]!.name).toBe('Alice');
      expect(results[1]!.name).toBe('Bob');
    });
  });

  describe('execute - LIMIT', () => {
    it('limits results to specified count', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 2');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('limits to 1 result', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 1');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
    });

    it('limit larger than result set returns all results', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 100');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('limit 0 returns empty array', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 0');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('LIMIT with no matching results returns empty array', () => {
      const ast = parseCypher('MATCH (u:User {name: "NonExistent"}) RETURN u.name LIMIT 5');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });
  });

  describe('execute - ORDER BY + LIMIT combined', () => {
    it('sorts then limits results', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC LIMIT 2');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!.name).toBe('Charlie'); // age 35
      expect(results[1]!.name).toBe('Alice');   // age 30
    });

    it('limits then sorts with ORDER BY before LIMIT', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name ASC LIMIT 3');
      const results = engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results.map(r => r.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('works with aggregations: ORDER BY + LIMIT on WITH', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[]->(b:User) WITH a.name AS name, count(b) AS outDegree ORDER BY outDegree DESC LIMIT 1 RETURN name, outDegree'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      // Alice has 2 outgoing edges (FRIEND to Bob, KNOWS to Dave)
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.outDegree).toBe(2);
    });

    it('works with aggregations: ORDER BY on RETURN after WITH', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[]->(b:User) WITH a.name AS name, count(b) AS outDegree RETURN name, outDegree ORDER BY outDegree DESC'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      // Alice has 2 outgoing, Bob has 1
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.outDegree).toBe(2);
      expect(results[1]!.name).toBe('Bob');
      expect(results[1]!.outDegree).toBe(1);
    });
  });

  describe('execute - SKIP', () => {
    it('skips first N results', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 2');
      const results = engine.execute(ast);
      expect(results.length).toBe(2); // 4 total - 2 skipped
    });

    it('skip 0 returns all results', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 0');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('skip larger than result set returns empty', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 100');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('skip with no matching results returns empty', () => {
      const ast = parseCypher('MATCH (u:User {name: "NonExistent"}) RETURN u.name SKIP 0');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });
  });

  describe('execute - SKIP + LIMIT combined', () => {
    it('skips then limits results', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 1 LIMIT 2');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('skip + limit where skip+limit exceeds total', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 3 LIMIT 10');
      const results = engine.execute(ast);
      expect(results.length).toBe(1); // 4 total - 3 skipped = 1
    });

    it('ORDER BY + SKIP + LIMIT for pagination', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name ASC SKIP 2 LIMIT 1');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      // Sorted: Alice, Bob, Charlie, Dave → skip 2 → Charlie, Dave → limit 1 → Charlie
      expect(results[0]!.name).toBe('Charlie');
    });

    it('ORDER BY DESC + SKIP + LIMIT', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name DESC SKIP 1 LIMIT 2');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      // Sorted DESC: Dave, Charlie, Bob, Alice → skip 1 → Charlie, Bob, Alice → limit 2 → Charlie, Bob
      expect(results[0]!.name).toBe('Charlie');
      expect(results[1]!.name).toBe('Bob');
    });

    it('SKIP on WITH clause', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[]->(b:User) WITH a.name AS name, count(b) AS outDegree SKIP 1 RETURN name, outDegree'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1); // 2 groups - 1 skipped
    });

    it('ORDER BY + SKIP + LIMIT on WITH clause', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[]->(b:User) WITH a.name AS name, count(b) AS outDegree ORDER BY outDegree DESC SKIP 1 LIMIT 1 RETURN name, outDegree'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      // Alice has 2, Bob has 1 → sorted DESC → skip 1 → Bob
      expect(results[0]!.name).toBe('Bob');
      expect(results[0]!.outDegree).toBe(1);
    });
  });

  describe('execute - DELETE mutation across duplicate contexts', () => {
    let sharedGraph: GraphInstance;
    let sharedEngine: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      sharedGraph = new Graph();
      sharedGraph.addNode('x', { label: 'Source', name: 'X', value: 10 });
      sharedGraph.addNode('y', { label: 'Source', name: 'Y', value: 20 });
      sharedGraph.addNode('z', { label: 'Target', name: 'Z', value: 100 });
      sharedGraph.addEdge('x', 'z', { type: 'REF' });
      sharedGraph.addEdge('y', 'z', { type: 'REF' });
      sharedEngine = new AdvancedCypherGraphologyEngine(sharedGraph);
    });

    it('nulls shared node in all contexts after DELETE', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) DELETE z RETURN z');
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      for (const row of results) {
        expect(row.z).toBeNull();
      }
    });

    it('drops node from graph after DELETE', () => {
      const ast = parseCypher('MATCH (z:Target) DELETE z RETURN z');
      sharedEngine.execute(ast);
      expect(sharedGraph.hasNode('z')).toBe(false);
    });

    it('does not double-delete when multiple contexts reference same node', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) DELETE z RETURN s.name');
      expect(() => sharedEngine.execute(ast)).not.toThrow();
    });
  });

  describe('execute - index invalidation after mutations', () => {
    let mutGraph: GraphInstance;
    let mutEngine: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      mutGraph = new Graph();
      mutGraph.addNode('a', { label: 'Node', name: 'A' });
      mutGraph.addNode('b', { label: 'Node', name: 'B' });
      const indexes = buildIndexesFromGraph(mutGraph);
      mutEngine = new AdvancedCypherGraphologyEngine(mutGraph, indexes);
    });

    it('sees newly created nodes in subsequent MATCH', () => {
      // CREATE adds a node, then a second MATCH should find it even though
      // indexes are invalidated (falling back to full-graph scan)
      const ast = parseCypher('CREATE (c:Node {name: "C"}) MATCH (n:Node) RETURN count(n) AS total');
      const results = mutEngine.execute(ast);
      expect(results[0]?.total).toBe(3);
    });

    it('sees deleted nodes as absent in subsequent query on same engine', () => {
      // After DELETE, indexes are invalidated. A new query on the same engine
      // should still work via full-graph scan (indexes are undefined after mutation).
      const ast1 = parseCypher('MATCH (n:Node {name: "A"}) DELETE n RETURN n');
      mutEngine.execute(ast1);
      expect(mutGraph.hasNode('a')).toBe(false);

      // New query on the same engine — indexes were invalidated, so it scans the graph
      const ast2 = parseCypher('MATCH (n:Node) RETURN count(n) AS total');
      const results = mutEngine.execute(ast2);
      expect(results[0]?.total).toBe(1);
    });
  });

  describe('execute - WHERE NOT', () => {
    it('filters with NOT on equality', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.name = "Alice" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
    });

    it('filters with NOT on greater-than', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.age > 30 RETURN u',
      );
      const results = engine.execute(ast);
      // Alice (30), Bob (25), Dave (28) — all NOT > 30
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Dave']);
    });

    it('filters with NOT on less-than', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.age < 30 RETURN u',
      );
      const results = engine.execute(ast);
      // Alice (30), Charlie (35) — all NOT < 30
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('filters with NOT on CONTAINS', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.name CONTAINS "Ali" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
    });

    it('filters with NOT on CONTAINS (no match for inner)', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.name CONTAINS "xyz" RETURN u',
      );
      const results = engine.execute(ast);
      // No name contains "xyz", so NOT is true for all
      expect(results.length).toBe(4);
    });

    it('filters with NOT on WITH clause', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS cnt WHERE NOT cnt > 1 RETURN name, cnt',
      );
      const results = engine.execute(ast);
      // Alice cnt=1 (NOT > 1 = true), Bob cnt=1 (NOT > 1 = true)
      expect(results.length).toBe(2);
    });

    it('filters with NOT combined with AND', () => {
      // NOT u.age > 30 AND u.name CONTAINS "ob"
      // Bob (25, NOT > 30 = true, contains "ob" = true) => true
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.age > 30 AND u.name CONTAINS "ob" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Bob');
    });

    it('filters with NOT combined with OR', () => {
      // NOT u.age > 30 OR u.name = "Charlie"
      // Alice (30, NOT > 30 = true) => true
      // Bob (25, NOT > 30 = true) => true
      // Charlie (35, NOT > 30 = false, name = "Charlie" = true) => true
      // Dave (28, NOT > 30 = true) => true
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.age > 30 OR u.name = "Charlie" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('filters with NOT on parenthesized OR', () => {
      // NOT (u.age > 32 OR u.name = "Alice")
      // Alice (30, NOT > 32 = true, name = "Alice" = true) => NOT(true) = false
      // Bob (25, NOT > 32 = false, name = "Bob") => NOT(false) = true
      // Charlie (35, > 32 = true) => NOT(true) = false
      // Dave (28, NOT > 32 = false, name = "Dave") => NOT(false) = true
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT (u.age > 32 OR u.name = "Alice") RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Dave']);
    });

    it('filters with NOT on parenthesized AND', () => {
      // NOT (u.age > 25 AND u.age < 35)
      // Alice (30, > 25 = true, < 35 = true) => NOT(true) = false
      // Bob (25, > 25 = false) => NOT(false) = true
      // Charlie (35, < 35 = false) => NOT(false) = true
      // Dave (28, > 25 = true, < 35 = true) => NOT(true) = false
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT (u.age > 25 AND u.age < 35) RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('filters with double NOT (NOT NOT)', () => {
      // NOT NOT u.name = "Alice" => u.name = "Alice"
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT NOT u.name = "Alice" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('filters with triple NOT (NOT NOT NOT)', () => {
      // NOT NOT NOT u.name = "Alice" => NOT u.name = "Alice"
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT NOT NOT u.name = "Alice" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
    });

    it('filters with NOT on not-equals (<>)', () => {
      // NOT u.name <> "Alice" => u.name = "Alice"
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.name <> "Alice" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('filters with NOT combined with <>', () => {
      // NOT u.age <> 30 AND u.name CONTAINS "li"
      // Alice (30, NOT <> 30 = true, contains "li" = true) => true
      // Bob (25, NOT <> 30 = false) => false
      // Charlie (35, NOT <> 30 = false) => false
      // Dave (28, NOT <> 30 = false) => false
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.age <> 30 AND u.name CONTAINS "li" RETURN u',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });
  });

  describe('execute - WHERE IS NULL', () => {
    let graphWithNulls: GraphInstance;
    let engineWithNulls: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      graphWithNulls = new Graph();
      graphWithNulls.addNode('a', { label: 'User', name: 'Alice', email: 'alice@example.com' });
      graphWithNulls.addNode('b', { label: 'User', name: 'Bob', email: null });
      graphWithNulls.addNode('c', { label: 'User', name: 'Charlie' }); // no email property at all
      graphWithNulls.addNode('d', { label: 'User', name: 'Dave', email: 'dave@example.com' });
      engineWithNulls = new AdvancedCypherGraphologyEngine(graphWithNulls);
    });

    it('filters nodes where property IS NULL (explicit null)', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NULL RETURN u');
      const results = engineWithNulls.execute(ast);
      expect(results.length).toBe(2); // Bob (null) and Charlie (undefined)
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('filters nodes where property IS NOT NULL', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NOT NULL RETURN u');
      const results = engineWithNulls.execute(ast);
      expect(results.length).toBe(2); // Alice and Dave
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Dave']);
    });

    it('IS NULL on a non-existent property returns true', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.phone IS NULL RETURN u');
      const results = engineWithNulls.execute(ast);
      expect(results.length).toBe(4); // All users have no phone property
    });

    it('IS NOT NULL on a non-existent property returns false', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.phone IS NOT NULL RETURN u');
      const results = engineWithNulls.execute(ast);
      expect(results.length).toBe(0);
    });

    it('IS NULL combined with AND', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NULL AND u.name = "Bob" RETURN u');
      const results = engineWithNulls.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Bob');
    });

    it('IS NOT NULL combined with AND', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NOT NULL AND u.name = "Alice" RETURN u');
      const results = engineWithNulls.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('IS NULL combined with OR', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NULL OR u.name = "Alice" RETURN u');
      const results = engineWithNulls.execute(ast);
      // Bob (email=null), Charlie (email=undefined), Alice (name="Alice")
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('IS NOT NULL combined with OR', () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NOT NULL OR u.name = "Charlie" RETURN u');
      const results = engineWithNulls.execute(ast);
      // Alice (email not null), Dave (email not null), Charlie (name="Charlie")
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie', 'Dave']);
    });

    it('IS NULL on WITH clause', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'A', value: 10 });
      g.addNode('b', { label: 'Item', name: 'B', value: null });
      g.addNode('c', { label: 'Item', name: 'C' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (i:Item) WITH i.name AS name, i.value AS value WHERE value IS NULL RETURN name',
      );
      const results = e.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => r.name).sort();
      expect(names).toEqual(['B', 'C']);
    });

    it('IS NOT NULL on WITH clause', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'A', value: 10 });
      g.addNode('b', { label: 'Item', name: 'B', value: null });
      g.addNode('c', { label: 'Item', name: 'C' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (i:Item) WITH i.name AS name, i.value AS value WHERE value IS NOT NULL RETURN name, value',
      );
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('A');
      expect(results[0]!.value).toBe(10);
    });

    it('IS NULL with relationship traversal', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob', email: null });
      g.addNode('c', { label: 'User', name: 'Charlie', email: 'charlie@example.com' });
      g.addEdge('a', 'b', { type: 'FRIEND' });
      g.addEdge('a', 'c', { type: 'FRIEND' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User)-[r:FRIEND]->(f:User) WHERE f.email IS NULL RETURN u.name AS from, f.name AS to',
      );
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.from).toBe('Alice');
      expect(results[0]!.to).toBe('Bob');
    });

    it('IS NOT NULL with relationship traversal', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob', email: null });
      g.addNode('c', { label: 'User', name: 'Charlie', email: 'charlie@example.com' });
      g.addEdge('a', 'b', { type: 'FRIEND' });
      g.addEdge('a', 'c', { type: 'FRIEND' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User)-[r:FRIEND]->(f:User) WHERE f.email IS NOT NULL RETURN u.name AS from, f.name AS to',
      );
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.from).toBe('Alice');
      expect(results[0]!.to).toBe('Charlie');
    });

    it('IS NULL combined with CONTAINS', () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.email IS NULL OR u.name CONTAINS "Dav" RETURN u',
      );
      const results = engineWithNulls.execute(ast);
      // Bob (email=null), Charlie (email=undefined), Dave (contains "Dav")
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
    });

    it('IS NOT NULL combined with comparison', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'A', value: 10, score: 85 });
      g.addNode('b', { label: 'Item', name: 'B', value: null, score: 90 });
      g.addNode('c', { label: 'Item', name: 'C', value: 5, score: 70 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (i:Item) WHERE i.value IS NOT NULL AND i.score > 80 RETURN i.name',
      );
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('A');
    });

    it('IS NULL on OPTIONAL MATCH null variable', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) WHERE f IS NULL RETURN u.name, f',
      );
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      g.addEdge('bob', 'alice', { type: 'FRIEND' }); // Bob→Alice, not Alice→Bob
      const e = new AdvancedCypherGraphologyEngine(g);

      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.f).toBeNull();
    });

    it('IS NOT NULL in OPTIONAL MATCH WHERE filters matches but null-fill still produced', () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      g.addNode('charlie', { label: 'User', name: 'Charlie' });
      g.addEdge('alice', 'bob', { type: 'FRIEND' });
      // Charlie has no FRIEND outbound
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) WHERE f IS NOT NULL RETURN u.name AS from, f',
      );
      const results = e.execute(ast);
      // Alice→Bob (f is not null, passes WHERE)
      // Bob→null (no match, null-fill added — WHERE on OPTIONAL MATCH does not suppress null-fill)
      // Charlie→null (no match, null-fill added)
      expect(results.length).toBe(3);
      const aliceResult = results.find(r => r.from === 'Alice');
      expect(aliceResult).toBeDefined();
      expect(aliceResult!.f).not.toBeNull();
      const bobResult = results.find(r => r.from === 'Bob');
      expect(bobResult!.f).toBeNull();
      const charlieResult = results.find(r => r.from === 'Charlie');
      expect(charlieResult!.f).toBeNull();
    });
  });
});
