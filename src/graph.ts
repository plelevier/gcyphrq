import GraphModule from 'graphology';

// Graphology ships as a default export with no named exports.
// We define a precise instance type so the engine is fully typed.
export interface GraphInstance {
  addNode(id: string, attrs?: Record<string, unknown>): void;
  addEdge(a: string, b: string, attrs?: Record<string, unknown>): void;
  getNodeAttributes(id: string): Record<string, unknown>;
  getEdgeAttributes(id: string): Record<string, unknown>;
  filterNodes(fn: (id: string, attrs: Record<string, unknown>) => boolean): string[];
  forEachOutboundEdge(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  forEachInboundEdge(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  forEachEdge(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  /** Iterate over all edges in the graph. */
  forEachEdgeAll(cb: (edgeId: string, source: string, target: string, attrs: Record<string, unknown>) => void): void;
  setNodeAttribute(id: string, attr: string, value: unknown): void;
  hasNode(id: string): boolean;
  dropNode(id: string): void;
  order: number;
}

const Graph = GraphModule as unknown as { new (): GraphInstance };

// Add forEachEdgeAll to the Graphology prototype so it matches our GraphInstance interface.
// Graphology's forEachEdge() without a node argument iterates ALL edges.
(Graph as any).prototype.forEachEdgeAll = function (
  cb: (edgeId: string, source: string, target: string, attrs: Record<string, unknown>) => void,
) {
  // Graphology signature: forEachEdge((edge, attributes, source, target) => {}) 
  this.forEachEdge((edge: string, attrs: Record<string, unknown>, source: string, target: string) => {
    cb(edge, source, target, attrs);
  });
};

/**
 * Runtime smoke-test: verify that the Graphology instance exposes the
 * methods our GraphInstance interface depends on. Throws if anything is
 * missing (e.g. after a Graphology major-version bump).
 */
function assertGraphApi(graph: GraphInstance): void {
  const requiredMethods = [
    'addNode',
    'addEdge',
    'getNodeAttributes',
    'getEdgeAttributes',
    'filterNodes',
    'forEachOutboundEdge',
    'forEachInboundEdge',
    'forEachEdge',
    'forEachEdgeAll',
    'setNodeAttribute',
    'hasNode',
    'dropNode',
  ];

  for (const method of requiredMethods) {
    if (typeof graph[method as keyof GraphInstance] !== 'function') {
      throw new Error(`Graphology API mismatch: missing method "${method}".`);
    }
  }
}

let graphApiValidated = false;

/** Lazy validation — runs once on first Graph construction, not at module load. */
function ensureGraphApiValid(graph: GraphInstance): void {
  if (graphApiValidated) return;
  if (process.env.NODE_ENV === 'test') return;
  assertGraphApi(graph);
  graphApiValidated = true;
}

// Eager check in dev so broken Graphology versions are caught immediately.
if (process.env.NODE_ENV === 'development') {
  assertGraphApi(new Graph());
}

export { Graph, ensureGraphApiValid };
