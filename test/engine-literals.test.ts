import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance } from './engine-setup';

describe('Engine - literals', () => {
  describe('Map literals', () => {
    it('returns static map literal in RETURN', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN {name: "Alice", age: 30} AS m');
      const results = e.execute(ast);
      expect(results).toEqual([{ m: { name: 'Alice', age: 30 } }]);
    });

    it('returns map literal with dynamic property access in RETURN', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN {name: n.name, upper: toUpper(n.name)} AS profile');
      const results = e.execute(ast);
      expect(results).toEqual([{ profile: { name: 'Alice', upper: 'ALICE' } }]);
    });

    it('returns map literal with function call in RETURN', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN {displayName: toUpper(n.name), lower: toLower(n.name)} AS m');
      const results = e.execute(ast);
      expect(results).toEqual([{ m: { displayName: 'ALICE', lower: 'alice' } }]);
    });

    it('returns map literal in WITH clause', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WITH {name: n.name, upper: toUpper(n.name)} AS p RETURN p');
      const results = e.execute(ast);
      expect(results).toEqual([{ p: { name: 'Alice', upper: 'ALICE' } }]);
    });

    it('WHERE = with map literal matches node by subset of properties', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice"} RETURN n.name AS name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Alice']);
    });

    it('WHERE = with map literal matches multiple properties', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', age: 30 });
      g.addNode('b', { label: 'User', name: 'Alice', age: 25 });
      g.addNode('c', { label: 'User', name: 'Bob', age: 30 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n = {name: "Alice", age: 30} RETURN n.age AS age');
      const results = e.execute(ast);
      expect(results.map((r) => r.age)).toEqual([30]);
    });

    it('WHERE <> with map literal excludes matching node', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n <> {name: "Alice"} RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Bob']);
    });

    it('SET with map literal value', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) SET n.meta = {key: "val", num: 42} RETURN n.meta AS meta');
      const results = e.execute(ast);
      expect(results).toEqual([{ meta: { key: 'val', num: 42 } }]);
    });

    it('SET with map literal containing dynamic expression', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) SET n.profile = {displayName: toUpper(n.name)} RETURN n.profile AS profile');
      const results = e.execute(ast);
      expect(results).toEqual([{ profile: { displayName: 'ALICE' } }]);
    });

    it('UNWIND with list of map literals', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('UNWIND [{name: "Alice"}, {name: "Bob"}] AS x RETURN x AS x');
      const results = e.execute(ast);
      expect(results).toEqual([{ x: { name: 'Alice' } }, { x: { name: 'Bob' } }]);
    });
  });

  describe('List literals with dynamic values', () => {
    it('returns list with property access in RETURN', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN [n.name, "static"] AS info');
      const results = e.execute(ast);
      expect(results).toEqual([{ info: ['Alice', 'static'] }]);
    });

    it('returns list with function call in RETURN', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN [n.name, toUpper(n.name)] AS info');
      const results = e.execute(ast);
      expect(results).toEqual([{ info: ['Alice', 'ALICE'] }]);
    });

    it('returns list with node reference in RETURN', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN [n.name, n] AS info');
      const results = e.execute(ast);
      expect(results[0]!.info).toBeInstanceOf(Array);
      expect((results[0]!.info as unknown[])[0]).toBe('Alice');
      expect((results[0]!.info as unknown[])[1]).toHaveProperty('id', 'a');
    });

    it('WHERE IN with dynamic list literal', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name IN [n.name] RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Alice', 'Bob']);
    });

    it('list literal with map literals inside', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('RETURN [{a: 1}, {a: 2}] AS list');
      const results = e.execute(ast);
      expect(results).toEqual([{ list: [{ a: 1 }, { a: 2 }] }]);
    });

    it('WHERE IN with PropertyAccess on property list', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', tags: ['admin', 'user'] });
      g.addNode('b', { label: 'User', name: 'Bob', tags: ['user'] });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name IN [n.name] RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Alice', 'Bob']);
    });

    it('WHERE IN with FunctionCall RHS (split)', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name IN split("Alice,Bob,Charlie", ",") RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Alice', 'Bob']);
    });

    it('WHERE IN with list of maps', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', role: 'admin' });
      g.addNode('b', { label: 'User', name: 'Bob', role: 'user' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n IN [{name: "Alice"}, {name: "Charlie"}] RETURN n.name AS name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Alice']);
    });

    it('deep equality for nested maps in WHERE', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', meta: { role: 'admin', active: true } });
      g.addNode('b', { label: 'User', name: 'Bob', meta: { role: 'user', active: true } });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.meta = {role: "admin"} RETURN n.name AS name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Alice']);
    });

    it('deep equality for nested lists in WHERE', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', tags: ['admin', 'user'] });
      g.addNode('b', { label: 'User', name: 'Bob', tags: ['user'] });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.tags = ["admin", "user"] RETURN n.name AS name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Alice']);
    });
  });

  describe('Map literals with non-literal values', () => {
    it('map literal with list value from function call', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN {name: n.name, tags: split(n.name, "")} AS m');
      const results = e.execute(ast);
      expect(results).toEqual([{ m: { name: 'Alice', tags: ['A', 'l', 'i', 'c', 'e'] } }]);
    });

    it('map literal with node reference', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN {name: n.name, node: n} AS m');
      const results = e.execute(ast);
      expect(results[0]!.m).toHaveProperty('name', 'Alice');
      expect(results[0]!.m).toHaveProperty('node');
      expect((results[0]!.m as Record<string, unknown>).node).toHaveProperty('id', 'a');
    });

    it('map literal with mixed literal and non-literal values', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN {static: "val", dynamic: n.name, upper: toUpper(n.name)} AS m');
      const results = e.execute(ast);
      expect(results).toEqual([{ m: { static: 'val', dynamic: 'Alice', upper: 'ALICE' } }]);
    });

    it('UNWIND with map containing list value', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('UNWIND [{name: "Alice", tags: ["a", "b"]}, {name: "Bob"}] AS x RETURN x');
      const results = e.execute(ast);
      expect(results).toEqual([
        { x: { name: 'Alice', tags: ['a', 'b'] } },
        { x: { name: 'Bob' } },
      ]);
    });

    it('RETURN map with list value from function call', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n) WHERE n.name = "Alice" RETURN {name: n.name, tags: split(n.name, "")} AS m');
      const results = e.execute(ast);
      expect(results).toEqual([{ m: { name: 'Alice', tags: ['A', 'l', 'i', 'c', 'e'] } }]);
    });

    it('RETURN map with list value as static literal', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('RETURN {name: "Alice", tags: ["a", "b"]} AS m');
      const results = e.execute(ast);
      expect(results).toEqual([{ m: { name: 'Alice', tags: ['a', 'b'] } }]);
    });
  });
});
