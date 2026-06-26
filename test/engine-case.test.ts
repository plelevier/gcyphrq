import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance } from './engine-setup';

describe('Engine - CASE', () => {
  const buildTestGraph = () => {
    const g = new Graph();
    g.addNode('a', { label: 'Person', name: 'Alice', age: 30, score: 95 });
    g.addNode('b', { label: 'Person', name: 'Bob', age: 25, score: 80 });
    g.addNode('c', { label: 'Person', name: 'Charlie', age: 35, score: 60 });
    return g;
  };

  describe('general CASE (CASE WHEN ... THEN ...)', () => {
    it('evaluates simple equality condition', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name = "Alice" THEN "first" ELSE "other" END AS position');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', position: 'first' },
        { name: 'Bob', position: 'other' },
        { name: 'Charlie', position: 'other' },
      ]);
    });

    it('evaluates multiple WHEN branches', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name = "Alice" THEN 1 WHEN n.name = "Bob" THEN 2 WHEN n.name = "Charlie" THEN 3 ELSE 0 END AS rank');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', rank: 1 },
        { name: 'Bob', rank: 2 },
        { name: 'Charlie', rank: 3 },
      ]);
    });

    it('evaluates numeric comparison', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.age > 30 THEN "senior" WHEN n.age > 20 THEN "junior" ELSE "young" END AS tier');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', tier: 'junior' },
        { name: 'Bob', tier: 'junior' },
        { name: 'Charlie', tier: 'senior' },
      ]);
    });

    it('evaluates >= comparison', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.age >= 30 THEN "senior" WHEN n.age >= 20 THEN "junior" ELSE "young" END AS tier');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', tier: 'senior' },
        { name: 'Bob', tier: 'junior' },
        { name: 'Charlie', tier: 'senior' },
      ]);
    });

    it('evaluates <= comparison', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.age <= 25 THEN "young" WHEN n.age <= 30 THEN "mid" ELSE "senior" END AS tier');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', tier: 'mid' },
        { name: 'Bob', tier: 'young' },
        { name: 'Charlie', tier: 'senior' },
      ]);
    });

    it('evaluates IS NULL condition', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice', age: 30 });
      g.addNode('b', { label: 'Person', name: 'Bob' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.age IS NULL THEN "no age" ELSE "has age" END AS status');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', status: 'has age' },
        { name: 'Bob', status: 'no age' },
      ]);
    });

    it('evaluates string functions in conditions', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name STARTS WITH "A" THEN "A-group" WHEN n.name CONTAINS "ob" THEN "B-group" ELSE "other" END AS group');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', group: 'A-group' },
        { name: 'Bob', group: 'B-group' },
        { name: 'Charlie', group: 'other' },
      ]);
    });

    it('evaluates OR conditions', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name = "Alice" OR n.name = "Bob" THEN "A or B" ELSE "other" END AS group');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', group: 'A or B' },
        { name: 'Bob', group: 'A or B' },
        { name: 'Charlie', group: 'other' },
      ]);
    });

    it('evaluates AND conditions', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.age > 25 AND n.score > 90 THEN "top" ELSE "other" END AS tier');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', tier: 'top' },
        { name: 'Bob', tier: 'other' },
        { name: 'Charlie', tier: 'other' },
      ]);
    });

    it('returns null when no ELSE and no match', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name = "Alice" THEN 1 END AS flag');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', flag: 1 },
        { name: 'Bob', flag: null },
        { name: 'Charlie', flag: null },
      ]);
    });

    it('evaluates bare boolean literal true', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name = "Alice" THEN CASE WHEN true THEN "yes" ELSE "no" END ELSE "other" END AS nested');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', nested: 'yes' },
        { name: 'Bob', nested: 'other' },
        { name: 'Charlie', nested: 'other' },
      ]);
    });

    it('evaluates bare boolean literal false', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name = "Alice" THEN CASE WHEN false THEN "yes" ELSE "no" END ELSE "other" END AS nested');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', nested: 'no' },
        { name: 'Bob', nested: 'other' },
        { name: 'Charlie', nested: 'other' },
      ]);
    });
  });

  describe('simple CASE (CASE expr WHEN value THEN ...)', () => {
    it('evaluates equality against subject', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE n.name WHEN "Alice" THEN 1 WHEN "Bob" THEN 2 ELSE 3 END AS rank');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', rank: 1 },
        { name: 'Bob', rank: 2 },
        { name: 'Charlie', rank: 3 },
      ]);
    });

    it('evaluates numeric subject', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE n.age WHEN 30 THEN "thirty" WHEN 25 THEN "twenty-five" ELSE "other" END AS ageGroup');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', ageGroup: 'thirty' },
        { name: 'Bob', ageGroup: 'twenty-five' },
        { name: 'Charlie', ageGroup: 'other' },
      ]);
    });
  });

  describe('CASE in different contexts', () => {
    it('works in ORDER BY', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY CASE n.name WHEN "Charlie" THEN 0 WHEN "Alice" THEN 1 WHEN "Bob" THEN 2 ELSE 3 END');
      const results = await e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Charlie', 'Alice', 'Bob']);
    });

    it('works in WITH clause', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WITH n.name, CASE WHEN n.score > 90 THEN "A" WHEN n.score > 70 THEN "B" ELSE "C" END AS grade RETURN name, grade');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', grade: 'A' },
        { name: 'Bob', grade: 'B' },
        { name: 'Charlie', grade: 'C' },
      ]);
    });

    it('works in SET clause', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) SET n.grade = CASE WHEN n.score > 90 THEN "A" WHEN n.score > 70 THEN "B" ELSE "C" END RETURN n.name, n.grade');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', grade: 'A' },
        { name: 'Bob', grade: 'B' },
        { name: 'Charlie', grade: 'C' },
      ]);
    });

    it('works with arithmetic in THEN result', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.score > 90 THEN n.score * 2 ELSE n.score END AS adjusted');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', adjusted: 190 },
        { name: 'Bob', adjusted: 80 },
        { name: 'Charlie', adjusted: 60 },
      ]);
    });

    it('works with string functions in THEN result', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name = "Alice" THEN toUpper(n.name) ELSE n.name END AS displayName');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', displayName: 'ALICE' },
        { name: 'Bob', displayName: 'Bob' },
        { name: 'Charlie', displayName: 'Charlie' },
      ]);
    });
  });

  describe('nested CASE', () => {
    it('supports deeply nested CASE expressions', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name = "Alice" THEN CASE WHEN n.age > 30 THEN "mature Alice" ELSE "young Alice" END ELSE "not Alice" END AS desc');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', desc: 'young Alice' },
        { name: 'Bob', desc: 'not Alice' },
        { name: 'Charlie', desc: 'not Alice' },
      ]);
    });
  });

  describe('additional CASE scenarios', () => {
    it('works with NOT condition', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN NOT n.name = "Alice" THEN "not Alice" ELSE "Alice" END AS label');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', label: 'Alice' },
        { name: 'Bob', label: 'not Alice' },
        { name: 'Charlie', label: 'not Alice' },
      ]);
    });

    it('works with ENDS WITH condition', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name ENDS WITH "ie" THEN "ends-ie" ELSE "other" END AS tag');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', tag: 'other' },
        { name: 'Bob', tag: 'other' },
        { name: 'Charlie', tag: 'ends-ie' },
      ]);
    });

    it('works with IN condition', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name IN ["Alice", "Bob"] THEN "in-list" ELSE "not-in" END AS tag');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', tag: 'in-list' },
        { name: 'Bob', tag: 'in-list' },
        { name: 'Charlie', tag: 'not-in' },
      ]);
    });

    it('works with string comparison in condition', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.name > "B" THEN "after-B" ELSE "before-or-B" END AS tag');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', tag: 'before-or-B' },
        { name: 'Bob', tag: 'after-B' },
        { name: 'Charlie', tag: 'after-B' },
      ]);
    });

    it('supports multiple CASE in same RETURN', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE WHEN n.age > 30 THEN "old" ELSE "young" END AS ageCat, CASE WHEN n.score > 90 THEN "high" ELSE "low" END AS scoreCat');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', ageCat: 'young', scoreCat: 'high' },
        { name: 'Bob', ageCat: 'young', scoreCat: 'low' },
        { name: 'Charlie', ageCat: 'old', scoreCat: 'low' },
      ]);
    });

    it('supports CASE with list literal in THEN', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN n.name, CASE WHEN n.age >= 30 THEN ["senior"] ELSE ["junior"] END AS tags');
      const results = await e.execute(ast);
      expect(results).toEqual([{ name: 'Alice', tags: ['senior'] }]);
    });

    it('supports CASE with map literal in THEN', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN n.name, CASE WHEN n.score > 90 THEN {grade: "A"} ELSE {grade: "B"} END AS info');
      const results = await e.execute(ast);
      expect(results).toEqual([{ name: 'Alice', info: { grade: 'A' } }]);
    });

    it('supports simple CASE with no ELSE', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN n.name, CASE n.name WHEN "Alice" THEN 1 END AS flag');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', flag: 1 },
        { name: 'Bob', flag: null },
        { name: 'Charlie', flag: null },
      ]);
    });

    it('uses default alias when no AS provided', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN n.name, CASE WHEN n.age >= 30 THEN "yes" ELSE "no" END');
      const results = await e.execute(ast);
      expect(results[0]!).toHaveProperty('CASE');
      expect(results[0]!.CASE).toBe('yes');
    });

    it('works with CASE in CREATE', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" CREATE (x:Tag {name: n.name, tier: CASE WHEN n.score > 90 THEN "high" ELSE "low" END}) RETURN x.name, x.tier');
      const results = await e.execute(ast);
      expect(results).toEqual([{ name: 'Alice', tier: 'high' }]);
    });

    it('works with CASE in UNWIND', async () => {
      const g = buildTestGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('UNWIND [1, 2, 3] AS x RETURN x, CASE WHEN x > 2 THEN "big" ELSE "small" END AS label');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { x: 1, label: 'small' },
        { x: 2, label: 'small' },
        { x: 3, label: 'big' },
      ]);
    });

    it('works with CASE containing aggregation in WITH', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice' });
      g.addNode('b', { label: 'Person', name: 'Bob' });
      g.addNode('c', { label: 'Person', name: 'Charlie' });
      g.addEdge('a', 'b', { type: 'KNOWS' });
      g.addEdge('a', 'c', { type: 'KNOWS' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (p:Person)-[:KNOWS]->(f) WITH p.name AS name, count(f) AS friends RETURN name, CASE WHEN friends >= 2 THEN "popular" ELSE "quiet" END AS status');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', status: 'popular' },
      ]);
    });

    it('works with <> operator in CASE with aggregation', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice' });
      g.addNode('b', { label: 'Person', name: 'Bob' });
      g.addNode('c', { label: 'Person', name: 'Charlie' });
      g.addEdge('a', 'b', { type: 'KNOWS' });
      g.addEdge('a', 'c', { type: 'KNOWS' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (p:Person)-[:KNOWS]->(f) WITH p.name AS name, count(f) AS friends RETURN name, CASE WHEN friends <> 0 THEN "connected" ELSE "isolated" END AS status');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', status: 'connected' },
      ]);
    });

    it('works with CONTAINS operator in CASE with aggregation', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice' });
      g.addNode('b', { label: 'Person', name: 'Bob' });
      g.addNode('c', { label: 'Person', name: 'Charlie' });
      g.addEdge('a', 'b', { type: 'KNOWS' });
      g.addEdge('a', 'c', { type: 'KNOWS' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (p:Person)-[:KNOWS]->(f) WITH p.name AS name, count(f) AS friends RETURN name, CASE WHEN name CONTAINS "Ali" THEN "found" ELSE "other" END AS tag');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', tag: 'found' },
      ]);
    });

    it('works with IN operator in CASE with aggregation', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice' });
      g.addNode('b', { label: 'Person', name: 'Bob' });
      g.addNode('c', { label: 'Person', name: 'Charlie' });
      g.addEdge('a', 'b', { type: 'KNOWS' });
      g.addEdge('a', 'c', { type: 'KNOWS' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (p:Person)-[:KNOWS]->(f) WITH p.name AS name, count(f) AS friends RETURN name, CASE WHEN friends IN [1, 2] THEN "in-range" ELSE "out-of-range" END AS tag');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', tag: 'in-range' },
      ]);
    });

    it('works with string >= in CASE with aggregation', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice' });
      g.addNode('b', { label: 'Person', name: 'Bob' });
      g.addNode('c', { label: 'Person', name: 'Charlie' });
      g.addEdge('a', 'b', { type: 'KNOWS' });
      g.addEdge('a', 'c', { type: 'KNOWS' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (p:Person)-[:KNOWS]->(f) WITH p.name AS name, count(f) AS friends RETURN name, CASE WHEN name >= "Bob" THEN "latter" ELSE "former" END AS group');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', group: 'former' },
      ]);
    });

    it('works with ENDS WITH in CASE with aggregation', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice' });
      g.addNode('b', { label: 'Person', name: 'Bob' });
      g.addNode('c', { label: 'Person', name: 'Charlie' });
      g.addEdge('a', 'b', { type: 'KNOWS' });
      g.addEdge('a', 'c', { type: 'KNOWS' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (p:Person)-[:KNOWS]->(f) WITH p.name AS name, count(f) AS friends RETURN name, CASE WHEN name ENDS WITH "e" THEN "ends-e" ELSE "other" END AS tag');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', tag: 'ends-e' },
      ]);
    });

    it('works with STARTS WITH in CASE with aggregation', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice' });
      g.addNode('b', { label: 'Person', name: 'Bob' });
      g.addNode('c', { label: 'Person', name: 'Charlie' });
      g.addEdge('a', 'b', { type: 'KNOWS' });
      g.addEdge('a', 'c', { type: 'KNOWS' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (p:Person)-[:KNOWS]->(f) WITH p.name AS name, count(f) AS friends RETURN name, CASE WHEN name STARTS WITH "Al" THEN "starts-al" ELSE "other" END AS tag');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', tag: 'starts-al' },
      ]);
    });

    it('correctly handles <> with equal values in CASE with aggregation', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice' });
      g.addNode('b', { label: 'Person', name: 'Bob' });
      g.addEdge('a', 'b', { type: 'KNOWS' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (p:Person)-[:KNOWS]->(f) WITH p.name AS name, count(f) AS friends RETURN name, CASE WHEN friends <> 1 THEN "different" ELSE "same" END AS status');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', status: 'same' },
      ]);
    });

    it('correctly handles = operator in CASE with aggregation', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice' });
      g.addNode('b', { label: 'Person', name: 'Bob' });
      g.addEdge('a', 'b', { type: 'KNOWS' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (p:Person)-[:KNOWS]->(f) WITH p.name AS name, count(f) AS friends RETURN name, CASE WHEN friends = 1 THEN "one" ELSE "other" END AS status');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', status: 'one' },
      ]);
    });

    it('handles CASE WHEN true bare boolean in aggregation context', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Person', name: 'Alice' });
      g.addNode('b', { label: 'Person', name: 'Bob' });
      g.addEdge('a', 'b', { type: 'KNOWS' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (p:Person)-[:KNOWS]->(f) WITH p.name AS name, count(f) AS friends RETURN name, CASE WHEN true THEN "always" ELSE "never" END AS status');
      const results = await e.execute(ast);
      expect(results).toEqual([
        { name: 'Alice', status: 'always' },
      ]);
    });
  });
});
