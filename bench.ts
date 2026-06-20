#!/usr/bin/env tsx
/**
 * Simple benchmark to measure query performance with and without indexes.
 *
 * Usage:
 *   npx tsx bench.ts                          # default queries on cloud-infra.json
 *   npx tsx bench.ts -g examples/social-graph.json
 *   npx tsx bench.ts -q 'MATCH (s:Service) RETURN s' 'MATCH (s:Service)-[r:DEPENDS_ON*1..2]->(d) RETURN s, d'
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Graph, type GraphInstance } from './src/graph';
import { AdvancedCypherGraphologyEngine } from './src/engine/cypher-engine';
import { parseCypher } from './src/engine/cypher-parser';
import type { GraphFile, GraphIndexes } from './src/lib';

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadGraph(path: string): { data: GraphFile; graph: GraphInstance } {
  const raw = readFileSync(resolve(path), 'utf-8');
  const data = JSON.parse(raw) as GraphFile;
  const graph = new Graph();
  for (const node of data.nodes) {
    const { id, ...attrs } = node;
    graph.addNode(id, attrs);
  }
  for (const edge of data.edges) {
    const { source, target, ...attrs } = edge;
    graph.addEdge(source, target, attrs);
  }
  return { data, graph };
}

function buildIndexes(data: GraphFile, graph: GraphInstance): GraphIndexes {
  const labelIndex = new Map<string, Set<string>>();
  const propertyIndex = new Map<string, Map<string, Set<string>>>();
  const edgeOut = new Map<string, Map<string, Array<{ target: string; edgeId: string }>>>();
  const edgeIn = new Map<string, Map<string, Array<{ source: string; edgeId: string }>>>();

  for (const node of data.nodes) {
    const { id, label, ...props } = node;
    if (label && typeof label === 'string') {
      let s = labelIndex.get(label);
      if (!s) { s = new Set(); labelIndex.set(label, s); }
      s.add(id);
    }
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || typeof value === 'object') continue;
      let vm = propertyIndex.get(key);
      if (!vm) { vm = new Map(); propertyIndex.set(key, vm); }
      const vk = String(value);
      let ns = vm.get(vk);
      if (!ns) { ns = new Set(); vm.set(vk, ns); }
      ns.add(id);
    }
  }

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

  return { labelIndex, propertyIndex, edgeTypeIndex: { out: edgeOut, in: edgeIn } };
}

function benchmark(query: string, graph: GraphInstance, indexes?: GraphIndexes): { ms: number; rows: number } {
  const engine = new AdvancedCypherGraphologyEngine(graph, indexes);
  const ast = parseCypher(query);

  const iterations = 50;
  const start = performance.now();
  let lastRows = 0;
  for (let i = 0; i < iterations; i++) {
    const results = engine.execute(ast);
    lastRows = results.length;
  }
  const elapsed = performance.now() - start;

  return { ms: elapsed / iterations, rows: lastRows };
}

// ── CLI arg parsing ──────────────────────────────────────────────────────────

let graphPath = 'examples/cloud-infra.json';
const defaultQueries = [
  'MATCH (s:Service) RETURN s',
  'MATCH (s:Service)-[r:DEPENDS_ON*1..2]->(d) RETURN s.name, d.name',
  'MATCH (n) RETURN count(n) AS total',
  'MATCH (s:Service) RETURN s ORDER BY s.name SKIP 2 LIMIT 5',
  'MATCH (s:Service {type: "RPC"}) RETURN s.name',
];
let queries: string[] = [];

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === '-g' && args[i + 1]) {
    graphPath = args[++i]!;
  } else if (arg === '-q') {
    queries = args.slice(i + 1);
    break;
  }
}

if (!queries.length) queries = defaultQueries;

// ── Run ──────────────────────────────────────────────────────────────────────

const { data, graph } = loadGraph(graphPath);
const indexes = buildIndexes(data, graph);

console.log(`Graph: ${data.nodes.length} nodes, ${data.edges.length} edges`);
console.log('');

const header = `${'Query'.padEnd(65)} | ${'No index'.padEnd(12)} | ${'Indexed'.padEnd(12)} | Speedup`;
console.log(header);
console.log('─'.repeat(header.length));

for (const q of queries) {
  const short = q.length > 63 ? q.slice(0, 60) + '...' : q;

  const noIndex = benchmark(q, graph);
  const withIndex = benchmark(q, graph, indexes);

  const speedup = noIndex.ms > 0 ? (noIndex.ms / withIndex.ms).toFixed(1) : '∞';
  const label = `${noIndex.rows} rows`;

  console.log(
    `${short.padEnd(65)} | ` +
    `${noIndex.ms.toFixed(2)}ms  (${label}) | ` +
    `${withIndex.ms.toFixed(2)}ms  (${label}) | ` +
    `${speedup}x`
  );
}
