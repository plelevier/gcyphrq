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
    { key: 'alice', attributes: { label: 'User', name: 'Alice', age: 30 } },
    { key: 'bob',   attributes: { label: 'User', name: 'Bob',   age: 25 } },
  ],
  edges: [
    { source: 'alice', target: 'bob', attributes: { type: 'FRIEND' } },
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

### `executeQuery(graphData, query, opts?)`

Execute a Cypher query against a graph and return results as plain JSON. This is the simplest entry point — pass in graph data and a query string, get back an array of result rows.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `graphData` | [`GraphInput`](#graphinput) | Graph data in Graphology JSON format |
| `query` | `string` | A Cypher query string |
| `opts` | [`IndexBuildOptions`](#indexbuildoptions) (optional) | Configuration for label/edge-type property names and warnings |

**Returns:** `ResultRow[]` — array of result rows

**Throws:** `GraphError` if graph data is invalid, `Error` if the query is invalid

```ts
import { executeQuery } from 'gcyphrq';

const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name');
```

#### Custom Label/Edge-Type Property Names

By default gcyphrq reads `label` from node attributes and `type` from edge attributes. Use the `config` option to point at different property names:

```ts
import { executeQuery } from 'gcyphrq';

const results = executeQuery(graphData, 'MATCH (s:Service) RETURN s.name', {
  config: { labelProperty: 'kind', edgeTypeProperty: 'rel' },
});
```

#### `executeQuery(graph, query, opts?)` — with a Graphology Graph

Execute a Cypher query against an existing Graphology `Graph` instance. Indexes are built automatically from the graph.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `graph` | Any Graphology `Graph` | An existing graph instance (from `graphology` or the library's `Graph` wrapper) |
| `query` | `string` | A Cypher query string |
| `opts` | [`IndexBuildOptions`](#indexbuildoptions) (optional) | Configuration for label/edge-type property names and warnings |

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

### `createGraph(graphData, opts?: GraphOptions)`

Build a `GraphInstance` from a graph data object. Validates the data and constructs a Graphology-backed graph that the Cypher engine can query.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `graphData` | [`GraphInput`](#graphinput) | Graph data in Graphology JSON format |
| `opts` | [`GraphOptions`](#graphoptions) (optional) | Only supports `onWarning` callback. Does **not** accept `config` (label/edge-type property names) — use it with `buildGraphIndexes` or `executeQuery` instead |

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

**Returns:** `CypherAST` — either `AdvancedCypherAST` (single query) or `UnionQueryAST` (UNION query)

**Throws:** `Error` if the query cannot be parsed

```ts
import { parseCypher } from 'gcyphrq';

const ast = parseCypher('MATCH (u:User) RETURN u');
// ast.type is 'Query' for single queries, 'UnionQuery' for UNION queries
if (ast.type === 'Query') {
  console.log(ast.stages[0].clause.sourcePattern.labels); // ['User']
}
```

---

### `buildGraphIndexes`

Build pre-computed indexes for fast query execution. Pass the returned indexes to `GraphEngine` for O(1) label, property, and edge-type lookups instead of full-graph scans.

**Three overloads:**

| Signature | Description |
|---|---|
| `buildGraphIndexes(graph, opts?)` | Build indexes from an existing Graphology graph |
| `buildGraphIndexes(data, opts?)` | Build indexes from graph data alone (builds graph internally) |
| `buildGraphIndexes(data, graph, opts?)` | Build indexes from graph data + graph instance |

All overloads accept an optional `opts` argument of type [`IndexBuildOptions`](#indexbuildoptions).

**Returns:** `GraphIndexes`

```ts
import { buildGraphIndexes, GraphEngine } from 'gcyphrq';
import Graph from 'graphology';

const graph = new Graph();
graph.addNode('alice', { label: 'User', name: 'Alice' });

const indexes = buildGraphIndexes(graph);
const engine = new GraphEngine(graph, indexes);
```

#### Custom Label/Edge-Type Property Names

By default gcyphrq reads `label` from node attributes and `type` from edge attributes. Use `opts.config` to point at different property names:

```ts
import { buildGraphIndexes, GraphEngine } from 'gcyphrq';

const graph = createGraph(graphData);
const indexes = buildGraphIndexes(graph, {
  config: { labelProperty: 'kind', edgeTypeProperty: 'rel' },
});
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
| `execute(ast)` | `ast: AdvancedCypherAST` | `ResultRow[]` | Execute a single parsed AST against the graph |
| `executeUnion(ast)` | `ast: UnionQueryAST` | `ResultRow[]` | Execute a UNION/UNION ALL AST. Aligns columns by name and deduplicates for `UNION` |

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
>
> **Note:** Indexes are invalidated after `CREATE`/`SET`/`DELETE`/`REMOVE` mutations. Subsequent MATCH/WITH stages within the same query fall back to full-graph scans to see updated graph state.

---

### `Graph`

The Graphology wrapper class. Use this when you need to build a graph programmatically (node-by-node) instead of from a data object.

**Constructor:**

```ts
new Graph(options?: { type?: 'directed' | 'undirected' | 'mixed' })
```

Defaults to `'directed'`. For mixed graphs, pass `{ undirected: true }` in edge attributes to create bidirectional edges.

**Methods:**

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `addNode(id, attrs?)` | `id: string`, `attrs?: Record<string, unknown>` | `void` | Add a node with optional attributes |
| `addEdge(a, b, attrs?)` | `a: string`, `b: string`, `attrs?: Record<string, unknown>` | `void` | Add an edge (directed by default; use `{ undirected: true }` in mixed graphs) |
| `getNodeAttributes(id)` | `id: string` | `Record<string, unknown>` | Get node attributes |
| `getEdgeAttributes(id)` | `id: string` | `Record<string, unknown>` | Get edge attributes |
| `filterNodes(fn)` | `fn: (id, attrs) => boolean` | `string[]` | Filter nodes by predicate |
| `forEachOutboundEdge(id, cb)` | `id: string`, `cb: callback` | `void` | Iterate outbound edges |
| `forEachInboundEdge(id, cb)` | `id: string`, `cb: callback` | `void` | Iterate inbound edges |
| `forEachEdge(id, cb)` | `id: string`, `cb: callback` | `void` | Iterate all edges (undirected) |
| `setNodeAttribute(id, attr, value)` | `id: string`, `attr: string`, `value: unknown` | `void` | Set a node attribute |
| `hasNode(id)` | `id: string` | `boolean` | Check if node exists |
| `dropNode(id)` | `id: string` | `void` | Remove a node and its edges |
| `type` (getter) | — | `'directed' \| 'undirected' \| 'mixed'` | Graph type |
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

### Pattern 4: External Graphology graph

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

### Pattern 5: AST inspection

Use `parseCypher` to inspect or transform the query AST before execution:

```ts
import { parseCypher } from 'gcyphrq';

const ast = parseCypher('MATCH (u:User {name: "Alice"}) RETURN u');
if (ast.type === 'Query') {
  console.log(ast.stages[0].clause.sourcePattern.properties);
  // { name: 'Alice' }
}
```

### Pattern 6: UNION / UNION ALL

Combine results from multiple query branches:

```ts
import { executeQuery } from 'gcyphrq';

const results = executeQuery(graphData,
  'MATCH (u:User {name: "Alice"}) RETURN u.name UNION ALL MATCH (u:User {name: "Bob"}) RETURN u.name',
);
// [ { name: 'Alice' }, { name: 'Bob' } ]
```

Use `UNION` (without `ALL`) to deduplicate the combined result set.

### Pattern 7: Mutation followed by query

The engine supports `CREATE`, `SET`, `DELETE`, and `REMOVE` mutations within queries. Mutations modify the underlying graph in-place:

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
  // Graph data (Graphology JSON format)
  GraphInput,
  GraphologyFile,
  GraphologyNode,
  GraphologyEdge,
  GraphologyGraphOptions,

  // Graph instance
  GraphInstance,
  GraphIndexes,

  // Options
  GraphOptions,
  IndexBuildOptions,
  GraphConfig,

  // AST types
  AdvancedCypherAST,
  UnionQueryAST,
  UnionType,
  CypherAST,
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

#### `GraphInput`

Graph data in Graphology JSON format:

```ts
type GraphInput = GraphologyFile;
```

#### `IndexBuildOptions`

Options for `buildGraphIndexes` and `executeQuery`. Extends `GraphOptions` with an optional `config` field.

```ts
interface IndexBuildOptions extends GraphOptions {
  /** Partial config for label/edge-type property names. */
  config?: Partial<GraphConfig>;
}
```

#### `GraphConfig`

The resolved config used internally. Both fields are required.

```ts
interface GraphConfig {
  /** Node attribute key used as the Cypher label (default: `"label"`). */
  labelProperty: string;
  /** Edge attribute key used as the Cypher relationship type (default: `"type"`). */
  edgeTypeProperty: string;
}
```

#### `GraphOptions`

Options for `createGraph`. Does **not** include `config` (label/edge-type property names).

```ts
interface GraphOptions {
  /** Callback for non-fatal warnings during graph construction. */
  onWarning?: (message: string) => void;
}
```

#### `GraphologyFile`

The Graphology JSON format (primary format):

```ts
interface GraphologyFile {
  options?: GraphologyGraphOptions;
  attributes?: Record<string, unknown>;
  nodes: GraphologyNode[];
  edges: GraphologyEdge[];
}

interface GraphologyNode {
  key: string;
  attributes: Record<string, unknown>;
}

interface GraphologyEdge {
  key?: string;
  source: string;
  target: string;
  undirected?: boolean; // only effective in mixed graphs; makes the edge bidirectional
  attributes: Record<string, unknown>;
}

interface GraphologyGraphOptions {
  type?: 'directed' | 'undirected' | 'mixed'; // all three are supported
  allowSelfLoops?: boolean;                    // enables self-loop edges
  multi?: boolean;                             // enables parallel edges between same nodes
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

interface UnionQueryAST {
  type: 'UnionQuery';
  branches: AdvancedCypherAST[];
  unionTypes: (UnionType | null)[]; // null for first branch, then 'UNION' or 'UNION ALL'
  orderBy: OrderByItem[] | undefined; // ORDER BY on combined result
  skip: number | undefined;           // SKIP on combined result
  limit: number | undefined;          // LIMIT on combined result
}

type UnionType = 'UNION' | 'UNION ALL';

type CypherAST = AdvancedCypherAST | UnionQueryAST;
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

## Next Steps

- **[Query Guide]({{ '/query-guide/' | relative_url }})** — Full Cypher syntax reference and query patterns
- **[Examples]({{ '/examples/' | relative_url }})** — Ready-to-run queries against the bundled example graphs
