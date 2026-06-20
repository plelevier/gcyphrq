import { describe, it, expect, beforeEach } from 'vitest';
import { Graph, type GraphInstance } from '../src/graph';
import { AdvancedCypherGraphologyEngine } from '../src/engine/cypher-engine';
import { parseCypher } from '../src/engine/cypher-parser';
import type { CypherNode } from '../src/types/cypher';

/** Cast a result-row value to CypherNode for test assertions. */
function node<T extends Record<string, unknown>>(row: T, key: keyof T): CypherNode {
  return row[key] as CypherNode;
}

function createTestGraph() {
  const graph = new Graph();

  graph.addNode('alice', { label: 'User', name: 'Alice', age: 30 });
  graph.addNode('bob', { label: 'User', name: 'Bob', age: 25 });
  graph.addNode('charlie', { label: 'User', name: 'Charlie', age: 35 });
  graph.addNode('dave', { label: 'User', name: 'Dave', age: 28 });

  graph.addEdge('alice', 'bob', { type: 'FRIEND' });
  graph.addEdge('bob', 'charlie', { type: 'FRIEND' });
  graph.addEdge('alice', 'dave', { type: 'KNOWS' });

  return graph;
}

describe('AdvancedCypherGraphologyEngine', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createTestGraph();
    engine = new AdvancedCypherGraphologyEngine(graph);
  });

  describe('execute - MATCH', () => {
    it('finds all nodes matching a label', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('finds nodes matching a label and property', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
    });

    it('traverses outbound relationships', () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN a, b');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'a').name).toBe('Alice');
      expect(node(results[0]!, 'b').name).toBe('Bob');
    });

    it('traverses inbound relationships', () => {
      const ast = parseCypher('MATCH (a:User)<-[r:FRIEND]-(b:User {name: "Bob"}) RETURN a');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      // (a)<-[FRIEND]-(b=Bob) means FRIEND goes b→a, i.e., Bob→Charlie, so a=Charlie
      expect(node(results[0]!, 'a').name).toBe('Charlie');
    });

    it('traverses inbound relationships from known node', () => {
      const ast = parseCypher('MATCH (a:User {name: "Bob"})<-[r:FRIEND]-(b:User) RETURN b');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      // Bob has inbound FRIEND from Alice, so b=Alice
      expect(node(results[0]!, 'b').name).toBe('Alice');
    });

    it('traverses undirected relationships', () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r:FRIEND]-(b:User) RETURN b');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'b').name).toBe('Bob');
    });

    it('traverses variable-length paths (min=1, max=2)', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"})-[r:FRIEND*1..2]->(f:User) RETURN u, f');
      const results = engine.execute(ast);
      // Alice -> Bob (depth 1), Alice -> Bob -> Charlie (depth 2)
      expect(results.length).toBe(2);
      const names = results.map((r) => node(r, 'f').name).sort();
      expect(names).toEqual(['Bob', 'Charlie']);
    });

    it('handles OPTIONAL MATCH with no match', () => {
      const ast = parseCypher('MATCH (u:User {name: "Charlie"}) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) RETURN u, f');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Charlie');
      expect(results[0]!.f).toBeNull();
    });

    it('handles OPTIONAL MATCH with a match', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) RETURN u, f');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
      expect(node(results[0]!, 'f').name).toBe('Bob');
    });

    it('filters by relationship type', () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r:KNOWS]->(b:User) RETURN b');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'b').name).toBe('Dave');
    });
  });

  describe('execute - RETURN', () => {
    it('returns projected properties with AS alias', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u.name AS name, u.age AS age');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.age).toBe(30);
    });

    it('returns projected properties using property name as default alias', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u.name, u.age');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.age).toBe(30);
    });

    it('returns full node objects', () => {
      const ast = parseCypher('MATCH (u:User {name: "Bob"}) RETURN u');
      const results = engine.execute(ast);
      expect(node(results[0]!, 'u').name).toBe('Bob');
      expect(node(results[0]!, 'u').age).toBe(25);
    });

    it('returns literal values', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u.name AS name, "Hello" AS greeting');
      const results = engine.execute(ast);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.greeting).toBe('Hello');
    });
  });

  describe('execute - WITH', () => {
    it('groups and aggregates with COUNT', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount RETURN name, friendCount'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.friendCount).toBe(1);
      const bobResult = results.find(r => r.name === 'Bob');
      expect(bobResult?.friendCount).toBe(1);
    });

    it('filters aggregated results with WHERE', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount WHERE friendCount > 0 RETURN name, friendCount'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('aggregates with SUM', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, sum(b.age) AS totalAge RETURN name, totalAge'
      );
      const results = engine.execute(ast);
      const aliceResult = results.find(r => r.name === 'Alice');
      expect(aliceResult?.totalAge).toBe(25); // Bob's age
    });
  });

  describe('execute - WRITE', () => {
    it('creates a new node with CREATE', () => {
      const ast = parseCypher('CREATE (n:User {name: "Eve", age: 22}) RETURN n');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const n = node(results[0]!, 'n');
      expect(n.name).toBe('Eve');
      expect(n.label).toBe('User');
      expect(typeof n.id).toBe('string');
      expect(graph.hasNode(n.id)).toBe(true);
    });

    it('sets a property on a node with SET', () => {
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) SET u.age = 31 RETURN u');
      const results = engine.execute(ast);
      expect(node(results[0]!, 'u').age).toBe(31);
    });

    it('deletes a node with DELETE', () => {
      const daveId = 'dave';
      const ast = parseCypher('MATCH (u:User {name: "Dave"}) DELETE u');
      engine.execute(ast);
      expect(graph.hasNode(daveId)).toBe(false);
    });
  });

  describe('execute - multi-stage queries', () => {
    it('executes MATCH-WITH-RETURN pipeline', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount RETURN name, friendCount'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('executes MATCH-CREATE-RETURN', () => {
      const initialCount = graph.order;
      const ast = parseCypher('MATCH (u:User {name: "Alice"}) CREATE (n:User {name: "Eve"}) RETURN u, n');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'u').name).toBe('Alice');
      expect(node(results[0]!, 'n').name).toBe('Eve');
      expect(graph.order).toBe(initialCount + 1);
    });
  });

  describe('edge cases', () => {
    it('returns empty array when no match is found', () => {
      const ast = parseCypher('MATCH (u:User {name: "NonExistent"}) RETURN u');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('returns empty array when no RETURN clause exists', () => {
      const ast = parseCypher('MATCH (u:User)');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('traverses undirected relationship without type or variable', () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r]-(b:User) RETURN a.name AS from, b.name AS to');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const names = results.map((r) => `${r.from}->${r.to}`).sort();
      expect(names).toEqual(['Alice->Bob', 'Alice->Dave']);
    });

    it('resolves alias collisions with var.prop fallback', () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a.name, b.name');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!).toHaveProperty('a.name');
      expect(results[0]!).toHaveProperty('b.name');
    });

    it('aggregates with COUNT in RETURN without WITH', () => {
      const ast = parseCypher('MATCH (u:User) RETURN count(u) AS total');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.total).toBe(4);
    });

    it('aggregates with SUM in RETURN without WITH', () => {
      const ast = parseCypher('MATCH (u:User) RETURN sum(u.age) AS totalAge');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.totalAge).toBe(118);
    });

    it('handles multiple matches from different start nodes', () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a.name AS from, b.name AS to');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      const pairs = results.map(r => `${r.from}->${r.to}`).sort();
      expect(pairs).toEqual(['Alice->Bob', 'Bob->Charlie']);
    });

    it('captures relationship data when variable is bound', () => {
      const ast = parseCypher('MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN a, b, r');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.r).toBeDefined();
      expect(Array.isArray(results[0]!.r)).toBe(true);
    });
  });

  describe('execute - WHERE operators', () => {
    it('filters with WHERE = operator', () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name, count(u) AS cnt WHERE cnt = 1 RETURN name',
      );
      const results = engine.execute(ast);
      // All users have count 1, so all pass
      expect(results.length).toBe(4);
    });

    it('filters with WHERE < operator', () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name, count(u) AS cnt WHERE cnt < 2 RETURN name',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('filters with WHERE < operator that excludes all', () => {
      const ast = parseCypher(
        'MATCH (u:User) WITH u.name AS name, count(u) AS cnt WHERE cnt < 0 RETURN name',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(0);
    });

    // TODO: CONTAINS is not yet extracted by the parser's extractComparison function.
    // The ANTLR grammar places CONTAINS in a different tree position than >, <, =.
    // it('filters with WHERE CONTAINS operator (match found)', () => { ... });
    // it('filters with WHERE CONTAINS operator (no match)', () => { ... });
  });

  describe('execute - bare node pattern', () => {
    it('matches all nodes with bare pattern (no label)', () => {
      const ast = parseCypher('MATCH (n) RETURN n');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('matches all nodes with bare pattern and property filter', () => {
      const ast = parseCypher('MATCH (n {age: 30}) RETURN n');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(node(results[0]!, 'n').name).toBe('Alice');
    });
  });

  describe('execute - edge attributes', () => {
    it('returns edge attributes when relationship variable is bound', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN r',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const edges = results[0]!.r as Array<{ type: string }>;
      expect(Array.isArray(edges)).toBe(true);
      expect(edges[0]!.type).toBe('FRIEND');
    });

    it('returns edge id in relationship data', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"})-[r:FRIEND]->(b:User) RETURN r',
      );
      const results = engine.execute(ast);
      const edges = results[0]!.r as Array<{ id: string }>;
      expect(edges[0]!.id).toBeDefined();
      expect(typeof edges[0]!.id).toBe('string');
    });
  });

  describe('execute - self-loops', () => {
    it('handles self-loop edges correctly', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addEdge('a', 'a', { type: 'SELF' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (a:Node)-[r:SELF]->(b:Node) RETURN a.name AS from, b.name AS to');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.from).toBe('A');
      expect(results[0]!.to).toBe('A');
    });

    it('handles self-loop with variable-length path (cycle guard prevents depth 2)', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addEdge('a', 'a', { type: 'SELF' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (a:Node)-[r:SELF*1..2]->(b:Node) RETURN a, b');
      const results = e.execute(ast);
      // DFS visited set prevents re-visiting A, so only depth-1 match is found
      expect(results.length).toBe(1);
    });
  });

  describe('execute - multiple WRITE stages', () => {
    it('executes SET then DELETE in sequence', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Dave"}) SET u.age = 99 DELETE u',
      );
      engine.execute(ast);
      expect(graph.hasNode('dave')).toBe(false);
    });

    it('executes CREATE then SET on different nodes', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) CREATE (n:User {name: "Eve", age: 22}) SET u.age = 99 RETURN u, n',
      );
      const results = engine.execute(ast);
      expect(node(results[0]!, 'u').age).toBe(99);
      expect(node(results[0]!, 'n').name).toBe('Eve');
    });

    it('executes CREATE then SET on the created node', () => {
      const ast = parseCypher(
        'CREATE (n:User {name: "Eve", age: 22}) SET n.age = 25 RETURN n',
      );
      const results = engine.execute(ast);
      expect(node(results[0]!, 'n').age).toBe(25);
    });
  });

  describe('execute - mixed aggregation error', () => {
    it('throws when non-aggregation varies across rows in RETURN without WITH', () => {
      const ast = parseCypher(
        'MATCH (u:User) RETURN u.name AS name, count(u) AS total',
      );
      expect(() => engine.execute(ast)).toThrow(/Mixed aggregation/i);
    });

    it('does not throw when non-aggregation is constant in RETURN without WITH', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher(
        'MATCH (u:User) RETURN u.name AS name, count(u) AS total',
      );
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.total).toBe(1);
    });
  });

  describe('execute - OPTIONAL MATCH edge cases', () => {
    it('preserves source variable in OPTIONAL MATCH with no match', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Charlie"}) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) RETURN u.name AS name, f',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('Charlie');
      expect(results[0]!.f).toBeNull();
    });

    it('nulls relationship variable in OPTIONAL MATCH with no match', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Charlie"}) OPTIONAL MATCH (u)-[r:FRIEND]->(f:User) RETURN u, r',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.r).toEqual([]);
    });

    it('handles OPTIONAL MATCH with multiple possible matches', () => {
      const ast = parseCypher(
        'MATCH (u:User {name: "Alice"}) OPTIONAL MATCH (u)-[r]-(other:User) RETURN u.name AS name, other.name AS otherName',
      );
      const results = engine.execute(ast);
      // Alice has 2 undirected connections: Bob (FRIEND) and Dave (KNOWS)
      expect(results.length).toBe(2);
      const otherNames = results.map(r => r.otherName).sort();
      expect(otherNames).toEqual(['Bob', 'Dave']);
    });
  });

  describe('execute - diamond-graph DFS paths', () => {
    // Diamond: A─►D, A─►B─►D, A─►C─►D
    let diamondGraph: GraphInstance;
    let diamondEngine: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      diamondGraph = new Graph();
      diamondGraph.addNode('a', { label: 'Node', name: 'A' });
      diamondGraph.addNode('b', { label: 'Node', name: 'B' });
      diamondGraph.addNode('c', { label: 'Node', name: 'C' });
      diamondGraph.addNode('d', { label: 'Node', name: 'D' });
      diamondGraph.addEdge('a', 'd', { type: 'LINK' });
      diamondGraph.addEdge('a', 'b', { type: 'LINK' });
      diamondGraph.addEdge('b', 'd', { type: 'LINK' });
      diamondGraph.addEdge('a', 'c', { type: 'LINK' });
      diamondGraph.addEdge('c', 'd', { type: 'LINK' });
      diamondEngine = new AdvancedCypherGraphologyEngine(diamondGraph);
    });

    it('finds all three paths in a diamond graph with [*1..2]', () => {
      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..2]->(d:Node {name: "D"}) RETURN a, d');
      const results = diamondEngine.execute(ast);
      // A→D (depth 1), A→B→D (depth 2), A→C→D (depth 2)
      expect(results.length).toBe(3);
    });

    it('finds only the direct edge in diamond graph with [*1..1]', () => {
      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..1]->(d:Node {name: "D"}) RETURN a, d');
      const results = diamondEngine.execute(ast);
      expect(results.length).toBe(1);
    });

    it('finds all paths in complex diamond with [*1..3]', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addNode('b', { label: 'Node', name: 'B' });
      g.addNode('c', { label: 'Node', name: 'C' });
      g.addNode('d', { label: 'Node', name: 'D' });
      g.addEdge('a', 'b', { type: 'LINK' });
      g.addEdge('a', 'c', { type: 'LINK' });
      g.addEdge('b', 'd', { type: 'LINK' });
      g.addEdge('b', 'c', { type: 'LINK' });
      g.addEdge('c', 'd', { type: 'LINK' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..3]->(d:Node {name: "D"}) RETURN a, d');
      const results = e.execute(ast);
      // A→B→D, A→C→D, A→B→C→D
      expect(results.length).toBe(3);
    });

    it('captures correct edge history for each diamond path', () => {
      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..2]->(d:Node {name: "D"}) RETURN a, d, r');
      const results = diamondEngine.execute(ast);
      expect(results.length).toBe(3);
      for (const row of results) {
        expect(Array.isArray(row.r)).toBe(true);
        expect((row.r as Array<{ id: string }>).length).toBeGreaterThanOrEqual(1);
        expect((row.r as Array<{ id: string }>).length).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('execute - SET mutation across duplicate contexts', () => {
    // X─►Z, Y─►Z  (two contexts both binding z to the same node)
    let sharedGraph: GraphInstance;
    let sharedEngine: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      sharedGraph = new Graph();
      sharedGraph.addNode('x', { label: 'Source', name: 'X', value: 10 });
      sharedGraph.addNode('y', { label: 'Source', name: 'Y', value: 20 });
      sharedGraph.addNode('z', { label: 'Target', name: 'Z', value: 100 });
      sharedGraph.addEdge('x', 'z', { type: 'REF' });
      sharedGraph.addEdge('y', 'z', { type: 'REF' });
      sharedEngine = new AdvancedCypherGraphologyEngine(sharedGraph);
    });

    it('updates shared node in all contexts after SET', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) SET z.value = 999 RETURN z.value AS zVal');
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      for (const row of results) {
        expect(row.zVal).toBe(999);
      }
    });

    it('reflects SET in a subsequent MATCH stage', () => {
      const ast = parseCypher(
        'MATCH (s:Source)-[r:REF]->(z:Target) SET z.value = 999 MATCH (z:Target {value: 999}) RETURN z.name AS zName',
      );
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      for (const row of results) {
        expect(row.zName).toBe('Z');
      }
    });

    it('reflects SET in RETURN after MATCH-SET pipeline', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) SET z.value = 999 RETURN s.name AS source, z.value AS zVal');
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      expect(results.map((r) => r.source).sort()).toEqual(['X', 'Y']);
      for (const row of results) {
        expect(row.zVal).toBe(999);
      }
    });
  });

  describe('execute - ORDER BY', () => {
    it('sorts results in ascending order by default', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name');
      const results = engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    });

    it('sorts results in ascending order with explicit ASC', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name ASC');
      const results = engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    });

    it('sorts results in descending order with DESC', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name DESC');
      const results = engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Dave', 'Charlie', 'Bob', 'Alice']);
    });

    it('sorts by numeric property ascending', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC');
      const results = engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Bob', 'Dave', 'Alice', 'Charlie']); // 25, 28, 30, 35
    });

    it('sorts by numeric property descending', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC');
      const results = engine.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Charlie', 'Alice', 'Dave', 'Bob']); // 35, 30, 28, 25
    });

    it('sorts by multiple columns', () => {
      // Create graph with same ages to test secondary sort
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', age: 30 });
      g.addNode('b', { label: 'User', name: 'Bob', age: 30 });
      g.addNode('c', { label: 'User', name: 'Charlie', age: 25 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC, u.name ASC');
      const results = e.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Charlie', 'Alice', 'Bob']); // Charlie(25), Alice(30), Bob(30)
    });

    it('sorts with multiple columns where secondary sort is DESC', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice', age: 30 });
      g.addNode('b', { label: 'User', name: 'Bob', age: 30 });
      g.addNode('c', { label: 'User', name: 'Charlie', age: 25 });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC, u.name DESC');
      const results = e.execute(ast);
      const names = results.map(r => r.name);
      expect(names).toEqual(['Charlie', 'Bob', 'Alice']); // Charlie(25), Bob(30), Alice(30)
    });

    it('handles ORDER BY with no matching results', () => {
      const ast = parseCypher('MATCH (u:User {name: "NonExistent"}) RETURN u.name ORDER BY u.name');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('handles ORDER BY on aggregated results', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[r:FRIEND]->(b:User) WITH a.name AS name, count(b) AS friendCount RETURN name, friendCount ORDER BY friendCount DESC, name ASC'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      // Both have friendCount=1, so secondary sort by name ASC
      expect(results[0]!.name).toBe('Alice');
      expect(results[1]!.name).toBe('Bob');
    });
  });

  describe('execute - LIMIT', () => {
    it('limits results to specified count', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 2');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
    });

    it('limits to 1 result', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 1');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
    });

    it('limit larger than result set returns all results', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 100');
      const results = engine.execute(ast);
      expect(results.length).toBe(4);
    });

    it('limit 0 returns empty array', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name LIMIT 0');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });

    it('LIMIT with no matching results returns empty array', () => {
      const ast = parseCypher('MATCH (u:User {name: "NonExistent"}) RETURN u.name LIMIT 5');
      const results = engine.execute(ast);
      expect(results).toEqual([]);
    });
  });

  describe('execute - ORDER BY + LIMIT combined', () => {
    it('sorts then limits results', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC LIMIT 2');
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      expect(results[0]!.name).toBe('Charlie'); // age 35
      expect(results[1]!.name).toBe('Alice');   // age 30
    });

    it('limits then sorts with ORDER BY before LIMIT', () => {
      const ast = parseCypher('MATCH (u:User) RETURN u.name ORDER BY u.name ASC LIMIT 3');
      const results = engine.execute(ast);
      expect(results.length).toBe(3);
      expect(results.map(r => r.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('works with aggregations: ORDER BY + LIMIT on WITH', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[]->(b:User) WITH a.name AS name, count(b) AS outDegree ORDER BY outDegree DESC LIMIT 1 RETURN name, outDegree'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      // Alice has 2 outgoing edges (FRIEND to Bob, KNOWS to Dave)
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.outDegree).toBe(2);
    });

    it('works with aggregations: ORDER BY on RETURN after WITH', () => {
      const ast = parseCypher(
        'MATCH (a:User)-[]->(b:User) WITH a.name AS name, count(b) AS outDegree RETURN name, outDegree ORDER BY outDegree DESC'
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(2);
      // Alice has 2 outgoing, Bob has 1
      expect(results[0]!.name).toBe('Alice');
      expect(results[0]!.outDegree).toBe(2);
      expect(results[1]!.name).toBe('Bob');
      expect(results[1]!.outDegree).toBe(1);
    });
  });

  describe('execute - DELETE mutation across duplicate contexts', () => {
    let sharedGraph: GraphInstance;
    let sharedEngine: AdvancedCypherGraphologyEngine;

    beforeEach(() => {
      sharedGraph = new Graph();
      sharedGraph.addNode('x', { label: 'Source', name: 'X', value: 10 });
      sharedGraph.addNode('y', { label: 'Source', name: 'Y', value: 20 });
      sharedGraph.addNode('z', { label: 'Target', name: 'Z', value: 100 });
      sharedGraph.addEdge('x', 'z', { type: 'REF' });
      sharedGraph.addEdge('y', 'z', { type: 'REF' });
      sharedEngine = new AdvancedCypherGraphologyEngine(sharedGraph);
    });

    it('nulls shared node in all contexts after DELETE', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) DELETE z RETURN z');
      const results = sharedEngine.execute(ast);
      expect(results.length).toBe(2);
      for (const row of results) {
        expect(row.z).toBeNull();
      }
    });

    it('drops node from graph after DELETE', () => {
      const ast = parseCypher('MATCH (z:Target) DELETE z RETURN z');
      sharedEngine.execute(ast);
      expect(sharedGraph.hasNode('z')).toBe(false);
    });

    it('does not double-delete when multiple contexts reference same node', () => {
      const ast = parseCypher('MATCH (s:Source)-[r:REF]->(z:Target) DELETE z RETURN s.name');
      expect(() => sharedEngine.execute(ast)).not.toThrow();
    });
  });
});
