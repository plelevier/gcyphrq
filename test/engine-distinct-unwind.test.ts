import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance } from './engine-setup';

describe('Engine - DISTINCT / UNWIND / mixed aggregation', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createTestGraph();
    engine = createEngine(graph);
  });

  describe('execute - DISTINCT', () => {
    it('RETURN DISTINCT deduplicates results', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', dept: 'Eng' });
      g.addNode('b', { label: 'User', name: 'Bob', dept: 'Eng' });
      g.addNode('c', { label: 'User', name: 'Charlie', dept: 'Sales' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN DISTINCT u.dept');
      const results = await e.execute(ast);
      expect(results.length).toBe(2);
      const depts = results.map((r) => r.dept).sort();
      expect(depts).toEqual(['Eng', 'Sales']);
    });

    it('RETURN DISTINCT with no duplicates returns all', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN DISTINCT u.name');
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('RETURN DISTINCT with ORDER BY', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', dept: 'Sales' });
      g.addNode('b', { label: 'User', name: 'Bob', dept: 'Eng' });
      g.addNode('c', { label: 'User', name: 'Charlie', dept: 'Eng' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN DISTINCT u.dept ORDER BY u.dept');
      const results = await e.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!.dept).toBe('Eng');
      expect(results[1]!.dept).toBe('Sales');
    });

    it('count(DISTINCT x) counts unique values', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', dept: 'Eng' });
      g.addNode('b', { label: 'User', name: 'Bob', dept: 'Eng' });
      g.addNode('c', { label: 'User', name: 'Charlie', dept: 'Sales' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN count(DISTINCT u.dept) AS uniqueDepts');
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.uniqueDepts).toBe(2);
    });

    it('count(DISTINCT x) with all unique values', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN count(DISTINCT u.name) AS uniqueNames');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.uniqueNames).toBe(4);
    });

    it('count(DISTINCT x.property) with numeric values', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', score: 10 });
      g.addNode('b', { label: 'User', name: 'Bob', score: 10 });
      g.addNode('c', { label: 'User', name: 'Charlie', score: 20 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN count(DISTINCT u.score) AS uniqueScores');
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.uniqueScores).toBe(2);
    });

    it('sum(DISTINCT x) sums unique values', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', score: 10 });
      g.addNode('b', { label: 'User', name: 'Bob', score: 10 });
      g.addNode('c', { label: 'User', name: 'Charlie', score: 20 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN sum(DISTINCT u.score) AS total');
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.total).toBe(30);
    });

    it('avg(DISTINCT x) averages unique values', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', score: 10 });
      g.addNode('b', { label: 'User', name: 'Bob', score: 10 });
      g.addNode('c', { label: 'User', name: 'Charlie', score: 20 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN avg(DISTINCT u.score) AS avgScore');
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.avgScore).toBe(15);
    });

    it('count(DISTINCT x) in WITH clause', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', dept: 'Eng' });
      g.addNode('b', { label: 'User', name: 'Bob', dept: 'Eng' });
      g.addNode('c', { label: 'User', name: 'Charlie', dept: 'Sales' });
      g.addEdge('a', 'b', { type: 'COLLEAGUE' });
      g.addEdge('b', 'a', { type: 'COLLEAGUE' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User)-[r:COLLEAGUE]->(c:User) WITH u.name AS name, count(DISTINCT c.name) AS uniqueColleagues RETURN name, uniqueColleagues',
      );
      const results = await e.execute(ast);
      expect(results.length).toBe(2);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.uniqueColleagues).toBe(1);
    });
  });

  describe('execute - UNWIND', () => {
    it('expands a list literal into rows', async () => {
      const ast = parseCypher('UNWIND [1, 2, 3] AS x RETURN x');
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]?.x).toBe(1);
      expect(results[1]?.x).toBe(2);
      expect(results[2]?.x).toBe(3);
    });

    it('expands a string list into rows', async () => {
      const ast = parseCypher('UNWIND ["Alice", "Bob"] AS name RETURN name');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]?.name).toBe('Alice');
      expect(results[1]?.name).toBe('Bob');
    });

    it('drops rows when the list is null', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', tags: null });
      g.addNode('b', { label: 'User', name: 'Bob', tags: ['dev', 'ops'] });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) UNWIND u.tags AS tag RETURN u.name, tag');
      const results = await e.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]?.name).toBe('Bob');
      expect(results[1]?.name).toBe('Bob');
    });

    it('drops rows when the list property is missing', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob', tags: ['dev'] });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) UNWIND u.tags AS tag RETURN u.name, tag');
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]?.name).toBe('Bob');
      expect(results[0]?.tag).toBe('dev');
    });

    it('UNWIND with MATCH and aggregation', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', tags: ['dev', 'ops', 'dev'] });
      g.addNode('b', { label: 'User', name: 'Bob', tags: ['ops'] });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) UNWIND u.tags AS tag WITH u.name AS name, tag RETURN name, tag ORDER BY name, tag');
      const results = await e.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]?.name).toBe('Alice');
      expect(results[0]?.tag).toBe('dev');
      expect(results[1]?.name).toBe('Alice');
      expect(results[1]?.tag).toBe('ops');
      expect(results[2]?.name).toBe('Bob');
      expect(results[2]?.tag).toBe('ops');
    });

    it('UNWIND with aggregation (count)', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', tags: ['dev', 'ops', 'dev'] });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) UNWIND u.tags AS tag WITH u.name AS name, count(tag) AS tagCount RETURN name, tagCount');
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]?.name).toBe('Alice');
      expect(results[0]?.tagCount).toBe(3);
    });

    it('UNWIND standalone with count', async () => {
      const ast = parseCypher('UNWIND [1, 2, 3, 4, 5] AS x RETURN count(x) AS cnt');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]?.cnt).toBe(5);
    });

    it('UNWIND with empty list produces no rows', async () => {
      const ast = parseCypher('UNWIND [] AS x RETURN x');
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('UNWIND with single element list', async () => {
      const ast = parseCypher('UNWIND [42] AS x RETURN x');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]?.x).toBe(42);
    });

    it('UNWIND with map literals in list', async () => {
      const ast = parseCypher('UNWIND [{name: "Alice"}, {name: "Bob"}] AS person RETURN person.name');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]?.name).toBe('Alice');
      expect(results[1]?.name).toBe('Bob');
    });

    it('UNWIND with map literals returning whole object', async () => {
      const ast = parseCypher('UNWIND [{name: "Alice", age: 30}, {name: "Bob", age: 25}] AS person RETURN person');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]?.person).toEqual({ name: 'Alice', age: 30 });
      expect(results[1]?.person).toEqual({ name: 'Bob', age: 25 });
    });

    it('UNWIND preserves context from prior MATCH', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', hobbies: ['reading', 'coding'] });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User {name: "Alice"}) UNWIND u.hobbies AS h RETURN u.name, h');
      const results = await e.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]?.name).toBe('Alice');
      expect(results[0]?.h).toBe('reading');
      expect(results[1]?.name).toBe('Alice');
      expect(results[1]?.h).toBe('coding');
    });

    it('UNWIND with boolean values', async () => {
      const ast = parseCypher('UNWIND [true, false, true] AS b RETURN b');
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]?.b).toBe(true);
      expect(results[1]?.b).toBe(false);
      expect(results[2]?.b).toBe(true);
    });

    it('UNWIND with mixed types in list', async () => {
      const ast = parseCypher('UNWIND [1, "hello", true] AS val RETURN val');
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]?.val).toBe(1);
      expect(results[1]?.val).toBe('hello');
      expect(results[2]?.val).toBe(true);
    });
  });

  describe('execute - mixed aggregation error', () => {
    it('throws when non-aggregation varies across rows in RETURN without WITH', async () => {
      const ast = parseCypher(
        'MATCH (u:User) RETURN u.name AS name, count(u) AS total',
      );
      await expect(engine.execute(ast)).rejects.toThrow(/Mixed aggregation/i);
    });

    it('does not throw when non-aggregation is constant in RETURN without WITH', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User) RETURN u.name AS name, count(u) AS total',
      );
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.total).toBe(1);
    });
  });
});
