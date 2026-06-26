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

Import CSV data into your graph and query it with Cypher. Example CSV files are bundled in `examples/csv/`.

### The CSV files

`examples/csv/services.csv` — A microservice topology (nodes):

```
name,type,team,status
api-gateway,service,platform,active
user-service,service,identity,active
order-service,service,commerce,active
payment-service,service,payments,active
inventory-service,service,commerce,active
notification-service,service,platform,active
postgres-db,database,platform,active
redis-cache,cache,platform,active
sqs-queue,queue,platform,active
```

`examples/csv/dependencies.csv` — Service-to-service call dependencies (edges):

```
source,target,protocol,latency_ms
api-gateway,user-service,http,12
api-gateway,order-service,http,24
api-gateway,inventory-service,http,8
order-service,payment-service,gRPC,45
order-service,inventory-service,gRPC,15
order-service,notification-service,async,5
payment-service,postgres-db,tcp,3
inventory-service,redis-cache,tcp,1
inventory-service,postgres-db,tcp,4
notification-service,sqs-queue,tcp,2
```

### Import nodes from CSV

Create a `Service` node for each row in the CSV:

```bash
gcyphrq -g examples/social-graph.json -e "LOAD CSV WITH HEADERS FROM 'examples/csv/services.csv' AS row CREATE (:Service {name: row.name, type: row.type, team: row.team, status: row.status}) RETURN row.name AS imported, row.type AS type"
```

### Query and transform CSV data

Use LOAD CSV to read, filter, and aggregate data without creating nodes:

```bash
# Filter services by team
gcyphrq -g examples/social-graph.json -e "LOAD CSV WITH HEADERS FROM 'examples/csv/services.csv' AS row WITH row WHERE row.team = 'platform' RETURN row.name AS service, row.type AS type"

# Count dependencies by protocol
gcyphrq -g examples/social-graph.json -e "LOAD CSV WITH HEADERS FROM 'examples/csv/dependencies.csv' AS row WITH row.protocol AS protocol, count(*) AS calls RETURN protocol, calls ORDER BY calls DESC"
```

See the [Query Guide — LOAD CSV]({{ '/query-guide/' | relative_url }}#load-csv) for full syntax reference, including `FIELDS TERMINATED BY` and `OPTIONALLY ENCLOSED BY`.

## Next Steps

- **[CLI Reference]({{ '/cli/' | relative_url }})** — Full documentation of CLI options and usage patterns
- **[Query Guide]({{ '/query-guide/' | relative_url }})** — Cypher syntax reference, supported features, and query patterns
- **[Library API]({{ '/library-api/' | relative_url }})** — Complete API reference for Node.js / TypeScript usage
- **[Examples]({{ '/examples/' | relative_url }})** — 30 ready-to-run queries with sample output
