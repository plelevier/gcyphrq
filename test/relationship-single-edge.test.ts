import { describe, it, expect } from 'vitest';
import { executeQuery } from '../src/lib';
import type { CypherEdge } from '../src/types/cypher';

const graphData = {
  nodes: [
    { key: 'alice', attributes: { label: 'Person', name: 'Alice' } },
    { key: 'bob', attributes: { label: 'Person', name: 'Bob' } },
    { key: 'charlie', attributes: { label: 'Person', name: 'Charlie' } },
  ],
  edges: [
    { source: 'alice', target: 'bob', attributes: { type: 'KNOWS' } },
    { source: 'bob', target: 'charlie', attributes: { type: 'LIKES' } },
  ],
};

describe('Relationship variable semantics', () => {
  describe('Single-hop MATCH returns single edge (not array)', () => {
    it('r is a single edge object, not an array', async () => {
      const results = await executeQuery(graphData, 'MATCH (a:Person {name: "Alice"})-[r]->(b:Person) RETURN r');
      expect(results.length).toBe(1);
      const r = results[0]!.r;
      expect(Array.isArray(r)).toBe(false);
      expect(typeof r).toBe('object');
    });

    it('r.type returns the relationship type via property access', async () => {
      const results = await executeQuery(graphData, 'MATCH (a:Person {name: "Alice"})-[r]->(b:Person) RETURN r.type AS type');
      expect(results).toEqual([{ type: 'KNOWS' }]);
    });

    it('r.source and r.target return edge endpoints', async () => {
      const results = await executeQuery(graphData, 'MATCH (a:Person {name: "Alice"})-[r]->(b:Person) RETURN r.source AS src, r.target AS tgt');
      expect(results).toEqual([{ src: 'alice', tgt: 'bob' }]);
    });

    it('r.id returns the edge id', async () => {
      const results = await executeQuery(graphData, 'MATCH (a:Person {name: "Alice"})-[r]->(b:Person) RETURN r.id AS id');
      expect(results[0]!.id).toBeDefined();
      expect(typeof results[0]!.id).toBe('string');
    });

    it('reltype(r) still works as before', async () => {
      const results = await executeQuery(graphData, 'MATCH (a:Person {name: "Alice"})-[r]->(b:Person) RETURN reltype(r) AS type');
      expect(results).toEqual([{ type: 'KNOWS' }]);
    });

    it('type(r) works as alias for reltype(r)', async () => {
      const results = await executeQuery(graphData, 'MATCH (a:Person {name: "Alice"})-[r]->(b:Person) RETURN type(r) AS type');
      expect(results).toEqual([{ type: 'KNOWS' }]);
    });
  });

  describe('r.type in WITH with aggregation (grouping by relationship type)', () => {
    it('groups by r.type and counts', async () => {
      const results = await executeQuery(graphData, 'MATCH (a)-[r]->(b) WITH r.type AS t, count(*) AS c RETURN t, c ORDER BY t');
      expect(results).toEqual([
        { t: 'KNOWS', c: 1 },
        { t: 'LIKES', c: 1 },
      ]);
    });

    it('groups by type(r) and counts', async () => {
      const results = await executeQuery(graphData, 'MATCH (a)-[r]->(b) WITH type(r) AS t, count(*) AS c RETURN t, c ORDER BY t');
      expect(results).toEqual([
        { t: 'KNOWS', c: 1 },
        { t: 'LIKES', c: 1 },
      ]);
    });

    it('groups by reltype(r) and counts (regression)', async () => {
      const results = await executeQuery(graphData, 'MATCH (a)-[r]->(b) WITH reltype(r) AS t, count(*) AS c RETURN t, c ORDER BY t');
      expect(results).toEqual([
        { t: 'KNOWS', c: 1 },
        { t: 'LIKES', c: 1 },
      ]);
    });

    it('multiple edges of same type group correctly', async () => {
      const g = {
        ...graphData,
        nodes: [...graphData.nodes, { key: 'dave', attributes: { label: 'Person', name: 'Dave' } }],
        edges: [...graphData.edges, { source: 'alice', target: 'dave', attributes: { type: 'KNOWS' } }],
      };
      const results = await executeQuery(g, 'MATCH (a)-[r]->(b) WITH r.type AS t, count(*) AS c RETURN t, c ORDER BY c DESC');
      expect(results).toEqual([
        { t: 'KNOWS', c: 2 },
        { t: 'LIKES', c: 1 },
      ]);
    });
  });

  describe('Variable-length patterns still return arrays', () => {
    it('r is an array for variable-length patterns', async () => {
      const results = await executeQuery(graphData, 'MATCH (a:Person {name: "Alice"})-[r*1..2]->(c:Person) RETURN r');
      // Should find alice->bob (len 1) and alice->bob->charlie (len 2)
      expect(results.length).toBe(2);
      for (const row of results) {
        expect(Array.isArray(row.r)).toBe(true);
      }
    });

    it('size(r) works for variable-length patterns', async () => {
      const results = await executeQuery(graphData, 'MATCH (a:Person {name: "Alice"})-[r*1..2]->(c:Person) RETURN size(r) AS len ORDER BY len');
      expect(results).toEqual([{ len: 1 }, { len: 2 }]);
    });

    it('reltype(r) works for variable-length (returns array of types)', async () => {
      const results = await executeQuery(graphData, 'MATCH (a:Person {name: "Alice"})-[r*1..2]->(c:Person) RETURN reltype(r) AS types ORDER BY size(types)');
      expect(results.length).toBe(2);
    });
  });

  describe('OPTIONAL MATCH nulls relationship variable (single-hop)', () => {
    it('r is null when no match (single-hop)', async () => {
      const results = await executeQuery(graphData, 'MATCH (u:Person {name: "Charlie"}) OPTIONAL MATCH (u)-[r:FRIEND]->(f:Person) RETURN u.name, r');
      expect(results.length).toBe(1);
      expect(results[0]!.r).toBeNull();
    });

    it('r is a single edge when OPTIONAL MATCH finds a match', async () => {
      const results = await executeQuery(graphData, 'MATCH (u:Person {name: "Alice"}) OPTIONAL MATCH (u)-[r]->(f:Person) RETURN u.name, r.type AS type');
      expect(results.length).toBe(1);
      expect(results[0]!.type).toBe('KNOWS');
    });
  });

  describe('CREATE chain returns single edge', () => {
    it('CREATE chain returns single edge', async () => {
      const results = await executeQuery(graphData, 'CREATE (a:Person)-[r:KNOWS]->(b:Person) RETURN r');
      expect(results.length).toBe(1);
      const r = results[0]!.r as CypherEdge;
      expect(Array.isArray(r)).toBe(false);
      expect(r.type).toBe('KNOWS');
    });

    it('r.type works after CREATE chain', async () => {
      const results = await executeQuery(graphData, 'CREATE (a:Person)-[r:KNOWS]->(b:Person) RETURN r.type AS type');
      expect(results).toEqual([{ type: 'KNOWS' }]);
    });
  });

  describe('MERGE chain returns single edge', () => {
    it('MERGE chain returns single edge', async () => {
      const results = await executeQuery(graphData, 'MERGE (a:Person {name: "Alice"})-[r:KNOWS]->(b:Person {name: "Bob"}) RETURN r');
      expect(results.length).toBe(1);
      const r = results[0]!.r as CypherEdge;
      expect(Array.isArray(r)).toBe(false);
      expect(r.type).toBe('KNOWS');
    });

    it('r.type works after MERGE chain', async () => {
      const results = await executeQuery(graphData, 'MERGE (a:Person {name: "Alice"})-[r:KNOWS]->(b:Person {name: "Bob"}) RETURN r.type AS type');
      expect(results).toEqual([{ type: 'KNOWS' }]);
    });
  });

  describe('type() alias in various contexts', () => {
    it('type(r) in WHERE clause', async () => {
      const results = await executeQuery(graphData, 'MATCH (a)-[r]->(b) WHERE type(r) = "KNOWS" RETURN a.name AS from, b.name AS to');
      expect(results).toEqual([{ from: 'Alice', to: 'Bob' }]);
    });

    it('type(r) in ORDER BY', async () => {
      const results = await executeQuery(graphData, 'MATCH (a)-[r]->(b) RETURN a.name, type(r) AS t ORDER BY t');
      expect(results[0]!.t).toBe('KNOWS');
      expect(results[1]!.t).toBe('LIKES');
    });

    it('type(r) in list literal', async () => {
      const results = await executeQuery(graphData, 'MATCH (a:Person {name: "Alice"})-[r]->(b) RETURN [type(r)] AS types');
      expect(results).toEqual([{ types: ['KNOWS'] }]);
    });

    it('TYPE(r) uppercase works too', async () => {
      const results = await executeQuery(graphData, 'MATCH (a)-[r]->(b) RETURN TYPE(r) AS t');
      expect(results[0]!.t).toBeDefined();
    });

    it('type() does not rewrite inside identifiers', async () => {
      // This should NOT rewrite "types" to "reltypes"
      const results = await executeQuery(graphData, 'MATCH (a)-[r]->(b) RETURN r.type AS types');
      expect(results[0]!.types).toBe('KNOWS');
    });

    it('type() does not rewrite inside strings', async () => {
      const results = await executeQuery(graphData, 'MATCH (a)-[r]->(b) RETURN "type(r)" AS literal');
      expect(results[0]!.literal).toBe('type(r)');
    });
  });

  describe('Integration: executeQuery API', () => {
    const graphData2 = {
      nodes: [
        { key: 'a', attributes: { label: 'Person', name: 'Alice' } },
        { key: 'b', attributes: { label: 'Person', name: 'Bob' } },
        { key: 'c', attributes: { label: 'Person', name: 'Charlie' } },
      ],
      edges: [
        { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
        { source: 'a', target: 'c', attributes: { type: 'LIKES' } },
        { source: 'b', target: 'c', attributes: { type: 'KNOWS' } },
      ],
    };

    it('r.type in RETURN via executeQuery', async () => {
      const results = await executeQuery(graphData2, 'MATCH (a)-[r]->(b) RETURN r.type AS t ORDER BY t');
      expect(results.length).toBe(3);
      const types = results.map((r) => r.t).sort();
      expect(types).toEqual(['KNOWS', 'KNOWS', 'LIKES']);
    });

    it('r.type in WITH with aggregation via executeQuery', async () => {
      const results = await executeQuery(graphData2, 'MATCH (a)-[r]->(b) WITH r.type AS t, count(*) AS c RETURN t, c ORDER BY t');
      expect(results).toEqual([
        { t: 'KNOWS', c: 2 },
        { t: 'LIKES', c: 1 },
      ]);
    });

    it('type(r) in WITH with aggregation via executeQuery', async () => {
      const results = await executeQuery(graphData2, 'MATCH (a)-[r]->(b) WITH type(r) AS t, count(*) AS c RETURN t, c ORDER BY t');
      expect(results).toEqual([
        { t: 'KNOWS', c: 2 },
        { t: 'LIKES', c: 1 },
      ]);
    });
  });
});
