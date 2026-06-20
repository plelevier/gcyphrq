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
├── engine/
│   ├── cypher-parser.ts     # ANTLR4-based Cypher → AST (wraps @neo4j-cypher/antlr4)
│   └── cypher-engine.ts     # AST execution engine on top of Graphology graphs
└── types/
    ├── cypher.ts            # AST types (NodePattern, MatchClause, Expression, ...)
    └── antlr4.d.ts          # Declaration file for ANTLR4 runtime
```

### Data flow

1. `index.ts` parses CLI args, loads a JSON graph file, builds a Graphology graph
2. `cypher-parser.ts` uses ANTLR4 to parse a Cypher string into an `AdvancedCypherAST`
3. `cypher-engine.ts` walks the AST stages sequentially over the graph
4. Results are emitted as raw JSON to stdout

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
| `WHERE` (on `WITH`) with `>`, `<`, `=`, `CONTAINS` | ✅ |
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
