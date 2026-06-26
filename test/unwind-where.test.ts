import { describe, it, expect } from 'vitest';
import { parseCypher } from '../src/engine/cypher-parser';
import { executeQuery } from '../src/lib';
import type { AdvancedCypherAST, UnwindClause } from '../src/types/cypher';

// ── Parser tests ──────────────────────────────────────────────────────────────

describe('parseCypher - UNWIND with WHERE', () => {
  it('parses UNWIND with WHERE clause', async () => {
    const ast = parseCypher('UNWIND [1, 2, 3] AS x WHERE x > 1 RETURN x') as AdvancedCypherAST;
    expect(ast.stages.length).toBe(1); // UNWIND with embedded WHERE
    expect(ast.stages[0]?.type).toBe('UNWIND');
    const unwind = ast.stages[0]!.clause as UnwindClause;
    expect(unwind.variable).toBe('x');
    expect(unwind.where).toBeDefined();
    expect(unwind.where?.type).toBe('BinaryExpression');
  });

  it('parses UNWIND with WHERE and MATCH', async () => {
    const ast = parseCypher('MATCH (u:User) UNWIND u.tags AS tag WHERE tag <> "spam" RETURN u.name, tag') as AdvancedCypherAST;
    expect(ast.stages.length).toBe(2); // MATCH + UNWIND (with WHERE)
    expect(ast.stages[0]?.type).toBe('MATCH');
    expect(ast.stages[1]?.type).toBe('UNWIND');
    const unwind = ast.stages[1]!.clause as UnwindClause;
    expect(unwind.variable).toBe('tag');
    expect(unwind.where).toBeDefined();
  });

  it('parses UNWIND with WHERE using IS NOT NULL', async () => {
    const ast = parseCypher('UNWIND [null, 1, null, 2] AS x WHERE x IS NOT NULL RETURN x') as AdvancedCypherAST;
    expect(ast.stages[0]?.type).toBe('UNWIND');
    const unwind = ast.stages[0]!.clause as UnwindClause;
    expect(unwind.where).toBeDefined();
  });

  it('parses UNWIND with WHERE using CONTAINS', async () => {
    const ast = parseCypher("UNWIND ['apple', 'banana', 'apricot'] AS fruit WHERE fruit CONTAINS 'app' RETURN fruit") as AdvancedCypherAST;
    expect(ast.stages[0]?.type).toBe('UNWIND');
    const unwind = ast.stages[0]!.clause as UnwindClause;
    expect(unwind.where).toBeDefined();
  });

  it('parses UNWIND without WHERE (no where property)', async () => {
    const ast = parseCypher('UNWIND [1, 2, 3] AS x RETURN x') as AdvancedCypherAST;
    expect(ast.stages[0]?.type).toBe('UNWIND');
    const unwind = ast.stages[0]!.clause as UnwindClause;
    expect(unwind.where).toBeUndefined();
  });

  it('parses UNWIND with WHERE and WITH', async () => {
    const ast = parseCypher('UNWIND [1, 2, 3] AS x WHERE x > 1 WITH x WHERE x < 3 RETURN x') as AdvancedCypherAST;
    expect(ast.stages.length).toBe(2); // UNWIND (with WHERE) + WITH
    expect(ast.stages[0]?.type).toBe('UNWIND');
    expect(ast.stages[1]?.type).toBe('WITH');
    const unwind = ast.stages[0]!.clause as UnwindClause;
    expect(unwind.where).toBeDefined();
  });

  it('parses UNWIND with WHERE using IN operator', async () => {
    const ast = parseCypher('UNWIND [1, 2, 3, 4, 5] AS x WHERE x IN [2, 4] RETURN x') as AdvancedCypherAST;
    expect(ast.stages[0]?.type).toBe('UNWIND');
    const unwind = ast.stages[0]!.clause as UnwindClause;
    expect(unwind.where).toBeDefined();
  });

  it('parses UNWIND with WHERE using AND/OR', async () => {
    const ast = parseCypher('UNWIND [1, 2, 3, 4, 5] AS x WHERE x > 1 AND x < 5 RETURN x') as AdvancedCypherAST;
    expect(ast.stages[0]?.type).toBe('UNWIND');
    const unwind = ast.stages[0]!.clause as UnwindClause;
    expect(unwind.where).toBeDefined();
    expect(unwind.where?.type).toBe('LogicalExpression');
  });
});

// ── Engine tests ──────────────────────────────────────────────────────────────

describe('Engine - UNWIND with WHERE', () => {
  it('filters elements with simple comparison', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = 'UNWIND [1, 2, 3, 4, 5] AS x WHERE x > 3 RETURN x ORDER BY x';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ x: 4 }, { x: 5 }]);
  });

  it('filters with equality comparison', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = "UNWIND ['a', 'b', 'c'] AS x WHERE x = 'b' RETURN x";
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ x: 'b' }]);
  });

  it('filters with inequality comparison', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = "UNWIND ['a', 'b', 'c'] AS x WHERE x <> 'b' RETURN x ORDER BY x";
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ x: 'a' }, { x: 'c' }]);
  });

  it('filters with IS NOT NULL', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = 'UNWIND [null, 1, null, 2, 3] AS x WHERE x IS NOT NULL RETURN x ORDER BY x';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
  });

  it('filters with IS NULL', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = 'UNWIND [null, 1, null, 2] AS x WHERE x IS NULL RETURN x';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ x: null }, { x: null }]);
  });

  it('filters with CONTAINS', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = "UNWIND ['apple', 'banana', 'application', 'cherry'] AS fruit WHERE fruit CONTAINS 'app' RETURN fruit ORDER BY fruit";
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ fruit: 'apple' }, { fruit: 'application' }]);
  });

  it('filters with IN operator', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = 'UNWIND [1, 2, 3, 4, 5] AS x WHERE x IN [2, 4] RETURN x ORDER BY x';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ x: 2 }, { x: 4 }]);
  });

  it('filters with AND condition', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = 'UNWIND [1, 2, 3, 4, 5] AS x WHERE x > 1 AND x < 5 RETURN x ORDER BY x';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ x: 2 }, { x: 3 }, { x: 4 }]);
  });

  it('filters with OR condition', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = 'UNWIND [1, 2, 3, 4, 5] AS x WHERE x = 1 OR x = 5 RETURN x ORDER BY x';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ x: 1 }, { x: 5 }]);
  });

  it('filters with NOT condition', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = "UNWIND ['a', 'b', 'c'] AS x WHERE NOT x = 'b' RETURN x ORDER BY x";
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ x: 'a' }, { x: 'c' }]);
  });

  it('filters with STARTS WITH', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = "UNWIND ['hello', 'world', 'help', 'test'] AS s WHERE s STARTS WITH 'hel' RETURN s ORDER BY s";
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ s: 'hello' }, { s: 'help' }]);
  });

  it('filters with ENDS WITH', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = "UNWIND ['cat', 'bat', 'rat', 'dog'] AS s WHERE s ENDS WITH 'at' RETURN s ORDER BY s";
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ s: 'bat' }, { s: 'cat' }, { s: 'rat' }]);
  });

  it('returns empty when no elements match', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = 'UNWIND [1, 2, 3] AS x WHERE x > 100 RETURN x';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([]);
  });

  it('combines UNWIND WHERE with MATCH', async () => {
    const graphData = {
      nodes: [
        { key: 'alice', attributes: { label: 'Person', name: 'Alice', tags: ['admin', 'user'] } },
        { key: 'bob', attributes: { label: 'Person', name: 'Bob', tags: ['user', 'spam'] } },
      ],
      edges: [],
    };
    const query = 'MATCH (p:Person) UNWIND p.tags AS tag WHERE tag <> "spam" RETURN p.name, tag ORDER BY p.name, tag';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([
      { name: 'Alice', tag: 'admin' },
      { name: 'Alice', tag: 'user' },
      { name: 'Bob', tag: 'user' },
    ]);
  });

  it('combines UNWIND WHERE with aggregation', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = 'UNWIND [1, 2, 3, 4, 5] AS x WHERE x > 2 RETURN count(x) AS cnt';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ cnt: 3 }]);
  });

  it('combines UNWIND WHERE with WITH', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = 'UNWIND [1, 2, 3, 4, 5] AS x WHERE x > 1 WITH x WHERE x < 5 RETURN x ORDER BY x';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ x: 2 }, { x: 3 }, { x: 4 }]);
  });

  it('UNWIND WHERE with map property access', async () => {
    const graphData = { nodes: [], edges: [] };
    const query = 'UNWIND [{name: "Alice", age: 30}, {name: "Bob", age: 25}, {name: "Charlie", age: 35}] AS p WHERE p.age > 28 RETURN p.name ORDER BY p.name';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([{ name: 'Alice' }, { name: 'Charlie' }]);
  });

  it('UNWIND WHERE preserves outer context variables', async () => {
    const graphData = {
      nodes: [
        { key: 'n1', attributes: { label: 'Node', name: 'A', values: [1, 2, 3] } },
        { key: 'n2', attributes: { label: 'Node', name: 'B', values: [4, 5, 6] } },
      ],
      edges: [],
    };
    const query = 'MATCH (n) UNWIND n.values AS v WHERE v > 2 RETURN n.name, v ORDER BY n.name, v';
    const results = await executeQuery(graphData, query);
    expect(results).toEqual([
      { name: 'A', v: 3 },
      { name: 'B', v: 4 },
      { name: 'B', v: 5 },
      { name: 'B', v: 6 },
    ]);
  });
});
