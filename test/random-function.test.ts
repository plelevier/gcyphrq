import { describe, it, expect } from 'vitest';
import { createGraph, parseCypher, executeQuery } from '../src/lib';
import type { GraphInstance } from '../src/graph';

// ── Helper to create a simple graph for testing ─────────────────────────

function createTestGraph(): GraphInstance {
  const g = new (require('../src/graph').Graph)();
  g.addNode('a', { label: 'Node', name: 'Alice', score: 30 });
  g.addNode('b', { label: 'Node', name: 'Bob', score: 50 });
  g.addNode('c', { label: 'Node', name: 'Charlie', score: 70 });
  g.addNode('d', { label: 'Node', name: 'Diana', score: 20 });
  g.addNode('e', { label: 'Node', name: 'Eve', score: 90 });
  g.addEdge('a', 'b', { type: 'KNOWS' });
  g.addEdge('b', 'c', { type: 'KNOWS' });
  g.addEdge('c', 'd', { type: 'KNOWS' });
  g.addEdge('d', 'e', { type: 'KNOWS' });
  return g;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('RANDOM() function', () => {
  describe('Basic functionality', () => {
    it('returns a number between 0 and 1', async () => {
      const results = await executeQuery({ nodes: [], edges: [] }, 'RETURN random() AS value');
      expect(results).toHaveLength(1);
      const value = results[0]!.value as number;
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });

    it('returns different values on separate calls', async () => {
      const results = await executeQuery({ nodes: [], edges: [] }, 'RETURN random() AS v1, random() AS v2');
      expect(results).toHaveLength(1);
      const v1 = results[0]!.v1 as number;
      const v2 = results[0]!.v2 as number;
      expect(typeof v1).toBe('number');
      expect(typeof v2).toBe('number');
      // Extremely unlikely to be equal (probability ~0 for floating point)
      expect(v1).not.toBe(v2);
    });

    it('works in RETURN clause', async () => {
      const results = await executeQuery({ nodes: [], edges: [] }, 'RETURN random() AS r');
      expect(results).toHaveLength(1);
      expect(typeof results[0]!.r).toBe('number');
    });

    it('works in WITH clause', async () => {
      const graphData = {
        nodes: [{ key: 'a', attributes: { name: 'A' } }, { key: 'b', attributes: { name: 'B' } }],
        edges: [],
      };
      const results = await executeQuery(
        graphData,
        'MATCH (n) WITH n.name AS name, random() AS r RETURN name, r ORDER BY name',
      );
      expect(results).toHaveLength(2);
      for (const row of results) {
        expect(typeof row.r).toBe('number');
      }
    });
  });

  describe('ORDER BY random()', () => {
    it('shuffles results in random order', async () => {
      const graphData = {
        nodes: [
          { key: 'a', attributes: { name: 'Alice' } },
          { key: 'b', attributes: { name: 'Bob' } },
          { key: 'c', attributes: { name: 'Charlie' } },
          { key: 'd', attributes: { name: 'Diana' } },
          { key: 'e', attributes: { name: 'Eve' } },
        ],
        edges: [],
      };

      // Run multiple times and collect orderings
      const orderings: string[][] = [];
      for (let i = 0; i < 10; i++) {
        const results = await executeQuery(
          graphData,
          'MATCH (n) RETURN n.name AS name ORDER BY random()',
        );
        const names = results.map((r) => r.name as string);
        orderings.push(names);

        // Verify all names are present
        expect(names).toHaveLength(5);
        expect(new Set(names).size).toBe(5);
      }

      // With high probability, at least two orderings differ
      const allSame = orderings.every((o) => o.every((v, i) => v === orderings[0]![i]));
      expect(allSame).toBe(false);
    });

    it('produces consistent ordering within a single query', async () => {
      const graphData = {
        nodes: [
          { key: 'a', attributes: { name: 'A' } },
          { key: 'b', attributes: { name: 'B' } },
          { key: 'c', attributes: { name: 'C' } },
        ],
        edges: [],
      };
      const results = await executeQuery(
        graphData,
        'MATCH (n) RETURN n.name AS name ORDER BY random()',
      );
      // Results should be in some order (each row gets one random value)
      expect(results).toHaveLength(3);
      // All names present exactly once
      const names = results.map((r) => r.name as string);
      expect(new Set(names).size).toBe(3);
    });

    it('works with ORDER BY random() ASC', async () => {
      const graphData = {
        nodes: [
          { key: 'a', attributes: { name: 'Alice' } },
          { key: 'b', attributes: { name: 'Bob' } },
          { key: 'c', attributes: { name: 'Charlie' } },
        ],
        edges: [],
      };
      const results = await executeQuery(
        graphData,
        'MATCH (n) RETURN n.name AS name ORDER BY random() ASC',
      );
      expect(results).toHaveLength(3);
    });

    it('works with ORDER BY random() DESC', async () => {
      const graphData = {
        nodes: [
          { key: 'a', attributes: { name: 'Alice' } },
          { key: 'b', attributes: { name: 'Bob' } },
          { key: 'c', attributes: { name: 'Charlie' } },
        ],
        edges: [],
      };
      const results = await executeQuery(
        graphData,
        'MATCH (n) RETURN n.name AS name ORDER BY random() DESC',
      );
      expect(results).toHaveLength(3);
    });
  });

  describe('RANDOM() with LIMIT', () => {
    it('can sample random rows with LIMIT', async () => {
      const graphData = {
        nodes: [
          { key: 'a', attributes: { name: 'Alice' } },
          { key: 'b', attributes: { name: 'Bob' } },
          { key: 'c', attributes: { name: 'Charlie' } },
          { key: 'd', attributes: { name: 'Diana' } },
          { key: 'e', attributes: { name: 'Eve' } },
        ],
        edges: [],
      };

      // Collect sampled names across multiple runs
      const allSampled = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const results = await executeQuery(
          graphData,
          'MATCH (n) RETURN n.name AS name ORDER BY random() LIMIT 2',
        );
        expect(results).toHaveLength(2);
        for (const row of results) {
          allSampled.add(row.name as string);
        }
      }

      // With 20 runs of 2 samples from 5 items, we should have seen most/all items
      expect(allSampled.size).toBeGreaterThan(2);
    });
  });

  describe('RANDOM() combined with other ORDER BY', () => {
    it('works as secondary sort key', async () => {
      const graphData = {
        nodes: [
          { key: 'a', attributes: { name: 'Alice', score: 50 } },
          { key: 'b', attributes: { name: 'Bob', score: 50 } },
          { key: 'c', attributes: { name: 'Charlie', score: 30 } },
          { key: 'd', attributes: { name: 'Diana', score: 70 } },
        ],
        edges: [],
      };

      // Run multiple times - within same score group, order should vary
      const aliceBeforeBob = [];
      const bobBeforeAlice = [];
      for (let i = 0; i < 20; i++) {
        const results = await executeQuery(
          graphData,
          'MATCH (n) RETURN n.name AS name, n.score AS score ORDER BY n.score, random()',
        );
        expect(results).toHaveLength(4);

        // Charlie (30) should always be first
        expect(results[0]!.score).toBe(30);
        // Diana (70) should always be last
        expect(results[3]!.score).toBe(70);

        // Alice and Bob (both 50) should shuffle relative to each other
        const aliceIdx = results.findIndex((r) => r.name === 'Alice');
        const bobIdx = results.findIndex((r) => r.name === 'Bob');
        if (aliceIdx < bobIdx) aliceBeforeBob.push(true);
        else bobBeforeAlice.push(true);
      }

      // Both orderings should appear (random shuffle within same score)
      expect(aliceBeforeBob.length).toBeGreaterThan(0);
      expect(bobBeforeAlice.length).toBeGreaterThan(0);
    });
  });

  describe('RANDOM() in expressions', () => {
    it('can be used in arithmetic expressions', async () => {
      const results = await executeQuery({ nodes: [], edges: [] }, 'RETURN random() * 100 AS scaled');
      expect(results).toHaveLength(1);
      const scaled = results[0]!.scaled as number;
      expect(scaled).toBeGreaterThanOrEqual(0);
      expect(scaled).toBeLessThan(100);
    });

    it('can be used with toInteger', async () => {
      const results = await executeQuery({ nodes: [], edges: [] }, 'RETURN toInteger(random() * 10) AS digit');
      expect(results).toHaveLength(1);
      const digit = results[0]!.digit as number;
      expect(digit).toBeGreaterThanOrEqual(0);
      expect(digit).toBeLessThanOrEqual(9);
    });

    it('can be used with coalesce', async () => {
      const results = await executeQuery({ nodes: [], edges: [] }, 'RETURN coalesce(null, random()) AS value');
      expect(results).toHaveLength(1);
      const value = results[0]!.value as number;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });
  });

  describe('RANDOM() in WHERE clause', () => {
    it('can filter based on random threshold', async () => {
      const graphData = {
        nodes: Array.from({ length: 100 }, (_, i) => ({
          key: `n${i}`,
          attributes: { id: i },
        })),
        edges: [],
      };

      // ~50% of nodes should pass random() < 0.5 (statistically)
      const counts: number[] = [];
      for (let i = 0; i < 20; i++) {
        const results = await executeQuery(
          graphData,
          'MATCH (n) WHERE random() < 0.5 RETURN count(*) AS count',
        );
        counts.push(results[0]!.count as number);
      }

      // Average should be around 50 (with some variance)
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      expect(avg).toBeGreaterThan(35);
      expect(avg).toBeLessThan(65);
    });

    it('each row gets independent random value in WHERE', async () => {
      const graphData = {
        nodes: [
          { key: 'a', attributes: { name: 'A' } },
          { key: 'b', attributes: { name: 'B' } },
          { key: 'c', attributes: { name: 'C' } },
          { key: 'd', attributes: { name: 'D' } },
          { key: 'e', attributes: { name: 'E' } },
        ],
        edges: [],
      };

      // With random() < 1.0, all rows should pass (random() is always < 1)
      const results = await executeQuery(
        graphData,
        'MATCH (n) WHERE random() < 1.0 RETURN count(*) AS count',
      );
      expect(results[0]!.count).toBe(5);
    });
  });

  describe('Edge cases', () => {
    it('works with empty result set', async () => {
      const graphData = { nodes: [], edges: [] };
      const results = await executeQuery(
        graphData,
        'MATCH (n) RETURN n.name AS name ORDER BY random()',
      );
      expect(results).toHaveLength(0);
    });

    it('works with single row', async () => {
      const graphData = {
        nodes: [{ key: 'a', attributes: { name: 'Only' } }],
        edges: [],
      };
      const results = await executeQuery(
        graphData,
        'MATCH (n) RETURN n.name AS name ORDER BY random()',
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Only');
    });

    it('works with RETURN random() without MATCH', async () => {
      const results = await executeQuery({ nodes: [], edges: [] }, 'RETURN random() AS r');
      expect(results).toHaveLength(1);
      expect(typeof results[0]!.r).toBe('number');
    });

    it('multiple random() calls produce different values per row', async () => {
      const graphData = {
        nodes: [
          { key: 'a', attributes: { name: 'A' } },
          { key: 'b', attributes: { name: 'B' } },
        ],
        edges: [],
      };
      const results = await executeQuery(
        graphData,
        'MATCH (n) RETURN n.name AS name, random() AS r1, random() AS r2',
      );
      expect(results).toHaveLength(2);
      for (const row of results) {
        const r1 = row.r1 as number;
        const r2 = row.r2 as number;
        expect(r1).not.toBe(r2); // Each call within same row gets a new random
      }
    });

    it('RANDOM() in CASE expression', async () => {
      const results = await executeQuery(
        { nodes: [], edges: [] },
        'RETURN CASE WHEN random() > 0.5 THEN "high" ELSE "low" END AS category',
      );
      expect(results).toHaveLength(1);
      const category = results[0]!.category as string;
      expect(['high', 'low']).toContain(category);
    });

    it('RANDOM() in list comprehension', async () => {
      const results = await executeQuery({ nodes: [], edges: [] }, "RETURN [x IN [1, 2, 3, 4, 5] | random()] AS values");
      expect(results).toHaveLength(1);
      const values = results[0]!.values as number[];
      expect(values).toHaveLength(5);
      for (const v of values) {
        expect(typeof v).toBe('number');
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('Statistical properties', () => {
    it('distributes values roughly uniformly', async () => {
      // Collect many random values
      const values: number[] = [];
      for (let i = 0; i < 500; i++) {
        const r = await executeQuery({ nodes: [], edges: [] }, 'RETURN random() AS r');
        values.push(r[0]!.r as number);
      }

      // Split into 10 buckets and check each has roughly 10% of values
      const buckets = Array(10).fill(0);
      for (const v of values) {
        const idx = Math.min(Math.floor(v * 10), 9);
        buckets[idx]++;
      }

      const expected = values.length / 10;
      for (const count of buckets) {
        // Allow 40% variance (reasonable for 500 samples)
        expect(count).toBeGreaterThan(expected * 0.4);
        expect(count).toBeLessThan(expected * 1.6);
      }
    });
  });
});
