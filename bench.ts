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
import { createGraph, buildGraphIndexes, GraphEngine, parseCypher } from './src/lib';
import type { GraphologyFile } from './src/lib';
import type { GraphIndexes } from './src/types/cypher';

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadGraph(path: string): { data: GraphologyFile; graph: ReturnType<typeof createGraph> } {
  const raw = readFileSync(resolve(path), 'utf-8');
  const data = JSON.parse(raw) as GraphologyFile;
  return { data, graph: createGraph(data) };
}

function benchmark(query: string, graph: ReturnType<typeof createGraph>, indexes?: GraphIndexes): { ms: number; rows: number } {
  const engine = new GraphEngine(graph, indexes);
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
const indexes = buildGraphIndexes(graph);

console.log(`Graph: ${data.nodes.length} nodes, ${data.edges.length} edges`);
console.log('');

const header = `${'Query'.padEnd(65)} | ${'No index'.padEnd(12)} | ${'Indexed'.padEnd(12)} | Speedup`;
console.log(header);
console.log('\u2500'.repeat(header.length));

for (const q of queries) {
  const short = q.length > 63 ? q.slice(0, 60) + '...' : q;

  const noIndex = benchmark(q, graph);
  const withIndex = benchmark(q, graph, indexes);

  const speedup = noIndex.ms > 0 ? (noIndex.ms / withIndex.ms).toFixed(1) : '\u221e';
  const label = `${noIndex.rows} rows`;

  console.log(
    `${short.padEnd(65)} | ` +
    `${noIndex.ms.toFixed(2)}ms  (${label}) | ` +
    `${withIndex.ms.toFixed(2)}ms  (${label}) | ` +
    `${speedup}x`
  );
}
