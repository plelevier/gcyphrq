---
layout: default
title: CLI Reference
description: Command-line interface reference for gcyphrq.
---

<div class="breadcrumb">
  <a href="{{ '/' | relative_url }}">Home</a> <span>›</span> CLI Reference
</div>

# CLI Reference

The `gcyphrq` CLI executes Cypher graph queries against a JSON graph file and outputs raw JSON results to stdout.

## Usage

```bash
gcyphrq [options]
```

## Options

| Option | Description |
|---|---|
| `-e, --expr <query>` | Cypher query expression (**required** for queries) |
| `-g, --graph <file>` | Path to a JSON graph file, or `"-"` to read from stdin (**required** for queries) |
| `-nl, --node-label-property-name <prop>` | Node attribute key to use as Cypher label (default: `"label"`) |
| `-et, --edge-type-property-name <prop>` | Edge attribute key to use as Cypher relationship type (default: `"type"`) |
| `--format <graph\|rows>` | Output format: `graph` (default) or `rows`. Note: when returning only scalar values (property access, aggregations), the CLI auto-falls back to `rows` regardless of this setting |
| `--explain` | Show the query execution plan instead of executing. Does not require a graph file (`-g` is optional) |
| `--ext <name>` | Use a graph-input extension to parse the input file (e.g., `--ext gexf`) |
| `--ext-fn <name>` | Load a function extension (repeatable, e.g., `--ext-fn apoc-commons`) |
| `--list-extensions` | List all available extensions with descriptions |
| `--install-skill <mode>` | Install the gcyphrq skill for AI coding agents. Mode: `global` (symlinks) or `local` (copies into current directory) |
| `--no-cache` | Disable graph caching for input extensions (enabled by default) |
| `--pass-through` | Output the input graph as-is without executing a Cypher query. Requires `-g`, ignores `-e`. Useful with `--ext` to convert file formats to Graphology JSON |
| `-v, --version` | Show version number |
| `-h, --help` | Show help message |

Either `-e` + `-g` (query mode), `-g` + `--pass-through` (pass-through mode), or `--install-skill <mode>` (install mode) is required. These modes are mutually exclusive. The tool exits with code 1 and prints to stderr if no valid mode is provided.

## Loading a Graph

### From a file

```bash
gcyphrq -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'
```

### From stdin

```bash
cat my-graph.json | gcyphrq -g - -e 'MATCH (u:User) RETURN u'
```

### Graph file options

The JSON graph file supports an optional `options` field to configure graph behavior:

```json
{
  "options": {
    "type": "directed",
    "allowSelfLoops": true,
    "multi": true
  },
  "nodes": [...],
  "edges": [...]
}
```

| Option | Default | Description |
|---|---|---|
| `type` | `"directed"` | Graph directionality: `"directed"`, `"undirected"`, or `"mixed"` |
| `allowSelfLoops` | `false` | Enable edges where `source` equals `target` |
| `multi` | `false` | Enable parallel edges (multiple edges between the same nodes) |

## Output Format

The CLI outputs **raw JSON** with no prefixes, no markdown, and no extra text. Stdout is pipe-friendly for downstream tools like `jq`.

### Graph format (default)

By default, results are output as a [Graphology JSON graph](https://graphology.github.io/) — a `{nodes, edges}` structure that can be piped back into `gcyphrq` for chaining:

```bash
# Returns graph format — nodes and edges extracted from the result
$ gcyphrq -g graph.json -e 'MATCH (u:User) RETURN u'
{
  "nodes": [
    { "key": "alice", "attributes": { "label": "User", "name": "Alice" } },
    ...
  ],
  "edges": []
}
```

When the query returns only scalar values (property access, aggregations), the output falls back to rows format automatically:

```bash
# Returns rows — scalar values don't map to nodes/edges
$ gcyphrq -g graph.json -e 'MATCH (u:User) RETURN u.name'
[
  { "name": "Alice" },
  { "name": "Bob" }
]
```

### Rows format

Use `--format rows` to force the traditional row-based output (array of result objects). This is useful for downstream tools like `jq` that expect an array:

```bash
$ gcyphrq -g graph.json -e 'MATCH (u:User) RETURN u.name' --format rows
[
  { "name": "Alice" },
  { "name": "Bob" }
]
```

### Chaining queries

Graph format output can be piped to another `gcyphrq` invocation using `-g -` (stdin). This lets you build subgraphs and query them further:

```bash
# Step 1: extract all nodes
# Step 2: filter to Services only
# Step 3: filter to RPC services
# Step 4: return names as scalars (auto-falls back to rows)
gcyphrq -g graph.json -e 'MATCH (n) RETURN n' \
  | gcyphrq -g - -e 'MATCH (s:Service) RETURN s' \
  | gcyphrq -g - -e 'MATCH (s:Service {type: "RPC"}) RETURN s' \
  | gcyphrq -g - -e 'MATCH (s) RETURN s.name'
```

**Why graph format is the default:** The engine internally produces rows (one per match), but graph format is the natural *chaining* format — it produces a valid subgraph you can query further. Rows format is preserved via `--format rows` for cases where you need the full result set with variable bindings and row-level structure.

**What graph format preserves:**
- Unique nodes and edges from all result rows
- All node properties and edge attributes
- Edge `source`/`target` connection info

**What graph format loses (use `--format rows` instead):**
- Variable bindings (`a` vs `b` in `MATCH (a)-[]->(b) RETURN a, b`)
- Row cardinality and pairing (deduplication collapses duplicates)
- Path structure (variable-length path edges are flattened into a set)
- Aggregation results (`count()`, `avg()`, etc. — always returned as rows)

## Pass-Through Mode

Use `--pass-through` to output the input graph exactly as-is, without executing any Cypher query. This is useful for:

- **Converting file formats to Graphology JSON** — combine with `--ext` to parse non-JSON formats and output the normalized Graphology JSON
- **Validating graph structure** — ensures the graph is well-formed (valid nodes, edges, referential integrity)
- **Inspecting raw graph data** — view the exact Graphology JSON representation

```bash
# Convert a GEXF file to Graphology JSON
gcyphrq -g my-graph.gexf --ext gexf --pass-through > my-graph.json

# Validate and output a JSON graph as-is
gcyphrq -g my-graph.json --pass-through

# Convert from stdin (JSON only, no extension support with stdin)
cat my-graph.json | gcyphrq -g - --pass-through
```

### Pass-through with extensions

The `--pass-through` flag works with `--ext` to convert any supported file format to Graphology JSON:

```bash
# Convert GEXF → Graphology JSON
gcyphrq -g data.gexf --ext gexf --pass-through > data.json

# Then query the converted JSON
gcyphrq -g data.json -e 'MATCH (n) RETURN n'
```

### Pass-through validation rules

| Condition | Error |
|---|---|
| `--pass-through` without `-g` | "The --pass-through option requires -g/--graph" |
| `--pass-through` with `-e` | "--pass-through cannot be combined with -e/--expr" |
| `--pass-through` with `--explain` | "--pass-through cannot be combined with --explain" |
| `--pass-through` with `--ext-fn` | "--pass-through cannot be combined with --ext-fn" |
| `--pass-through --ext` with `-g -` (stdin) | "The --ext option cannot be used with stdin" |

## Explain Mode

Use `--explain` to show the query execution plan instead of executing the query. This is useful for debugging and understanding how a query will be processed.

```bash
gcyphrq --explain -e 'MATCH (u:User)-[r:FRIEND]->(f:User) RETURN u, f'
```

Output is a JSON object with:
- `query` — the original query string
- `stages` — array of query stages (MATCH, WITH, RETURN, etc.) with their type, description, variables, and details
- `finalVariables` — variables bound at the end of the query
- `union` — `true` if this is a UNION query

No graph file is required (`-g` is optional in explain mode):

```bash
gcyphrq --explain -e 'MATCH (u:User) RETURN u'
```

## Error Handling

All errors are printed to **stderr** with an `Error: ` prefix, and the process exits with code 1:

```
Error: Invalid graph data: missing "nodes" array
```

This separation of stdout (results) and stderr (errors) ensures you can safely pipe results without capturing error messages.

## Common Patterns

### Quick inspection

List all nodes of a specific label (returns graph format):

```bash
gcyphrq -g graph.json -e 'MATCH (s:Service) RETURN s'
```

Return scalar properties (auto-falls back to rows format):

```bash
gcyphrq -g graph.json -e 'MATCH (s:Service) RETURN s.name'
```

### Filter with WHERE

See the [Query Guide — WHERE](query-guide) for the full reference (AND, OR, NOT, IS NULL, etc.).

```bash
gcyphrq -g graph.json -e 'MATCH (s:Service) WHERE s.type = "RPC" AND s.name CONTAINS "Service" RETURN s.name'
```

### Aggregation

```bash
gcyphrq -g graph.json -e 'MATCH (n) RETURN count(n) AS totalNodes'
```

### Top-N with ORDER BY + LIMIT

```bash
gcyphrq -g graph.json -e 'MATCH (s:Service)-[]->(t) WITH s, count(t) AS outDegree ORDER BY outDegree DESC LIMIT 3 RETURN s.name, outDegree'
```

### Variable-length paths

```bash
gcyphrq -g graph.json -e 'MATCH (a:Service {name: "API Gateway"})-[r*1..3]->(b) RETURN a, r, b'
```

Unbounded patterns (`[*1..]`) default to a max depth of 10 and a path limit of 100,000. Use explicit bounds (e.g., `[*1..10]`) in your query to avoid truncation. To adjust the defaults, use the [library API](library-api) with `config.maxVariableLengthDepth` / `config.maxVariableLengthPaths`.

### Import from CSV

Load data from a CSV file and create nodes:

```bash
gcyphrq -g graph.json -e "LOAD CSV WITH HEADERS FROM 'data.csv' AS row CREATE (n:Person {name: row.name}) RETURN n.name"
```

## Extensions

gcyphrq supports pluggable extensions for non-JSON input formats and custom functions. Extensions are independent npm packages published under the `gcyphrq-ext-*` naming convention.

> See the [Available Extensions]({{ '/extensions/' | relative_url }}#available-extensions) table for a list of published extensions.

### Installing Extensions

Install extensions like any other npm package. Use local install for project-specific extensions or global install for system-wide availability:

```bash
# Install locally (in current project's node_modules)
npm install gcyphrq-ext-<name>

# Install globally (available from any directory)
npm install -g gcyphrq-ext-<name>
```

Extensions are discovered from both local and global `node_modules` directories.

### Listing Extensions

```bash
gcyphrq --list-extensions
```

### Graph-Input Extensions

Use `--ext <name>` to parse non-JSON input files:

```bash
# Parse a GEXF file
gcyphrq -g my-graph.gexf --ext gexf -e 'MATCH (n) RETURN n'
```

### Function Extensions

Use `--ext-fn <name>` to load custom Cypher functions (repeatable):

```bash
# Use APOC-like functions
gcyphrq -g graph.json --ext-fn apoc-commons -e 'RETURN apoc.text.capitalize("hello")'

# Multiple function extensions
gcyphrq -g graph.json --ext-fn apoc-commons --ext-fn apoc-crypto -e 'RETURN apoc.text.join(", ", ["a","b"])'
```

### Combined Usage

Graph-input and function extensions can be combined:

```bash
gcyphrq -g my-graph.gexf --ext gexf --ext-fn apoc-commons -e 'MATCH (n) RETURN apoc.text.capitalize(n.name)'
```

### Validation Rules

| Condition | Error |
|---|---|
| `--ext` without `-g` | "The --ext option requires -g/--graph" |
| `--ext` with `-g -` (stdin) | "The --ext option cannot be used with stdin" |
| `--ext` with `--explain` | "The --ext option cannot be used with --explain" |
| `--ext-fn` with `--explain` | "The --ext-fn option cannot be used with --explain" |
| Extension not found | "Extension 'X' not found. Available: ..." |
| Extension type mismatch | "Extension 'X' is a function extension, not a graph-input extension" |

See [Extensions Guide]({{ '/extensions/' | relative_url }}) for creating your own extensions.

## Graph Caching

When using a graph-input extension (`--ext`), gcyphrq automatically caches the parsed graph on disk. Subsequent runs against the same file skip the (potentially expensive) parsing step and load the cached result instead.

The cache is invalidated automatically when the input file is modified (detected via file mtime and size).

### Cache behaviour

- **Enabled by default** when `--ext` is used. No effect for plain JSON input (no extension).
- **Maximum 10 cached graphs** stored on disk. The least-recently-used entry is evicted when a new entry is added.
- **Cache directory**: `~/.cache/gcyphrq/graphs/` on Linux/macOS, `%LOCALAPPDATA%/gcyphrq/cache/graphs` on Windows. Override the base directory (`~/.cache/gcyphrq` / `%LOCALAPPDATA%/gcyphrq/cache`) with the `GCYPHRQ_CACHE_DIR` environment variable.
- **Per-extension control**: Extension authors can set `cacheable: false` in their manifest to disable caching for their format.

### Disabling the cache

```bash
# Disable caching for this invocation
gcyphrq -g data.gexf --ext gexf --no-cache -e 'MATCH (n) RETURN n'
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Query executed successfully |
| `1` | Error (missing arguments, invalid graph, query parse error, etc.) |

## Installing the Skill

Install the gcyphrq skill for AI coding agents (pi, Claude Code, OpenCode):

```bash
# Install globally (symlinks in agent config directories)
gcyphrq --install-skill global

# Install locally (copies into current directory)
gcyphrq --install-skill local
```

The `--install-skill` command detects which agents are installed on your system and sets up the skill for each one. See the [Skill Guide](skill) for details.

## Running without installing

You can run the tool directly from source using `tsx`:

```bash
npx tsx src/index.ts -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'
```

## Next Steps

- **[Query Guide]({{ '/query-guide/' | relative_url }})** — Full Cypher syntax reference and query patterns
- **[Examples]({{ '/examples/' | relative_url }})** — Ready-to-run queries against the bundled graph files
