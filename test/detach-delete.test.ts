import { describe, it, expect } from 'vitest';
import { parseCypher } from '../src/engine/cypher-parser';
import { executeQuery } from '../src/lib';
import type { DeleteClause, MergeClause } from '../src/types/cypher';

// ── Parser tests ─────────────────────────────────────────────────────────────

describe('DETACH DELETE parser', () => {
  it('parses DETACH DELETE with detach flag', () => {
    const ast = parseCypher('MATCH (n) DETACH DELETE n');
    const writeStage = ast.stages.find((s) => s.type === 'WRITE');
    expect(writeStage).toBeDefined();
    if (!writeStage || writeStage.type !== 'WRITE') return;
    const clause = writeStage.clause as DeleteClause;
    expect(clause.type).toBe('DELETE');
    expect(clause.variables).toEqual(['n']);
    expect(clause.detach).toBe(true);
  });

  it('parses plain DELETE without detach flag', () => {
    const ast = parseCypher('MATCH (n) DELETE n');
    const writeStage = ast.stages.find((s) => s.type === 'WRITE');
    expect(writeStage).toBeDefined();
    if (!writeStage || writeStage.type !== 'WRITE') return;
    const clause = writeStage.clause as DeleteClause;
    expect(clause.type).toBe('DELETE');
    expect(clause.variables).toEqual(['n']);
    expect(clause.detach).toBe(false);
  });

  it('parses DETACH DELETE with multiple variables', () => {
    const ast = parseCypher('MATCH (n)-[r]->(m) DETACH DELETE n, r');
    const writeStage = ast.stages.find((s) => s.type === 'WRITE');
    expect(writeStage).toBeDefined();
    if (!writeStage || writeStage.type !== 'WRITE') return;
    const clause = writeStage.clause as DeleteClause;
    expect(clause.type).toBe('DELETE');
    expect(clause.variables).toEqual(['n', 'r']);
    expect(clause.detach).toBe(true);
  });

  it('parses plain DELETE with multiple variables', () => {
    const ast = parseCypher('MATCH (n)-[r]->(m) DELETE n, r');
    const writeStage = ast.stages.find((s) => s.type === 'WRITE');
    expect(writeStage).toBeDefined();
    if (!writeStage || writeStage.type !== 'WRITE') return;
    const clause = writeStage.clause as DeleteClause;
    expect(clause.type).toBe('DELETE');
    expect(clause.variables).toEqual(['n', 'r']);
    expect(clause.detach).toBe(false);
  });
});

// ── Engine tests ─────────────────────────────────────────────────────────────

describe('DETACH DELETE engine', () => {
  const graphData = {
    nodes: [
      { key: 'a', attributes: { label: 'Person', name: 'Alice' } },
      { key: 'b', attributes: { label: 'Person', name: 'Bob' } },
      { key: 'c', attributes: { label: 'Person', name: 'Charlie' } },
      { key: 'd', attributes: { label: 'Person', name: 'Diana' } },
    ],
    edges: [
      { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
      { source: 'a', target: 'c', attributes: { type: 'LIKES' } },
      { source: 'b', target: 'c', attributes: { type: 'KNOWS' } },
      { source: 'd', target: 'a', attributes: { type: 'FOLLOWS' } },
    ],
  };

  it('deletes a node and all incident edges — verified by remaining nodes', () => {
    // DETACH DELETE Alice, then return remaining people
    const result = executeQuery(
      graphData,
      'MATCH (n:Person {name: "Alice"}) DETACH DELETE n MATCH (m:Person) RETURN m.name AS name ORDER BY name',
    );
    expect(result).toEqual([
      { name: 'Bob' },
      { name: 'Charlie' },
      { name: 'Diana' },
    ]);
  });

  it('deletes a node with multiple incident edges (incoming + outgoing)', () => {
    // Alice has: outgoing to Bob (KNOWS), outgoing to Charlie (LIKES), incoming from Diana (FOLLOWS)
    // After DETACH DELETE Alice, only b->c (KNOWS) should remain
    const result = executeQuery(
      graphData,
      'MATCH (n:Person {name: "Alice"}) DETACH DELETE n MATCH (a)-[r]->(b) RETURN a.name AS source, reltype(r) AS relType, b.name AS target ORDER BY source',
    );
    expect(result).toEqual([
      { source: 'Bob', relType: 'KNOWS', target: 'Charlie' },
    ]);
  });

  it('DETACH DELETE on isolated node (no edges) works as plain DELETE', () => {
    const result = executeQuery(
      {
        nodes: [
          { key: 'a', attributes: { label: 'Person', name: 'Alice' } },
          { key: 'b', attributes: { label: 'Person', name: 'Bob' } },
        ],
        edges: [],
      },
      'MATCH (n:Person {name: "Alice"}) DETACH DELETE n MATCH (m:Person) RETURN m.name AS name',
    );
    expect(result).toEqual([{ name: 'Bob' }]);
  });

  it('DETACH DELETE on edge variable works as plain DELETE', () => {
    const result = executeQuery(
      {
        nodes: [
          { key: 'a', attributes: { label: 'Person', name: 'Alice' } },
          { key: 'b', attributes: { label: 'Person', name: 'Bob' } },
          { key: 'c', attributes: { label: 'Person', name: 'Charlie' } },
        ],
        edges: [
          { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
          { source: 'a', target: 'c', attributes: { type: 'LIKES' } },
        ],
      },
      'MATCH (a:Person)-[r:KNOWS]->(b:Person) DETACH DELETE r MATCH (x)-[e]->(y) RETURN reltype(e) AS relType ORDER BY relType',
    );
    // Only the LIKES edge should remain (KNOWS was deleted)
    expect(result).toEqual([{ relType: 'LIKES' }]);
  });

  it('DETACH DELETE multiple nodes in sequence', () => {
    // Delete Alice (removes a->b, a->c, d->a), then delete Bob (removes b->c)
    const result = executeQuery(
      graphData,
      'MATCH (n:Person {name: "Alice"}) DETACH DELETE n MATCH (m:Person {name: "Bob"}) DETACH DELETE m MATCH (p:Person) RETURN p.name AS name ORDER BY name',
    );
    expect(result).toEqual([
      { name: 'Charlie' },
      { name: 'Diana' },
    ]);
  });

  it('DETACH DELETE with multiple variables deletes nodes and their incident edges', () => {
    // DETACH DELETE Alice (removes a->b, a->c, d->a) and also delete the KNOWS edge
    const result = executeQuery(
      graphData,
      'MATCH (n:Person {name: "Alice"}) MATCH (b:Person {name: "Bob"})-[r:KNOWS]->(c:Person {name: "Charlie"}) DETACH DELETE n, r MATCH (x)-[e]->(y) RETURN reltype(e) AS relType ORDER BY relType',
    );
    // All edges should be gone (DETACH DELETE n removed a->b, a->c, d->a; DELETE r removed b->c)
    expect(result).toEqual([]);
  });

  it('DETACH DELETE on array of nodes collects incident edges for each', () => {
    const result = executeQuery(
      {
        nodes: [
          { key: 'a', attributes: { label: 'Person', name: 'Alice' } },
          { key: 'b', attributes: { label: 'Person', name: 'Bob' } },
          { key: 'c', attributes: { label: 'Person', name: 'Charlie' } },
        ],
        edges: [
          { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
          { source: 'b', target: 'c', attributes: { type: 'LIKES' } },
        ],
      },
      'MATCH (a:Person {name: "Alice"}) MATCH (b:Person {name: "Bob"}) FOREACH (x IN [a, b] | DETACH DELETE x) MATCH (m:Person) RETURN m.name AS name ORDER BY name',
    );
    expect(result).toEqual([{ name: 'Charlie' }]);
  });

  it('DETACH DELETE on array of edges drops each edge', () => {
    const result = executeQuery(
      {
        nodes: [
          { key: 'a', attributes: { label: 'Person', name: 'Alice' } },
          { key: 'b', attributes: { label: 'Person', name: 'Bob' } },
          { key: 'c', attributes: { label: 'Person', name: 'Charlie' } },
        ],
        edges: [
          { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
          { source: 'b', target: 'c', attributes: { type: 'LIKES' } },
        ],
      },
      'MATCH (a:Person)-[r1:KNOWS]->(b:Person) MATCH (b)-[r2:LIKES]->(c:Person) FOREACH (x IN [r1, r2] | DETACH DELETE x) MATCH (x)-[e]->(y) RETURN reltype(e) AS relType ORDER BY relType',
    );
    expect(result).toEqual([]);
  });
});

// ── MERGE with DETACH DELETE ────────────────────────────────────────────────

describe('MERGE with DETACH DELETE', () => {
  it('parses MERGE with DETACH DELETE in ON MATCH', () => {
    const ast = parseCypher('MERGE (n:User {name: "Alice"}) ON MATCH DETACH DELETE n');
    const mergeStage = ast.stages.find((s) => s.type === 'MERGE');
    expect(mergeStage).toBeDefined();
    if (!mergeStage || mergeStage.type !== 'MERGE') return;
    const clause = mergeStage.clause as MergeClause;
    expect(clause.onMatch?.detachDeleteVariables).toEqual(['n']);
  });

  it('parses MERGE with DETACH DELETE in ON CREATE', () => {
    const ast = parseCypher('MERGE (n:User {name: "Alice"}) ON CREATE DETACH DELETE n');
    const mergeStage = ast.stages.find((s) => s.type === 'MERGE');
    expect(mergeStage).toBeDefined();
    if (!mergeStage || mergeStage.type !== 'MERGE') return;
    const clause = mergeStage.clause as MergeClause;
    expect(clause.onCreate?.detachDeleteVariables).toEqual(['n']);
  });

  it('executes MERGE with DETACH DELETE in ON MATCH', () => {
    const result = executeQuery(
      {
        nodes: [
          { key: 'a', attributes: { label: 'User', name: 'Alice' } },
          { key: 'b', attributes: { label: 'User', name: 'Bob' } },
        ],
        edges: [
          { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
        ],
      },
      'MERGE (n:User {name: "Alice"}) ON MATCH DETACH DELETE n MATCH (m:User) RETURN m.name AS name ORDER BY name',
    );
    expect(result).toEqual([{ name: 'Bob' }]);
  });

  it('executes MERGE with DETACH DELETE in ON CREATE (node not found — no-op)', () => {
    // When node doesn't exist, MERGE creates it, so ON CREATE fires.
    // DETACH DELETE on the newly created node removes it immediately.
    const result = executeQuery(
      {
        nodes: [
          { key: 'b', attributes: { label: 'User', name: 'Bob' } },
        ],
        edges: [],
      },
      'MERGE (n:User {name: "Alice"}) ON CREATE DETACH DELETE n MATCH (m:User) RETURN m.name AS name ORDER BY name',
    );
    expect(result).toEqual([{ name: 'Bob' }]);
  });

  it('executes MERGE with combined SET and DETACH DELETE in ON MATCH', () => {
    const result = executeQuery(
      {
        nodes: [
          { key: 'a', attributes: { label: 'User', name: 'Alice' } },
          { key: 'b', attributes: { label: 'User', name: 'Bob' } },
        ],
        edges: [
          { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
        ],
      },
      'MERGE (n:User {name: "Alice"}) ON MATCH SET n.deleted = true DETACH DELETE n MATCH (m:User) RETURN m.name AS name ORDER BY name',
    );
    expect(result).toEqual([{ name: 'Bob' }]);
  });
});

// ── FOREACH with DETACH DELETE ──────────────────────────────────────────────

describe('FOREACH with DETACH DELETE', () => {
  it('parses FOREACH with DETACH DELETE', () => {
    const ast = parseCypher('MATCH (n) FOREACH (x IN n.items | DETACH DELETE x) RETURN n');
    const foreachStage = ast.stages.find((s) => s.type === 'FOREACH');
    expect(foreachStage).toBeDefined();
    if (!foreachStage || foreachStage.type !== 'FOREACH') return;
    const clause = foreachStage.clause;
    expect(clause.innerClause.type).toBe('DELETE');
    if (clause.innerClause.type === 'DELETE') {
      expect(clause.innerClause.detach).toBe(true);
    }
  });

  it('executes FOREACH with DETACH DELETE on list of nodes', () => {
    const result = executeQuery(
      {
        nodes: [
          { key: 'a', attributes: { label: 'Person', name: 'Alice' } },
          { key: 'b', attributes: { label: 'Person', name: 'Bob' } },
          { key: 'c', attributes: { label: 'Person', name: 'Charlie' } },
        ],
        edges: [
          { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
          { source: 'a', target: 'c', attributes: { type: 'LIKES' } },
        ],
      },
      'MATCH (a:Person {name: "Alice"}) FOREACH (x IN [a] | DETACH DELETE x) MATCH (m:Person) RETURN m.name AS name ORDER BY name',
    );
    expect(result).toEqual([
      { name: 'Bob' },
      { name: 'Charlie' },
    ]);
  });
});
