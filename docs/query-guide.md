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

## Graph Options

The graph JSON file supports an optional `options` field to configure graph behavior:

```json
{
  "options": {
    "type": "directed",
    "allowSelfLoops": true,
    "multi": true
  },
  "nodes": [...],
  "edges": [...]
}
```

| Option | Default | Description |
|---|---|---|
| `type` | `"directed"` | Graph directionality: `"directed"`, `"undirected"`, or `"mixed"` |
| `allowSelfLoops` | `false` | Enable edges where `source` equals `target` |
| `multi` | `false` | Enable parallel edges (multiple edges between the same nodes) |

### Parallel edges (multi-graphs)

When `multi: true`, the graph allows multiple edges between the same node pair. `MATCH` clauses return all parallel edges, and you can filter by relationship type to select specific ones:

```cypher
-- Return all edges between Alice and Bob (may be multiple)
MATCH (a:Person {name: "Alice"})-[r]->(b:Person {name: "Bob"}) RETURN r

-- Filter to a specific relationship type
MATCH (a:Person {name: "Alice"})-[r:KNOWS]->(b:Person {name: "Bob"}) RETURN r
```

When `multi: false` (default), duplicate edges between the same nodes are rejected during graph loading.

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

### Multiple labels

A node can carry multiple labels. Use colon-separated labels for AND semantics (the node must have **all** specified labels):

```cypher
MATCH (n:Service:Infrastructure) RETURN n
```

In your graph file, store multiple labels as an array:

```json
{ "key": "api", "attributes": { "label": ["Service", "Infrastructure"], "name": "API" } }
```

A single label remains a plain string: `{ "label": "Service" }`.

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

### Path variables

Capture an entire path (nodes and relationships) in a single variable using `MATCH path = ...`:

```cypher
// Capture a simple path
MATCH path=(a:User)-[:FRIEND]->(b:User)
RETURN path

// Path with variable-length edges
MATCH path=(a:Service)-[*1..3]->(b:Database)
RETURN path

// Use with nodes() and relationships() functions
MATCH path=(a)-[r]->(b) RETURN nodes(path)
MATCH path=(a)-[r]->(b) RETURN relationships(path)
```

Path variables produce objects with `{ nodes: [...], relationships: [...] }` structure. Individual node and edge variables (`a`, `r`, `b`) are still bound independently alongside the path variable.

On `OPTIONAL MATCH` miss, the path variable is set to `null`.

```cypher
MATCH (n)
OPTIONAL MATCH path=(n)-[:FRIEND]->(m)
RETURN n.name, path
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

### Scalar functions

Scalar functions operate on individual values and work in `RETURN`, `WHERE`, `WITH`, and `ORDER BY` clauses. Nested calls are supported.

| Function | Description |
|---|---|
| `toLower(x)` | Convert string to lowercase |
| `toUpper(x)` | Convert string to uppercase |
| `substring(x, start, end)` | Extract substring (end is optional) |
| `split(x, delimiter)` | Split string into list |
| `repl(x, search, replacement)` | Replace occurrences (alias for `replace` — reserved keyword) |
| `trim(x)` | Trim whitespace from both ends |
| `ltrim(x)` | Trim whitespace from left |
| `rtrim(x)` | Trim whitespace from right |
| `length(x)` | String character count or list element count |
| `head(x)` | First element of a list |
| `last(x)` | Last element of a list |
| `tail(x)` | All elements except the first |
| `reverse(x)` | Reverse elements of a list |
| `size(x)` | Number of elements in a list (or string length) |
| `id(x)` | Node or edge ID |
| `labels(x)` | Node labels as list |
| `labelsOf(x)` | Node labels as list (alias for `labels`) |
| `nodes(path)` | Nodes from a path variable |
| `relationships(path)` | Relationships from a path variable |
| `reltype(x)` | Relationship type (alias for `type` — reserved keyword) |
| `startnode(x)` | Source node ID of a relationship |
| `endnode(x)` | Target node ID of a relationship |
| `coalesce(x, y, ...)` | First non-null argument |
| `toString(x)` | Convert value to string |
| `toInteger(x)` | Convert value to integer |
| `toFloat(x)` | Convert value to float |

```cypher
MATCH (u:User) RETURN toLower(u.name) AS lowerName
MATCH (u:User) WHERE toUpper(u.email) CONTAINS "@EXAMPLE.COM" RETURN u
MATCH (u:User) RETURN substring(u.name, 0, 3) AS initials
MATCH (u:User) RETURN split(u.email, '@')[0] AS username
MATCH (u:User) RETURN length(u.name) AS nameLen
MATCH (u:User) RETURN coalesce(u.nick, u.name, 'Unknown') AS displayName
MATCH (u:User) RETURN toInteger(u.age) AS age
```

> **Note:** `repl` is used instead of `replace`, and `reltype` instead of `type` because these are reserved keywords in the ANTLR4 Cypher grammar. `labels` is standard Cypher and works as the sole item in RETURN (e.g., `RETURN labels(n)`); use `labelsOf` in WHERE/WITH/ORDER BY or when combined with other RETURN items (ANTLR4 keyword limitation). `startnode()` and `endnode()` return string IDs, not node objects. `nodes(path)` and `relationships(path)` extract from path variables bound with `MATCH path = ...`. `labels()`, `nodes()`, and `relationships()` do not support `AS` aliases (ANTLR4 grammar limitation — use the auto-generated column name like `labels(n)` or `nodes(path)`).

---

## CASE Expressions

Conditional expressions that return different values based on conditions. Work in `RETURN`, `WHERE`, `WITH`, `ORDER BY`, and `SET` clauses.

### General CASE

`CASE WHEN condition THEN result` evaluates boolean conditions in order and returns the first matching result:

```cypher
// Simple equality
MATCH (u:User) RETURN u.name, CASE WHEN u.name = 'Alice' THEN 'first' ELSE 'other' END AS position

// Multiple conditions
MATCH (u:User) RETURN u.name,
  CASE
    WHEN u.age >= 35 THEN 'senior'
    WHEN u.age >= 25 THEN 'mid'
    ELSE 'junior'
  END AS tier

// Comparison operators
MATCH (u:User) RETURN u.name,
  CASE
    WHEN u.name STARTS WITH 'A' THEN 'A-group'
    WHEN u.name CONTAINS 'ob' THEN 'B-group'
    ELSE 'other'
  END AS group

// Logical operators (AND, OR, NOT)
MATCH (u:User) RETURN u.name,
  CASE
    WHEN u.age > 25 AND u.name = 'Alice' THEN 'match'
    ELSE 'no match'
  END AS result

// IS NULL / IS NOT NULL
MATCH (u:User) RETURN u.name,
  CASE
    WHEN u.email IS NULL THEN 'no email'
    ELSE 'has email'
  END AS status

// No ELSE clause returns null when no condition matches
MATCH (u:User) RETURN u.name,
  CASE WHEN u.name = 'Alice' THEN 1 END AS flag
```

### Simple CASE

`CASE expr WHEN value THEN result` compares a subject expression for equality against each WHEN value:

```cypher
MATCH (u:User) RETURN u.name,
  CASE u.role
    WHEN 'Engineer' THEN 'eng'
    WHEN 'Manager' THEN 'mgmt'
    ELSE 'other'
  END AS dept

// Numeric subject
MATCH (u:User) RETURN u.name,
  CASE u.age
    WHEN 30 THEN 'thirty'
    WHEN 25 THEN 'twenty-five'
    ELSE 'other'
  END AS ageGroup
```

### Nested CASE

CASE expressions can be nested within any expression position:

```cypher
MATCH (u:User) RETURN u.name,
  CASE
    WHEN u.name = 'Alice'
      THEN CASE WHEN u.age >= 30 THEN 'mature Alice' ELSE 'young Alice' END
    ELSE 'not Alice'
  END AS desc
```

### CASE with other expressions

CASE works with arithmetic, functions, and all value expressions:

```cypher
// Arithmetic in THEN
MATCH (u:User) RETURN u.name,
  CASE WHEN u.score > 90 THEN u.score * 2 ELSE u.score END AS adjusted

// Functions in THEN
MATCH (u:User) RETURN u.name,
  CASE WHEN u.name = 'Alice' THEN toUpper(u.name) ELSE u.name END AS displayName

// In ORDER BY
MATCH (u:User) RETURN u.name
  ORDER BY CASE u.role WHEN 'Manager' THEN 0 WHEN 'Engineer' THEN 1 ELSE 2 END

// In SET
MATCH (u:User) SET u.tier = CASE WHEN u.age >= 30 THEN 'senior' ELSE 'junior' END RETURN u.name, u.tier

// In WITH
MATCH (u:User)
WITH u.name, CASE WHEN u.age >= 30 THEN 'senior' ELSE 'junior' END AS tier
RETURN name, tier
```

> **Note:** General CASE conditions support all WHERE operators (`=`, `<>`, `>`, `>=`, `<`, `<=`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `IS NULL`, `IS NOT NULL`) plus `AND`, `OR`, `NOT`. Simple CASE compares for equality only.

---

## Arithmetic Expressions

Perform numeric calculations using standard arithmetic operators. Work in `RETURN`, `WHERE`, `WITH`, `ORDER BY`, and `SET` clauses. Parentheses control precedence.

| Operator | Description | Example | Result |
|---|---|---|---|
| `+` | Addition | `n.price + n.tax` | Sum of two values |
| `-` | Subtraction | `n.price - n.discount` | Difference |
| `*` | Multiplication | `n.price * n.qty` | Product |
| `/` | Division | `n.total / n.count` | Quotient (null if divisor is 0) |
| `%` | Modulo | `n.value % 10` | Remainder (null if divisor is 0) |
| `^` | Power | `n.value ^ 2` | Exponentiation |
| `-x` | Unary minus | `-n.price` | Negation |
| `+x` | Unary plus | `+n.price` | Identity |

```cypher
-- Basic arithmetic in RETURN
MATCH (n:Product) RETURN n.name, n.price * n.qty AS total

-- Multiple operators with precedence
MATCH (n:Product) RETURN n.name, n.price * 2 + n.shipping AS cost

-- Parentheses for grouping
MATCH (n:Product) RETURN n.name, (n.price + n.tax) * 1.1 AS finalPrice

-- Arithmetic in WHERE
MATCH (n:Product) WHERE n.price * n.qty > 100 RETURN n.name

-- Arithmetic in SET
MATCH (n:Product) SET n.total = n.price * n.qty RETURN n.name, n.total

-- Arithmetic in ORDER BY
MATCH (n:Product) RETURN n.name ORDER BY n.price * n.qty DESC

-- Chained operators
MATCH (n:Product) RETURN n.name, n.price + n.tax + n.shipping AS total

-- Double negation
MATCH (n:Product) RETURN n.name, -(-n.price) AS positive

-- Arithmetic with functions
MATCH (n:Product) RETURN n.name, length(n.name) * 2 AS nameLenDoubled
```

> **Null propagation:** If any operand is `null` (missing property or explicit null), the result is `null`. Division and modulo by zero return `null`.

---

## List Literals

Create inline list objects using `[val1, val2, ...]` syntax. List values can be static literals or dynamic expressions (property access, function calls, map literals).

| Syntax | Description | Example |
|---|---|---|
| `[1, 2, 3]` | Static list literal | `RETURN [1, 2, 3] AS nums` |
| `[n.name, "static"]` | Dynamic property access | `MATCH (n) RETURN [n.name, toUpper(n.name)] AS info` |
| `[{a: 1}, {a: 2}]` | List of map literals | `UNWIND [{name: "Alice"}, {name: "Bob"}] AS x RETURN x` |

```cypher
-- Static list in RETURN
RETURN [1, 2, 3] AS nums

-- Dynamic list with property access and functions
MATCH (n:User) WHERE n.name = 'Alice' RETURN [n.name, toUpper(n.name), n] AS info

-- List in WHERE IN (dynamic values evaluated at runtime)
MATCH (n:User) WHERE n.name IN [n.name] RETURN n

-- List of map literals in UNWIND
UNWIND [{name: "Alice"}, {name: "Bob"}] AS x RETURN x
```

---

## List Slicing

Extract portions of lists using bracket notation. Works on both list literals and property access.

| Syntax | Description | Example | Result |
|---|---|---|---|
| `[start..end]` | Elements from `start` to `end-1` | `[1,2,3,4,5][1..3]` | `[2, 3]` |
| `[..end]` | Elements from beginning to `end-1` | `[1,2,3,4,5][..3]` | `[1, 2, 3]` |
| `[start..]` | Elements from `start` to end | `[1,2,3,4,5][2..]` | `[3, 4, 5]` |
| `[index]` | Single element at `index` | `[1,2,3,4,5][2]` | `3` |
| `[-1]` | Last element (negative index) | `[1,2,3,4,5][-1]` | `5` |
| `[-2..-1]` | Negative range | `[1,2,3,4,5][-2..-1]` | `[4]` |

```cypher
-- Slice a property that is a list
MATCH (n:User) RETURN n.tags[0..2] AS firstTags

-- Negative indices
RETURN [1,2,3,4,5][-3..] AS lastThree

-- Combine with list functions
RETURN size([1,2,3,4,5][1..3]) AS sliceSize
RETURN head(reverse([1,2,3])) AS lastElement
```

---

## Map Literals

Create inline map (key-value) objects using `{key: value}` syntax. Map values can be static literals, property access, function calls, nodes, or lists.

| Syntax | Description | Example |
|---|---|---|
| `{key: val}` | Static map literal | `RETURN {name: "Alice", age: 30} AS m` |
| `{key: n.prop}` | Dynamic property access | `RETURN {name: n.name, upper: toUpper(n.name)} AS profile` |
| `{key: split(...)}` | Function call value | `RETURN {name: n.name, tags: split(n.name, "")} AS m` |
| `{key: n}` | Node reference value | `RETURN {name: n.name, node: n} AS m` |
| `n = {key: val}` | WHERE map comparison (subset match) | `MATCH (n) WHERE n = {name: "Alice"} RETURN n` |
| `n.meta = {key: val}` | WHERE nested map comparison | `MATCH (n) WHERE n.meta = {role: "admin"} RETURN n` |
| `n <> {key: val}` | WHERE map non-equality | `MATCH (n) WHERE n <> {name: "Alice"} RETURN n` |

```cypher
-- Static map in RETURN
MATCH (n:User) WHERE n.name = 'Alice' RETURN {name: "Alice", age: 30} AS m

-- Dynamic map with property access and functions
MATCH (n:User) WHERE n.name = 'Alice' RETURN {name: n.name, upper: toUpper(n.name)} AS profile

-- Map with list value from function call
MATCH (n:User) WHERE n.name = 'Alice' RETURN {name: n.name, tags: split(n.name, "")} AS m

-- Map with node reference
MATCH (n:User) WHERE n.name = 'Alice' RETURN {name: n.name, node: n} AS m

-- Nested maps
MATCH (n:User) WHERE n.name = 'Alice' RETURN {a: {b: {c: n.name}}} AS nested

-- Map comparison in WHERE (matches nodes with all specified properties)
MATCH (n:User) WHERE n = {name: "Alice"} RETURN n

-- Nested map comparison (deep equality with subset matching)
MATCH (n:User) WHERE n.meta = {role: "admin"} RETURN n

-- Map with multiple property filters
MATCH (n:User) WHERE n = {name: "Alice", age: 30} RETURN n

-- Map in SET clause
MATCH (n:User) SET n.meta = {key: "val", num: 42} RETURN n.meta

-- Map in SET with dynamic values
MATCH (n:User) SET n.profile = {displayName: toUpper(n.name)} RETURN n.profile

-- Map in WITH clause
MATCH (n:User) WITH {name: n.name, upper: toUpper(n.name)} AS p RETURN p

-- Map inside list literal
UNWIND [{name: "Alice"}, {name: "Bob"}] AS x RETURN x
```

> **Note:** Map comparison `n = {prop: val}` performs **subset matching** — the node must have all the map's keys with equal values. Extra properties on the node are ignored. Nested maps and lists are compared with deep equality. Empty map `n = {}` matches all objects.

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
| `>=` | `WHERE count >= 5` |
| `<` | `WHERE count < 5` |
| `<=` | `WHERE count <= 5` |
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

// IN operator with static list
MATCH (u:User) WHERE u.name IN ["Alice", "Bob"] RETURN u
MATCH (u:User) WHERE u.age IN [25, 30, 35] RETURN u
MATCH (u:User) WHERE NOT (u.name IN ["Alice", "Bob"]) RETURN u

// IN with dynamic list (property access)
MATCH (u:User) WHERE u.name IN [u.name] RETURN u
MATCH (u:User) WHERE u.role IN u.roles RETURN u

// IN with function call (e.g., split)
MATCH (u:User) WHERE u.name IN split("Alice,Bob,Charlie", ",") RETURN u

// IN with list of maps (subset matching)
MATCH (u:User) WHERE u IN [{name: "Alice"}, {name: "Bob"}] RETURN u

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

Create a single node:

```cypher
CREATE (l:Log {timestamp: 12345}) RETURN l
CREATE (t:Tag {values: ['a', 'b', 'c']}) RETURN t
```

Create a relationship chain (edge between two nodes):

```cypher
-- Create both nodes and the edge from scratch
CREATE (a:Person)-[r:KNOWS]->(b:Person) RETURN a, r, b

-- Create edge between existing nodes
MATCH (a:Person {name: 'Alice'}) MATCH (b:Person {name: 'Bob'}) CREATE (a)-[r:FRIEND]->(b) RETURN r

-- Create edge with incoming direction
MATCH (a:Person {name: 'Alice'}) MATCH (b:Person {name: 'Bob'}) CREATE (a)<-[r:KNOWS]-(b) RETURN r

-- Create with inline properties on both nodes
CREATE (a:Person {name: 'Alice'})-[r:KNOWS {since: 2020}]->(b:Person {name: 'Bob'}) RETURN a, b
```

When a variable is already bound (via a preceding MATCH), the existing node is reused. Unbound variables create new nodes.

### SET

```cypher
MATCH (u:User {name: 'Alice'}) SET u.age = 31 RETURN u
MATCH (u:User {name: 'Alice'}) SET u.tags = ['admin', 'verified'] RETURN u
```

### DELETE

```cypher
MATCH (f:User {name: 'Bob'}) DELETE f
```

### DETACH DELETE

Delete a node and all its incident relationships in one operation. Unlike plain `DELETE`, which requires relationships to be removed separately, `DETACH DELETE` automatically removes all edges connected to the target node.

```cypher
-- Delete a node and all its connections
MATCH (f:User {name: 'Bob'}) DETACH DELETE f

-- Delete a node, then query remaining nodes
MATCH (f:User {name: 'Bob'}) DETACH DELETE f MATCH (u:User) RETURN u.name
```

### REMOVE

Remove a label or property from a node. The node and its relationships remain in the graph.

```cypher
MATCH (u:User {name: 'Alice'}) REMOVE u:User RETURN u
MATCH (u:User {name: 'Alice'}) REMOVE u.age RETURN u
MATCH (u:User {name: 'Alice'}) REMOVE u.age, u:User RETURN u
```

Multiple items can be combined in a single REMOVE clause (property and/or label).

### FOREACH

Iterate over a list and execute a mutation (SET, CREATE, DELETE, DETACH DELETE, REMOVE) for each element. Unlike UNWIND, FOREACH **does not expand rows** — the input row count is preserved.

```cypher
-- Set a property on each element of a list
MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u.name

-- Create a node for each element with a dynamic property
MATCH (u:User) FOREACH (x IN u.tags | CREATE (t:Tag {name: x})) RETURN u.name

-- Add a label to each element
MATCH (u:User) FOREACH (x IN u.tags | SET x:Tagged) RETURN u.name

-- Delete nodes referenced in a list
MATCH (u:User) FOREACH (x IN u.todos | DELETE x) RETURN u.name

-- Detach delete nodes (also removes incident edges)
MATCH (u:User) FOREACH (x IN u.todos | DETACH DELETE x) RETURN u.name

-- Remove a property from each element
MATCH (u:User) FOREACH (x IN u.items | REMOVE x.temp) RETURN u.name

-- Multiple FOREACH stages
MATCH (u:User)
FOREACH (x IN u.tags | CREATE (t:Tag {name: x}))
FOREACH (x IN u.roles | CREATE (r:Role {name: x}))
RETURN u.name
```

FOREACH works with both node and relationship objects stored in lists. The loop variable must resolve to an object with an `id` field that matches a node or edge in the graph.

```cypher
-- Set property on relationships in a list
MATCH (a:A) FOREACH (r IN a.rels | SET r.active = true) RETURN a.name

-- Delete relationships in a list
MATCH (a:A) FOREACH (r IN a.rels | DELETE r) RETURN a.name
```

> **Note:** FOREACH with CREATE supports dynamic property expressions (e.g., `{name: x}` where `x` is the loop variable). Static properties are evaluated at parse time; dynamic expressions are evaluated at runtime.

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

### MERGE with parallel edges

In multi-graphs (`multi: true`), `MERGE` on a relationship matches the first existing edge of the given type between the two nodes. If at least one matching edge exists, MERGE binds that edge rather than creating a new one:

```cypher
-- If any :KNOWS edge already exists between a and b, it is matched
MERGE (a:User {name: "Alice"})-[:KNOWS]->(b:User {name: "Bob"})
RETURN a, b
```

To create additional parallel edges, use `CREATE` instead of `MERGE`.

### MERGE followed by MATCH

Use MERGE to ensure data exists, then query it:

```cypher
MERGE (u:User {name: "Alice"})
MATCH (u)-[:FRIEND]->(f)
RETURN u, f
```

### MERGE with WHERE

Filter which existing nodes count as a match. If no existing node satisfies the WHERE clause, the node is created:

```cypher
MERGE (u:User {name: "Alice"}) WHERE u.age > 18
ON MATCH SET u.verified = true
RETURN u
```

### MERGE with DELETE in ON MATCH

Delete matched nodes or relationships:

```cypher
MERGE (u:User {name: "Alice"}) ON MATCH DELETE u RETURN u
MERGE (a:User)-[r:FRIEND]->(b:User) ON MATCH DELETE r RETURN a, b
```

### MERGE with DETACH DELETE in ON MATCH

Delete a matched node and all its incident relationships:

```cypher
MERGE (u:User {name: "Alice"}) ON MATCH DETACH DELETE u RETURN u
```

### MERGE with REMOVE in ON MATCH

Remove labels or properties from matched nodes/relationships:

```cypher
MERGE (u:User {name: "Alice"}) ON MATCH REMOVE u:Admin RETURN u
MERGE (u:User {name: "Alice"}) ON MATCH REMOVE u.status RETURN u
```

### MERGE with combined SET / DELETE / DETACH DELETE / REMOVE

Combine SET, DELETE, DETACH DELETE, and REMOVE in ON CREATE / ON MATCH:

```cypher
MERGE (u:User {name: "Alice"})
ON MATCH SET u.status = "inactive" REMOVE u:Active
RETURN u
```

---

## UNION / UNION ALL

Combine results from multiple query branches. Each branch must be a complete query ending with a `RETURN` clause.

### UNION ALL

Concatenate results from all branches, preserving duplicates:

```cypher
MATCH (u:User {name: 'Alice'}) RETURN u.name
UNION ALL
MATCH (u:User {name: 'Bob'}) RETURN u.name
```

### UNION (deduplicated)

Concatenate and deduplicate results across all branches:

```cypher
MATCH (u:User {name: 'Alice'}) RETURN u.name
UNION
MATCH (u:User {name: 'Alice'}) RETURN u.name
```

### Multiple branches

Chain multiple `UNION` and `UNION ALL` clauses:

```cypher
MATCH (u:User) RETURN u.name
UNION ALL
MATCH (u:User) RETURN u.name
UNION
MATCH (u:User) RETURN u.name
```

### Column alignment

Columns are aligned by name across branches. If a branch is missing a column, the value is `null`. Column order follows first appearance:

```cypher
MATCH (u:User {name: 'Alice'}) RETURN u.name AS n, 'A' AS grp
UNION ALL
MATCH (u:User {name: 'Bob'}) RETURN u.name AS n
```
Result: `[{n: 'Alice', grp: 'A'}, {n: 'Bob', grp: null}]`

### ORDER BY / SKIP / LIMIT on combined result

Place `ORDER BY`, `SKIP`, and `LIMIT` after the last branch's `RETURN` to sort and paginate the combined result:

```cypher
MATCH (u:User) RETURN u.name
UNION ALL
MATCH (u:Admin) RETURN u.name
ORDER BY name DESC
SKIP 1
LIMIT 5
```

> **Note:** Each UNION branch must end with a `RETURN` clause. `WITH` is supported within branches but the final clause must be `RETURN`.

---

## Unsupported Features

The following Cypher features are **not** supported by the engine:

- **Subqueries** — `CALL {}` syntax
- **APOC procedures** — `CALL apoc.*`
- **Multiple MATCH in same stage** — use `WITH` to chain stages
- **UNION without RETURN** — each branch must end with a `RETURN` clause


## Next Steps

- **[Library API]({{ '/library-api/' | relative_url }})** — Use gcyphrq programmatically in your code
- **[Examples]({{ '/examples/' | relative_url }})** — 30 ready-to-run queries with sample output
