import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance } from './engine-setup';

describe('Engine - count(*), collect(), reduce()', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createTestGraph();
    engine = createEngine(graph);
  });

  // ── count(*) ───────────────────────────────────────────────────────────

  describe('count(*)', () => {
    it('counts all rows including nulls', () => {
      const ast = parseCypher('MATCH (u:User) RETURN count(*) AS total');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.total).toBe(4);
    });

    it('counts all rows in a group', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r]-(b:User) WITH a.name AS name, count(*) AS cnt RETURN name, cnt'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(4); // Alice, Bob, Charlie, Dave all have connections
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.cnt).toBe(2); // Alice connects to Bob (FRIEND) and Dave (KNOWS)
      const bobResult = results.find(r => r.name === 'Bob');
      expect(bobResult?.cnt).toBe(2); // Bob connects to Alice (FRIEND) and Charlie (FRIEND)
    });

    it('returns 0 when no matches', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: 1 });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:NonExistent) RETURN count(*) AS total');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.total).toBe(0);
    });

    it('count(*) vs count(n) difference', () => {
      // count(*) counts all rows, count(n) excludes nulls
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: 1 });
      g.addNode('b', { label: 'Item', value: null });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:Item) RETURN count(*) AS starCount, count(n.value) AS valueCount');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.starCount).toBe(2);   // counts all rows
      expect(results[0]!.valueCount).toBe(1);   // excludes null
    });

    it('count(*) with AS alias', () => {
      const ast = parseCypher('MATCH (u:User) RETURN count(*) AS userCount');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.userCount).toBe(4);
    });

    it('count(*) without AS uses default alias', () => {
      const ast = parseCypher('MATCH (u:User) RETURN count(*)');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!).toHaveProperty('count(*)');
      expect(results[0]!['count(*)']).toBe(4);
    });
  });

  // ── collect() ──────────────────────────────────────────────────────────

  describe('collect()', () => {
    it('collects all values into a list', () => {
      const ast = parseCypher('MATCH (u:User) RETURN collect(u.name) AS names');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(Array.isArray(results[0]!.names)).toBe(true);
      const names = results[0]!.names as string[];
      expect(names.length).toBe(4);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
      expect(names).toContain('Charlie');
      expect(names).toContain('Dave');
    });

    it('collects with grouping', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, collect(b.name) AS friends RETURN name, friends'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.friends).toEqual(['Bob']);
      const bobResult = results.find(r => r.name === 'Bob');
      expect(bobResult?.friends).toEqual(['Charlie']);
    });

    it('collects property values', () => {
      const ast = parseCypher('MATCH (u:User) RETURN collect(u.age) AS ages');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const ages = results[0]!.ages as number[];
      expect(ages.length).toBe(4);
      expect(ages).toContain(30);
      expect(ages).toContain(25);
      expect(ages).toContain(35);
      expect(ages).toContain(28);
    });

    it('collect(DISTINCT) removes duplicates', () => {
      // Create a graph with duplicate values
      const g = new Graph();
      g.addNode('a', { label: 'Item', category: 'A' });
      g.addNode('b', { label: 'Item', category: 'B' });
      g.addNode('c', { label: 'Item', category: 'A' });
      g.addNode('d', { label: 'Item', category: 'C' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:Item) RETURN collect(DISTINCT n.category) AS categories');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      const categories = results[0]!.categories as string[];
      expect(categories).toEqual(['A', 'B', 'C']);
    });

    it('collect() returns empty list when no matches', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: 1 });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:NonExistent) RETURN collect(n.value) AS values');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.values).toEqual([]);
    });

    it('collect() with null values includes them', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', value: 1 });
      g.addNode('b', { label: 'Item', value: null });
      g.addNode('c', { label: 'Item', value: 3 });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n:Item) RETURN collect(n.value) AS values');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      const values = results[0]!.values as (number | null)[];
      expect(values).toContain(1);
      expect(values).toContain(null);
      expect(values).toContain(3);
    });
  });

  // ── reduce() ───────────────────────────────────────────────────────────

  describe('reduce()', () => {
    it('sums a list (one row per matched node)', () => {
      const ast = parseCypher('MATCH (u:User) RETURN reduce(total = 0, x IN [1, 2, 3, 4] | total + x) AS sum');
      const results = engine.execute(ast);
      expect(results.length).toBe(4); // one per user
      for (const r of results) {
        expect(r.sum).toBe(10);
      }
    });

    it('multiplies a list', () => {
      const ast = parseCypher('MATCH (u:User) RETURN reduce(total = 1, x IN [2, 3, 4] | total * x) AS product');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
      for (const r of results) {
        expect(r.product).toBe(24);
      }
    });

    it('concatenates strings', () => {
      const ast = parseCypher('MATCH (u:User) RETURN reduce(s = "", x IN ["a", "b", "c"] | s + x) AS result');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
      for (const r of results) {
        expect(r.result).toBe('abc');
      }
    });

    it('works with property-based list', () => {
      // Collect ages and sum them
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice', ages: [10, 20, 30] });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (p:Person) RETURN reduce(total = 0, x IN p.ages | total + x) AS sum');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.sum).toBe(60);
    });

    it('returns initial value when list is empty', () => {
      const ast = parseCypher('MATCH (u:User) RETURN reduce(total = 42, x IN [] | total + x) AS result');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
      for (const r of results) {
        expect(r.result).toBe(42);
      }
    });

    it('returns null when initial value is null', () => {
      const ast = parseCypher('MATCH (u:User) RETURN reduce(total = null, x IN [1, 2] | total + x) AS result');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
      for (const r of results) {
        expect(r.result).toBeNull();
      }
    });

    it('returns null when body evaluates to null', () => {
      const ast = parseCypher('MATCH (u:User) RETURN reduce(total = 0, x IN [1, null, 3] | total + x) AS result');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
      for (const r of results) {
        expect(r.result).toBeNull();
      }
    });

    it('works in WITH clause', () => {
      // reduce with a literal list evaluates the same for all rows
      // since there are no grouping keys, all rows collapse into one
      const ast = parseCypher(
        'MATCH (u:User) WITH reduce(total = 0, x IN [1, 2, 3] | total + x) AS sum RETURN sum'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.sum).toBe(6);
    });

    it('works in WITH clause with grouping key', () => {
      // Each user gets one reduce evaluation with grouping key
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name, reduce(total = 0, x IN [1, 2, 3] | total + x) AS sum RETURN name, sum'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(4); // one per user
      for (const r of results) {
        expect(r.sum).toBe(6);
      }
    });

    it('reduce with collect (both are aggregations)', () => {
      // Sum all ages using collect + reduce — collect is an aggregation, so this aggregates
      const ast = parseCypher(
        'MATCH (u:User) RETURN reduce(total = 0, x IN collect(u.age) | total + x) AS totalAge'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.totalAge).toBe(118); // 30 + 25 + 35 + 28
    });

    it('reduce with string concatenation of names', () => {
      // collect is an aggregation, so this aggregates all users into one row
      const ast = parseCypher(
        'MATCH (u:User) RETURN reduce(s = "", x IN collect(u.name) | s + x + ", ") AS allNames'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(typeof results[0]!.allNames).toBe('string');
      expect((results[0]!.allNames as string).length).toBeGreaterThan(0);
    });
  });

  // ── Combined scenarios ────────────────────────────────────────────────

  describe('combined', () => {
    it('count(*), collect, and reduce together', () => {
      const ast = parseCypher(
        'MATCH (u:User) RETURN count(*) AS total, collect(u.name) AS names, reduce(sum = 0, x IN [1, 2, 3] | sum + x) AS listSum'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.total).toBe(4);
      expect(Array.isArray(results[0]!.names)).toBe(true);
      expect(results[0]!.listSum).toBe(6);
    });

    it('collect with count and reduce in WITH', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r]-(b:User) WITH a.name AS name, count(*) AS connections, collect(b.name) AS connected, reduce(total = 0, x IN [1, 2] | total + x) AS extra RETURN name, connections, connected, extra'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(4); // Alice, Bob, Charlie, Dave all have connections
      for (const r of results) {
        expect(r.extra).toBe(3);
      }
    });

    it('reduce over collect result with grouping', () => {
      // Use a second WITH to apply reduce after collect
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, collect(b.age) AS ages WITH name, reduce(total = 0, x IN ages | total + x) AS totalAge RETURN name, totalAge'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.totalAge).toBe(25); // Bob's age
      const bobResult = results.find(r => r.name === 'Bob');
      expect(bobResult?.totalAge).toBe(35); // Charlie's age
    });
  });
});
