# Graphology Cypher Query Guide

This project utilizes an advanced in-memory Cypher execution engine on top of `Graphology`. When generating queries to interact with this tool, you must output **only raw Cypher query strings**. Do not generate JSON AST schemas or programmatic API builders.

## CLI Usage

```bash
Usage: gcyphrq [options]

Options:
  -e, --expr <query>   Cypher query expression (required)
  -g, --graph <file>   Path to a JSON graph file (or "-" to read from stdin)
  -h, --help           Show this help message
```

### Loading a graph

The tool requires a graph file provided with the `-g` flag:

```bash
gcyphrq -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'
```

Or pipe the graph from stdin:

```bash
cat my-graph.json | gcyphrq -g - -e 'MATCH (u:User) RETURN u'
```

### Graph file format

```json
{
  "nodes": [
    { "id": "<node-id>", "label": "<label>", "<property>": "<value>", ... }
  ],
  "edges": [
    { "source": "<source-id>", "target": "<target-id>", "type": "<edge-type>", ... }
  ]
}
```

See the [`examples/`](../examples/) directory for sample graphs.

### Output format

The tool outputs raw JSON — a JSON array of result objects with no prefixes or extra text. This makes it easy to pipe into other tools:

```bash
gcyphrq -g examples/social-graph.json -e 'MATCH (u:User) RETURN u.name' | jq '.[0].u'
```

## Query Syntax Restrictions & Capabilities

The execution engine is optimized for the following Cypher features:
- **Node & Variable Depth Filtering**: Supports specific variable length paths (e.g., `*1..3`).
- **Full Path Edge Extraction**: Binding a variable to a deep path relationship returns the entire array sequence of traversed edges.
- **Directional Enforcement**: Standard ASCII arrow directionality rules apply (`->`, `<-`, `-`).
- **Implicit Grouping & Aggregations**: Supports `WITH` pipelining alongside `count()` and `sum()`.
- **ORDER BY**: Supports single or multiple sort keys with `ASC` (default) or `DESC` direction.
- **LIMIT**: Truncates results to a specified count.
- **Mutations**: Supports `CREATE`, `SET`, and `DELETE`.

---

## Code Generation Examples

Use these examples as structural templates when generating Cypher strings for the tool:

### 1. Deep Path & Traversed Edge Sequences
To retrieve a node, its connections up to 3 hops away (ignoring orientation), and the entire sequence of connecting edges:

```cypher
MATCH (u:User {name: 'Alice'})-[r:FRIEND*1..3]-(f:User) 
RETURN u, r, f
```

### 2. Direction-Specific Extraction
To fetch only direct inbound relations or outbound relations:

```cypher
// Outbound only
MATCH (u:User {name: 'Alice'})-[r:FRIEND]->(f:User) RETURN f

// Inbound only
MATCH (u:User {name: 'Alice'})<-[r:FRIEND]-(f:User) RETURN f
```

### 3. Optional Matches (Left Outer Joins)
To fetch source elements and safely structuralize connected paths even if they do not exist (returning empty lists/nulls instead of dropping rows):

```cypher
MATCH (u:User) 
OPTIONAL MATCH (u)-[r:HAS_CARD]->(c:Card) 
RETURN u, c
```

### 4. Aggregations & Pipeline Filtering
To group variables, run conditional counts, and stream filtered contexts further into successive evaluation stages:

```cypher
MATCH (u:User)-[:FRIEND]->(f)
WITH u, count(f) AS friendCount 
WHERE friendCount > 5
RETURN u, friendCount
```

### 6. Ordering Results (ORDER BY)
Sort results by one or more properties. Default direction is `ASC` (ascending).

```cypher
// Sort by name ascending (default)
MATCH (u:User) RETURN u.name ORDER BY u.name

// Sort by age descending
MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC

// Sort by multiple columns (primary then secondary)
MATCH (u:User) RETURN u.name, u.age ORDER BY u.age ASC, u.name DESC
```

### 7. Limiting Results (LIMIT)
Return only the first N results.

```cypher
// Return at most 5 users
MATCH (u:User) RETURN u.name LIMIT 5

// Combine ORDER BY + LIMIT for top-N queries
MATCH (u:User) RETURN u.name, u.age ORDER BY u.age DESC LIMIT 3
```

### 8. Write Mutations (Create, Update, Delete)
To chain match lookup conditions alongside operational updates on the graph state:

```cypher
// Update property attribute
MATCH (u:User {name: 'Alice'})
SET u.age = 31
RETURN u

// Create log node
CREATE (l:Log {timestamp: 12345})
RETURN l

// Remove node from graph
MATCH (f:User {name: 'Bob'})
DELETE f
```

---

## Cypher Use Cases Blueprints
When building specific features, use the exact syntactic blueprints below to leverage the engine's nested pipeline mechanics.

### Blueprint A: Hierarchical Access Control (RBAC)
To check if a `User` has permission to execute an `Action` inherited through nested `Role` paths up to 5 levels deep:

```cypher
MATCH (u:User {id: 'usr_101'})-[:BELONGS_TO*1..5]->(r:Role)-[:CAN_EXECUTE]->(a:Action {name: 'write_db'})
RETURN u, r, a
```

### Blueprint B: Collaborative Filtering Recommendation
To find items recommended to an explicit user based on what "friends of friends" bought, while excluding items the user already owns:

```cypher
MATCH (u:User {id: 'usr_abc'})-[:FRIEND*2..2]-(peer:User)-[:BOUGHT]->(item:Product)
OPTIONAL MATCH (u)-[already_owns:BOUGHT]->(item)
WITH item, already_owns
WHERE already_owns IS NULL
RETURN item
```

### Blueprint C: Identity Resolution & Clustering
To fetch a target profile node along with all its linked metadata nodes across any arbitrary relation, extracting the explicit network trace (`r`):

```cypher
MATCH (p:Profile {email: 'target@domain.com'})-[r*1..3]-(metadata)
RETURN p, r, metadata
```

### Blueprint D: "What-If" Impact Simulation
To calculate a speculative business scenario (e.g., _"What happens to downstream system impacts if we artificially change Server A's critical capacity rating to 90?"_) by injecting speculative properties mid-pipeline:

```cypher
MATCH (s:Server {id: 'srv_A'})-[:DEPENDS_ON*1..3]->(downstream:Application)
SET s.capacity = 90
WITH downstream, s
WHERE downstream.min_required_capacity > s.capacity
RETURN downstream.name AS at_risk_application, s.capacity AS simulated_capacity
```

---

## System Constraints

- Output ONLY valid Cypher syntax inside markdown blocks.
- Do not attempt to append custom plugin clauses (`APOC`, etc.) or construct complex subqueries like `CALL {}` as they are not supported by the visitor engine.
