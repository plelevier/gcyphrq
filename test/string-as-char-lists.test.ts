import { describe, it, expect } from 'vitest';
import { executeQuery } from '../src/lib';

const graphData = {
  nodes: [
    { key: 'a', attributes: { name: 'Alice', greeting: 'hello' } },
    { key: 'b', attributes: { name: 'Bob', greeting: 'hi' } },
    { key: 'c', attributes: { name: 'Charlie', greeting: '' } },
  ],
  edges: [],
};

describe('String as character lists', () => {
  // ── head() on strings ──────────────────────────────────────────────

  describe('head() on strings', () => {
    it('returns first character of string literal', async () => {
      const results = await executeQuery(graphData, "RETURN head('hello') AS first");
      expect(results).toEqual([{ first: 'h' }]);
    });

    it('returns first character of empty string as null', async () => {
      const results = await executeQuery(graphData, "RETURN head('') AS first");
      expect(results).toEqual([{ first: null }]);
    });

    it('returns first character of single-char string', async () => {
      const results = await executeQuery(graphData, "RETURN head('x') AS first");
      expect(results).toEqual([{ first: 'x' }]);
    });

    it('returns first character from property', async () => {
      const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN head(n.greeting) AS first');
      expect(results).toEqual([{ first: 'h' }]);
    });
  });

  // ── last() on strings ──────────────────────────────────────────────

  describe('last() on strings', () => {
    it('returns last character of string literal', async () => {
      const results = await executeQuery(graphData, "RETURN last('hello') AS final");
      expect(results).toEqual([{ final: 'o' }]);
    });

    it('returns last character of empty string as null', async () => {
      const results = await executeQuery(graphData, "RETURN last('') AS final");
      expect(results).toEqual([{ final: null }]);
    });

    it('returns last character of single-char string', async () => {
      const results = await executeQuery(graphData, "RETURN last('x') AS final");
      expect(results).toEqual([{ final: 'x' }]);
    });

    it('returns last character from property', async () => {
      const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN last(n.greeting) AS final');
      expect(results).toEqual([{ final: 'o' }]);
    });
  });

  // ── tail() on strings ──────────────────────────────────────────────

  describe('tail() on strings', () => {
    it('returns string without first character', async () => {
      const results = await executeQuery(graphData, "RETURN tail('hello') AS rest");
      expect(results).toEqual([{ rest: 'ello' }]);
    });

    it('returns empty string for single-char string', async () => {
      const results = await executeQuery(graphData, "RETURN tail('x') AS rest");
      expect(results).toEqual([{ rest: '' }]);
    });

    it('returns empty string for empty string', async () => {
      const results = await executeQuery(graphData, "RETURN tail('') AS rest");
      expect(results).toEqual([{ rest: '' }]);
    });

    it('returns tail from property', async () => {
      const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN tail(n.greeting) AS rest');
      expect(results).toEqual([{ rest: 'ello' }]);
    });
  });

  // ── reverse() on strings ───────────────────────────────────────────

  describe('reverse() on strings', () => {
    it('reverses string literal', async () => {
      const results = await executeQuery(graphData, "RETURN reverse('hello') AS rev");
      expect(results).toEqual([{ rev: 'olleh' }]);
    });

    it('reverses empty string', async () => {
      const results = await executeQuery(graphData, "RETURN reverse('') AS rev");
      expect(results).toEqual([{ rev: '' }]);
    });

    it('reverses single-char string', async () => {
      const results = await executeQuery(graphData, "RETURN reverse('x') AS rev");
      expect(results).toEqual([{ rev: 'x' }]);
    });

    it('reverses property string', async () => {
      const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN reverse(n.greeting) AS rev');
      expect(results).toEqual([{ rev: 'olleh' }]);
    });
  });

  // ── List slicing on strings ────────────────────────────────────────

  describe('List slicing on strings', () => {
    it('slices string with range [start..end]', async () => {
      const results = await executeQuery(graphData, "RETURN 'hello'[1..3] AS sliced");
      expect(results).toEqual([{ sliced: 'el' }]);
    });

    it('slices string from start [..end]', async () => {
      const results = await executeQuery(graphData, "RETURN 'hello'[..3] AS sliced");
      expect(results).toEqual([{ sliced: 'hel' }]);
    });

    it('slices string from start to end [start..]', async () => {
      const results = await executeQuery(graphData, "RETURN 'hello'[2..] AS sliced");
      expect(results).toEqual([{ sliced: 'llo' }]);
    });

    it('single index access on string [index]', async () => {
      const results = await executeQuery(graphData, "RETURN 'hello'[1] AS val");
      expect(results).toEqual([{ val: 'e' }]);
    });

    it('negative single index on string [-1]', async () => {
      const results = await executeQuery(graphData, "RETURN 'hello'[-1] AS val");
      expect(results).toEqual([{ val: 'o' }]);
    });

    it('negative range on string [-3..-1]', async () => {
      const results = await executeQuery(graphData, "RETURN 'hello'[-3..-1] AS sliced");
      expect(results).toEqual([{ sliced: 'll' }]);
    });

    it('slices property string', async () => {
      const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN n.greeting[1..3] AS sliced');
      expect(results).toEqual([{ sliced: 'el' }]);
    });

    it('out of bounds single index returns null', async () => {
      const results = await executeQuery(graphData, "RETURN 'hello'[10] AS val");
      expect(results).toEqual([{ val: null }]);
    });

    it('out of bounds range returns empty string', async () => {
      const results = await executeQuery(graphData, "RETURN 'hello'[10..20] AS sliced");
      expect(results).toEqual([{ sliced: '' }]);
    });
  });

  // ── UNWIND on strings ──────────────────────────────────────────────

  describe('UNWIND on strings', () => {
    it('unwinds string literal into individual characters', async () => {
      const results = await executeQuery(graphData, "UNWIND 'abc' AS ch RETURN ch");
      expect(results).toEqual([{ ch: 'a' }, { ch: 'b' }, { ch: 'c' }]);
    });

    it('unwinds empty string produces no rows', async () => {
      const results = await executeQuery(graphData, "UNWIND '' AS ch RETURN ch");
      expect(results).toEqual([]);
    });

    it('unwinds string with WHERE filter', async () => {
      const results = await executeQuery(graphData, "UNWIND 'hello' AS ch WHERE ch = 'l' RETURN ch");
      expect(results).toEqual([{ ch: 'l' }, { ch: 'l' }]);
    });

    it('unwinds property string', async () => {
      const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" UNWIND n.greeting AS ch RETURN ch');
      expect(results).toEqual([{ ch: 'h' }, { ch: 'e' }, { ch: 'l' }, { ch: 'l' }, { ch: 'o' }]);
    });
  });

  // ── List comprehensions over strings ───────────────────────────────

  describe('List comprehensions over strings', () => {
    it('iterates over string literal', async () => {
      const results = await executeQuery(graphData, "RETURN [c IN 'hello' | toUpper(c)] AS upper");
      expect(results).toEqual([{ upper: ['H', 'E', 'L', 'L', 'O'] }]);
    });

    it('iterates over string with identity', async () => {
      const results = await executeQuery(graphData, "RETURN [c IN 'abc' | c] AS chars");
      expect(results).toEqual([{ chars: ['a', 'b', 'c'] }]);
    });

    it('iterates over string with WHERE filter', async () => {
      const results = await executeQuery(graphData, "RETURN [c IN 'hello' WHERE c = 'l' | c] AS ls");
      expect(results).toEqual([{ ls: ['l', 'l'] }]);
    });

    it('iterates over empty string', async () => {
      const results = await executeQuery(graphData, "RETURN [c IN '' | c] AS chars");
      expect(results).toEqual([{ chars: [] }]);
    });

    it('iterates over property string', async () => {
      const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN [c IN n.greeting | toUpper(c)] AS upper');
      expect(results).toEqual([{ upper: ['H', 'E', 'L', 'L', 'O'] }]);
    });

    it('iterates over string with arithmetic', async () => {
      const results = await executeQuery(graphData, "RETURN [c IN 'abc' | c + '!'] AS result");
      expect(results).toEqual([{ result: ['a!', 'b!', 'c!'] }]);
    });
  });

  // ── Quantifiers over strings ───────────────────────────────────────

  describe('Quantifiers over strings', () => {
    it('ALL over string literal', async () => {
      const results = await executeQuery(graphData, "MATCH (n) WHERE ALL(c IN 'abc' WHERE c IN ['a','b','c']) RETURN n.name");
      expect(results).toEqual([{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }]);
    });

    it('ANY over string literal', async () => {
      const results = await executeQuery(graphData, "MATCH (n) WHERE ANY(c IN 'hello' WHERE c = 'l') RETURN n.name");
      expect(results.length).toBe(3);
    });

    it('SINGLE over string literal', async () => {
      const results = await executeQuery(graphData, "MATCH (n) WHERE SINGLE(c IN 'abc' WHERE c = 'b') RETURN n.name");
      expect(results.length).toBe(3);
    });

    it('NONE over string literal', async () => {
      const results = await executeQuery(graphData, "MATCH (n) WHERE NONE(c IN 'abc' WHERE c = 'z') RETURN n.name");
      expect(results.length).toBe(3);
    });

    it('ALL over empty string (vacuous truth)', async () => {
      const results = await executeQuery(graphData, "MATCH (n) WHERE ALL(c IN '' WHERE c = 'z') RETURN n.name");
      expect(results.length).toBe(3);
    });

    it('ANY over empty string (false)', async () => {
      const results = await executeQuery(graphData, "MATCH (n) WHERE ANY(c IN '' WHERE c = 'z') RETURN n.name");
      expect(results.length).toBe(0);
    });

    it('ALL over property string', async () => {
      const results = await executeQuery(graphData, 'MATCH (n) WHERE ALL(c IN n.greeting WHERE c IN ["h","i","e","l","o"]) RETURN n.name');
      expect(results.length).toBe(3);
    });
  });

  // ── Reduce over strings ────────────────────────────────────────────

  describe('Reduce over strings', () => {
    it('concatenates characters back to string', async () => {
      const results = await executeQuery(graphData, "RETURN reduce(acc = '', c IN 'hello' | acc + c) AS result");
      expect(results).toEqual([{ result: 'hello' }]);
    });

    it('counts characters with reduce', async () => {
      const results = await executeQuery(graphData, "RETURN reduce(count = 0, c IN 'hello' | count + 1) AS count");
      expect(results).toEqual([{ count: 5 }]);
    });

    it('reduces empty string', async () => {
      const results = await executeQuery(graphData, "RETURN reduce(acc = '', c IN '' | acc + c) AS result");
      expect(results).toEqual([{ result: '' }]);
    });

    it('reduces property string', async () => {
      const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN reduce(acc = "", c IN n.greeting | acc + toUpper(c)) AS upper');
      expect(results).toEqual([{ upper: 'HELLO' }]);
    });
  });

  // ── Nested operations ──────────────────────────────────────────────

  describe('Nested operations', () => {
    it('head(tail(string))', async () => {
      const results = await executeQuery(graphData, "RETURN head(tail('hello')) AS second");
      expect(results).toEqual([{ second: 'e' }]);
    });

    it('size(reverse(string))', async () => {
      const results = await executeQuery(graphData, "RETURN size(reverse('hello')) AS sz");
      expect(results).toEqual([{ sz: 5 }]);
    });

    it('reverse of sliced string', async () => {
      const results = await executeQuery(graphData, "RETURN reverse('hello'[1..4]) AS rev");
      expect(results).toEqual([{ rev: 'lle' }]);
    });

    it('head of reversed string', async () => {
      const results = await executeQuery(graphData, "RETURN head(reverse('hello')) AS first");
      expect(results).toEqual([{ first: 'o' }]);
    });
  });

  // ── FOREACH over strings ───────────────────────────────────────────

  describe('FOREACH over strings', () => {
    it('iterates over string property and creates nodes per character', async () => {
      // FOREACH creates a node for each character in the string
      const results = await executeQuery(graphData, "MATCH (n) WHERE n.name = 'Alice' FOREACH (c IN n.greeting | CREATE (ch:Char {letter: c})) MATCH (ch:Char) RETURN count(ch) AS count");
      expect(results).toEqual([{ count: 5 }]); // 'hello' has 5 chars
    });

    it('iterates over empty string property (no iterations)', async () => {
      // Empty string should produce no iterations
      const results = await executeQuery(graphData, "MATCH (n) WHERE n.name = 'Charlie' FOREACH (c IN n.greeting | CREATE (ch:Char {letter: c})) MATCH (ch:Char) RETURN count(ch) AS count");
      expect(results).toEqual([{ count: 0 }]);
    });
  });

  // ── IN operator with strings ───────────────────────────────────────

  describe('IN operator with strings', () => {
    it('checks if char is IN string literal', async () => {
      const results = await executeQuery(graphData, "MATCH (n) WHERE 'a' IN 'abc' RETURN n.name");
      expect(results.length).toBe(3);
    });

    it('checks if char is NOT IN string literal', async () => {
      const results = await executeQuery(graphData, "MATCH (n) WHERE 'z' IN 'abc' RETURN n.name");
      expect(results.length).toBe(0);
    });

    it('checks if char is IN property string', async () => {
      const results = await executeQuery(graphData, 'MATCH (n) WHERE "e" IN n.greeting RETURN n.name');
      expect(results).toEqual([{ name: 'Alice' }]);
    });

    it('checks if char is IN empty string', async () => {
      const results = await executeQuery(graphData, "MATCH (n) WHERE 'a' IN '' RETURN n.name");
      expect(results.length).toBe(0);
    });
  });

  // ── Compatibility: existing list operations still work ──────────────

  describe('Backward compatibility with lists', () => {
    it('head on list still works', async () => {
      const results = await executeQuery(graphData, 'RETURN head([1, 2, 3]) AS first');
      expect(results).toEqual([{ first: 1 }]);
    });

    it('last on list still works', async () => {
      const results = await executeQuery(graphData, 'RETURN last([1, 2, 3]) AS last');
      expect(results).toEqual([{ last: 3 }]);
    });

    it('tail on list still works', async () => {
      const results = await executeQuery(graphData, 'RETURN tail([1, 2, 3]) AS rest');
      expect(results).toEqual([{ rest: [2, 3] }]);
    });

    it('reverse on list still works', async () => {
      const results = await executeQuery(graphData, 'RETURN reverse([1, 2, 3]) AS rev');
      expect(results).toEqual([{ rev: [3, 2, 1] }]);
    });

    it('list comprehension on list still works', async () => {
      const results = await executeQuery(graphData, 'RETURN [x IN [1, 2, 3] | x * 2] AS doubled');
      expect(results).toEqual([{ doubled: [2, 4, 6] }]);
    });

    it('quantifier on list still works', async () => {
      const results = await executeQuery(graphData, 'MATCH (n) WHERE ALL(x IN [1, 2, 3] WHERE x > 0) RETURN n.name');
      const names = results.map((r: any) => r.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('reduce on list still works', async () => {
      const results = await executeQuery(graphData, 'RETURN reduce(total = 0, x IN [1, 2, 3] | total + x) AS sum');
      expect(results).toEqual([{ sum: 6 }]);
    });
  });
});
