import { describe, it, expect } from 'vitest';
import { executeQuery, createGraph, parseCypher, GraphEngine, buildGraphIndexes } from '../src/lib';
import type { GraphInput } from '../src/lib';

const socialGraph: GraphInput = {
  options: { type: 'directed' },
  nodes: [
    { key: 'alice', attributes: { label: 'User', name: 'Alice' } },
    { key: 'bob', attributes: { label: 'User', name: 'Bob' } },
    { key: 'charlie', attributes: { label: 'User', name: 'Charlie' } },
  ],
  edges: [
    { source: 'alice', target: 'bob', attributes: { type: 'FRIEND' } },
    { source: 'bob', target: 'charlie', attributes: { type: 'FRIEND' } },
  ],
};

describe('UNION / UNION ALL', () => {
  describe('parsing', () => {
    it('parses UNION as UnionQuery AST', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION MATCH (u:User {name: "Bob"}) RETURN u.name',
      );
      expect(ast.type).toBe('UnionQuery');
      if (ast.type !== 'UnionQuery') return;
      expect(ast.branches.length).toBe(2);
      expect(ast.unionTypes).toEqual([null, 'UNION']);
    });

    it('parses UNION ALL as UnionQuery AST', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name',
      );
      expect(ast.type).toBe('UnionQuery');
      if (ast.type !== 'UnionQuery') return;
      expect(ast.branches.length).toBe(2);
      expect(ast.unionTypes).toEqual([null, 'UNION ALL']);
    });

    it('parses 3+ branches with mixed UNION/UNION ALL', () => {
      const ast = parseCypher(
        'MATCH (u:User) RETURN u.name UNION MATCH (u:User) RETURN u.name UNION ALL MATCH (u:User) RETURN u.name',
      );
      expect(ast.type).toBe('UnionQuery');
      if (ast.type !== 'UnionQuery') return;
      expect(ast.branches.length).toBe(3);
      expect(ast.unionTypes).toEqual([null, 'UNION', 'UNION ALL']);
    });

    it('parses single query without UNION as AdvancedCypherAST', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name');
      expect(ast.type).toBe('Query');
    });

    it('extracts ORDER BY from last branch to union level', () => {
      const ast = parseCypher(
        'MATCH (u:User) RETURN u.name UNION ALL MATCH (u:User) RETURN u.name ORDER BY name DESC',
      );
      expect(ast.type).toBe('UnionQuery');
      if (ast.type !== 'UnionQuery') return;
      expect(ast.orderBy).toBeDefined();
      expect(ast.orderBy?.[0]?.direction).toBe('DESC');
      // Last branch should have ORDER BY cleared
      const lastBranch = ast.branches[ast.branches.length - 1]!;
      expect(lastBranch.return?.orderBy).toBeUndefined();
    });

    it('extracts SKIP and LIMIT from last branch to union level', () => {
      const ast = parseCypher(
        'MATCH (u:User) RETURN u.name UNION ALL MATCH (u:User) RETURN u.name SKIP 1 LIMIT 2',
      );
      expect(ast.type).toBe('UnionQuery');
      if (ast.type !== 'UnionQuery') return;
      expect(ast.skip).toBe(1);
      expect(ast.limit).toBe(2);
      // Last branch should have SKIP/LIMIT cleared
      const lastBranch = ast.branches[ast.branches.length - 1]!;
      expect(lastBranch.return?.skip).toBeUndefined();
      expect(lastBranch.return?.limit).toBeUndefined();
    });
  });

  describe('UNION ALL execution', () => {
    it('concatenates results from two branches', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name',
      );
      expect(results).toEqual([
        { name: 'Alice' },
        { name: 'Bob' },
      ]);
    });

    it('preserves duplicates with UNION ALL', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "Alice"}) RETURN u.name',
      );
      expect(results).toEqual([
        { name: 'Alice' },
        { name: 'Alice' },
      ]);
    });

    it('handles 3+ branches', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name UNION ALL MATCH (u:User {name: "Charlie"}) RETURN u.name',
      );
      expect(results).toEqual([
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' },
      ]);
    });
  });

  describe('UNION (deduplicated) execution', () => {
    it('deduplicates identical rows', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION MATCH (u:User {name: "Alice"}) RETURN u.name',
      );
      expect(results).toEqual([
        { name: 'Alice' },
      ]);
    });

    it('keeps distinct rows', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION MATCH (u:User {name: "Bob"}) RETURN u.name',
      );
      expect(results).toEqual([
        { name: 'Alice' },
        { name: 'Bob' },
      ]);
    });

    it('deduplicates across 3+ branches', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION MATCH (u:User {name: "Bob"}) RETURN u.name UNION MATCH (u:User {name: "Alice"}) RETURN u.name',
      );
      expect(results).toEqual([
        { name: 'Alice' },
        { name: 'Bob' },
      ]);
    });
  });

  describe('column alignment', () => {
    it('aligns columns by name across branches', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name AS n, "A" AS grp UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name AS n, "B" AS grp',
      );
      expect(results).toEqual([
        { n: 'Alice', grp: 'A' },
        { n: 'Bob', grp: 'B' },
      ]);
    });

    it('fills missing columns with null', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name AS n, "A" AS grp UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name AS n',
      );
      expect(results).toEqual([
        { n: 'Alice', grp: 'A' },
        { n: 'Bob', grp: null },
      ]);
    });

    it('handles columns in different order', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name AS n, "A" AS grp UNION ALL MATCH (u:User {name: "Bob"}) RETURN "B" AS grp, u.name AS n',
      );
      expect(results).toEqual([
        { n: 'Alice', grp: 'A' },
        { n: 'Bob', grp: 'B' },
      ]);
    });
  });

  describe('mixed UNION and UNION ALL', () => {
    it('deduplicates when any branch is UNION (not ALL)', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name UNION MATCH (u:User {name: "Charlie"}) RETURN u.name',
      );
      expect(results).toEqual([
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' },
      ]);
    });
  });

  describe('via GraphEngine directly', () => {
    it('works with GraphEngine.executeUnion', () => {
      const graph = createGraph(socialGraph);
      const indexes = buildGraphIndexes(socialGraph, graph);
      const engine = new GraphEngine(graph, indexes);
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name',
      );
      if (ast.type !== 'UnionQuery') throw new Error('Expected UnionQuery');
      const results = engine.executeUnion(ast);
      expect(results).toEqual([
        { name: 'Alice' },
        { name: 'Bob' },
      ]);
    });
  });

  describe('with aggregations', () => {
    it('unions aggregated results', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User) RETURN count(u) AS cnt UNION ALL MATCH (u:User) RETURN count(u) AS cnt',
      );
      expect(results).toEqual([
        { cnt: 3 },
        { cnt: 3 },
      ]);
    });
  });

  describe('with WITH clause', () => {
    it('supports WITH in each branch', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User) WITH u.name AS n RETURN n UNION ALL MATCH (u:User) WITH u.name AS n RETURN n',
      );
      expect(results.length).toBe(6); // 3 + 3
    });
  });

  describe('with ORDER BY / LIMIT within branches', () => {
    it('applies ORDER BY independently per branch', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User) RETURN u.name ORDER BY u.name DESC UNION ALL MATCH (u:User) RETURN u.name ORDER BY u.name ASC',
      );
      expect(results).toEqual([
        { name: 'Charlie' },
        { name: 'Bob' },
        { name: 'Alice' },
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' },
      ]);
    });
  });

  describe('ORDER BY / SKIP / LIMIT on combined result', () => {
    it('applies ORDER BY to the full UNION result', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name UNION ALL MATCH (u:User {name: "Charlie"}) RETURN u.name ORDER BY name DESC',
      );
      expect(results).toEqual([
        { name: 'Charlie' },
        { name: 'Bob' },
        { name: 'Alice' },
      ]);
    });

    it('applies ORDER BY + LIMIT to the full result', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name UNION ALL MATCH (u:User {name: "Charlie"}) RETURN u.name ORDER BY name DESC LIMIT 2',
      );
      expect(results).toEqual([
        { name: 'Charlie' },
        { name: 'Bob' },
      ]);
    });

    it('applies ORDER BY + SKIP to the full result', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name UNION ALL MATCH (u:User {name: "Charlie"}) RETURN u.name ORDER BY name ASC SKIP 1',
      );
      expect(results).toEqual([
        { name: 'Bob' },
        { name: 'Charlie' },
      ]);
    });

    it('applies ORDER BY + SKIP + LIMIT to the full result', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name UNION ALL MATCH (u:User {name: "Charlie"}) RETURN u.name ORDER BY name ASC SKIP 1 LIMIT 1',
      );
      expect(results).toEqual([
        { name: 'Bob' },
      ]);
    });

    it('applies ORDER BY after dedup for UNION', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION MATCH (u:User {name: "Charlie"}) RETURN u.name UNION MATCH (u:User {name: "Alice"}) RETURN u.name ORDER BY name DESC',
      );
      expect(results).toEqual([
        { name: 'Charlie' },
        { name: 'Alice' },
      ]);
    });
  });

  describe('with empty branches', () => {
    it('handles empty result from one branch', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "NonExistent"}) RETURN u.name',
      );
      expect(results).toEqual([
        { name: 'Alice' },
      ]);
    });
  });

  describe('with complex values (nodes)', () => {
    it('deduplicates rows containing nodes', () => {
      const results = executeQuery(socialGraph,
        'MATCH (u:User {name: "Alice"}) RETURN u UNION MATCH (u:User {name: "Alice"}) RETURN u',
      );
      expect(results.length).toBe(1);
      expect(results[0]?.u).toMatchObject({
        id: 'alice',
        label: 'User',
        name: 'Alice',
      });
    });
  });
});
