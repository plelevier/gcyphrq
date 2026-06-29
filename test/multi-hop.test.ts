import { describe, it, expect } from 'vitest';
import { executeQuery } from '../src/lib';
import type { CypherEdge } from '../src/types/cypher';

const socialGraph = {
  nodes: [
    { key: 'alice', attributes: { label: 'Person', name: 'Alice' } },
    { key: 'bob', attributes: { label: 'Person', name: 'Bob' } },
    { key: 'charlie', attributes: { label: 'Person', name: 'Charlie' } },
    { key: 'diana', attributes: { label: 'Person', name: 'Diana' } },
  ],
  edges: [
    { source: 'alice', target: 'bob', attributes: { type: 'KNOWS' } },
    { source: 'bob', target: 'charlie', attributes: { type: 'LIKES' } },
    { source: 'charlie', target: 'diana', attributes: { type: 'FOLLOWS' } },
  ],
};

describe('Multi-hop patterns', () => {
  describe('Basic 2-hop', () => {
    it('MATCH (a)-[r1]->(b)-[r2]->(c) returns correct results', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1]->(b:Person)-[r2]->(c:Person) RETURN a.name, b.name, c.name');
      expect(results.length).toBe(2);
      expect(results[0]).toEqual({ 'a.name': 'Alice', 'b.name': 'Bob', 'c.name': 'Charlie' });
      expect(results[1]).toEqual({ 'a.name': 'Bob', 'b.name': 'Charlie', 'c.name': 'Diana' });
    });

    it('relationship variables are bound correctly', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1]->(b:Person)-[r2]->(c:Person) RETURN a.name AS start, r1.type AS t1, r2.type AS t2');
      expect(results).toEqual([
        { start: 'Alice', t1: 'KNOWS', t2: 'LIKES' },
        { start: 'Bob', t1: 'LIKES', t2: 'FOLLOWS' },
      ]);
    });

    it('type(r) works on multi-hop relationships', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1]->(b:Person)-[r2]->(c:Person) RETURN type(r1) AS t1, type(r2) AS t2');
      expect(results).toEqual([
        { t1: 'KNOWS', t2: 'LIKES' },
        { t1: 'LIKES', t2: 'FOLLOWS' },
      ]);
    });
  });

  describe('3-hop patterns', () => {
    it('MATCH (a)-[]->(b)-[]->(c)-[]->(d) works', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[]->(b:Person)-[]->(c:Person)-[]->(d:Person) RETURN a.name, b.name, c.name, d.name');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual({ 'a.name': 'Alice', 'b.name': 'Bob', 'c.name': 'Charlie', 'd.name': 'Diana' });
    });

    it('all three relationship variables are bound', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1]->(b:Person)-[r2]->(c:Person)-[r3]->(d:Person) RETURN r1.type AS t1, r2.type AS t2, r3.type AS t3');
      expect(results).toEqual([{ t1: 'KNOWS', t2: 'LIKES', t3: 'FOLLOWS' }]);
    });
  });

  describe('Type filters on each hop', () => {
    it('filter by relationship type on first hop', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1:KNOWS]->(b:Person)-[r2]->(c:Person) RETURN a.name, b.name, c.name');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual({ 'a.name': 'Alice', 'b.name': 'Bob', 'c.name': 'Charlie' });
    });

    it('filter by relationship type on second hop', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1]->(b:Person)-[r2:FOLLOWS]->(c:Person) RETURN a.name, b.name, c.name');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual({ 'a.name': 'Bob', 'b.name': 'Charlie', 'c.name': 'Diana' });
    });

    it('filter by type on both hops', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1:KNOWS]->(b:Person)-[r2:LIKES]->(c:Person) RETURN a.name, c.name');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual({ 'a.name': 'Alice', 'c.name': 'Charlie' });
    });
  });

  describe('Label filters on intermediate nodes', () => {
    it('filter by label on intermediate node', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1]->(b:Person)-[r2]->(c:Person) RETURN a.name, b.name, c.name');
      expect(results.length).toBe(2);
    });
  });

  describe('Mixed directions', () => {
    it('MATCH (a)-[r1]-(b)-[r2]->(c) works (undirected first hop)', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1]-(b:Person)-[r2]->(c:Person) RETURN a.name AS a, b.name AS b, c.name AS c ORDER BY a, c');
      // alice-bob-charlie, bob-alice (no out), bob-charlie-diana, charlie-bob (no out), charlie-diana (no out)
      expect(results.length).toBe(5);
    });
  });

  describe('WHERE clause with multi-hop', () => {
    it('filter by intermediate node property', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1]->(b:Person)-[r2]->(c:Person) WHERE b.name = "Bob" RETURN a.name, c.name');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual({ 'a.name': 'Alice', 'c.name': 'Charlie' });
    });

    it('filter by end node property', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1]->(b:Person)-[r2]->(c:Person) WHERE c.name = "Diana" RETURN a.name, b.name');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual({ 'a.name': 'Bob', 'b.name': 'Charlie' });
    });
  });

  describe('Aggregation with multi-hop', () => {
    it('count multi-hop paths', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1]->(b:Person)-[r2]->(c:Person) RETURN count(*) AS cnt');
      expect(results).toEqual([{ cnt: 2 }]);
    });

    it('group by start node', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r1]->(b:Person)-[r2]->(c:Person) WITH a.name AS start, count(*) AS cnt RETURN start, cnt ORDER BY start');
      expect(results).toEqual([
        { start: 'Alice', cnt: 1 },
        { start: 'Bob', cnt: 1 },
      ]);
    });
  });

  describe('OPTIONAL MATCH with multi-hop', () => {
    it('returns null when no 2-hop path exists', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person {name: "Diana"}) OPTIONAL MATCH (a)-[r1]->(b:Person)-[r2]->(c:Person) RETURN a.name, c.name AS endName');
      expect(results.length).toBe(1);
      expect(results[0]!.endName).toBeNull();
    });

    it('returns results when 2-hop path exists', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person {name: "Alice"}) OPTIONAL MATCH (a)-[r1]->(b:Person)-[r2]->(c:Person) RETURN a.name, c.name AS endName');
      expect(results.length).toBe(1);
      expect(results[0]!.endName).toBe('Charlie');
    });
  });

  describe('Unbound intermediate nodes', () => {
    it('MATCH (a)-[]->()-[]->(c) chains through unbound node', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[]->()-[]->(c:Person) RETURN a.name, c.name');
      expect(results.length).toBe(2);
      expect(results[0]).toEqual({ 'a.name': 'Alice', 'c.name': 'Charlie' });
      expect(results[1]).toEqual({ 'a.name': 'Bob', 'c.name': 'Diana' });
    });

    it('MATCH (a)-[]->()-[]->()-[]->(d) chains through two unbound nodes', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[]->()-[]->()-[]->(d:Person) RETURN a.name, d.name');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual({ 'a.name': 'Alice', 'd.name': 'Diana' });
    });

    it('mixed bound and unbound intermediates', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[]->(b:Person)-[]->()-[]->(d:Person) RETURN a.name, b.name, d.name');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual({ 'a.name': 'Alice', 'b.name': 'Bob', 'd.name': 'Diana' });
    });
  });

  describe('Single-hop still works (regression)', () => {
    it('MATCH (a)-[r]->(b) returns single edge', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person)-[r]->(b:Person) RETURN r.type AS t');
      expect(results.length).toBe(3);
      expect(Array.isArray(results[0]!.r)).toBe(false);
    });

    it('MATCH (a) returns single node', async () => {
      const results = await executeQuery(socialGraph, 'MATCH (a:Person) RETURN a.name ORDER BY a.name');
      expect(results.length).toBe(4);
    });
  });
});
