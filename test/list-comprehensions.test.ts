import { describe, it, expect } from 'vitest';
import { executeQuery } from '../src/lib';

const graphData = {
  nodes: [
    { key: 'a', attributes: { name: 'Alice', tags: ['admin', 'user', 'dev'], scores: [90, 80, 70] } },
    { key: 'b', attributes: { name: 'Bob', tags: ['user'], scores: [60, 70] } },
    { key: 'c', attributes: { name: 'Charlie', tags: ['admin', 'user', 'moderator'], scores: [100, 95, 90, 85] } },
    { key: 'd', attributes: { name: 'Dave', tags: [], scores: [] } },
  ],
  edges: [
    { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
    { source: 'b', target: 'c', attributes: { type: 'KNOWS' } },
  ],
};

describe('List comprehensions', () => {
  // ── Basic list comprehension (no WHERE) ──────────────────────────────

  describe('Basic comprehension [x IN list | expr]', () => {
    it('doubles each element', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, 2, 3] | x * 2] AS doubled');
      expect(results).toEqual([{ doubled: [2, 4, 6] }]);
    });

    it('adds one to each element', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [10, 20, 30] | x + 1] AS incremented');
      expect(results).toEqual([{ incremented: [11, 21, 31] }]);
    });

    it('returns the element itself (identity)', () => {
      const results = executeQuery(graphData, 'RETURN [x IN ["a", "b", "c"] | x] AS same');
      expect(results).toEqual([{ same: ['a', 'b', 'c'] }]);
    });

    it('converts numbers to strings', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, 2, 3] | toString(x)] AS strings');
      expect(results).toEqual([{ strings: ['1', '2', '3'] }]);
    });

    it('uppercases each string', () => {
      const results = executeQuery(graphData, 'RETURN [x IN ["hello", "world"] | toUpper(x)] AS upper');
      expect(results).toEqual([{ upper: ['HELLO', 'WORLD'] }]);
    });

    it('works with empty list', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [] | x * 2] AS empty');
      expect(results).toEqual([{ empty: [] }]);
    });

    it('works with single element', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [42] | x * 2] AS single');
      expect(results).toEqual([{ single: [84] }]);
    });

    it('works with mixed types', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, "two", 3] | x] AS mixed');
      expect(results).toEqual([{ mixed: [1, 'two', 3] }]);
    });

    it('works with arithmetic in generator', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, 2, 3] | x * x + 1] AS result');
      expect(results).toEqual([{ result: [2, 5, 10] }]);
    });

    it('works with nested function calls in generator', () => {
      const results = executeQuery(graphData, 'RETURN [x IN ["a", "bb", "ccc"] | length(x)] AS lengths');
      expect(results).toEqual([{ lengths: [1, 2, 3] }]);
    });
  });

  // ── List comprehension with WHERE ────────────────────────────────────

  describe('Comprehension with WHERE [x IN list WHERE pred | expr]', () => {
    it('filters even numbers', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, 2, 3, 4, 5, 6] WHERE x % 2 = 0 | x] AS evens');
      expect(results).toEqual([{ evens: [2, 4, 6] }]);
    });

    it('filters numbers greater than threshold', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [10, 20, 30, 40] WHERE x > 15 | x] AS filtered');
      expect(results).toEqual([{ filtered: [20, 30, 40] }]);
    });

    it('filters strings with CONTAINS', () => {
      const results = executeQuery(graphData, 'RETURN [x IN ["apple", "banana", "apricot"] WHERE x STARTS WITH "a" | x] AS startsWithA');
      expect(results).toEqual([{ startsWithA: ['apple', 'apricot'] }]);
    });

    it('filters strings with length', () => {
      const results = executeQuery(graphData, 'RETURN [x IN ["hi", "hello", "hey", "yo"] WHERE length(x) > 2 | x] AS long');
      expect(results).toEqual([{ long: ['hello', 'hey'] }]);
    });

    it('returns empty list when no elements match', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, 2, 3] WHERE x > 100 | x] AS none');
      expect(results).toEqual([{ none: [] }]);
    });

    it('combines filter and transform', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, 2, 3, 4, 5] WHERE x > 2 | x * 10] AS result');
      expect(results).toEqual([{ result: [30, 40, 50] }]);
    });

    it('uses AND in WHERE', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, 5, 10, 15, 20] WHERE x > 3 AND x < 18 | x] AS range');
      expect(results).toEqual([{ range: [5, 10, 15] }]);
    });

    it('uses OR in WHERE', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, 5, 10, 15, 20] WHERE x = 1 OR x = 20 | x] AS extremes');
      expect(results).toEqual([{ extremes: [1, 20] }]);
    });

    it('uses NOT in WHERE', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, 2, 3, 4, 5] WHERE NOT x = 3 | x] AS notThree');
      expect(results).toEqual([{ notThree: [1, 2, 4, 5] }]);
    });

    it('uses IN in WHERE', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, 2, 3, 4, 5] WHERE x IN [2, 4] | x] AS subset');
      expect(results).toEqual([{ subset: [2, 4] }]);
    });
  });

  // ── List comprehension with property access ──────────────────────────

  describe('Comprehension with property access', () => {
    it('extracts from property list', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WHERE n.name = "Alice" RETURN [x IN n.scores | x + 10] AS boosted'
      );
      expect(results).toEqual([{ boosted: [100, 90, 80] }]);
    });

    it('filters from property list', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WHERE n.name = "Alice" RETURN [x IN n.scores WHERE x >= 85 | x] AS highScores'
      );
      // Alice scores: [90, 80, 70], >= 85 -> [90]
      expect(results).toEqual([{ highScores: [90] }]);
    });

    it('transforms tags to uppercase', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WHERE n.name = "Alice" RETURN [x IN n.tags | toUpper(x)] AS upperTags'
      );
      expect(results).toEqual([{ upperTags: ['ADMIN', 'USER', 'DEV'] }]);
    });

    it('filters tags by length', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WHERE n.name = "Alice" RETURN [x IN n.tags WHERE length(x) > 3 | x] AS longTags'
      );
      expect(results).toEqual([{ longTags: ['admin', 'user'] }]);
    });

    it('works with empty property list', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WHERE n.name = "Dave" RETURN [x IN n.tags | toUpper(x)] AS upperTags'
      );
      expect(results).toEqual([{ upperTags: [] }]);
    });

    it('works across multiple nodes', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WHERE n.name IN ["Alice", "Bob"] RETURN n.name AS name, [x IN n.scores | x * 2] AS doubled'
      );
      expect(results).toEqual([
        { name: 'Alice', doubled: [180, 160, 140] },
        { name: 'Bob', doubled: [120, 140] },
      ]);
    });
  });

  // ── List comprehension combined with other features ──────────────────

  describe('Comprehension with aggregations', () => {
    it('size of comprehension result', () => {
      const results = executeQuery(graphData, 'RETURN size([x IN [1, 2, 3, 4, 5] WHERE x > 2 | x]) AS count');
      expect(results).toEqual([{ count: 3 }]);
    });

    it('head of comprehension result', () => {
      const results = executeQuery(graphData, 'RETURN head([x IN [10, 20, 30] | x * 2]) AS first');
      expect(results).toEqual([{ first: 20 }]);
    });

    it('tail of comprehension result', () => {
      const results = executeQuery(graphData, 'RETURN tail([x IN [1, 2, 3, 4] | x * x]) AS rest');
      expect(results).toEqual([{ rest: [4, 9, 16] }]);
    });

    it('reverse of comprehension result', () => {
      const results = executeQuery(graphData, 'RETURN reverse([x IN [1, 2, 3] | x * 10]) AS rev');
      expect(results).toEqual([{ rev: [30, 20, 10] }]);
    });

    it('comprehension with collect inside', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) RETURN [x IN n.scores | x] AS scores'
      );
      expect(results.length).toBe(4);
    });
  });

  describe('Comprehension with reduce', () => {
    it('sum comprehension result with reduce', () => {
      const results = executeQuery(
        graphData,
        'RETURN reduce(total = 0, x IN [y IN [1, 2, 3, 4, 5] WHERE y > 2 | y * 2] | total + x) AS sum'
      );
      // [y IN [1,2,3,4,5] WHERE y > 2 | y*2] = [6, 8, 10]
      // reduce(total=0, x IN [6,8,10] | total+x) = 24
      expect(results).toEqual([{ sum: 24 }]);
    });

    it('reduce over comprehension from property', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WHERE n.name = "Alice" RETURN reduce(total = 0, x IN [s IN n.scores WHERE s >= 85 | s] | total + x) AS sumHigh'
      );
      // Alice scores: [90, 80, 70], >= 85 -> [90] (80 < 85), sum = 90
      expect(results).toEqual([{ sumHigh: 90 }]);
    });
  });

  describe('Comprehension with quantifiers', () => {
    it('ALL over comprehension result', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WHERE ALL(x IN [s IN n.scores | s * 2] WHERE x > 0) RETURN n.name'
      );
      const names = results.map((r: any) => r.name).sort();
      // Alice: [180,160,140] all > 0 ✓, Bob: [120,140] all > 0 ✓, Charlie: all > 0 ✓, Dave: [] vacuous truth ✓
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    });

    it('ANY over comprehension result', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WHERE ANY(x IN [s IN n.scores | s * 2] WHERE x > 150) RETURN n.name'
      );
      const names = results.map((r: any) => r.name).sort();
      // Alice: [180,160,140] -> 180>150 ✓, Bob: [120,140] no, Charlie: [200,190,180,170] all > 150 ✓, Dave: [] no
      expect(names).toEqual(['Alice', 'Charlie']);
    });
  });

  describe('Comprehension in WHERE clause', () => {
    it('comprehension result used in IN', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WHERE 3 IN [x IN n.scores | x / 10] RETURN n.name'
      );
      // Alice: [9,8,7] -> 3 not in, Bob: [6,7] -> 3 not in, Charlie: [10,9.5,9,8.5] -> 3 not in, Dave: [] -> 3 not in
      expect(results.length).toBe(0);
    });

    it('comprehension with size in WHERE', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WHERE size([x IN n.scores WHERE x >= 80 | x]) >= 3 RETURN n.name'
      );
      // Alice: [90,80,70] -> >=80: [90,80] size=2, Bob: [60,70] -> >=80: [] size=0, Charlie: [100,95,90,85] -> >=80: [100,95,90,85] size=4, Dave: [] size=0
      expect(results).toEqual([{ name: 'Charlie' }]);
    });
  });

  describe('Comprehension in WITH clause', () => {
    it('comprehension in WITH', () => {
      const results = executeQuery(
        graphData,
        'MATCH (n) WITH n.name AS name, [x IN n.scores | x + 1] AS boosted WITH name, boosted WHERE size(boosted) > 1 RETURN name, boosted'
      );
      expect(results).toEqual([
        { name: 'Alice', boosted: [91, 81, 71] },
        { name: 'Bob', boosted: [61, 71] },
        { name: 'Charlie', boosted: [101, 96, 91, 86] },
      ]);
    });
  });

  describe('Comprehension with map literals', () => {
    it('comprehension over map list', () => {
      const results = executeQuery(
        graphData,
        'RETURN [x IN [{a: 1}, {a: 2}, {a: 3}] | x.a] AS values'
      );
      expect(results).toEqual([{ values: [1, 2, 3] }]);
    });

    it('comprehension with map property filter', () => {
      const results = executeQuery(
        graphData,
        'RETURN [x IN [{v: 1}, {v: 2}, {v: 3}] WHERE x.v > 1 | x.v * 10] AS result'
      );
      expect(results).toEqual([{ result: [20, 30] }]);
    });
  });

  describe('Edge cases', () => {
    it('null element in list', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, null, 3] | x] AS result');
      expect(results).toEqual([{ result: [1, null, 3] }]);
    });

    it('null in generator expression', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, null, 3] | x * 2] AS result');
      expect(results).toEqual([{ result: [2, null, 6] }]);
    });

    it('comprehension on null list returns empty', () => {
      const results = executeQuery(graphData, 'RETURN [x IN null | x] AS result');
      expect(results).toEqual([{ result: [] }]);
    });

    it('multiple comprehensions in same RETURN', () => {
      const results = executeQuery(
        graphData,
        'RETURN [x IN [1, 2, 3] | x * 2] AS doubled, [x IN [1, 2, 3] | x * 3] AS tripled'
      );
      expect(results).toEqual([{ doubled: [2, 4, 6], tripled: [3, 6, 9] }]);
    });

    it('comprehension with string concatenation', () => {
      const results = executeQuery(graphData, 'RETURN [x IN ["a", "b", "c"] | x + "!"] AS result');
      expect(results).toEqual([{ result: ['a!', 'b!', 'c!'] }]);
    });

    it('comprehension with coalesce in generator', () => {
      const results = executeQuery(graphData, 'RETURN [x IN [1, null, 3] | coalesce(x, 0)] AS result');
      expect(results).toEqual([{ result: [1, 0, 3] }]);
    });

    it('comprehension with CASE in generator', () => {
      const results = executeQuery(
        graphData,
        'RETURN [x IN [1, 2, 3] | CASE WHEN x > 1 THEN "big" ELSE "small" END] AS result'
      );
      expect(results).toEqual([{ result: ['small', 'big', 'big'] }]);
    });

    it('comprehension with EXISTS in WHERE', () => {
      const results = executeQuery(
        graphData,
        'RETURN [x IN [{a: 1}, {a: null}, {a: 3}] WHERE EXISTS(x.a) | x.a] AS result'
      );
      expect(results).toEqual([{ result: [1, 3] }]);
    });
  });

  describe('Comprehension with ORDER BY', () => {
    it('ORDER BY size of comprehension result (without alias)', () => {
      // Note: ORDER BY with aliases is a known limitation
      const results = executeQuery(
        graphData,
        'MATCH (n) RETURN n.name, [x IN n.scores WHERE x >= 80 | x] AS highScores ORDER BY size([x IN n.scores WHERE x >= 80 | x]) DESC'
      );
      expect(results[0]!.name).toBe('Charlie'); // 4 high scores
      expect(results[results.length - 1]!.name).toBe('Dave'); // 0 high scores
    });
  });

  describe('Comprehension DISTINCT', () => {
    it('comprehension with DISTINCT-like result (no duplicates in source)', () => {
      const results = executeQuery(
        graphData,
        'RETURN [x IN [1, 2, 3, 4, 5] WHERE x > 2 | x] AS distinct'
      );
      expect(results).toEqual([{ distinct: [3, 4, 5] }]);
    });
  });
});
