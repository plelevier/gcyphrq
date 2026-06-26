import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance } from './engine-setup';

describe('Engine - WHERE', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createTestGraph();
    engine = createEngine(graph);
  });

  describe('execute - WHERE operators', () => {
    it('filters with WHERE = operator', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name, count(u) AS cnt WHERE cnt = 1 RETURN name',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('filters with WHERE < operator', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name, count(u) AS cnt WHERE cnt < 2 RETURN name',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('filters with WHERE < operator that excludes all', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name, count(u) AS cnt WHERE cnt < 0 RETURN name',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });
  });

  describe('execute - WHERE CONTAINS', () => {
    it('filters with WHERE CONTAINS operator (match found)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "Ali" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('filters with WHERE CONTAINS operator (no match)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "xyz" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE CONTAINS on WITH clause', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name WHERE name CONTAINS "ob" RETURN name',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Bob');
    });

    it('filters with WHERE CONTAINS partial match', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "ar" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
    });

    it('filters with WHERE CONTAINS case-sensitive', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "alice" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE CONTAINS on relationship traversal', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WHERE a.name CONTAINS "Ali" RETURN a, b',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'a').name).toBe('Alice');
      expect(node(results[0]!, 'b').name).toBe('Bob');
    });
  });

  describe('execute - WHERE AND', () => {
    it('filters with WHERE AND (both conditions true)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age > 25 AND u.age < 35 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Dave']);
    });

    it('filters with WHERE AND (one condition false)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age > 30 AND u.name = "Alice" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE AND (both conditions false)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age > 100 AND u.age < 5 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE AND on WITH clause', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS cnt WHERE cnt > 0 AND name = "Alice" RETURN name, cnt',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.cnt).toBe(1);
    });

    it('filters with WHERE AND combining CONTAINS and comparison', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "li" AND u.age > 20 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('filters with WHERE AND combining CONTAINS and equality', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "ob" AND u.age = 25 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Bob');
    });

    it('filters with WHERE AND multiple conditions', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age > 20 AND u.age < 35 AND u.name CONTAINS "li" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });
  });

  describe('execute - WHERE OR', () => {
    it('filters with WHERE OR (first condition true)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name = "Alice" OR u.age > 100 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('filters with WHERE OR (second condition true)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name = "Unknown" OR u.age > 29 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('filters with WHERE OR (both conditions true for some)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name = "Alice" OR u.age > 30 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('filters with WHERE OR (no match)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name = "Unknown" OR u.age > 100 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE OR on WITH clause', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS cnt WHERE cnt > 1 OR name = "Alice" RETURN name, cnt',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('filters with WHERE OR combining CONTAINS', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "Ali" OR u.name CONTAINS "ob" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob']);
    });

    it('filters with WHERE OR combining CONTAINS and comparison', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "ob" OR u.age > 32 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('filters with WHERE OR multiple conditions', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name = "Alice" OR u.name = "Bob" OR u.name = "Charlie" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });
  });

  describe('execute - WHERE AND + OR combined', () => {
    it('evaluates AND before OR (AND has higher precedence)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age > 25 AND u.name = "Alice" OR u.age < 26 RETURN u',
      );
      const results = await engine.execute(ast);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob']);
    });

    it('evaluates parenthesized OR before AND', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE (u.age > 32 OR u.age < 26) AND u.name CONTAINS "a" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
    });

    it('evaluates complex WHERE with AND, OR, and CONTAINS', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE (u.name CONTAINS "Ali" OR u.name CONTAINS "ob") AND u.age > 20 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob']);
    });

    it('evaluates WHERE with AND, OR on WITH clause', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS cnt WHERE (cnt > 0 OR name = "Charlie") AND name <> "Bob" RETURN name, cnt',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
    });

    it('evaluates WHERE with AND combining two CONTAINS', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name CONTAINS "a" AND u.name CONTAINS "r" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
    });
  });

  describe('execute - WHERE on MATCH', () => {
    it('filters by equality on a property', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.name = "Alice" RETURN u');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('filters by greater-than on a numeric property', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.age > 28 RETURN u');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('filters by less-than on a numeric property', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.age < 30 RETURN u');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Dave']);
    });

    it('filters on a relationship traversal', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WHERE a.name = "Alice" RETURN a, b',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'a').name).toBe('Alice');
      expect(node(results[0]!, 'b').name).toBe('Bob');
    });

    it('returns empty results when no match', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.name = "Unknown" RETURN u');
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with bare pattern (no label) and WHERE', async () => {
      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN n');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'n').name).toBe('Alice');
    });

    it('filters with bare pattern and WHERE on numeric property', async () => {
      const ast = parseCypher('MATCH (n) WHERE n.age > 29 RETURN n');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'n').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('OPTIONAL MATCH with WHERE returns null when no match', async () => {
      const ast = parseCypher('OPTIONAL MATCH (u:User) WHERE u.name = "Unknown" RETURN u');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.u).toBeNull();
    });

    it('OPTIONAL MATCH with WHERE returns match when found', async () => {
      const ast = parseCypher('OPTIONAL MATCH (u:User) WHERE u.name = "Alice" RETURN u');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('OPTIONAL MATCH with chain and WHERE returns null when no match', async () => {
      const ast = parseCypher(
        'MATCH (a:User) OPTIONAL MATCH (a)-[r:FRIEND]->(b:User) WHERE b.name = "Unknown" RETURN a, b',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
      for (const row of results) expect(row.b).toBeNull();
    });

    it('OPTIONAL MATCH with chain and WHERE returns match when found', async () => {
      const ast = parseCypher(
        'MATCH (a:User) OPTIONAL MATCH (a)-[r:FRIEND]->(b:User) WHERE b.name = "Bob" RETURN a, b',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
      const matches = results.filter((r) => r.b !== null);
      expect(matches.length).toBe(1);
      expect(node(matches[0]!, 'a').name).toBe('Alice');
      expect(node(matches[0]!, 'b').name).toBe('Bob');
    });
  });

  describe('execute - WHERE NOT', () => {
    it('filters with NOT on equality', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.name = "Alice" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
    });

    it('filters with NOT on greater-than', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.age > 30 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Dave']);
    });

    it('filters with NOT on less-than', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.age < 30 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('filters with NOT on CONTAINS', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.name CONTAINS "Ali" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
    });

    it('filters with NOT on CONTAINS (no match for inner)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.name CONTAINS "xyz" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('filters with NOT on WITH clause', async () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS cnt WHERE NOT cnt > 1 RETURN name, cnt',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('filters with NOT combined with AND', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.age > 30 AND u.name CONTAINS "ob" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Bob');
    });

    it('filters with NOT combined with OR', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.age > 30 OR u.name = "Charlie" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('filters with NOT on parenthesized OR', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT (u.age > 32 OR u.name = "Alice") RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Dave']);
    });

    it('filters with NOT on parenthesized AND', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT (u.age > 25 AND u.age < 35) RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('filters with double NOT (NOT NOT)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT NOT u.name = "Alice" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('filters with triple NOT (NOT NOT NOT)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT NOT NOT u.name = "Alice" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
    });

    it('filters with NOT on not-equals (<>)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.name <> "Alice" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('filters with NOT combined with <>', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT u.age <> 30 AND u.name CONTAINS "li" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });
  });

  describe('execute - WHERE IS NULL', () => {
    let graphWithNulls: GraphInstance;
    let engineWithNulls: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      graphWithNulls = new Graph();
      graphWithNulls.addNode('a', { label: 'User', name: 'Alice', email: 'alice@example.com' });
      graphWithNulls.addNode('b', { label: 'User', name: 'Bob', email: null });
      graphWithNulls.addNode('c', { label: 'User', name: 'Charlie' });
      graphWithNulls.addNode('d', { label: 'User', name: 'Dave', email: 'dave@example.com' });
      engineWithNulls = new AdvancedCypherGraphologyEngine(graphWithNulls);
    });

    it('filters nodes where property IS NULL (explicit null)', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NULL RETURN u');
      const results = await engineWithNulls.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('filters nodes where property IS NOT NULL', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NOT NULL RETURN u');
      const results = await engineWithNulls.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Dave']);
    });

    it('IS NULL on a non-existent property returns true', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.phone IS NULL RETURN u');
      const results = await engineWithNulls.execute(ast);
      expect(results.length).toBe(4);
    });

    it('IS NOT NULL on a non-existent property returns false', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.phone IS NOT NULL RETURN u');
      const results = await engineWithNulls.execute(ast);
      expect(results.length).toBe(0);
    });

    it('IS NULL combined with AND', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NULL AND u.name = "Bob" RETURN u');
      const results = await engineWithNulls.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Bob');
    });

    it('IS NOT NULL combined with AND', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NOT NULL AND u.name = "Alice" RETURN u');
      const results = await engineWithNulls.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('IS NULL combined with OR', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NULL OR u.name = "Alice" RETURN u');
      const results = await engineWithNulls.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('IS NOT NULL combined with OR', async () => {
      const ast = parseCypher('MATCH (u:User) WHERE u.email IS NOT NULL OR u.name = "Charlie" RETURN u');
      const results = await engineWithNulls.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie', 'Dave']);
    });

    it('IS NULL on WITH clause', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'A', value: 10 });
      g.addNode('b', { label: 'Item', name: 'B', value: null });
      g.addNode('c', { label: 'Item', name: 'C' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (i:Item) WITH i.name AS name, i.value AS value WHERE value IS NULL RETURN name',
      );
      const results = await e.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => r.name).sort();
      expect(names).toEqual(['B', 'C']);
    });

    it('IS NOT NULL on WITH clause', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'A', value: 10 });
      g.addNode('b', { label: 'Item', name: 'B', value: null });
      g.addNode('c', { label: 'Item', name: 'C' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (i:Item) WITH i.name AS name, i.value AS value WHERE value IS NOT NULL RETURN name, value',
      );
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('A');
      expect(results[0]!.value).toBe(10);
    });

    it('IS NULL with relationship traversal', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob', email: null });
      g.addNode('c', { label: 'User', name: 'Charlie', email: 'charlie@example.com' });
      g.addEdge('a', 'b', { type: 'FRIEND' });
      g.addEdge('a', 'c', { type: 'FRIEND' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User)-[r:FRIEND]->(f:User) WHERE f.email IS NULL RETURN u.name AS from, f.name AS to',
      );
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.from).toBe('Alice');
      expect(results[0]!.to).toBe('Bob');
    });

    it('IS NOT NULL with relationship traversal', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob', email: null });
      g.addNode('c', { label: 'User', name: 'Charlie', email: 'charlie@example.com' });
      g.addEdge('a', 'b', { type: 'FRIEND' });
      g.addEdge('a', 'c', { type: 'FRIEND' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User)-[r:FRIEND]->(f:User) WHERE f.email IS NOT NULL RETURN u.name AS from, f.name AS to',
      );
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.from).toBe('Alice');
      expect(results[0]!.to).toBe('Charlie');
    });

    it('IS NULL combined with CONTAINS', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.email IS NULL OR u.name CONTAINS "Dav" RETURN u',
      );
      const results = await engineWithNulls.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
    });

    it('IS NOT NULL combined with comparison', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'A', value: 10, score: 85 });
      g.addNode('b', { label: 'Item', name: 'B', value: null, score: 90 });
      g.addNode('c', { label: 'Item', name: 'C', value: 5, score: 70 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (i:Item) WHERE i.value IS NOT NULL AND i.score > 80 RETURN i.name',
      );
      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('A');
    });

    it('IS NULL on OPTIONAL MATCH null variable', async () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) WHERE f IS NULL RETURN u.name, f',
      );
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      g.addEdge('bob', 'alice', { type: 'FRIEND' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const results = await e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.f).toBeNull();
    });

    it('IS NOT NULL in OPTIONAL MATCH WHERE filters matches but null-fill still produced', async () => {
      const g = new Graph();
      g.addNode('alice', { label: 'User', name: 'Alice' });
      g.addNode('bob', { label: 'User', name: 'Bob' });
      g.addNode('charlie', { label: 'User', name: 'Charlie' });
      g.addEdge('alice', 'bob', { type: 'FRIEND' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) WHERE f IS NOT NULL RETURN u.name AS from, f',
      );
      const results = await e.execute(ast);
      expect(results.length).toBe(3);
      const aliceResult = results.find(r => r.from === 'Alice');
      expect(aliceResult).toBeDefined();
      expect(aliceResult!.f).not.toBeNull();
      const bobResult = results.find(r => r.from === 'Bob');
      expect(bobResult!.f).toBeNull();
      const charlieResult = results.find(r => r.from === 'Charlie');
      expect(charlieResult!.f).toBeNull();
    });
  });

  describe('execute - WHERE IN', () => {
    it('filters with WHERE IN (match found)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name IN ["Alice", "Bob"] RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob']);
    });

    it('filters with WHERE IN (no match)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name IN ["Eve", "Frank"] RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE IN on numeric values', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age IN [25, 35] RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('filters with WHERE NOT IN', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT (u.name IN ["Alice", "Bob"]) RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Charlie', 'Dave']);
    });

    it('filters with WHERE IN combined with AND', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name IN ["Alice", "Bob", "Charlie"] AND u.age > 28 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('filters with WHERE IN on WITH clause', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name WHERE name IN ["Alice", "Charlie"] RETURN name',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => r.name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });
  });

  describe('execute - WHERE STARTS WITH / ENDS WITH', () => {
    it('filters with WHERE STARTS WITH (match found)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name STARTS WITH "Al" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('filters with WHERE STARTS WITH (no match)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name STARTS WITH "xyz" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE ENDS WITH (match found)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name ENDS WITH "ie" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
    });

    it('filters with WHERE ENDS WITH (no match)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name ENDS WITH "xyz" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE NOT STARTS WITH', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT (u.name STARTS WITH "A") RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
    });

    it('filters with WHERE NOT ENDS WITH', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE NOT (u.name ENDS WITH "e") RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Bob');
    });

    it('filters with WHERE STARTS WITH combined with AND', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name STARTS WITH "C" AND u.age > 30 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
    });

    it('filters with WHERE STARTS WITH on WITH clause', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name WHERE name STARTS WITH "A" RETURN name',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
    });
  });

  describe('execute - string comparison', () => {
    it('filters with WHERE < on strings', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name < "C" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob']);
    });

    it('filters with WHERE > on strings', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name > "C" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Charlie', 'Dave']);
    });

    it('filters with WHERE < on strings (no match)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name < "A" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE > on strings (no match)', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name > "Z" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(0);
    });

    it('filters with WHERE < on strings combined with AND', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.name > "A" AND u.name < "D" RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('still works with numeric < and >', async () => {
      const ast = parseCypher(
        'MATCH (u:User) WHERE u.age > 25 AND u.age < 35 RETURN u',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'u').name).sort();
      expect(names).toEqual(['Alice', 'Dave']);
    });
  });

  describe('>= and <= comparison operators', () => {
    it('works in WHERE with >=', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', val: 10 });
      g.addNode('b', { label: 'Item', val: 20 });
      g.addNode('c', { label: 'Item', val: 30 });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.val >= 20 RETURN n.val ORDER BY n.val ASC');
      const results = await e.execute(ast);
      expect(results.map((r) => r.val)).toEqual([20, 30]);
    });

    it('works in WHERE with <=', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', val: 10 });
      g.addNode('b', { label: 'Item', val: 20 });
      g.addNode('c', { label: 'Item', val: 30 });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.val <= 20 RETURN n.val ORDER BY n.val ASC');
      const results = await e.execute(ast);
      expect(results.map((r) => r.val)).toEqual([10, 20]);
    });

    it('works in WHERE with >= on strings', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Alice' });
      g.addNode('b', { label: 'Item', name: 'Bob' });
      g.addNode('c', { label: 'Item', name: 'Charlie' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.name >= "Bob" RETURN n.name ORDER BY n.name ASC');
      const results = await e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Bob', 'Charlie']);
    });

    it('works in WHERE with <= on strings', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', name: 'Alice' });
      g.addNode('b', { label: 'Item', name: 'Bob' });
      g.addNode('c', { label: 'Item', name: 'Charlie' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.name <= "Bob" RETURN n.name ORDER BY n.name ASC');
      const results = await e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Alice', 'Bob']);
    });

    it('works in WHERE with AND combining >= and <=', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', val: 5 });
      g.addNode('b', { label: 'Item', val: 15 });
      g.addNode('c', { label: 'Item', val: 25 });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.val >= 10 AND n.val <= 20 RETURN n.val');
      const results = await e.execute(ast);
      expect(results.map((r) => r.val)).toEqual([15]);
    });

    it('works in ORDER BY with >=', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', val: 10 });
      g.addNode('b', { label: 'Item', val: 20 });
      g.addNode('c', { label: 'Item', val: 30 });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.val >= 20 RETURN n.val ORDER BY n.val ASC');
      const results = await e.execute(ast);
      expect(results.map((r) => r.val)).toEqual([20, 30]);
    });

    it('returns false for null operands with >=', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', val: 10 });
      g.addNode('b', { label: 'Item' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.val >= 5 RETURN n.val');
      const results = await e.execute(ast);
      expect(results.map((r) => r.val)).toEqual([10]);
    });

    it('returns false for null operands with <=', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Item', val: 10 });
      g.addNode('b', { label: 'Item' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) WHERE n.val <= 15 RETURN n.val');
      const results = await e.execute(ast);
      expect(results.map((r) => r.val)).toEqual([10]);
    });
  });
});
