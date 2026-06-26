# Use-Case Queries

Adapt these patterns for real graph files. Run as: `gcyphrq -g <graph> -e '<cypher>'`.

All examples use `references/example-graph.json` (replace with your graph path).

## "What does X depend on?"

Treat outgoing edges from X as its dependencies.

```cypher
# Direct dependencies of Auth Service
MATCH (s {name: "Auth Service"})-[r]->(dep) RETURN s, r, dep

# All dependencies within 2 hops
MATCH (s {name: "Auth Service"})-[r*1..2]->(dep) RETURN s, r, dep
```

## "What depends on X?" (reverse / upstream)

Follow incoming edges to X.

```cypher
# Who connects to PostgreSQL Primary
MATCH (caller)-[:TCP]->(db {name: "PostgreSQL Primary"}) RETURN caller

# Upstream callers of Kafka (2 hops back)
MATCH (caller)-[r*1..2]->(k {name: "Kafka Cluster"}) RETURN caller, r, k
```

## "If X goes down, what breaks?" (blast radius)

Use undirected edges to find everything reachable from X.

```cypher
# 1-hop blast radius of Auth Service
MATCH (root {name: "Auth Service"})-[r]-(affected) RETURN root, r, affected

# 2-hop blast radius (includes transitive impact)
MATCH (root {name: "Auth Service"})-[r*1..2]-(affected) RETURN root, r, affected

# Downstream only (outbound direction)
MATCH (root {name: "Auth Service"})-[r*1..2]->(downstream) RETURN root, r, downstream
```

## "Show me the path from A to B"

Use variable-length paths with a bounded range.

```cypher
# Path from API Gateway to any database
MATCH (gw {name: "API Gateway"})-[r*1..4]->(db:Database) RETURN gw, r, db

# Path from API Gateway to the worker (always use *min..max bounds)
MATCH (gw {name: "API Gateway"})-[r*1..4]->(w {name: "Notification Worker"}) RETURN gw, r, w
```

## "Capture full paths with path variables"

Use `MATCH path = ...` to capture the entire path (nodes + relationships) in a single variable.

```cypher
# Capture a simple path
MATCH path=(a:Service)-[:TCP]->(b:Database) RETURN path

# Extract nodes from a path
MATCH path=(a)-[r*1..3]->(b) RETURN nodes(path)

# Extract relationships from a path
MATCH path=(a)-[r*1..3]->(b) RETURN relationships(path)

# Path with OPTIONAL MATCH (null when no match)
MATCH (n:Service)
OPTIONAL MATCH path=(n)-[:TCP]->(m:Database)
RETURN n.name, path
```

> Note: `labels()`, `nodes()`, and `relationships()` do not support `AS` aliases (ANTLR4 grammar limitation). Use the auto-generated column name like `labels(n)` or `nodes(path)`.

## "Which services talk to the message queue?"

```cypher
# Producers (write to queue)
MATCH (s:Service)-[:TCP]->(mq {type: "MessageQueue"}) RETURN s, mq

# Consumers (read from queue)
MATCH (mq {type: "MessageQueue"})-[:TCP]->(s:Service) RETURN mq, s

# Consumer count per queue (use --format rows for aggregation scalars)
MATCH (mq {type: "MessageQueue"})-[:TCP]->(w:Service)
WITH mq, count(w) AS consumers RETURN mq, consumers
# → use --format rows to see the consumer count value alongside the node
```

## "What is the monitoring setup?"

```cypher
# All services sending metrics to Prometheus
MATCH (s:Service)-[:Metrics]->(p {name: "Prometheus"}) RETURN s

# Services NOT monitored (no Metrics edge)
MATCH (s:Service)
OPTIONAL MATCH (s)-[:Metrics]->(m)
WHERE m IS NULL
RETURN s
```

## "Which service has the most connections?"

```cypher
# Top N by out-degree (use --format rows to see degree values)
MATCH (s:Service)-[]->(t)
WITH s, count(t) AS deg
RETURN s, deg ORDER BY deg DESC LIMIT 3

# Top N by in-degree
MATCH (src)-[]->(s:Service)
WITH s, count(src) AS deg
RETURN s, deg ORDER BY deg DESC LIMIT 3

> When RETURN mixes nodes + aggregation scalars, graph format preserves nodes but loses scalar values. Add `--format rows` to see both.
```

## "Show me only X-type services in region Y"

```cypher
# RPC services in us-east-1
MATCH (s:Service) WHERE s.type = "RPC" AND s.region = "us-east-1" RETURN s

# Non-worker services
MATCH (s:Service) WHERE NOT s.type = "Worker" RETURN s

# Services whose name contains a substring
MATCH (s:Service) WHERE s.name CONTAINS "Gateway" RETURN s
```

## "Classify nodes with CASE"

```cypher
# General CASE: WHEN cond THEN result
MATCH (s:Service) RETURN s.name,
  CASE WHEN s.type = "RPC" THEN "svc" WHEN s.type = "Database" THEN "db" ELSE "other" END AS category

# Simple CASE: CASE expr WHEN val THEN result
MATCH (n) RETURN n.name, CASE n.label WHEN "Service" THEN "svc" ELSE "other" END AS kind

# CASE with IS NULL
MATCH (s:Service) RETURN s.name, CASE WHEN s.region IS NULL THEN "global" ELSE s.region END AS region

# CASE in ORDER BY
MATCH (s:Service) RETURN s.name ORDER BY CASE s.type WHEN "RPC" THEN 0 ELSE 1 END

# CASE in SET
MATCH (s:Service) SET s.cat = CASE WHEN s.type = "RPC" THEN "svc" ELSE "other" END RETURN s.name, s.cat

# Nested CASE
MATCH (s:Service) RETURN s.name, CASE WHEN s.type = "RPC" THEN CASE WHEN s.region = "us-east-1" THEN "us-rpc" ELSE "other" END ELSE "no" END AS tier
```

> CASE supports all WHERE operators (`=`, `<>`, `>`, `>=`, `<`, `<=`, `CONTAINS`, `IS NULL`, `AND`/`OR`/`NOT`). Works in RETURN, WHERE, WITH, ORDER BY, SET. Nested CASE supported.

## "Summarize the graph"

```cypher
# Total node count
MATCH (n) RETURN count(n) AS nodes

# Total edge count
MATCH ()-[r]->() RETURN count(r) AS edges

# Count by property (e.g., service type)
MATCH (n:Service) WITH n.type AS t, count(n) AS c RETURN t, c

# Count by label (using the label property directly)
MATCH (n) WITH n.label AS l, count(n) AS c RETURN l, c
```

## Chaining queries

Pipe graph output back into gcyphrq for multi-step analysis:

```bash
# Step 1: extract services → Step 2: filter RPC → Step 3: return names
gcyphrq -g graph.json -e 'MATCH (s:Service) RETURN s' \
  | gcyphrq -g - -e 'MATCH (s {type:"RPC"}) RETURN s' \
  | gcyphrq -g - -e 'MATCH (s) RETURN s.name'
```

> Graph format preserves nodes/edges but loses variable bindings and row pairing. Use `--format rows` when you need exact row-level data.

## CALL { ... } Subqueries

Execute a subquery that can reference outer-scope variables. Useful for correlated subqueries, isolating logic, and row expansion.

```cypher
# Basic CALL (returns inner query results directly)
CALL { MATCH (n:Service) RETURN n.name AS name }

# CALL with outer variable (inline subquery)
MATCH (s:Service {name: "Auth Service"})
CALL { MATCH (s)-[r]->(dep) RETURN dep.name AS dependency }
RETURN s.name, dependency

# CALL with YIELD (restrict exposed columns)
CALL { MATCH (n:Service) RETURN n.name AS name, n.type AS type } YIELD name
RETURN name

# CALL with YIELD + WHERE (filter after subquery)
CALL { MATCH (n:Service) RETURN n.name AS name, n.type AS type } YIELD name
WHERE name <> "Bob"
RETURN name

# CALL followed by WHERE (filter inner results)
CALL { MATCH (n:Service) RETURN n.type AS type }
WHERE type = "RPC"
RETURN type

# CALL followed by MATCH (cartesian product)
CALL { MATCH (n:Service) RETURN n.name AS name }
MATCH (m:Database)
RETURN name, m.name AS db

# Nested CALL
CALL { CALL { MATCH (n:Service) RETURN n.name AS name } RETURN name }

# CALL with CREATE (mutations inside subquery)
CALL { CREATE (t:Tag {name: 'new'}) RETURN t.name AS name }

# CALL with ORDER BY
CALL { MATCH (n:Service) RETURN n.name AS name ORDER BY n.name }

# CALL with aggregation
CALL { MATCH (n:Service) RETURN count(n) AS total }
```

> **Note:** CALL { ... } subqueries are supported; stored procedures (CALL db.xxx()) are not.

## "Work with timestamps and dates"

Use temporal functions to construct, extract, and compare datetime values.

```cypher
# Current timestamp and datetime
RETURN timestamp() AS ts, datetime() AS dt, date() AS d, time() AS t

# Construct from components
RETURN datetime(2023, 6, 15, 14, 30, 45) AS dt
RETURN date(2023, 6, 15) AS d
RETURN time(14, 30, 45, 123) AS t

# Construct from map
RETURN datetime({year: 2023, month: 6, day: 15, hour: 14, minute: 30, second: 45}) AS dt
RETURN time({hour: 14, minute: 30, second: 45, millisecond: 500}) AS t

# Construct from string
RETURN datetime('2023-06-15T14:30:45.123Z') AS dt
RETURN date('2023-06-15') AS d

# Local datetime/time (no timezone suffix)
RETURN localdatetime(2023, 6, 15, 14, 30, 45) AS local
RETURN localtime(14, 30, 45) AS local

# Duration
RETURN duration({years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6}) AS dur
RETURN duration('P1Y2M3DT4H5M6S') AS dur
RETURN totalSeconds(duration({hours: 1, minutes: 30})) AS totalSec

# Duration with fractional seconds
RETURN duration({seconds: 1, milliseconds: 500}) AS dur
```

## "Extract date/time components from properties"

```cypher
# Extract year, month, day from a datetime property
MATCH (n) WHERE n.createdAt IS NOT NULL
RETURN n.name, year(n.createdAt) AS year, month(n.createdAt) AS month, day(n.createdAt) AS day

# Extract hour, minute, second
MATCH (n) WHERE n.createdAt IS NOT NULL
RETURN n.name, hour(n.createdAt) AS hour, minute(n.createdAt) AS minute, second(n.createdAt) AS second

# Extract timezone
RETURN timezone('2023-06-15T14:30:45+02:00') AS tz
RETURN timezone('2023-06-15T14:30:45.000Z') AS tz

# Extract epoch seconds/milliseconds
MATCH (n) WHERE n.createdAt IS NOT NULL
RETURN n.name, epochseconds(n.createdAt) AS epoch
```

## "Filter by date/time range"

```cypher
# Nodes created after a specific date
MATCH (n) WHERE n.createdAt > '2023-01-01T00:00:00.000Z' RETURN n

# Nodes created in a specific year
MATCH (n) WHERE year(n.createdAt) = 2023 RETURN n

# Nodes created in a specific month
MATCH (n) WHERE year(n.createdAt) = 2023 AND month(n.createdAt) = 6 RETURN n

# Temporal comparison with timezone offsets (chronologically correct)
MATCH (n) WHERE n.createdAt <= '2023-06-15T14:30:45+02:00' RETURN n
```

## "Order by date/time"

```cypher
# Most recent first
MATCH (n) RETURN n.name, n.createdAt ORDER BY n.createdAt DESC

# Oldest first
MATCH (n) RETURN n.name, n.createdAt ORDER BY n.createdAt ASC

# Order by year then month
MATCH (n) RETURN n.name, n.createdAt ORDER BY year(n.createdAt), month(n.createdAt)
```

## "Use datetime in SET"

```cypher
# Set a node property to current timestamp
MATCH (n {name: 'X'}) SET n.updatedAt = timestamp() RETURN n

# Set a node property to a specific date
MATCH (n {name: 'X'}) SET n.birthday = date(1990, 1, 15) RETURN n

# Set a node property to current datetime
MATCH (n {name: 'X'}) SET n.createdAt = datetime() RETURN n
```

## "Combine temporal with other expressions"

```cypher
# Arithmetic with epoch seconds
MATCH (n) WHERE n.createdAt IS NOT NULL
RETURN n.name, epochseconds(n.createdAt) + 86400 AS tomorrow

# CASE with temporal
MATCH (n) WHERE n.createdAt IS NOT NULL
RETURN n.name, CASE WHEN year(n.createdAt) >= 2023 THEN 'recent' ELSE 'older' END AS category

# Nested temporal functions
RETURN year(datetime(epochseconds('2023-06-15T14:30:45.000Z'))) AS y

# Coalesce with temporal
RETURN coalesce(year(n.maybeDate), 1970) AS fallback
```
