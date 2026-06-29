import { describe, it, expect, beforeEach } from 'vitest';
import { Graph, type GraphInstance } from '../src/graph';
import { AdvancedCypherGraphologyEngine } from '../src/engine/cypher-engine';
import { parseCypher as _parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST, CypherNode, CypherEdge } from '../src/types/cypher';
import { buildIndexesFromGraph, node } from './helpers';

const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;

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
    it('returns the shortest path between two nodes', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(3); // Alice -> Bob -> Dave (or Alice -> Charlie -> Dave)
      expect(path.nodes[0]!.name).toBe('Alice');
      expect(path.nodes[path.nodes.length - 1]!.name).toBe('Dave');
      expect(path.relationships.length).toBe(2);
    });

    it('respects relationship type filter', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[:FRIEND*]->(d)) AS path',
      );
      const results = await engine.execute(ast);
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

    it('returns null when no path exists', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[:KNOWS*]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      // A->C is KNOWS, but C->D is FRIEND, so no all-KNOWS path exists
      expect(results[0]!.path).toBeNull();
    });

    it('handles same source and target', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) RETURN shortestPath((a)-[*]->(a)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(1);
      expect(path.nodes[0]!.name).toBe('Alice');
      expect(path.relationships.length).toBe(0);
    });

    it('respects direction OUT', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(3);
    });

    it('respects direction IN (reverse traversal)', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)<-[*]-(d)) AS path',
      );
      const results = await engine.execute(ast);
      // (a)<-[*]-(d) means traverse from a following IN edges, i.e., from d to a
      // Dave has no inbound edges, so no path exists via IN from Alice
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('respects undirected direction', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*]-(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(3);
    });

    it('respects min depth constraint', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*3..]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      // Shortest path is 2 hops, but min is 3 — should return null
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('respects max depth constraint', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*1..1]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      // Shortest path is 2 hops, but max is 1 — should return null
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('returns null when source variable is unbound', async () => {
      const ast = parseCypher(
        'MATCH (d:User {name: "Dave"}) RETURN shortestPath((x)-[*]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('returns null when target variable is unbound', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) RETURN shortestPath((a)-[*]->(x)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('supports AS alias', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*]->(d)) AS shortest',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.shortest).toBeDefined();
      expect(results[0]!.shortest).not.toBeNull();
    });

    it('path object has correct structure', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*]->(d)) AS path',
      );
      const results = await engine.execute(ast);
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
    it('returns all shortest paths between two nodes', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((a)-[*]->(d)) AS paths',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown as { nodes: CypherNode[]; relationships: CypherEdge[] }[];
      expect(Array.isArray(paths)).toBe(true);
      // There are at least 2 shortest paths of length 2: A->B->D and A->C->D
      expect(paths.length).toBeGreaterThanOrEqual(2);
      for (const path of paths) {
        expect(path.nodes.length).toBe(3);
        expect(path.nodes[0]!.name).toBe('Alice');
        expect(path.nodes[path.nodes.length - 1]!.name).toBe('Dave');
      }
    });

    it('returns empty array when no path exists', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((a)-[:KNOWS*]->(d)) AS paths',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown as unknown[];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBe(0);
    });

    it('respects relationship type filter', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((a)-[:FRIEND*]->(d)) AS paths',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown as { nodes: CypherNode[]; relationships: CypherEdge[] }[];
      // Only FRIEND edges: A->B->D is the only shortest path
      expect(paths.length).toBeGreaterThanOrEqual(1);
      for (const path of paths) {
        for (const rel of path.relationships) {
          expect(rel.type).toBe('FRIEND');
        }
      }
    });

    it('handles same source and target', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) RETURN allShortestPaths((a)-[*]->(a)) AS paths',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown as { nodes: CypherNode[]; relationships: CypherEdge[] }[];
      expect(paths.length).toBe(1);
      expect(paths[0]!.nodes.length).toBe(1);
      expect(paths[0]!.relationships.length).toBe(0);
    });

    it('returns empty array when source variable is unbound', async () => {
      const ast = parseCypher(
        'MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((x)-[*]->(d)) AS paths',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown as unknown[];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBe(0);
    });

    it('returns empty array when target variable is unbound', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) RETURN allShortestPaths((a)-[*]->(x)) AS paths',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown as unknown[];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBe(0);
    });

    it('respects undirected direction', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((a)-[*]-(d)) AS paths',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown as { nodes: CypherNode[]; relationships: CypherEdge[] }[];
      expect(paths.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('in WHERE clause', () => {
    it('filters with IS NOT NULL', async () => {
      const ast = parseCypher(
        'MATCH (a:User) MATCH (b:User) WHERE shortestPath((a)-[*]->(b)) IS NOT NULL RETURN a.name, b.name',
      );
      const results = await engine.execute(ast);
      // Should return pairs where a path exists
      expect(results.length).toBeGreaterThan(0);
      // All pairs should have distinct names (no self-pairs since same-node returns a path)
    });

    it('filters with IS NULL', async () => {
      const ast = parseCypher(
        'MATCH (a:User) MATCH (b:User) WHERE shortestPath((a)-[:KNOWS*]->(b)) IS NULL RETURN a.name, b.name',
      );
      const results = await engine.execute(ast);
      // Should return pairs where no all-KNOWS path exists
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('in WITH clause', () => {
    it('can be used in WITH projection', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) WITH shortestPath((a)-[*]->(d)) AS path RETURN path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).not.toBeNull();
    });
  });

  describe('with node labels in pattern', () => {
    it('works with labeled nodes in pattern', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a:User)-[*]->(d:User)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).not.toBeNull();
    });
  });

  describe('IN direction with valid path', () => {
    // Graph: a->b FRIEND, b->d FRIEND, a->c KNOWS, c->d FRIEND
    // IN direction from d: d has inbound from b and c; b has inbound from a
    it('shortestPath with IN direction finds path', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((d)<-[*]-(a)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path).not.toBeNull();
      expect(path.nodes.length).toBe(3);
      // Path starts at d (source of path expression) and ends at a
      expect(path.nodes[0]!.name).toBe('Dave');
      expect(path.nodes[path.nodes.length - 1]!.name).toBe('Alice');
      expect(path.relationships.length).toBe(2);
    });

    it('allShortestPaths with IN direction finds all paths', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((d)<-[*]-(a)) AS paths',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown as { nodes: CypherNode[]; relationships: CypherEdge[] }[];
      expect(Array.isArray(paths)).toBe(true);
      // Two shortest paths: d<-b<-a and d<-c<-a
      expect(paths.length).toBeGreaterThanOrEqual(2);
      for (const path of paths) {
        expect(path.nodes.length).toBe(3);
        expect(path.nodes[0]!.name).toBe('Dave');
        expect(path.nodes[path.nodes.length - 1]!.name).toBe('Alice');
      }
    });

    it('IN direction with type filter', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((d)<-[:FRIEND*]-(a)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      // d<-b<-a: b->d is FRIEND, a->b is FRIEND. Both are FRIEND.
      // d<-c<-a: c->d is FRIEND, a->c is KNOWS. Not all FRIEND.
      // So only d<-b<-a qualifies
      expect(path).not.toBeNull();
      expect(path.nodes.length).toBe(3);
      for (const rel of path.relationships) {
        expect(rel.type).toBe('FRIEND');
      }
    });
  });

  describe('depth bounds', () => {
    it('*0..0 with same node returns single-node path', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) RETURN shortestPath((a)-[*0..0]->(a)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(1);
      expect(path.relationships.length).toBe(0);
    });

    it('*0..0 with different nodes returns null', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*0..0]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('*1..1 returns direct edge path', async () => {
      // Alice and Bob have a direct FRIEND edge
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (b:User {name: "Bob"}) RETURN shortestPath((a)-[*1..1]->(b)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(2);
      expect(path.relationships.length).toBe(1);
    });

    it('*1..1 returns null when no direct edge', async () => {
      // Alice and Dave have no direct edge (path is 2 hops)
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*1..1]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('*2..2 returns exactly 2-hop path', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*2..2]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(3);
      expect(path.relationships.length).toBe(2);
    });

    it('*2..2 returns null when shortest path is 1 hop', async () => {
      // Alice and Bob have a direct edge (1 hop), so *2..2 should return null
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (b:User {name: "Bob"}) RETURN shortestPath((a)-[*2..2]->(b)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('allShortestPaths *1..1 returns empty when no direct edge', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN allShortestPaths((a)-[*1..1]->(d)) AS paths',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const paths = results[0]!.paths as unknown as unknown[];
      expect(paths.length).toBe(0);
    });

    it('*3.. (open-ended max) finds path within min depth', async () => {
      // Alice->Bob->Dave is 2 hops, *3.. requires min 3 hops so should return null
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*3..]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('*1.. (open-ended max) finds shortest path', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*1..]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(3);
      expect(path.relationships.length).toBe(2);
    });

    it('*..1 (open-ended min) with direct edge returns path', async () => {
      // Alice and Bob have a direct edge (1 hop), *..1 allows 0..1 hops
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (b:User {name: "Bob"}) RETURN shortestPath((a)-[*..1]->(b)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(2);
      expect(path.relationships.length).toBe(1);
    });

    it('*..1 (open-ended min) returns null when shortest path exceeds max', async () => {
      // Alice to Dave is 2 hops, but *..1 caps at 1
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*..1]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('* (unbounded) finds shortest path', async () => {
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (e:User {name: "Eve"}) RETURN shortestPath((a)-[*]->(e)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      // Alice->Bob->Dave->Eve (3 hops)
      expect(path.nodes.length).toBe(4);
      expect(path.relationships.length).toBe(3);
    });

    it('*2 (exact depth, no ..) returns 2-hop path', async () => {
      // Alice->Bob->Dave is 2 hops, so *2 should match
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*2]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(3);
      expect(path.relationships.length).toBe(2);
    });

    it('*3 (exact depth, no ..) returns null when shortest path is 2 hops', async () => {
      // Alice->Bob->Dave is 2 hops, so *3 (exactly 3) should not match
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (d:User {name: "Dave"}) RETURN shortestPath((a)-[*3]->(d)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      expect(results[0]!.path).toBeNull();
    });

    it('*3 (exact depth, no ..) finds 3-hop path', async () => {
      // Alice->Bob->Dave->Eve is 3 hops, so *3 should match
      const ast = parseCypher(
        'MATCH (a:User {name: "Alice"}) MATCH (e:User {name: "Eve"}) RETURN shortestPath((a)-[*3]->(e)) AS path',
      );
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(4);
      expect(path.relationships.length).toBe(3);
    });

    it('MATCH with *2 (exact depth) returns only 2-hop pairs', async () => {
      const ast = parseCypher('MATCH (a:User)-[*2]->(b:User) RETURN a.name, b.name');
      const results = await engine.execute(ast);
      expect(results.length).toBeGreaterThan(0);
      // Alice->Dave is 2 hops, Alice->Eve is 3 hops, Bob->Eve is 2 hops
      const pairs = results.map((r) => `${r['a.name']}->${r['b.name']}`);
      expect(pairs).toContain('Alice->Dave');
      expect(pairs).not.toContain('Alice->Eve');
    });
  });

  describe('complex graph', () => {
    it('finds shortest path in a linear chain', async () => {
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
      const results = await engine.execute(ast);
      expect(results.length).toBe(1);
      const path = results[0]!.path as { nodes: CypherNode[]; relationships: CypherEdge[] };
      expect(path.nodes.length).toBe(4);
      expect(path.relationships.length).toBe(3);
    });
  });

  describe('MATCH with open-ended ranges', () => {
    // Graph: a->b FRIEND, b->c KNOWS, b->d FRIEND, a->c KNOWS, c->d FRIEND, d->e FRIEND
    it('bare * matches all reachable pairs', async () => {
      const warnings: string[] = [];
      const engineWithWarnings = new AdvancedCypherGraphologyEngine(graph, indexes, (w) => warnings.push(w));
      const ast = parseCypher('MATCH (a:User)-[*]->(b:User) RETURN a.name, b.name');
      const results = await engineWithWarnings.execute(ast);
      // a->b, a->c, a->d, a->e, b->c, b->d, c->d, d->e = 8 pairs
      expect(results.length).toBeGreaterThan(5);
    });

    it('regular MATCH (no *) matches only direct edges', async () => {
      const ast = parseCypher('MATCH (a:User)-[r:FRIEND]->(b:User) RETURN a.name, b.name');
      const results = await engine.execute(ast);
      // a->b FRIEND, b->d FRIEND, c->d FRIEND, d->e FRIEND = 4 pairs
      expect(results.length).toBe(4);
    });

    it('*2.. matches paths of length >= 2', async () => {
      const warnings: string[] = [];
      const engineWithWarnings = new AdvancedCypherGraphologyEngine(graph, indexes, (w) => warnings.push(w));
      const ast = parseCypher('MATCH (a:User)-[*2..]->(b:User) RETURN a.name, b.name');
      const results = await engineWithWarnings.execute(ast);
      // Only pairs reachable in 2+ hops
      expect(results.length).toBeGreaterThan(0);
      // Alice->Dave (via Bob or Charlie) is 2 hops, Alice->Eve is 3 hops
      const pairs = results.map((r) => `${r['a.name']}->${r['b.name']}`);
      expect(pairs).toContain('Alice->Dave');
      expect(pairs).toContain('Alice->Eve');
      // Dave->Eve is direct (1 hop), should not appear
      expect(pairs).not.toContain('Dave->Eve');
    });

    it('*..1 matches only direct edges (max 1 hop)', async () => {
      const ast = parseCypher('MATCH (a:User)-[*..1]->(b:User) RETURN a.name, b.name');
      const results = await engine.execute(ast);
      // Same as regular MATCH (all direct edges): 6 edges in graph
      expect(results.length).toBe(6);
    });
  });
});
