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

**Graph format:** `{ nodes: [{key, attributes}], edges: [{source, target, attributes}] }`. `attributes.label` → Cypher label, `attributes.type` on edges → relationship type. Customize with `-nl`/`-et` CLI flags or `opts.config`. Optional `options.allowSelfLoops: true` enables self-loop edges. Optional `options.multi: true` enables parallel edges (multiple edges between the same nodes).

## Supported Cypher

**Clauses:** MATCH (`:A`, `:A:B` AND, `:A|B` OR, `:!A`), `MATCH path=(a)-[r]->(b)` path variable binding, OPTIONAL MATCH, chained MATCH (`MATCH (a) MATCH (b)` cartesian product), MERGE (single node + chains, WHERE filter, ON CREATE/ON MATCH with SET/DELETE/DETACH DELETE/REMOVE), variable-length `*min..max`, directional edges (`->`, `<-`, `-`), RETURN (property access, aliases), RETURN DISTINCT, WITH + grouping, UNWIND, FOREACH (SET, CREATE, DELETE, DETACH DELETE, REMOVE on nodes and edges), CREATE (single node or chain `(a)-[r:TYPE]->(b)` with directional edges), SET/DELETE/REMOVE (`REMOVE n:Label` partial, `REMOVE n.prop`), DETACH DELETE, ORDER BY (multi, ASC/DESC), SKIP, LIMIT, UNION/UNION ALL (each branch must end with RETURN, ORDER BY/SKIP/LIMIT apply to combined result), `CASE ... WHEN ... END` (general and simple forms, nested, in RETURN/WHERE/WITH/ORDER BY/SET), `CALL { ... }` subqueries (inline, YIELD, nested, with CREATE/SET/DELETE inside).

**Aggregations:** `count`, `sum`, `avg`, `min`, `max`, `collect`, `count(*)`, `count(DISTINCT)`, `sum(DISTINCT)`, `avg(DISTINCT)`, `collect(DISTINCT)`. `collect()` includes null values.
**Reduce:** `reduce(initial, var IN list | body)` folds a list with an accumulator. Not itself an aggregation — triggers aggregation only when sub-expressions contain aggregations (e.g., `reduce(..., x IN collect(y) | ...)`). Works in RETURN/WITH.
**Quantifiers:** `ALL(x IN list WHERE pred)`, `ANY(x IN list WHERE pred)`, `SINGLE(x IN list WHERE pred)`, `NONE(x IN list WHERE pred)`. Work in WHERE clauses (standalone or combined with AND/OR/NOT). Empty list: ALL/NONE → true (vacuous truth), ANY/SINGLE → false.
**EXISTS:** `EXISTS(expression)` — true if expression is not null/undefined. Works in WHERE (standalone or with NOT). Supports property access, function calls, list slicing.
**Arithmetic:** `+` supports string concatenation when both operands are strings.

**Scalar functions:** 29+ (`toLower`, `toUpper`, `substring`, `split`, `repl`, `trim`, `ltrim`, `rtrim`, `length`, `head`, `last`, `tail`, `reverse`, `size`, `id`, `labels`, `labelsOf`, `nodes`, `relationships`, `reltype`, `startnode`, `endnode`, `coalesce`, `toString`, `toInteger`, `toFloat`, `exists`). Work in RETURN/WHERE/WITH/ORDER BY, nested supported. Note: `repl`/`reltype` (not `replace`/`type`) — ANTLR4 reserved. `labels(n)` works as sole RETURN item only (ANTLR4 keyword limitation); use `labelsOf(n)` everywhere else. `nodes(path)`/`relationships(path)` extract from path variables (sole RETURN item only). `startnode()`/`endnode()` return string IDs. `labels()`, `nodes()`, `relationships()` do not support `AS` aliases (ANTLR4 grammar limitation).

**Path expressions:** `shortestPath((a)-[*]->(b))` returns the single shortest path (unweighted BFS); `allShortestPaths((a)-[*]->(b))` returns all paths of minimum length. Support type filtering (`[:TYPE*]`), direction (`->`, `<-`, `-`), and variable-length bounds (`*min..max`). Variables `a`/`b` must be bound in the query context. Uses `graphology-shortest-path` library.

**Arithmetic expressions:** `+`, `-`, `*`, `/`, `%`, `^`, unary `+`/`-`. Work in RETURN/WHERE/WITH/ORDER BY/SET. Parentheses for grouping. Null propagation (any null operand → null). Division/modulo by zero → null.

**List literals:** `['a', 'b']` in RETURN/WHERE/UNWIND/SET/CREATE. Dynamic values (`[n.name, toUpper(n.name), n]`). Slicing `[start..end]`, `[..end]`, `[start..]`, `[index]` with negative indices.

**Map literals:** `{key: val}` in RETURN/WHERE/WITH/UNWIND/SET. Dynamic values (`{name: n.name, tags: split(n.name, ""), node: n}`). WHERE `n = {prop: val}` uses subset matching with deep equality.

**WHERE:** `=`, `<>`, `>`, `>=`, `<`, `<=`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IN` (lists, property access, function calls), `AND`/`OR`/`NOT`, IS NULL/IS NOT NULL, string `<`/`>`/`<=`/`>=`, map comparison.

**Not supported:** Stored procedures (`CALL db.xxx()`), APOC, UNION without RETURN in each branch.

## Conventions

- **Raw JSON stdout** — pipe-friendly for `jq`
- **Errors to stderr** with `Error: ` prefix, exit code 1
- AST types in `src/types/cypher.ts` (add new types there first)
- Tests in `test/` (one file per module)

## Example Graphs

`examples/social-graph.json` (3-node social), `examples/cloud-infra.json` (51-node cloud infra), `examples/team.json` (team/org). See `examples/README.md` for 12 query examples.

Docs: `docs/query-guide.md`, `docs/library-api.md`, `docs/cli.md`.
