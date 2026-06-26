// ── Public API for using gcyphrq as a library ────────────────────────────────

import { parseCypher as _parseCypher } from './engine/cypher-parser';
import { AdvancedCypherGraphologyEngine } from './engine/cypher-engine';
import { explainQuery as _explainQuery } from './engine/explain';
import { buildGraphIndexesFromData, buildGraphIndexesFromGraph } from './indexes';
import { Graph, wrapExternalGraph, type GraphInstance, type GraphType } from './graph';
import { DEFAULT_CONFIG } from './types/cypher';
import type { CypherAST, UnionQueryAST, ResultRow, GraphIndexes, GraphConfig } from './types/cypher';

// ── Graph file format types ──────────────────────────────────────────────────

export interface GraphologyGraphOptions {
  type?: 'directed' | 'undirected' | 'mixed';
  allowSelfLoops?: boolean;
  multi?: boolean;
}

export interface GraphologyNode {
  key: string;
  attributes: Record<string, unknown>;
}

export interface GraphologyEdge {
  key?: string;
  source: string;
  target: string;
  undirected?: boolean;
  attributes: Record<string, unknown>;
}

export interface GraphologyFile {
  options?: GraphologyGraphOptions;
  attributes?: Record<string, unknown>;
  nodes: GraphologyNode[];
  edges: GraphologyEdge[];
}

/** Graph data in Graphology JSON format. */
export type GraphInput = GraphologyFile;

// ── Internal normalized format (always what the engine sees) ─────────────────

/**
 * Internal normalized graph format (what the engine sees after normalization).
 *
 * @internal — Not part of the public API. May change without notice.
 */
export interface NormalizedNode {
  id: string;
  [key: string]: unknown;
}

/**
 * @internal — Not part of the public API. May change without notice.
 */
export interface NormalizedEdge {
  source: string;
  target: string;
  key?: string;
  undirected?: boolean;
  [key: string]: unknown;
}

/**
 * @internal — Not part of the public API. May change without notice.
 */
export interface NormalizedGraphFile {
  nodes: NormalizedNode[];
  edges: NormalizedEdge[];
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

// ── Config resolution ────────────────────────────────────────────────────────

/**
 * Resolve a partial IndexBuildOptions.config into a fully-resolved GraphConfig.
 * Missing fields default to `'label'` and `'type'` respectively.
 */
function resolveConfig(opts?: IndexBuildOptions): GraphConfig {
  const c = opts?.config;
  return {
    labelProperty: c?.labelProperty ?? DEFAULT_CONFIG.labelProperty,
    edgeTypeProperty: c?.edgeTypeProperty ?? DEFAULT_CONFIG.edgeTypeProperty,
  };
}

// ── Graph construction ───────────────────────────────────────────────────────

/**
 * Options for graph construction functions.
 *
 * Note: this type does **not** include `config` (label/edge-type property
 * names). That option is only used by `buildGraphIndexes` and `executeQuery`,
 * not by `createGraph`.
 */
export interface GraphOptions {
  /**
   * Callback for non-fatal warnings during graph construction.
   *
   * Use this to capture warnings (e.g., unsupported options, duplicate keys)
   * without relying on console.warn side-effects.
   *
   * @example
   * ```ts
   * import { createGraph } from 'gcyphrq';
   *
   * const warnings: string[] = [];
   * const graph = createGraph(graphData, { onWarning: (w) => warnings.push(w) });
   * ```
   */
  onWarning?: (message: string) => void;
}

/**
 * Options for index-building functions.
 *
 * Extends `GraphOptions` with an optional `config` field for customizing
 * the property names used as node labels and edge types.
 *
 * @example
 * ```ts
 * import { createGraph, buildGraphIndexes } from 'gcyphrq';
 *
 * const graph = createGraph(graphData);
 * const indexes = buildGraphIndexes(graph, { config: { labelProperty: 'kind', edgeTypeProperty: 'rel' } });
 * ```
 */
export interface IndexBuildOptions extends GraphOptions {
  /**
   * Configuration for the property names used as node labels and edge types.
   * By default gcyphrq reads `label` from node attributes and `type` from
   * edge attributes. Use this to point at different property names.
   */
  config?: Partial<GraphConfig>;
}

interface ValidationResult {
  normalized: NormalizedGraphFile;
  graphType: GraphType;
  allowSelfLoops: boolean;
  multi: boolean;
  warnings: string[];
  errors: string[];
}

function validateGraphData(data: unknown, opts?: GraphOptions): ValidationResult {
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

  const g = data as GraphologyFile;
  const nodes = g.nodes as GraphologyNode[];
  const edges = g.edges as GraphologyEdge[];
  const warnings: string[] = [];
  const errors: string[] = [];

  // ── Structural validation ──────────────────────────────────────────

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (typeof n.key !== 'string' || !n.key) {
      errors.push(`Node at index ${i} must have a non-empty string "key".`);
    }
    if (typeof n.attributes !== 'object' || n.attributes === null) {
      errors.push(`Node at index ${i} must have a non-null "attributes" object.`);
    }
  }

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    if (typeof e.source !== 'string' || !e.source) {
      errors.push(`Edge at index ${i} must have a non-empty string "source".`);
    }
    if (typeof e.target !== 'string' || !e.target) {
      errors.push(`Edge at index ${i} must have a non-empty string "target".`);
    }
    if (typeof e.attributes !== 'object' || e.attributes === null) {
      errors.push(`Edge at index ${i} must have a non-null "attributes" object.`);
    }
  }

  // ── Graph type extraction ──────────────────────────────────────────

  const options = g.options;
  let graphType: GraphType = 'directed';
  let allowSelfLoops = false;
  let multi = false;
  if (options) {
    if (options.type !== undefined) {
      if (options.type !== 'directed' && options.type !== 'undirected' && options.type !== 'mixed') {
        errors.push(
          `Graphology option "type" is set to "${options.type}" but must be "directed", "undirected", or "mixed".`,
        );
      } else {
        graphType = options.type;
      }
    }
    if (options.allowSelfLoops) {
      allowSelfLoops = true;
    }
    if (options.multi) {
      multi = true;
    }
  }

  if (errors.length > 0) {
    for (const w of warnings) {
      opts?.onWarning?.(`gcyphrq: ${w}`);
    }
    throw new GraphError(`Unsupported graph option: ${errors[0]}`);
  }

  // ── Warnings (undirected edges in non-mixed graphs) ────────────────

  if (graphType !== 'mixed') {
    let undirectedCount = 0;
    for (const edge of edges) {
      if (edge.undirected) undirectedCount++;
    }
    if (undirectedCount > 0) {
      warnings.push(
        `${undirectedCount} edge(s) have "undirected": true but the graph type is "${graphType}". ` +
        `The "undirected" property is only effective in mixed graphs. Ignoring.`,
      );
    }
  }

  // ── Normalize ──────────────────────────────────────────────────────

  const normalizedNodes: NormalizedNode[] = nodes.map((n) => {
    const { key, attributes } = n;
    return { id: key, ...attributes };
  });
  const normalizedEdges: NormalizedEdge[] = edges.map((e) => {
    const { source, target, key, attributes, undirected } = e;
    const edge: NormalizedEdge = { source, target, ...attributes };
    if (key) edge.key = key;
    if (undirected) edge.undirected = true;
    return edge;
  });

  // ── Uniqueness and referential integrity ───────────────────────────

  const seenNodeIds = new Set<string>();
  for (let i = 0; i < normalizedNodes.length; i++) {
    const n = normalizedNodes[i]!;
    if (seenNodeIds.has(n.id)) {
      throw new GraphError(`Invalid graph data: duplicate node id "${n.id}" at index ${i}.`);
    }
    seenNodeIds.add(n.id);
  }

  const seenEdgeKeys = new Set<string>();
  const seenEdgePairs = new Set<string>();
  const warnedEdgeKeys = new Set<string>();
  for (let i = 0; i < normalizedEdges.length; i++) {
    const e = normalizedEdges[i]!;

    // Duplicate edge key warning (once per key)
    if (typeof e.key === 'string') {
      if (seenEdgeKeys.has(e.key) && !warnedEdgeKeys.has(e.key)) {
        warnings.push(`Duplicate edge key "${e.key}". Edge keys must be unique.`);
        warnedEdgeKeys.add(e.key);
      }
      seenEdgeKeys.add(e.key);
    }

    // Referential integrity
    if (!seenNodeIds.has(e.source)) {
      throw new GraphError(`Invalid graph data: edge at index ${i} references unknown source node "${e.source}".`);
    }
    if (!seenNodeIds.has(e.target)) {
      throw new GraphError(`Invalid graph data: edge at index ${i} references unknown target node "${e.target}".`);
    }

    // Duplicate edge pair (source→target)
    // For undirected graphs: all edges are undirected, so A-B and B-A are the same
    // For mixed graphs: only edges with undirected:true are bidirectional
    // For directed graphs: A->B and B->A are different edges
    const isUndirectedEdge = graphType === 'undirected' || e.undirected === true;
    const edgePair = isUndirectedEdge
      ? [e.source, e.target].sort().join('-')
      : `${e.source}->${e.target}`;
    if (seenEdgePairs.has(edgePair)) {
      if (!multi) {
        throw new GraphError(`Invalid graph data: duplicate edge "${edgePair}" at index ${i}. Set options.multi to true to allow parallel edges.`);
      }
    } else {
      seenEdgePairs.add(edgePair);
    }
  }

  // Emit warnings through callback
  for (const w of warnings) {
    opts?.onWarning?.(`gcyphrq: ${w}`);
  }

  return { normalized: { nodes: normalizedNodes, edges: normalizedEdges }, graphType, allowSelfLoops, multi, warnings, errors: [] };
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
 *   options: { type: 'directed' },
 *   nodes: [
 *     { key: 'alice', attributes: { label: 'User', name: 'Alice' } },
 *     { key: 'bob', attributes: { label: 'User', name: 'Bob' } },
 *   ],
 *   edges: [
 *     { key: 'alice-friend-bob', source: 'alice', target: 'bob', attributes: { type: 'FRIEND' } },
 *   ],
 * });
 * ```
 *
 * @see https://graphology.github.io/
 */
export function createGraph(data: GraphInput, opts?: GraphOptions): GraphInstance {
  const { normalized, graphType, allowSelfLoops, multi } = validateGraphData(data, opts);
  return buildGraph(normalized, graphType, allowSelfLoops || undefined, multi || undefined);
}

/** Build a Graphology graph from already-validated data (internal helper). */
function buildGraph(validated: NormalizedGraphFile, graphType: GraphType, allowSelfLoops?: boolean, multi?: boolean): GraphInstance {
  const graph = new Graph({ type: graphType, ...(allowSelfLoops ? { allowSelfLoops } : {}), ...(multi ? { multi } : {}) });

  for (const node of validated.nodes) {
    const { id, ...attrs } = node;
    graph.addNode(id, attrs);
  }

  // Track used keys to handle duplicates (already warned during validation)
  const usedKeys = new Set<string>();

  for (const edge of validated.edges) {
    const { source, target, key, undirected, ...attrs } = edge;
    // For mixed graphs, pass undirected: true in edge attributes
    const edgeAttrs = undirected ? { ...attrs, undirected: true } : attrs;
    if (key && !usedKeys.has(key)) {
      usedKeys.add(key);
      graph.addEdgeWithKey(key, source, target, edgeAttrs);
    } else {
      graph.addEdge(source, target, edgeAttrs);
    }
  }

  return graph;
}

/**
 * Build pre-computed indexes for fast query execution.
 *
 * **Three overloads:**
 *
 * 1. `buildGraphIndexes(graph)` — from an existing Graphology graph instance.
 *    Builds indexes by iterating the graph (no original data needed).
 * 2. `buildGraphIndexes(data)` — from graph data alone.
 *    Builds the graph internally and indexes from it.
 * 3. `buildGraphIndexes(data, graph)` — from graph data + graph instance.
 *
 * All overloads accept an optional second (or third) `opts` argument of type
 * `IndexBuildOptions`. Use `opts.config` to customize the property names used
 * for node labels and edge types, and `opts.onWarning` to capture warnings.
 *
 * Pass the returned indexes to `GraphEngine` constructor for O(1) label
 * and property lookups instead of full-graph scans.
 *
 * @example
 * ```ts
 * // From an existing Graphology graph
 * import { buildGraphIndexes, GraphEngine } from 'gcyphrq';
 * import Graph from 'graphology';
 *
 * const graph = new Graph();
 * graph.addNode('alice', { label: 'User', name: 'Alice' });
 * const indexes = buildGraphIndexes(graph);
 * const engine = new GraphEngine(graph, indexes);
 *
 * // From graph data alone
 * const indexes = buildGraphIndexes(graphData);
 *
 * // From graph data + graph instance (original API)
 * import { buildGraphIndexes, GraphEngine, createGraph } from 'gcyphrq';
 *
 * const graph = createGraph(graphData);
 * const indexes = buildGraphIndexes(graphData, graph);
 * const engine = new GraphEngine(graph, indexes);
 *
 * // With custom label/edge-type property names
 * const indexes = buildGraphIndexes(graph, {
 *   config: { labelProperty: 'kind', edgeTypeProperty: 'rel' },
 * });
 * ```
 */
export function buildGraphIndexes(graph: GraphInstance, opts?: IndexBuildOptions): GraphIndexes;
export function buildGraphIndexes(data: GraphInput, opts?: IndexBuildOptions): GraphIndexes;
export function buildGraphIndexes(data: GraphInput, graph: GraphInstance, opts?: IndexBuildOptions): GraphIndexes;
export function buildGraphIndexes(
  dataOrGraph: GraphInput | GraphInstance,
  graphOrOpts?: GraphInstance | IndexBuildOptions,
  opts?: IndexBuildOptions,
): GraphIndexes {
  // Determine which overload was called.
  // graphOrOpts is either undefined, a GraphInstance, or IndexBuildOptions.
  // Distinguish GraphInstance by checking for a graph-specific method.
  const secondArgIsGraph = graphOrOpts !== undefined
    && typeof (graphOrOpts as GraphInstance).hasNode === 'function'
    && typeof (graphOrOpts as GraphInstance).filterNodes === 'function'
    && typeof (graphOrOpts as GraphInstance).forEachEdge === 'function';

  if (graphOrOpts === undefined) {
    // Single-argument form
    if (isGraphInstance(dataOrGraph)) {
      return buildGraphIndexesFromGraph(dataOrGraph, DEFAULT_CONFIG);
    }
    const { normalized, graphType, allowSelfLoops, multi } = validateGraphData(dataOrGraph as GraphInput);
    const builtGraph = buildGraph(normalized, graphType, allowSelfLoops, multi);
    return buildGraphIndexesFromGraph(builtGraph, DEFAULT_CONFIG);
  }

  if (secondArgIsGraph) {
    // (data, graph) or (data, graph, opts)
    const data = dataOrGraph as GraphInput;
    const { normalized } = validateGraphData(data, opts);
    return buildGraphIndexesFromData(normalized, graphOrOpts as GraphInstance, resolveConfig(opts));
  }

  // graphOrOpts is IndexBuildOptions
  const buildOpts = graphOrOpts as IndexBuildOptions;
  const resolvedConfig = resolveConfig(buildOpts);

  if (isGraphInstance(dataOrGraph)) {
    // Two-argument form: (graph, opts)
    return buildGraphIndexesFromGraph(dataOrGraph, resolvedConfig);
  }

  // Two-argument form: (data, opts) — build graph internally
  const data = dataOrGraph as GraphInput;
  const { normalized, graphType, allowSelfLoops, multi } = validateGraphData(data, buildOpts);
  const builtGraph = buildGraph(normalized, graphType, allowSelfLoops, multi);
  return buildGraphIndexesFromGraph(builtGraph, resolvedConfig);
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
export function parseCypher(query: string): CypherAST {
  return _parseCypher(query);
}

/**
 * Generate an explain plan for a Cypher query without executing it.
 *
 * Walks the parsed AST and produces a structured plan showing query stages,
 * variable bindings, and descriptions. Useful for debugging and understanding
 * how a query will be executed.
 *
 * @example
 * ```ts
 * import { explainQuery } from 'gcyphrq';
 *
 * const plan = explainQuery('MATCH (u:User) RETURN u');
 * console.log(JSON.stringify(plan, null, 2));
 * // {
 * //   query: 'MATCH (u:User) RETURN u',
 * //   stages: [
 * //     { index: 0, type: 'MATCH', description: 'MATCH (u:User)', variables: ['u'] },
 * //     { index: 1, type: 'RETURN', description: 'RETURN u', variables: ['u'] }
 * //   ],
 * //   finalVariables: ['u']
 * // }
 * ```
 */
export function explainQuery(query: string): { query: string; union?: boolean; stages: Array<{ index: number; type: string; description: string; variables: string[]; details?: Record<string, unknown> }>; finalVariables: string[] } {
  const ast = _parseCypher(query);
  return _explainQuery(query, ast);
}

/**
 * Execute a Cypher query against a graph and return results as plain JSON.
 *
 * This is the simplest way to use gcyphrq. Indexes are built automatically.
 *
 * **Two overloads:**
 *
 * 1. `executeQuery(graph, query)` — from an existing Graphology graph instance.
 * 2. `executeQuery(graphData, query)` — from graph data (original API).
 *
 * @example
 * ```ts
 * // From an existing Graphology graph
 * import { executeQuery } from 'gcyphrq';
 * import Graph from 'graphology';
 *
 * const graph = new Graph();
 * graph.addNode('alice', { label: 'User', name: 'Alice' });
 * const results = executeQuery(graph, 'MATCH (u:User) RETURN u.name');
 *
 * // From graph data (original API)
 * const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name');
 * ```
 *
 * @param graphOrData - Graph data or an existing Graphology graph instance
 * @param query - A Cypher query string
 * @param opts - Optional configuration (label/edge-type property names)
 * @returns Array of result rows
 * @throws {GraphError} If graph data is invalid
 * @throws {Error} If the query is invalid or cannot be executed
 */
export function executeQuery(graph: GraphInstance, query: string, opts?: IndexBuildOptions): ResultRow[];
export function executeQuery(graphData: GraphInput, query: string, opts?: IndexBuildOptions): ResultRow[];
export function executeQuery(graphOrData: GraphInstance | GraphInput, query: string, opts?: IndexBuildOptions): ResultRow[] {
  const graph = isGraphInstance(graphOrData)
    ? (graphOrData instanceof Graph ? graphOrData : wrapExternalGraph(graphOrData as any))
    : (() => {
        const { normalized, graphType, allowSelfLoops, multi } = validateGraphData(graphOrData as GraphInput);
        return buildGraph(normalized, graphType, allowSelfLoops, multi);
      })();
  const config = resolveConfig(opts);
  const indexes = buildGraphIndexesFromGraph(graph, config);
  const engine = new AdvancedCypherGraphologyEngine(graph, indexes, opts?.onWarning);
  const ast = _parseCypher(query);
  if (ast.type === 'UnionQuery') {
    return engine.executeUnion(ast);
  }
  return engine.execute(ast);
}

/** Type guard to distinguish a GraphInstance from a GraphInput data object. */
function isGraphInstance(value: GraphInstance | GraphInput): value is GraphInstance {
  return (
    typeof (value as GraphInstance).hasNode === 'function' &&
    typeof (value as GraphInstance).filterNodes === 'function' &&
    typeof (value as GraphInstance).forEachEdge === 'function'
  );
}

// ── Re-exports ───────────────────────────────────────────────────────────────

/**
 * The Cypher query engine. Accepts a `GraphInstance` and executes parsed ASTs.
 *
 * For best performance, pass pre-computed indexes as the second argument.
 * Note: indexes are invalidated after any CREATE/SET/DELETE/REMOVE mutation so that
 * subsequent MATCH/WITH stages see the updated graph state via full-graph scan.
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
export type { GraphInstance, GraphType } from './graph';

// Re-export GraphIndexes and GraphConfig for consumers who build indexes manually
export type { GraphIndexes, GraphConfig } from './types/cypher';
// IndexBuildOptions is exported as a top-level interface above (no re-export needed)

// Re-export all AST, expression, and result types from types/cypher.ts
export type {
  AdvancedCypherAST,
  UnionQueryAST,
  UnionType,
  CypherAST,
  Stage,
  MatchClause,
  MergeClause,
  MergeAction,
  MergeSetAction,
  WithClause,
  ReturnClause,
  WriteClause,
  CreateClause,
  DeleteClause,
  SetClause,
  SetItem,
  RemoveClause,
  UnwindClause,
  ForeachClause,
  CallClause,
  NodePattern,
  LabelExpression,
  RelationPattern,
  Direction,
  Expression,
  PropertyAccessExpression,
  LiteralExpression,
  AggregationExpression,
  ReduceExpression,
  BinaryExpression,
  PathExpression,
  Projection,
  OrderByItem,
  ResultRow,
  QueryContext,
  CypherNode,
  CypherEdge,
  CypherValue,
  CypherLiteral,
} from './types/cypher';

// Re-export explain types
export type { ExplainPlan, ExplainStage } from './engine/explain';
