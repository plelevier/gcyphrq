# gcyphrq

A command-line tool that executes [Cypher](https://en.wikipedia.org/wiki/Cypher_(query_language)) graph queries against an in-memory graph built on [Graphology](https://graphology.github.io/).

Parse a graph from a JSON file (or stdin), run a Cypher query, and get raw JSON results — all from the terminal.

## Features

- **Cypher query engine** — supports `MATCH`, `OPTIONAL MATCH`, `WITH`, `RETURN`, `CREATE`, `SET`, `DELETE`
- **Variable-length paths** — e.g. `-[r:FRIEND*1..3]->`
- **Aggregations** — `count()`, `sum()` with implicit grouping via `WITH`
- **Directional filtering** — `->`, `<-`, `-`
- **Raw JSON output** — pipe-friendly, works with `jq` and other CLI tools

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

- **[Query Guide](docs/QUERY-GUIDE.md)** — full Cypher syntax reference, supported features, and query examples
- **[Example Graphs](examples/README.md)** — graph file format and available examples

## Running without installing

You can also run the tool directly from the source without a global install:

```bash
npx tsx src/index.ts -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'
```

## Testing

```bash
npm test
```

## AI Agent Skill

This project includes a [skill](skills/gcyphrq/SKILL.md) that teaches AI agents how to use `gcyphrq` — supported Cypher features, query patterns, limitations, and ready-made examples against the bundled `cloud-infra.json` graph.

Install the skill so your AI agent knows how to query your graphs without you having to explain the syntax every time.

### pi

```bash
ln -s $(pwd)/skills/gcyphrq ~/.pi/agent/skills/gcyphrq
```

The skill is auto-discovered on next invocation.

### Claude Code

```bash
ln -s $(pwd)/skills/gcyphrq ~/.claude/skills/gcyphrq
```

Or point Claude to it directly from your project:

```bash
claude --skill skills/gcyphrq/SKILL.md
```

### OpenCode

```bash
ln -s $(pwd)/skills/gcyphrq ~/.opencode/skills/gcyphrq
```
