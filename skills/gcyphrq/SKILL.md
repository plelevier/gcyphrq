---
name: gcyphrq
description: "Use for querying graph data with Cypher — service dependencies, infrastructure topology, blast radius analysis, path tracing, graph mutations. Runs against JSON graph files with an in-memory Cypher engine supporting MATCH, OPTIONAL MATCH, MERGE, WITH, UNWIND, RETURN DISTINCT, aggregations (including DISTINCT), ORDER BY, SKIP, LIMIT, variable-length paths, IN/STARTS WITH/ENDS WITH, IS NULL/IS NOT NULL, string comparisons, and CREATE/SET/DELETE/REMOVE mutations."
---

# gcyphrq

Execute Cypher queries against JSON graph files. Outputs raw JSON to stdout.

## Workflow

1. Find the graph file (`.json` with `{nodes, edges}`) or let the user name it
2. Build Cypher query from patterns below or `references/queries.md`
3. Run: `gcyphrq -g <graph.json> -e '<cypher>'`

## CLI Reference

```bash
gcyphrq -g graph.json -e 'MATCH (n:Service) RETURN n'    # query file
cat graph.json | gcyphrq -g - -e '...'                    # stdin
gcyphrq -g g.json -e '...' --format rows                  # force rows output
gcyphrq -g g.json -nl kind -et rel -e '...'              # custom label/edge-type properties
```

Flags: `-e` (query, required), `-g` (file or `-` for stdin, required), `-nl` (label property, default `"label"`), `-et` (edge type property, default `"type"`), `--format graph|rows`. Graph output is chainable via `-g -`; scalars auto-fallback to rows.

## Graph File Format

Graphology JSON: `{ nodes: [{ key, attributes }], edges: [{ source, target, attributes }] }`.

- `attributes.label` → Cypher node label (`:Service`). Customize with `-nl` CLI flag.
- `attributes.type` on edges → relationship type (`[:TCP]`). Customize with `-et` CLI flag.
- All other attributes → filterable properties (`{name: "X"}`, `{region: "us-east-1"}`)

## Supported Cypher

| Category | Supported |
|---|---|
| Matching | `MATCH (n:Label {prop: val})-[:TYPE*min..max]->(m)`, `OPTIONAL MATCH`, edge binding `-[r:TYPE]->` |
| Filtering | `WHERE`: `=`, `<>`, `>`, `<`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IN`, `IS NULL`, `IS NOT NULL`, `AND`/`OR`/`NOT`. `<`/`>` work with strings too. |
| Pipelining | `WITH`, `count()`, `sum()`, `avg()`, `min()`, `max()`, `count(DISTINCT)`, `sum(DISTINCT)`, `avg(DISTINCT)` |
| Expansion | `UNWIND list AS var` (expands list to one row per element) |
| Output | `RETURN` (nodes, properties, aliases), `RETURN DISTINCT`, `ORDER BY`, `SKIP`, `LIMIT` |
| Mutations | `CREATE`, `SET`, `DELETE`, `REMOVE`, `MERGE` (in-memory only) |
| **Not supported** | chained `MATCH`, subqueries, `CALL`, APOC, `labels()`, `head()`, MERGE with WHERE, MERGE with DELETE/REMOVE |

## When to Use

Trigger for: service dependencies, blast radius / impact analysis, path tracing, infrastructure topology, replication / failover, monitoring coverage, degree analysis, external dependencies, graph mutations, idempotent data seeding with MERGE.

## Cypher Patterns

> Replace `<graph>` with the graph file path. Full command: `gcyphrq -g <graph> -e '<cypher>'`

| Task | Cypher |
|---|---|
| List nodes by label | `MATCH (n:Service) RETURN n` |
| Filter by property | `MATCH (n:Service {type: "RPC"}) RETURN n` |
| Incoming connections | `MATCH (s)-[:TCP]->(db:Database {name: "PostgreSQL"}) RETURN s` |
| Outgoing connections | `MATCH (db:Database)-[]->(t) RETURN db, t` |
| Path tracing | `MATCH (a {name: "X"})-[r*1..3]->(b {name: "Y"}) RETURN a, r, b` |
| Blast radius (all directions) | `MATCH (root {name: "X"})-[r*1..2]-(affected) RETURN root, r, affected` |
| Blast radius (downstream) | `MATCH (root {name: "X"})-[r*1..2]->(d) RETURN root, r, d` |
| Out-degree per node | `MATCH (n)-[]->(t) WITH n, count(t) AS deg RETURN n, deg` |
| WHERE AND/OR/NOT/CONTAINS/IN | `MATCH (n) WHERE n.name CONTAINS "api" AND n.type IN ["RPC"] RETURN n` |
| IS NULL / IS NOT NULL | `MATCH (n) WHERE n.status IS NULL RETURN n` |
| OPTIONAL MATCH | `MATCH (n) OPTIONAL MATCH (n)-[]->(m) WHERE m IS NULL RETURN n` |
| Sort + paginate | `MATCH (n:Service) RETURN n.name ORDER BY n.name SKIP 10 LIMIT 5` |
| Group by property | `MATCH (n:Service) WITH n.type AS t, count(n) AS c RETURN t, c` |
| RETURN DISTINCT | `MATCH (n:Service) RETURN DISTINCT n.type` |
| CREATE | `CREATE (n:Service {name: "X", type: "RPC"}) RETURN n` |
| SET | `MATCH (n {name: "X"}) SET n.status = "updated" RETURN n` |
| DELETE | `MATCH (n {name: "X"}) DELETE n` |
| REMOVE (label) | `MATCH (n {name: "X"}) REMOVE n:Label RETURN n` |
| MERGE | `MERGE (n:User {name: "Alice"}) ON CREATE SET n.createdAt = 0 RETURN n` |
| MERGE relationship chain | `MERGE (a:User)-[:FRIEND]->(b:User) RETURN a, b` |
| UNWIND | `UNWIND ["a", "b", "c"] AS x RETURN x` |

See `references/queries.md` for more patterns (blast radius variants, degree thresholds, string comparisons, DISTINCT aggregations, etc.).

## Output Format

`graph` (default): `{nodes, edges}` chainable via `-g -`. `rows` (auto-fallback or `--format rows`): `[...]` for scalars/aggregations. Errors to stderr with `Error: ` prefix, exit code 1.

## Key Limitations

- Single `MATCH` per stage, no chained `MATCH`, subqueries, `CALL`, APOC, `labels()`, `head()`
- No regex or custom functions in `WHERE`
- `avg()`/`min()`/`max()` return null on empty numeric sets
- No nested property access beyond one level
- MERGE: no WHERE, no DELETE/REMOVE in ON CREATE/ON MATCH (SET only)
- REMOVE: label removal only (`REMOVE n:Label`), no property removal (`REMOVE n.prop`)

## Bundled Reference Graph

`references/example-graph.json` — 8 nodes, 10 edges: Services (API Gateway, Auth, User, Notification Worker), Databases (PostgreSQL, Redis), Infrastructure (Kafka), Monitoring (Prometheus). Edges: HTTPS, TCP, Metrics.

## References

- `references/example-graph.json` — Bundled test graph
- `references/queries.md` — Use-case query examples (blast radius, dependencies, monitoring, etc.). Load when the user asks a specific infrastructure question and you need a concrete pattern to adapt.
