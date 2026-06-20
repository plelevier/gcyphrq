// ── Public API for using gcyphrq as a library ────────────────────────────────

import { parseCypher as _parseCypher } from './engine/cypher-parser';
import { AdvancedCypherGraphologyEngine } from './engine/cypher-engine';
import { Graph, type GraphInstance } from './graph';
import type { AdvancedCypherAST, ResultRow } from './types/cypher';

// ── Graph file format types ──────────────────────────────────────────────────

export interface GraphFileNode {
  id: string;
  label?: string;
  [key: string]: unknown;
}

export interface GraphFileEdge {
  source: string;
  target: string;
  type?: string;
  [key: string]: unknown;
}

export interface GraphFile {
  nodes: GraphFileNode[];
  edges: GraphFileEdge[];
}

/**
 * Thrown when graph data validation fails or a query cannot be executed.
 */
export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

// ── Graph construction ───────────────────────────────────────────────────────

function validateGraphData(data: unknown): GraphFile {
  if (!data || typeof data !== 'object') {
    throw new GraphError('Invalid graph data: expected a JSON object with "nodes" and "edges" arrays.');
  }

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.nodes)) {
    throw new GraphError('Invalid graph data: "nodes" must be an array.');
  }
  if (!Array.isArray(obj.edges)) {
    throw new GraphError('Invalid graph data: "edges" must be an array.');
  }

  const seenNodeIds = new Set<string>();
  for (let i = 0; i < obj.nodes.length; i++) {
    const node = obj.nodes[i];
    if (!node || typeof node !== 'object') {
      throw new GraphError(`Invalid graph data: node at index ${i} must be an object.`);
    }
    const n = node as Record<string, unknown>;
    if (typeof n.id !== 'string' || !n.id) {
      throw new GraphError(`Invalid graph data: node at index ${i} must have a non-empty string "id".`);
    }
    if (seenNodeIds.has(n.id)) {
      throw new GraphError(`Invalid graph data: duplicate node id "${n.id}" at index ${i}.`);
    }
    seenNodeIds.add(n.id);
  }

  const nodeIds = seenNodeIds;
  const seenEdges = new Set<string>();

  for (let i = 0; i < obj.edges.length; i++) {
    const edge = obj.edges[i];
    if (!edge || typeof edge !== 'object') {
      throw new GraphError(`Invalid graph data: edge at index ${i} must be an object.`);
    }
    const e = edge as Record<string, unknown>;
    if (typeof e.source !== 'string' || !e.source) {
      throw new GraphError(`Invalid graph data: edge at index ${i} must have a non-empty string "source".`);
    }
    if (typeof e.target !== 'string' || !e.target) {
      throw new GraphError(`Invalid graph data: edge at index ${i} must have a non-empty string "target".`);
    }
    if (!nodeIds.has(e.source)) {
      throw new GraphError(`Invalid graph data: edge at index ${i} references unknown source node "${e.source}".`);
    }
    if (!nodeIds.has(e.target)) {
      throw new GraphError(`Invalid graph data: edge at index ${i} references unknown target node "${e.target}".`);
    }
    const edgeKey = `${e.source}->${e.target}`;
    if (seenEdges.has(edgeKey)) {
      throw new GraphError(`Invalid graph data: duplicate edge "${edgeKey}" at index ${i}. Graphology does not support multi-graphs.`);
    }
    seenEdges.add(edgeKey);
  }

  return {
    nodes: obj.nodes as GraphFileNode[],
    edges: obj.edges as GraphFileEdge[],
  };
}

/**
 * Build a `GraphInstance` from a graph data object.
 *
 * Validates the data and constructs a Graphology-backed graph that the
 * Cypher engine can query.
 *
 * @example
 * ```ts
 * import { createGraph } from 'gcyphrq';
 *
 * const graph = createGraph({
 *   nodes: [
 *     { id: 'alice', label: 'User', name: 'Alice' },
 *     { id: 'bob', label: 'User', name: 'Bob' },
 *   ],
 *   edges: [
 *     { source: 'alice', target: 'bob', type: 'FRIEND' },
 *   ],
 * });
 * ```
 *
 * @see https://graphology.github.io/
 */
export function createGraph(data: GraphFile): GraphInstance {
  const validated = validateGraphData(data);
  const graph = new Graph();

  for (const node of validated.nodes) {
    const { id, ...attrs } = node;
    graph.addNode(id, attrs);
  }

  for (const edge of validated.edges) {
    const { source, target, ...attrs } = edge;
    graph.addEdge(source, target, attrs);
  }

  return graph;
}

// ── Query execution ──────────────────────────────────────────────────────────

/**
 * Parse a Cypher query string into an AST.
 *
 * The returned AST can be passed to `GraphEngine.execute()` or inspected
 * programmatically.
 *
 * @example
 * ```ts
 * import { parseCypher } from 'gcyphrq';
 *
 * const ast = parseCypher('MATCH (u:User) RETURN u');
 * ```
 */
export function parseCypher(query: string): AdvancedCypherAST {
  return _parseCypher(query);
}

/**
 * Execute a Cypher query against a graph and return results as plain JSON.
 *
 * This is the simplest way to use gcyphrq: pass in graph data and a query
 * string, get back an array of result rows.
 *
 * @example
 * ```ts
 * import { executeQuery } from 'gcyphrq';
 *
 * const results = executeQuery(graphData, 'MATCH (u:User) RETURN u');
 * console.log(results); // [{ u: { id: 'alice', label: 'User', name: 'Alice' } }, ...]
 * ```
 *
 * @param graphData - Graph data in the Graphology JSON format
 * @param query - A Cypher query string
 * @returns Array of result rows
 * @throws {GraphError} If graph data is invalid
 * @throws {Error} If the query is invalid or cannot be executed
 */
export function executeQuery(graphData: GraphFile, query: string): ResultRow[] {
  const graph = createGraph(graphData);
  const engine = new AdvancedCypherGraphologyEngine(graph);
  const ast = _parseCypher(query);
  return engine.execute(ast);
}

// ── Re-exports ───────────────────────────────────────────────────────────────

/**
 * The Cypher query engine. Accepts a `GraphInstance` and executes parsed ASTs.
 *
 * @example
 * ```ts
 * import { GraphEngine, createGraph } from 'gcyphrq';
 *
 * const graph = createGraph(graphData);
 * const engine = new GraphEngine(graph);
 * const results = engine.execute(ast);
 * ```
 */
export { AdvancedCypherGraphologyEngine as GraphEngine };

/**
 * The Graphology wrapper class. Use this when you need to build a graph
 * programmatically (node-by-node) instead of from a data object.
 *
 * @example
 * ```ts
 * import { Graph, GraphEngine } from 'gcyphrq';
 *
 * const graph = new Graph();
 * graph.addNode('alice', { label: 'User', name: 'Alice' });
 * graph.addNode('bob', { label: 'User', name: 'Bob' });
 * graph.addEdge('alice', 'bob', { type: 'FRIEND' });
 *
 * const engine = new GraphEngine(graph);
 * ```
 */
export { Graph };

// ── Type re-exports ──────────────────────────────────────────────────────────

/**
 * @module gcyphrq
 *
 * A Cypher graph query engine for in-memory graphs built on Graphology.
 *
 * Can be used as a CLI tool or as a library in Node.js / TypeScript projects.
 *
 * @example
 * ```ts
 * import { executeQuery } from 'gcyphrq';
 *
 * const results = executeQuery(graphData, 'MATCH (u:User) RETURN u');
 * ```
 *
 * @see https://github.com/plelevier/gcyphrq
 * @see https://graphology.github.io/
 */

// Re-export GraphInstance from graph.ts for type-only use
export type { GraphInstance } from './graph';

// Re-export all AST, expression, and result types from types/cypher.ts
export type {
  AdvancedCypherAST,
  Stage,
  MatchClause,
  WithClause,
  ReturnClause,
  WriteClause,
  CreateClause,
  DeleteClause,
  SetClause,
  NodePattern,
  RelationPattern,
  Direction,
  Expression,
  PropertyAccessExpression,
  LiteralExpression,
  AggregationExpression,
  BinaryExpression,
  Projection,
  OrderByItem,
  ResultRow,
  QueryContext,
  CypherNode,
  CypherEdge,
  CypherValue,
  CypherLiteral,
} from './types/cypher';
