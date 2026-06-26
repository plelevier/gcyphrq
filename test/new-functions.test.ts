import { describe, it, expect } from 'vitest';
import { executeQuery } from '../src/lib';

const graphData = {
  nodes: [
    { key: 'a', attributes: { name: 'Alice', age: 30, active: true, score: 95.5 } },
    { key: 'b', attributes: { name: 'Bob', age: 25, active: false, score: 87.3 } },
    { key: 'c', attributes: { name: 'Charlie', age: 35, active: true, score: 92.1 } },
  ],
  edges: [
    { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
    { source: 'b', target: 'c', attributes: { type: 'FRIENDS' } },
  ],
};

describe('keys() function', () => {
  it('returns keys of a map literal', async () => {
    const results = await executeQuery(graphData, 'RETURN keys({a: 1, b: 2, c: 3}) AS keys');
    expect(results[0]!.keys).toEqual(['a', 'b', 'c']);
  });

  it('returns keys of a node (property access)', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE n.name = "Alice" RETURN keys(n) AS keys ORDER BY keys[0]'
    );
    const keys = results[0]!.keys as string[];
    expect(keys).toContain('name');
    expect(keys).toContain('age');
    expect(keys).toContain('active');
    expect(keys).toContain('score');
  });

  it('returns keys of a map in WHERE clause', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN "name" IN keys({name: "Alice", age: 30}) AS found'
    );
    // IN returns the matching element, not a boolean
    expect(results).toEqual([{ found: 'name' }]);
  });

  it('returns null for null input', async () => {
    const results = await executeQuery(graphData, 'RETURN keys(null) AS keys');
    expect(results).toEqual([{ keys: null }]);
  });

  it('returns null for non-map input', async () => {
    const results = await executeQuery(graphData, 'RETURN keys(42) AS keys');
    expect(results).toEqual([{ keys: null }]);
  });

  it('returns null for list input', async () => {
    const results = await executeQuery(graphData, 'RETURN keys([1, 2, 3]) AS keys');
    expect(results).toEqual([{ keys: null }]);
  });

  it('returns empty list for empty map', async () => {
    const results = await executeQuery(graphData, 'RETURN keys({}) AS keys');
    expect(results).toEqual([{ keys: [] }]);
  });

  it('works with nested maps', async () => {
    const results = await executeQuery(graphData, 'RETURN keys({outer: {inner: 1}, other: 2}) AS keys');
    expect(results[0]!.keys).toEqual(['outer', 'other']);
  });

  it('works in WITH clause', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WITH n.name AS name, keys({a: 1, b: 2}) AS k WITH name, k WHERE size(k) > 1 RETURN name, k'
    );
    expect(results.length).toBe(3);
    expect(results[0]!.k).toEqual(['a', 'b']);
  });
});

describe('toBoolean() function', () => {
  it('converts boolean true', async () => {
    const results = await executeQuery(graphData, 'RETURN toBoolean(true) AS result');
    expect(results).toEqual([{ result: true }]);
  });

  it('converts boolean false', async () => {
    const results = await executeQuery(graphData, 'RETURN toBoolean(false) AS result');
    expect(results).toEqual([{ result: false }]);
  });

  it('converts non-zero number to true', async () => {
    const results = await executeQuery(graphData, 'RETURN toBoolean(1) AS result');
    expect(results).toEqual([{ result: true }]);
  });

  it('converts zero to false', async () => {
    const results = await executeQuery(graphData, 'RETURN toBoolean(0) AS result');
    expect(results).toEqual([{ result: false }]);
  });

  it('converts negative number to true', async () => {
    const results = await executeQuery(graphData, 'RETURN toBoolean(-1) AS result');
    expect(results).toEqual([{ result: true }]);
  });

  it('converts empty string to false', async () => {
    const results = await executeQuery(graphData, "RETURN toBoolean('') AS result");
    expect(results).toEqual([{ result: false }]);
  });

  it('converts non-empty string to true', async () => {
    const results = await executeQuery(graphData, "RETURN toBoolean('yes') AS result");
    expect(results).toEqual([{ result: true }]);
  });

  it('converts null to null', async () => {
    const results = await executeQuery(graphData, 'RETURN toBoolean(null) AS result');
    expect(results).toEqual([{ result: null }]);
  });

  it('converts node property', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE n.name = "Alice" RETURN toBoolean(n.active) AS active'
    );
    expect(results).toEqual([{ active: true }]);
  });

  it('works in WHERE clause', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE toBoolean(n.active) = true RETURN n.name AS name'
    );
    const names = results.map((r: any) => r.name).sort();
    expect(names).toEqual(['Alice', 'Charlie']);
  });

  it('works with NOT in WHERE clause', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE NOT toBoolean(n.active) = true RETURN n.name AS name'
    );
    expect(results).toEqual([{ name: 'Bob' }]);
  });

  it('converts list to true', async () => {
    const results = await executeQuery(graphData, 'RETURN toBoolean([1, 2, 3]) AS result');
    expect(results).toEqual([{ result: true }]);
  });

  it('converts empty list to true', async () => {
    const results = await executeQuery(graphData, 'RETURN toBoolean([]) AS result');
    expect(results).toEqual([{ result: true }]);
  });

  it('converts map to true', async () => {
    const results = await executeQuery(graphData, 'RETURN toBoolean({a: 1}) AS result');
    expect(results).toEqual([{ result: true }]);
  });

  it('converts float to true', async () => {
    const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN toBoolean(n.score) AS result');
    expect(results).toEqual([{ result: true }]);
  });
});

describe('toInt() function', () => {
  it('converts integer to integer', async () => {
    const results = await executeQuery(graphData, 'RETURN toInt(42) AS result');
    expect(results).toEqual([{ result: 42 }]);
  });

  it('converts float to integer (truncates)', async () => {
    const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN toInt(n.score) AS result');
    expect(results).toEqual([{ result: 95 }]);
  });

  it('converts negative float to integer (truncates)', async () => {
    const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN toInt(-n.score) AS result');
    expect(results).toEqual([{ result: -95 }]);
  });

  it('converts numeric string to integer', async () => {
    const results = await executeQuery(graphData, "RETURN toInt('42') AS result");
    expect(results).toEqual([{ result: 42 }]);
  });

  it('converts string with decimals to integer', async () => {
    const results = await executeQuery(graphData, "RETURN toInt('3.14') AS result");
    expect(results).toEqual([{ result: 3 }]);
  });

  it('converts null to null', async () => {
    const results = await executeQuery(graphData, 'RETURN toInt(null) AS result');
    expect(results).toEqual([{ result: null }]);
  });

  it('converts node property', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE n.name = "Alice" RETURN toInt(n.score) AS intScore'
    );
    expect(results).toEqual([{ intScore: 95 }]);
  });

  it('works in WHERE clause', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE toInt(n.age) > 28 RETURN n.name AS name'
    );
    const names = results.map((r: any) => r.name).sort();
    expect(names).toEqual(['Alice', 'Charlie']);
  });

  it('works with arithmetic', async () => {
    const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN toInt(n.score) + toInt(n.age) AS result');
    expect(results).toEqual([{ result: 125 }]);
  });
});

describe('size() function (existing, verify)', () => {
  it('returns size of list', async () => {
    const results = await executeQuery(graphData, 'RETURN size([1, 2, 3]) AS size');
    expect(results).toEqual([{ size: 3 }]);
  });

  it('returns size of string', async () => {
    const results = await executeQuery(graphData, "RETURN size('hello') AS size");
    expect(results).toEqual([{ size: 5 }]);
  });

  it('returns size of empty list', async () => {
    const results = await executeQuery(graphData, 'RETURN size([]) AS size');
    expect(results).toEqual([{ size: 0 }]);
  });

  it('returns null for null input', async () => {
    const results = await executeQuery(graphData, 'RETURN size(null) AS size');
    expect(results).toEqual([{ size: null }]);
  });
});

describe('toInteger() function (existing, verify)', () => {
  it('converts integer to integer', async () => {
    const results = await executeQuery(graphData, 'RETURN toInteger(42) AS result');
    expect(results).toEqual([{ result: 42 }]);
  });

  it('converts float to integer (truncates)', async () => {
    const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN toInteger(n.score) AS result');
    expect(results).toEqual([{ result: 95 }]);
  });

  it('converts null to null', async () => {
    const results = await executeQuery(graphData, 'RETURN toInteger(null) AS result');
    expect(results).toEqual([{ result: null }]);
  });
});

describe('toFloat() function (existing, verify)', () => {
  it('converts integer to float', async () => {
    const results = await executeQuery(graphData, 'RETURN toFloat(42) AS result');
    expect(results).toEqual([{ result: 42 }]);
  });

  it('converts float to float', async () => {
    const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN toFloat(n.score) AS result');
    expect(results).toEqual([{ result: 95.5 }]);
  });

  it('converts null to null', async () => {
    const results = await executeQuery(graphData, 'RETURN toFloat(null) AS result');
    expect(results).toEqual([{ result: null }]);
  });
});

describe('reltype() function (existing, verify)', () => {
  it('returns relationship type', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (a)-[r]->(b) RETURN reltype(r) AS type'
    );
    const types = results.map((r: any) => r.type).sort();
    expect(types).toEqual(['FRIENDS', 'KNOWS']);
  });
});

describe('Combined new functions', () => {
  it('keys with size', async () => {
    const results = await executeQuery(graphData, 'RETURN size(keys({a: 1, b: 2, c: 3})) AS count');
    expect(results).toEqual([{ count: 3 }]);
  });

  it('toBoolean with keys', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE toBoolean(size(keys({a: 1})) > 0) RETURN n.name AS name'
    );
    expect(results.length).toBe(3);
  });

  it('toInt with toBoolean', async () => {
    const results = await executeQuery(graphData, 'MATCH (n) WHERE n.name = "Alice" RETURN toBoolean(toInt(n.score) > 90) AS result');
    expect(results).toEqual([{ result: true }]);
  });

  it('keys in list comprehension', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN [k IN keys({a: 1, b: 2, c: 3}) | k] AS allKeys'
    );
    expect(results[0]!.allKeys).toEqual(['a', 'b', 'c']);
  });
});
