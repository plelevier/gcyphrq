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

See the [Home page]({{ '/' | relative_url }}) for the full feature support table.

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

### Path expressions

Find the shortest path(s) between two nodes using `shortestPath()` and `allShortestPaths()`:

```cypher
-- Find the single shortest path from Alice to Bob
MATCH (a:User {name: 'Alice'}) MATCH (b:User {name: 'Bob'})
RETURN shortestPath((a)-[*]->(b)) AS path

-- Find ALL shortest paths (same minimum length)
MATCH (a:User {name: 'Alice'}) MATCH (b:User {name: 'Bob'})
RETURN allShortestPaths((a)-[*]->(b)) AS paths
```

The returned path object has the structure:

```json
{
  "nodes": [{ "id": "...", "name": "Alice" }, { "id": "...", "name": "Bob" }],
  "relationships": [{ "id": "...", "source": "...", "target": "...", "type": "FRIEND" }]
}
```

**Filtering by relationship type:**

```cypher
-- Only traverse FRIEND relationships
MATCH (a:User {name: 'Alice'}) MATCH (b:User {name: 'Bob'})
RETURN shortestPath((a)-[:FRIEND*]->(b)) AS path
```

**Direction control:**

```cypher
-- Outbound only (default)
RETURN shortestPath((a)-[*]->(b)) AS path

-- Inbound only (traverse edges in reverse)
RETURN shortestPath((a)<-[*]-(b)) AS path

-- Undirected (either direction)
RETURN shortestPath((a)-[*]-(b)) AS path
```

**Variable-length bounds:**

```cypher
-- Minimum 1 hop, maximum 3 hops
RETURN shortestPath((a)-[*1..3]->(b)) AS path
```

**In WHERE clauses:**

```cypher
-- Find all node pairs connected by a path
MATCH (a:User) MATCH (b:User)
WHERE shortestPath((a)-[*]->(b)) IS NOT NULL
RETURN a.name, b.name
```

**Notes:**
- Both functions resolve node IDs from bound variables in the query context
- `shortestPath()` returns a single path object, or `null` if no path exists
- `allShortestPaths()` returns an array of path objects, or `[]` if no path exists
- When source and target are the same node, returns a single-node path with no edges
- Uses unweighted BFS (all edges have equal weight)

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

## Chained MATCHes

Multiple `MATCH` clauses can appear in the same query. Each `MATCH` is executed sequentially, producing a **cartesian product** of the previous stage's results with its own matches. This is equivalent to a `WITH`-separated pipeline but more concise.

### Basic cartesian product

```cypher
MATCH (a) MATCH (b) RETURN a, b
```

Returns every combination of nodes `a` and `b` (N × M rows for N nodes and M nodes).

### Cross-variable filtering

Use `WHERE` on the second (or later) `MATCH` to filter across variables bound by earlier stages:

```cypher
MATCH (a:User) MATCH (b:User) WHERE a.name < b.name RETURN a.name, b.name
```

### Chained MATCH with relationships

```cypher
MATCH (a:Person {name: 'Alice'}) MATCH (a)-[r:FRIEND]->(b) RETURN a, r, b
```

When a variable from a prior `MATCH` is reused as the source of the next `MATCH`, the engine uses the already-bound node as the starting point.

### Three or more MATCHes

```cypher
MATCH (a:User) MATCH (b:User) MATCH (c:User) WHERE a.name < b.name AND b.name < c.name
RETURN a.name, b.name, c.name
```

### Mixed OPTIONAL MATCH

`OPTIONAL MATCH` works alongside regular `MATCH`es in the same query:

```cypher
MATCH (a:User) OPTIONAL MATCH (a)-[r:FRIEND]->(b) MATCH (c:Admin) RETURN a, b, c
```

### Chained MATCH before WITH

```cypher
MATCH (a:User) MATCH (b:User) WHERE a.dept = b.dept
WITH a, count(b) AS colleagues
RETURN a.name, colleagues
```

### When to use WITH instead

Use `WITH` when you need to:
- Reduce the number of rows before the next `MATCH` (to avoid cartesian explosion)
- Apply aggregation between `MATCH` stages
- Rename or transform variables between stages

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

### UNWIND with WHERE

Filter unwound elements with a `WHERE` clause immediately after `UNWIND`:

```cypher
-- Filter numeric values
UNWIND [1, 2, 3, 4, 5] AS x WHERE x > 3 RETURN x

-- Filter strings with comparison operators
UNWIND ["hello", "world", "help", "test"] AS s WHERE s STARTS WITH "hel" RETURN s

-- Filter with IS NULL / IS NOT NULL
UNWIND [10, null, 5, null, 20] AS x WHERE x IS NOT NULL RETURN x ORDER BY x
```

Combine UNWIND WHERE with `WITH` for further filtering:

```cypher
UNWIND [1, 2, 3, 4, 5] AS x WHERE x > 1
WITH x WHERE x < 5
RETURN x ORDER BY x
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
| `count(*)` | Count all rows (including nulls) |
| `count(DISTINCT x)` | Count unique non-null values |
| `sum(x.prop)` | Sum numeric values |
| `sum(DISTINCT x.prop)` | Sum unique numeric values |
| `avg(x.prop)` | Average (null if no values) |
| `avg(DISTINCT x.prop)` | Average of unique values |
| `min(x.prop)` | Minimum (null if no values) |
| `max(x.prop)` | Maximum (null if no values) |
| `collect(x)` | Gather all values into a list (includes nulls) |
| `collect(DISTINCT x)` | Gather unique values into a list |

```cypher
MATCH (u:User) RETURN count(DISTINCT u.dept) AS uniqueDepts
MATCH (u:User) RETURN sum(DISTINCT u.score) AS totalScore
MATCH (u:User) RETURN avg(DISTINCT u.score) AS avgScore
MATCH (u:User) RETURN count(*) AS totalUsers
MATCH (u:User) RETURN collect(u.name) AS names
MATCH (u:User) RETURN collect(DISTINCT u.dept) AS uniqueDepts
```

### Reduce

Fold a list into a single value using an accumulator. `reduce(initial, var IN list | body)` iterates over each element in the list, updating the accumulator with the body expression.

```cypher
-- Sum a list
MATCH (u:User) RETURN reduce(total = 0, x IN [1, 2, 3, 4] | total + x) AS sum

-- Multiply a list
MATCH (u:User) RETURN reduce(total = 1, x IN [2, 3, 4] | total * x) AS product

-- Concatenate strings
MATCH (u:User) RETURN reduce(s = "", x IN ["a", "b", "c"] | s + x) AS result

-- Sum a property that is a list
MATCH (p:Person) RETURN reduce(total = 0, x IN p.ages | total + x) AS totalAge

-- Reduce over collect (aggregation context)
MATCH (u:User) RETURN reduce(total = 0, x IN collect(u.age) | total + x) AS totalAge

-- Concatenate all names
MATCH (u:User) RETURN reduce(s = "", x IN collect(u.name) | s + x + ", ") AS allNames
```

> **Note:** `reduce` is not itself an aggregation — it evaluates per-row. It triggers aggregation mode only when its sub-expressions contain aggregations (e.g., `reduce(..., x IN collect(y) | ...)`). The `+` operator supports string concatenation when both operands are strings.

---

### List Comprehensions

Transform and filter list elements with `[var IN list [WHERE predicate] | generator]`. The comprehension iterates over each element, optionally filters with a `WHERE` clause, applies the generator expression, and returns a new list.

```cypher
-- Double each element
RETURN [x IN [1, 2, 3] | x * 2] AS doubled
-- Result: [2, 4, 6]

-- Filter even numbers
RETURN [x IN [1, 2, 3, 4, 5] WHERE x % 2 = 0 | x] AS evens
-- Result: [2, 4]

-- Transform property list
MATCH (n) WHERE n.name = "Alice" RETURN [x IN n.tags | toUpper(x)] AS upperTags

-- Filter and transform combined
RETURN [x IN [1, 2, 3, 4, 5] WHERE x > 2 | x * 10] AS result
-- Result: [30, 40, 50]

-- Use in WHERE clause
MATCH (n) WHERE size([x IN n.scores WHERE x >= 80 | x]) >= 3 RETURN n.name

-- Combine with reduce
RETURN reduce(total = 0, x IN [y IN [1, 2, 3, 4, 5] WHERE y > 2 | y * 2] | total + x) AS sum
-- Result: 24 (comprehension produces [6, 8, 10], reduce sums to 24)

-- Use with quantifiers
MATCH (n) WHERE ANY(x IN [s IN n.scores | s * 2] WHERE x > 150) RETURN n.name
```

> **Note:** List comprehensions work in `RETURN`, `WHERE`, `WITH`, and `SET` clauses. They can be nested inside functions (e.g., `size([x IN list | ...])`), `reduce()`, and quantifier expressions. The `WHERE` clause inside a comprehension supports all standard WHERE operators (`=`, `>`, `CONTAINS`, `AND`, `OR`, `NOT`, etc.).

#### Strings as character lists

Strings are treated as lists of characters for all list operations. This enables character-level processing:

```cypher
-- head/last/tail/reverse on strings
RETURN head('hello') AS first       -- 'h'
RETURN last('hello') AS last         -- 'o'
RETURN tail('hello') AS rest         -- 'ello'
RETURN reverse('hello') AS rev       -- 'olleh'

-- string slicing (returns string)
RETURN 'hello'[1..3] AS sliced       -- 'el'
RETURN 'hello'[-1] AS lastChar       -- 'o'

-- list comprehension over string
RETURN [c IN 'hello' | toUpper(c)]   -- ['H','E','L','L','O']

-- quantifiers over string
MATCH (n) WHERE ALL(c IN 'abc' WHERE c IN ['a','b','c']) RETURN n.name

-- reduce over string
RETURN reduce(acc = '', c IN 'hello' | acc + c) -- 'hello'

-- UNWIND string into characters
UNWIND 'abc' AS ch RETURN ch          -- 3 rows: a, b, c

-- IN operator with string
MATCH (n) WHERE 'a' IN 'abc' RETURN n.name
```

---

### Pattern Comprehensions

Traverse the graph from a bound anchor node and collect results into a list using `[(pattern) [WHERE predicate] | generator]`. The pattern comprehension starts from an already-bound variable, walks relationships to find matching target nodes, optionally filters with a `WHERE` clause, applies the generator expression, and returns a new list.

```cypher
-- Collect names of connected nodes
MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) | b.name] AS friends
-- Result: [{ friends: ["Bob", "Charlie"] }]

-- With typed relationship
MATCH (a:Person {name: "Alice"}) RETURN [(a)-[:KNOWS]->(b:Person) | b.name] AS friends

-- Incoming edges
MATCH (a:Person {name: "Charlie"}) RETURN [(a)<--(b:Person) | b.name] AS incoming

-- Undirected edges
MATCH (a:Person {name: "Charlie"}) RETURN [(a)--(b:Person) | b.name] AS connections

-- With WHERE filter
MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) WHERE b.age > 30 | b.name] AS olderFriends

-- With relationship variable
MATCH (a:Person {name: "Alice"}) RETURN [(a)-[r:KNOWS]->(b:Person) | r] AS rels

-- Computed generator expression
MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) | toUpper(b.name)] AS upperNames

-- Map literal generator
MATCH (a:Person {name: "Alice"}) RETURN [(a)-->(b:Person) | {name: b.name, age: b.age}] AS friendInfo

-- With variable-length patterns
MATCH (a:Person {name: "Alice"}) RETURN [(a)-[*1..2]->(b:Person) | b.name] AS reachable
```

Pattern comprehensions work in `RETURN`, `WHERE`, and `WITH` clauses. They can be nested inside functions like `size()`, `head()`, `tail()`, and inside list comprehensions:

```cypher
-- Count connections
MATCH (a:Person) RETURN a.name, size([(a)-->(b:Person) | b.name]) AS friendCount

-- First connection only
MATCH (a:Person {name: "Alice"}) RETURN head([(a)-->(b:Person) | b.name]) AS firstFriend

-- Nested in list comprehension
MATCH (a:Person {name: "Alice"}) RETURN [x IN [(a)-->(b:Person) | b.name] | toUpper(x)] AS upperFriends

-- In WHERE clause
MATCH (a:Person) WHERE size([(a)-->(b:Person) | b.name]) > 1 RETURN a.name
```

> **Note:** The anchor node (source pattern variable) must be bound in the query context (e.g., via a preceding `MATCH`). The relationship variable `r` binds to an array of edges along the path. For single-hop patterns, access via `r[0].property`. Directional edges (`->`, `<-`, `-`) control traversal direction.

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
| `head(x)` | First element of a list (or first character of a string) |
| `last(x)` | Last element of a list (or last character of a string) |
| `tail(x)` | All elements except the first (or string without first character) |
| `reverse(x)` | Reverse elements of a list (or reverse a string) |
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
| `toInt(x)` | Convert value to integer (alias for `toInteger`) |
| `toFloat(x)` | Convert value to float |
| `toBoolean(x)` | Convert value to boolean |
| `keys(x)` | Property names of a map as list |

```cypher
MATCH (u:User) RETURN toLower(u.name) AS lowerName
MATCH (u:User) WHERE toUpper(u.email) CONTAINS "@EXAMPLE.COM" RETURN u
MATCH (u:User) RETURN substring(u.name, 0, 3) AS initials
MATCH (u:User) RETURN split(u.email, '@')[0] AS username
MATCH (u:User) RETURN length(u.name) AS nameLen
MATCH (u:User) RETURN coalesce(u.nick, u.name, 'Unknown') AS displayName
MATCH (u:User) RETURN toInteger(u.age) AS age
MATCH (u:User) RETURN toInt(u.age) AS age
MATCH (u:User) RETURN toBoolean(u.active) AS isActive
RETURN toBoolean(1) AS oneIsTrue
RETURN toBoolean(0) AS zeroIsFalse
RETURN toBoolean('') AS emptyStringIsFalse
RETURN toBoolean('yes') AS nonEmptyStringIsTrue
RETURN keys({name: 'Alice', age: 30}) AS propertyNames
```

> **Note:** `repl` is used instead of `replace`, and `reltype` instead of `type` because these are reserved keywords in the ANTLR4 Cypher grammar. `toInt` is an alias for `toInteger`. `toBoolean` converts numbers (0 → false, non-zero → true), strings (empty → false, non-empty → true), and other truthy values. `keys` returns property names of map literals as a list. `labels` is standard Cypher and works as the sole item in RETURN (e.g., `RETURN labels(n)`); use `labelsOf` in WHERE/WITH/ORDER BY or when combined with other RETURN items (ANTLR4 keyword limitation). `startnode()` and `endnode()` return string IDs, not node objects. `nodes(path)` and `relationships(path)` extract from path variables bound with `MATCH path = ...`. `labels()`, `nodes()`, and `relationships()` do not support `AS` aliases (ANTLR4 grammar limitation — use the auto-generated column name like `labels(n)` or `nodes(path)`).

---

### Temporal functions

Construct and extract components from datetime, date, time, and duration values.

#### Constructors

| Function | Description |
|---|---|
| `timestamp()` | Current Unix timestamp in seconds (number) |
| `datetime()` | Current datetime as ISO 8601 string (`YYYY-MM-DDTHH:mm:ss.mmmZ`) |
| `datetime(components)` | Construct from year, month, day, hour, minute, second, millisecond |
| `datetime(map)` | Construct from map: `{year, month, day, hour, minute, second, millisecond}` |
| `datetime(string)` | Construct from ISO 8601 string |
| `datetime(number)` | Construct from epoch seconds or milliseconds |
| `date()` | Current date as ISO 8601 string (`YYYY-MM-DD`) |
| `date(components)` | Construct from year, month, day |
| `date(string)` | Construct from date or datetime string |
| `time()` | Current time as ISO 8601 string (`HH:mm:ss` or `HH:mm:ss.mmm`) |
| `time(hour, minute, second, millisecond)` | Construct from time components |
| `time(string)` | Construct from time string |
| `localdatetime()` | Current local datetime (no timezone suffix) |
| `localdatetime(components)` | Construct local datetime from components |
| `localtime()` | Current local time (no timezone suffix) |
| `localtime(hour, minute, second, millisecond)` | Construct local time from components |
| `datetimewithtimezone()` | Current datetime with timezone |
| `datetimewithtimezone(string)` | Construct from string, preserving timezone offset |
| `datetimewithtimezone(map)` | Construct from map with optional `timezone` field |
| `timewithzone()` | Current time with timezone |
| `timewithzone(hour, minute, second)` | Construct time with timezone from components |
| `timewithzone(string)` | Construct from string, preserving timezone offset |
| `duration(map)` | Construct duration from map: `{years, months, days, hours, minutes, seconds, milliseconds}` |
| `duration(string)` | Construct from ISO 8601 duration string (e.g., `P1Y2M3DT4H5M6S`) |

```cypher
-- Current values
RETURN timestamp() AS ts, datetime() AS dt, date() AS d, time() AS t

-- From components
RETURN datetime(2023, 6, 15, 14, 30, 45, 123) AS dt
RETURN date(2023, 6, 15) AS d
RETURN time(14, 30, 45) AS t

-- From map
RETURN datetime({year: 2023, month: 6, day: 15, hour: 14, minute: 30}) AS dt
RETURN time({hour: 14, minute: 30, second: 45, millisecond: 123}) AS t

-- From string
RETURN datetime('2023-06-15T14:30:45.123Z') AS dt
RETURN date('2023-06-15') AS d
RETURN time('14:30:45') AS t

-- From epoch
RETURN datetime(1672531200) AS dt

-- Local datetime/time (no timezone)
RETURN localdatetime(2023, 6, 15, 14, 30, 45) AS local
RETURN localtime(14, 30, 45) AS local

-- Duration
RETURN duration({years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6}) AS dur
RETURN duration('P1Y2M3DT4H5M6S') AS dur

-- With timezone
RETURN datetimewithtimezone('2023-06-15T14:30:45+02:00') AS dt
RETURN timewithzone('14:30:45-05:00') AS t
```

#### Extractors

| Function | Description |
|---|---|
| `year(x)` | Year from temporal value |
| `month(x)` | Month (1–12) |
| `day(x)` | Day of month (1–31) |
| `hour(x)` | Hour (0–23) |
| `minute(x)` | Minute (0–59) |
| `second(x)` | Second (0–59) |
| `millisecond(x)` | Millisecond (0–999) |
| `timezone(x)` | Timezone offset string (`Z`, `+HH:MM`, `-HH:MM`, or `null`) |
| `epochseconds(x)` | Unix epoch seconds |
| `epochmillisecond(x)` | Unix epoch milliseconds |
| `totalSeconds(x)` | Total seconds from duration |
| `totalMinutes(x)` | Total minutes from duration |

```cypher
-- Extract from datetime string
RETURN year('2023-06-15T14:30:45.000Z') AS y
RETURN month('2023-06-15T14:30:45.000Z') AS m
RETURN hour('14:30:45') AS h

-- Extract from node property
MATCH (n) WHERE n.createdAt IS NOT NULL
RETURN year(n.createdAt) AS year, month(n.createdAt) AS month, hour(n.createdAt) AS hour

-- Extract timezone
RETURN timezone('2023-06-15T14:30:45+02:00') AS tz
RETURN timezone('2023-06-15T14:30:45.000Z') AS tz

-- Extract epoch
RETURN epochseconds('2023-01-01T00:00:00.000Z') AS epoch
RETURN epochmillisecond('2023-01-01') AS epoch

-- Extract from duration
RETURN totalSeconds(duration({hours: 1, minutes: 30})) AS totalSec
RETURN totalMinutes(duration('P1H30M45S')) AS totalMin
```

#### Temporal comparison

Datetime and date strings are compared chronologically (not lexicographically) in `WHERE` and `ORDER BY` clauses. Timezone offsets are properly accounted for:

```cypher
-- Filter by datetime range
MATCH (n) WHERE n.createdAt > '2023-01-01T00:00:00.000Z' RETURN n

-- Compare with timezone offsets (chronologically correct)
MATCH (n) WHERE n.createdAt <= '2023-06-15T14:30:45+02:00' RETURN n

-- Order chronologically
MATCH (n) RETURN n.name ORDER BY n.createdAt DESC
```

> **Note:** Temporal functions work in `RETURN`, `WHERE`, `WITH`, `ORDER BY`, and `SET` clauses. Invalid inputs return `null`. Date overflow is handled by JavaScript `Date` normalization (e.g., month 13 → next year, month 1).

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
> **String concatenation:** The `+` operator concatenates strings when both operands are strings.

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

### NULLS FIRST / NULLS LAST

Control the position of null values in the sorted output. Default behavior: `NULLS LAST` for `ASC`, `NULLS FIRST` for `DESC`.

```cypher
-- Nulls first in ascending order
MATCH (n:Item) RETURN n.name, n.score ORDER BY n.score NULLS FIRST

-- Nulls last in ascending order (explicit)
MATCH (n:Item) RETURN n.name, n.score ORDER BY n.score ASC NULLS LAST

-- Nulls last in descending order (explicit)
MATCH (n:Item) RETURN n.name, n.score ORDER BY n.score DESC NULLS LAST

-- Nulls first in descending order
MATCH (n:Item) RETURN n.name, n.score ORDER BY n.score DESC NULLS FIRST

-- Multiple sort keys with different nulls directions
MATCH (n:Item) RETURN n.name, n.score, n.rating ORDER BY n.score ASC NULLS LAST, n.rating DESC NULLS FIRST
```

`NULLS FIRST`/`NULLS LAST` work in both `RETURN` and `WITH` ORDER BY clauses.

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

Set properties and/or labels on nodes. Supports multiple operations in a single SET clause using commas.

```cypher
-- Set a property
MATCH (u:User {name: 'Alice'}) SET u.age = 31 RETURN u

-- Set a label
MATCH (u:User {name: 'Alice'}) SET u:Admin RETURN u

-- Set multiple labels
MATCH (u:User {name: 'Alice'}) SET u:Admin:Verified RETURN u

-- Set label + property in one SET
MATCH (u:User {name: 'Alice'}) SET u:Admin, u.age = 31 RETURN u

-- Set multiple properties
MATCH (u:User {name: 'Alice'}) SET u.age = 31, u.active = true RETURN u

-- Set on different variables (via chained MATCH)
MATCH (a:User {name: 'Alice'}) MATCH (b:User {name: 'Bob'}) SET a:First, b:Second, a.active = true RETURN a.name, b.name
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

The SET clause inside FOREACH supports multiple operations: labels, properties, or both.

```cypher
-- Set a property on each element of a list
MATCH (u:User) FOREACH (x IN u.tags | SET x.processed = true) RETURN u.name

-- Set label + property in one FOREACH
MATCH (u:User) FOREACH (x IN u.items | SET x:Processed, x.reviewed = true) RETURN u.name

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

## CALL { ... } Subqueries

Execute a subquery as part of a larger query. The inner query runs for each outer row and expands results based on its output.

### Basic CALL

```cypher
CALL { MATCH (n:Person) RETURN n.name AS name }
```

When there is no outer `RETURN`, the CALL results are returned directly.

### CALL with outer scope variables (inline)

The inner query can reference variables bound by preceding `MATCH` or `WITH` clauses:

```cypher
MATCH (a:Person {name: 'Alice'})
CALL { MATCH (a)-[:FRIEND]->(b) RETURN b.name AS friend }
RETURN a.name AS person, friend
```

### CALL with YIELD

Restrict which inner variables are exposed to the outer scope:

```cypher
CALL { MATCH (n:Person) RETURN n.name AS name, n.age AS age } YIELD name
RETURN name
```

Only `name` is available after the CALL; `age` is discarded.

### CALL with YIELD + WHERE

Combine YIELD with WHERE to filter results after the subquery:

```cypher
CALL { MATCH (n:Person) RETURN n.name AS name, n.age AS age }
YIELD name
WHERE name <> "Bob"
RETURN name
```

The WHERE clause applies after YIELD filtering and before any outer RETURN.

### CALL followed by other clauses

CALL can be followed by `RETURN`, `MATCH`, `WITH`, `WHERE`, or other clauses:

```cypher
-- CALL followed by RETURN
CALL { MATCH (n:Person) RETURN n.name AS name }
RETURN name

-- CALL followed by WHERE
CALL { MATCH (n:Person) RETURN n.age AS age }
WHERE age > 28
RETURN age

-- CALL followed by MATCH (cartesian product)
CALL { MATCH (n:Person) RETURN n.name AS name }
MATCH (m:Movie)
RETURN name, m.title AS title
```

### Nested CALL

CALL subqueries can be nested:

```cypher
CALL { CALL { MATCH (n:Person) RETURN n.name AS name } RETURN name }
```

### CALL with CREATE (mutations inside subquery)

Create nodes inside the subquery:

```cypher
CALL { CREATE (t:Tag {name: 'new'}) RETURN t.name AS name }
```

### CALL with ORDER BY

Order results inside the subquery:

```cypher
CALL { MATCH (n:Person) RETURN n.name AS name ORDER BY n.name }
```

### CALL with aggregation

Use aggregations inside the subquery:

```cypher
CALL { MATCH (n:Person) RETURN count(n) AS total }
```

### CALL with row expansion

When the inner query produces multiple rows per outer row, results expand:

```cypher
MATCH (a:Person)
CALL { MATCH (a)-[:FRIEND]->(b) RETURN b.name AS friend }
RETURN a.name AS person, friend
```

If an outer row produces zero inner rows, it is dropped (matching Neo4j semantics).

---

## LOAD CSV

Load data from CSV files and use it in queries. Supports local file paths and HTTP/HTTPS URLs.

### Basic syntax

```cypher
LOAD CSV FROM 'path/to/file.csv' AS row RETURN row
```

Each row is an array of strings: `["value1", "value2", ...]`.

### WITH HEADERS

When the CSV has a header row, use `WITH HEADERS` to access columns by name:

```cypher
LOAD CSV WITH HEADERS FROM 'people.csv' AS row
RETURN row.name AS name, row.age AS age
```

Each row is a map: `{ name: "Alice", age: "30", ... }`.

### Combining with MATCH

Load CSV data and match against graph nodes:

```cypher
LOAD CSV WITH HEADERS FROM 'users.csv' AS row
MATCH (u:User {name: row.name})
RETURN row.name AS csvName, u
```

### Filtering CSV rows

Use `WHERE` to filter rows:

```cypher
LOAD CSV WITH HEADERS FROM 'data.csv' AS row
WITH row WHERE row.status = 'active'
RETURN row.name, row.status
```

### Creating nodes from CSV

Import CSV data into the graph:

```cypher
LOAD CSV WITH HEADERS FROM 'people.csv' AS row
CREATE (p:Person {name: row.name, age: toInteger(row.age)})
RETURN p.name AS name, p.age AS age
```

### Aggregating CSV data

```cypher
LOAD CSV WITH HEADERS FROM 'data.csv' AS row
RETURN count(*) AS total, collect(row.name) AS names
```

Aggregations accept function arguments for type conversion and transformation:

```cypher
LOAD CSV WITH HEADERS FROM 'data.csv' AS row
RETURN sum(toInteger(row.amount)) AS total,
       avg(toFloat(row.score)) AS avgScore,
       collect(toLower(row.name)) AS names
```

### Supported sources

- **Local file paths**: `LOAD CSV FROM 'data/file.csv' AS row` (resolved relative to CWD)
- **HTTP/HTTPS URLs**: `LOAD CSV FROM 'https://example.com/data.csv' AS row`

### Custom delimiters

Use `FIELDS TERMINATED BY` to specify a custom field separator:

```cypher
LOAD CSV FROM 'data.tsv' AS row FIELDS TERMINATED BY '\t'
RETURN row
```

### Custom quote character

Use `OPTIONALLY ENCLOSED BY` to specify a custom quote character:

```cypher
LOAD CSV FROM 'data.csv' AS row OPTIONALLY ENCLOSED BY "'"
RETURN row
```

Both options can be combined:

```cypher
LOAD CSV FROM 'data.csv' AS row
FIELDS TERMINATED BY '|'
OPTIONALLY ENCLOSED BY "'"
RETURN row
```

### LOAD CSV inside CALL subqueries

LOAD CSV can be used inside `CALL { ... }` subqueries:

```cypher
CALL {
  LOAD CSV WITH HEADERS FROM 'data.csv' AS row
  RETURN row.name AS name
}
RETURN name
```

### Notes

- All CSV values are strings. Use `toInteger()`, `toFloat()`, etc. to convert.
- Quoted fields are supported (commas, escaped quotes, newlines within quotes).
- UTF-8 BOM is automatically stripped.
- Multiple LOAD CSV clauses are supported (each produces a cartesian product with existing contexts).

---

## EXPLAIN

Use `EXPLAIN` to inspect the query execution plan without running the query. This is useful for debugging and understanding how a query will be processed.

### CLI

Use the `--explain` flag (no graph file needed):

```bash
gcyphrq --explain -e 'MATCH (u:User)-[r:FRIEND]->(f:User) RETURN u, f'
```

Output is JSON with query stages, variable bindings, and details:

```json
{
  "query": "MATCH (u:User)-[r:FRIEND]->(f:User) RETURN u, f",
  "stages": [
    {
      "index": 0,
      "type": "MATCH",
      "description": "MATCH (u:User)-->[r:FRIEND]-->(f:User)",
      "variables": ["u", "f", "r"],
      "details": { "pattern": "(u:User)-->[r:FRIEND]-->(f:User)", "optional": false }
    },
    {
      "index": 1,
      "type": "RETURN",
      "description": "RETURN u, f",
      "variables": ["u", "f"],
      "details": { "projections": [...] }
    }
  ],
  "finalVariables": ["u", "f"]
}
```

### Library API

```ts
import { explainQuery } from 'gcyphrq';

const plan = explainQuery('MATCH (u:User) RETURN u');
console.log(JSON.stringify(plan, null, 2));
```

### What EXPLAIN shows

- **Stages** — each query stage (MATCH, WITH, RETURN, FOREACH, etc.) in execution order
- **Variables** — which variables are bound by each stage
- **Details** — stage-specific information (patterns, projections, aggregations, ORDER BY, LIMIT, etc.)
- **Final variables** — variables available in the final result

---

## Graph Functions

Graph functions provide whole-graph analytics without requiring `MATCH` clauses. They operate on the entire graph and return aggregate statistics or per-node centrality scores.

### Graph Statistics

| Function | Description | Return |
|---|---|---|
| `numNodes()` | Total number of nodes | `number` |
| `numRelationships()` | Total number of edges | `number` |
| `density()` | Edge density ratio (0..1) | `number` |
| `averageDegree()` | Mean node degree | `number` |
| `diameter()` | Longest shortest path between any two nodes | `number` (returns -1 if disconnected) |

```cypher
-- Basic graph statistics
RETURN numNodes() AS nodes, numRelationships() AS edges, density() AS d

-- Combine with average degree and diameter
RETURN numNodes() AS n, averageDegree() AS avgDeg, diameter() AS diam

-- Use in WHERE clause
MATCH (n) WHERE numNodes() > 10 RETURN n.name
```

**Density calculation:**
- Directed graphs: `E / (V * (V-1))`
- Undirected graphs: `2E / (V * (V-1))`
- Mixed graphs: treated as directed
- Returns 0 for graphs with 0 or 1 nodes

**Diameter:** All edges are treated as bidirectional (standard graph analytics approach). Returns -1 for disconnected graphs where not all nodes are reachable from each other.

**Average degree:** Counts both inbound and outbound edges for directed graphs. Self-loops add 2 to the degree (standard graph theory convention).

### Centrality Functions

Centrality functions measure the importance of nodes in the graph. All three support two calling forms:

- **Global (no arguments):** Returns a `{ nodeId: score }` map for all nodes
- **Per-node (with node argument):** Returns the score for a specific node

| Function | Description | Algorithm |
|---|---|---|
| `pagerank()` | PageRank centrality | Power iteration (damping=0.85) |
| `degreeCentrality()` | Normalized degree centrality | Unique neighbors / (V-1) |
| `betweennessCentrality()` | Betweenness centrality | Brandes' algorithm |

```cypher
-- Global PageRank scores (returns map)
RETURN pagerank() AS scores

-- Per-node PageRank (returns single score)
MATCH (n) RETURN n.name, pagerank(n) AS pr ORDER BY pr DESC

-- Top-5 nodes by degree centrality
MATCH (n) RETURN n.name, degreeCentrality(n) AS dc ORDER BY dc DESC LIMIT 5

-- Betweenness centrality for all nodes
RETURN betweennessCentrality() AS scores

-- Combine multiple centrality measures
MATCH (n) RETURN n.name,
  pagerank(n) AS pr,
  degreeCentrality(n) AS dc,
  betweennessCentrality(n) AS bc
ORDER BY pr DESC
```

**PageRank:** Uses power iteration with damping factor 0.85, tolerance 1e-6, and up to 100 iterations. For directed graphs, follows outbound edges. For undirected/mixed graphs, treats undirected edges as bidirectional. Sink nodes (no outbound edges) accumulate higher scores.

**Degree centrality:** Counts unique neighbors (combining inbound and outbound for directed graphs). Normalized by dividing by (V-1), so scores range from 0 to 1.

**Betweenness centrality:** Measures how often a node appears on shortest paths between other nodes. All edges are treated as bidirectional. Normalized by dividing by 2 (each pair counted twice in undirected treatment). Returns 0 for graphs with 2 or fewer nodes.

### Edge Cases

- **Empty graph:** Statistics return 0; centrality functions return `{}` (global) or `null` (per-node)
- **Single node:** All statistics return 0 or appropriate defaults; centrality returns 0
- **Disconnected graph:** `diameter()` returns -1; centrality functions still compute scores within each component
- **Null argument:** `pagerank(null)`, `degreeCentrality(null)`, `betweennessCentrality(null)` all return `null`

---

## Unsupported Features

The following Cypher features are **not** supported by the engine:

- **Stored procedures** — `CALL db.xxx()` (use `CALL { ... }` subqueries instead)
- **APOC procedures** — `CALL apoc.*`
- **UNION without RETURN** — each branch must end with a `RETURN` clause


## Next Steps

- **[Library API]({{ '/library-api/' | relative_url }})** — Use gcyphrq programmatically in your code
- **[Examples]({{ '/examples/' | relative_url }})** — 30 ready-to-run queries with sample output
