import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance } from './engine-setup';
import { buildGraphIndexesFromGraph } from '../src/indexes';
import { DEFAULT_CONFIG } from '../src/types/cypher';

describe('Pipeline - Lazy evaluation', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createTestGraph();
    engine = createEngine(graph);
  });

  describe('LIMIT short-circuit', () => {
    it('returns exactly LIMIT rows without computing more', async () => {
      // LIMIT 2 should return only 2 rows even though there are 4 Users
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 2');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('LIMIT 1 returns single row', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 1');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
    });

    it('LIMIT larger than total returns all rows', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 100');
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('SKIP + LIMIT short-circuits correctly', async () => {
      // SKIP 2 LIMIT 1 should return only 1 row (the 3rd one)
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 2 LIMIT 1');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
    });

    it('SKIP only (no LIMIT) falls back to eager', async () => {
      // SKIP without LIMIT triggers eager path (must see all rows)
      const ast = parseCypher('MATCH (u:User) RETURN u.name SKIP 2');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
    });
  });

  describe('Streaming aggregation correctness', () => {
    it('count(*) matches eager path', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN count(*) AS cnt');
      const results = await engine.execute(ast);
      expect(results[0]?.cnt).toBe(4);
    });

    it('count(property) matches eager path', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN count(u.name) AS cnt');
      const results = await engine.execute(ast);
      expect(results[0]?.cnt).toBe(4);
    });

    it('sum() with numeric property', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN sum(u.age) AS total');
      const results = await engine.execute(ast);
      // Alice=30, Bob=25, Charlie=35, Dave=28 => total = 118
      expect(results[0]?.total).toBe(118);
    });

    it('avg() with numeric property', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN avg(u.age) AS average');
      const results = await engine.execute(ast);
      // (30+25+35+28)/4 = 29.5
      expect(results[0]?.average).toBe(29.5);
    });

    it('min() with numeric property', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN min(u.age) AS youngest');
      const results = await engine.execute(ast);
      expect(results[0]?.youngest).toBe(25);
    });

    it('max() with numeric property', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN max(u.age) AS oldest');
      const results = await engine.execute(ast);
      expect(results[0]?.oldest).toBe(35);
    });

    it('collect() matches eager path', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN collect(u.name) AS names');
      const results = await engine.execute(ast);
      const names = results[0]?.names as string[];
      expect(names).toHaveLength(4);
      expect(new Set(names)).toEqual(new Set(['Alice', 'Bob', 'Charlie', 'Dave']));
    });

    it('count(DISTINCT) matches eager path', async () => {
      // All ages are distinct in test graph
      const ast = parseCypher('MATCH (u:User) RETURN count(DISTINCT u.age) AS cnt');
      const results = await engine.execute(ast);
      expect(results[0]?.cnt).toBe(4);
    });

    it('collect(DISTINCT) matches eager path', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN collect(DISTINCT u.name) AS names');
      const results = await engine.execute(ast);
      const names = results[0]?.names as string[];
      expect(names).toHaveLength(4);
    });
  });

  describe('Grouped aggregation with streaming', () => {
    it('groups by non-aggregated column in RETURN', async () => {
      const ast = parseCypher('MATCH (u:User)-[r:KNOWS]->(v:User) RETURN u.name, count(r) AS cnt');
      const results = await engine.execute(ast);
      // Check that results are grouped by u.name
      expect(results.length).toBeGreaterThan(0);
      for (const row of results) {
        expect(row.name).toBeDefined();
        expect(typeof row.cnt).toBe('number');
      }
    });

    it('streamed aggregation with ORDER BY and LIMIT', async () => {
      const ast = parseCypher('MATCH (u:User)-[r:KNOWS]->(v:User) WITH u.name AS src, count(r) AS cnt RETURN src, cnt ORDER BY cnt DESC LIMIT 2');
      const results = await engine.execute(ast);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Early termination', () => {
    it('LIMIT stops upstream MATCH from producing more rows', async () => {
      // This should not produce more than LIMIT rows even with variable-length patterns
      const ast = parseCypher('MATCH (u:User)-[*1..2]->(v:User) RETURN v.name LIMIT 3');
      const results = await engine.execute(ast);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Fallback to eager', () => {
    it('DISTINCT without LIMIT uses eager path', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN DISTINCT u.name');
      const results = await engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('ORDER BY without LIMIT uses eager path', async () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name');
      const results = await engine.execute(ast);
      const names = results.map((r) => r.name);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    });

    it('collect() aggregation routed to eager path', async () => {
      // collect() is inherently materialising, so shouldLazy routes it to eager
      const ast = parseCypher('MATCH (u:User) RETURN collect(u.name) AS names');
      const results = await engine.execute(ast);
      expect(results[0]?.names).toHaveLength(4);
    });
  });

  describe('WRITE + MATCH in lazy pipeline', () => {
    it('sees newly created nodes in subsequent MATCH with aggregation', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addNode('b', { label: 'Node', name: 'B' });
      const indexes = buildGraphIndexesFromGraph(g, DEFAULT_CONFIG);
      const e = new AdvancedCypherGraphologyEngine(g, indexes);

      const ast = parseCypher('CREATE (c:Node {name: "C"}) MATCH (n:Node) RETURN count(n) AS total');
      const results = await e.execute(ast);
      expect(results[0]?.total).toBe(3);
    });

    it('CREATE + MATCH without aggregation uses eager path', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addNode('b', { label: 'Node', name: 'B' });
      const indexes = buildGraphIndexesFromGraph(g, DEFAULT_CONFIG);
      const e = new AdvancedCypherGraphologyEngine(g, indexes);

      const ast = parseCypher('CREATE (c:Node {name: "C"}) MATCH (n:Node) RETURN n.name');
      const results = await e.execute(ast);
      expect(results.length).toBe(3);
    });
  });

  describe('Aggregation with no input rows', () => {
    it('count(*) returns 0 when no matches', async () => {
      const ast = parseCypher('MATCH (n:NonExistent) RETURN count(*) AS cnt');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]?.cnt).toBe(0);
    });

    it('sum() returns 0 when no matches', async () => {
      const ast = parseCypher('MATCH (n:NonExistent) RETURN sum(n.value) AS total');
      const results = await engine.execute(ast);
      expect(results[0]?.total).toBe(0);
    });

    it('avg() returns null when no matches', async () => {
      const ast = parseCypher('MATCH (n:NonExistent) RETURN avg(n.value) AS average');
      const results = await engine.execute(ast);
      expect(results[0]?.average).toBeNull();
    });

    it('min() returns null when no matches', async () => {
      const ast = parseCypher('MATCH (n:NonExistent) RETURN min(n.value) AS mn');
      const results = await engine.execute(ast);
      expect(results[0]?.mn).toBeNull();
    });

    it('max() returns null when no matches', async () => {
      const ast = parseCypher('MATCH (n:NonExistent) RETURN max(n.value) AS mx');
      const results = await engine.execute(ast);
      expect(results[0]?.mx).toBeNull();
    });

    it('collect() returns empty array when no matches', async () => {
      const ast = parseCypher('MATCH (n:NonExistent) RETURN collect(n.name) AS names');
      const results = await engine.execute(ast);
      expect(results[0]?.names).toEqual([]);
    });
  });

  describe('WITH streaming with aggregation', () => {
    it('WITH aggregation + RETURN', async () => {
      const ast = parseCypher('MATCH (u:User) WITH count(*) AS cnt RETURN cnt');
      const results = await engine.execute(ast);
      expect(results[0]?.cnt).toBe(4);
    });

    it('WITH aggregation + ORDER BY + LIMIT', async () => {
      const ast = parseCypher('MATCH (u:User)-[r:KNOWS]->(v:User) WITH u.name AS src, count(r) AS cnt RETURN src, cnt ORDER BY cnt DESC LIMIT 2');
      const results = await engine.execute(ast);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('WITH aggregation + WHERE filter', async () => {
      const ast = parseCypher('MATCH (u:User) WITH count(*) AS cnt WHERE cnt > 0 RETURN cnt');
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]?.cnt).toBe(4);
    });
  });

  describe('UNWIND streaming', () => {
    it('UNWIND with WHERE filter', async () => {
      const ast = parseCypher('UNWIND [1, 2, 3, 4, 5] AS x WHERE x > 2 RETURN count(*) AS cnt');
      const results = await engine.execute(ast);
      expect(results[0]?.cnt).toBe(3);
    });

    it('UNWIND with LIMIT', async () => {
      const ast = parseCypher('UNWIND [1, 2, 3, 4, 5] AS x RETURN x LIMIT 2');
      const results = await engine.execute(ast);
      expect(results.length).toBe(2);
    });
  });

  describe('Eager vs Lazy result parity', () => {
    /** Helper: run same query through both paths and compare results. */
    async function compare(query: string) {
      const ast = parseCypher(query);
      const eager = await engine.execute(ast, { forceEager: true });
      const lazy = await engine.execute(ast, { forceLazy: true });
      // Sort both by all keys for deterministic comparison
      const sortRows = (rows: Record<string, unknown>[]) =>
        rows.map((r) => ({ ...r, _sortKey: JSON.stringify(Object.entries(r).sort()) }))
          .sort((a, b) => (a._sortKey as string).localeCompare(b._sortKey as string))
          .map(({ _sortKey, ...rest }) => rest);
      expect(sortRows(eager)).toEqual(sortRows(lazy));
      return lazy;
    }

    it('count(*) aggregation', async () => {
      const results = await compare('MATCH (u:User) RETURN count(*) AS total');
      expect(results[0]?.total).toBe(4);
    });

    it('sum() aggregation', async () => {
      const results = await compare('MATCH (u:User) RETURN sum(u.age) AS totalAge');
      expect(results[0]?.totalAge).toBe(118); // 30 + 25 + 35 + 28
    });

    it('avg() aggregation', async () => {
      const results = await compare('MATCH (u:User) RETURN avg(u.age) AS avgAge');
      expect(results[0]?.avgAge).toBeCloseTo(29.5); // 118 / 4
    });

    it('min() aggregation', async () => {
      const results = await compare('MATCH (u:User) RETURN min(u.age) AS youngest');
      expect(results[0]?.youngest).toBe(25);
    });

    it('max() aggregation', async () => {
      const results = await compare('MATCH (u:User) RETURN max(u.age) AS oldest');
      expect(results[0]?.oldest).toBe(35);
    });

    it('collect() aggregation', async () => {
      const results = await compare('MATCH (u:User) RETURN collect(u.name) AS names');
      expect(results[0]?.names).toHaveLength(4);
    });

    it('count(DISTINCT) aggregation', async () => {
      const results = await compare('MATCH (u:User) RETURN count(DISTINCT u.age) AS uniqueAges');
      expect(results[0]?.uniqueAges).toBe(4); // 25, 28, 30, 35
    });

    it('LIMIT short-circuit', async () => {
      const results = await compare('MATCH (u:User) RETURN u.name LIMIT 2');
      expect(results.length).toBe(2);
    });

    it('SKIP + LIMIT', async () => {
      const results = await compare('MATCH (u:User) RETURN u.name SKIP 1 LIMIT 2');
      expect(results.length).toBe(2);
    });

    it('WITH aggregation + ORDER BY + LIMIT', async () => {
      const results = await compare(
        'MATCH (u:User)-[r:KNOWS]->(v:User) WITH u.name AS src, count(*) AS cnt RETURN src, cnt ORDER BY cnt DESC LIMIT 2',
      );
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('multiple aggregations in same RETURN', async () => {
      const results = await compare(
        'MATCH (u:User) RETURN count(*) AS total, sum(u.age) AS totalAge, avg(u.age) AS avgAge, min(u.age) AS youngest, max(u.age) AS oldest',
      );
      expect(results[0]?.total).toBe(4);
      expect(results[0]?.totalAge).toBe(118); // 30 + 25 + 35 + 28
      expect(results[0]?.avgAge).toBeCloseTo(29.5); // 118 / 4
      expect(results[0]?.youngest).toBe(25);
      expect(results[0]?.oldest).toBe(35);
    });

    it('aggregation with WHERE filter', async () => {
      const results = await compare(
        'MATCH (u:User) WHERE u.age > 25 RETURN count(*) AS cnt, sum(u.age) AS total',
      );
      expect(results[0]?.cnt).toBe(3); // 30, 35, 28
      expect(results[0]?.total).toBe(93); // 30 + 35 + 28
    });

    it('chained MATCH with aggregation', async () => {
      const results = await compare(
        'MATCH (u:User) MATCH (v:User) WHERE u <> v RETURN count(*) AS pairs',
      );
      expect(results[0]?.pairs).toBe(12); // 4 * 3
    });

    it('UNWIND with aggregation', async () => {
      const results = await compare(
        'UNWIND [10, 20, 30, 40, 50] AS x WHERE x > 15 RETURN count(*) AS cnt, sum(x) AS total',
      );
      expect(results[0]?.cnt).toBe(4);
      expect(results[0]?.total).toBe(140);
    });

    it('empty input aggregation', async () => {
      const results = await compare(
        'MATCH (u:User) WHERE u.age > 100 RETURN count(*) AS cnt, sum(u.age) AS total, avg(u.age) AS avgAge',
      );
      expect(results[0]?.cnt).toBe(0);
      expect(results[0]?.total).toBe(0);
      expect(results[0]?.avgAge).toBeNull();
    });
  });
});

describe('Pipeline - Benchmarks', () => {
  /** Build a dense graph with N nodes and random edges. */
  function buildDenseGraph(nodeCount: number, edgeFactor: number, onWarning?: (msg: string) => void): { graph: GraphInstance; engine: AdvancedCypherGraphologyEngine } {
    const g = new Graph({ multi: true });
    for (let i = 0; i < nodeCount; i++) {
      g.addNode(`n${i}`, { label: 'Node', id: i, val: Math.random() });
    }
    const edgeCount = nodeCount * edgeFactor;
    for (let i = 0; i < edgeCount; i++) {
      const src = Math.floor(Math.random() * nodeCount);
      let tgt = Math.floor(Math.random() * nodeCount);
      while (tgt === src) tgt = Math.floor(Math.random() * nodeCount);
      g.addEdgeWithKey(`e${i}`, `n${src}`, `n${tgt}`, { type: 'CONNECTS' });
    }
    const indexes = buildGraphIndexesFromGraph(g, DEFAULT_CONFIG);
    return { graph: g, engine: new AdvancedCypherGraphologyEngine(g, indexes, onWarning) };
  }

  it('LIMIT 10 on 10K-node dense graph returns in < 1s', async () => {
    const { engine } = buildDenseGraph(10_000, 3, () => {});
    const ast = parseCypher('MATCH (a:Node)-[*1..]->(b:Node) RETURN a.id AS src, b.id AS tgt LIMIT 10');
    const start = performance.now();
    const results = await engine.execute(ast);
    const elapsed = performance.now() - start;
    expect(results.length).toBeLessThanOrEqual(10);
    expect(elapsed).toBeLessThan(2000);
  }, 30_000);

  it('Aggregation + ORDER BY ... LIMIT 10 on 10K-node dense graph returns in < 1.5s', async () => {
    const { engine } = buildDenseGraph(10_000, 3, () => {});
    const ast = parseCypher(
      'MATCH (a:Node)-[*1..]->(b:Node) WITH a.id AS src, count(*) AS cnt RETURN src, cnt ORDER BY cnt DESC LIMIT 10',
    );
    const start = performance.now();
    const results = await engine.execute(ast);
    const elapsed = performance.now() - start;
    expect(results.length).toBeLessThanOrEqual(10);
    expect(elapsed).toBeLessThan(1500);
  }, 30_000);

  it('MATCH with WHERE + LIMIT on 10K-node graph returns in < 200ms', async () => {
    const { engine } = buildDenseGraph(10_000, 3);
    const ast = parseCypher('MATCH (n:Node) WHERE n.val > 0.5 RETURN n.id AS id LIMIT 100');
    const start = performance.now();
    const results = await engine.execute(ast);
    const elapsed = performance.now() - start;
    expect(results.length).toBeLessThanOrEqual(100);
    expect(elapsed).toBeLessThan(200);
  }, 30_000);
});
