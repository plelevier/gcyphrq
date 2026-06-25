import { describe, it, expect, beforeEach } from 'vitest';
import { Graph, type GraphInstance } from '../src/graph';
import { AdvancedCypherGraphologyEngine } from '../src/engine/cypher-engine';
import { parseCypher as _parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST, CallClause } from '../src/types/cypher';
import { buildIndexesFromGraph, node } from './helpers';

const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;

function createEngine(graph: GraphInstance) {
  const indexes = buildIndexesFromGraph(graph);
  return new AdvancedCypherGraphologyEngine(graph, indexes);
}

// ── Parser tests ─────────────────────────────────────────────────────────────

describe('CALL parser', () => {
  it('parses basic CALL with MATCH inside', () => {
    const ast = parseCypher('CALL { MATCH (n:Person) RETURN n.name AS name }');
    expect(ast.stages.length).toBe(1);
    expect(ast.stages[0]?.type).toBe('CALL');
    const clause = (ast.stages[0]! as { type: 'CALL'; clause: CallClause }).clause;
    expect(clause.inline).toBe(true);
    expect(clause.yieldVariables).toBeUndefined();
    expect(clause.innerQuery.stages.length).toBe(1);
    expect(clause.innerQuery.stages[0]?.type).toBe('MATCH');
    expect(clause.innerQuery.return).toBeDefined();
    expect(clause.innerQuery.return?.projections[0]?.alias).toBe('name');
  });

  it('parses CALL with YIELD', () => {
    const ast = parseCypher('CALL { MATCH (n:Person) RETURN n, n.name } YIELD name');
    const clause = (ast.stages[0]! as { type: 'CALL'; clause: CallClause }).clause;
    expect(clause.yieldVariables).toEqual(['name']);
  });

  it('parses CALL with multiple YIELD variables', () => {
    const ast = parseCypher('CALL { MATCH (n) RETURN n, n.name, n.age } YIELD name, age');
    const clause = (ast.stages[0]! as { type: 'CALL'; clause: CallClause }).clause;
    expect(clause.yieldVariables).toEqual(['name', 'age']);
  });

  it('parses CALL followed by RETURN', () => {
    const ast = parseCypher('CALL { MATCH (n:Person) RETURN n.name AS name } RETURN name');
    expect(ast.stages.length).toBe(1);
    expect(ast.stages[0]?.type).toBe('CALL');
    expect(ast.return).toBeDefined();
    expect(ast.return?.projections[0]?.alias).toBe('name');
  });

  it('parses CALL with multiple inner clauses', () => {
    const ast = parseCypher('CALL { MATCH (n:Person) WITH n WHERE n.age > 20 RETURN n.name AS name }');
    const clause = (ast.stages[0]! as { type: 'CALL'; clause: CallClause }).clause;
    expect(clause.innerQuery.stages.length).toBe(2);
    expect(clause.innerQuery.stages[0]?.type).toBe('MATCH');
    expect(clause.innerQuery.stages[1]?.type).toBe('WITH');
  });

  it('parses CALL before MATCH', () => {
    const ast = parseCypher('CALL { MATCH (n:Person) RETURN n.name AS name } MATCH (m:Movie) RETURN name, m');
    expect(ast.stages.length).toBe(2);
    expect(ast.stages[0]?.type).toBe('CALL');
    expect(ast.stages[1]?.type).toBe('MATCH');
  });
});

// ── Engine tests: basic CALL ─────────────────────────────────────────────────

describe('CALL engine: basic', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('p1', { label: 'Person', name: 'Alice', age: 30 });
    graph.addNode('p2', { label: 'Person', name: 'Bob', age: 25 });
    graph.addNode('p3', { label: 'Person', name: 'Charlie', age: 35 });
  });

  it('executes basic CALL with MATCH inside', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('CALL { MATCH (n:Person) RETURN n.name AS name }');
    const results = engine.execute(ast);
    expect(results.length).toBe(3);
    const names = results.map((r) => r['name'] as string).sort();
    expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('CALL with WHERE filter inside', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('CALL { MATCH (n:Person) WHERE n.age > 28 RETURN n.name AS name }');
    const results = engine.execute(ast);
    expect(results.length).toBe(2);
    const names = results.map((r) => r['name'] as string).sort();
    expect(names).toEqual(['Alice', 'Charlie']);
  });

  it('CALL with aggregation inside', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('CALL { MATCH (n:Person) RETURN count(n) AS total }');
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['total']).toBe(3);
  });

  it('CALL with aggregation and non-aggregation inside', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('CALL { MATCH (n:Person) RETURN count(n) AS total, min(n.age) AS minAge }');
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['total']).toBe(3);
    expect(results[0]?.['minAge']).toBe(25);
  });
});

// ── Engine tests: CALL with outer scope (inline) ─────────────────────────────

describe('CALL engine: inline subquery', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('a', { label: 'Person', name: 'Alice' });
    graph.addNode('b', { label: 'Person', name: 'Bob' });
    graph.addNode('c', { label: 'Person', name: 'Charlie' });
    graph.addEdge('a', 'b', { type: 'FRIEND' });
    graph.addEdge('a', 'c', { type: 'FRIEND' });
    graph.addEdge('b', 'c', { type: 'FRIEND' });
  });

  it('inline CALL can reference outer variable', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:Person {name: "Alice"}) CALL { MATCH (a)-[:FRIEND]->(b) RETURN b.name AS friend } RETURN friend',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(2);
    const friends = results.map((r) => r['friend'] as string).sort();
    expect(friends).toEqual(['Bob', 'Charlie']);
  });

  it('row expansion: 1 outer row produces multiple inner rows', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:Person {name: "Alice"}) CALL { MATCH (a)-[:FRIEND]->(b) RETURN b.name AS friend } RETURN a.name AS person, friend',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(2);
    // Both rows should have the outer variable bound
    for (const row of results) {
      expect(row['person']).toBe('Alice');
    }
  });

  it('multiple outer rows each expanded by inner query', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:Person) CALL { MATCH (a)-[:FRIEND]->(b) RETURN b.name AS friend } RETURN a.name AS person, friend',
    );
    const results = engine.execute(ast);
    // Alice→Bob, Alice→Charlie (2), Bob→Charlie (1), Charlie→nobody (0) = 3 total
    expect(results.length).toBe(3);
  });

  it('outer variable not matched by inner query drops the row', () => {
    // Add an isolated person with no friends
    graph.addNode('d', { label: 'Person', name: 'Diana' });
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:Person) CALL { MATCH (a)-[:FRIEND]->(b) RETURN b.name AS friend } RETURN a.name AS person, friend',
    );
    const results = engine.execute(ast);
    // Diana has no friends, so her row is dropped
    const persons = results.map((r) => r['person'] as string);
    expect(persons).not.toContain('Diana');
  });
});

// ── Engine tests: YIELD ──────────────────────────────────────────────────────

describe('CALL engine: YIELD', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('p1', { label: 'Person', name: 'Alice', age: 30 });
    graph.addNode('p2', { label: 'Person', name: 'Bob', age: 25 });
  });

  it('YIELD restricts which variables are exposed', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) RETURN n, n.name AS name, n.age AS age } YIELD name',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(2);
    // Only 'name' should be in the result, not 'age' or 'n'
    for (const row of results) {
      expect(row['name']).toBeDefined();
      expect(row['age']).toBeUndefined();
      expect(row['n']).toBeUndefined();
    }
  });

  it('YIELD with multiple variables', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) RETURN n.name AS name, n.age AS age } YIELD name, age',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(2);
    for (const row of results) {
      expect(row['name']).toBeDefined();
      expect(row['age']).toBeDefined();
    }
  });

  it('YIELD followed by WHERE filters results', () => {
    graph.addNode('p3', { label: 'Person', name: 'Charlie', age: 35 });
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) RETURN n.name AS name, n.age AS age } YIELD name WHERE name <> "Bob" RETURN name',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(2);
    const names = results.map((r) => r['name'] as string).sort();
    expect(names).toEqual(['Alice', 'Charlie']);
  });
});

// ── Engine tests: CALL followed by other clauses ─────────────────────────────

describe('CALL engine: multi-stage queries', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('p1', { label: 'Person', name: 'Alice', age: 30 });
    graph.addNode('p2', { label: 'Person', name: 'Bob', age: 25 });
    graph.addNode('p3', { label: 'Person', name: 'Charlie', age: 35 });
    graph.addNode('m1', { label: 'Movie', title: 'Inception' });
    graph.addNode('m2', { label: 'Movie', title: 'Matrix' });
  });

  it('CALL followed by RETURN', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) RETURN n.name AS name } RETURN name',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(3);
    const names = results.map((r) => r['name'] as string).sort();
    expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('CALL followed by MATCH (cartesian product)', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) RETURN n.name AS name } MATCH (m:Movie) RETURN name, m.title AS title',
    );
    const results = engine.execute(ast);
    // 3 persons x 2 movies = 6 rows
    expect(results.length).toBe(6);
  });

  it('MATCH followed by CALL', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (m:Movie) CALL { MATCH (n:Person) RETURN n.name AS name } RETURN m.title AS title, name',
    );
    const results = engine.execute(ast);
    // 2 movies x 3 persons = 6 rows
    expect(results.length).toBe(6);
  });

  it('CALL with WHERE on outer scope', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) RETURN n.age AS age } WHERE age > 28 RETURN age',
    );
    // WHERE after CALL is converted to WITH * WHERE, filtering results
    // Alice=30, Bob=25, Charlie=35 → age > 28 keeps Alice and Charlie
    const results = engine.execute(ast);
    expect(results.length).toBe(2);
    const ages = results.map((r) => r['age'] as number).sort((a, b) => a - b);
    expect(ages).toEqual([30, 35]);
  });

  it('CALL followed by WITH', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) RETURN n.name AS name } WITH name WHERE name <> "Bob" RETURN name',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(2);
    const names = results.map((r) => r['name'] as string).sort();
    expect(names).toEqual(['Alice', 'Charlie']);
  });
});

// ── Engine tests: empty results ──────────────────────────────────────────────

describe('CALL engine: empty results', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('p1', { label: 'Person', name: 'Alice' });
  });

  it('inner query returns 0 rows drops outer row', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'MATCH (a:Person) CALL { MATCH (a)-[:FRIEND]->(b) RETURN b.name AS friend } RETURN a.name AS person, friend',
    );
    const results = engine.execute(ast);
    // Alice has no friends, so the inner query returns 0 rows → outer row dropped
    expect(results.length).toBe(0);
  });

  it('CALL with no matching nodes returns empty', () => {
    const engine = createEngine(graph);
    const ast = parseCypher('CALL { MATCH (n:Movie) RETURN n.title AS title }');
    const results = engine.execute(ast);
    expect(results.length).toBe(0);
  });
});

// ── Engine tests: nested CALL ────────────────────────────────────────────────

describe('CALL engine: nested subqueries', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('p1', { label: 'Person', name: 'Alice' });
    graph.addNode('p2', { label: 'Person', name: 'Bob' });
  });

  it('nested CALL (CALL inside CALL)', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { CALL { MATCH (n:Person) RETURN n.name AS name } RETURN name }',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(2);
    const names = results.map((r) => r['name'] as string).sort();
    expect(names).toEqual(['Alice', 'Bob']);
  });
});

// ── Engine tests: CALL with CREATE ───────────────────────────────────────────

describe('CALL engine: mutations', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('p1', { label: 'Person', name: 'Alice' });
  });

  it('CALL with CREATE inside creates nodes', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { CREATE (n:Tag {name: "test"}) RETURN n.name AS tagName }',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['tagName']).toBe('test');

    // Verify the node was created
    const allNodes = graph.filterNodes(() => true);
    const tagNodes = allNodes.filter((id) => {
      const attrs = graph.getNodeAttributes(id);
      return attrs.label === 'Tag';
    });
    expect(tagNodes.length).toBe(1);
  });

  it('CALL with SET inside modifies nodes', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) SET n.updated = true RETURN n.name AS name }',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(1);
    expect(results[0]?.['name']).toBe('Alice');

    // Verify the property was set
    const attrs = graph.getNodeAttributes('p1');
    expect(attrs.updated).toBe(true);
  });
});

// ── Engine tests: CALL with UNWIND ───────────────────────────────────────────

describe('CALL engine: UNWIND inside subquery', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('p1', { label: 'Person', name: 'Alice', tags: ['a', 'b', 'c'] });
  });

  it('UNWIND inside CALL', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) UNWIND n.tags AS tag RETURN tag }',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(3);
    const tags = results.map((r) => r['tag'] as string).sort();
    expect(tags).toEqual(['a', 'b', 'c']);
  });
});

// ── Engine tests: CALL with ORDER BY inside ──────────────────────────────────

describe('CALL engine: ORDER BY inside subquery', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('p1', { label: 'Person', name: 'Charlie' });
    graph.addNode('p2', { label: 'Person', name: 'Alice' });
    graph.addNode('p3', { label: 'Person', name: 'Bob' });
  });

  it('ORDER BY inside CALL', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) RETURN n.name AS name ORDER BY n.name }',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(3);
    const names = results.map((r) => r['name'] as string);
    expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('ORDER BY DESC inside CALL', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) RETURN n.name AS name ORDER BY n.name DESC }',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(3);
    const names = results.map((r) => r['name'] as string);
    expect(names).toEqual(['Charlie', 'Bob', 'Alice']);
  });
});

// ── Engine tests: CALL with LIMIT/SKIP inside ────────────────────────────────

describe('CALL engine: LIMIT/SKIP inside subquery', () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = new Graph();
    graph.addNode('p1', { label: 'Person', name: 'Alice' });
    graph.addNode('p2', { label: 'Person', name: 'Bob' });
    graph.addNode('p3', { label: 'Person', name: 'Charlie' });
  });

  it('LIMIT inside CALL', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) RETURN n.name AS name LIMIT 2 }',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(2);
  });

  it('SKIP inside CALL', () => {
    const engine = createEngine(graph);
    const ast = parseCypher(
      'CALL { MATCH (n:Person) RETURN n.name AS name SKIP 1 }',
    );
    const results = engine.execute(ast);
    expect(results.length).toBe(2);
  });
});

// ── Error handling ───────────────────────────────────────────────────────────

describe('CALL error handling', () => {
  it('throws on stored procedure calls', () => {
    expect(() => parseCypher('CALL db.labels()')).toThrow(/Stored procedure/);
  });
});
