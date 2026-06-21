---
layout: default
title: Library API
description: Complete API reference for using gcyphrq as a Node.js / TypeScript library.
---

<div class="breadcrumb">
  <a href="{{ '/' | relative_url }}">Home</a> <span>›</span> Library API
</div>

# Library API

`gcyphrq` can be used as a library in Node.js and TypeScript projects. This page covers all public APIs, types, and usage patterns.

## Installation

```bash
npm install gcyphrq
```

## Quick Start

```ts
import { executeQuery } from 'gcyphrq';

const graphData = {
  nodes: [
    { id: 'alice', label: 'User', name: 'Alice', age: 30 },
    { id: 'bob',   label: 'User', name: 'Bob',   age: 25 },
  ],
  edges: [
    { source: 'alice', target: 'bob', type: 'FRIEND' },
  ],
};

const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name, u.age');
console.log(results);
// [ { name: 'Alice', age: 30 }, { name: 'Bob', age: 25 } ]
```

### With an existing Graphology graph

If you already have a Graphology `Graph` instance (built externally or programmatically), you can pass it directly:

```ts
import { executeQuery } from 'gcyphrq';
import Graph from 'graphology';

const graph = new Graph();
graph.addNode('alice', { label: 'User', name: 'Alice', age: 30 });
graph.addNode('bob', { label: 'User', name: 'Bob', age: 25 });
graph.addEdge('alice', 'bob', { type: 'FRIEND' });

const results = executeQuery(graph, 'MATCH (u:User) RETURN u.name, u.age');
console.log(results);
// [ { name: 'Alice', age: 30 }, { name: 'Bob', age: 25 } ]
```

No graph data reconstruction needed — the library builds indexes directly from the graph instance.

---

## API Reference

### `executeQuery(graphData, query)`

Execute a Cypher query against a graph and return results as plain JSON. This is the simplest entry point — pass in graph data and a query string, get back an array of result rows.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `graphData` | [`GraphFile`](#graphfile) | Graph data in the Graphology JSON format |
| `query` | `string` | A Cypher query string |

**Returns:** `ResultRow[]` — array of result rows

**Throws:** `GraphError` if graph data is invalid, `Error` if the query is invalid

```ts
import { executeQuery } from 'gcyphrq';

const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name');
```

#### `executeQuery(graph, query)` — with a Graphology Graph

Execute a Cypher query against an existing Graphology `Graph` instance. Indexes are built automatically from the graph.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `graph` | Any Graphology `Graph` | An existing graph instance (from `graphology` or the library's `Graph` wrapper) |
| `query` | `string` | A Cypher query string |

**Returns:** `ResultRow[]` — array of result rows

**Throws:** `Error` if the query is invalid

```ts
import { executeQuery } from 'gcyphrq';
import Graph from 'graphology';

const graph = new Graph();
graph.addNode('alice', { label: 'User', name: 'Alice' });
graph.addNode('bob', { label: 'User', name: 'Bob' });
graph.addEdge('alice', 'bob', { type: 'FRIEND' });

const results = executeQuery(graph, 'MATCH (u:User) RETURN u.name');
```

---

### `createGraph(graphData)`

Build a `GraphInstance` from a graph data object. Validates the data and constructs a Graphology-backed graph that the Cypher engine can query.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `graphData` | [`GraphFile`](#graphfile) | Graph data in the Graphology JSON format |

**Returns:** `GraphInstance`

**Throws:** `GraphError` if graph data is invalid

```ts
import { createGraph } from 'gcyphrq';

const graph = createGraph(graphData);
```

---

### `parseCypher(query)`

Parse a Cypher query string into an AST. The returned AST can be passed to `GraphEngine.execute()` or inspected programmatically.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `query` | `string` | A Cypher query string |

**Returns:** `AdvancedCypherAST`

**Throws:** `Error` if the query cannot be parsed

```ts
import { parseCypher } from 'gcyphrq';

const ast = parseCypher('MATCH (u:User) RETURN u');
console.log(ast.stages[0].clause.sourcePattern.label); // 'User'
```

---

### `buildGraphIndexes(graph)`

Build pre-computed indexes for fast query execution. Pass the returned indexes to `GraphEngine` for O(1) label, property, and edge-type lookups instead of full-graph scans.

**Three overloads:**

| Signature | Description |
|---|---|
| `buildGraphIndexes(graph)` | Build indexes from an existing Graphology graph |
| `buildGraphIndexes(data)` | Build indexes from graph data alone (builds graph internally) |
| `buildGraphIndexes(data, graph)` | Build indexes from graph data + graph instance |

**Returns:** `GraphIndexes`

```ts
import { buildGraphIndexes, GraphEngine } from 'gcyphrq';
import Graph from 'graphology';

const graph = new Graph();
graph.addNode('alice', { label: 'User', name: 'Alice' });

const indexes = buildGraphIndexes(graph);
const engine = new GraphEngine(graph, indexes);
```

### `GraphEngine`

The Cypher query engine class. Accepts a `GraphInstance` and executes parsed ASTs.

**Constructor:** `new GraphEngine(graph: GraphInstance, indexes?: GraphIndexes)`

| Parameter | Type | Description |
|---|---|---|
| `graph` | `GraphInstance` | A Graphology graph instance |
| `indexes` | `GraphIndexes` (optional) | Pre-computed indexes for O(1) lookups. Without indexes, the engine falls back to full-graph scans |

**Methods:**

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `execute(ast)` | `ast: AdvancedCypherAST` | `ResultRow[]` | Execute a parsed AST against the graph |

```ts
import { GraphEngine, buildGraphIndexes, parseCypher } from 'gcyphrq';
import Graph from 'graphology';

const graph = new Graph();
graph.addNode('alice', { label: 'User', name: 'Alice' });

const indexes = buildGraphIndexes(graph);
const engine = new GraphEngine(graph, indexes);
const ast = parseCypher('MATCH (u:User) RETURN u.name');
const results = engine.execute(ast);
```

> **Tip:** For best performance, always pass pre-computed indexes to `GraphEngine`. Without indexes, every label and property lookup triggers a full-graph scan.

---

### `Graph`

The Graphology wrapper class. Use this when you need to build a graph programmatically (node-by-node) instead of from a data object.

**Methods:**

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `addNode(id, attrs?)` | `id: string`, `attrs?: Record<string, unknown>` | `void` | Add a node with optional attributes |
| `addEdge(a, b, attrs?)` | `a: string`, `b: string`, `attrs?: Record<string, unknown>` | `void` | Add a directed edge |
| `getNodeAttributes(id)` | `id: string` | `Record<string, unknown>` | Get node attributes |
| `getEdgeAttributes(id)` | `id: string` | `Record<string, unknown>` | Get edge attributes |
| `filterNodes(fn)` | `fn: (id, attrs) => boolean` | `string[]` | Filter nodes by predicate |
| `forEachOutboundEdge(id, cb)` | `id: string`, `cb: callback` | `void` | Iterate outbound edges |
| `forEachInboundEdge(id, cb)` | `id: string`, `cb: callback` | `void` | Iterate inbound edges |
| `forEachEdge(id, cb)` | `id: string`, `cb: callback` | `void` | Iterate all edges (undirected) |
| `setNodeAttribute(id, attr, value)` | `id: string`, `attr: string`, `value: unknown` | `void` | Set a node attribute |
| `hasNode(id)` | `id: string` | `boolean` | Check if node exists |
| `dropNode(id)` | `id: string` | `void` | Remove a node and its edges |
| `order` | — | `number` | Number of nodes in the graph |

```ts
import { Graph, GraphEngine } from 'gcyphrq';

const graph = new Graph();
graph.addNode('alice', { label: 'User', name: 'Alice' });
graph.addNode('bob', { label: 'User', name: 'Bob' });
graph.addEdge('alice', 'bob', { type: 'FRIEND' });

const engine = new GraphEngine(graph);
```

---

### `GraphError`

Error class thrown when graph data validation fails.

```ts
import { GraphError, createGraph } from 'gcyphrq';

try {
  createGraph({ nodes: [], edges: [] });
} catch (err) {
  if (err instanceof GraphError) {
    console.error('Graph validation failed:', err.message);
  }
}
```

---

## Usage Patterns

### Pattern 1: One-shot query (simplest)

Use `executeQuery` when you have graph data and just need results:

```ts
import { executeQuery } from 'gcyphrq';

const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name');
```

### Pattern 2: Reusable graph with multiple queries

Use `createGraph` + `GraphEngine` when running multiple queries against the same graph:

```ts
import { createGraph, GraphEngine, parseCypher } from 'gcyphrq';

const graph = createGraph(graphData);
const engine = new GraphEngine(graph);

const users = engine.execute(parseCypher('MATCH (u:User) RETURN u.name'));
const counts = engine.execute(parseCypher('MATCH (u:User) RETURN count(u)'));
```

### Pattern 3: Programmatic graph construction

Use `Graph` directly when building the graph from non-JSON sources (database, API, etc.):

```ts
import { Graph, GraphEngine, parseCypher } from 'gcyphrq';

const graph = new Graph();

// Build from a database query, API response, etc.
for (const user of users) {
  graph.addNode(user.id, { label: 'User', ...user.properties });
}
for (const rel of relationships) {
  graph.addEdge(rel.from, rel.to, { type: rel.type });
}

const engine = new GraphEngine(graph);
const results = engine.execute(parseCypher('MATCH (u:User) RETURN u'));
```

### Pattern 3a: External Graphology graph

Use the library with any existing Graphology `Graph` instance — for example, one built from a database, a file, or another library. The library builds indexes directly from the graph without needing the original data.

```ts
import { executeQuery, buildGraphIndexes, GraphEngine, parseCypher } from 'gcyphrq';
import Graph from 'graphology';

// Build graph from any source (database, API, file, etc.)
const graph = new Graph();
for (const node of nodesFromDatabase) {
  graph.addNode(node.id, { label: node.label, ...node.properties });
}
for (const edge of edgesFromDatabase) {
  graph.addEdge(edge.source, edge.target, { type: edge.type });
}

// One-shot query (indexes built automatically)
const results = executeQuery(graph, 'MATCH (u:User) RETURN u.name');

// Or with reusable engine and indexes for multiple queries
const indexes = buildGraphIndexes(graph);
const engine = new GraphEngine(graph, indexes);
const users = engine.execute(parseCypher('MATCH (u:User) RETURN u.name'));
const count = engine.execute(parseCypher('MATCH (u:User) RETURN count(u)'));
```

### Pattern 4: AST inspection

Use `parseCypher` to inspect or transform the query AST before execution:

```ts
import { parseCypher } from 'gcyphrq';

const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u');
console.log(ast.stages[0].clause.sourcePattern.properties);
// { name: 'Alice' }
```

### Pattern 5: Mutation followed by query

The engine supports `CREATE`, `SET`, and `DELETE` mutations within queries. Mutations modify the underlying graph in-place:

```ts
import { createGraph, GraphEngine, parseCypher } from 'gcyphrq';

const graph = createGraph(graphData);
const engine = new GraphEngine(graph);

// Create a new node
engine.execute(parseCypher('CREATE (n:User {name: "Charlie"}) RETURN n'));

// Update a node
engine.execute(parseCypher('MATCH (u:User {name: "Alice"}) SET u.age = 31 RETURN u'));

// Query after mutation
const results = engine.execute(parseCypher('MATCH (u:User) RETURN u.name, u.age'));
```

---

## Types

All types are exported and can be imported for use in your own code:

```ts
import type {
  // Graph data
  GraphFile,
  GraphFileNode,
  GraphFileEdge,

  // Graph instance
  GraphInstance,

  // AST types
  AdvancedCypherAST,
  Stage,
  MatchClause,
  WithClause,
  ReturnClause,
  WriteClause,
  NodePattern,
  RelationPattern,
  Direction,

  // Expression types
  Expression,
  PropertyAccessExpression,
  LiteralExpression,
  AggregationExpression,
  BinaryExpression,
  Projection,
  OrderByItem,

  // Result types
  ResultRow,
  QueryContext,
  CypherNode,
  CypherEdge,
  CypherValue,
  CypherLiteral,
} from 'gcyphrq';
```

### Key Types

#### `GraphFile`

```ts
interface GraphFile {
  nodes: GraphFileNode[];
  edges: GraphFileEdge[];
}

interface GraphFileNode {
  id: string;
  label?: string;
  [key: string]: unknown;
}

interface GraphFileEdge {
  source: string;
  target: string;
  type?: string;
  [key: string]: unknown;
}
```

#### `ResultRow`

```ts
type ResultRow = Record<string, CypherNode | CypherEdge[] | CypherLiteral | null | undefined>;
```

Each result row is a plain object mapping projection aliases to their values.

#### `AdvancedCypherAST`

```ts
interface AdvancedCypherAST {
  type: 'Query';
  stages: Stage[];
  return: ReturnClause | undefined;
}

type Stage =
  | { type: 'MATCH'; clause: MatchClause }
  | { type: 'WITH'; clause: WithClause }
  | { type: 'WRITE'; clause: WriteClause };
```

---

## Error Handling

The library throws two kinds of errors:

- **`GraphError`** — thrown when graph data validation fails (invalid format, missing fields, duplicate IDs, etc.)
- **`Error`** — thrown when a Cypher query cannot be parsed or executed (syntax errors, unsupported features, etc.)

```ts
import { executeQuery, GraphError } from 'gcyphrq';

try {
  const results = executeQuery(graphData, query);
} catch (err) {
  if (err instanceof GraphError) {
    // Graph data is invalid
    console.error('Invalid graph:', err.message);
  } else {
    // Query error
    console.error('Query failed:', err.message);
  }
}
```

---

## TypeScript Configuration

No special TypeScript configuration is needed. The package ships with declaration files (`.d.ts`) and uses standard ESM module resolution.

For projects using `"moduleResolution": "node"` (older tsconfig), add:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler"
  }
}
```

## CommonJS Compatibility

The library is published as ESM only. In CommonJS projects, use dynamic `import()`:

```js
async function main() {
  const { executeQuery } = await import('gcyphrq');
  const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name');
  console.log(results);
}

main();
```

## Performance Considerations

- **`executeQuery(graphData, query)`** builds a new graph for each call. For multiple queries, use `createGraph` + `GraphEngine` instead.
- **`executeQuery(graph, query)`** with an existing graph instance reuses the graph but still builds indexes on each call. For multiple queries, use `buildGraphIndexes` + `GraphEngine` instead.
- The engine processes queries in-memory with no caching. Large graphs (>10,000 nodes) may have noticeable query times.
- Variable-length paths use DFS traversal. Setting `maxDepth` is recommended to avoid excessive exploration.

## Benchmark

The `bench.ts` script measures query performance with and without pre-computed indexes. Each query runs 50 iterations and reports per-run average time for both indexed and non-indexed modes, plus the speedup ratio.

### Running the benchmark

```bash
# Default: 5 queries against examples/cloud-infra.json
npx tsx bench.ts

# Different graph
npx tsx bench.ts -g examples/social-graph.json

# Custom queries (any number of -q args)
npx tsx bench.ts -q 'MATCH (s:Service) RETURN s' 'MATCH (n) RETURN count(n) AS total'

# Both together
npx tsx bench.ts -g examples/cloud-infra.json -q 'MATCH (s:Service {type: "RPC"}) RETURN s.name'
```

### Options

| Option | Description |
|---|---|
| `-g <file>` | Path to a JSON graph file (default: `examples/cloud-infra.json`) |
| `-q <query> [query ...]` | One or more Cypher queries to benchmark. If omitted, runs a default set of 5 queries |

### Output

```
Graph: 51 nodes, 142 edges

Query                                                             | No index     | Indexed      | Speedup
─────────────────────────────────────────────────────────────────────────────────────────────────────────
MATCH (s:Service) RETURN s                                        | 0.04ms  (20 rows) | 0.01ms  (20 rows) | 2.6x
MATCH (s:Service)-[r:DEPENDS_ON*1..2]->(d) RETURN s.name, d....   | 0.04ms  (0 rows) | 0.02ms  (0 rows) | 2.4x
MATCH (n) RETURN count(n) AS total                                | 0.04ms  (1 rows) | 0.03ms  (1 rows) | 1.3x
MATCH (s:Service) RETURN s ORDER BY s.name SKIP 2 LIMIT 5         | 0.03ms  (5 rows) | 0.02ms  (5 rows) | 1.6x
MATCH (s:Service {type: "RPC"}) RETURN s.name                     | 0.02ms  (10 rows) | 0.01ms  (10 rows) | 1.8x
```

Each row shows:
- **Query** — the Cypher query (truncated at 63 characters)
- **No index** — average time without indexes (full-graph scan)
- **Indexed** — average time with pre-computed label, property, and edge-type indexes
- **Speedup** — ratio of no-index time to indexed time

### Default queries

When no `-q` argument is provided, the benchmark runs these 5 queries:

| # | Query | What it tests |
|---|---|---|
| 1 | `MATCH (s:Service) RETURN s` | Label-only node lookup |
| 2 | `MATCH (s:Service)-[r:DEPENDS_ON*1..2]->(d) RETURN s.name, d.name` | Variable-length path traversal with typed edges |
| 3 | `MATCH (n) RETURN count(n) AS total` | Full-graph scan with aggregation |
| 4 | `MATCH (s:Service) RETURN s ORDER BY s.name SKIP 2 LIMIT 5` | Label lookup + sorting + pagination |
| 5 | `MATCH (s:Service {type: "RPC"}) RETURN s.name` | Combined label + property filter |

### How it works

1. Loads the graph from a JSON file and builds a Graphology graph
2. Builds pre-computed indexes (label, property, edge-type adjacency) from the same data
3. For each query, runs two sets of 50 iterations:
   - **No index** — engine receives no indexes, falls back to full-graph scan
   - **Indexed** — engine receives pre-computed indexes for O(1) lookups
4. Reports per-iteration average time and speedup ratio

### Interpretation

Speedup ratios vary by query type:
- **Label-only lookups** benefit most from the label index (2–3x)
- **Property filters** benefit from the property index (1.5–2x)
- **Path traversals** benefit from the edge-type adjacency index (2–3x)
- **Full-graph scans** (no filter) show minimal difference since indexes provide no shortcut

On larger graphs (hundreds or thousands of nodes), the speedup from indexes becomes more pronounced as full-graph scans scale linearly with graph size.

---

## Next Steps

- **[Query Guide](query-guide)** — Full Cypher syntax reference and query patterns
- **[Examples](examples)** — Ready-to-run queries against the bundled cloud infrastructure graph
