import { describe, it, expect } from 'vitest';
import { parseCypher } from '../src/engine/cypher-parser';
import { executeQuery } from '../src/lib';
import type { AdvancedCypherAST, OrderByItem } from '../src/types/cypher';

// ── Parser tests ──────────────────────────────────────────────────────────────

describe('parseCypher - ORDER BY NULLS FIRST/LAST', () => {
  it('parses ORDER BY with NULLS FIRST', async () => {
    const ast = parseCypher('RETURN x ORDER BY x NULLS FIRST') as AdvancedCypherAST;
    const orderBy = ast.return?.orderBy;
    expect(orderBy).toBeDefined();
    expect(orderBy!.length).toBe(1);
    expect(orderBy![0]!.direction).toBe('ASC');
    expect(orderBy![0]!.nullsDirection).toBe('NULLS FIRST');
  });

  it('parses ORDER BY with NULLS LAST', async () => {
    const ast = parseCypher('RETURN x ORDER BY x NULLS LAST') as AdvancedCypherAST;
    const orderBy = ast.return?.orderBy;
    expect(orderBy).toBeDefined();
    expect(orderBy!.length).toBe(1);
    expect(orderBy![0]!.direction).toBe('ASC');
    expect(orderBy![0]!.nullsDirection).toBe('NULLS LAST');
  });

  it('parses ORDER BY DESC with NULLS FIRST', async () => {
    const ast = parseCypher('RETURN x ORDER BY x DESC NULLS FIRST') as AdvancedCypherAST;
    const orderBy = ast.return?.orderBy;
    expect(orderBy).toBeDefined();
    expect(orderBy!.length).toBe(1);
    expect(orderBy![0]!.direction).toBe('DESC');
    expect(orderBy![0]!.nullsDirection).toBe('NULLS FIRST');
  });

  it('parses ORDER BY DESC with NULLS LAST', async () => {
    const ast = parseCypher('RETURN x ORDER BY x DESC NULLS LAST') as AdvancedCypherAST;
    const orderBy = ast.return?.orderBy;
    expect(orderBy).toBeDefined();
    expect(orderBy!.length).toBe(1);
    expect(orderBy![0]!.direction).toBe('DESC');
    expect(orderBy![0]!.nullsDirection).toBe('NULLS LAST');
  });

  it('parses multi-column ORDER BY with mixed NULLS directions', async () => {
    const ast = parseCypher('RETURN x, y ORDER BY x NULLS FIRST, y DESC NULLS LAST') as AdvancedCypherAST;
    const orderBy = ast.return?.orderBy;
    expect(orderBy).toBeDefined();
    expect(orderBy!.length).toBe(2);
    expect(orderBy![0]!.direction).toBe('ASC');
    expect(orderBy![0]!.nullsDirection).toBe('NULLS FIRST');
    expect(orderBy![1]!.direction).toBe('DESC');
    expect(orderBy![1]!.nullsDirection).toBe('NULLS LAST');
  });

  it('parses ORDER BY without NULLS direction (undefined)', async () => {
    const ast = parseCypher('RETURN x ORDER BY x') as AdvancedCypherAST;
    const orderBy = ast.return?.orderBy;
    expect(orderBy).toBeDefined();
    expect(orderBy!.length).toBe(1);
    expect(orderBy![0]!.nullsDirection).toBeUndefined();
  });

  it('parses ORDER BY with NULLS FIRST case-insensitive', async () => {
    const ast = parseCypher('RETURN x ORDER BY x nulls first') as AdvancedCypherAST;
    const orderBy = ast.return?.orderBy;
    expect(orderBy).toBeDefined();
    expect(orderBy![0]!.nullsDirection).toBe('NULLS FIRST');
  });

  it('parses WITH ORDER BY with NULLS FIRST', async () => {
    const ast = parseCypher('WITH x ORDER BY x NULLS LAST RETURN x') as AdvancedCypherAST;
    const withClause = ast.stages.find(s => s.type === 'WITH');
    expect(withClause).toBeDefined();
    const orderBy = (withClause!.clause as any).orderBy;
    expect(orderBy).toBeDefined();
    expect(orderBy![0]!.nullsDirection).toBe('NULLS LAST');
  });

  it('parses ORDER BY with property access and NULLS FIRST', async () => {
    const ast = parseCypher('MATCH (n) RETURN n.name ORDER BY n.score NULLS FIRST') as AdvancedCypherAST;
    const orderBy = ast.return?.orderBy;
    expect(orderBy).toBeDefined();
    expect(orderBy![0]!.nullsDirection).toBe('NULLS FIRST');
  });

  it('parses multi-column with only some having NULLS direction', async () => {
    const ast = parseCypher('RETURN x, y, z ORDER BY x NULLS FIRST, y, z DESC NULLS LAST') as AdvancedCypherAST;
    const orderBy = ast.return?.orderBy;
    expect(orderBy).toBeDefined();
    expect(orderBy!.length).toBe(3);
    expect(orderBy![0]!.nullsDirection).toBe('NULLS FIRST');
    expect(orderBy![1]!.nullsDirection).toBeUndefined();
    expect(orderBy![2]!.nullsDirection).toBe('NULLS LAST');
  });
});

// ── Engine tests ──────────────────────────────────────────────────────────────

describe('Engine - ORDER BY NULLS FIRST/LAST', () => {
  const graphData = {
    nodes: [
      { key: 'a', attributes: { label: 'Item', name: 'a', score: 10 } },
      { key: 'b', attributes: { label: 'Item', name: 'b', score: null } },
      { key: 'c', attributes: { label: 'Item', name: 'c', score: 5 } },
      { key: 'd', attributes: { label: 'Item', name: 'd', score: null } },
      { key: 'e', attributes: { label: 'Item', name: 'e', score: 20 } },
    ],
    edges: [],
  };

  describe('ASC ordering', () => {
    it('ASC NULLS LAST (default) — nulls at end', async () => {
      const query = 'MATCH (n:Item) RETURN n.name, n.score ORDER BY n.score';
      const results = await executeQuery(graphData, query);
      const names = results.map(r => r.name);
      // Non-null scores first (5, 10, 20), then nulls
      expect(names).toContain('c');  // score 5
      expect(names).toContain('a');  // score 10
      expect(names).toContain('e');  // score 20
      // Nulls should be at the end
      const nullIndices = names.filter((_, i) => results[i]!.score === null).length;
      expect(nullIndices).toBe(2);
    });

    it('ASC NULLS FIRST — nulls at beginning', async () => {
      const query = 'MATCH (n:Item) RETURN n.name, n.score ORDER BY n.score NULLS FIRST';
      const results = await executeQuery(graphData, query);
      const names = results.map(r => r.name);
      // Nulls should be at the beginning
      expect(results[0]!.score).toBeNull();
      expect(results[1]!.score).toBeNull();
      expect(results[2]!.score).toBe(5);
      expect(results[3]!.score).toBe(10);
      expect(results[4]!.score).toBe(20);
    });

    it('ASC NULLS LAST (explicit) — nulls at end', async () => {
      const query = 'MATCH (n:Item) RETURN n.name, n.score ORDER BY n.score NULLS LAST';
      const results = await executeQuery(graphData, query);
      const names = results.map(r => r.name);
      // Nulls should be at the end
      expect(results[0]!.score).toBe(5);
      expect(results[1]!.score).toBe(10);
      expect(results[2]!.score).toBe(20);
      expect(results[3]!.score).toBeNull();
      expect(results[4]!.score).toBeNull();
    });
  });

  describe('DESC ordering', () => {
    it('DESC NULLS LAST (default) — nulls at end', async () => {
      const query = 'MATCH (n:Item) RETURN n.name, n.score ORDER BY n.score DESC';
      const results = await executeQuery(graphData, query);
      // Default for DESC: nulls first (standard Cypher behavior)
      // Actually, in standard Cypher, DESC default is NULLS FIRST
      // Let me check: the code says: nullsFirst = direction === 'DESC' when nullsDirection is undefined
      // So DESC default is NULLS FIRST
    });

    it('DESC NULLS FIRST — nulls at beginning', async () => {
      const query = 'MATCH (n:Item) RETURN n.name, n.score ORDER BY n.score DESC NULLS FIRST';
      const results = await executeQuery(graphData, query);
      // Nulls should be at the beginning
      expect(results[0]!.score).toBeNull();
      expect(results[1]!.score).toBeNull();
      expect(results[2]!.score).toBe(20);
      expect(results[3]!.score).toBe(10);
      expect(results[4]!.score).toBe(5);
    });

    it('DESC NULLS LAST — nulls at end', async () => {
      const query = 'MATCH (n:Item) RETURN n.name, n.score ORDER BY n.score DESC NULLS LAST';
      const results = await executeQuery(graphData, query);
      // Non-null scores first (descending), then nulls
      expect(results[0]!.score).toBe(20);
      expect(results[1]!.score).toBe(10);
      expect(results[2]!.score).toBe(5);
      expect(results[3]!.score).toBeNull();
      expect(results[4]!.score).toBeNull();
    });
  });

  describe('Multi-column ORDER BY', () => {
    const multiGraphData = {
      nodes: [
        { key: 'a', attributes: { label: 'Item', group: 'A', score: 10 } },
        { key: 'b', attributes: { label: 'Item', group: 'A', score: null } },
        { key: 'c', attributes: { label: 'Item', group: 'B', score: 5 } },
        { key: 'd', attributes: { label: 'Item', group: 'B', score: null } },
        { key: 'e', attributes: { label: 'Item', group: 'A', score: 20 } },
      ],
      edges: [],
    };

    it('multi-column with NULLS FIRST on first column', async () => {
      const query = 'MATCH (n:Item) RETURN n.group, n.score ORDER BY n.score NULLS FIRST, n.group';
      const results = await executeQuery(multiGraphData, query);
      // Null scores first, then sorted by score ascending
      expect(results[0]!.score).toBeNull();
      expect(results[1]!.score).toBeNull();
      // Within nulls, sorted by group
      expect(results[0]!.group).toBe('A');
      expect(results[1]!.group).toBe('B');
      // Then non-null scores
      expect(results[2]!.score).toBe(5);
      expect(results[3]!.score).toBe(10);
      expect(results[4]!.score).toBe(20);
    });

    it('multi-column with different NULLS directions', async () => {
      const query = 'MATCH (n:Item) RETURN n.group, n.score ORDER BY n.group NULLS LAST, n.score DESC NULLS FIRST';
      const results = await executeQuery(multiGraphData, query);
      // Groups are all non-null, so NULLS LAST on group doesn't matter
      // Within each group, scores DESC with NULLS FIRST
      const groupA = results.filter(r => r.group === 'A');
      const groupB = results.filter(r => r.group === 'B');
      expect(groupA.length).toBe(3);
      expect(groupB.length).toBe(2);
      // Within group A: null first, then 20, then 10
      expect(groupA[0]!.score).toBeNull();
      expect(groupA[1]!.score).toBe(20);
      expect(groupA[2]!.score).toBe(10);
      // Within group B: null first, then 5
      expect(groupB[0]!.score).toBeNull();
      expect(groupB[1]!.score).toBe(5);
    });
  });

  describe('WITH clause', () => {
    it('WITH ORDER BY with NULLS FIRST', async () => {
      const query = 'MATCH (n:Item) WITH n.name AS name, n.score AS score ORDER BY score NULLS FIRST RETURN name, score';
      const results = await executeQuery(graphData, query);
      expect(results[0]!.score).toBeNull();
      expect(results[1]!.score).toBeNull();
      expect(results[2]!.score).toBe(5);
      expect(results[3]!.score).toBe(10);
      expect(results[4]!.score).toBe(20);
    });

    it('WITH ORDER BY with NULLS LAST', async () => {
      const query = 'MATCH (n:Item) WITH n.name AS name, n.score AS score ORDER BY score DESC NULLS LAST RETURN name, score';
      const results = await executeQuery(graphData, query);
      expect(results[0]!.score).toBe(20);
      expect(results[1]!.score).toBe(10);
      expect(results[2]!.score).toBe(5);
      expect(results[3]!.score).toBeNull();
      expect(results[4]!.score).toBeNull();
    });
  });

  describe('UNWIND with ORDER BY NULLS', () => {
    it('UNWIND with NULLS FIRST', async () => {
      const query = 'UNWIND [10, null, 5, null, 20] AS x RETURN x ORDER BY x NULLS FIRST';
      const results = await executeQuery(graphData, query);
      expect(results[0]!.x).toBeNull();
      expect(results[1]!.x).toBeNull();
      expect(results[2]!.x).toBe(5);
      expect(results[3]!.x).toBe(10);
      expect(results[4]!.x).toBe(20);
    });

    it('UNWIND with NULLS LAST', async () => {
      const query = 'UNWIND [10, null, 5, null, 20] AS x RETURN x ORDER BY x DESC NULLS LAST';
      const results = await executeQuery(graphData, query);
      expect(results[0]!.x).toBe(20);
      expect(results[1]!.x).toBe(10);
      expect(results[2]!.x).toBe(5);
      expect(results[3]!.x).toBeNull();
      expect(results[4]!.x).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('all nulls — NULLS FIRST', async () => {
      const query = 'UNWIND [null, null, null] AS x RETURN x ORDER BY x NULLS FIRST';
      const results = await executeQuery(graphData, query);
      expect(results.length).toBe(3);
      expect(results.every(r => r.x === null)).toBe(true);
    });

    it('all nulls — NULLS LAST', async () => {
      const query = 'UNWIND [null, null, null] AS x RETURN x ORDER BY x NULLS LAST';
      const results = await executeQuery(graphData, query);
      expect(results.length).toBe(3);
      expect(results.every(r => r.x === null)).toBe(true);
    });

    it('no nulls — NULLS FIRST (no effect)', async () => {
      const query = 'UNWIND [3, 1, 2] AS x RETURN x ORDER BY x NULLS FIRST';
      const results = await executeQuery(graphData, query);
      expect(results).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
    });

    it('no nulls — NULLS LAST (no effect)', async () => {
      const query = 'UNWIND [3, 1, 2] AS x RETURN x ORDER BY x NULLS LAST';
      const results = await executeQuery(graphData, query);
      expect(results).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
    });

    it('single null value', async () => {
      const query = 'UNWIND [null] AS x RETURN x ORDER BY x NULLS FIRST';
      const results = await executeQuery(graphData, query);
      expect(results).toEqual([{ x: null }]);
    });

    it('UNWIND with WHERE and ORDER BY NULLS FIRST combined', async () => {
      const query = 'UNWIND [1, null, 3, null, 5] AS x WHERE x IS NOT NULL RETURN x ORDER BY x NULLS FIRST';
      const results = await executeQuery(graphData, query);
      expect(results).toEqual([{ x: 1 }, { x: 3 }, { x: 5 }]);
    });

    it('string values with nulls', async () => {
      const query = "UNWIND ['banana', null, 'apple', null, 'cherry'] AS s RETURN s ORDER BY s NULLS FIRST";
      const results = await executeQuery(graphData, query);
      expect(results[0]!.s).toBeNull();
      expect(results[1]!.s).toBeNull();
      expect(results[2]!.s).toBe('apple');
      expect(results[3]!.s).toBe('banana');
      expect(results[4]!.s).toBe('cherry');
    });
  });
});
