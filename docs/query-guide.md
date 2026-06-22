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

## RETURN

### Return full nodes, properties, and aliases

```cypher
MATCH (u:User) RETURN u
MATCH (u:User) RETURN u.name, u.age
MATCH (u:User) RETURN u.name AS userName, u.age AS userAge
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
| `sum(x.prop)` | Sum numeric values |
| `avg(x.prop)` | Average (null if no values) |
| `min(x.prop)` | Minimum (null if no values) |
| `max(x.prop)` | Maximum (null if no values) |

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
| `IS NULL` | `WHERE email IS NULL` |
| `IS NOT NULL` | `WHERE email IS NOT NULL` |

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

## Unsupported Features

The following Cypher features are **not** supported by the engine:

- **Subqueries** — `CALL {}` syntax
- **APOC procedures** — `CALL apoc.*`
- **Multiple MATCH in same stage** — use `WITH` to chain stages
- **MERGE** — use `CREATE` or `MATCH` + `CREATE` instead
- **FOREACH** — not implemented; use multiple `SET` clauses with `MATCH` instead
- **UNION** — not implemented; run separate queries and merge results externally (e.g. with `jq` or in your application code)


## Next Steps

- **[Library API]({{ '/library-api/' | relative_url }})** — Use gcyphrq programmatically in your code
- **[Examples]({{ '/examples/' | relative_url }})** — 30 ready-to-run queries with sample output
