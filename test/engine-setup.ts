import { Graph, type GraphInstance } from '../src/graph';
import { AdvancedCypherGraphologyEngine } from '../src/engine/cypher-engine';
import { parseCypher as _parseCypher } from '../src/engine/cypher-parser';
import type { AdvancedCypherAST, CypherNode, CypherEdge } from '../src/types/cypher';
import { buildIndexesFromGraph, node } from './helpers';

export const parseCypher = _parseCypher as (query: string) => AdvancedCypherAST;
export type { AdvancedCypherAST, CypherNode, CypherEdge, GraphInstance };
export { Graph, AdvancedCypherGraphologyEngine, buildIndexesFromGraph, node };

export function createTestGraph() {
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

export function createEngine(graph: GraphInstance) {
  return new AdvancedCypherGraphologyEngine(graph);
}
