# gcyphrq

A Cypher graph query engine for in-memory graphs built on [Graphology](https://graphology.github.io/).

Available as a **CLI tool** and as a **library** for Node.js / TypeScript projects.

## Features

- **Cypher query engine** — supports `MATCH`, `OPTIONAL MATCH`, `WITH`, `RETURN`, `CREATE`, `SET`, `DELETE`
- **WHERE on MATCH and WITH** — filter with `>`, `<`, `=`, `<>`, `CONTAINS` plus `AND`, `OR`, `NOT`
- **Variable-length paths** — e.g. `-[r:FRIEND*1..3]->`
- **Aggregations** — `count()`, `sum()`, `avg()`, `min()`, `max()` with implicit grouping via `WITH`
- **Directional filtering** — `->`, `<-`, `-`
- **Library or CLI** — use as a dependency in your project or run from the terminal
- **TypeScript support** — full type declarations shipped with the package

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Link globally so `gcyphrq` is available everywhere
npm link
```

## Quick Start

```bash
# Load a graph from a JSON file
gcyphrq -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'

# Pipe a graph from stdin
cat my-graph.json | gcyphrq -g - -e 'MATCH (u:User) RETURN u'
```

## Usage

```
Usage: gcyphrq [options]

Options:
  -e, --expr <query>   Cypher query expression (required)
  -g, --graph <file>   Path to a JSON graph file (or "-" to read from stdin)
  -h, --help           Show this help message
```

## Graph File Format

Graphs are described as JSON files with two arrays:

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

This format follows the [Graphology](https://graphology.github.io/) project's JSON representation for graphs.

See the [`examples/`](examples/) directory for sample graphs.

## Documentation

📖 **[Full documentation](https://plelevier.github.io/gcyphrq/)** — Getting Started, CLI Reference, Query Guide, Library API, and Examples

Local docs (source):
- **[Library API](docs/library-api.md)** — how to use gcyphrq as a library (Node.js / TypeScript)
- **[Query Guide](docs/query-guide.md)** — full Cypher syntax reference, supported features, and query examples
- **[Example Graphs](examples/README.md)** — graph file format and available examples

## Using as a Library

Install gcyphrq as a dependency:

```bash
npm install gcyphrq
```

### One-shot query

```ts
import { executeQuery } from 'gcyphrq';

const results = executeQuery(graphData, 'MATCH (u:User) RETURN u.name');
```

### Multiple queries on the same graph

```ts
import { createGraph, GraphEngine, parseCypher } from 'gcyphrq';

const graph = createGraph(graphData);
const engine = new GraphEngine(graph);

const users = engine.execute(parseCypher('MATCH (u:User) RETURN u.name'));
const counts = engine.execute(parseCypher('MATCH (u:User) RETURN count(u)'));
```

### Building a graph programmatically

```ts
import { Graph, GraphEngine, parseCypher } from 'gcyphrq';

const graph = new Graph();
graph.addNode('alice', { label: 'User', name: 'Alice' });
graph.addNode('bob', { label: 'User', name: 'Bob' });
graph.addEdge('alice', 'bob', { type: 'FRIEND' });

const engine = new GraphEngine(graph);
const results = engine.execute(parseCypher('MATCH (u:User) RETURN u.name'));
```

See the [Library API documentation](https://plelevier.github.io/gcyphrq/library-api/) for the full reference.

## Running without installing

You can also run the tool directly from the source without a global install:

```bash
npx tsx src/index.ts -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'
```

## Testing

```bash
npm test
```

## Benchmarking

The `bench.ts` script measures query performance with and without pre-computed indexes:

```bash
# Default: 5 queries against examples/cloud-infra.json
npx tsx bench.ts

# Different graph
npx tsx bench.ts -g examples/social-graph.json

# Custom queries
npx tsx bench.ts -q 'MATCH (s:Service) RETURN s' 'MATCH (n) RETURN count(n) AS total'
```

See the [Benchmark documentation](docs/benchmark.md) for details on output format and interpretation.

## AI Agent Skill

This project includes a [skill](skills/gcyphrq/SKILL.md) that teaches AI agents how to use `gcyphrq` — supported Cypher features, query patterns, limitations, and ready-made examples against the bundled `cloud-infra.json` graph.

Install the skill so your AI agent knows how to query your graphs without you having to explain the syntax every time.

### Installing the Skill

The easiest way is to use the built-in install command. It detects your installed agents (pi, Claude Code, OpenCode) and installs the skill automatically:

```bash
# Install globally (symlinks in agent config directories)
gcyphrq --install --global

# Install locally (copies into project subdirectories)
gcyphrq --install --local
```

The `--install` command detects which agents are installed on your system and sets up the skill for each one. For Claude Code and OpenCode it also generates the `CLAUDE.md` / `AGENTS.md` reference files.

### Manual Installation

If the install command doesn't work for your setup, you can place the skill directory manually:

```bash
# pi
ln -s $(pwd)/skills/gcyphrq ~/.pi/agent/skills/gcyphrq

# Claude Code
ln -s $(pwd)/skills/gcyphrq ~/.claude/skills/gcyphrq

# OpenCode
ln -s $(pwd)/skills/gcyphrq ~/.opencode/skills/gcyphrq
```

The skill is auto-discovered on next invocation.
