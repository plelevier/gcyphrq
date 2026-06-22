---
layout: default
title: Examples
description: 30 ready-to-run Cypher queries with sample output against a small team graph.
---

<div class="breadcrumb">
  <a href="{{ '/' | relative_url }}">Home</a> <span>›</span> Examples
</div>

# Examples

This page provides ready-to-run Cypher queries with sample output. All examples use the same small sample graph defined below.

---

## Sample Graph

Every example on this page queries the following graph file (`examples/team.json`):

```json
{
  "nodes": [
    { "key": "alice", "attributes": { "label": "Person", "name": "Alice", "role": "Engineer", "department": "Backend", "age": 30, "email": "alice@co.com" } },
    { "key": "bob", "attributes": { "label": "Person", "name": "Bob", "role": "Engineer", "department": "Frontend", "age": 25 } },
    { "key": "charlie", "attributes": { "label": "Person", "name": "Charlie", "role": "Designer", "department": "Design", "age": 35, "email": "charlie@co.com" } },
    { "key": "diana", "attributes": { "label": "Person", "name": "Diana", "role": "Manager", "department": "Backend", "age": 40, "email": "diana@co.com" } },
    { "key": "eve", "attributes": { "label": "Person", "name": "Eve", "role": "Engineer", "department": "Backend", "age": 28 } },
    { "key": "frank", "attributes": { "label": "Person", "name": "Frank", "role": "Designer", "department": "Design", "age": 32 } }
  ],
  "edges": [
    { "source": "alice", "target": "bob", "attributes": { "type": "WORKS_WITH" } },
    { "source": "alice", "target": "charlie", "attributes": { "type": "WORKS_WITH" } },
    { "source": "alice", "target": "eve", "attributes": { "type": "WORKS_WITH" } },
    { "source": "bob", "target": "charlie", "attributes": { "type": "WORKS_WITH" } },
    { "source": "diana", "target": "alice", "attributes": { "type": "MANAGES" } },
    { "source": "diana", "target": "eve", "attributes": { "type": "MANAGES" } }
  ]
}
```

### Visual structure

```
Diana (Manager, Backend, 40)
  └─MANAGES─> Alice (Engineer, Backend, 30)
              ├─WORKS_WITH─> Bob (Engineer, Frontend, 25)
              │               └─WORKS_WITH─> Charlie (Designer, Design, 35)
              ├─WORKS_WITH─> Charlie
              └─WORKS_WITH─> Eve (Engineer, Backend, 28)
  └─MANAGES─> Eve

Frank (Designer, Design, 32) — no connections
```

- **6 nodes**, **6 edges**
- 3 Engineers, 2 Designers, 1 Manager
- Alice, Charlie, and Diana have an `email` property; Bob, Eve, and Frank do not
- Frank is isolated (no incoming or outgoing edges)

All examples use `--format rows` for clean, predictable row-based JSON output.

---

## Basic Node Queries

### 1. Find nodes by label and property filter

Find every person with the role `Engineer`:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person {role: "Engineer"}) RETURN p.name, p.department' --format rows
```

**Output:**

```json
[
  { "name": "Alice", "department": "Backend" },
  { "name": "Bob", "department": "Frontend" },
  { "name": "Eve", "department": "Backend" }
]
```

### 2. Find a node by property value

Look up a specific person by name:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person {name: "Alice"}) RETURN p.name, p.role, p.department' --format rows
```

**Output:**

```json
[
  { "name": "Alice", "role": "Engineer", "department": "Backend" }
]
```

### 3. Count all nodes

Count every node in the graph regardless of label:

```bash
gcyphrq -g examples/team.json -e 'MATCH (n) RETURN count(n) AS totalNodes' --format rows
```

**Output:**

```json
[
  { "totalNodes": 6 }
]
```

### 4. Count all edges

Count every edge in the graph regardless of type:

```bash
gcyphrq -g examples/team.json -e 'MATCH ()-[r]->() RETURN count(r) AS totalEdges' --format rows
```

**Output:**

```json
[
  { "totalEdges": 6 }
]
```

### 5. Alias projections

Rename columns in the output with `AS`:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) WHERE p.role = "Designer" RETURN p.name AS fullName, p.role AS jobTitle, p.department AS team' --format rows
```

**Output:**

```json
[
  { "fullName": "Charlie", "jobTitle": "Designer", "team": "Design" },
  { "fullName": "Frank", "jobTitle": "Designer", "team": "Design" }
]
```

---

## Relationship Queries

### 6. Outbound relationships

Find everyone Alice collaborates with (outbound `WORKS_WITH` edges only):

```bash
gcyphrq -g examples/team.json -e 'MATCH (a:Person {name: "Alice"})-[:WORKS_WITH]->(p) RETURN a.name AS source, p.name AS target' --format rows
```

**Output:**

```json
[
  { "source": "Alice", "target": "Bob" },
  { "source": "Alice", "target": "Charlie" },
  { "source": "Alice", "target": "Eve" }
]
```

### 7. Inbound relationships

Find who manages Alice (inbound `MANAGES` edge):

```bash
gcyphrq -g examples/team.json -e 'MATCH (a:Person {name: "Alice"})<-[r:MANAGES]-(m:Person) RETURN m.name AS manager, a.name AS report' --format rows
```

**Output:**

```json
[
  { "manager": "Diana", "report": "Alice" }
]
```

### 8. Undirected relationships

Find all people directly connected to Alice, regardless of edge direction:

```bash
gcyphrq -g examples/team.json -e 'MATCH (a:Person {name: "Alice"})-[r]-(p) RETURN a.name AS source, p.name AS target' --format rows
```

**Output:**

```json
[
  { "source": "Alice", "target": "Diana" },
  { "source": "Alice", "target": "Bob" },
  { "source": "Alice", "target": "Charlie" },
  { "source": "Alice", "target": "Eve" }
]
```

### 9. Variable-length paths (direct reports only)

Find everyone Diana manages directly (1-hop outbound):

```bash
gcyphrq -g examples/team.json -e 'MATCH (d:Person {name: "Diana"})-[r*1..1]->(p:Person) RETURN d.name AS start, p.name AS reachable' --format rows
```

**Output:**

```json
[
  { "start": "Diana", "reachable": "Alice" },
  { "start": "Diana", "reachable": "Eve" }
]
```

### 10. Variable-length paths (multi-hop)

Find everyone reachable from Diana within 2 hops (includes Alice's collaborators):

```bash
gcyphrq -g examples/team.json -e 'MATCH (d:Person {name: "Diana"})-[r*1..2]->(p:Person) RETURN d.name AS start, p.name AS reachable' --format rows
```

**Output:**

```json
[
  { "start": "Diana", "reachable": "Alice" },
  { "start": "Diana", "reachable": "Bob" },
  { "start": "Diana", "reachable": "Charlie" },
  { "start": "Diana", "reachable": "Eve" },
  { "start": "Diana", "reachable": "Eve" }
]
```

> **Note:** Eve appears twice because there are two distinct paths to her: `Diana → Eve` (1-hop) and `Diana → Alice → Eve` (2-hop). Variable-length paths return one row per path, not per unique node.

### 11. Count outbound connections for a node

Count how many direct outbound connections Alice has:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person {name: "Alice"})-[]->(t) RETURN count(t) AS connections' --format rows
```

**Output:**

```json
[
  { "connections": 3 }
]
```

---

## Filtering with WHERE

### 12. Comparison operators

Find people older than 30, sorted by age:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) WHERE p.age > 30 RETURN p.name, p.age ORDER BY p.age ASC' --format rows
```

**Output:**

```json
[
  { "name": "Frank", "age": 32 },
  { "name": "Charlie", "age": 35 },
  { "name": "Diana", "age": 40 }
]
```

### 13. NOT equal (`<>`)

Find everyone except Alice:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) WHERE p.name <> "Alice" RETURN p.name' --format rows
```

**Output:**

```json
[
  { "name": "Bob" },
  { "name": "Charlie" },
  { "name": "Diana" },
  { "name": "Eve" },
  { "name": "Frank" }
]
```

### 14. AND

Find Backend Engineers:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) WHERE p.role = "Engineer" AND p.department = "Backend" RETURN p.name' --format rows
```

**Output:**

```json
[
  { "name": "Alice" },
  { "name": "Eve" }
]
```

### 15. OR

Find Managers or Designers:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) WHERE p.role = "Manager" OR p.role = "Designer" RETURN p.name, p.role' --format rows
```

**Output:**

```json
[
  { "name": "Charlie", "role": "Designer" },
  { "name": "Diana", "role": "Manager" },
  { "name": "Frank", "role": "Designer" }
]
```

### 16. NOT

Find everyone who is not in the Backend department:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) WHERE NOT p.department = "Backend" RETURN p.name, p.department ORDER BY p.name ASC' --format rows
```

**Output:**

```json
[
  { "name": "Bob", "department": "Frontend" },
  { "name": "Charlie", "department": "Design" },
  { "name": "Frank", "department": "Design" }
]
```

### 17. Parenthesized precedence

Find Engineers who are either over 32 or under 26:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) WHERE (p.age > 32 OR p.age < 26) AND p.role = "Engineer" RETURN p.name, p.age' --format rows
```

**Output:**

```json
[
  { "name": "Bob", "age": 25 }
]
```

### 18. CONTAINS

Find people in a department whose name contains "ack" (matches "Backend"):

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) WHERE p.department CONTAINS "ack" RETURN p.name, p.department' --format rows
```

**Output:**

```json
[
  { "name": "Alice", "department": "Backend" },
  { "name": "Diana", "department": "Backend" },
  { "name": "Eve", "department": "Backend" }
]
```

### 19. IS NOT NULL

Find people who have an email address:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) WHERE p.email IS NOT NULL RETURN p.name, p.email' --format rows
```

**Output:**

```json
[
  { "name": "Alice", "email": "alice@co.com" },
  { "name": "Charlie", "email": "charlie@co.com" },
  { "name": "Diana", "email": "diana@co.com" }
]
```

### 20. IS NULL

Find people without an email address:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) WHERE p.email IS NULL RETURN p.name' --format rows
```

**Output:**

```json
[
  { "name": "Bob" },
  { "name": "Eve" },
  { "name": "Frank" }
]
```

---

## Aggregations

### 21. Group and count with WITH

Count how many direct reports each manager has:

```bash
gcyphrq -g examples/team.json -e 'MATCH (m:Person)-[:MANAGES]->(e:Person) WITH m, count(e) AS teamSize RETURN m.name, teamSize' --format rows
```

**Output:**

```json
[
  { "name": "Diana", "teamSize": 2 }
]
```

### 22. Aggregate functions

Compute statistics across all Engineers:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person {role: "Engineer"}) RETURN count(p) AS totalEngineers, sum(p.age) AS totalAge, min(p.age) AS youngest, max(p.age) AS oldest, avg(p.age) AS avgAge' --format rows
```

**Output:**

```json
[
  { "totalEngineers": 3, "totalAge": 83, "youngest": 25, "oldest": 30, "avgAge": 27.666666666666668 }
]
```

> **Note:** `avg()` returns a floating-point value. Use `round()` in your application code if you need a specific precision.

### 23. WHERE on WITH

Find people with more than 1 outbound connection, ranked by connection count:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person)-[]->(t:Person) WITH p, count(t) AS outDegree WHERE outDegree > 1 RETURN p.name, outDegree ORDER BY outDegree DESC' --format rows
```

**Output:**

```json
[
  { "name": "Alice", "outDegree": 3 },
  { "name": "Diana", "outDegree": 2 }
]
```

---

## Optional Matching

### 24. OPTIONAL MATCH

Find everyone and their direct reports — people with no reports still appear with `null`:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) OPTIONAL MATCH (p)-[:MANAGES]->(r:Person) RETURN p.name AS person, r.name AS report' --format rows
```

**Output:**

```json
[
  { "person": "Alice", "report": null },
  { "person": "Bob", "report": null },
  { "person": "Charlie", "report": null },
  { "person": "Diana", "report": "Alice" },
  { "person": "Diana", "report": "Eve" },
  { "person": "Eve", "report": null },
  { "person": "Frank", "report": null }
]
```

---

## Sorting and Pagination

### 25. ORDER BY

List Engineers sorted by age (oldest first):

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) WHERE p.role = "Engineer" RETURN p.name, p.age ORDER BY p.age DESC' --format rows
```

**Output:**

```json
[
  { "name": "Alice", "age": 30 },
  { "name": "Eve", "age": 28 },
  { "name": "Bob", "age": 25 }
]
```

### 26. LIMIT

Get the first 3 people alphabetically:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) RETURN p.name ORDER BY p.name ASC LIMIT 3' --format rows
```

**Output:**

```json
[
  { "name": "Alice" },
  { "name": "Bob" },
  { "name": "Charlie" }
]
```

### 27. SKIP + LIMIT (pagination)

Get page 2 (skip first 2, take next 2):

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person) RETURN p.name ORDER BY p.name ASC SKIP 2 LIMIT 2' --format rows
```

**Output:**

```json
[
  { "name": "Charlie" },
  { "name": "Diana" }
]
```

---

## Mutations

Mutations modify the graph in-memory during query execution. They do not persist to the original file.

### 28. CREATE

Add a new person to the graph:

```bash
gcyphrq -g examples/team.json -e 'CREATE (n:Person {name: "Grace", role: "Engineer", department: "Frontend", age: 27}) RETURN n.name, n.role, n.department' --format rows
```

**Output:**

```json
[
  { "name": "Grace", "role": "Engineer", "department": "Frontend" }
]
```

### 29. SET

Update Bob's age:

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person {name: "Bob"}) SET p.age = 26 RETURN p.name, p.age' --format rows
```

**Output:**

```json
[
  { "name": "Bob", "age": 26 }
]
```

### 30. DELETE

Remove an isolated node (Frank has no connections):

```bash
gcyphrq -g examples/team.json -e 'MATCH (p:Person {name: "Frank"}) DELETE p' --format rows
```

**Output:**

```json
[]
```

> **Note:** `DELETE` without a `RETURN` clause produces an empty array (`[]`). The graph is modified in-memory for subsequent queries in the same session.

---

## Next Steps

- **[Getting Started]({{ '/getting-started/' | relative_url }})** — Install gcyphrq and run your first query
- **[Query Guide]({{ '/query-guide/' | relative_url }})** — Full Cypher syntax reference and query patterns
- **[Library API]({{ '/library-api/' | relative_url }})** — Use gcyphrq programmatically in your code
- **[CLI Reference]({{ '/cli/' | relative_url }})** — Full documentation of CLI options and usage patterns
