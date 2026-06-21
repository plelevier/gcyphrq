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
| `--install` | Install the gcyphrq skill for AI coding agents |
| `--global` | Install skill globally with symlinks (requires `--install`) |
| `--local` | Install skill per-project with copies (requires `--install`) |
| `-h, --help` | Show help message |

Either `-e` + `-g` (query mode) or `--install` + `--global`/`--local` (install mode) is required. These modes are mutually exclusive. The tool exits with code 1 and prints to stderr if no valid mode is provided.

## Loading a Graph

### From a file

```bash
gcyphrq -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'
```

### From stdin

```bash
cat my-graph.json | gcyphrq -g - -e 'MATCH (u:User) RETURN u'
```

## Output Format

The CLI outputs **raw JSON** — a JSON array of result objects with no prefixes, no markdown, and no extra text. Stdout is pipe-friendly for downstream tools like `jq`:

```bash
gcyphrq -g examples/social-graph.json -e 'MATCH (u:User) RETURN u.name' | jq '.[0].name'
```

## Error Handling

All errors are printed to **stderr** with an `Error: ` prefix, and the process exits with code 1:

```
Error: Invalid graph data: missing "nodes" array
```

This separation of stdout (results) and stderr (errors) ensures you can safely pipe results without capturing error messages.

## Common Patterns

### Quick inspection

List all nodes of a specific label:

```bash
gcyphrq -g graph.json -e 'MATCH (s:Service) RETURN s.name'
```

### Filter with WHERE (on MATCH)

```bash
gcyphrq -g graph.json -e 'MATCH (s:Service) WHERE s.type = "RPC" RETURN s.name'
```

### Filter with WHERE (on WITH)

```bash
gcyphrq -g graph.json -e 'MATCH (s:Service) WITH s WHERE s.name CONTAINS "api" RETURN s.name'
```

### WHERE with AND, OR, NOT

```bash
# AND — both conditions must be true
gcyphrq -g graph.json -e 'MATCH (s:Service) WHERE s.type = "RPC" AND s.name CONTAINS "Service" RETURN s.name'

# OR — either condition can be true
gcyphrq -g graph.json -e 'MATCH (s:Service) WHERE s.type = "RPC" OR s.type = "CDN" RETURN s.name'

# NOT — negate a condition
gcyphrq -g graph.json -e 'MATCH (s:Service) WHERE NOT s.type = "Batch" RETURN s.name'

# <> — not-equals
gcyphrq -g graph.json -e 'MATCH (s:Service) WHERE s.name <> "Old Service" RETURN s.name'
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

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Query executed successfully |
| `1` | Error (missing arguments, invalid graph, query parse error, etc.) |

## Installing the Skill

Install the gcyphrq skill for AI coding agents (pi, Claude Code, OpenCode):

```bash
# Install globally (symlinks in agent config directories)
gcyphrq --install --global

# Install locally (copies into project subdirectories)
gcyphrq --install --local
```

The `--install` command detects which agents are installed on your system and sets up the skill for each one. See the [Skill Guide](skill) for details.

## Running without installing

You can run the tool directly from source using `tsx`:

```bash
npx tsx src/index.ts -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'
```

## Next Steps

- **[Query Guide]({{ '/query-guide/' | relative_url }})** — Full Cypher syntax reference and query patterns
- **[Examples]({{ '/examples/' | relative_url }})** — Ready-to-run queries against the bundled graph files
