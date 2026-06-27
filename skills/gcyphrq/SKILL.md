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

## CLI

`gcyphrq -g <file|-> -e '<cypher>'`. Flags: `-e` (query, required), `-g` (file or `-` stdin, required), `-nl` (label property, default `"label"`), `-et` (edge type property, default `"type"`), `--format graph|rows`. Chain outputs via `-g -`; scalars auto-fallback to rows.

## Graph File Format

```json
{ "nodes": [{ "key": "id1", "attributes": { "label": "Service", "name": "api" } }],
  "edges": [{ "source": "id1", "target": "id2", "attributes": { "type": "TCP" } }] }
```

- `attributes.label` → Cypher label (`:Service`). String or array (`["Service","Infra"]`). Override with `-nl`.
- `attributes.type` on edges → relationship type (`[:TCP]`). Override with `-et`.
- All other attributes → filterable properties (`{name: "X"}`).
- Optional `options.allowSelfLoops: true` / `options.multi: true` (parallel edges).

## Supported Cypher

- **Matching:** `MATCH`, `OPTIONAL MATCH`, chained `MATCH` (cartesian), labels `:A:B` (AND), `:A|B` (OR), `:!A` (NOT), variable-length `*min..max`, directional edges (`->`, `<-`, `-`)
- **Filtering:** `WHERE` with `=`, `<>`, `>`, `>=`, `<`, `<=`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IN`, `IS NULL`, `AND`/`OR`/`NOT`, map comparison
- **Pipelining:** `WITH` + aggregations (`count`, `count(*)`, `sum`, `avg`, `min`, `max`, `collect`, all with `DISTINCT`)
- **CASE:** general (`CASE WHEN cond THEN result`) and simple (`CASE expr WHEN val THEN result`). Nested. In RETURN/WHERE/WITH/ORDER BY/SET
- **Reduce:** `reduce(init, var IN list | body)`. Not itself an aggregation — triggers grouping only when sub-expressions contain aggregations
- **List comprehensions:** `[var IN list [WHERE pred] | expr]`
- **Pattern comprehensions:** `[(pattern) [WHERE pred] | expr]`. Traverses from bound anchor node, collects into list. Supports directional edges, typed relationships, variable-length. Works in RETURN/WHERE/WITH, nested in `size()`, `head()`, list comprehensions
- **Quantifiers:** `ALL/ANY/SINGLE/NONE(x IN list WHERE pred)`. Empty list: ALL/NONE → true, ANY/SINGLE → false
- **EXISTS:** `EXISTS(expr)` — true if not null/undefined. Use with `NOT` in WHERE
- **UNWIND with WHERE:** `UNWIND list AS x WHERE x > 0`. Combine with `WITH` for multi-stage filtering
- **ORDER BY NULLS FIRST/LAST:** default `NULLS LAST` for ASC, `NULLS FIRST` for DESC
- **UNION/UNION ALL:** each branch must end with `RETURN`. ORDER BY/SKIP/LIMIT on combined result
- **Arithmetic:** `+`, `-`, `*`, `/`, `%`, `^`, unary `+`/`-`. `+` concatenates strings. Null propagation, div/mod by zero → null
- **List/Map literals:** dynamic values, list slicing `[start..end]` with negative indices
- **Strings as char lists:** `head()`, `last()`, `tail()`, `reverse()`, slicing, comprehensions, quantifiers, `reduce()`, `UNWIND`, `FOREACH`, `IN`. `tail()`/`reverse()`/slicing on strings return strings; others yield char lists
- **Scalar functions:** 40+ (`toLower`, `substring`, `split`, `coalesce`, `size`, `labels` (sole RETURN only), `labelsOf` (everywhere), `nodes`/`relationships` (sole RETURN only), etc.)
- **Temporal:** `timestamp()`, `datetime()`, `date()`, `time()`, `localdatetime()`, `localtime()`, `datetimewithtimezone()`, `timewithzone()`, `duration()`. Extractors: `year()`, `month()`, `day()`, `hour()`, `minute()`, `second()`, `millisecond()`, `timezone()`, `epochseconds()`, `epochmillisecond()`, `totalSeconds()`, `totalMinutes()`. WHERE/ORDER BY comparison is chronological and timezone-aware
- **Path expressions:** `shortestPath((a)-[*]->(b))` (single BFS); `allShortestPaths((a)-[*]->(b))` (all min-length). Supports type filtering, direction, depth bounds. Variables must be bound
- **CALL { ... } subqueries:** inline (reference outer vars), YIELD filtering, nested, CREATE/SET/DELETE inside, ORDER BY inside. Stored procedures not supported
- **LOAD CSV:** `LOAD CSV [WITH HEADERS] FROM 'source' AS var`. Local files and HTTP/HTTPS. `FIELDS TERMINATED BY`, `OPTIONALLY ENCLOSED BY`. Works inside CALL
- **Mutations:** `CREATE` (single node or chain), `SET`, `DELETE`, `DETACH DELETE`, `REMOVE`, `MERGE` (WHERE filter, ON CREATE/ON MATCH with SET/DELETE/DETACH DELETE/REMOVE)
- **Not supported:** stored procedures, APOC, regex in WHERE
- **Notes:** `startnode()`/`endnode()` return string IDs; `avg()`/`min()`/`max()` return null on empty sets

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
| Blast radius (all/down) | `MATCH (root {name: "X"})-[r*1..2]-(affected) RETURN root, r, affected` |
| Out-degree | `MATCH (n)-[]->(t) WITH n, count(t) AS deg RETURN n, deg` |
| Group by | `MATCH (n:Service) WITH n.type AS t, count(n) AS c RETURN t, c` |
| CREATE | `CREATE (n:Service {name: "X", type: "RPC"}) RETURN n` |
| CREATE chain | `MATCH (a {name: "X"}) MATCH (b {name: "Y"}) CREATE (a)-[r:DEPENDS_ON]->(b) RETURN r` |
| SET | `MATCH (n {name: "X"}) SET n.status = "updated" RETURN n` |
| SET multi-items | `MATCH (n) SET n:Label, n.prop = val, n.count = 5 RETURN n` |
| FOREACH SET label + property | `MATCH (u) FOREACH (x IN u.items | SET x:Processed, x.reviewed = true) RETURN u` |
| DELETE / DETACH DELETE | `MATCH (n {name: "X"}) DELETE n` or `DETACH DELETE n` |
| REMOVE | `MATCH (n) REMOVE n:Label, n.prop RETURN n` |
| MERGE | `MERGE (n:User {name: "Alice"}) ON CREATE SET n.createdAt = 0 RETURN n` |
| UNION ALL | `MATCH (u:User) RETURN u.name UNION ALL MATCH (u:Admin) RETURN u.name` |
| Arithmetic | `MATCH (n) RETURN n.price * n.qty AS total, n.price * 2 + n.shipping AS cost` |
| CASE (general + simple) | `MATCH (n) RETURN n.name, CASE WHEN n.type = "RPC" THEN "svc" ELSE "other" END AS cat` |
| CASE in ORDER BY | `MATCH (n) RETURN n.name ORDER BY CASE n.type WHEN "RPC" THEN 0 ELSE 1 END` |
| Path variable | `MATCH path=(a)-[r]->(b) RETURN path` |
| Path nodes/relationships | `MATCH path=(a)-[r]->(b) RETURN nodes(path), relationships(path)` |
| labels function | `MATCH (n) RETURN labels(n)` |
| CALL subquery | `CALL { MATCH (n:Person) RETURN n.name AS name }` |
| CALL with outer var | `MATCH (a:Person) CALL { MATCH (a)-[:FRIEND]->(b) RETURN b.name AS friend } RETURN a.name, friend` |
| CALL with YIELD(+WHERE) | `CALL { MATCH (n:Person) RETURN n.name AS name, n.age AS age } YIELD name WHERE name <> "Bob" RETURN name` |
| Nested CALL | `CALL { CALL { MATCH (n:Person) RETURN n.name AS name } RETURN name }` |
| Shortest path | `MATCH (a {name: "X"}) MATCH (b {name: "Y"}) RETURN shortestPath((a)-[*]->(b)) AS path` |
| Shortest path (typed/directed) | `RETURN shortestPath((a)-[:TCP*]->(b))` or `allShortestPaths((a)-[*]-(b))` |
| count(*) | `MATCH (n) RETURN count(*) AS total` |
| collect / collect DISTINCT | `MATCH (u:User) RETURN collect(u.name) AS names, collect(DISTINCT u.dept) AS depts` |
| reduce | `RETURN reduce(total = 0, x IN [1,2,3] | total + x) AS sum` |
| reduce + collect | `MATCH (u:User) RETURN reduce(total = 0, x IN collect(u.age) | total + x) AS totalAge` |
| quantifiers | `MATCH (n) WHERE ALL/ANY/SINGLE/NONE(x IN n.tags WHERE x = "a") RETURN n` |
| pattern comprehension | `MATCH (a:Person) RETURN [(a)-->(b:Person) | b.name] AS friends` |
| pattern comprehension (incoming) | `MATCH (a:Person) RETURN [(a)<--(b:Person) | b.name] AS incoming` |
| pattern comprehension (with WHERE) | `MATCH (a:Person) RETURN [(a)-->(b:Person) WHERE b.age > 30 | b.name]` |
| pattern comprehension (size) | `MATCH (a:Person) RETURN a.name, size([(a)-->(b:Person) | b.name]) AS count` |
| EXISTS | `MATCH (n) WHERE EXISTS(n.prop) OR NOT EXISTS(n.prop) RETURN n` |
| UNWIND WHERE (+WITH) | `UNWIND [1,2,3,4,5] AS x WHERE x > 1 WITH x WHERE x < 5 RETURN x` |
| ORDER BY NULLS FIRST/LAST | `MATCH (n) RETURN n.name, n.score ORDER BY n.score NULLS FIRST` |
| LOAD CSV | `LOAD CSV [WITH HEADERS] FROM 'file.csv' AS row RETURN row.name, row.age` |
| LOAD CSV + MATCH | `LOAD CSV WITH HEADERS FROM 'users.csv' AS row MATCH (u:User {name: row.name}) RETURN row.name, u` |
| LOAD CSV + CREATE | `LOAD CSV WITH HEADERS FROM 'people.csv' AS row CREATE (p:Person {name: row.name}) RETURN p` |
| LOAD CSV (custom delim) | `LOAD CSV FROM 'data.tsv' AS row FIELDS TERMINATED BY '\t' RETURN row` |
| LOAD CSV inside CALL | `CALL { LOAD CSV WITH HEADERS FROM 'data.csv' AS row RETURN row.name AS name } RETURN name` |
| EXPLAIN | `gcyphrq --explain -e 'MATCH (u:User) RETURN u'` |
| timestamp/datetime/date | `RETURN timestamp() AS ts, datetime(2023,6,15,14,30,45) AS dt, date(2023,6,15) AS d` |
| time/localdatetime/localtime | `RETURN time(14,30,45) AS t, localdatetime() AS dt, localtime() AS lt` |
| duration | `RETURN duration({hours:1, minutes:30}) AS dur, duration('P1Y2M3DT4H5M6S') AS dur2` |
| temporal extractors | `RETURN year(n.createdAt) AS y, month(n.createdAt) AS m, epochseconds(n.createdAt) AS epoch` |
| temporal WHERE/ORDER BY | `MATCH (n) WHERE n.createdAt > '2023-01-01T00:00:00.000Z' RETURN n.name ORDER BY n.createdAt DESC` |

See `references/queries.md` for more patterns.

## References

- `references/example-graph.json` — 8-node bundled test graph (services, DBs, infra, monitoring)
- `references/queries.md` — Use-case query examples. Load for infrastructure questions needing concrete patterns.
