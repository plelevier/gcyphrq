# AGENTS.md

## Project Overview

CLI tool that executes Cypher queries against an in-memory [Graphology](https://graphology.github.io/) graph. Parse a JSON graph, run a Cypher query, output raw JSON results.

**Stack:** TypeScript, esbuild, Graphology, ANTLR4 (`@neo4j-cypher/antlr4`), vitest

## Commands

```bash
npm run build      # Compile to dist/index.js (esbuild)
npm start          # Run from source (tsx)
npm run dev        # Watch mode (tsx watch)
npm test           # Run tests (vitest)
```

Run CLI directly:

```bash
npx tsx src/index.ts -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s'
```

Both `-e` (query) and `-g` (graph file or `-` for stdin) are required.

## Architecture

```
src/
├── index.ts                 # CLI entry: arg parsing, graph loading, orchestration
├── lib.ts                   # Public library API (createGraph, executeQuery, parseCypher, etc.)
├── graph.ts                 # Graphology wrapper: typed GraphInstance + runtime API check
├── indexes.ts               # Pre-computed indexes for O(1) label/property/edge-type lookups
├── install.ts               # Install helper (postinstall, etc.)
├── engine/
│   ├── cypher-parser.ts     # ANTLR4-based Cypher → AST (wraps @neo4j-cypher/antlr4)
│   └── cypher-engine.ts     # AST execution engine on top of Graphology graphs
└── types/
    ├── cypher.ts            # AST types (NodePattern, MatchClause, Expression, ...)
    └── antlr4.d.ts          # Declaration file for ANTLR4 runtime
```

### Data flow

1. `index.ts` parses CLI args, loads a JSON graph file, delegates to `lib.ts`
2. `lib.ts` validates data, builds `GraphInstance` (`graph.ts`) + indexes (`indexes.ts`)
3. `cypher-parser.ts` parses Cypher string → `AdvancedCypherAST`
4. `cypher-engine.ts` walks AST stages sequentially over the graph using indexes
5. Results emitted as raw JSON to stdout

### Library API (`lib.ts`)

- **`createGraph(data)`** — Validate graph data, build `GraphInstance`
- **`buildGraphIndexes(data, graph)`** — Build pre-computed indexes
- **`parseCypher(query)`** — Parse Cypher string → AST
- **`executeQuery(graphData, query)`** — One-shot: graph data + query → results
- **`GraphEngine`** — Query engine class (alias for `AdvancedCypherGraphologyEngine`)

### Graph file format

Uses [Graphology JSON format](https://graphology.github.io/):

```json
{
  "nodes": [{ "key": "alice", "attributes": { "label": "User", "name": "Alice" } }],
  "edges": [{ "source": "alice", "target": "bob", "attributes": { "type": "FRIEND" } }]
}
```

- `nodes[].key` — required, unique identifier
- `nodes[].attributes` — required, node properties (`label` used for Cypher label filtering)
- `edges[].source` / `edges[].target` — required, node keys
- `edges[].attributes` — required, edge properties (`type` used for relationship filtering)
- `options` — optional (`type` can be `"directed"`, `"undirected"`, or `"mixed"`; `allowSelfLoops` and `multi` cause errors)

Omit `options` — defaults to a directed graph. Use `type: 'undirected'` or `type: 'mixed'` for undirected or mixed graphs respectively. In mixed graphs, set `undirected: true` on edges to make them bidirectional.

## Supported Cypher Features

**Supported:** MATCH (labels/properties), OPTIONAL MATCH, variable-length paths `*min..max`, directional edges (`->`, `<-`, `-`), RETURN (property access, aliases), WITH + implicit grouping, aggregations (`count`, `sum`, `avg`, `min`, `max`), WHERE (`>`, `<`, `=`, `<>`, `CONTAINS`, `AND`/`OR`/`NOT`, IS NULL/IS NOT NULL), CREATE/SET/DELETE mutations, ORDER BY (multi-column, ASC/DESC), SKIP, LIMIT, multiple chained clauses (single MATCH per stage).

**Not supported:** Subqueries, `CALL`, APOC.

## Key Conventions

- **Raw JSON stdout** — no prefixes, no markdown. Pipe-friendly for `jq`.
- **Errors to stderr** with `Error: ` prefix, exit code 1.
- **No default graph** — `-g` always required.
- **Single MATCH per stage** — chained MATCHes not supported.
- **AST types in `src/types/cypher.ts`** — add new types there first.
- **Tests in `test/`** — one file per module.

## Example Graphs

| File | Description |
|---|---|
| `examples/social-graph.json` | 3-node social network (Alice, Bob, Charlie) |
| `examples/cloud-infra.json` | 51-node startup cloud infrastructure (services, queues, DBs, monitoring) |
| `examples/team.json` | Team/org structure |

See `examples/README.md` for 12 query examples against `cloud-infra.json`.

## Docs

- `docs/query-guide.md` — Cypher syntax reference and query patterns (Jekyll site at `docs/`)
- `docs/library-api.md` — Library API reference
- `docs/examples.md` — Ready-to-run query examples
- `docs/cli.md` — CLI usage reference
- `docs/getting-started.md` — Getting started guide
- `examples/README.md` — Graph file format and CLI query examples
