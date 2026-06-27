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

`gcyphrq -g <file|-> -e '<cypher>'`. `-e` query (required), `-g` file/stdin (required), `-nl` label prop (default `"label"`), `-et` edge type (default `"type"`), `--format graph|rows`. Chain via `-g -`.

## Graph File Format

```json
{ "nodes": [{ "key": "id1", "attributes": { "label": "Service", "name": "api" } }],
  "edges": [{ "source": "id1", "target": "id2", "attributes": { "type": "TCP" } }] }
```

- `attributes.label` → Cypher label (`:Service`). String or array (`["Service","Infra"]`). Override with `-nl`.
- `attributes.type` on edges → relationship type (`[:TCP]`). Override with `-et`.
- All other attributes → filterable properties (`{name: "X"}`).
- Optional `options.type: "directed"|"undirected"|"mixed"` (default `"directed"`). `options.allowSelfLoops: true` / `options.multi: true` (parallel edges).

## Supported Cypher

- **Matching:** `MATCH`, `OPTIONAL MATCH`, chained (cartesian), labels `:A:B` (AND), `:A|B` (OR), `:!A` (NOT), variable-length `*min..max`, directional edges (`->`, `<-`, `-`)
- **Filtering:** `WHERE` with `=`, `<>`, `>`, `>=`, `<`, `<=`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IN`, `IS NULL`, `AND`/`OR`/`NOT`, map comparison
- **Pipelining:** `WITH` + aggregations (`count`, `count(*)`, `sum`, `avg`, `min`, `max`, `collect`, all with `DISTINCT`)
- **CASE:** general (`CASE WHEN cond THEN result`) and simple (`CASE expr WHEN val THEN result`). Nested. In RETURN/WHERE/WITH/ORDER BY/SET
- **Reduce:** `reduce(init, var IN list | body)`. Triggers grouping only when sub-expressions contain aggregations
- **List comprehensions:** `[var IN list [WHERE pred] | expr]`
- **Pattern comprehensions:** `[(pattern) [WHERE pred] | expr]`. From bound anchor. Supports directional edges, typed rels, variable-length. In RETURN/WHERE/WITH; nest in `size()`, `head()`, list comps
- **Quantifiers:** `ALL/ANY/SINGLE/NONE(x IN list WHERE pred)`. Empty list: ALL/NONE → true, ANY/SINGLE → false
- **EXISTS:** `EXISTS(expr)` — true if not null/undefined. Use with `NOT` in WHERE
- **UNWIND with WHERE:** `UNWIND list AS x WHERE x > 0`. Combine with `WITH` for multi-stage filtering
- **ORDER BY NULLS FIRST/LAST:** default `NULLS LAST` for ASC, `NULLS FIRST` for DESC
- **UNION/UNION ALL:** each branch must end with `RETURN`. ORDER BY/SKIP/LIMIT on combined result
- **Arithmetic:** `+`, `-`, `*`, `/`, `%`, `^`, unary `+`/`-`. `+` concatenates strings. Null propagation, div/mod by zero → null
- **List/Map literals:** dynamic values, list slicing `[start..end]` with negative indices
- **Strings as char lists:** for `head()`, `last()`, `tail()`, `reverse()`, slicing, comprehensions, quantifiers, `reduce()`, `UNWIND`, `FOREACH`, `IN`. `tail()`/`reverse()`/slicing → string; others → char list
- **Scalar functions:** 40+ (`toLower`, `substring`, `split`, `coalesce`, `size`, `random`, `labels` (RETURN only), `labelsOf` (everywhere), `nodes`/`relationships` (RETURN only), etc.). `random()` → 0..1 float; use `ORDER BY random()` to shuffle
- **Graph statistics:** `numNodes()`, `numRelationships()`, `density()`, `averageDegree()`, `diameter()` (-1 if disconnected, bidirectional)
- **Centrality:** `pagerank()` (power iteration, damping=0.85), `degreeCentrality()` (normalized unique neighbors), `betweennessCentrality()` (Brandes'). All support global (no args → `{nodeId: score}`) and per-node (node arg → score). Betweenness: bidirectional
- **Subgraph extraction:** `subgraph(nodeList)` (induced subgraph from collect()), `egoGraph(node, k)` (k-hop ego network, default k=1), `connectedComponent(node)` (connected component). All return `{ nodes: [...], edges: [...] }`. All treat edges as bidirectional for traversal
- **Temporal:** Constructors: `timestamp()`, `datetime()`, `date()`, `time()`, `localdatetime()`, `localtime()`, `datetimewithtimezone()`, `timewithzone()`, `duration()`. Extractors: `year()`, `month()`, `day()`, `hour()`, `minute()`, `second()`, `millisecond()`, `timezone()`, `epochseconds()`, `epochmillisecond()`, `totalSeconds()`, `totalMinutes()`. WHERE/ORDER BY: chronological, timezone-aware
- **Path expressions:** `shortestPath((a)-[*]->(b))` (single BFS); `allShortestPaths((a)-[*]->(b))` (all min-length). Supports type filtering, direction, depth bounds. Variables must be bound
- **CALL { ... } subqueries:** Inline (refs outer vars), YIELD filtering, nested, CREATE/SET/DELETE inside, ORDER BY inside. No stored procedures
- **LOAD CSV:** `LOAD CSV [WITH HEADERS] FROM 'source' AS var`. Local/HTTP/HTTPS. `FIELDS TERMINATED BY`, `OPTIONALLY ENCLOSED BY`. Works in CALL
- **Mutations:** `CREATE` (single node or chain), `SET`, `DELETE`, `DETACH DELETE`, `REMOVE`, `MERGE` (WHERE filter, ON CREATE/ON MATCH with SET/DELETE/DETACH DELETE/REMOVE)
- **Not supported:** stored procedures, APOC, regex in WHERE
- **Notes:** `startnode()`/`endnode()` return string IDs; `avg()`/`min()`/`max()` return null on empty sets

## Cypher Patterns

> Full command: `gcyphrq -g <graph> -e '<cypher>'`

| Task | Cypher |
|---|---|
| By label | `MATCH (n:Service) RETURN n` |
| By property | `MATCH (n:Service {type: "RPC"}) RETURN n` |
| Multi-label AND | `MATCH (n:Service:Infrastructure) RETURN n` |
| Label OR | `MATCH (n:Service|Database) RETURN n` |
| Label NOT | `MATCH (n:!Database) RETURN n` |
| Incoming | `MATCH (s)-[:TCP]->(db:Database {name: "PostgreSQL"}) RETURN s` |
| Outgoing | `MATCH (db:Database)-[]->(t) RETURN db, t` |
| Path | `MATCH (a {name: "X"})-[r*1..3]->(b {name: "Y"}) RETURN a, r, b` |
| Blast radius | `MATCH (root {name: "X"})-[r*1..2]-(affected) RETURN root, r, affected` |
| Degree | `MATCH (n)-[]->(t) WITH n, count(t) AS deg RETURN n, deg` |
| Group by | `MATCH (n:Service) WITH n.type AS t, count(n) AS c RETURN t, c` |
| CREATE | `CREATE (n:Service {name: "X", type: "RPC"}) RETURN n` |
| CREATE chain | `MATCH (a {name: "X"}) MATCH (b {name: "Y"}) CREATE (a)-[r:DEPENDS_ON]->(b) RETURN r` |
| SET | `MATCH (n {name: "X"}) SET n.status = "updated" RETURN n` |
| SET multi | `MATCH (n) SET n:Label, n.prop = val, n.count = 5 RETURN n` |
| FOREACH | `MATCH (u) FOREACH (x IN u.items | SET x:Processed, x.reviewed = true) RETURN u` |
| FOREACH WHERE | `MATCH (u) FOREACH (x IN u.items WHERE x.val > 0 | SET x:Positive) RETURN u` |
| FOREACH multi | `MATCH (u) FOREACH (x IN u.items | SET x:Tagged, SET x.active = true) RETURN u` |
| DELETE | `MATCH (n {name: "X"}) DELETE n` or `DETACH DELETE n` |
| REMOVE | `MATCH (n) REMOVE n:Label, n.prop RETURN n` |
| MERGE | `MERGE (n:User {name: "Alice"}) ON CREATE SET n.createdAt = 0 RETURN n` |
| UNION ALL | `MATCH (u:User) RETURN u.name UNION ALL MATCH (u:Admin) RETURN u.name` |
| Arithmetic | `MATCH (n) RETURN n.price * n.qty AS total, n.price * 2 + n.shipping AS cost` |
| CASE | `MATCH (n) RETURN n.name, CASE WHEN n.type = "RPC" THEN "svc" ELSE "other" END AS cat` |
| CASE (ORDER BY) | `MATCH (n) RETURN n.name ORDER BY CASE n.type WHEN "RPC" THEN 0 ELSE 1 END` |
| Path var | `MATCH path=(a)-[r]->(b) RETURN path, nodes(path), relationships(path)` |
| labels() | `MATCH (n) RETURN labels(n)` |
| CALL | `CALL { MATCH (n:Person) RETURN n.name AS name }` |
| CALL (outer) | `MATCH (a:Person) CALL { MATCH (a)-[:FRIEND]->(b) RETURN b.name AS friend } RETURN a.name, friend` |
| CALL (YIELD) | `CALL { MATCH (n:Person) RETURN n.name AS name, n.age AS age } YIELD name WHERE name <> "Bob" RETURN name` |
| CALL (nested) | `CALL { CALL { MATCH (n:Person) RETURN n.name AS name } RETURN name }` |
| shortestPath() | `MATCH (a {name: "X"}) MATCH (b {name: "Y"}) RETURN shortestPath((a)-[*]->(b)) AS path` |
| shortestPath (typed) | `RETURN shortestPath((a)-[:TCP*]->(b))` or `allShortestPaths((a)-[*]-(b))` |
| count(*) | `MATCH (n) RETURN count(*) AS total` |
| collect | `MATCH (u:User) RETURN collect(u.name) AS names, collect(DISTINCT u.dept) AS depts` |
| reduce | `RETURN reduce(total = 0, x IN [1,2,3] | total + x) AS sum` |
| reduce (collect) | `MATCH (u:User) RETURN reduce(total = 0, x IN collect(u.age) | total + x) AS totalAge` |
| quantifiers | `MATCH (n) WHERE ALL/ANY/SINGLE/NONE(x IN n.tags WHERE x = "a") RETURN n` |
| Pattern comp | `MATCH (a:Person) RETURN [(a)-->(b:Person) | b.name] AS friends` |
| Pattern comp (in/WHERE) | `MATCH (a:Person) RETURN [(a)<--(b:Person) WHERE b.age > 30 | b.name]` |
| Pattern comp (size) | `MATCH (a:Person) RETURN a.name, size([(a)-->(b:Person) | b.name]) AS count` |
| EXISTS | `MATCH (n) WHERE EXISTS(n.prop) OR NOT EXISTS(n.prop) RETURN n` |
| UNWIND | `UNWIND [1,2,3,4,5] AS x WHERE x > 1 WITH x WHERE x < 5 RETURN x` |
| NULLS | `MATCH (n) RETURN n.name, n.score ORDER BY n.score NULLS FIRST` |
| LOAD CSV | `LOAD CSV [WITH HEADERS] FROM 'file.csv' AS row RETURN row.name, row.age` |
| LOAD CSV (MATCH) | `LOAD CSV WITH HEADERS FROM 'users.csv' AS row MATCH (u:User {name: row.name}) RETURN row.name, u` |
| LOAD CSV (delim) | `LOAD CSV FROM 'data.tsv' AS row FIELDS TERMINATED BY '\t' RETURN row` |
| EXPLAIN | `gcyphrq --explain -e 'MATCH (u:User) RETURN u'` |
| timestamp() | `RETURN timestamp() AS ts, datetime(2023,6,15,14,30,45) AS dt, date(2023,6,15) AS d` |
| duration/extractors | `RETURN time(14,30,45) AS t, duration({hours:1,minutes:30}) AS dur, year(n.createdAt) AS y, epochseconds(n.createdAt) AS epoch` |
| temporal WHERE | `MATCH (n) WHERE n.createdAt > '2023-01-01T00:00:00.000Z' RETURN n.name ORDER BY n.createdAt DESC` |
| Graph stats | `RETURN numNodes() AS n, numRelationships() AS e, density() AS d, averageDegree() AS avgDeg, diameter() AS diam` |
| PageRank | `RETURN pagerank() AS scores` |
| PageRank (node) | `MATCH (n) RETURN n.name, pagerank(n) AS pr ORDER BY pr DESC` |
| Centrality | `MATCH (n) RETURN n.name, degreeCentrality(n) AS dc, betweennessCentrality(n) AS bc ORDER BY dc DESC` |
| Top-N | `MATCH (n) RETURN n.name, pagerank(n) AS pr ORDER BY pr DESC LIMIT 5` |
| Subgraph | `MATCH (n) WHERE n.type = "RPC" WITH collect(n) AS nodes RETURN subgraph(nodes) AS sg` |
| Ego / component | `MATCH (n {name: "X"}) RETURN egoGraph(n, 2) AS sg, connectedComponent(n) AS cc` |

See `references/queries.md` for more patterns.

## References

- `references/example-graph.json` — 8-node bundled test graph (services, DBs, infra, monitoring)
- `references/queries.md` — Use-case query examples. Load for infrastructure questions needing concrete patterns.
