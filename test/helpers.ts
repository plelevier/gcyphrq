import type { GraphIndexes, CypherNode } from '../src/types/cypher';
import type { GraphInstance } from '../src/graph';
import { DEFAULT_CONFIG } from '../src/types/cypher';

/** Cast a result-row value to CypherNode for test assertions. */
export function node<T extends Record<string, unknown>>(row: T, key: keyof T): CypherNode {
  return row[key] as CypherNode;
}

/** Build simple indexes from a Graphology graph (for mutation tests). */
export function buildIndexesFromGraph(graph: GraphInstance): GraphIndexes {
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
