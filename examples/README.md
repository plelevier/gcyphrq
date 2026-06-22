# gcyphrq — Example Graphs

This directory contains example graph files you can use with `gcyphrq`.

Each file uses the [Graphology JSON format](https://graphology.github.io/):

```json
{
  "nodes": [
    { "key": "<node-id>", "attributes": { "label": "<label>", "<property>": "<value>", ... } }
  ],
  "edges": [
    { "source": "<source-id>", "target": "<target-id>", "attributes": { "type": "<edge-type>", ... } }
  ]
}
```

- **`nodes[].key`** — required, unique node identifier
- **`nodes[].attributes`** — required, node properties (`label` used for Cypher label filtering)
- **`edges[].source` / `edges[].target`** — required, node keys
- **`edges[].attributes`** — required, edge properties (`type` used for Cypher relationship filtering)
- **`options`** — optional, graph-level settings (only `type: "directed"` is supported;
  `allowSelfLoops: true` and `multi: true` will cause an error)

The `options` field can be omitted — gcyphrq always builds a directed graph.

## Available examples

| File | Description |
|---|---|
| `team.json` | A small team graph — 6 nodes, 6 edges — used in the [Examples page](https://plelevier.github.io/gcyphrq/examples/) |
| `social-graph.json` | A small social network with three users connected by `FRIEND` relationships |
| `cloud-infra.json` | A full startup cloud infrastructure — 51 nodes, 142 edges — with RPC services, message queues, databases, workers, monitoring, and external APIs |

## Usage

```bash
# Load a graph from file
gcyphrq -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'

# Pipe a graph from stdin
cat examples/social-graph.json | gcyphrq -g - -e 'MATCH (u:User) RETURN u'
```

## Query Examples

See the [Examples page](https://plelevier.github.io/gcyphrq/examples/) for 30 ready-to-run queries with sample output, covering:

- Node and relationship matching with labels, properties, and variable-length paths
- Aggregations (`count()`, `sum()`, `avg()`, `min()`, `max()`)
- Filtering with `WHERE` (`AND`, `OR`, `NOT`, `CONTAINS`, `IS NULL`)
- Sorting with `ORDER BY` and pagination with `SKIP` / `LIMIT`
- Blast radius analysis, dependency chains, and infrastructure topology queries
