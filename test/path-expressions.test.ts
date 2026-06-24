import { describe, it, expect, beforeEach } from 'vitest';
import { Graph, type GraphInstance } from '../src/graph';
import { AdvancedCypherGraphologyEngine } from '../src/engine/cypher-engine';
import { parseCypher as _parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST } from '../src/types/cypher';
import { DEFAULT_CONFIG, type CypherNode, type CypherEdge, type GraphIndexes } from '../src/types/cypher';

const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;

function node<T extends Record<string, unknown>>(row: T, key: keyof T): CypherNode {
  return row[key] as CypherNode;
}

function buildIndexesFromGraph(graph: GraphInstance): GraphIndexes {
  const labelIndex = new Map<string, Set<string>>();
  const propertyIndex = new Map<string, Map<string, Set<string>>>();
  const edgeOut = new Map<string, Map<string, Array<{ target: string; edgeId: string }>>>();
  const edgeIn = new Map<string, Map<string, Array<{ source: string; edgeId: string }>>>();

  graph.filterNodes(() => true).forEach((id) => {
    const attrs = graph.getNodeAttributes(id);
    const rawLabel = attrs.label;
    if (typeof rawLabel === 'string') {
      let s = labelIndex.get(rawLabel);
      if (!s) { s = new Set(); labelIndex.set(rawLabel, s); }
      s.add(id);
    } else if (Array.isArray(rawLabel)) {
      for (const label of rawLabel) {
        if (typeof label !== 'string') continue;
        let s = labelIndex.get(label);
        if (!s) { s = new Set(); labelIndex.set(label, s); }
        s.add(id);
      }
    }
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'label' || value === null || value === undefined || typeof value === 'object') continue;
      let vm = propertyIndex.get(key);
      if (!vm) { vm = new Map(); propertyIndex.set(key, vm); }
      const vk = String(value);
      let ns = vm.get(vk);
      if (!ns) { ns = new Set(); vm.set(vk, ns); }
      ns.add(id);
    }
  });

  graph.forEachEdge((edgeId, attrs, source, target) => {
    const et = (attrs.type && typeof attrs.type === 'string') ? attrs.type : '__UNTYPED__';
    let om = edgeOut.get(et);
    if (!om) { om = new Map(); edgeOut.set(et, om); }
    let ol = om.get(source);
    if (!ol) { ol = []; om.set(source, ol); }
    ol.push({ target, edgeId });

    let im = edgeIn.get(et);
    if (!im) { im = new Map(); edgeIn.set(et, im); }
    let il = im.get(target);
    if (!il) { il = []; im.set(target, il); }
    il.push({ source, edgeId });
  });

  return { labelIndex, propertyIndex, edgeTypeIndex: { out: edgeOut, in: edgeIn }, config: DEFAULT_CONFIG };
}

/**
 * Create a graph with multiple paths between A and D:
 *
 *   A --FRIEND--> B --FRIEND--> D
 *   A --KNOWS-->  C --FRIEND--> D
 *   B --KNOWS-->  C
 *
 * Shortest path from A to D: A->B->D (2 hops) or A->C->D (2 hops)
 */
function createMultiPathGraph() {
  const graph = new Graph();

  graph.addNode('a', { label: 'User', name: 'Alice' });
  graph.addNode('b', { label: 'User', name: 'Bob' });
  graph.addNode('c', { label: 'User', name: 'Charlie' });
  graph.addNode('d', { label: 'User', name: 'Dave' });
  graph.addNode('e', { label: 'User', name: 'Eve' });

  graph.addEdge('a', 'b', { type: 'FRIEND' });
  graph.addEdge('b', 'c', { type: 'KNOWS' });
  graph.addEdge('b', 'd', { type: 'FRIEND' });
  graph.addEdge('a', 'c', { type: 'KNOWS' });
  graph.addEdge('c', 'd', { type: 'FRIEND' });
  // Eve is isolated
  graph.addEdge('d', 'e', { type: 'FRIEND' });

  return graph;
}

describe('Path expressions', () => {
  let graph: GraphInstance;
  let engine: AdvancedCypherGraphologyEngine;

  beforeEach(() => {
    graph = createMultiPathGraph();
    const indexes = buildIndexesFromGraph(graph);
    engine = new AdvancedCypherGraphologyEngine(graph, indexes);
  });

  describe('shortestPath', () => {
    it('returns the shortest path between two nodes', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*]->(d)) AS path',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(3); // Alice -> Bob -> Dave (or Alice -> Charlie -> Dave)
      expect(path.nodes[0]!.name).toBe('Alice');
      expect(path.nodes[path.nodes.length - 1]!.name).toBe('Dave');
      expect(path.relationships.length).toBe(2);
    });

    it('respects relationship type filter', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[:FRIEND*]->(d)) AS path',
      );
      const results = engine.execute(ast);
      // With only FRIEND edges: A->B->D (FRIEND, FRIEND)
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(3);
      expect(path.nodes[0]!.name).toBe('Alice');
      expect(path.nodes[path.nodes.length - 1]!.name).toBe('Dave');
      // All edges should be FRIEND
      for (const rel of path.relationships) {
        expect(rel.type).toBe('FRIEND');
      }
    });

    it('returns null when no path exists', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[:KNOWS*]->(d)) AS path',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      // A->C is KNOWS, but C->D is FRIEND, so no all-KNOWS path exists
      expect(results[0]!.path).toBeNull();
    });

    it('handles same source and target', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) RETURN shortestPath((a)-[*]->(a)) AS path',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(1);
      expect(path.nodes[0]!.name).toBe('Alice');
      expect(path.relationships.length).toBe(0);
    });

    it('respects direction OUT', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*]->(d)) AS path',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(3);
    });

    it('respects direction IN (reverse traversal)', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)<-[*]-(d)) AS path',
      );
      const results = engine.execute(ast);
      // (a)<-[*]-(d) means traverse from a following IN edges, i.e., from d to a
      // Dave has no inbound edges, so no path exists via IN from Alice
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('respects undirected direction', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*]-(d)) AS path',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(3);
    });

    it('respects min depth constraint', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*3..]->(d)) AS path',
      );
      const results = engine.execute(ast);
      // Shortest path is 2 hops, but min is 3 — should return null
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('respects max depth constraint', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*1..1]->(d)) AS path',
      );
      const results = engine.execute(ast);
      // Shortest path is 2 hops, but max is 1 — should return null
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('returns null when source variable is unbound', () => {
      const ast = parseCypher(
        'MATCH (d:User {name: "Dave"}) RETURN shortestPath((x)-[*]->(d)) AS path',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('returns null when target variable is unbound', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) RETURN shortestPath((a)-[*]->(x)) AS path',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('supports AS alias', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*]->(d)) AS shortest',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.shortest).toBeDefined();
      expect(results[0]!.shortest).not.toBeNull();
    });

    it('path object has correct structure', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*]->(d)) AS path',
      );
      const results = engine.execute(ast);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(Array.isArray(path.nodes)).toBe(true);
      expect(Array.isArray(path.relationships)).toBe(true);
      for (const n of path.nodes) {
        expect(n.id).toBeDefined();
        expect(typeof n.id).toBe('string');
      }
      for (const r of path.relationships) {
        expect(r.id).toBeDefined();
        expect(r.source).toBeDefined();
        expect(r.target).toBeDefined();
      }
    });
  });

  describe('allShortestPaths', () => {
    it('returns all shortest paths between two nodes', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((a)-[*]->(d)) AS paths',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as { nodes: CypherNode[]; relationships: CypherEdge[] }[];
      expect(Array.isArray(paths)).toBe(true);
      // There are at least 2 shortest paths of length 2: A->B->D and A->C->D
      expect(paths.length).toBeGreaterThanOrEqual(2);
      for (const path of paths) {
        expect(path.nodes.length).toBe(3);
        expect(path.nodes[0]!.name).toBe('Alice');
        expect(path.nodes[path.nodes.length - 1]!.name).toBe('Dave');
      }
    });

    it('returns empty array when no path exists', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((a)-[:KNOWS*]->(d)) AS paths',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown[];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBe(0);
    });

    it('respects relationship type filter', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((a)-[:FRIEND*]->(d)) AS paths',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as { nodes: CypherNode[]; relationships: CypherEdge[] }[];
      // Only FRIEND edges: A->B->D is the only shortest path
      expect(paths.length).toBeGreaterThanOrEqual(1);
      for (const path of paths) {
        for (const rel of path.relationships) {
          expect(rel.type).toBe('FRIEND');
        }
      }
    });

    it('handles same source and target', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) RETURN allShortestPaths((a)-[*]->(a)) AS paths',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as { nodes: CypherNode[]; relationships: CypherEdge[] }[];
      expect(paths.length).toBe(1);
      expect(paths[0]!.nodes.length).toBe(1);
      expect(paths[0]!.relationships.length).toBe(0);
    });

    it('returns empty array when source variable is unbound', () => {
      const ast = parseCypher(
        'MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((x)-[*]->(d)) AS paths',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown[];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBe(0);
    });

    it('returns empty array when target variable is unbound', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) RETURN allShortestPaths((a)-[*]->(x)) AS paths',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown[];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBe(0);
    });

    it('respects undirected direction', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((a)-[*]-(d)) AS paths',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as { nodes: CypherNode[]; relationships: CypherEdge[] }[];
      expect(paths.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('in WHERE clause', () => {
    it('filters with IS NOT NULL', () => {
      const ast = parseCypher(
        'MATCH (a:User) MATCH (b:User) WHERE shortestPath((a)-[*]->(b)) IS NOT NULL RETURN a.name, b.name',
      );
      const results = engine.execute(ast);
      // Should return pairs where a path exists
      expect(results.length).toBeGreaterThan(0);
      // All pairs should have distinct names (no self-pairs since same-node returns a path)
    });

    it('filters with IS NULL', () => {
      const ast = parseCypher(
        'MATCH (a:User) MATCH (b:User) WHERE shortestPath((a)-[:KNOWS*]->(b)) IS NULL RETURN a.name, b.name',
      );
      const results = engine.execute(ast);
      // Should return pairs where no all-KNOWS path exists
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('in WITH clause', () => {
    it('can be used in WITH projection', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) WITH shortestPath((a)-[*]->(d)) AS path RETURN path',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).not.toBeNull();
    });
  });

  describe('with node labels in pattern', () => {
    it('works with labeled nodes in pattern', () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a:User)-[*]->(d:User)) AS path',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).not.toBeNull();
    });
  });

  describe('complex graph', () => {
    it('finds shortest path in a linear chain', () => {
      const graph = new Graph();
      graph.addNode('1', { label: 'Node', val: 1 });
      graph.addNode('2', { label: 'Node', val: 2 });
      graph.addNode('3', { label: 'Node', val: 3 });
      graph.addNode('4', { label: 'Node', val: 4 });
      graph.addEdge('1', '2', { type: 'NEXT' });
      graph.addEdge('2', '3', { type: 'NEXT' });
      graph.addEdge('3', '4', { type: 'NEXT' });

      const indexes = buildIndexesFromGraph(graph);
      const engine = new AdvancedCypherGraphologyEngine(graph, indexes);
      const ast = parseCypher(
        'MATCH (a:Node {val: 1}) MATCH (d:Node {val: 4}) RETURN shortestPath((a)-[*]->(d)) AS path',
      );
      const results = engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(4);
      expect(path.relationships.length).toBe(3);
    });
  });
});
