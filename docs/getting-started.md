---
layout: default
title: Getting Started
description: Install gcyphrq and run your first Cypher query.
---

<div class="breadcrumb">
  <a href="{{ '/' | relative_url }}">Home</a> <span>›</span> Getting Started
</div>

# Getting Started

This guide will help you install `gcyphrq` and run your first Cypher query against an in-memory graph.

## Prerequisites

- **Node.js** {{ site.node_version }} or later
- **npm** (or any compatible package manager)

## Installation

### Global CLI

```bash
npm install -g gcyphrq
```

This makes the `gcyphrq` command available globally on your PATH.

### Project dependency

```bash
npm install gcyphrq
```

### From source

```bash
git clone https://github.com/plelevier/gcyphrq.git
cd gcyphrq
npm install
npm run build
npm link
```

## Your First Query

### 1. Create a graph file

Create a file called `social-graph.json`:

```json
{
  "nodes": [
    { "key": "alice", "attributes": { "label": "User", "name": "Alice", "age": 30 } },
    { "key": "bob",   "attributes": { "label": "User", "name": "Bob",   "age": 25 } },
    { "key": "charlie","attributes": { "label": "User", "name": "Charlie","age": 35 } }
  ],
  "edges": [
    { "source": "alice", "target": "bob", "attributes": { "type": "FRIEND" } },
    { "source": "bob", "target": "charlie", "attributes": { "type": "FRIEND" } }
  ]
}
```

### 2. Run a query

```bash
gcyphrq -g social-graph.json -e 'MATCH (u:User) RETURN u.name, u.age'
```

**Output:**

```json
[
  { "name": "Alice", "age": 30 },
  { "name": "Bob", "age": 25 },
  { "name": "Charlie", "age": 35 }
]
```

> **Note:** When the query returns only scalar values (property access, aggregations), the CLI outputs rows format automatically. When returning full nodes or edges, the default output is [graph format](cli) — a `{nodes, edges}` structure that can be piped back into `gcyphrq`. Use `--format rows` to force row-based output.

### 3. Pipe to `jq`

The CLI outputs raw JSON, so you can pipe it directly to `jq`:

```bash
gcyphrq -g social-graph.json -e 'MATCH (u:User) RETURN u.name' | jq '.[].name'
```

## Graph File Format

Graphs use the [Graphology JSON format](https://graphology.github.io/). See [`examples/README.md`](https://github.com/plelevier/gcyphrq/blob/main/examples/README.md) for the full specification.

See also the [Example Graphs](examples) page for ready-to-run queries against bundled graphs.

## Reading from stdin

Instead of a file, you can pipe the graph from stdin using `-g -`:

```bash
cat my-graph.json | gcyphrq -g - -e 'MATCH (u:User) RETURN u'
```

## Using as a Library

For programmatic access, import `gcyphrq` in your TypeScript or Node.js project:

```ts
import { executeQuery } from 'gcyphrq';

const graphData = {
  nodes: [
    { key: 'alice', attributes: { label: 'User', name: 'Alice', age: 30 } },
    { key: 'bob', attributes: { label: 'User', name: 'Bob', age: 25 } },
  ],
  edges: [
    { source: 'alice', target: 'bob', attributes: { type: 'FRIEND' } },
  ],
};

const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name, u.age');
console.log(results);
// [ { name: 'Alice', age: 30 }, { name: 'Bob', age: 25 } ]
```

## Loading Data from CSV

Load data from CSV files and combine it with graph queries. Example CSV files are bundled in `examples/csv/`.

### `users.csv` — Node data

```
name,age,city
Alice,30,NYC
Bob,25,LA
Charlie,35,SF
```

### `friendships.csv` — Edge data

```
source,target,since
Alice,Bob,2020
Bob,Charlie,2021
Alice,Charlie,2019
```

### `products.csv` — Product catalog

```
id,name,price,category
1,Widget,9.99,gadgets
2,Gizmo,24.99,gadgets
3,Hammer,14.99,tools
4,Saw,29.99,tools
5,Screwdriver,7.99,tools
```

### `orders.csv` — Order data

```
orderId,productId,quantity
101,1,3
102,2,1
103,3,2
104,5,5
105,1,1
```

### Example queries

**Load and transform CSV data:**

```bash
gcyphrq -g examples/social-graph.json -e "LOAD CSV WITH HEADERS FROM 'examples/csv/users.csv' AS row RETURN row.name AS name, toInteger(row.age) AS age, row.city AS city"
```

**Create nodes from CSV:**

```bash
gcyphrq -g examples/social-graph.json -e "LOAD CSV WITH HEADERS FROM 'examples/csv/users.csv' AS row CREATE (:User {name: row.name, age: toInteger(row.age)}) RETURN row.name AS created"
```

**Load CSV inside a CALL subquery:**

```bash
gcyphrq -g examples/social-graph.json -e "CALL { LOAD CSV WITH HEADERS FROM 'examples/csv/products.csv' AS row RETURN row.name AS name, toFloat(row.price) AS price } RETURN name, price ORDER BY price"
```

**Aggregate from CSV data:**

```bash
gcyphrq -g examples/cloud-infra.json -e "LOAD CSV WITH HEADERS FROM 'examples/csv/orders.csv' AS row RETURN toInteger(row.orderId) AS orderId, toInteger(row.quantity) AS quantity"
```

**Filter CSV data with WHERE:**

```bash
gcyphrq -g examples/social-graph.json -e "LOAD CSV WITH HEADERS FROM 'examples/csv/products.csv' AS row WITH row WHERE toFloat(row.price) > 10 RETURN row.name AS product, toFloat(row.price) AS price"
```

See the [Query Guide — LOAD CSV]({{ '/query-guide/' | relative_url }}#load-csv) for full syntax reference, including `FIELDS TERMINATED BY` and `OPTIONALLY ENCLOSED BY`.

## Next Steps

- **[CLI Reference]({{ '/cli/' | relative_url }})** — Full documentation of CLI options and usage patterns
- **[Query Guide]({{ '/query-guide/' | relative_url }})** — Cypher syntax reference, supported features, and query patterns
- **[Library API]({{ '/library-api/' | relative_url }})** — Complete API reference for Node.js / TypeScript usage
- **[Examples]({{ '/examples/' | relative_url }})** — 30 ready-to-run queries with sample output
