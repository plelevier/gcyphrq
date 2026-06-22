import GraphModule from 'graphology';

// Graphology ships as a default export with no named exports.
// We define a precise instance type so the engine is fully typed.
export type GraphType = 'directed' | 'undirected' | 'mixed';

export interface GraphConstructorOptions {
  type?: GraphType;
}

export interface GraphInstance {
  /** Graph type: 'directed', 'undirected', or 'mixed'. */
  readonly type: GraphType;
  addNode(id: string, attrs?: Record<string, unknown>): void;
  addEdge(a: string, b: string, attrs?: Record<string, unknown>): void;
  addEdgeWithKey(key: string, a: string, b: string, attrs?: Record<string, unknown>): void;
  getNodeAttributes(id: string): Record<string, unknown>;
  getEdgeAttributes(id: string): Record<string, unknown>;
  filterNodes(fn: (id: string, attrs: Record<string, unknown>) => boolean): string[];
  forEachOutboundEdge(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  forEachInboundEdge(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  /**
   * Iterate edges incident to a specific node, or all edges when no node ID is given.
   * (Wraps Graphology's `forEachEdge` which accepts an optional node parameter.)
   */
  forEachEdge(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  forEachEdge(cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  setNodeAttribute(id: string, attr: string, value: unknown): void;
  setEdgeAttribute(id: string, attr: string, value: unknown): void;
  hasNode(id: string): boolean;
  dropNode(id: string): void;
  order: number;
}

/**
 * Internal Graphology graph type. Used to create the right graph class
 * for each graph type.
 */
interface RawGraph {
  type: GraphType;
  addNode(id: string, attrs?: Record<string, unknown>): void;
  addEdge(a: string, b: string, attrs?: Record<string, unknown>): void;
  addEdgeWithKey(key: string, a: string, b: string, attrs?: Record<string, unknown>): void;
  getNodeAttributes(id: string): Record<string, unknown>;
  getEdgeAttributes(id: string): Record<string, unknown>;
  filterNodes(fn: (id: string, attrs: Record<string, unknown>) => boolean): string[];
  forEachOutboundEdge?(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  forEachInboundEdge?(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  forEachEdge(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  forEachEdge(cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  setNodeAttribute(id: string, attr: string, value: unknown): void;
  setEdgeAttribute(id: string, attr: string, value: unknown): void;
  hasNode(id: string): boolean;
  dropNode(id: string): void;
  order: number;
}

const DirectedGraph = (GraphModule as any).DirectedGraph;
const UndirectedGraph = (GraphModule as any).UndirectedGraph;

function createRawGraph(type: GraphType): RawGraph {
  switch (type) {
    case 'directed':
      return new DirectedGraph() as unknown as RawGraph;
    case 'undirected':
      return new UndirectedGraph() as unknown as RawGraph;
    case 'mixed':
      return new (GraphModule as new (opts: { type: 'mixed' }) => unknown)({ type: 'mixed' }) as unknown as RawGraph;
  }
}

/**
 * Wrap a raw Graphology graph into our `GraphInstance` interface.
 *
 * For mixed graphs, `forEachOutboundEdge`/`forEachInboundEdge` only iterate
 * directed edges (plus undirected edges in the canonical direction). We wrap
 * them to also include undirected edges in the reverse direction so that
 * the engine sees undirected edges from both sides.
 *
 * For undirected graphs, Graphology already provides `forEachOutboundEdge`/
 * `forEachInboundEdge` that iterate all incident edges, so no wrapping needed.
 */
function wrapGraph(raw: RawGraph): GraphInstance {
  const isMixed = raw.type === 'mixed';

  const wrapOutbound = isMixed
    ? (id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void) => {
        const seen = new Set<string>();
        // Directed outbound + undirected where node is source
        raw.forEachOutboundEdge!(id, (e, a, s, t) => { seen.add(e); cb(e, a, s, t); });
        // Also include undirected edges where node is target
        raw.forEachEdge(id, (e, a, s, t) => {
          if (!seen.has(e) && a.undirected === true) cb(e, a, s, t);
        });
      }
    : raw.forEachOutboundEdge!.bind(raw);

  const wrapInbound = isMixed
    ? (id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void) => {
        const seen = new Set<string>();
        // Directed inbound + undirected where node is target
        raw.forEachInboundEdge!(id, (e, a, s, t) => { seen.add(e); cb(e, a, s, t); });
        // Also include undirected edges where node is source
        raw.forEachEdge(id, (e, a, s, t) => {
          if (!seen.has(e) && a.undirected === true) cb(e, a, s, t);
        });
      }
    : raw.forEachInboundEdge!.bind(raw);

  return {
    get type() { return raw.type; },
    addNode: raw.addNode.bind(raw),
    addEdge: raw.addEdge.bind(raw),
    addEdgeWithKey: raw.addEdgeWithKey.bind(raw),
    getNodeAttributes: raw.getNodeAttributes.bind(raw),
    getEdgeAttributes: raw.getEdgeAttributes.bind(raw),
    filterNodes: raw.filterNodes.bind(raw),
    forEachOutboundEdge: wrapOutbound,
    forEachInboundEdge: wrapInbound,
    forEachEdge: raw.forEachEdge.bind(raw),
    setNodeAttribute: raw.setNodeAttribute.bind(raw),
    setEdgeAttribute: raw.setEdgeAttribute.bind(raw),
    hasNode: raw.hasNode.bind(raw),
    dropNode: raw.dropNode.bind(raw),
    get order() { return raw.order; },
  };
}

/**
 * Graph class that supports directed, undirected, and mixed graphs.
 *
 * Defaults to directed. Pass `{ type: 'undirected' }` or `{ type: 'mixed' }`
 * to create an undirected or mixed graph respectively.
 *
 * @example
 * ```ts
 * // Directed (default)
 * const graph = new Graph();
 *
 * // Undirected
 * const graph = new Graph({ type: 'undirected' });
 *
 * // Mixed (directed + undirected edges)
 * const graph = new Graph({ type: 'mixed' });
 * graph.addEdge('a', 'b', { type: 'KNOWS' });           // directed
 * graph.addEdge('a', 'b', { type: 'FRIENDS', undirected: true }); // undirected
 * ```
 */
export class Graph {
  private _instance: GraphInstance;

  constructor(options?: GraphConstructorOptions) {
    const type = options?.type ?? 'directed';
    const raw = createRawGraph(type);
    this._instance = wrapGraph(raw);
  }

  get type(): GraphType { return this._instance.type; }
  addNode(id: string, attrs?: Record<string, unknown>): void { this._instance.addNode(id, attrs); }
  addEdge(a: string, b: string, attrs?: Record<string, unknown>): void { this._instance.addEdge(a, b, attrs); }
  addEdgeWithKey(key: string, a: string, b: string, attrs?: Record<string, unknown>): void { this._instance.addEdgeWithKey(key, a, b, attrs); }
  getNodeAttributes(id: string): Record<string, unknown> { return this._instance.getNodeAttributes(id); }
  getEdgeAttributes(id: string): Record<string, unknown> { return this._instance.getEdgeAttributes(id); }
  filterNodes(fn: (id: string, attrs: Record<string, unknown>) => boolean): string[] { return this._instance.filterNodes(fn); }
  forEachOutboundEdge(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void { this._instance.forEachOutboundEdge(id, cb); }
  forEachInboundEdge(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void { this._instance.forEachInboundEdge(id, cb); }
  forEachEdge(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  forEachEdge(cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  forEachEdge(idOrCb: string | ((e: string, a: Record<string, unknown>, s: string, t: string) => void), cb?: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void {
    if (typeof idOrCb === 'string') {
      this._instance.forEachEdge(idOrCb, cb!);
    } else {
      this._instance.forEachEdge(idOrCb);
    }
  }
  setNodeAttribute(id: string, attr: string, value: unknown): void { this._instance.setNodeAttribute(id, attr, value); }
  setEdgeAttribute(id: string, attr: string, value: unknown): void { this._instance.setEdgeAttribute(id, attr, value); }
  hasNode(id: string): boolean { return this._instance.hasNode(id); }
  dropNode(id: string): void { this._instance.dropNode(id); }
  get order(): number { return this._instance.order; }
}

/**
 * Wrap an externally-created Graphology graph into our `GraphInstance` interface.
 * Handles undirected graphs (missing outbound/inbound methods) and mixed graphs
 * (undirected edges need bidirectional traversal).
 */
export function wrapExternalGraph(raw: any): GraphInstance {
  const type = raw.type as GraphType;
  if (type === 'directed') {
    // Directed graphs already have the full interface
    return raw as GraphInstance;
  }
  // For undirected/mixed graphs, create a new Graph of the same type and copy data
  const graph = new Graph({ type });
  const allNodes = raw.filterNodes(() => true);
  for (const id of allNodes) {
    graph.addNode(id, raw.getNodeAttributes(id));
  }
  raw.forEachEdge((edgeId: string, attrs: Record<string, unknown>, source: string, target: string) => {
    graph.addEdge(source, target, attrs);
  });
  return graph;
}

/**
 * Runtime smoke-test: verify that the Graphology instance exposes the
 * methods our GraphInstance interface depends on. Throws if anything is
 * missing (e.g. after a Graphology major-version bump).
 */
function assertGraphApi(graph: GraphInstance): void {
  const requiredMethods: (keyof GraphInstance)[] = [
    'addNode',
    'addEdge',
    'addEdgeWithKey',
    'getNodeAttributes',
    'getEdgeAttributes',
    'filterNodes',
    'forEachOutboundEdge',
    'forEachInboundEdge',
    'forEachEdge',
    'setNodeAttribute',
    'setEdgeAttribute',
    'hasNode',
    'dropNode',
  ];

  for (const method of requiredMethods) {
    if (typeof graph[method] !== 'function') {
      throw new Error(`Graphology API mismatch: missing method "${method}".`);
    }
  }
}

// Eager check in dev so broken Graphology versions are caught immediately.
if (process.env.NODE_ENV === 'development') {
  assertGraphApi(new Graph());
}
