import { describe, it, expect, beforeEach } from 'vitest';
import { parseCypher, createTestGraph, createEngine, Graph, AdvancedCypherGraphologyEngine, node } from './engine-setup';
import type { GraphInstance, CypherNode } from './engine-setup';

describe('Engine - labels', () => {
  describe('multiple labels', () => {
    it('MATCH with multiple labels (AND semantics)', () => {
      const g = new Graph();
      g.addNode('a', { label: ['Service', 'Infrastructure'], name: 'API' });
      g.addNode('b', { label: 'Service', name: 'Auth' });
      g.addNode('c', { label: 'Infrastructure', name: 'Kafka' });
      g.addNode('d', { label: ['Service', 'Infrastructure', 'Critical'], name: 'DB' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n:Service:Infrastructure) RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['API', 'DB']);
    });

    it('MATCH with single label still works', () => {
      const g = new Graph();
      g.addNode('a', { label: ['Service', 'Infrastructure'], name: 'API' });
      g.addNode('b', { label: 'Service', name: 'Auth' });
      g.addNode('c', { label: 'Infrastructure', name: 'Kafka' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n:Service) RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['API', 'Auth']);
    });

    it('CREATE with multiple labels', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('CREATE (n:A:B {name: "X"}) RETURN n');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      const n = results[0]!.n as CypherNode;
      expect(n.name).toBe('X');
      expect(n.label).toEqual(['A', 'B']);
    });

    it('CREATE with single label stores as string', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('CREATE (n:User {name: "Y"}) RETURN n');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      const n = results[0]!.n as CypherNode;
      expect(n.name).toBe('Y');
      expect(n.label).toBe('User');
    });

    it('REMOVE single label from multi-label node', () => {
      const g = new Graph();
      g.addNode('a', { label: ['Service', 'Infrastructure'], name: 'API' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n {name: "API"}) REMOVE n:Service RETURN n');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      const n = results[0]!.n as CypherNode;
      expect(n.label).toBe('Infrastructure');
    });

    it('MATCH with multiple labels and property filter', () => {
      const g = new Graph();
      g.addNode('a', { label: ['Service', 'Infrastructure'], name: 'API' });
      g.addNode('b', { label: ['Service', 'Infrastructure'], name: 'DB' });
      g.addNode('c', { label: 'Service', name: 'Auth' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n:Service:Infrastructure {name: "API"}) RETURN n.name AS name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['API']);
    });

    it('MERGE with multiple labels creates node with all labels', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (n:Service:Infrastructure {name: "API"}) RETURN n');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      const n = results[0]!.n as CypherNode;
      expect(n.name).toBe('API');
      expect(n.label).toEqual(['Service', 'Infrastructure']);

      const ast2 = parseCypher('MATCH (n:Service:Infrastructure {name: "API"}) RETURN n.name AS name');
      e.invalidateIndexes();
      const results2 = e.execute(ast2);
      expect(results2.length).toBe(1);
    });
  });

  describe('label expressions', () => {
    it('MATCH with label union (|) returns nodes matching any label', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Movie', name: 'Inception' });
      g.addNode('b', { label: 'Person', name: 'Nolan' });
      g.addNode('c', { label: 'Studio', name: 'Warner' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n:Movie|Person) RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Inception', 'Nolan']);
    });

    it('MATCH with multiple label unions', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Movie', name: 'Inception' });
      g.addNode('b', { label: 'Person', name: 'Nolan' });
      g.addNode('c', { label: 'Actor', name: 'Crowe' });
      g.addNode('d', { label: 'Studio', name: 'Warner' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n:Movie|Person|Actor) RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Crowe', 'Inception', 'Nolan']);
    });

    it('MATCH with label negation (!) excludes nodes with that label', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Movie', name: 'Inception' });
      g.addNode('b', { label: 'Person', name: 'Nolan' });
      g.addNode('c', { label: 'Studio', name: 'Warner' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n:!Movie) RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Nolan', 'Warner']);
    });

    it('MATCH with label union and negation', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Movie', name: 'Inception' });
      g.addNode('b', { label: 'Person', name: 'Nolan' });
      g.addNode('c', { label: 'Actor', name: 'Crowe' });
      g.addNode('d', { label: 'Studio', name: 'Warner' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n:Movie|!Person) RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Crowe', 'Inception', 'Warner']);
    });

    it('MATCH with multiple label negations', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Movie', name: 'Inception' });
      g.addNode('b', { label: 'Person', name: 'Nolan' });
      g.addNode('c', { label: 'Actor', name: 'Crowe' });
      g.addNode('d', { label: 'Studio', name: 'Warner' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n:!Movie:!Person) RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['Crowe', 'Warner']);
    });

    it('MATCH with AND labels combined with OR labels', () => {
      const g = new Graph();
      g.addNode('a', { label: ['Service', 'Infrastructure'], name: 'API' });
      g.addNode('b', { label: 'Service', name: 'Auth' });
      g.addNode('c', { label: 'Infrastructure', name: 'Kafka' });
      g.addNode('d', { label: 'Database', name: 'Postgres' });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n:Service:Infrastructure|Database) RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['API', 'Postgres']);
    });

    it('MATCH with negation and property filter', () => {
      const g = new Graph();
      g.addNode('a', { label: 'Service', name: 'API', critical: true });
      g.addNode('b', { label: 'Service', name: 'Auth', critical: false });
      g.addNode('c', { label: 'Database', name: 'Postgres', critical: true });
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (n:!Database {critical: true}) RETURN n.name AS name ORDER BY n.name');
      const results = e.execute(ast);
      expect(results.map((r) => r.name)).toEqual(['API']);
    });

    it('MERGE with label union uses AND labels for creation', () => {
      const g = new Graph();
      const e = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MERGE (n:Movie|Person) RETURN n');
      const results = e.execute(ast);
      expect(results.length).toBe(1);
      const n = results[0]!.n as CypherNode;
      expect(n.label).toBe('Movie');
    });
  });
});
