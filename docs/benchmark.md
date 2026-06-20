---
layout: default
title: Benchmark
description: Performance benchmarking for gcyphrq queries.
---

<div class="breadcrumb">
  <a href="{{ '/' | relative_url }}">Home</a> <span>›</span> Benchmark
</div>

# Benchmark

The `bench.ts` script measures query performance with and without pre-computed indexes. Each query runs 50 iterations and reports per-run average time for both indexed and non-indexed modes, plus the speedup ratio.

## Running the benchmark

```bash
# Default: 5 queries against examples/cloud-infra.json
npx tsx bench.ts

# Different graph
npx tsx bench.ts -g examples/social-graph.json

# Custom queries (any number of -q args)
npx tsx bench.ts -q 'MATCH (s:Service) RETURN s' 'MATCH (n) RETURN count(n) AS total'

# Both together
npx tsx bench.ts -g examples/cloud-infra.json -q 'MATCH (s:Service {type: "RPC"}) RETURN s.name'
```

## Options

| Option | Description |
|---|---|
| `-g <file>` | Path to a JSON graph file (default: `examples/cloud-infra.json`) |
| `-q <query> [query ...]` | One or more Cypher queries to benchmark. If omitted, runs a default set of 5 queries |

## Output

```
Graph: 51 nodes, 142 edges

Query                                                             | No index     | Indexed      | Speedup
─────────────────────────────────────────────────────────────────────────────────────────────────────────
MATCH (s:Service) RETURN s                                        | 0.04ms  (20 rows) | 0.01ms  (20 rows) | 2.6x
MATCH (s:Service)-[r:DEPENDS_ON*1..2]->(d) RETURN s.name, d....   | 0.04ms  (0 rows) | 0.02ms  (0 rows) | 2.4x
MATCH (n) RETURN count(n) AS total                                | 0.04ms  (1 rows) | 0.03ms  (1 rows) | 1.3x
MATCH (s:Service) RETURN s ORDER BY s.name SKIP 2 LIMIT 5         | 0.03ms  (5 rows) | 0.02ms  (5 rows) | 1.6x
MATCH (s:Service {type: "RPC"}) RETURN s.name                     | 0.02ms  (10 rows) | 0.01ms  (10 rows) | 1.8x
```

Each row shows:
- **Query** — the Cypher query (truncated at 63 characters)
- **No index** — average time without indexes (full-graph scan)
- **Indexed** — average time with pre-computed label, property, and edge-type indexes
- **Speedup** — ratio of no-index time to indexed time

## Default queries

When no `-q` argument is provided, the benchmark runs these 5 queries:

| # | Query | What it tests |
|---|---|---|
| 1 | `MATCH (s:Service) RETURN s` | Label-only node lookup |
| 2 | `MATCH (s:Service)-[r:DEPENDS_ON*1..2]->(d) RETURN s.name, d.name` | Variable-length path traversal with typed edges |
| 3 | `MATCH (n) RETURN count(n) AS total` | Full-graph scan with aggregation |
| 4 | `MATCH (s:Service) RETURN s ORDER BY s.name SKIP 2 LIMIT 5` | Label lookup + sorting + pagination |
| 5 | `MATCH (s:Service {type: "RPC"}) RETURN s.name` | Combined label + property filter |

## How it works

1. Loads the graph from a JSON file and builds a Graphology graph
2. Builds pre-computed indexes (label, property, edge-type adjacency) from the same data
3. For each query, runs two sets of 50 iterations:
   - **No index** — engine receives no indexes, falls back to full-graph scan
   - **Indexed** — engine receives pre-computed indexes for O(1) lookups
4. Reports per-iteration average time and speedup ratio

## Interpretation

Speedup ratios vary by query type:
- **Label-only lookups** benefit most from the label index (2–3x)
- **Property filters** benefit from the property index (1.5–2x)
- **Path traversals** benefit from the edge-type adjacency index (2–3x)
- **Full-graph scans** (no filter) show minimal difference since indexes provide no shortcut

On larger graphs (hundreds or thousands of nodes), the speedup from indexes becomes more pronounced as full-graph scans scale linearly with graph size.

## Next Steps

- **[Query Guide](query-guide)** — Full Cypher syntax reference and query patterns
- **[Library API](library-api)** — Programmatic access to the engine and index builder