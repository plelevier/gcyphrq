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
      expect(aliceResult?.totalAge).toBe(25);
    });

    it('aggregates with AVG', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, avg(b.age) AS avgAge RETURN name, avgAge'
      );
      const results = engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.avgAge).toBe(25);
    });

    it('aggregates with AVG across multiple values', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r]-(other:User) WITH a.name AS name, avg(other.age) AS avgAge RETURN name, avgAge'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.avgAge).toBe(26.5);
    });

    it('aggregates with MIN', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, min(b.age) AS minAge RETURN name, minAge'
      );
      const results = engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.minAge).toBe(25);
    });

    it('aggregates with MIN across multiple values', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r]-(other:User) WITH a.name AS name, min(other.age) AS minAge RETURN name, minAge'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.minAge).toBe(25);
    });

    it('aggregates with MAX', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, max(b.age) AS maxAge RETURN name, maxAge'
      );
      const results = engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.maxAge).toBe(25);
    });

    it('aggregates with MAX across multiple values', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r]-(other:User) WITH a.name AS name, max(other.age) AS maxAge RETURN name, maxAge'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.maxAge).toBe(28);
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
      expect(results[0]!.avgAge).toBe(29.5);
    });

    it('aggregates with MIN in RETURN without WITH', () => {
      const ast = parseCypher('MATCH (u:User) RETURN min(u.age) AS minAge');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.minAge).toBe(25);
    });

    it('aggregates with MAX in RETURN without WITH', () => {
      const ast = parseCypher('MATCH (u:User) RETURN max(u.age) AS maxAge');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.maxAge).toBe(35);
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
});
