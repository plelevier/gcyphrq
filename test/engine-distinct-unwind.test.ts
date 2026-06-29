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

  describe('execute - implicit grouping in RETURN', () => {
    it('groups by non-aggregated column in RETURN without WITH', async () => {
      const ast = parseCypher(
        'MATCH (u:User) RETURN u.name AS name, count(u) AS total',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
      const map = new Map(results.map((r) => [r.name, r.total]));
      expect(map.get('Alice')).toBe(1);
      expect(map.get('Bob')).toBe(1);
      expect(map.get('Charlie')).toBe(1);
      expect(map.get('Dave')).toBe(1);
    });

    it('groups by multiple non-aggregated columns in RETURN', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', dept: 'Eng' });
      g.addNode('b', { label: 'User', name: 'Bob', dept: 'Eng' });
      g.addNode('c', { label: 'User', name: 'Charlie', dept: 'Sales' });
      g.addNode('d', { label: 'User', name: 'Dave', dept: 'Sales' });
      g.addNode('e', { label: 'User', name: 'Eve', dept: 'Sales' });
      const e2 = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User) RETURN u.dept AS dept, count(u) AS total',
      );
      const results = await e2.execute(ast);
      expect(results.length).toBe(2);
      const map = new Map(results.map((r) => [r.dept, r.total]));
      expect(map.get('Eng')).toBe(2);
      expect(map.get('Sales')).toBe(3);
    });

    it('supports ORDER BY on aggregated result in RETURN', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', dept: 'Eng', age: 30 });
      g.addNode('b', { label: 'User', name: 'Bob', dept: 'Eng', age: 25 });
      g.addNode('c', { label: 'User', name: 'Charlie', dept: 'Sales', age: 35 });
      g.addNode('d', { label: 'User', name: 'Dave', dept: 'Sales', age: 28 });
      g.addNode('e', { label: 'User', name: 'Eve', dept: 'HR', age: 40 });
      const e2 = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User) RETURN u.dept AS dept, count(u) AS total ORDER BY total DESC',
      );
      const results = await e2.execute(ast);
      expect(results.length).toBe(3);
      expect(results[0]!.dept).toBe('Eng');
      expect(results[0]!.total).toBe(2);
      expect(results[1]!.dept).toBe('Sales');
      expect(results[1]!.total).toBe(2);
      expect(results[2]!.dept).toBe('HR');
      expect(results[2]!.total).toBe(1);
    });

    it('supports SKIP and LIMIT on grouped RETURN', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', dept: 'A' });
      g.addNode('b', { label: 'User', name: 'Bob', dept: 'B' });
      g.addNode('c', { label: 'User', name: 'Charlie', dept: 'B' });
      g.addNode('d', { label: 'User', name: 'Dave', dept: 'C' });
      g.addNode('e', { label: 'User', name: 'Eve', dept: 'C' });
      g.addNode('f', { label: 'User', name: 'Frank', dept: 'C' });
      const e2 = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User) RETURN u.dept AS dept, count(u) AS total ORDER BY total DESC SKIP 1 LIMIT 1',
      );
      const results = await e2.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.dept).toBe('B');
      expect(results[0]!.total).toBe(2);
    });

    it('supports multiple aggregations per group in RETURN', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', dept: 'Eng', age: 30 });
      g.addNode('b', { label: 'User', name: 'Bob', dept: 'Eng', age: 25 });
      g.addNode('c', { label: 'User', name: 'Charlie', dept: 'Sales', age: 35 });
      const e2 = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User) RETURN u.dept AS dept, count(u) AS total, avg(u.age) AS avgAge, min(u.age) AS minAge, max(u.age) AS maxAge',
      );
      const results = await e2.execute(ast);
      expect(results.length).toBe(2);
      const eng = results.find((r) => r.dept === 'Eng');
      expect(eng?.total).toBe(2);
      expect(eng?.avgAge).toBe(27.5);
      expect(eng?.minAge).toBe(25);
      expect(eng?.maxAge).toBe(30);
      const sales = results.find((r) => r.dept === 'Sales');
      expect(sales?.total).toBe(1);
      expect(sales?.avgAge).toBe(35);
      expect(sales?.minAge).toBe(35);
      expect(sales?.maxAge).toBe(35);
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
