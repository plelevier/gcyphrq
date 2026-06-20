---
name: gcyphrq
description: "Use for querying graph data with Cypher — service dependencies, infrastructure topology, blast radius analysis, path tracing. Runs against JSON graph files with an in-memory Cypher engine supporting MATCH, OPTIONAL MATCH, WITH, aggregations, ORDER BY, SKIP, LIMIT, variable-length paths, and mutations."
---

# gcyphrq

Execute Cypher queries against in-memory graphs built from JSON files. The CLI tool is `gcyphrq`. Both `-e` (query) and `-g` (graph file or `-` for stdin) are required.

## Usage

```
gcyphrq [options]

Options:
  -e, --expr <query>   Cypher query expression (required)
  -g, --graph <file>   Path to a JSON graph file (required, or "-" for stdin)
  -h, --help           Show this help message
```

### Run a query

```bash
gcyphrq -g <graph.json> -e 'MATCH (n) RETURN n'
```

### Pipe from stdin

```bash
cat <graph.json> | gcyphrq -g - -e 'MATCH (n) RETURN n'
```

### Pipe output to jq

```bash
gcyphrq -g <graph.json> -e 'MATCH (n) RETURN n.name' | jq '.[].n'
```

## Graph File Format

```json
{
  "nodes": [
    { "id": "alice", "label": "User", "name": "Alice", ... }
  ],
  "edges": [
    { "source": "alice", "target": "bob", "type": "FRIEND", ... }
  ]
}
```

- **Node `id`** — unique identifier, used as the Graphology node key
- **Node `label`** — used for label filtering in Cypher (`:User`, `:Service`)
- **All other properties** — available for property filtering (`{name: "Alice"}`)
- **Edge `type`** — used for relationship type filtering (`[:FRIEND]`, `[:RPC]`)

## Supported Cypher Features

| Feature | Syntax | Supported |
|---|---|---|
| Node matching with label | `MATCH (n:Label)` | ✅ |
| Node matching with properties | `MATCH (n:Label {key: "val"})` | ✅ |
| Directional edges | `->`, `<-`, `-` | ✅ |
| Relationship type filter | `-[:TYPE]->` | ✅ |
| Variable-length paths | `-[*min..max]->` | ✅ |
| Edge variable binding | `-[r:TYPE]->` | ✅ |
| `OPTIONAL MATCH` | `OPTIONAL MATCH (a)-[]->(b)` | ✅ |
| `RETURN` with property access | `RETURN n.name` | ✅ |
| `RETURN` with aliases | `RETURN n AS node` | ✅ |
| `WITH` pipelining | `WITH n, count(m) AS c` | ✅ |
| Aggregations | `count()`, `sum()`, `avg()`, `min()`, `max()` | ✅ |
| `WHERE` on `WITH` | `WHERE c > 5` | ✅ |
| `WHERE` operators | `>`, `<`, `=`, `CONTAINS` | ✅ |
| `CREATE` nodes | `CREATE (n:Label {key: val})` | ✅ |
| `SET` properties | `SET n.prop = value` | ✅ |
| `DELETE` nodes | `DELETE n` | ✅ |
| Multiple chained MATCH | `MATCH (a) MATCH (b)` | ❌ single MATCH per stage |
| `ORDER BY` (single/multi-column, ASC/DESC) | `ORDER BY n.name ASC, n.age DESC` | ✅ |
| `SKIP` | `SKIP 10` | ✅ |
| `LIMIT` | `LIMIT 10` | ✅ |
| Subqueries, `CALL`, APOC | — | ❌ |

## What This Skill Is For

Use this skill whenever the user asks about:

- **Service dependencies** — "What does X depend on?"
- **Blast radius / impact analysis** — "If X goes down, what breaks?"
- **Path tracing** — "Show me the path from A to B"
- **Infrastructure topology** — "How are things connected?"
- **Replication / failover** — "What's the replication setup?"
- **External dependencies** — "Which services call external APIs?"
- **Monitoring coverage** — "What's being monitored?"
- **Degree analysis** — "Which nodes have the most connections?"
- **Graph mutations** — "Add a new node", "Update a property"

## Query Patterns

### List all nodes of a given label

```bash
gcyphrq -g <graph.json> -e 'MATCH (n:Label) RETURN n'
```

### Filter nodes by property

```bash
gcyphrq -g <graph.json> -e 'MATCH (n:Label {prop: "value"}) RETURN n'
```

### Find nodes connected to a specific node

```bash
gcyphrq -g <graph.json> -e 'MATCH (n)-[]->(target {name: "Target"}) RETURN n'
```

### Trace paths between nodes (variable-length)

```bash
gcyphrq -g <graph.json> -e 'MATCH (a {name: "A"})-[r*1..3]->(b {name: "B"}) RETURN a, r, b'
```

### Blast radius (N hops from a node, undirected)

```bash
gcyphrq -g <graph.json> -e 'MATCH (root {name: "Root"})-[r*1..2]-(affected) RETURN root, r, affected'
```

### Blast radius (downstream only, directed)

```bash
gcyphrq -g <graph.json> -e 'MATCH (root {name: "Root"})-[r*1..2]->(downstream) RETURN root, r, downstream'
```

### Count connections per node

```bash
gcyphrq -g <graph.json> -e 'MATCH (n:Label)-[]->(target) WITH n, count(target) AS degree RETURN n, degree'
```

### Filter by connection count

```bash
gcyphrq -g <graph.json> -e 'MATCH (n:Label)-[]->(target) WITH n, count(target) AS degree WHERE degree > 2 RETURN n, degree'
```

### OPTIONAL MATCH (find nodes without connections)

```bash
gcyphrq -g <graph.json> -e 'MATCH (n:Label) OPTIONAL MATCH (n)-[]->(m) WHERE m IS NULL RETURN n'
```

### Sort and paginate

```bash
gcyphrq -g <graph.json> -e 'MATCH (n:Label) RETURN n.name ORDER BY n.name ASC SKIP 10 LIMIT 10'
```

### Create, update, delete (in-memory only)

```bash
# Add a node
gcyphrq -g <graph.json> -e 'CREATE (n:Label {name: "New Node"}) RETURN n'

# Update a property
gcyphrq -g <graph.json> -e 'MATCH (n:Label {name: "Existing"}) SET n.status = "updated" RETURN n'

# Delete a node
gcyphrq -g <graph.json> -e 'MATCH (n:Label {name: "Existing"}) DELETE n'
```

> **Note:** Mutations are in-memory only. They do not modify the source JSON file.

## Output Format

The tool outputs raw JSON — a JSON array of result objects. No prefixes, no markdown, no extra text. Stdout is pipe-friendly.

Errors go to stderr with `Error: ` prefix and exit code 1.

## Key Limitations

- **Single MATCH per stage** — the engine processes one MATCH clause at a time. Chained `MATCH (a) MATCH (b)` is not supported.
- **No subqueries** — `CALL {}`, APOC procedures, and other extensions are not available.
- **WHERE only on WITH** — `WHERE` filtering works in `WITH` clauses, not directly on `MATCH`.
- **Aggregation edge cases** — `avg()`, `min()`, `max()` return null when no numeric values exist.
- **Property access in RETURN** — returns the full node object or a single property. Nested property access beyond one level is not supported.
- **ORDER BY on RETURN and WITH** — supported on both, multi-column with ASC/DESC.
- **SKIP on RETURN and WITH** — supported on both. Use with ORDER BY + LIMIT for pagination.

## References

- `references/queries.md` — Detailed query examples for cloud-infra.json. Load this file when the user asks about specific infrastructure questions (service dependencies, blast radius, monitoring coverage, replication, etc.) and you need concrete query patterns to adapt.
