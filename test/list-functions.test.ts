import { describe, it, expect } from 'vitest';
import { executeQuery } from '../src/lib';

const graphData = {
  nodes: [
    { key: 'a', attributes: { name: 'Alice', tags: ['admin', 'user', 'dev'] } },
    { key: 'b', attributes: { name: 'Bob', tags: ['user'] } },
  ],
  edges: [
    { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
  ],
};

describe('List functions', () => {
  describe('head()', () => {
    it('returns first element of list literal', () => {
      const results = executeQuery(graphData, 'RETURN head([10, 20, 30]) AS first');
      expect(results).toEqual([{ first: 10 }]);
    });

    it('returns null for empty list', () => {
      const results = executeQuery(graphData, 'RETURN head([]) AS first');
      expect(results).toEqual([{ first: null }]);
    });

    it('returns first element from property access', () => {
      const results = executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN head(n.tags) AS first');
      expect(results).toEqual([{ first: 'admin' }]);
    });
  });

  describe('tail()', () => {
    it('returns list without first element', () => {
      const results = executeQuery(graphData, 'RETURN tail([10, 20, 30]) AS rest');
      expect(results).toEqual([{ rest: [20, 30] }]);
    });

    it('returns empty list for single element', () => {
      const results = executeQuery(graphData, 'RETURN tail([1]) AS rest');
      expect(results).toEqual([{ rest: [] }]);
    });

    it('returns empty list for empty list', () => {
      const results = executeQuery(graphData, 'RETURN tail([]) AS rest');
      expect(results).toEqual([{ rest: [] }]);
    });

    it('returns tail from property access', () => {
      const results = executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN tail(n.tags) AS rest');
      expect(results).toEqual([{ rest: ['user', 'dev'] }]);
    });
  });

  describe('last()', () => {
    it('returns last element of list literal', () => {
      const results = executeQuery(graphData, 'RETURN last([10, 20, 30]) AS final');
      expect(results).toEqual([{ final: 30 }]);
    });

    it('returns null for empty list', () => {
      const results = executeQuery(graphData, 'RETURN last([]) AS final');
      expect(results).toEqual([{ final: null }]);
    });

    it('returns last element from property access', () => {
      const results = executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN last(n.tags) AS final');
      expect(results).toEqual([{ final: 'dev' }]);
    });
  });

  describe('reverse()', () => {
    it('reverses list literal', () => {
      const results = executeQuery(graphData, 'RETURN reverse([1, 2, 3]) AS rev');
      expect(results).toEqual([{ rev: [3, 2, 1] }]);
    });

    it('reverses string list', () => {
      const results = executeQuery(graphData, 'RETURN reverse(["a", "b", "c"]) AS rev');
      expect(results).toEqual([{ rev: ['c', 'b', 'a'] }]);
    });

    it('reverses empty list', () => {
      const results = executeQuery(graphData, 'RETURN reverse([]) AS rev');
      expect(results).toEqual([{ rev: [] }]);
    });

    it('reverses property access list', () => {
      const results = executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN reverse(n.tags) AS rev');
      expect(results).toEqual([{ rev: ['dev', 'user', 'admin'] }]);
    });
  });

  describe('size()', () => {
    it('returns size of list literal', () => {
      const results = executeQuery(graphData, 'RETURN size([1, 2, 3]) AS sz');
      expect(results).toEqual([{ sz: 3 }]);
    });

    it('returns 0 for empty list', () => {
      const results = executeQuery(graphData, 'RETURN size([]) AS sz');
      expect(results).toEqual([{ sz: 0 }]);
    });

    it('returns size of property access list', () => {
      const results = executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN size(n.tags) AS sz');
      expect(results).toEqual([{ sz: 3 }]);
    });

    it('works in WHERE clause', () => {
      const results = executeQuery(graphData, 'MATCH (n) WHERE size(n.tags) > 1 RETURN n.name AS name');
      expect(results).toEqual([{ name: 'Alice' }]);
    });

    it('works in ORDER BY', () => {
      const results = executeQuery(graphData, 'MATCH (n) RETURN n.name AS name, size(n.tags) AS sz ORDER BY sz DESC');
      expect(results).toEqual([{ name: 'Alice', sz: 3 }, { name: 'Bob', sz: 1 }]);
    });
  });

  describe('Nested list functions', () => {
    it('head(tail(list))', () => {
      const results = executeQuery(graphData, 'RETURN head(tail([10, 20, 30])) AS second');
      expect(results).toEqual([{ second: 20 }]);
    });

    it('size(reverse(list))', () => {
      const results = executeQuery(graphData, 'RETURN size(reverse([1, 2, 3])) AS sz');
      expect(results).toEqual([{ sz: 3 }]);
    });
  });
});

describe('List slicing', () => {
  describe('Basic slicing', () => {
    it('slices list literal with range [start..end]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4, 5][1..3] AS sliced');
      expect(results).toEqual([{ sliced: [2, 3] }]);
    });

    it('slices from start to end [..end]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4, 5][..3] AS sliced');
      expect(results).toEqual([{ sliced: [1, 2, 3] }]);
    });

    it('slices from start to end [start..]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4, 5][2..] AS sliced');
      expect(results).toEqual([{ sliced: [3, 4, 5] }]);
    });

    it('single index access [index]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4, 5][2] AS val');
      expect(results).toEqual([{ val: 3 }]);
    });

    it('slices property access', () => {
      const results = executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN n.tags[0..2] AS sliced');
      expect(results).toEqual([{ sliced: ['admin', 'user'] }]);
    });
  });

  describe('Negative indices', () => {
    it('negative single index [-1]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4, 5][-1] AS last');
      expect(results).toEqual([{ last: 5 }]);
    });

    it('negative single index [-2]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4, 5][-2] AS val');
      expect(results).toEqual([{ val: 4 }]);
    });

    it('negative range [-2..-1]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4, 5][-2..-1] AS sliced');
      expect(results).toEqual([{ sliced: [4] }]);
    });

    it('negative range [-3..-1]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4, 5][-3..-1] AS sliced');
      expect(results).toEqual([{ sliced: [3, 4] }]);
    });

    it('negative start [-3..]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4, 5][-3..] AS sliced');
      expect(results).toEqual([{ sliced: [3, 4, 5] }]);
    });

    it('negative end [..-2]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4, 5][..-2] AS sliced');
      expect(results).toEqual([{ sliced: [1, 2, 3] }]);
    });

    it('mixed positive and negative [1..-1]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4, 5][1..-1] AS sliced');
      expect(results).toEqual([{ sliced: [2, 3, 4] }]);
    });

    it('negative index on property access', () => {
      const results = executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN n.tags[-1] AS last');
      expect(results).toEqual([{ last: 'dev' }]);
    });

    it('negative range on property access', () => {
      const results = executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN n.tags[-2..] AS sliced');
      expect(results).toEqual([{ sliced: ['user', 'dev'] }]);
    });
  });

  describe('Edge cases', () => {
    it('out of bounds returns null for single index', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3][10] AS val');
      expect(results).toEqual([{ val: null }]);
    });

    it('out of bounds returns empty for range', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3][10..20] AS sliced');
      expect(results).toEqual([{ sliced: [] }]);
    });

    it('empty slice on empty list', () => {
      const results = executeQuery(graphData, 'RETURN [] [0..1] AS sliced');
      expect(results).toEqual([{ sliced: [] }]);
    });

    it('slice with null start [..3]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4][..2] AS sliced');
      expect(results).toEqual([{ sliced: [1, 2] }]);
    });

    it('slice with null end [2..]', () => {
      const results = executeQuery(graphData, 'RETURN [1, 2, 3, 4][2..] AS sliced');
      expect(results).toEqual([{ sliced: [3, 4] }]);
    });
  });

  describe('Slicing with other clauses', () => {
    it('slicing with size in RETURN', () => {
      const results = executeQuery(graphData, 'RETURN size([1, 2, 3, 4, 5][1..3]) AS sz');
      expect(results).toEqual([{ sz: 2 }]);
    });

    it('slicing in WHERE clause with size', () => {
      const results = executeQuery(graphData, 'RETURN size([1, 2, 3, 4, 5][1..3]) AS sz');
      expect(results).toEqual([{ sz: 2 }]);
    });

    it('slicing in ORDER BY', () => {
      const results = executeQuery(graphData, 'MATCH (n) RETURN n.name AS name, size(n.tags[0..1]) AS sz ORDER BY sz DESC');
      expect(results).toEqual([{ name: 'Alice', sz: 1 }, { name: 'Bob', sz: 1 }]);
    });
  });

  describe('Slicing combined with list functions', () => {
    it('head of sliced list', () => {
      const results = executeQuery(graphData, 'RETURN head([1, 2, 3, 4, 5][2..]) AS val');
      expect(results).toEqual([{ val: 3 }]);
    });

    it('size of sliced list', () => {
      const results = executeQuery(graphData, 'RETURN size([1, 2, 3, 4, 5][1..3]) AS sz');
      expect(results).toEqual([{ sz: 2 }]);
    });

    it('reverse of sliced list', () => {
      const results = executeQuery(graphData, 'RETURN reverse([1, 2, 3, 4, 5][1..3]) AS rev');
      expect(results).toEqual([{ rev: [3, 2] }]);
    });

    it('slice of reversed list', () => {
      const results = executeQuery(graphData, 'RETURN reverse([1, 2, 3, 4, 5])[0..2] AS sliced');
      expect(results).toEqual([{ sliced: [5, 4] }]);
    });
  });
});
