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
  /** Iterate edges incident to a specific node. */
  forEachEdge(id: string, cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  /** Iterate over all edges in the graph (no node filter). */
  forEachEdge(cb: (e: string, a: Record<string, unknown>, s: string, t: string) => void): void;
  setNodeAttribute(id: string, attr: string, value: unknown): void;
  hasNode(id: string): boolean;
  dropNode(id: string): void;
  order: number;
}

const Graph = GraphModule as unknown as { new (): GraphInstance };

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

// Eager check in dev so broken Graphology versions are caught immediately.
if (process.env.NODE_ENV === 'development') {
  assertGraphApi(new Graph());
}

export { Graph };
