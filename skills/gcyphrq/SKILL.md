---
name: gcyphrq
description: "Use for querying graph data with Cypher — service dependencies, infrastructure topology, blast radius analysis, path tracing. Runs against JSON graph files with an in-memory Cypher engine supporting MATCH, OPTIONAL MATCH, WITH, aggregations, ORDER BY, SKIP, LIMIT, variable-length paths, IS NULL/IS NOT NULL, and mutations."
---

# gcyphrq

Execute Cypher queries against JSON graph files. Outputs raw JSON to stdout.

## Workflow

1. **Find the graph file** — look for `.json` files with `{nodes, edges}` structure (Graphology format). The user may name it directly or it may be in `infra/`, `graph/`, `data/`, etc.
2. **Build the Cypher query** — use the patterns below or load `references/queries.md` for use-case-specific examples
3. **Run:** `gcyphrq -g <graph.json> -e '<cypher>'`
4. **Interpret results** — graph format `{nodes, edges}` for structure; rows format `[...]` for scalars/aggregations

## CLI Reference

```bash
gcyphrq -g graph.json -e 'MATCH (n:Service) RETURN n'    # query file
cat graph.json | gcyphrq -g - -e '...'                    # stdin
gcyphrq -g g.json -e '...' --format rows                  # force rows output
```

| Flag | Description |
|---|---|
| `-e <query>` | Cypher expression (required) |
| `-g <file\|->` | graph JSON file or `-` for stdin (required) |
| `--format graph\|rows` | `graph` (default, chainable) or `rows` (array of objects) |

Graph format output can be piped back via `-g -` to chain queries. Scalar results (property access, aggregations) auto-fall back to rows format.

## Graph File Format

Graphology JSON: `{ nodes: [{ key, attributes }], edges: [{ source, target, attributes }] }`.

- `attributes.label` → Cypher node label (`:Service`)
- `attributes.type` on edges → relationship type (`[:TCP]`)
- All other attributes → filterable properties (`{name: "X"}`, `{region: "us-east-1"}`)

## Supported Cypher

| Category | Supported |
|---|---|
| Matching | `MATCH (n:Label {prop: val})-[:TYPE*min..max]->(m)`, `OPTIONAL MATCH`, edge binding `-[r:TYPE]->` |
| Filtering | `WHERE`: `=`, `<>`, `>`, `<`, `CONTAINS`, `IS NULL`, `IS NOT NULL`, `AND`/`OR`/`NOT` |
| Pipelining | `WITH`, `count()`, `sum()`, `avg()`, `min()`, `max()` |
| Output | `RETURN` (nodes, properties, aliases), `ORDER BY`, `SKIP`, `LIMIT` |
| Mutations | `CREATE`, `SET`, `DELETE` (in-memory only) |
| **Not supported** | chained `MATCH`, subqueries, `CALL`, APOC, `labels()`, `head()` |

## When to Use

Trigger for: service dependencies, blast radius / impact analysis, path tracing, infrastructure topology, replication / failover, monitoring coverage, degree analysis, external dependencies, graph mutations.

## Cypher Patterns

> Replace `<graph>` with the actual graph file path. Full command: `gcyphrq -g <graph> -e '<cypher>'`

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
| Out-degree threshold | `MATCH (n)-[]->(t) WITH n, count(t) AS deg WHERE deg > 2 RETURN n, deg` |
| In-degree per node | `MATCH (src)-[]->(n) WITH n, count(src) AS deg RETURN n, deg` |
| WHERE AND | `MATCH (n:Service) WHERE n.type = "RPC" AND n.region = "us-east-1" RETURN n` |
| WHERE OR | `MATCH (n:Service) WHERE n.type = "RPC" OR n.type = "Worker" RETURN n` |
| WHERE NOT | `MATCH (n:Service) WHERE NOT n.type = "RPC" RETURN n` |
| CONTAINS | `MATCH (n) WHERE n.name CONTAINS "api" RETURN n` |
| IS NULL | `MATCH (n) WHERE n.status IS NULL RETURN n` |
| IS NOT NULL | `MATCH (n) WHERE n.status IS NOT NULL RETURN n` |
| OPTIONAL MATCH | `MATCH (n) OPTIONAL MATCH (n)-[]->(m) WHERE m IS NULL RETURN n` |
| Sort + paginate | `MATCH (n:Service) RETURN n.name ORDER BY n.name ASC SKIP 10 LIMIT 5` |
| Group by property | `MATCH (n:Service) WITH n.type AS t, count(n) AS c RETURN t, c` |
| Count all edges | `MATCH ()-[r]->() RETURN count(r) AS total` |
| CREATE | `CREATE (n:Service {name: "X", type: "RPC"}) RETURN n` |
| SET | `MATCH (n {name: "X"}) SET n.status = "updated" RETURN n` |
| DELETE | `MATCH (n {name: "X"}) DELETE n` |

## Output Format

- **`graph` (default):** `{ nodes: [{key, attributes}], edges: [{source, target, attributes}] }` — chainable via `-g -`. Preserves unique nodes/edges and all properties. Loses variable bindings and row pairing.
- **`rows` (auto-fallback or `--format rows`):** `[ {alias: val}, ... ]` — use for scalars, aggregations, or `jq` piping.

Errors go to stderr with `Error: ` prefix, exit code 1.

## Key Limitations

- Single `MATCH` per stage (no `MATCH (a) MATCH (b)`)
- No subqueries, `CALL`, APOC, `labels()`, `head()`
- No regex or custom functions in `WHERE`
- `avg()`/`min()`/`max()` return null on empty numeric sets
- No nested property access beyond one level

## Bundled Reference Graph

`references/example-graph.json` — 8 nodes, 10 edges:

| Node | Label | Key Properties |
|---|---|---|
| API Gateway, Auth Service, User Service | Service | type: RPC, region |
| Notification Worker | Service | type: Worker, region |
| PostgreSQL Primary, Redis Cache | Database | type: relational / cache |
| Kafka Cluster | Infrastructure | type: MessageQueue |
| Prometheus | Monitoring | type: Metrics |

Edges: HTTPS (API→services), TCP (services→DBs/queues), Metrics (services→Prometheus).

## References

- `references/example-graph.json` — Bundled test graph
- `references/queries.md` — Use-case query examples (blast radius, dependencies, monitoring, etc.). Load when the user asks a specific infrastructure question and you need a concrete pattern to adapt.
