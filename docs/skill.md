---
layout: default
title: Skill Guide
description: Install the gcyphrq skill on AI coding agents and use it to query graphs with natural language.
---

<div class="breadcrumb">
  <a href="{{ '/' | relative_url }}">Home</a> <span>›</span> Skill Guide
</div>

# Skill Guide

The **gcyphrq skill** lets AI coding agents execute Cypher queries against JSON graph files using natural language prompts. Install it once, then ask questions like *"What services depend on the API Gateway?"* and get structured JSON results.

## What the Skill Does

When installed, the skill teaches an AI agent to:

- **Translate natural language** into Cypher queries automatically
- **Run queries** against your JSON graph files using the `gcyphrq` CLI
- **Interpret results** and present them in a readable format
- **Chain multiple queries** for complex analysis (blast radius, path tracing, degree analysis)

The skill includes a curated library of query patterns for common infrastructure questions — service dependencies, replication topology, monitoring coverage, and more.

## Installation

### Using the CLI (Recommended)

The easiest way is to use the built-in install command. It detects your installed agents (pi, Claude Code, OpenCode) and installs the skill automatically:

```bash
# Install globally (symlinks in agent config directories)
gcyphrq --install global

# Install locally (copies into current directory)
gcyphrq --install local
```

The `--install` command:
- Detects which agents are installed on your system
- Creates symlinks (global) or copies (local) the skill content
- Generates `CLAUDE.md` / `AGENTS.md` reference files for Claude Code and OpenCode
- Is idempotent — safe to run multiple times

After installation:
- **Pi** recognizes the skill automatically. Invoke with `/skill:gcyphrq` or describe what you want in natural language.
- **Claude Code** recognizes the skill automatically when you ask graph-related questions.
- **OpenCode** loads the skill when your prompts match its description (graph queries, infrastructure topology, service dependencies, etc.).

### Manual Installation

If the install command doesn't work for your setup, you can place the skill directory manually:

```bash
# pi
mkdir -p ~/.pi/agent/skills/gcyphrq
curl -sL https://raw.githubusercontent.com/plelevier/gcyphrq/main/skills/gcyphrq/SKILL.md \
  -o ~/.pi/agent/skills/gcyphrq/SKILL.md

# Claude Code
mkdir -p ~/.claude/skills/gcyphrq
curl -sL https://raw.githubusercontent.com/plelevier/gcyphrq/main/skills/gcyphrq/SKILL.md \
  -o ~/.claude/skills/gcyphrq/SKILL.md

# OpenCode
mkdir -p ~/.opencode/skills/gcyphrq
curl -sL https://raw.githubusercontent.com/plelevier/gcyphrq/main/skills/gcyphrq/SKILL.md \
  -o ~/.opencode/skills/gcyphrq/SKILL.md
```

You can also download the `references/` directory (containing `queries.md` and `example-graph.json`) into a `references/` subdirectory alongside `SKILL.md` for additional query patterns and a self-contained test graph.

### Other Agents

For any AI coding agent that supports custom instructions or system prompts:

1. **Install the CLI**: `npm install -g gcyphrq`
2. **Copy the SKILL.md** from `https://raw.githubusercontent.com/plelevier/gcyphrq/main/skills/gcyphrq/SKILL.md` into your agent's custom instructions
3. **Copy the reference files** from `https://raw.githubusercontent.com/plelevier/gcyphrq/main/skills/gcyphrq/references/` (containing `queries.md` and `example-graph.json`) into a `references/` subdirectory alongside SKILL.md
4. **Point to your graph files** — replace `<graph.json>` in skill examples with paths to your actual graph files

## Prerequisites

- **gcyphrq CLI** installed and on PATH — see [Getting Started](getting-started) for install instructions
- **A JSON graph file** to query (use the bundled `references/example-graph.json` to get started)

## Example Prompts

Once the skill is installed, you can use natural language prompts. Here are examples that the skill should resolve:

### Service Dependencies

> **Prompt:** "What services does the API Gateway depend on?"

The skill translates this to a Cypher query tracing outgoing connections from the API Gateway node.

> **Prompt:** "Show me all services connected to PostgreSQL."

Returns all services with TCP connections to the PostgreSQL Primary database.

### Blast Radius Analysis

> **Prompt:** "If Kafka goes down, what breaks?"

Traces all nodes reachable from the Kafka Cluster within 2 hops to show the impact radius.

> **Prompt:** "What's the blast radius if the API Gateway fails?"

Maps all downstream services and infrastructure affected by the API Gateway being unavailable.

### Path Tracing

> **Prompt:** "Show me the path from the CDN to the database."

Finds the connection path between the CDN and database nodes, showing intermediate services.

> **Prompt:** "How does a request flow from the API Gateway to the user database?"

Traces the request path through authentication, RPC services, and database connections.

### Infrastructure Topology

> **Prompt:** "How are the message queues connected?"

Lists all message queue infrastructure and their producer/consumer relationships.

> **Prompt:** "What's the replication setup for the databases?"

Shows primary-replica relationships and replication edge types.

### Degree Analysis

> **Prompt:** "Which service has the most outgoing connections?"

Computes out-degree for all services and returns the most connected one.

> **Prompt:** "Find services with more than 2 outgoing connections."

Filters services by out-degree threshold using aggregation and WHERE.

### Monitoring Coverage

> **Prompt:** "What services are being monitored?"

Finds all services connected to monitoring infrastructure (Prometheus, Grafana, etc.).

> **Prompt:** "Which services don't have monitoring?"

Uses OPTIONAL MATCH to find services without monitoring connections.

### External Dependencies

> **Prompt:** "Which services call external APIs?"

Traces RPC services through 1-3 hops to find external API dependencies.

> **Prompt:** "List all external integrations."

Returns all nodes with the External label and their upstream callers.

### Advanced Filtering

> **Prompt:** "Show me all RPC or Worker services."

Uses WHERE with OR to match multiple types.

> **Prompt:** "Find services that are not batch jobs."

Uses WHERE with NOT to exclude a type.

> **Prompt:** "List services in us-east-1 that have 'Service' in the name."

Uses WHERE with AND to combine conditions.

### Pagination

> **Prompt:** "Show me page 2 of services, 10 per page, sorted alphabetically."

Uses ORDER BY, SKIP, and LIMIT to paginate through service results.

### Graph Mutations

> **Prompt:** "Add a new monitoring service called 'Datadog'."

Uses CREATE to add a new node to the graph.

> **Prompt:** "Set the status of the API Gateway to 'deprecated'."

Uses SET to update a node property.

> **Prompt:** "Remove the 'Person' label from Alice."

Uses REMOVE to strip a label or remove a property from a node while keeping the node and its relationships intact.

## Skill Reference

The skill file (`SKILL.md`) includes:

- **CLI usage** — command syntax, options, stdin piping, chaining queries
- **Graph file format** — node and edge structure
- **Supported Cypher features** — full feature matrix with status
- **Query patterns** — pre-built queries using the bundled `references/example-graph.json`
- **Output format** — graph format (default) and rows format with chaining examples
- **Limitations** — known constraints (no subqueries, no APOC, etc.)

## Troubleshooting

| Issue | Solution |
|---|---|
| `gcyphrq: command not found` | Run `npm install -g gcyphrq` or `npm link` |
| Skill not detected by agent | Verify the `SKILL.md` is in the correct skill directory for your platform |
| Query returns empty results | Check that node labels and property names match your graph file exactly |

## Next Steps

- **[Getting Started]({{ '/getting-started/' | relative_url }})** — Install gcyphrq and run your first query
- **[Query Guide]({{ '/query-guide/' | relative_url }})** — Full Cypher syntax reference
- **[Examples]({{ '/examples/' | relative_url }})** — 30 ready-to-run queries with sample output
- **[Library API]({{ '/library-api/' | relative_url }})** — Use gcyphrq programmatically in Node.js / TypeScript
