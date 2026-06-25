import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance, CypherNode, CypherEdge } from './engine-setup';

describe('Engine - path functions', () => {
  describe('labels function', () => {
    it('returns labels as array', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'Admin', name: 'Bob' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN labels(n) ORDER BY n.name ASC');
      const results = e.execute(ast);
      expect(results.map((r) => r['labels(n)'])).toEqual([['User'], ['Admin']]);
    });

    it('returns labels for multi-label nodes', () => {
      const g = new Graph();
      g.addNode('a', { label: ['Service', 'Infrastructure'], name: 'api' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) RETURN labels(n)');
      const results = e.execute(ast);
      expect(results[0]!['labels(n)']).toEqual(['Service', 'Infrastructure']);
    });

    it('returns empty array for null argument', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) OPTIONAL MATCH (n)-[]->(m) RETURN labels(m)');
      const results = e.execute(ast);
      expect(results[0]!['labels(m)']).toEqual([]);
    });
  });

  describe('path variables', () => {
    const setupGraph = () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob' });
      g.addNode('c', { label: 'User', name: 'Charlie' });
      g.addEdgeWithKey('a-friend-b', 'a', 'b', { type: 'FRIEND' });
      g.addEdgeWithKey('b-friend-c', 'b', 'c', { type: 'FRIEND' });
      return g;
    };

    it('binds path variable for simple match', () => {
      const g = setupGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH p=(n) RETURN p');
      const results = e.execute(ast);
      expect(results.length).toBe(3);
      const firstPath = results[0]!.p as Record<string, unknown>;
      expect(Array.isArray(firstPath.nodes)).toBe(true);
      expect(Array.isArray(firstPath.relationships)).toBe(true);
      expect((firstPath.nodes as unknown[]).length).toBe(1);
      expect((firstPath.relationships as unknown[]).length).toBe(0);
    });

    it('binds path variable for node-edge-node match', () => {
      const g = setupGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH path=(a)-[r]->(b) RETURN path');
      const results = e.execute(ast);
      expect(results.length).toBe(2);
      const firstPath = results[0]!.path as Record<string, unknown>;
      expect((firstPath.nodes as unknown[]).length).toBe(2);
      expect((firstPath.relationships as unknown[]).length).toBe(1);
    });

    it('path variable with variable-length paths', () => {
      const g = setupGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH path=(a)-[r*1..2]->(b) RETURN a.name, b.name, path ORDER BY a.name ASC, b.name ASC');
      const results = e.execute(ast);
      expect(results.length).toBe(3);
      const firstPath = results[0]!.path as Record<string, unknown>;
      expect((firstPath.nodes as unknown[]).length).toBe(2);
      expect((firstPath.relationships as unknown[]).length).toBe(1);
      const secondPath = results[1]!.path as Record<string, unknown>;
      expect((secondPath.nodes as unknown[]).length).toBe(3);
      expect((secondPath.relationships as unknown[]).length).toBe(2);
    });

    it('path variable null-filled on OPTIONAL MATCH miss', () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob' });
      g.addEdgeWithKey('a-friend-b', 'a', 'b', { type: 'FRIEND' });
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) OPTIONAL MATCH path=(n)-[r]->(m) RETURN n.name, path ORDER BY n.name ASC');
      const results = e.execute(ast);
      const aliceResult = results.find((r) => r.name === 'Alice');
      expect(aliceResult).toBeDefined();
      expect(aliceResult!.path).not.toBe(null);
      const bobResult = results.find((r) => r.name === 'Bob');
      expect(bobResult).toBeDefined();
      expect(bobResult!.path).toBe(null);
    });

    it('individual variables still work alongside path variable', () => {
      const g = setupGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH path=(a)-[r]->(b) RETURN a.name, b.name ORDER BY a.name ASC');
      const results = e.execute(ast);
      expect(results.map((r) => ({ a: r['a.name'], b: r['b.name'] }))).toEqual([
        { a: 'Alice', b: 'Bob' },
        { a: 'Bob', b: 'Charlie' },
      ]);
    });
  });

  describe('nodes function', () => {
    const setupGraph = () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob' });
      g.addNode('c', { label: 'User', name: 'Charlie' });
      g.addEdgeWithKey('a-friend-b', 'a', 'b', { type: 'FRIEND' });
      g.addEdgeWithKey('b-friend-c', 'b', 'c', { type: 'FRIEND' });
      return g;
    };

    it('returns nodes from path variable', () => {
      const g = setupGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH path=(a)-[r]->(b) RETURN nodes(path)');
      const results = e.execute(ast);
      expect(results.length).toBe(2);
      const firstNodes = results[0]!['nodes(path)'] as CypherNode[];
      expect(firstNodes.length).toBe(2);
      expect(firstNodes[0]!.id).toBe('a');
      expect(firstNodes[1]!.id).toBe('b');
    });

    it('returns nodes for single-node path', () => {
      const g = setupGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH p=(n) RETURN nodes(p)');
      const results = e.execute(ast);
      expect(results.length).toBe(3);
      for (const row of results) {
        const ns = row['nodes(p)'] as CypherNode[];
        expect(ns.length).toBe(1);
      }
    });

    it('returns empty array for null argument', () => {
      const g = setupGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) OPTIONAL MATCH path=(n)-[]->(m) RETURN nodes(path) ORDER BY n.name ASC');
      const results = e.execute(ast);
      const bobResult = results.find((r) => (r['nodes(path)'] as CypherNode[]).length === 0);
      expect(bobResult).toBeDefined();
    });
  });

  describe('relationships function', () => {
    const setupGraph = () => {
      const g = new Graph();
      g.addNode('a', { label: 'User', name: 'Alice' });
      g.addNode('b', { label: 'User', name: 'Bob' });
      g.addNode('c', { label: 'User', name: 'Charlie' });
      g.addEdgeWithKey('a-friend-b', 'a', 'b', { type: 'FRIEND' });
      g.addEdgeWithKey('b-friend-c', 'b', 'c', { type: 'FRIEND' });
      return g;
    };

    it('returns relationships from path variable', () => {
      const g = setupGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH path=(a)-[r]->(b) RETURN relationships(path)');
      const results = e.execute(ast);
      expect(results.length).toBe(2);
      const firstRels = results[0]!['relationships(path)'] as CypherEdge[];
      expect(firstRels.length).toBe(1);
      expect(firstRels[0]!.id).toBe('a-friend-b');
    });

    it('returns relationships for multi-hop path', () => {
      const g = setupGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH path=(a)-[r*1..2]->(b) RETURN relationships(path)');
      const results = e.execute(ast);
      const multiHop = results.find((r) => (r['relationships(path)'] as CypherEdge[]).length === 2);
      expect(multiHop).toBeDefined();
    });

    it('returns empty array for null argument', () => {
      const g = setupGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH (n) OPTIONAL MATCH path=(n)-[]->(m) RETURN relationships(path) ORDER BY n.name ASC');
      const results = e.execute(ast);
      const bobResult = results.find((r) => (r['relationships(path)'] as CypherEdge[]).length === 0);
      expect(bobResult).toBeDefined();
    });

    it('returns array directly when argument is already an array', () => {
      const g = setupGraph();
      const e = new AdvancedCypherGraphologyEngine(g);
      const ast = parseCypher('MATCH path=(a)-[r*1..2]->(b) RETURN relationships(path) ORDER BY a.name ASC, b.name ASC');
      const results = e.execute(ast);
      for (const row of results) {
        expect(Array.isArray(row['relationships(path)'])).toBe(true);
      }
    });
  });
});
