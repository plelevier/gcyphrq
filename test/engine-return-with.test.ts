import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance } from './engine-setup';

describe('Engine - RETURN / WITH / multi-stage', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createTestGraph();
    engine = createEngine(graph);
  });

  describe('execute - RETURN', () => {
    it('returns projected properties with AS alias', async () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u.name AS name, u.age AS age');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.age).toBe(30);
    });

    it('returns projected properties using property name as default alias', async () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u.name, u.age');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.age).toBe(30);
    });

    it('returns full node objects', async () => {
      const ast = parseCypher('MATCH (u:User {name: "Bob"}) RETURN u');
      const results = await engine.execute(ast);
      expect(node(results[0]!, 'u').name).toBe('Bob');
      expect(node(results[0]!, 'u').age).toBe(25);
    });

    it('returns literal values', async () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u.name AS name, "Hello" AS greeting');
      const results = await engine.execute(ast);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.greeting).toBe('Hello');
    });
  });

  describe('execute - WITH', () => {
    it('groups and aggregates with COUNT', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount RETURN name, friendCount'
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.friendCount).toBe(1);
      const bobResult = results.find(r => r.name === 'Bob');
      expect(bobResult?.friendCount).toBe(1);
    });

    it('filters aggregated results with WHERE', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount WHERE friendCount > 0 RETURN name, friendCount'
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('aggregates with SUM', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, sum(b.age) AS totalAge RETURN name, totalAge'
      );
      const results = await engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.totalAge).toBe(25);
    });

    it('aggregates with AVG', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, avg(b.age) AS avgAge RETURN name, avgAge'
      );
      const results = await engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.avgAge).toBe(25);
    });

    it('aggregates with AVG across multiple values', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r]-(other:User) WITH a.name AS name, avg(other.age) AS avgAge RETURN name, avgAge'
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.avgAge).toBe(26.5);
    });

    it('aggregates with MIN', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, min(b.age) AS minAge RETURN name, minAge'
      );
      const results = await engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.minAge).toBe(25);
    });

    it('aggregates with MIN across multiple values', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r]-(other:User) WITH a.name AS name, min(other.age) AS minAge RETURN name, minAge'
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.minAge).toBe(25);
    });

    it('aggregates with MAX', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, max(b.age) AS maxAge RETURN name, maxAge'
      );
      const results = await engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.maxAge).toBe(25);
    });

    it('aggregates with MAX across multiple values', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r]-(other:User) WITH a.name AS name, max(other.age) AS maxAge RETURN name, maxAge'
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.maxAge).toBe(28);
    });

    it('AVG returns null when no numeric values in group', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: null });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:Item) WITH n.label AS label, avg(n.value) AS avgVal RETURN label, avgVal');
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.avgVal).toBeNull();
    });

    it('MIN returns null when no numeric values in group', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: null });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:Item) WITH n.label AS label, min(n.value) AS minVal RETURN label, minVal');
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.minVal).toBeNull();
    });

    it('MAX returns null when no numeric values in group', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: null });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:Item) WITH n.label AS label, max(n.value) AS maxVal RETURN label, maxVal');
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.maxVal).toBeNull();
    });

    it('WITH with aggregations on no matches produces one row with defaults', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: 1 });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:NonExistent) WITH count(*) AS c, collect(n.value) AS vals RETURN c, vals');
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.c).toBe(0);
      expect(results[0]!.vals).toEqual([]);
    });

    it('WITH with aggregations on no matches respects WHERE filter', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: 1 });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:NonExistent) WITH count(*) AS c WHERE c > 0 RETURN c');
      const results = await e.execute(ast);
      expect(results.length).toBe(0);
    });
  });

  describe('execute - multi-stage queries', () => {
    it('executes MATCH-WITH-RETURN pipeline', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount RETURN name, friendCount'
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('executes MATCH-CREATE-RETURN', async () => {
      const initialCount = graph.order;
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) CREATE (n:User {name: "Eve"}) RETURN u, n');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
      expect(node(results[0]!, 'n').name).toBe('Eve');
      expect(graph.order).toBe(initialCount + 1);
    });
  });

  describe('edge cases', () => {
    it('returns empty array when no match is found', async () => {
      const ast = parseCypher('MATCH (u:User {name: "NonExistent"}) RETURN u');
      const results = await engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('returns empty array when no RETURN clause exists', async () => {
      const ast = parseCypher('MATCH (u:User)');
      const results = await engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('traverses undirected relationship without type or variable', async () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r]-(b:User) RETURN a.name AS from, b.name AS to');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => `${r.from}->${r.to}`).sort();
      expect(names).toEqual(['Alice->Bob', 'Alice->Dave']);
    });

    it('resolves alias collisions with var.prop fallback', async () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a.name, b.name');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!).toHaveProperty('a.name');
      expect(results[0]!).toHaveProperty('b.name');
    });

    it('aggregates with COUNT in RETURN without WITH', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN count(u) AS total');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.total).toBe(4);
    });

    it('aggregates with SUM in RETURN without WITH', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN sum(u.age) AS totalAge');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.totalAge).toBe(118);
    });

    it('aggregates with AVG in RETURN without WITH', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN avg(u.age) AS avgAge');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.avgAge).toBe(29.5);
    });

    it('aggregates with MIN in RETURN without WITH', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN min(u.age) AS minAge');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.minAge).toBe(25);
    });

    it('aggregates with MAX in RETURN without WITH', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN max(u.age) AS maxAge');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.maxAge).toBe(35);
    });

    it('aggregates with multiple functions in RETURN without WITH', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN count(u) AS total, avg(u.age) AS avgAge, min(u.age) AS minAge, max(u.age) AS maxAge');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.total).toBe(4);
      expect(results[0]!.avgAge).toBe(29.5);
      expect(results[0]!.minAge).toBe(25);
      expect(results[0]!.maxAge).toBe(35);
    });

    it('implicitly groups by non-aggregated column with relationship traversal in RETURN', async () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a.name AS service, count(b) AS deps');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const map = new Map(results.map((r) => [r.service, r.deps]));
      expect(map.get('Alice')).toBe(1);
      expect(map.get('Bob')).toBe(1);
    });

    it('implicitly groups with multiple aggregations per group in RETURN', async () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a.name AS name, count(b) AS friendCount, avg(b.age) AS avgFriendAge');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const alice = results.find((r) => r.name === 'Alice');
      expect(alice?.friendCount).toBe(1);
      expect(alice?.avgFriendAge).toBe(25);
      const bob = results.find((r) => r.name === 'Bob');
      expect(bob?.friendCount).toBe(1);
      expect(bob?.avgFriendAge).toBe(35);
    });

    it('implicitly groups with ORDER BY on aggregated column in RETURN', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Service', name: 'A' });
      g.addNode('b', { label: 'Service', name: 'B' });
      g.addNode('c', { label: 'Service', name: 'C' });
      g.addNode('d', { label: 'Service', name: 'D' });
      g.addEdge('a', 'b', { type: 'DEPENDS_ON' });
      g.addEdge('a', 'c', { type: 'DEPENDS_ON' });
      g.addEdge('a', 'd', { type: 'DEPENDS_ON' });
      g.addEdge('b', 'c', { type: 'DEPENDS_ON' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (s:Service)-[:DEPENDS_ON]->(dep:Service) RETURN s.name AS service, count(dep) AS deps ORDER BY deps DESC');
      const results = await e.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!.service).toBe('A');
      expect(results[0]!.deps).toBe(3);
      expect(results[1]!.service).toBe('B');
      expect(results[1]!.deps).toBe(1);
    });

    it('handles multiple matches from different start nodes', async () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a.name AS from, b.name AS to');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const pairs = results.map(r => `${r.from}->${r.to}`).sort();
      expect(pairs).toEqual(['Alice->Bob', 'Bob->Charlie']);
    });

    it('captures relationship data when variable is bound', async () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN a, b, r');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.r).toBeDefined();
      expect(Array.isArray(results[0]!.r)).toBe(true);
    });
  });
});
