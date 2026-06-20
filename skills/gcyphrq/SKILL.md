---
name: gcyphrq
description: "Use for querying graph data with Cypher — service dependencies, infrastructure topology, blast radius analysis, path tracing. Runs against JSON graph files with an in-memory Cypher engine supporting MATCH, OPTIONAL MATCH, WITH, aggregations, variable-length paths, and mutations."
---

# gcyphrq

Execute Cypher queries against in-memory graphs built from JSON files. The CLI tool is `gcyphrq`. Both `-e` (query) and `-g` (graph file or `-` for stdin) are required.

## Installation

### For Pi agents

Place this skill directory in one of Pi's skill locations:

```bash
# Global (available to all projects)
cp -r gcyphrq ~/.pi/agent/skills/gcyphrq

# Or project-level (available only in this project)
mkdir -p .pi/skills
cp -r gcyphrq .pi/skills/gcyphrq
```

Pi will auto-discover the skill and make it available as `/skill:gcyphrq`.

### Building the CLI tool

```bash
cd /path/to/gcyphrq
npm install
npm run build
```

The compiled binary is at `dist/index.js`. Add it to your PATH or run directly:

```bash
node /path/to/gcyphrq/dist/index.js -g examples/cloud-infra.json -e 'MATCH (n) RETURN n'
```

## Usage

```
gcyphrq [options]

Options:
  -e, --expr <query>   Cypher query expression (required)
  -g, --graph <file>   Path to a JSON graph file (required, or "-" for stdin)
  -h, --help           Show this help message
```

### Running from source (development)

```bash
npx tsx src/index.ts -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s'
```

### Running from build

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s'
```

### Piping from stdin

```bash
cat my-graph.json | gcyphrq -g - -e 'MATCH (n) RETURN n'
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
| Aggregations | `count()`, `sum()` | ✅ |
| `WHERE` on `WITH` | `WHERE c > 5` | ✅ |
| `WHERE` operators | `>`, `<`, `=`, `CONTAINS` | ✅ |
| `CREATE` nodes | `CREATE (n:Label {key: val})` | ✅ |
| `SET` properties | `SET n.prop = value` | ✅ |
| `DELETE` nodes | `DELETE n` | ✅ |
| Multiple chained MATCH | `MATCH (a) MATCH (b)` | ❌ single MATCH per stage |
| `ORDER BY`, `LIMIT` | parsed but not fully implemented | ⚠️ |
| Subqueries, `CALL`, APOC | — | ❌ |

## What This Skill Is For

Use this skill whenever the user asks about:

- **Service dependencies** — "What does the API Gateway depend on?"
- **Blast radius / impact analysis** — "If Kafka goes down, what breaks?"
- **Path tracing** — "Show me the path from the CDN to the database"
- **Infrastructure topology** — "How are services connected?"
- **Replication / failover** — "What's the replication setup?"
- **External dependencies** — "Which services call external APIs?"
- **Monitoring coverage** — "What's being monitored?"
- **Degree analysis** — "Which services have the most connections?"
- **Graph mutations** — "Add a new service", "Update a property"

## Graph Files Available

| File | Nodes | Edges | Description |
|---|---|---|---|
| `examples/social-graph.json` | 3 | 2 | Small social network (Alice, Bob, Charlie) |
| `examples/cloud-infra.json` | 52 | 110 | Full startup cloud infrastructure |

## Query Patterns for cloud-infra.json

See `references/queries.md` for detailed query examples organized by use case.

### Quick reference

```bash
# List all RPC services
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {type: "RPC"}) RETURN s'

# Trace API → databases (2-4 hops)
gcyphrq -g examples/cloud-infra.json -e 'MATCH (api:Service {name: "API Gateway"})-[r*2..4]->(db:Database) RETURN api, r, db'

# Services connected to PostgreSQL
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:TCP]->(db:Database {name: "PostgreSQL Primary"}) RETURN s'

# Consumers per message queue
gcyphrq -g examples/cloud-infra.json -e 'MATCH (mq:Infrastructure {type: "MessageQueue"})-[:TCP]->(w:Service) WITH mq, count(w) AS consumerCount RETURN mq, consumerCount'

# Blast radius of Kafka (2 hops)
gcyphrq -g examples/cloud-infra.json -e 'MATCH (kafka:Infrastructure {name: "Kafka Cluster"})-[r*1..2]-(affected) RETURN kafka, r, affected'

# External API dependencies
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {type: "RPC"})-[r*1..3]->(ext:External) RETURN s, ext'

# Replication topology
gcyphrq -g examples/cloud-infra.json -e 'MATCH (primary:Database)-[r:Replication]->(replica:Database) RETURN primary, r, replica'

# Services on primary EKS cluster
gcyphrq -g examples/cloud-infra.json -e 'MATCH (eks:Infrastructure {name: "EKS Cluster"})-[:Hosts]->(s:Service) RETURN s'

# Outgoing connections per service (> 2)
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[]->(target) WITH s, count(target) AS outDegree WHERE outDegree > 2 RETURN s, outDegree'
```

## Output Format

The tool outputs raw JSON — a JSON array of result objects. No prefixes, no markdown, no extra text. Stdout is pipe-friendly:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s.name' | jq '.[].s'
```

Errors go to stderr with `Error: ` prefix and exit code 1.

## Key Limitations

- **Single MATCH per stage** — the engine processes one MATCH clause at a time. Chained `MATCH (a) MATCH (b)` is not supported.
- **No subqueries** — `CALL {}`, APOC procedures, and other extensions are not available.
- **WHERE only on WITH** — `WHERE` filtering works in `WITH` clauses, not directly on `MATCH`.
- **Aggregations limited to count/sum** — `avg()`, `min()`, `max()` are not implemented.
- **Property access in RETURN** — returns the full node object or a single property. Nested property access beyond one level is not supported.
- **ORDER BY on RETURN and WITH** — `ORDER BY` is supported on both `RETURN` and `WITH` clauses. Multi-column sorting with ASC/DESC is supported.

## Architecture

```
src/
├── index.ts                 # CLI: arg parsing, graph loading, orchestration
├── engine/
│   ├── cypher-parser.ts     # ANTLR4 Cypher → AST (@neo4j-cypher/antlr4)
│   └── cypher-engine.ts     # AST execution on Graphology graphs
└── types/
    ├── cypher.ts            # AST types
    └── antlr4.d.ts          # ANTLR4 runtime declarations
```

## Building and Testing

```bash
npm run build    # Compile to dist/index.js (esbuild)
npm start        # Run from source (tsx)
npm test         # Run tests (vitest)
```
