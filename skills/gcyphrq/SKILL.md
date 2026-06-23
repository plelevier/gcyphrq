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

## Supported Cypher

See `AGENTS.md` → Supported Cypher for full details. Key highlights:

- **Matching:** `MATCH`, `OPTIONAL MATCH`, labels `:A:B` (AND), `:A|B` (OR), `:!A` (NOT), variable-length `*min..max`, directional edges
- **Filtering:** `WHERE` with `=`, `<>`, `>`, `>=`, `<`, `<=`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IN`, `IS NULL`, `AND`/`OR`/`NOT`, map comparison
- **CASE:** `CASE WHEN cond THEN result` and `CASE expr WHEN val THEN result`. Nested. In RETURN/WHERE/WITH/ORDER BY/SET
- **Pipelining:** `WITH`, `count()`, `sum()`, `avg()`, `min()`, `max()`, `DISTINCT` aggregations
- **UNION/UNION ALL:** combine results from multiple branches (each ending with `RETURN`), ORDER BY/SKIP/LIMIT on combined result
- **Scalar functions:** 28+ (`toLower`, `substring`, `split`, `coalesce`, `size`, `labels` (sole RETURN item only), `labelsOf` (everywhere), `nodes` (sole RETURN item only), `relationships` (sole RETURN item only), etc.)
- **Arithmetic:** `+`, `-`, `*`, `/`, `%`, `^`, unary `+`/`-`, parentheses. Works in RETURN/WHERE/WITH/ORDER BY/SET. Null propagation (null operand → null), division by zero → null
- **List/Map literals:** dynamic values, list slicing `[start..end]` with negative indices
- **Mutations:** `CREATE`, `SET`, `DELETE`, `REMOVE`, `MERGE` (in-memory only). MERGE: supports WHERE filter, ON CREATE/ON MATCH with SET/DELETE/REMOVE
- **Not supported:** chained `MATCH`, subqueries, `CALL`, APOC, regex in WHERE
- **Notes:** `startnode()`/`endnode()` return string IDs; `avg()`/`min()`/`max()` return null on empty sets

## When to Use

Service dependencies, blast radius, path tracing, infrastructure topology, monitoring coverage, degree analysis, graph mutations, idempotent seeding with MERGE.

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
| SET | `MATCH (n {name: "X"}) SET n.status = "updated" RETURN n` |
| DELETE | `MATCH (n {name: "X"}) DELETE n` |
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

See `references/queries.md` for more patterns.

## References

- `references/example-graph.json` — 8-node bundled test graph (services, DBs, infra, monitoring)
- `references/queries.md` — Use-case query examples. Load for infrastructure questions needing concrete patterns.
