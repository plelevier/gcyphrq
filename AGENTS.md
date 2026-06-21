# AGENTS.md

## Project Overview

A CLI tool that executes Cypher graph queries against an in-memory graph built on [Graphology](https://graphology.github.io/). Parse a graph from a JSON file (or stdin), run a Cypher query, and get raw JSON results.

**Stack:** TypeScript, esbuild, Graphology, ANTLR4 (via `@neo4j-cypher/antlr4`), vitest

## Commands

```bash
npm run build      # Compile to dist/index.js (esbuild)
npm start          # Run from source (tsx)
npm run dev        # Watch mode (tsx watch)
npm test           # Run tests (vitest)
```

Run the CLI directly:

```bash
npx tsx src/index.ts -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s'
```

Both `-e` (query) and `-g` (graph file or `-` for stdin) are required.

## Architecture

```
src/
├── index.ts                 # CLI entry: arg parsing, graph loading, orchestration
├── lib.ts                   # Public library API (createGraph, executeQuery, parseCypher, etc.)
├── graph.ts                 # Graphology wrapper: typed GraphInstance interface + runtime API check
├── indexes.ts               # Pre-computed indexes for O(1) label/property/edge-type lookups
├── engine/
│   ├── cypher-parser.ts     # ANTLR4-based Cypher → AST (wraps @neo4j-cypher/antlr4)
│   └── cypher-engine.ts     # AST execution engine on top of Graphology graphs
└── types/
    ├── cypher.ts            # AST types (NodePattern, MatchClause, Expression, ...)
    └── antlr4.d.ts          # Declaration file for ANTLR4 runtime
```

### Data flow

1. `index.ts` parses CLI args, loads a JSON graph file, and delegates to `lib.ts`
2. `lib.ts` validates graph data, constructs a `GraphInstance` (via `graph.ts`), and builds pre-computed indexes (via `indexes.ts`)
3. `cypher-parser.ts` uses ANTLR4 to parse a Cypher string into an `AdvancedCypherAST`
4. `cypher-engine.ts` walks the AST stages sequentially over the graph, using indexes for fast lookups
5. Results are emitted as raw JSON to stdout

### Library API (`lib.ts`)

The tool can also be used as a library in Node.js / TypeScript projects:

- **`createGraph(data)`** — Validate graph data and build a `GraphInstance`
- **`buildGraphIndexes(data, graph)`** — Build pre-computed indexes for fast query execution
- **`parseCypher(query)`** — Parse a Cypher string into an AST
- **`executeQuery(graphData, query)`** — One-shot convenience: graph data + query → results
- **`GraphEngine`** — The query engine class (alias for `AdvancedCypherGraphologyEngine`)

### Graph file format

```json
{
  "nodes": [{ "id": "alice", "label": "User", "name": "Alice" }],
  "edges": [{ "source": "alice", "target": "bob", "type": "FRIEND" }]
}
```

## Supported Cypher Features

| Feature | Status |
|---|---|
| `MATCH` with node labels and properties | ✅ |
| Variable-length paths `*min..max` | ✅ |
| Directional edges `->`, `<-`, `-` | ✅ |
| `OPTIONAL MATCH` | ✅ |
| `RETURN` with property access and aliases | ✅ |
| `WITH` + implicit grouping | ✅ |
| `count()`, `sum()`, `avg()`, `min()`, `max()` aggregations | ✅ |
| `WHERE` (on `MATCH` and `WITH`) | ✅ |
| `WHERE` operators: `>`, `<`, `=`, `<>`, `CONTAINS` | ✅ |
| `WHERE` logical operators: `AND`, `OR`, `NOT` | ✅ |
| `CREATE`, `SET`, `DELETE` mutations | ✅ |
| Multiple chained clauses | ✅ (single MATCH per stage) |
| `ORDER BY` (single/multi-column, ASC/DESC) | ✅ |
| `SKIP` | ✅ |
| `LIMIT` | ✅ |
| Subqueries, `CALL`, APOC | ❌ |

## Key Conventions

- **Raw JSON output only** — no prefixes, no markdown. Stdout is pipe-friendly for `jq`.
- **Errors go to stderr** with `Error: ` prefix, exit code 1.
- **No default graph** — the tool always requires `-g`.
- **Single MATCH per stage** — the engine processes one MATCH clause at a time; chained MATCHes are not supported.
- **AST types live in `src/types/cypher.ts`** — add new expression or clause types there first.
- **Tests in `test/`** — one file per module (`cypher-parser.test.ts`, `cypher-engine.test.ts`).

## Example Graphs

| File | Description |
|---|---|
| `examples/social-graph.json` | 3-node social network (Alice, Bob, Charlie) |
| `examples/cloud-infra.json` | 52-node startup cloud infrastructure (services, queues, DBs, monitoring) |

See `examples/README.md` for 12 query examples against `cloud-infra.json`.

## Docs

- `docs/query-guide.md` — Cypher syntax reference and query patterns (Jekyll site at `docs/`)
- `docs/library-api.md` — Library API reference
- `docs/examples.md` — Ready-to-run query examples
- `examples/README.md` — graph file format and CLI query examples
