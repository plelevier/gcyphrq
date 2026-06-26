import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance } from './engine-setup';

describe('Engine - ORDER BY / LIMIT / SKIP', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createTestGraph();
    engine = createEngine(graph);
  });

  describe('execute - ORDER BY', () => {
    it('sorts results in ascending order by default', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name');
      const results = await engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    });

    it('sorts results in ascending order with explicit ASC', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name ASC');
      const results = await engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    });

    it('sorts results in descending order with DESC', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name DESC');
      const results = await engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Dave', 'Charlie', 'Bob', 'Alice']);
    });

    it('sorts by numeric property ascending', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC');
      const results = await engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Bob', 'Dave', 'Alice', 'Charlie']);
    });

    it('sorts by numeric property descending', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC');
      const results = await engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Charlie', 'Alice', 'Dave', 'Bob']);
    });

    it('sorts by multiple columns', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', age: 30 });
      g.addNode('b', { label: 'User', name: 'Bob', age: 30 });
      g.addNode('c', { label: 'User', name: 'Charlie', age: 25 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC, u.name ASC');
      const results = await e.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Charlie', 'Alice', 'Bob']);
    });

    it('sorts with multiple columns where secondary sort is DESC', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', age: 30 });
      g.addNode('b', { label: 'User', name: 'Bob', age: 30 });
      g.addNode('c', { label: 'User', name: 'Charlie', age: 25 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC, u.name DESC');
      const results = await e.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Charlie', 'Bob', 'Alice']);
    });

    it('handles ORDER BY with no matching results', async () => {
      const ast = parseCypher('MATCH (u:User {name: "NonExistent"}) RETURN u.name ORDER BY u.name');
      const results = await engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('handles ORDER BY on aggregated results', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount RETURN name, friendCount ORDER BY friendCount DESC, name ASC'
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!.name).toBe('Alice');
      expect(results[1]!.name).toBe('Bob');
    });
  });

  describe('execute - LIMIT', () => {
    it('limits results to specified count', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 2');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('limits to 1 result', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 1');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
    });

    it('limit larger than result set returns all results', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 100');
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('limit 0 returns empty array', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 0');
      const results = await engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('LIMIT with no matching results returns empty array', async () => {
      const ast = parseCypher('MATCH (u:User {name: "NonExistent"}) RETURN u.name LIMIT 5');
      const results = await engine.execute(ast);
      expect(results).toEqual([]);
    });
  });

  describe('execute - ORDER BY + LIMIT combined', () => {
    it('sorts then limits results', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC LIMIT 2');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!.name).toBe('Charlie');
      expect(results[1]!.name).toBe('Alice');
    });

    it('limits then sorts with ORDER BY before LIMIT', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name ASC LIMIT 3');
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results.map(r => r.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('works with aggregations: ORDER BY + LIMIT on WITH', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[]->(b:User) WITH a.name AS name, count(b) AS outDegree ORDER BY outDegree DESC LIMIT 1 RETURN name, outDegree'
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.outDegree).toBe(2);
    });

    it('works with aggregations: ORDER BY on RETURN after WITH', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[]->(b:User) WITH a.name AS name, count(b) AS outDegree RETURN name, outDegree ORDER BY outDegree DESC'
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.outDegree).toBe(2);
      expect(results[1]!.name).toBe('Bob');
      expect(results[1]!.outDegree).toBe(1);
    });
  });

  describe('execute - SKIP', () => {
    it('skips first N results', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 2');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('skip 0 returns all results', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 0');
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('skip larger than result set returns empty', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 100');
      const results = await engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('skip with no matching results returns empty', async () => {
      const ast = parseCypher('MATCH (u:User {name: "NonExistent"}) RETURN u.name SKIP 0');
      const results = await engine.execute(ast);
      expect(results).toEqual([]);
    });
  });

  describe('execute - SKIP + LIMIT combined', () => {
    it('skips then limits results', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 1 LIMIT 2');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('skip + limit where skip+limit exceeds total', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 3 LIMIT 10');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
    });

    it('ORDER BY + SKIP + LIMIT for pagination', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name ASC SKIP 2 LIMIT 1');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Charlie');
    });

    it('ORDER BY DESC + SKIP + LIMIT', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name DESC SKIP 1 LIMIT 2');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!.name).toBe('Charlie');
      expect(results[1]!.name).toBe('Bob');
    });

    it('SKIP on WITH clause', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[]->(b:User) WITH a.name AS name, count(b) AS outDegree SKIP 1 RETURN name, outDegree'
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
    });

    it('ORDER BY + SKIP + LIMIT on WITH clause', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[]->(b:User) WITH a.name AS name, count(b) AS outDegree ORDER BY outDegree DESC SKIP 1 LIMIT 1 RETURN name, outDegree'
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Bob');
      expect(results[0]!.outDegree).toBe(1);
    });
  });
});
