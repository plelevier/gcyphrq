import type { GraphInstance } from '../graph';
import type { CypherEdge, CypherNode, CypherValue, PathExpression, QueryContext, RelationPattern } from '../types/cypher';
import type { GraphConfig } from '../types/cypher';

/** Evaluate a shortestPath or allShortestPaths expression. */
export function evaluatePathExpression(
  graph: GraphInstance, config: GraphConfig,
  expr: PathExpression, context: QueryContext,
): CypherValue {
  const sourceVal = context[expr.sourcePattern.variable];
  const sourceId = extractNodeId(sourceVal);
  if (!sourceId) return expr.functionName === 'allShortestPaths' ? [] as unknown as CypherValue : null;

  const targetVal = context[expr.targetPattern.variable];
  const targetId = extractNodeId(targetVal);
  if (!targetId) return expr.functionName === 'allShortestPaths' ? [] as unknown as CypherValue : null;

  if (sourceId === targetId) {
    const sourceAttr = graph.getNodeAttributes(sourceId);
    const node = { id: sourceId, ...sourceAttr } as CypherNode;
    if (expr.functionName === 'shortestPath') return { nodes: [node], relationships: [] } as unknown as CypherValue;
    return [{ nodes: [node], relationships: [] }] as unknown as CypherValue;
  }

  if (!graph.hasNode(sourceId) || !graph.hasNode(targetId)) return expr.functionName === 'allShortestPaths' ? [] as unknown as CypherValue : null;

  const minDepth = expr.relationPattern.minDepth ?? 1;
  const maxDepth = expr.relationPattern.maxDepth;
  const relation = expr.relationPattern;

  if (expr.functionName === 'shortestPath') {
    const path = findSingleShortestPath(graph, config, sourceId, targetId, relation, minDepth, maxDepth);
    if (!path) return null;
    return buildPathResult(graph, path);
  }

  const allPaths = findAllShortestPaths(graph, config, sourceId, targetId, relation, minDepth, maxDepth);
  if (!allPaths || allPaths.length === 0) return [] as unknown as CypherValue;
  return allPaths.map((p) => buildPathResult(graph, p)) as unknown as CypherValue;
}

export function buildPathResult(graph: GraphInstance, path: { nodeIds: string[]; edgeIds: string[] }): CypherValue {
  const nodes: CypherNode[] = path.nodeIds.map((id) => ({ id, ...graph.getNodeAttributes(id) }) as CypherNode);
  const edges: CypherEdge[] = path.edgeIds.map((edgeId) => {
    const endpoints = graph.getEdgeEndpoints(edgeId);
    return { id: edgeId, source: endpoints.source, target: endpoints.target, ...graph.getEdgeAttributes(edgeId) } as CypherEdge;
  });
  return { nodes, relationships: edges } as unknown as CypherValue;
}

export function extractNodeId(value: CypherValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id === 'string' && obj.id) return obj.id;
  return null;
}

function findSingleShortestPath(
  graph: GraphInstance, config: GraphConfig,
  source: string, target: string, relation: RelationPattern, minDepth: number, maxDepth: number | undefined,
): { nodeIds: string[]; edgeIds: string[] } | null {
  const parent = new Map<string, string>();
  const parentEdge = new Map<string, string>();
  const distOf = new Map<string, number>();
  distOf.set(source, 0);

  const queue: string[] = [source];
  let head = 0;
  let targetDistance = -1;

  while (head < queue.length) {
    const current = queue[head++]!;
    const currentDist = distOf.get(current)!;
    if (targetDistance > 0 && currentDist > targetDistance) break;

    forEachFilteredNeighbor(graph, config, current, relation, (nId, eId) => {
      const newDist = currentDist + 1;
      if (maxDepth !== undefined && newDist > maxDepth) return;
      if (!distOf.has(nId)) {
        distOf.set(nId, newDist);
        parent.set(nId, current);
        parentEdge.set(nId, eId);
        if (nId === target) targetDistance = newDist;
        if (newDist < targetDistance || targetDistance === -1) queue.push(nId);
      }
    });
  }

  if (targetDistance === -1 || targetDistance < minDepth) return null;

  const nodeIds: string[] = [target]; const edgeIds: string[] = [];
  let cur = target;
  while (cur !== source) { const e = parentEdge.get(cur); if (!e) return null; edgeIds.push(e); cur = parent.get(cur)!; nodeIds.push(cur); }
  nodeIds.reverse(); edgeIds.reverse();
  return { nodeIds, edgeIds };
}

function findAllShortestPaths(
  graph: GraphInstance, config: GraphConfig,
  source: string, target: string, relation: RelationPattern, minDepth: number, maxDepth: number | undefined,
): Array<{ nodeIds: string[]; edgeIds: string[] }> | null {
  const predecessors = new Map<string, string[]>();
  const predEdges = new Map<string, string[]>();
  const distOf = new Map<string, number>();
  distOf.set(source, 0);

  const queue: string[] = [source];
  let head = 0;
  let targetDistance = -1;

  while (head < queue.length) {
    const current = queue[head++]!;
    const currentDist = distOf.get(current)!;
    if (targetDistance > 0 && currentDist > targetDistance) break;

    forEachFilteredNeighbor(graph, config, current, relation, (nId, eId) => {
      const newDist = currentDist + 1;
      if (maxDepth !== undefined && newDist > maxDepth) return;
      const existing = distOf.get(nId);
      if (existing === undefined) {
        distOf.set(nId, newDist);
        predecessors.set(nId, [current]);
        predEdges.set(nId, [eId]);
        if (nId === target) targetDistance = newDist;
        if (newDist < targetDistance || targetDistance === -1) queue.push(nId);
      } else if (existing === newDist) {
        predecessors.get(nId)!.push(current);
        predEdges.get(nId)!.push(eId);
      }
    });
  }

  if (targetDistance === -1 || targetDistance < minDepth) return null;
  return reconstructPathsIterative(target, predecessors, predEdges);
}

function forEachFilteredNeighbor(
  graph: GraphInstance, config: GraphConfig,
  nodeId: string, relation: RelationPattern, cb: (neighborId: string, edgeId: string) => void,
): void {
  const direction = relation.direction;
  const edgeTypeProp = config.edgeTypeProperty;
  const wantType = relation.type;

  if (direction === 'OUT' || direction === 'UNDIRECTED') {
    graph.forEachOutboundEdge(nodeId, (edgeId, attrs, _s, t) => { if (wantType && attrs[edgeTypeProp] !== wantType) return; cb(t as string, edgeId as string); });
  }
  if (direction === 'IN' || direction === 'UNDIRECTED') {
    graph.forEachInboundEdge(nodeId, (edgeId, attrs, s, _t) => { if (wantType && attrs[edgeTypeProp] !== wantType) return; cb(s as string, edgeId as string); });
  }
}

function reconstructPathsIterative(
  target: string, predecessors: Map<string, string[]>, predEdges: Map<string, string[]>,
): Array<{ nodeIds: string[]; edgeIds: string[] }> {
  const allPaths: Array<{ nodeIds: string[]; edgeIds: string[] }> = [];
  const stack: Array<[string, string[], string[]]> = [[target, [target], []]];

  while (stack.length > 0) {
    const [current, nodeIds, edgeIds] = stack.pop()!;
    const preds = predecessors.get(current);
    if (!preds || preds.length === 0) { allPaths.push({ nodeIds: [...nodeIds].reverse(), edgeIds: [...edgeIds].reverse() }); continue; }
    const edges = predEdges.get(current)!;
    for (let i = 0; i < preds.length; i++) stack.push([preds[i]!, [...nodeIds, preds[i]!], [...edgeIds, edges[i]!]]);
  }
  return allPaths;
}
