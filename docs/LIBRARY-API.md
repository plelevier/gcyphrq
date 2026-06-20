# Library API

`gcyphrq` can be used as a library in Node.js and TypeScript projects. This guide covers all public APIs, types, and usage patterns.

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
    { id: 'bob', label: 'User', name: 'Bob', age: 25 },
  ],
  edges: [
    { source: 'alice', target: 'bob', type: 'FRIEND' },
  ],
};

const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name, u.age');
console.log(results);
// [ { name: 'Alice', age: 30 }, { name: 'Bob', age: 25 } ]
```

## API Reference

### `executeQuery(graphData, query)`

Execute a Cypher query against a graph and return results as plain JSON. This is the simplest entry point — pass in graph data and a query string, get back an array of result rows.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `graphData` | [`GraphFile`](#graphfile) | Graph data in the Graphology JSON format |
| `query` | `string` | A Cypher query string |

**Returns:** [`ResultRow[]`](#resultrow) — array of result rows

**Throws:** [`GraphError`](#grapherror) if graph data is invalid, `Error` if the query is invalid

```ts
import { executeQuery } from 'gcyphrq';

const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name');
```

---

### `createGraph(graphData)`

Build a [`GraphInstance`](#graphinstance) from a graph data object. Validates the data and constructs a Graphology-backed graph that the Cypher engine can query.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `graphData` | [`GraphFile`](#graphfile) | Graph data in the Graphology JSON format |

**Returns:** [`GraphInstance`](#graphinstance)

**Throws:** [`GraphError`](#grapherror) if graph data is invalid

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

**Returns:** [`AdvancedCypherAST`](#advancedcypherast)

**Throws:** `Error` if the query cannot be parsed

```ts
import { parseCypher } from 'gcyphrq';

const ast = parseCypher('MATCH (u:User) RETURN u');
console.log(ast.stages[0].clause.sourcePattern.label); // 'User'
```

---

### `GraphEngine`

The Cypher query engine class. Accepts a `GraphInstance` and executes parsed ASTs.

**Constructor:** `new GraphEngine(graph: GraphInstance)`

**Methods:**

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `execute(ast)` | `ast: AdvancedCypherAST` | `ResultRow[]` | Execute a parsed AST against the graph |

```ts
import { GraphEngine, createGraph, parseCypher } from 'gcyphrq';

const graph = createGraph(graphData);
const engine = new GraphEngine(graph);
const ast = parseCypher('MATCH (u:User) RETURN u.name');
const results = engine.execute(ast);
```

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
import { createGraph, GraphEngine } from 'gcyphrq';

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

### Pattern 4: AST inspection

Use `parseCypher` to inspect or transform the query AST before execution:

```ts
import { parseCypher } from 'gcyphrq';

const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u');
console.log(ast.stages[0].clause.sourcePattern.properties);
// { name: 'Alice' }
```

### Pattern 5: Mutation followed by query

The engine supports `CREATE`, `SET`, and `DELETE` mutations within queries:

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

## Supported Cypher Features

| Feature | Status |
|---|---|
| `MATCH` with node labels and properties | ✅ |
| Variable-length paths `*min..max` | ✅ |
| Directional edges `->`, `<-`, `-` | ✅ |
| `OPTIONAL MATCH` | ✅ |
| `RETURN` with property access and aliases | ✅ |
| `WITH` + implicit grouping | ✅ |
| `count()`, `sum()` aggregations | ✅ |
| `WHERE` (on `WITH`) with `>`, `<`, `=`, `CONTAINS` | ✅ |
| `CREATE`, `SET`, `DELETE` mutations | ✅ |
| Multiple chained clauses | ✅ (single MATCH per stage) |
| `ORDER BY` (single/multi-column, ASC/DESC) | ✅ |
| `SKIP` | ✅ |
| `LIMIT` | ✅ |
| Subqueries, `CALL`, APOC | ❌ |

See the [Query Guide](QUERY-GUIDE.md) for syntax details and examples.

## Graph File Format

The graph data format follows the [Graphology](https://graphology.github.io/) project's JSON representation:

```json
{
  "nodes": [
    { "id": "alice", "label": "User", "name": "Alice" }
  ],
  "edges": [
    { "source": "alice", "target": "bob", "type": "FRIEND" }
  ]
}
```

- **`nodes`** — array of node objects. Each must have a unique `id` (string). Additional properties become node attributes.
- **`edges`** — array of edge objects. Each must have `source` and `target` (strings referencing node IDs). Additional properties become edge attributes.
- Edge IDs are auto-generated by Graphology. You cannot specify custom edge IDs.
- Multi-graphs (multiple edges between the same pair of nodes) are not supported.

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
// CommonJS
async function main() {
  const { executeQuery } = await import('gcyphrq');
  const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name');
  console.log(results);
}

main();
```

## Performance Considerations

- **`executeQuery`** builds a new graph for each call. For multiple queries, use `createGraph` + `GraphEngine` instead.
- The engine processes queries in-memory with no caching. Large graphs (>10,000 nodes) may have noticeable query times.
- Variable-length paths use DFS traversal. Setting `maxDepth` is recommended to avoid excessive exploration.
