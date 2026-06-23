---
layout: default
title: Home
description: A Cypher graph query engine for in-memory graphs built on Graphology.
---

<div class="hero">
  <h1>gcyphrq</h1>
  <p class="tagline">A Cypher graph query engine for in-memory graphs. Parse a graph from JSON, run a Cypher query, get raw JSON results.</p>
  <div class="hero-actions">
    <a href="{{ '/getting-started/' | relative_url }}" class="btn btn-primary">Getting Started →</a>
    <a href="https://github.com/plelevier/gcyphrq" class="btn btn-secondary" target="_blank" rel="noopener noreferrer">View on GitHub ↗</a>
  </div>
</div>

<div class="feature-grid">
  <div class="feature-card">
    <h3>🔍 Cypher Queries</h3>
    <p>Full support for <code>MATCH</code>, <code>OPTIONAL MATCH</code>, <code>WHERE</code>, <code>WITH</code>, <code>RETURN</code>, <code>ORDER BY</code>, <code>SKIP</code>, <code>LIMIT</code>, and mutations.</p>
  </div>
  <div class="feature-card">
    <h3>📐 Variable-Length Paths</h3>
    <p>Traverse graphs with variable-depth paths like <code>-[r:FRIEND*1..3]-</code> to explore connections at any depth.</p>
  </div>
  <div class="feature-card">
    <h3>📦 CLI &amp; Library</h3>
    <p>Use as a CLI tool for quick queries or import as a TypeScript/Node.js library in your projects.</p>
  </div>
  <div class="feature-card">
    <h3>📊 Aggregations</h3>
    <p>Group and aggregate with <code>count()</code>, <code>sum()</code>, <code>avg()</code>, <code>min()</code>, <code>max()</code> and implicit grouping via <code>WITH</code> pipelining.</p>
  </div>
  <div class="feature-card">
    <h3>✏️ Mutations</h3>
    <p>Create, update, delete, and remove labels or properties with <code>CREATE</code>, <code>SET</code>, <code>DELETE</code>, and <code>REMOVE</code> clauses.</p>
  </div>
  <div class="feature-card">
    <h3>🔧 TypeScript</h3>
    <p>Full type declarations shipped with the package. Works seamlessly in TypeScript projects.</p>
  </div>
</div>

---

## Quick Start

Install and run your first query in seconds:

```bash
# Install globally
npm install -g gcyphrq

# Run a query against a JSON graph
gcyphrq -g my-graph.json -e 'MATCH (u:User) RETURN u.name'
```

Or use it as a library:

```ts
import { executeQuery } from 'gcyphrq';

const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name');
```

## Supported Cypher Features

| Feature | Status |
|---|---|
| `MATCH` with node labels and properties | <span class="badge badge-success">✅</span> |
| Variable-length paths `*min..max` | <span class="badge badge-success">✅</span> |
| Directional edges `->`, `<-`, `-` | <span class="badge badge-success">✅</span> |
| `OPTIONAL MATCH` | <span class="badge badge-success">✅</span> |
| `RETURN` with aliases | <span class="badge badge-success">✅</span> |
| `WITH` + implicit grouping | <span class="badge badge-success">✅</span> |
| `count()`, `sum()`, `avg()`, `min()`, `max()` aggregations | <span class="badge badge-success">✅</span> |
| `WHERE` (on `MATCH` and `WITH`) | <span class="badge badge-success">✅</span> |
| `WHERE` operators: `>`, `<`, `=`, `<>`, `CONTAINS` | <span class="badge badge-success">✅</span> |
| `WHERE` logical operators: `AND`, `OR`, `NOT` | <span class="badge badge-success">✅</span> |
| `WHERE` IS NULL / IS NOT NULL | <span class="badge badge-success">✅</span> |
| `CREATE`, `SET`, `DELETE`, `REMOVE` mutations | <span class="badge badge-success">✅</span> |
| `ORDER BY` (single/multi-column) | <span class="badge badge-success">✅</span> |
| `SKIP` / `LIMIT` | <span class="badge badge-success">✅</span> |
| Subqueries, `CALL`, APOC | <span class="badge badge-danger">❌</span> |

## Example Graphs

Two example graphs are bundled with the package:

- **`social-graph.json`** — A small social network with three users connected by `FRIEND` relationships
- **`cloud-infra.json`** — A full startup cloud infrastructure with 51 nodes and 142 edges

See the [Examples](examples) page for 30 ready-to-run queries with sample output.
