import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance } from './engine-setup';

describe('Engine - MATCH', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createTestGraph();
    engine = createEngine(graph);
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
      expect(node(results[0]!, 'a').name).toBe('Charlie');
    });

    it('traverses inbound relationships from known node', () => {
      const ast = parseCypher('MATCH (a:User {name: "Bob"})<-[r:FRIEND]-(b:User) RETURN b');
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
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
      expect(results.length).toBe(2);
      const otherNames = results.map(r => r.otherName).sort();
      expect(otherNames).toEqual(['Bob', 'Dave']);
    });
  });

  describe('execute - diamond-graph DFS paths', () => {
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
      const g = new Graph({ allowSelfLoops: true });
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
      const g = new Graph({ allowSelfLoops: true });
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addEdge('a', 'a', { type: 'SELF' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (a:Node)-[r:SELF*1..2]->(b:Node) RETURN a, b');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
    });
  });
});
