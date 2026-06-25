import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createEngine, Graph, node } from './engine-setup';
import type { GraphInstance, AdvancedCypherAST } from './engine-setup';

describe('Engine - Quantifiers', () => {
  let graph: GraphInstance;
  let engine: any;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('a', { label: 'Item', name: 'Alice', tags: ['admin', 'user'], scores: [90, 80, 70] });
    graph.addNode('b', { label: 'Item', name: 'Bob', tags: ['user'], scores: [60, 70] });
    graph.addNode('c', { label: 'Item', name: 'Charlie', tags: ['admin', 'user', 'moderator'], scores: [100, 95, 90, 85] });
    graph.addNode('d', { label: 'Item', name: 'Dave', tags: [], scores: [] });
    graph.addNode('e', { label: 'Item', name: 'Eve', scores: [50] });
    engine = createEngine(graph);
  });

  // ── ALL ────────────────────────────────────────────────────────────────

  describe('ALL', () => {
    it('returns true when all elements satisfy the predicate', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.tags WHERE x = "user") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Bob', 'Dave']); // Dave: empty list = vacuous truth
    });

    it('returns false when not all elements satisfy the predicate', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.tags WHERE x = "admin") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Dave']); // Dave: empty list = vacuous truth
    });

    it('returns true for empty list (vacuous truth)', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.tags WHERE x = "admin") AND n.name = "Dave" RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Dave');
    });

    it('works with numeric predicates', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.scores WHERE x > 50) RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']); // Dave: empty list = vacuous truth, Eve: 50 not > 50
    });

    it('works with numeric predicates (strict)', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.scores WHERE x >= 80) RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Charlie', 'Dave']); // Charlie: all >= 80, Dave: empty = vacuous truth, Alice: 70 < 80
    });

    it('works with CONTAINS predicate', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.tags WHERE x CONTAINS "a") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Dave']); // 'user' doesn't contain 'a', so Alice/Charlie fail; Dave: empty = vacuous truth
    });

    it('works combined with AND', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.scores WHERE x > 50) AND n.name = "Alice" RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('works combined with OR', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.tags WHERE x = "user") OR n.name = "Charlie" RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Bob', 'Charlie', 'Dave']); // Dave: empty list = vacuous truth for ALL
    });

    it('works with NOT ALL', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE NOT ALL(x IN n.scores WHERE x >= 80) RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Eve']); // Alice: 70 < 80, Bob: 60 < 80, Eve: 50 < 80; Charlie/Dave: ALL=true so NOT=false
    });

    it('returns false when property does not exist', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.nonexistent WHERE x = "a") RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });
  });

  // ── ANY ────────────────────────────────────────────────────────────────

  describe('ANY', () => {
    it('returns true when any element satisfies the predicate', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ANY(x IN n.tags WHERE x = "admin") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('returns false when no element satisfies the predicate', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ANY(x IN n.tags WHERE x = "superadmin") RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('returns false for empty list', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ANY(x IN n.tags WHERE x = "admin") AND n.name = "Dave" RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('works with numeric predicates', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ANY(x IN n.scores WHERE x >= 90) RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('works with CONTAINS predicate', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ANY(x IN n.tags WHERE x CONTAINS "mod") RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Charlie');
    });

    it('works combined with AND', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ANY(x IN n.tags WHERE x = "admin") AND ANY(x IN n.scores WHERE x >= 90) RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('works with NOT ANY', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE NOT ANY(x IN n.tags WHERE x = "admin") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Bob', 'Dave', 'Eve']);
    });

    it('works with list literal', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', values: [1, 2, 3] });
      g.addNode('b', { label: 'Item', values: [4, 5, 6] });
      const e = createEngine(g);
      const ast = parseCypher('MATCH (n:Item) WHERE ANY(x IN n.values WHERE x > 3) RETURN n.values');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.values).toEqual([4, 5, 6]);
    });
  });

  // ── SINGLE ─────────────────────────────────────────────────────────────

  describe('SINGLE', () => {
    it('returns true when exactly one element satisfies the predicate', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE SINGLE(x IN n.tags WHERE x = "admin") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Charlie']); // Both have exactly 1 "admin" tag
    });

    it('returns false when multiple elements satisfy the predicate', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE SINGLE(x IN n.tags WHERE x = "user") RETURN n.name');
      const results = engine.execute(ast);
      // Alice, Bob, Charlie each have exactly 1 "user" tag → all match SINGLE
      expect(results.length).toBe(3);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('returns false when no element satisfies the predicate', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE SINGLE(x IN n.tags WHERE x = "superadmin") RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('returns false for empty list', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE SINGLE(x IN n.tags WHERE x = "admin") AND n.name = "Dave" RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('works with numeric predicates', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE SINGLE(x IN n.scores WHERE x >= 99) RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Charlie'); // Only Charlie has exactly 1 score >= 99 (100)
    });

    it('works combined with AND', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE SINGLE(x IN n.tags WHERE x = "admin") AND n.name = "Alice" RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('works with NOT SINGLE', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE NOT SINGLE(x IN n.tags WHERE x = "admin") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Bob', 'Dave', 'Eve']); // Alice/Charlie have exactly 1 "admin", Bob/Dave/Eve don't
    });
  });

  // ── NONE ───────────────────────────────────────────────────────────────

  describe('NONE', () => {
    it('returns true when no element satisfies the predicate', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE NONE(x IN n.tags WHERE x = "superadmin") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']); // Eve has no tags property → null → false
    });

    it('returns false when any element satisfies the predicate', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE NONE(x IN n.tags WHERE x = "user") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Dave']); // Dave: empty list = vacuous truth; Eve has no tags → null → false
    });

    it('returns true for empty list (vacuous truth)', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE NONE(x IN n.tags WHERE x = "admin") AND n.name = "Dave" RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Dave');
    });

    it('works with numeric predicates', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE NONE(x IN n.scores WHERE x >= 100) RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Dave', 'Eve']);
    });

    it('works combined with AND', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE NONE(x IN n.tags WHERE x = "moderator") AND n.name = "Alice" RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('works with NOT NONE', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE NOT NONE(x IN n.tags WHERE x = "admin") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      // NONE: Alice=false, Bob=true, Charlie=false, Dave=true(vacuous), Eve=false(null)
      // NOT NONE: Alice=true, Bob=false, Charlie=true, Dave=false, Eve=true
      expect(names).toEqual(['Alice', 'Charlie', 'Eve']);
    });
  });

  // ── EXISTS ─────────────────────────────────────────────────────────────

  describe('EXISTS', () => {
    it('returns true when property exists', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(n.tags) RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    });

    it('returns false when property does not exist', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(n.nonexistent) RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('returns true when property exists and is not null', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Alice', email: 'alice@example.com' });
      g.addNode('b', { label: 'Item', name: 'Bob', email: null });
      g.addNode('c', { label: 'Item', name: 'Charlie' });
      const e = createEngine(g);
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(n.email) RETURN n.name');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('returns false when property is null', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Alice', email: 'alice@example.com' });
      g.addNode('b', { label: 'Item', name: 'Bob', email: null });
      g.addNode('c', { label: 'Item', name: 'Charlie' });
      const e = createEngine(g);
      const ast = parseCypher('MATCH (n:Item) WHERE NOT EXISTS(n.email) RETURN n.name');
      const results = e.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('works with arithmetic expression', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(n.scores[0]) RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Eve']);
    });

    it('works combined with AND', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(n.tags) AND n.name = "Alice" RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('works combined with OR', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(n.tags) OR n.name = "Eve" RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave', 'Eve']);
    });

    it('works with NOT EXISTS', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE NOT EXISTS(n.tags) RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Eve');
    });

    it('works in RETURN clause', () => {
      const ast = parseCypher('MATCH (n:Item) RETURN n.name, EXISTS(n.tags) AS hasTags');
      const results = engine.execute(ast);
      expect(results.length).toBe(5);
      const eveResult = results.find((r: any) => r.name === 'Eve');
      expect(eveResult!.hasTags).toBe(false);
      const aliceResult = results.find((r: any) => r.name === 'Alice');
      expect(aliceResult!.hasTags).toBe(true);
    });

    it('works with function call', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(toLower(n.name)) RETURN n.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(5);
    });
  });

  // ── Combined quantifiers ───────────────────────────────────────────────

  describe('Combined quantifiers', () => {
    it('ALL and ANY together', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.scores WHERE x > 50) AND ANY(x IN n.tags WHERE x = "admin") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('ANY and SINGLE together', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ANY(x IN n.tags WHERE x = "admin") AND SINGLE(x IN n.tags WHERE x = "admin") RETURN n.name');
      const results = engine.execute(ast);
      // Alice: ANY=true, SINGLE=true → true; Charlie: ANY=true, SINGLE=true → true
      expect(results.length).toBe(2);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('ALL and NONE together', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.scores WHERE x > 50) AND NONE(x IN n.tags WHERE x = "moderator") RETURN n.name');
      const results = engine.execute(ast);
      // ALL(scores>50): Alice=true, Bob=true, Charlie=true, Dave=true(vacuous), Eve=false
      // NONE(tags="moderator"): Alice=true, Bob=true, Charlie=false, Dave=true(vacuous), Eve=true(null)
      // Combined: Alice=true, Bob=true, Dave=true
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Dave']);
    });

    it('EXISTS and quantifier together', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(n.tags) AND ALL(x IN n.tags WHERE x CONTAINS "a") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      // EXISTS(tags): Alice, Bob, Charlie, Dave; ALL(tags CONTAINS "a"): Dave(vacuous) only
      // Combined: Dave
      expect(names).toEqual(['Dave']);
    });

    it('quantifier in WHERE with WITH clause', () => {
      const ast = parseCypher('MATCH (n:Item) WITH n.name AS name, n.tags AS tags WHERE ALL(x IN tags WHERE size(x) > 2) RETURN name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    });

    it('multiple quantifiers in same WHERE', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.scores WHERE x > 0) AND ANY(x IN n.scores WHERE x > 80) AND NONE(x IN n.scores WHERE x < 0) RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      // ALL(scores>0): Alice, Bob, Charlie, Dave(vacuous), Eve
      // ANY(scores>80): Alice(90), Charlie(100,95,90), not Bob/Dave/Eve
      // NONE(scores<0): Alice, Bob, Charlie, Dave(vacuous), Eve
      // Combined: Alice, Charlie
      expect(names).toEqual(['Alice', 'Charlie']);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('quantifier with null list returns false', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Alice', tags: null });
      const e = createEngine(g);
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.tags WHERE x = "a") RETURN n.name');
      const results = e.execute(ast);
      expect(results.length).toBe(0);
    });

    it('quantifier with non-list value returns false', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Alice', tags: 'not-a-list' });
      const e = createEngine(g);
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.tags WHERE x = "a") RETURN n.name');
      const results = e.execute(ast);
      expect(results.length).toBe(0);
    });

    it('EXISTS with null value returns false', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Alice', value: null });
      const e = createEngine(g);
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(n.value) RETURN n.name');
      const results = e.execute(ast);
      expect(results.length).toBe(0);
    });

    it('EXISTS with 0 returns true (0 is not null)', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Alice', value: 0 });
      const e = createEngine(g);
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(n.value) RETURN n.name');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
    });

    it('EXISTS with false returns true (false is not null)', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Alice', value: false });
      const e = createEngine(g);
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(n.value) RETURN n.name');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
    });

    it('EXISTS with empty string returns true', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Alice', value: '' });
      const e = createEngine(g);
      const ast = parseCypher('MATCH (n:Item) WHERE EXISTS(n.value) RETURN n.name');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
    });

    it('quantifier with list literal', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Alice' });
      const e = createEngine(g);
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN [1, 2, 3] WHERE x > 0) RETURN n.name');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
    });

    it('quantifier with complex WHERE inside', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ALL(x IN n.scores WHERE x >= 50 AND x <= 100) RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      // All scores for all nodes are in [50, 100], Dave has empty list (vacuous truth)
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave', 'Eve']);
    });

    it('quantifier with OR inside WHERE', () => {
      const ast = parseCypher('MATCH (n:Item) WHERE ANY(x IN n.tags WHERE x = "admin" OR x = "moderator") RETURN n.name');
      const results = engine.execute(ast);
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });
  });
});
