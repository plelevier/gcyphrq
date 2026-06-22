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

```cyphr
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
