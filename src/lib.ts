// ── Public API for using gcyphrq as a library ────────────────────────────────

import { parseCypher as _parseCypher } from './engine/cypher-parser';
import { AdvancedCypherGraphologyEngine } from './engine/cypher-engine';
import { Graph, type GraphInstance } from './graph';
import type { AdvancedCypherAST, ResultRow, GraphIndexes } from './types/cypher';

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

// ── Index construction ───────────────────────────────────────────────────────

/**
 * Build pre-computed indexes from validated graph data and a constructed graph.
 *
 * Indexes enable O(1) label/property lookups and typed adjacency traversal,
 * avoiding full-graph scans during query execution.
 *
 * The graph instance is required to get real Graphology edge IDs for the
 * edge-type adjacency index.
 */
function buildGraphIndexesInternal(data: GraphFile, graph: GraphInstance): GraphIndexes {
  const labelIndex = new Map<string, Set<string>>();
  const propertyIndex = new Map<string, Map<string, Set<string>>>();
  const edgeOut = new Map<string, Map<string, Array<{ target: string; edgeId: string }>>>();
  const edgeIn = new Map<string, Map<string, Array<{ source: string; edgeId: string }>>>();

  for (const node of data.nodes) {
    const { id, label, ...props } = node;

    // Label index
    if (label && typeof label === 'string') {
      if (!labelIndex.has(label)) labelIndex.set(label, new Set());
      labelIndex.get(label)!.add(id);
    }

    // Property index (index all non-id, non-label scalar properties)
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || typeof value === 'object') continue;
      if (!propertyIndex.has(key)) propertyIndex.set(key, new Map());
      const valMap = propertyIndex.get(key)!;
      const valKey = String(value);
      if (!valMap.has(valKey)) valMap.set(valKey, new Set());
      valMap.get(valKey)!.add(id);
    }
  }

  // Edge type adjacency index — iterate the graph to get real Graphology edge IDs
  graph.forEachEdge((edgeId, attrs, source, target) => {
    const edgeType = (attrs.type && typeof attrs.type === 'string') ? attrs.type : '__UNTYPED__';

    // Outgoing: source → [target]
    if (!edgeOut.has(edgeType)) edgeOut.set(edgeType, new Map());
    const outMap = edgeOut.get(edgeType)!;
    if (!outMap.has(source)) outMap.set(source, []);
    outMap.get(source)!.push({ target, edgeId });

    // Incoming: target → [source]
    if (!edgeIn.has(edgeType)) edgeIn.set(edgeType, new Map());
    const inMap = edgeIn.get(edgeType)!;
    if (!inMap.has(target)) inMap.set(target, []);
    inMap.get(target)!.push({ source, edgeId });
  });

  return {
    labelIndex,
    propertyIndex,
    edgeTypeIndex: { out: edgeOut, in: edgeIn },
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

/**
 * Build pre-computed indexes from graph data for fast query execution.
 *
 * Pass the returned indexes to `GraphEngine` constructor for O(1) label
 * and property lookups instead of full-graph scans.
 *
 * @example
 * ```ts
 * import { buildGraphIndexes, GraphEngine, createGraph } from 'gcyphrq';
 *
 * const graph = createGraph(graphData);
 * const indexes = buildGraphIndexes(graphData, graph);
 * const engine = new GraphEngine(graph, indexes);
 * ```
 */
export function buildGraphIndexes(data: GraphFile, graph: GraphInstance): GraphIndexes {
  const validated = validateGraphData(data);
  return buildGraphIndexesInternal(validated, graph);
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
 * string, get back an array of result rows. Indexes are built automatically.
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
  const validated = validateGraphData(graphData);
  const graph = createGraph(graphData);
  const indexes = buildGraphIndexesInternal(validated, graph);
  const engine = new AdvancedCypherGraphologyEngine(graph, indexes);
  const ast = _parseCypher(query);
  return engine.execute(ast);
}

// ── Re-exports ───────────────────────────────────────────────────────────────

/**
 * The Cypher query engine. Accepts a `GraphInstance` and executes parsed ASTs.
 *
 * For best performance, pass pre-computed indexes as the second argument.
 *
 * @example
 * ```ts
 * import { GraphEngine, createGraph, buildGraphIndexes } from 'gcyphrq';
 *
 * const graph = createGraph(graphData);
 * const indexes = buildGraphIndexes(graphData, graph);
 * const engine = new GraphEngine(graph, indexes);
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

// Re-export GraphIndexes for consumers who build indexes manually
export type { GraphIndexes } from './types/cypher';

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
