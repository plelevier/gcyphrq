# gcyphrq

A Cypher graph query engine for in-memory graphs built on [Graphology](https://graphology.github.io/).

Available as a **CLI tool** and as a **library** for Node.js / TypeScript projects.

📖 **[Documentation](https://plelevier.github.io/gcyphrq/)** — Getting Started, CLI Reference, Query Guide, Library API, and Examples

## Features

- **Cypher query engine** — supports `MATCH`, `OPTIONAL MATCH`, `WITH`, `RETURN`, `CREATE`, `SET`, `DELETE`
- **CALL { ... } subqueries** — inline subqueries with YIELD filtering, nested subqueries, and mutations inside
- **WHERE on MATCH and WITH** — filter with `>`, `>=`, `<`, `<=`, `=`, `<>`, `CONTAINS` plus `AND`, `OR`, `NOT`
- **CASE expressions** — conditional logic with `CASE WHEN ... THEN ...` and `CASE expr WHEN val THEN ...`
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
  -e, --expr <query>     Cypher query expression (required for queries)
  -g, --graph <file>     Path to a JSON graph file (or "-" to read from stdin)
  --format <graph|rows>  Output format: "graph" (default) or "rows"
  --install <mode>       Install the gcyphrq skill for AI coding agents. Mode: "global" (symlinks) or "local" (copies into current directory)
  -v, --version          Show version number
  -h, --help             Show this help message
```

## Graph File Format

Graphs use the [Graphology JSON format](https://graphology.github.io/). See [`examples/README.md`](examples/README.md) for the full specification and sample graphs.

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

## AI Agent Skill

This project includes a [skill](skills/gcyphrq/SKILL.md) that teaches AI agents how to use `gcyphrq` — supported Cypher features, query patterns, limitations, and ready-made examples against the bundled `cloud-infra.json` graph.

Install the skill so your AI agent knows how to query your graphs without you having to explain the syntax every time.

### Installing the Skill

The easiest way is to use the built-in install command. It detects your installed agents (pi, Claude Code, OpenCode) and installs the skill automatically:

```bash
# Install globally (symlinks in agent config directories)
gcyphrq --install global

# Install locally (copies into current directory)
gcyphrq --install local
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
