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

See the [Home page](/) for the full feature support table.

<div class="callout">
  <p><strong>Single MATCH per stage:</strong> The engine processes one MATCH clause at a time. Chained MATCHes within the same stage are not supported — use multiple stages separated by <code>WITH</code> instead.</p>
</div>

---

## MATCH

### Basic node match

```cypher
MATCH (u:User) RETURN u
```

### Match with property filter

```cypher
MATCH (u:User {name: 'Alice'}) RETURN u
```

### Match with relationships

```cypher
MATCH (u:User)-[:FRIEND]->(f:User) RETURN u, f
```

### Variable-length paths

```cypher
MATCH (u:User)-[r:FRIEND*1..3]-(f:User) RETURN u, r, f
```

The `*min..max` syntax specifies the minimum and maximum path length. Use `*1..3` for 1 to 3 hops, `*2..2` for exactly 2 hops, etc.

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

---

## OPTIONAL MATCH

Performs a left outer join — returns results even when no matching path exists (with nulls for unmatched variables):

```cypher
MATCH (u:User)
OPTIONAL MATCH (u)-[r:HAS_CARD]->(c:Card)
RETURN u, c
```

---

## RETURN

### Return full nodes

```cypher
MATCH (u:User) RETURN u
```

### Return specific properties

```cypher
MATCH (u:User) RETURN u.name, u.age
```

### Return with aliases

```cypher
MATCH (u:User) RETURN u.name AS userName, u.age AS userAge
```

---

## WITH + Implicit Grouping

Use `WITH` to pipe results through intermediate stages. When you include both aggregated and non-aggregated variables, implicit grouping occurs:

```cypher
MATCH (u:User)-[:FRIEND]->(f)
WITH u, count(f) AS friendCount
WHERE friendCount > 1
RETURN u.name, friendCount
```

### Supported aggregations

| Function | Description |
|---|---|
| `count(x)` | Count non-null values |
| `sum(x.prop)` | Sum numeric values |
| `avg(x.prop)` | Average of numeric values (null if no values) |
| `min(x.prop)` | Minimum numeric value (null if no values) |
| `max(x.prop)` | Maximum numeric value (null if no values) |

---

## WHERE

Filter results in `MATCH` or `WITH` clauses.

### WHERE on MATCH

Filter nodes directly during matching:

```cypher
MATCH (u:User)
WHERE u.age > 25
RETURN u
```

Works with relationship traversals:

```cypher
MATCH (a:User)-[r:FRIEND]->(b:User)
WHERE a.name CONTAINS "Ali"
RETURN a, b
```

### WHERE on WITH

Filter results after a `WITH` clause:

```cypher
MATCH (s:Service)-[]->(t)
WITH s, count(t) AS outDegree
WHERE outDegree > 2
RETURN s.name, outDegree
```

### Supported comparison operators

| Operator | Example |
|---|---|
| `=` | `WHERE count = 5` |
| `>` | `WHERE count > 5` |
| `<` | `WHERE count < 5` |
| `<>` | `WHERE name <> "api"` |
| `CONTAINS` | `WHERE name CONTAINS "api"` |

### Logical operators

Combine conditions with `AND`, `OR`, and `NOT`:

```cypher
// AND — both conditions must be true
MATCH (u:User)
WHERE u.age > 25 AND u.name CONTAINS "Ali"
RETURN u

// OR — either condition can be true
MATCH (u:User)
WHERE u.name = "Alice" OR u.age > 30
RETURN u

// NOT — negate a condition
MATCH (u:User)
WHERE NOT u.name = "Alice"
RETURN u

// Combined with parentheses
MATCH (u:User)
WHERE (u.age > 32 OR u.age < 26) AND u.name CONTAINS "a"
RETURN u

// Multiple AND conditions
MATCH (u:User)
WHERE u.age > 20 AND u.age < 35 AND u.name CONTAINS "li"
RETURN u

// Multiple OR conditions
MATCH (u:User)
WHERE u.name = "Alice" OR u.name = "Bob" OR u.name = "Charlie"
RETURN u

// AND with higher precedence than OR
MATCH (u:User)
WHERE u.age > 25 AND u.name = "Alice" OR u.age < 26
RETURN u
```

> **Note:** `AND` has higher precedence than `OR`. Use parentheses to control evaluation order.

---

## ORDER BY

Sort results by one or more properties. Default direction is `ASC` (ascending).

```cypher
// Single column, ascending (default)
MATCH (u:User) RETURN u.name ORDER BY u.name

// Single column, descending
MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC

// Multiple columns
MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC, u.name DESC
```

---

## LIMIT

Return only the first N results:

```cypher
MATCH (u:User) RETURN u.name LIMIT 5

// Combined with ORDER BY for top-N
MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC LIMIT 3
```

---

## SKIP

Skip the first N results:

```cypher
MATCH (u:User) RETURN u.name SKIP 5

// Pagination: page 2 with 10 results per page
MATCH (u:User) RETURN u.name ORDER BY u.name ASC SKIP 10 LIMIT 10
```

---

## Mutations

### CREATE

Create a new node:

```cypher
CREATE (l:Log {timestamp: 12345})
RETURN l
```

### SET

Update a node property:

```cypher
MATCH (u:User {name: 'Alice'})
SET u.age = 31
RETURN u
```

### DELETE

Remove a node from the graph:

```cypher
MATCH (f:User {name: 'Bob'})
DELETE f
```

---

## Query Patterns

### Blast radius analysis

Find all nodes affected by a failure (up to N hops):

```cypher
MATCH (kafka:Infrastructure {name: "Kafka Cluster"})-[r*1..2]-(affected)
RETURN kafka, r, affected
```

### Dependency chain

Trace the full request path from entry point to databases:

```cypher
MATCH (api:Service {name: "API Gateway"})-[r*2..4]->(db:Database)
RETURN api, r, db
```

### Collaborative filtering

Find items recommended based on what "friends of friends" bought:

```cypher
MATCH (u:User {id: 'usr_abc'})-[:FRIEND*2..2]-(peer:User)-[:BOUGHT]->(item:Product)
OPTIONAL MATCH (u)-[already_owns:BOUGHT]->(item)
WITH item, already_owns
RETURN item
```

> **Note:** `IS NULL` is not yet supported, so filtering out already-owned items must be done post-query (e.g., with `jq`).

### What-if impact simulation

Inject speculative properties mid-pipeline:

```cypher
MATCH (s:Server {id: 'srv_A'})-[:DEPENDS_ON*1..3]->(downstream:Application)
SET s.capacity = 90
WITH downstream, s
WHERE downstream.min_required_capacity > s.capacity
RETURN downstream.name AS at_risk_application, s.capacity AS simulated_capacity
```

### Top-N by degree

Find the N nodes with the most connections:

```cypher
MATCH (s:Service)-[]->(target)
WITH s, count(target) AS outDegree
ORDER BY outDegree DESC
LIMIT 3
RETURN s.name, outDegree
```

---

## Unsupported Features

The following Cypher features are **not** supported by the engine:

- **Subqueries** — `CALL {}` syntax
- **APOC procedures** — `CALL apoc.*`
- **Multiple MATCH in same stage** — use `WITH` to chain stages
- **MERGE** — use `CREATE` or `MATCH` + `CREATE` instead
- **FOREACH** — not implemented
- **UNION** — not implemented
- **`IS NULL` / `IS NOT NULL`** — filter nulls post-query with `jq` instead

## Next Steps

- **[Library API](library-api)** — Use gcyphrq programmatically in your code
- **[Examples](examples)** — 25 ready-to-run queries against the bundled cloud infrastructure graph
