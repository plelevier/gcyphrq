import { describe, it, expect } from 'vitest';
import { parseCypher, Graph, AdvancedCypherGraphologyEngine, buildIndexesFromGraph } from './engine-setup';
import { DEFAULT_MAX_VAR_LENGTH_DEPTH, DEFAULT_MAX_VAR_LENGTH_PATHS } from '../src/types/cypher';
import type { ResultRow } from '../src/types/cypher';

describe('Variable-length optimization', () => {
  describe('default max depth', () => {
    it('uses DEFAULT_MAX_VAR_LENGTH_DEPTH for unbounded [*1..] patterns', async () => {
      // Build a chain graph: A -> B -> C -> D -> E -> F -> G -> H -> I -> J -> K -> L
      const g = new Graph();
      const nodes = 'ABCDEFGHIJKL'.split('');
      for (const n of nodes) g.addNode(n, { label: 'Node', name: n });
      for (let i = 0; i < nodes.length - 1; i++) {
        g.addEdge(nodes[i]!, nodes[i + 1]!, { type: 'NEXT' });
      }
      const indexes = buildIndexesFromGraph(g);
      const engine = new AdvancedCypherGraphologyEngine(g, indexes);

      // With default maxDepth=10, from A we can reach up to K (10 hops)
      // L is 11 hops away, so should NOT be reached
      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:NEXT*1..]->(b:Node) RETURN a.name, b.name ORDER BY b.name ASC');
      const results = await engine.execute(ast);

      // Should reach B through K (10 nodes), but NOT L (11 hops)
      const targetNames = results.map((r: ResultRow) => r['b.name']).sort();
      expect(targetNames).toEqual(['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);
      expect(results.length).toBe(10);
    });

    it('respects explicit upper bound even if larger than default', async () => {
      const g = new Graph();
      const nodes = 'ABCDEFGHIJKL'.split('');
      for (const n of nodes) g.addNode(n, { label: 'Node', name: n });
      for (let i = 0; i < nodes.length - 1; i++) {
        g.addEdge(nodes[i]!, nodes[i + 1]!, { type: 'NEXT' });
      }
      const indexes = buildIndexesFromGraph(g);
      const engine = new AdvancedCypherGraphologyEngine(g, indexes);

      // Explicit [*1..15] should reach all nodes including L
      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:NEXT*1..15]->(b:Node) RETURN a.name, b.name ORDER BY b.name ASC');
      const results = await engine.execute(ast);
      const targetNames = results.map((r: ResultRow) => r['b.name']).sort();
      expect(targetNames).toEqual(['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']);
    });

    it('[*0..] includes the start node itself when it matches target pattern', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addNode('b', { label: 'Node', name: 'B' });
      g.addEdge('a', 'b', { type: 'NEXT' });
      const indexes = buildIndexesFromGraph(g);
      const engine = new AdvancedCypherGraphologyEngine(g, indexes);

      // [*0..] from A should include A itself (0 hops) plus B (1 hop)
      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:NEXT*0..]->(b:Node) RETURN a.name, b.name ORDER BY b.name ASC');
      const results = await engine.execute(ast);
      const targetNames = results.map((r: ResultRow) => r['b.name']).sort();
      expect(targetNames).toEqual(['A', 'B']);
    });
  });

  describe('path limit', () => {
    it('emits warning and stops when path limit is exceeded', async () => {
      // Build a dense graph: 10 nodes fully connected (directed)
      // Simple paths from one node: ~362K (far exceeds 100K limit)
      const g = new Graph();
      const nodes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
      for (const n of nodes) g.addNode(n, { label: 'Node', name: n });
      for (const s of nodes) {
        for (const t of nodes) {
          if (s !== t) g.addEdge(s, t, { type: 'LINK' });
        }
      }
      const indexes = buildIndexesFromGraph(g);
      const warnings: string[] = [];
      const engine = new AdvancedCypherGraphologyEngine(g, indexes, (w) => warnings.push(w));

      // [*1..9] on a 10-node fully connected graph produces ~362K paths
      // Should trigger the path limit warning
      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..9]->(b:Node) RETURN a.name, b.name');
      const results = await engine.execute(ast);

      // Should have emitted a warning about path limit
      const pathLimitWarning = warnings.find((w) => w.includes('paths limit'));
      expect(pathLimitWarning).toBeDefined();

      // Results should be capped at the limit
      expect(results.length).toBeLessThanOrEqual(DEFAULT_MAX_VAR_LENGTH_PATHS);
    });
  });

  describe('config overrides', () => {
    it('respects custom maxVariableLengthDepth via config', async () => {
      const g = new Graph();
      const nodes = 'ABCDEFGHIJKL'.split('');
      for (const n of nodes) g.addNode(n, { label: 'Node', name: n });
      for (let i = 0; i < nodes.length - 1; i++) {
        g.addEdge(nodes[i]!, nodes[i + 1]!, { type: 'NEXT' });
      }
      const indexes = buildIndexesFromGraph(g);
      const config = { labelProperty: 'label', edgeTypeProperty: 'type', maxVariableLengthDepth: 5 };
      const engine = new AdvancedCypherGraphologyEngine(g, { ...indexes, config }, undefined, new Map(), new Map());

      // With maxVariableLengthDepth=5, from A we can reach up to F (5 hops)
      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:NEXT*1..]->(b:Node) RETURN a.name, b.name ORDER BY b.name ASC');
      const results = await engine.execute(ast);
      const targetNames = results.map((r: ResultRow) => r['b.name']).sort();
      expect(targetNames).toEqual(['B', 'C', 'D', 'E', 'F']);
    });

    it('respects custom maxVariableLengthPaths via config', async () => {
      // Build a dense graph: 8 nodes fully connected (directed)
      // ~13.5K simple paths from one node — exceeds a custom limit of 5K
      const g = new Graph();
      const nodes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
      for (const n of nodes) g.addNode(n, { label: 'Node', name: n });
      for (const s of nodes) {
        for (const t of nodes) {
          if (s !== t) g.addEdge(s, t, { type: 'LINK' });
        }
      }
      const indexes = buildIndexesFromGraph(g);
      const config = { labelProperty: 'label', edgeTypeProperty: 'type', maxVariableLengthPaths: 5_000 };
      const warnings: string[] = [];
      const engine = new AdvancedCypherGraphologyEngine(g, { ...indexes, config }, (w) => warnings.push(w), new Map(), new Map());

      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..7]->(b:Node) RETURN a.name, b.name');
      const results = await engine.execute(ast);

      const pathLimitWarning = warnings.find((w) => w.includes('paths limit'));
      expect(pathLimitWarning).toBeDefined();
      expect(results.length).toBeLessThanOrEqual(5_000);
    });
  });

  describe('unbounded pattern warning', () => {
    it('emits a warning for unbounded [*1..] patterns', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addNode('b', { label: 'Node', name: 'B' });
      g.addEdge('a', 'b', { type: 'LINK' });
      const indexes = buildIndexesFromGraph(g);
      const warnings: string[] = [];
      const engine = new AdvancedCypherGraphologyEngine(g, indexes, (w) => warnings.push(w));

      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..]->(b:Node) RETURN a.name, b.name');
      await engine.execute(ast);

      const unboundedWarning = warnings.find((w) => w.includes('Unbounded variable-length pattern'));
      expect(unboundedWarning).toBeDefined();
      expect(unboundedWarning).toContain(String(DEFAULT_MAX_VAR_LENGTH_DEPTH));
    });

    it('does NOT warn for bounded [*1..3] patterns', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addNode('b', { label: 'Node', name: 'B' });
      g.addEdge('a', 'b', { type: 'LINK' });
      const indexes = buildIndexesFromGraph(g);
      const warnings: string[] = [];
      const engine = new AdvancedCypherGraphologyEngine(g, indexes, (w) => warnings.push(w));

      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..3]->(b:Node) RETURN a.name, b.name');
      await engine.execute(ast);

      const unboundedWarning = warnings.find((w) => w.includes('Unbounded variable-length pattern'));
      expect(unboundedWarning).toBeUndefined();
    });

    it('does NOT warn for single-hop patterns', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addNode('b', { label: 'Node', name: 'B' });
      g.addEdge('a', 'b', { type: 'LINK' });
      const indexes = buildIndexesFromGraph(g);
      const warnings: string[] = [];
      const engine = new AdvancedCypherGraphologyEngine(g, indexes, (w) => warnings.push(w));

      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK]->(b:Node) RETURN a.name, b.name');
      await engine.execute(ast);

      const unboundedWarning = warnings.find((w) => w.includes('variable-length'));
      expect(unboundedWarning).toBeUndefined();
    });

    it('emits a warning for unbounded [*1..] in pattern comprehensions', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addNode('b', { label: 'Node', name: 'B' });
      g.addEdge('a', 'b', { type: 'LINK' });
      const indexes = buildIndexesFromGraph(g);
      const warnings: string[] = [];
      const engine = new AdvancedCypherGraphologyEngine(g, indexes, (w) => warnings.push(w));

      const ast = parseCypher('MATCH (a:Node {name: "A"}) RETURN [(a)-[r:LINK*1..]->(b:Node) | b.name] AS neighbors');
      await engine.execute(ast);

      const unboundedWarning = warnings.find((w) => w.includes('Unbounded variable-length pattern'));
      expect(unboundedWarning).toBeDefined();
      expect(unboundedWarning).toContain('pattern comprehension');
    });
  });

  describe('diamond graph still finds all paths', () => {
    it('finds all three paths with [*1..2] (regression: pruning must not break this)', async () => {
      const g = new Graph();
      g.addNode('a', { label: 'Node', name: 'A' });
      g.addNode('b', { label: 'Node', name: 'B' });
      g.addNode('c', { label: 'Node', name: 'C' });
      g.addNode('d', { label: 'Node', name: 'D' });
      g.addEdge('a', 'd', { type: 'LINK' });
      g.addEdge('a', 'b', { type: 'LINK' });
      g.addEdge('b', 'd', { type: 'LINK' });
      g.addEdge('a', 'c', { type: 'LINK' });
      g.addEdge('c', 'd', { type: 'LINK' });
      const engine = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..2]->(d:Node {name: "D"}) RETURN a, d');
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
    });

    it('finds all paths in complex diamond with [*1..3]', async () => {
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
      const engine = new AdvancedCypherGraphologyEngine(g);

      const ast = parseCypher('MATCH (a:Node {name: "A"})-[r:LINK*1..3]->(d:Node {name: "D"}) RETURN a, d');
      const results = await engine.execute(ast);
      expect(results.length).toBe(3);
    });
  });
});
