# AGENTS.md

CLI tool executing Cypher queries against an in-memory [Graphology](https://graphology.github.io/) graph. JSON graph in, raw JSON results out.

**Stack:** TypeScript, esbuild, Graphology, ANTLR4 (`@neo4j-cypher/antlr4`), vitest

## Commands

```bash
npm run build      # Compile to dist/index.js
npm start          # Run from source (tsx)
npm run dev        # Watch mode
npm test           # Run tests (vitest)
npx tsx src/index.ts -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s'
```

Both `-e` (query) and `-g` (graph file or `-` for stdin) are required.

## Architecture

```
src/
├── index.ts                 # CLI entry
├── lib.ts                   # Public API: createGraph, executeQuery, parseCypher, GraphEngine
├── graph.ts                 # Graphology wrapper
├── indexes.ts               # Pre-computed indexes
├── arithmetic.ts            # Shared arithmetic evaluation
├── engine/
│   ├── cypher-parser.ts     # ANTLR4 Cypher → AST
│   └── cypher-engine.ts     # AST execution engine
└── types/
    ├── cypher.ts            # AST types
    └── antlr4.d.ts          # ANTLR4 declarations
```

**Data flow:** CLI → `lib.ts` (validate, build graph + indexes) → `cypher-parser.ts` (Cypher → AST) → `cypher-engine.ts` (walk AST) → raw JSON stdout.

**Library API (`lib.ts`):** `createGraph(data)`, `buildGraphIndexes(data, graph, opts?)`, `parseCypher(query)`, `executeQuery(graphData, query, opts?)`, `GraphEngine`. All accept `opts.config` except `createGraph`.

**Graph format:** `{ nodes: [{key, attributes}], edges: [{source, target, attributes}] }`. `attributes.label` → Cypher label, `attributes.type` on edges → relationship type. Customize with `-nl`/`-et` CLI flags or `opts.config`.

## Supported Cypher

**Clauses:** MATCH (`:A`, `:A:B` AND, `:A|B` OR, `:!A`), `MATCH path=(a)-[r]->(b)` path variable binding, OPTIONAL MATCH, MERGE (single node + chains, WHERE filter, ON CREATE/ON MATCH with SET/DELETE/REMOVE), variable-length `*min..max`, directional edges (`->`, `<-`, `-`), RETURN (property access, aliases), RETURN DISTINCT, WITH + grouping, UNWIND, FOREACH (SET, CREATE, DELETE, REMOVE on nodes and edges), CREATE/SET/DELETE/REMOVE (`REMOVE n:Label` partial, `REMOVE n.prop`), ORDER BY (multi, ASC/DESC), SKIP, LIMIT, UNION/UNION ALL (each branch must end with RETURN, ORDER BY/SKIP/LIMIT apply to combined result), `CASE ... WHEN ... END` (general and simple forms, nested, in RETURN/WHERE/WITH/ORDER BY/SET).

**Aggregations:** `count`, `sum`, `avg`, `min`, `max`, `count(DISTINCT)`, `sum(DISTINCT)`, `avg(DISTINCT)`.

**Scalar functions:** 28+ (`toLower`, `toUpper`, `substring`, `split`, `repl`, `trim`, `ltrim`, `rtrim`, `length`, `head`, `last`, `tail`, `reverse`, `size`, `id`, `labels`, `labelsOf`, `nodes`, `relationships`, `reltype`, `startnode`, `endnode`, `coalesce`, `toString`, `toInteger`, `toFloat`). Work in RETURN/WHERE/WITH/ORDER BY, nested supported. Note: `repl`/`reltype` (not `replace`/`type`) — ANTLR4 reserved. `labels(n)` works as sole RETURN item only (ANTLR4 keyword limitation); use `labelsOf(n)` everywhere else. `nodes(path)`/`relationships(path)` extract from path variables (sole RETURN item only). `startnode()`/`endnode()` return string IDs. `labels()`, `nodes()`, `relationships()` do not support `AS` aliases (ANTLR4 grammar limitation).

**Arithmetic expressions:** `+`, `-`, `*`, `/`, `%`, `^`, unary `+`/`-`. Work in RETURN/WHERE/WITH/ORDER BY/SET. Parentheses for grouping. Null propagation (any null operand → null). Division/modulo by zero → null.

**List literals:** `['a', 'b']` in RETURN/WHERE/UNWIND/SET/CREATE. Dynamic values (`[n.name, toUpper(n.name), n]`). Slicing `[start..end]`, `[..end]`, `[start..]`, `[index]` with negative indices.

**Map literals:** `{key: val}` in RETURN/WHERE/WITH/UNWIND/SET. Dynamic values (`{name: n.name, tags: split(n.name, ""), node: n}`). WHERE `n = {prop: val}` uses subset matching with deep equality.

**WHERE:** `=`, `<>`, `>`, `>=`, `<`, `<=`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IN` (lists, property access, function calls), `AND`/`OR`/`NOT`, IS NULL/IS NOT NULL, string `<`/`>`/`<=`/`>=`, map comparison.

**Not supported:** Subqueries, `CALL`, APOC, chained MATCH, UNION without RETURN in each branch.

## Conventions

- **Raw JSON stdout** — pipe-friendly for `jq`
- **Errors to stderr** with `Error: ` prefix, exit code 1
- AST types in `src/types/cypher.ts` (add new types there first)
- Tests in `test/` (one file per module)

## Example Graphs

`examples/social-graph.json` (3-node social), `examples/cloud-infra.json` (51-node cloud infra), `examples/team.json` (team/org). See `examples/README.md` for 12 query examples.

Docs: `docs/query-guide.md`, `docs/library-api.md`, `docs/cli.md`.
