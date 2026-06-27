import { describe, it, expect } from 'vitest';
import { executeQuery } from '../src/lib';

const graphData = {
  nodes: [
    { key: 'alice', attributes: { name: 'Alice', label: 'Person', age: 30 } },
    { key: 'bob', attributes: { name: 'Bob', label: 'Person', age: 25 } },
    { key: 'charlie', attributes: { name: 'Charlie', label: 'Person', age: 35 } },
    { key: 'dave', attributes: { name: 'Dave', label: 'Person', age: 28 } },
    { key: 'eve', attributes: { name: 'Eve', label: 'Person', age: 22 } },
  ],
  edges: [
    { source: 'alice', target: 'bob', attributes: { type: 'KNOWS', since: 2019 } },
    { source: 'alice', target: 'charlie', attributes: { type: 'KNOWS', since: 2021 } },
    { source: 'bob', target: 'charlie', attributes: { type: 'KNOWS', since: 2020 } },
    { source: 'bob', target: 'dave', attributes: { type: 'LIKES', since: 2018 } },
    { source: 'charlie', target: 'eve', attributes: { type: 'KNOWS', since: 2022 } },
  ],
};

describe('Pattern Comprehensions', () => {
  // ── Basic pattern comprehension ──────────────────────────────────────────

  describe('Basic comprehension [(pattern) | expr]', () => {
    it('returns names of connected nodes', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) | b.name] AS friends'
      );
      expect(results).toEqual([{ friends: ['Bob', 'Charlie'] }]);
    });

    it('returns names with typed relationship', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-[:KNOWS]->(b:Person) | b.name] AS friends'
      );
      expect(results).toEqual([{ friends: ['Bob', 'Charlie'] }]);
    });

    it('returns names with typed relationship filtering', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Bob"}) RETURN [(a)-[:KNOWS]->(b:Person) | b.name] AS knows'
      );
      expect(results).toEqual([{ knows: ['Charlie'] }]);
    });

    it('works across multiple nodes', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person) WHERE a.name IN ["Alice", "Bob"] RETURN a.name AS name, [(a)-->(b:Person) | b.name] AS friends ORDER BY name'
      );
      expect(results).toEqual([
        { name: 'Alice', friends: ['Bob', 'Charlie'] },
        { name: 'Bob', friends: ['Charlie', 'Dave'] },
      ]);
    });

    it('returns empty list when no matches', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Eve"}) RETURN [(a)-->(b:Person) | b.name] AS friends'
      );
      expect(results).toEqual([{ friends: [] }]);
    });
  });

  // ── Directional edges ────────────────────────────────────────────────────

  describe('Directional edges', () => {
    it('outgoing edges (default)', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) | b.name] AS outgoing'
      );
      expect(results).toEqual([{ outgoing: ['Bob', 'Charlie'] }]);
    });

    it('incoming edges', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Charlie"}) RETURN [(a)<--(b:Person) | b.name] AS incoming'
      );
      expect(results).toEqual([{ incoming: ['Alice', 'Bob'] }]);
    });

    it('incoming edges with typed relationship', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Charlie"}) RETURN [(a)<-[:KNOWS]-(b:Person) | b.name] AS incoming'
      );
      expect(results).toEqual([{ incoming: ['Alice', 'Bob'] }]);
    });

    it('undirected edges', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Charlie"}) RETURN [(a)--(b:Person) | b.name] AS connections ORDER BY connections'
      );
      // Charlie has incoming from Alice, Bob and outgoing to Eve
      const connections = results[0]!.connections as string[];
      expect(connections.sort()).toEqual(['Alice', 'Bob', 'Eve']);
    });
  });

  // ── Pattern comprehension with WHERE ─────────────────────────────────────

  describe('Comprehension with WHERE', () => {
    it('filter by target property', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) WHERE b.age > 28 | b.name] AS olderFriends'
      );
      expect(results).toEqual([{ olderFriends: ['Charlie'] }]);
    });

    it('filter by target label', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) WHERE b.name = "Bob" | b.name] AS filtered'
      );
      expect(results).toEqual([{ filtered: ['Bob'] }]);
    });

    it('filter with comparison', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) WHERE b.age >= 30 | b.name] AS filtered'
      );
      // Alice's friends: Bob (age 25), Charlie (age 35) -> >= 30: Charlie only
      expect(results).toEqual([{ filtered: ['Charlie'] }]);
    });

    it('returns empty when no matches', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) WHERE b.age > 100 | b.name] AS none'
      );
      expect(results).toEqual([{ none: [] }]);
    });
  });

  // ── Pattern comprehension with relationship variable ─────────────────────

  describe('Relationship variable', () => {
    it('returns relationship as array', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-[r:KNOWS]->(b:Person) | r] AS rels'
      );
      expect(results[0]!.rels).toBeDefined();
      expect(Array.isArray(results[0]!.rels)).toBe(true);
      expect((results[0]!.rels as any[]).length).toBe(2);
    });
  });

  // ── Pattern comprehension with generators ────────────────────────────────

  describe('Generator expressions', () => {
    it('returns target node', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) | b] AS friends'
      );
      expect(results[0]!.friends).toBeDefined();
      expect(Array.isArray(results[0]!.friends)).toBe(true);
    });

    it('returns computed value', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) | b.age * 2] AS doubledAges'
      );
      expect(results).toEqual([{ doubledAges: [50, 70] }]);
    });

    it('returns string transformation', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) | toUpper(b.name)] AS upperNames'
      );
      expect(results).toEqual([{ upperNames: ['BOB', 'CHARLIE'] }]);
    });

    it('returns map literal', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) | {name: b.name, age: b.age}] AS friendInfo'
      );
      expect(results[0]!.friendInfo).toBeDefined();
      expect(Array.isArray(results[0]!.friendInfo)).toBe(true);
      expect((results[0]!.friendInfo as any[]).length).toBe(2);
    });
  });

  // ── Pattern comprehension with aggregations ──────────────────────────────

  describe('With aggregations', () => {
    it('size of comprehension result', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person) RETURN a.name AS name, size([(a)-->(b:Person) | b.name]) AS friendCount ORDER BY name'
      );
      expect(results).toEqual([
        { name: 'Alice', friendCount: 2 },
        { name: 'Bob', friendCount: 2 },
        { name: 'Charlie', friendCount: 1 },
        { name: 'Dave', friendCount: 0 },
        { name: 'Eve', friendCount: 0 },
      ]);
    });

    it('head of comprehension result', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN head([(a)-->(b:Person) | b.name]) AS firstFriend'
      );
      expect(results).toEqual([{ firstFriend: 'Bob' }]);
    });

    it('tail of comprehension result', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN tail([(a)-->(b:Person) | b.name]) AS otherFriends'
      );
      expect(results).toEqual([{ otherFriends: ['Charlie'] }]);
    });
  });

  // ── Pattern comprehension nested in list comprehension ───────────────────

  describe('Nested in list comprehension', () => {
    it('uppercase pattern comprehension result', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [x IN [(a)-->(b:Person) | b.name] | toUpper(x)] AS upperFriends'
      );
      expect(results).toEqual([{ upperFriends: ['BOB', 'CHARLIE'] }]);
    });

    it('filter pattern comprehension result', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [x IN [(a)-->(b:Person) | b.name] WHERE x STARTS WITH "C" | x] AS cFriends'
      );
      expect(results).toEqual([{ cFriends: ['Charlie'] }]);
    });
  });

  // ── Pattern comprehension in WHERE clause ────────────────────────────────

  describe('In WHERE clause', () => {
    it('size of comprehension in WHERE', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person) WHERE size([(a)-->(b:Person) | b.name]) > 1 RETURN a.name ORDER BY a.name'
      );
      expect(results).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
    });

    it('ANY over comprehension result', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person) WHERE ANY(x IN [(a)-->(b:Person) | b.age] WHERE x > 30) RETURN a.name ORDER BY a.name'
      );
      expect(results).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
    });
  });

  // ── Pattern comprehension in WITH clause ─────────────────────────────────

  describe('In WITH clause', () => {
    it('comprehension in WITH', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person) WITH a.name AS name, [(a)-->(b:Person) | b.name] AS friends WITH name, friends WHERE size(friends) > 0 RETURN name, friends ORDER BY name'
      );
      expect(results).toEqual([
        { name: 'Alice', friends: ['Bob', 'Charlie'] },
        { name: 'Bob', friends: ['Charlie', 'Dave'] },
        { name: 'Charlie', friends: ['Eve'] },
      ]);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('source node not bound returns empty', async () => {
      const results = await executeQuery(
        graphData,
        'RETURN [(x)-->(y) | y.name] AS result'
      );
      expect(results).toEqual([{ result: [] }]);
    });

    it('multiple comprehensions in same RETURN', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Bob"}) RETURN [(a)-->(b:Person) | b.name] AS outgoing, [(a)<--(c:Person) | c.name] AS incoming'
      );
      expect(results[0]!.outgoing).toEqual(['Charlie', 'Dave']);
      expect(results[0]!.incoming).toEqual(['Alice']);
    });

    it('comprehension with no relationship type', async () => {
      const results = await executeQuery(
        graphData,
        'MATCH (a:Person {name: "Alice"}) RETURN [(a)-[]->(b:Person) | b.name] AS friends'
      );
      expect(results).toEqual([{ friends: ['Bob', 'Charlie'] }]);
    });
  });
});
