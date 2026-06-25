---
name: gcyphrq
description: "Use for querying graph data with Cypher — service dependencies, infrastructure topology, blast radius analysis, path tracing, graph mutations. Runs against JSON graph files with an in-memory Cypher engine."
---

# gcyphrq

Execute Cypher queries against JSON graph files. Outputs raw JSON to stdout.

## Workflow

1. Find the graph file (`.json` with `{nodes, edges}`) or let the user name it
2. Build Cypher query from patterns below or `references/queries.md`
3. Run: `gcyphrq -g <graph.json> -e '<cypher>'`

## CLI Reference

`gcyphrq -g <graph.json> -e '<cypher>'`. Flags: `-e` (query, required), `-g` (file or `-` stdin, required), `-nl` (label property, default `"label"`), `-et` (edge type property, default `"type"`), `--format graph|rows`. Output chainable via `-g -`; scalars auto-fallback to rows.

## Graph File Format

```json
{
  "nodes": [{ "key": "id1", "attributes": { "label": "Service", "name": "api", "region": "us-east-1" } }],
  "edges": [{ "source": "id1", "target": "id2", "attributes": { "type": "TCP" } }]
}
```

- `attributes.label` → Cypher node label (`:Service`). Can be string or array of strings (`["Service","Infrastructure"]`). Customize with `-nl` flag.
- `attributes.type` on edges → relationship type (`[:TCP]`). Customize with `-et` flag.
- All other attributes → filterable properties (`{name: "X"}`, `{region: "us-east-1"}`)
- Optional `options.allowSelfLoops: true` enables self-loop edges (`source = target`). Defaults to `false`.
- Optional `options.multi: true` enables parallel edges (multiple edges between same nodes). Defaults to `false`.

## Supported Cypher

See `AGENTS.md` → Supported Cypher for full details. Key highlights:

- **Matching:** `MATCH`, `OPTIONAL MATCH`, chained `MATCH` (cartesian product), labels `:A:B` (AND), `:A|B` (OR), `:!A` (NOT), variable-length `*min..max`, directional edges
- **Filtering:** `WHERE` with `=`, `<>`, `>`, `>=`, `<`, `<=`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IN`, `IS NULL`, `AND`/`OR`/`NOT`, map comparison
- **CASE:** `CASE WHEN cond THEN result` and `CASE expr WHEN val THEN result`. Nested. In RETURN/WHERE/WITH/ORDER BY/SET
- **Pipelining:** `WITH` + `count()`, `count(*)`, `sum()`, `avg()`, `min()`, `max()`, `collect()`, `collect(DISTINCT)`, `count(DISTINCT)`, `sum(DISTINCT)`, `avg(DISTINCT)`
- **Reduce:** `reduce(init, var IN list | body)` folds a list. Not itself an aggregation — triggers grouping only when sub-expressions contain aggregations (e.g., `reduce(..., x IN collect(y) | ...)`)
- **UNION/UNION ALL:** combine results from multiple branches (each ending with `RETURN`), ORDER BY/SKIP/LIMIT on combined result
- **Scalar functions:** 28+ (`toLower`, `substring`, `split`, `coalesce`, `size`, `labels` (sole RETURN item only), `labelsOf` (everywhere), `nodes` (sole RETURN item only), `relationships` (sole RETURN item only), etc.)
- **Path expressions:** `shortestPath((a)-[*]->(b))` returns single shortest path (BFS); `allShortestPaths((a)-[*]->(b))` returns all minimum-length paths. Supports type filtering (`[:TYPE*]`), direction (`->`, `<-`, `-`), and depth bounds (`*min..max`). Variables must be bound in query context.
- **Arithmetic:** `+`, `-`, `*`, `/`, `%`, `^`, unary `+`/`-`, parentheses. `+` concatenates strings. Null propagation, div/mod by zero → null
- **List/Map literals:** dynamic values, list slicing `[start..end]` with negative indices
- **Mutations:** `CREATE` (single node or chain `(a)-[r:TYPE]->(b)`), `SET`, `DELETE`, `DETACH DELETE`, `REMOVE`, `MERGE` (in-memory only). MERGE: supports WHERE filter, ON CREATE/ON MATCH with SET/DELETE/DETACH DELETE/REMOVE. CREATE chain: reuses bound nodes, creates unbound ones.
- **CALL { ... } subqueries:** inline (reference outer variables), YIELD filtering, nested, CREATE/SET/DELETE inside, ORDER BY inside. Stored procedures (`CALL db.xxx()`) not supported.
- **Not supported:** stored procedures, APOC, regex in WHERE
- **Notes:** `startnode()`/`endnode()` return string IDs; `avg()`/`min()`/`max()` return null on empty sets

## When to Use

Service dependencies, blast radius, path tracing, shortest path, infrastructure topology, monitoring coverage, degree analysis, graph mutations, idempotent seeding with MERGE.

## Cypher Patterns

> Full command: `gcyphrq -g <graph> -e '<cypher>'`

| Task | Cypher |
|---|---|
| Nodes by label | `MATCH (n:Service) RETURN n` |
| Filter by property | `MATCH (n:Service {type: "RPC"}) RETURN n` |
| Multi-label (AND) | `MATCH (n:Service:Infrastructure) RETURN n` |
| Label union (OR) | `MATCH (n:Service|Database) RETURN n` |
| Label negation | `MATCH (n:!Database) RETURN n` |
| Incoming connections | `MATCH (s)-[:TCP]->(db:Database {name: "PostgreSQL"}) RETURN s` |
| Outgoing connections | `MATCH (db:Database)-[]->(t) RETURN db, t` |
| Path tracing | `MATCH (a {name: "X"})-[r*1..3]->(b {name: "Y"}) RETURN a, r, b` |
| Blast radius (all) | `MATCH (root {name: "X"})-[r*1..2]-(affected) RETURN root, r, affected` |
| Blast radius (down) | `MATCH (root {name: "X"})-[r*1..2]->(d) RETURN root, r, d` |
| Out-degree | `MATCH (n)-[]->(t) WITH n, count(t) AS deg RETURN n, deg` |
| Group by | `MATCH (n:Service) WITH n.type AS t, count(n) AS c RETURN t, c` |
| CREATE | `CREATE (n:Service {name: "X", type: "RPC"}) RETURN n` |
| CREATE chain | `MATCH (a {name: "X"}) MATCH (b {name: "Y"}) CREATE (a)-[r:DEPENDS_ON]->(b) RETURN r` |
| SET | `MATCH (n {name: "X"}) SET n.status = "updated" RETURN n` |
| DELETE | `MATCH (n {name: "X"}) DELETE n` |
| DETACH DELETE | `MATCH (n {name: "X"}) DETACH DELETE n` |
| REMOVE | `MATCH (n) REMOVE n:Label, n.prop RETURN n` |
| MERGE | `MERGE (n:User {name: "Alice"}) ON CREATE SET n.createdAt = 0 RETURN n` |
| UNION ALL | `MATCH (u:User) RETURN u.name UNION ALL MATCH (u:Admin) RETURN u.name` |
| Arithmetic | `MATCH (n) RETURN n.price * n.qty AS total, n.price * 2 + n.shipping AS cost` |
| CASE | `MATCH (n) RETURN n.name, CASE WHEN n.type = "RPC" THEN "svc" ELSE "other" END AS cat` |
| CASE simple | `MATCH (n) RETURN n.name, CASE n.type WHEN "RPC" THEN "svc" ELSE "other" END AS cat` |
| CASE in ORDER BY | `MATCH (n) RETURN n.name ORDER BY CASE n.type WHEN "RPC" THEN 0 ELSE 1 END` |
| Path variable | `MATCH path=(a)-[r]->(b) RETURN path` |
| Path nodes | `MATCH path=(a)-[r]->(b) RETURN nodes(path)` |
| Path relationships | `MATCH path=(a)-[r]->(b) RETURN relationships(path)` |
| labels function | `MATCH (n) RETURN labels(n)` |
| CALL subquery | `CALL { MATCH (n:Person) RETURN n.name AS name }` |
| CALL with outer var | `MATCH (a:Person) CALL { MATCH (a)-[:FRIEND]->(b) RETURN b.name AS friend } RETURN a.name, friend` |
| CALL with YIELD | `CALL { MATCH (n:Person) RETURN n.name AS name, n.age AS age } YIELD name RETURN name` |
| CALL with YIELD+WHERE | `CALL { MATCH (n:Person) RETURN n.name AS name } YIELD name WHERE name <> "Bob" RETURN name` |
| CALL with WHERE | `CALL { MATCH (n:Person) RETURN n.age AS age } WHERE age > 28 RETURN age` |
| Nested CALL | `CALL { CALL { MATCH (n:Person) RETURN n.name AS name } RETURN name }` |
| Shortest path | `MATCH (a {name: "X"}) MATCH (b {name: "Y"}) RETURN shortestPath((a)-[*]->(b)) AS path` |
| Shortest path (typed) | `MATCH (a {name: "X"}) MATCH (b {name: "Y"}) RETURN shortestPath((a)-[:TCP*]->(b)) AS path` |
| All shortest paths | `MATCH (a {name: "X"}) MATCH (b {name: "Y"}) RETURN allShortestPaths((a)-[*]->(b)) AS paths` |
| Shortest path (undirected) | `MATCH (a {name: "X"}) MATCH (b {name: "Y"}) RETURN shortestPath((a)-[*]-(b)) AS path` |
| count(*) | `MATCH (n) RETURN count(*) AS total` |
| collect | `MATCH (u:User) RETURN collect(u.name) AS names` |
| collect DISTINCT | `MATCH (u:User) RETURN collect(DISTINCT u.dept) AS uniqueDepts` |
| reduce | `MATCH (u:User) RETURN reduce(total = 0, x IN [1,2,3] | total + x) AS sum` |
| reduce + collect | `MATCH (u:User) RETURN reduce(total = 0, x IN collect(u.age) | total + x) AS totalAge` |

See `references/queries.md` for more patterns.

## References

- `references/example-graph.json` — 8-node bundled test graph (services, DBs, infra, monitoring)
- `references/queries.md` — Use-case query examples. Load for infrastructure questions needing concrete patterns.
