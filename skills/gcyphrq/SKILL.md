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
- **UNWIND with WHERE:** filter unwound elements (e.g., `UNWIND list AS x WHERE x > 0`). Supports all WHERE operators (`=`, `>`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IS NULL`, etc.). Can be combined with `WITH` for multi-stage filtering.
- **ORDER BY NULLS FIRST/LAST:** control null position (e.g., `ORDER BY score NULLS FIRST`). Default: `NULLS LAST` for ASC, `NULLS FIRST` for DESC. Works in RETURN and WITH.
- **Reduce:** `reduce(init, var IN list | body)` folds a list. Not itself an aggregation — triggers grouping only when sub-expressions contain aggregations (e.g., `reduce(..., x IN collect(y) | ...)`)
- **UNION/UNION ALL:** combine results from multiple branches (each ending with `RETURN`), ORDER BY/SKIP/LIMIT on combined result
- **Scalar functions:** 40+ (`toLower`, `substring`, `split`, `coalesce`, `size`, `labels` (sole RETURN item only), `labelsOf` (everywhere), `nodes` (sole RETURN item only), `relationships` (sole RETURN item only), etc.)
- **Temporal functions:** `timestamp()`, `datetime()`, `date()`, `time()`, `localdatetime()`, `localtime()`, `datetimewithtimezone()`, `timewithzone()`, `duration()`. Extractors: `year()`, `month()`, `day()`, `hour()`, `minute()`, `second()`, `millisecond()`, `timezone()`, `epochseconds()`, `epochmillisecond()`, `totalSeconds()`, `totalMinutes()`. Temporal comparison in WHERE/ORDER BY is chronological and timezone-aware.
- **Path expressions:** `shortestPath((a)-[*]->(b))` returns single shortest path (BFS); `allShortestPaths((a)-[*]->(b))` returns all minimum-length paths. Supports type filtering (`[:TYPE*]`), direction (`->`, `<-`, `-`), and depth bounds (`*min..max`). Variables must be bound in query context.
- **Arithmetic:** `+`, `-`, `*`, `/`, `%`, `^`, unary `+`/`-`, parentheses. `+` concatenates strings. Null propagation, div/mod by zero → null
- **List/Map literals:** dynamic values, list slicing `[start..end]` with negative indices
- **Quantifiers:** `ALL/ANY/SINGLE/NONE(x IN list WHERE pred)` in WHERE (standalone or with AND/OR/NOT). Empty list: ALL/NONE → true, ANY/SINGLE → false.
- **EXISTS:** `EXISTS(expr)` — true if not null/undefined. Use with `NOT` in WHERE.
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
| SET multi-items | `MATCH (n) SET n:Label, n.prop = val, n.count = 5 RETURN n` |
| FOREACH SET label + property | `MATCH (u) FOREACH (x IN u.items | SET x:Processed, x.reviewed = true) RETURN u` |
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
| quantifiers | `MATCH (n) WHERE ALL/ANY/SINGLE/NONE(x IN n.tags WHERE x = "a") RETURN n` |
| EXISTS | `MATCH (n) WHERE EXISTS(n.prop) OR NOT EXISTS(n.prop) RETURN n` |
| UNWIND WHERE | `UNWIND [1,2,3,4,5] AS x WHERE x > 3 RETURN x` |
| UNWIND WHERE + WITH | `UNWIND [1,2,3,4,5] AS x WHERE x > 1 WITH x WHERE x < 5 RETURN x` |
| ORDER BY NULLS FIRST | `MATCH (n) RETURN n.name, n.score ORDER BY n.score NULLS FIRST` |
| ORDER BY NULLS LAST | `MATCH (n) RETURN n.name, n.score ORDER BY n.score DESC NULLS LAST` |
| timestamp | `RETURN timestamp() AS ts` |
| datetime | `RETURN datetime() AS dt, datetime(2023, 6, 15, 14, 30, 45) AS dt2` |
| date | `RETURN date() AS d, date(2023, 6, 15) AS d2` |
| time | `RETURN time() AS t, time(14, 30, 45) AS t2` |
| localdatetime | `RETURN localdatetime() AS dt, localdatetime(2023, 6, 15, 14, 30, 45) AS dt2` |
| localtime | `RETURN localtime() AS t, localtime(14, 30, 45) AS t2` |
| duration | `RETURN duration({hours: 1, minutes: 30}) AS dur, duration('P1Y2M3DT4H5M6S') AS dur2` |
| year/month/day | `RETURN year(n.createdAt) AS y, month(n.createdAt) AS m, day(n.createdAt) AS d` |
| hour/minute/second | `RETURN hour(n.createdAt) AS h, minute(n.createdAt) AS min, second(n.createdAt) AS s` |
| timezone | `RETURN timezone('2023-06-15T14:30:45+02:00') AS tz` |
| epochseconds | `RETURN epochseconds(n.createdAt) AS epoch` |
| temporal WHERE | `MATCH (n) WHERE n.createdAt > '2023-01-01T00:00:00.000Z' RETURN n` |
| temporal ORDER BY | `MATCH (n) RETURN n.name ORDER BY n.createdAt DESC` |

See `references/queries.md` for more patterns.

## References

- `references/example-graph.json` — 8-node bundled test graph (services, DBs, infra, monitoring)
- `references/queries.md` — Use-case query examples. Load for infrastructure questions needing concrete patterns.
