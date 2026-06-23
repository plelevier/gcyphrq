---
layout: default
title: Query Guide
description: Full Cypher syntax reference, supported features, and query patterns for gcyphrq.
---

<div class="breadcrumb">
  <a href="{{ '/' | relative_url }}">Home</a> <span>›</span> Query Guide
</div>

# Query Guide

This guide covers all supported Cypher syntax and query patterns available in the `gcyphrq` engine.

---

## Supported Features

See the [Home page](index) for the full feature support table.

<div class="callout">
  <p><strong>Single MATCH per stage:</strong> The engine processes one MATCH clause at a time. Chained MATCHes within the same stage are not supported — use multiple stages separated by <code>WITH</code> instead.</p>
</div>

---

## MATCH

### Basic node match

```cypher
MATCH (u:User) RETURN u
MATCH (u:User {name: 'Alice'}) RETURN u
```

### Match with relationships

```cypher
MATCH (u:User)-[:FRIEND]->(f:User) RETURN u, f
```

### Variable-length paths

Use `*min..max` to specify path length (`*1..3` for 1–3 hops, `*2..2` for exactly 2):

```cypher
MATCH (u:User)-[r:FRIEND*1..3]-(f:User) RETURN u, r, f
```

### Directional edges

| Syntax | Meaning |
|---|---|
| `-[:TYPE]->` | Outbound only (from source to target) |
| `<-[:TYPE]-` | Inbound only (from target to source) |
| `-[:TYPE]-` | Undirected (either direction) |

```cypher
// Outbound only
MATCH (u:User {name: 'Alice'})-[r:FRIEND]->(f:User) RETURN f

// Inbound only
MATCH (u:User {name: 'Alice'})<-[r:FRIEND]-(f:User) RETURN f

// Any direction
MATCH (u:User {name: 'Alice'})-[r:FRIEND]-(f:User) RETURN f
```

### Nodes without labels

Omit the label to match every node in the graph:

```cypher
MATCH (n) RETURN n
MATCH (n) RETURN count(n) AS totalNodes
MATCH (n) WHERE n.name = 'Alice' RETURN n
```

### Edges without types

Omit the relationship type to match every edge:

```cypher
MATCH ()-[r]->() RETURN count(r) AS totalEdges
MATCH (s:Service)-[]->(t) RETURN s, t
```

### Variable-length unbounded paths

Combine unbounded edges with `*min..max` to traverse any relationship type across multiple hops:

```cypher
MATCH (start:Service {name: 'API Gateway'})-[r*1..3]-(reachable) RETURN start, r, reachable
MATCH (start:Service {name: 'API Gateway'})-[r*2..2]->(reachable) RETURN start, r, reachable
```

---

## OPTIONAL MATCH

Performs a left outer join — returns results even when no matching path exists (with nulls for unmatched variables):

```cypher
MATCH (u:User)
OPTIONAL MATCH (u)-[r:HAS_CARD]->(c:Card)
RETURN u, c
```

---

## UNWIND

Expands a list into one row per element. If the list is `null` or missing, the row is dropped:

```cypher
UNWIND [1, 2, 3] AS x RETURN x
UNWIND ["Alice", "Bob"] AS name RETURN name
```

Combine with `MATCH` to expand a list property:

```cypher
MATCH (u:User) UNWIND u.tags AS tag RETURN u.name, tag
```

Use with `WITH` for aggregation after expansion:

```cypher
MATCH (u:User) UNWIND u.tags AS tag
WITH u.name AS name, tag
RETURN name, tag ORDER BY name, tag
```

---

## RETURN

### Return full nodes, properties, and aliases

```cypher
MATCH (u:User) RETURN u
MATCH (u:User) RETURN u.name, u.age
MATCH (u:User) RETURN u.name AS userName, u.age AS userAge
```

### RETURN DISTINCT

Deduplicate results based on all projected values:

```cypher
MATCH (u:User) RETURN DISTINCT u.dept
MATCH (u:User) RETURN DISTINCT u.name, u.age
```

DISTINCT is applied before `ORDER BY`, `SKIP`, and `LIMIT`:

```cypher
MATCH (u:User) RETURN DISTINCT u.dept ORDER BY u.dept ASC
MATCH (u:User) RETURN DISTINCT u.name SKIP 1 LIMIT 2
```

---

## WITH + Implicit Grouping

Pipe results through intermediate stages. Mixing aggregated and non-aggregated variables triggers implicit grouping:

```cypher
MATCH (u:User)-[:FRIEND]->(f)
WITH u, count(f) AS friendCount
WHERE friendCount > 1
RETURN u.name, friendCount
```

### Aggregation functions

| Function | Description |
|---|---|
| `count(x)` | Count non-null values |
| `count(DISTINCT x)` | Count unique non-null values |
| `sum(x.prop)` | Sum numeric values |
| `sum(DISTINCT x.prop)` | Sum unique numeric values |
| `avg(x.prop)` | Average (null if no values) |
| `avg(DISTINCT x.prop)` | Average of unique values |
| `min(x.prop)` | Minimum (null if no values) |
| `max(x.prop)` | Maximum (null if no values) |

```cypher
MATCH (u:User) RETURN count(DISTINCT u.dept) AS uniqueDepts
MATCH (u:User) RETURN sum(DISTINCT u.score) AS totalScore
MATCH (u:User) RETURN avg(DISTINCT u.score) AS avgScore
```

---

## WHERE

Filter results in `MATCH` or `WITH` clauses.

### WHERE on MATCH

Filter nodes during matching:

```cypher
MATCH (u:User) WHERE u.age > 25 RETURN u
MATCH (a:User)-[r:FRIEND]->(b:User) WHERE a.name CONTAINS "Ali" RETURN a, b
```

### WHERE on WITH

Filter results after a `WITH` clause:

```cypher
MATCH (s:Service)-[]->(t)
WITH s, count(t) AS outDegree
WHERE outDegree > 2
RETURN s.name, outDegree
```

### Comparison operators

| Operator | Example |
|---|---|
| `=` | `WHERE count = 5` |
| `>` | `WHERE count > 5` |
| `<` | `WHERE count < 5` |
| `<>` | `WHERE name <> "api"` |
| `CONTAINS` | `WHERE name CONTAINS "api"` |
| `STARTS WITH` | `WHERE name STARTS WITH "api"` |
| `ENDS WITH` | `WHERE name ENDS WITH "api"` |
| `IN` | `WHERE name IN ["Alice", "Bob"]` |
| `IS NULL` | `WHERE email IS NULL` |
| `IS NOT NULL` | `WHERE email IS NOT NULL` |

> **Note:** `>` and `<` work with both numeric and string values (lexicographic comparison for strings).

### Logical operators (`AND`, `OR`, `NOT`)

```cypher
// AND
MATCH (u:User) WHERE u.age > 25 AND u.name CONTAINS "Ali" RETURN u

// OR
MATCH (u:User) WHERE u.name = "Alice" OR u.age > 30 RETURN u

// NOT
MATCH (u:User) WHERE NOT u.name = "Alice" RETURN u

// Parentheses for precedence
MATCH (u:User) WHERE (u.age > 32 OR u.age < 26) AND u.name CONTAINS "a" RETURN u

// IS NULL / IS NOT NULL
MATCH (u:User) WHERE u.email IS NULL RETURN u
MATCH (u:User) WHERE u.email IS NOT NULL RETURN u

// IN operator
MATCH (u:User) WHERE u.name IN ["Alice", "Bob"] RETURN u
MATCH (u:User) WHERE u.age IN [25, 30, 35] RETURN u
MATCH (u:User) WHERE NOT (u.name IN ["Alice", "Bob"]) RETURN u

// STARTS WITH / ENDS WITH
MATCH (u:User) WHERE u.name STARTS WITH "Al" RETURN u
MATCH (u:User) WHERE u.name ENDS WITH "ie" RETURN u
MATCH (u:User) WHERE NOT (u.name STARTS WITH "A") RETURN u

// String comparisons
MATCH (u:User) WHERE u.name > "C" RETURN u
MATCH (u:User) WHERE u.name < "C" AND u.name > "A" RETURN u
```

> **Note:** `AND` has higher precedence than `OR`. Use parentheses to control evaluation order.
> `IS NULL` matches both explicit `null` values and missing (undefined) properties.

---

## ORDER BY

Sort results. Default direction is `ASC`.

```cypher
MATCH (u:User) RETURN u.name ORDER BY u.name ASC
MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC
MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC, u.name DESC
```

---

## LIMIT and SKIP

```cypher
MATCH (u:User) RETURN u.name LIMIT 5
MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC LIMIT 3
MATCH (u:User) RETURN u.name SKIP 5
MATCH (u:User) RETURN u.name ORDER BY u.name ASC SKIP 10 LIMIT 10
```

---

## Mutations

### CREATE

```cypher
CREATE (l:Log {timestamp: 12345}) RETURN l
```

### SET

```cypher
MATCH (u:User {name: 'Alice'}) SET u.age = 31 RETURN u
```

### DELETE

```cypher
MATCH (f:User {name: 'Bob'}) DELETE f
```

### REMOVE

Remove a label or property from a node. The node and its relationships remain in the graph.

```cypher
MATCH (u:User {name: 'Alice'}) REMOVE u:User RETURN u
MATCH (u:User {name: 'Alice'}) REMOVE u.age RETURN u
MATCH (u:User {name: 'Alice'}) REMOVE u.age, u:User RETURN u
```

Multiple items can be combined in a single REMOVE clause (property and/or label).

---

## Query Patterns

### Blast radius analysis

All nodes affected by a failure (up to N hops, any edge type):

```cypher
MATCH (kafka:Infrastructure {name: "Kafka Cluster"})-[r*1..2]-(affected)
RETURN kafka, r, affected
```

### Dependency chain

Trace the request path from entry point to databases:

```cypher
MATCH (api:Service {name: "API Gateway"})-[r*2..4]->(db:Database)
RETURN api, r, db
```

### Top-N by degree

Find the N nodes with the most outbound connections:

```cypher
MATCH (s:Service)-[]->(target)
WITH s, count(target) AS outDegree
ORDER BY outDegree DESC
LIMIT 3
RETURN s.name, outDegree
```

---

## MERGE (Create or Match)

`MERGE` combines `MATCH` and `CREATE` in one clause. It tries to match the pattern against existing nodes/relationships. If found, it binds the existing elements. If not found, it creates the missing elements.

### Basic MERGE

Ensure a node exists, creating it if needed:

```cypher
MERGE (u:User {name: "Alice"}) RETURN u
```

### MERGE with ON CREATE / ON MATCH

Apply different properties depending on whether the element was created or matched:

```cypher
MERGE (u:User {name: "Alice"})
ON CREATE SET u.createdAt = 0
ON MATCH SET u.lastSeen = 0
RETURN u
```

### MERGE with Relationships

MERGE supports relationship chains. Missing nodes and edges are created as needed:

```cypher
MERGE (a:User {name: "Alice"})-[:FRIEND]->(b:User {name: "Bob"})
RETURN a, b
```

### MERGE with Directional Relationships

```cypher
MERGE (a:User)<-[:FRIEND]-(b:User)  -- inbound
MERGE (a:User)-[:FRIEND]-(b:User)   -- undirected
```

### MERGE followed by MATCH

Use MERGE to ensure data exists, then query it:

```cypher
MERGE (u:User {name: "Alice"})
MATCH (u)-[:FRIEND]->(f)
RETURN u, f
```

---

## Unsupported Features

The following Cypher features are **not** supported by the engine:

- **Subqueries** — `CALL {}` syntax
- **APOC procedures** — `CALL apoc.*`
- **Multiple MATCH in same stage** — use `WITH` to chain stages
- **FOREACH** — not implemented; use multiple `SET` clauses with `MATCH` instead
- **UNION** — not implemented; run separate queries and merge results externally (e.g. with `jq` or in your application code)
- **MERGE with WHERE** — use property filters in the pattern instead
- **MERGE with DELETE/REMOVE** — only SET is supported in ON CREATE/ON MATCH


## Next Steps

- **[Library API]({{ '/library-api/' | relative_url }})** — Use gcyphrq programmatically in your code
- **[Examples]({{ '/examples/' | relative_url }})** — 30 ready-to-run queries with sample output
