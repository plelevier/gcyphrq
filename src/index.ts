import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GraphError, createGraph, parseCypher, GraphEngine, buildGraphIndexes } from './lib';
import type { GraphInput } from './lib';
import { runInstall } from './install';

declare const __VERSION__: string;

// ── Version (injected at build time via esbuild define, fallback for dev) ──

const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'undefined';

// ── CLI Help ─────────────────────────────────────────────────────────────────

const HELP_TEXT = `
Usage: gcyphrq [options]

A graph query tool that executes Cypher queries against an in-memory graph.

Options:
  -e, --expr <query>     Cypher query expression (required)
  -g, --graph <file>     Path to a JSON graph file (required, or "-" to read from stdin)
  -nl, --node-label-property-name <prop>    Node attribute key to use as Cypher label (default: "label")
  -et, --edge-type-property-name <prop>     Edge attribute key to use as Cypher relationship type (default: "type")
  --format <graph|rows>  Output format: "graph" (Graphology JSON, default) or "rows" (result rows)
  --install <mode>       Install the gcyphrq skill for AI coding agents. Mode: "global" (symlinks) or "local" (copies into current directory)
  -v, --version          Show version number
  -h, --help             Show this help message

Graph file format (Graphology JSON):
  {
    "nodes": [
      { "key": "<id>", "attributes": { "label": "<label>", ... } }
    ],
    "edges": [
      { "source": "<id>", "target": "<id>", "attributes": { "type": "<type>", ... } }
    ]
  }

  Optional "options" field (type: "directed", "undirected", or "mixed"):
    "options": { "type": "directed", "allowSelfLoops": true, "multi": true }

  Note: "allowSelfLoops" must be true to create or load self-loop edges (source = target).
  Note: "multi" must be true to allow parallel edges (multiple edges between same nodes).

Examples:
  gcyphrq -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'
  gcyphrq --graph examples/social-graph.json --expr 'MATCH (u:User {name: "Alice"})-[r:FRIEND*1..2]->(f:User) RETURN u, f'
  gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {type: "RPC"}) RETURN s.name'
  gcyphrq -g my-graph.json -nl kind -et rel -e 'MATCH (n:Service) RETURN n'
  cat my-graph.json | gcyphrq -g - -e 'MATCH (n) RETURN n'
  gcyphrq --install global      # Install skill globally (symlinks)
  gcyphrq --install local       # Install skill in current project (copies)
`;

function printHelp(): void {
  process.stdout.write(HELP_TEXT.trimStart() + '\n');
}

function printError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}

// ── Argument Parsing ─────────────────────────────────────────────────────────

type ParsedArgs = {
  expr: string | undefined;
  graph: string | undefined;
  labelProperty: string | undefined;
  edgeTypeProperty: string | undefined;
  format: 'graph' | 'rows' | undefined;
  help: boolean;
  version: boolean;
  install: 'global' | 'local' | undefined;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { expr: undefined, graph: undefined, labelProperty: undefined, edgeTypeProperty: undefined, format: undefined, help: false, version: false, install: undefined };
  let exprFlag: string | null = null;
  let graphFlag: string | null = null;
  let labelFlag: string | null = null;
  let typeFlag: string | null = null;
  let formatFlag: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;

    if (arg === '-v' || arg === '--version') {
      args.version = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      args.help = true;
      continue;
    }

    if (arg === '--install') {
      if (i + 1 >= argv.length) {
        throw new GraphError('The --install option requires a value ("global" or "local").');
      }
      const mode = argv[++i]!;
      if (mode !== 'global' && mode !== 'local') {
        throw new GraphError(`Invalid install mode "${mode}". Must be "global" or "local".`);
      }
      args.install = mode;
      continue;
    }

    if (arg === '-e' || arg === '--expr') {
      if (i + 1 >= argv.length) {
        throw new GraphError(`The ${arg} option requires a value.`);
      }
      if (exprFlag) {
        throw new GraphError(`The option "${arg}" was provided multiple times. Use it only once.`);
      }
      exprFlag = arg;
      args.expr = argv[++i]!;
      continue;
    }

    if (arg === '-g' || arg === '--graph') {
      if (i + 1 >= argv.length) {
        throw new GraphError(`The ${arg} option requires a value.`);
      }
      if (graphFlag) {
        throw new GraphError(`The option "${arg}" was provided multiple times. Use it only once.`);
      }
      graphFlag = arg;
      args.graph = argv[++i]!;
      continue;
    }

    if (arg === '-nl' || arg === '--node-label-property-name') {
      if (i + 1 >= argv.length) {
        throw new GraphError(`The ${arg} option requires a value.`);
      }
      if (labelFlag) {
        throw new GraphError(`The option "${arg}" was provided multiple times. Use it only once.`);
      }
      labelFlag = arg;
      args.labelProperty = argv[++i]!;
      continue;
    }

    if (arg === '-et' || arg === '--edge-type-property-name') {
      if (i + 1 >= argv.length) {
        throw new GraphError(`The ${arg} option requires a value.`);
      }
      if (typeFlag) {
        throw new GraphError(`The option "${arg}" was provided multiple times. Use it only once.`);
      }
      typeFlag = arg;
      args.edgeTypeProperty = argv[++i]!;
      continue;
    }

    if (arg === '--format') {
      if (i + 1 >= argv.length) {
        throw new GraphError(`The ${arg} option requires a value ("graph" or "rows").`);
      }
      if (formatFlag) {
        throw new GraphError(`The option "${arg}" was provided multiple times. Use it only once.`);
      }
      formatFlag = arg;
      const formatValue = argv[++i]!;
      if (formatValue !== 'graph' && formatValue !== 'rows') {
        throw new GraphError(`Invalid format "${formatValue}". Must be "graph" or "rows".`);
      }
      args.format = formatValue;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new GraphError(`Unknown option "${arg}".\n\nUse "gcyphrq --help" for usage information.`);
    }
  }

  return args;
}

// ── Results → Graphology graph conversion ────────────────────────────────────

/**
 * Convert query result rows into a Graphology JSON graph.
 *
 * Collects all unique nodes and edges from result rows and outputs them
 * in Graphology format so the output can be piped back into gcyphrq.
 *
 * Nodes: { id, ...props } → { key: id, attributes: { ...props } }
 * Edges: { id, source, target, type, ...props } → { key: id, source, target, attributes: { type, ...props } }
 *
 * Optionally preserves root-level options/attributes.
 *
 * @param userEdgeKeys - Set of edge IDs that were user-provided (not auto-generated).
 *   Used to determine which edges should carry a `key` in the output.
 */
function resultsToGraph(
  rows: Record<string, unknown>[],
  userEdgeKeys: Set<string>,
  opts?: {
    rootOptions?: NonNullable<GraphInput['options']>;
    rootAttributes?: NonNullable<GraphInput['attributes']>;
  },
): {
  options?: NonNullable<GraphInput['options']>;
  attributes?: NonNullable<GraphInput['attributes']>;
  nodes: Array<{ key: string; attributes: Record<string, unknown> }>;
  edges: Array<{ key?: string; source: string; target: string; attributes: Record<string, unknown> }>;
  _hasGraphData: boolean;
} {
  const nodeMap = new Map<string, Record<string, unknown>>();
  const edgeMap = new Map<string, { key?: string; source: string; target: string; attributes: Record<string, unknown> }>();

  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (value === null || value === undefined) continue;

      // Nodes: objects with "id" that are not arrays
      if (typeof value === 'object' && !Array.isArray(value) && 'id' in value) {
        const node = value as Record<string, unknown>;
        const id = node.id as string;
        if (typeof id === 'string' && !nodeMap.has(id)) {
          const { id: _, ...attrs } = node;
          nodeMap.set(id, attrs);
        }
        continue;
      }

      // Edges: arrays of edge objects (variable-length paths)
      if (Array.isArray(value)) {
        for (const edge of value) {
          if (edge && typeof edge === 'object' && 'id' in edge && 'source' in edge && 'target' in edge) {
            const e = edge as Record<string, unknown>;
            const eid = e.id as string;
            const source = e.source as string;
            const target = e.target as string;
            if (typeof eid === 'string' && !edgeMap.has(eid)) {
              const { id: _eid, source: _src, target: _tgt, ...attrs } = e;
              const entry: { key?: string; source: string; target: string; attributes: Record<string, unknown> } = {
                source,
                target,
                attributes: attrs,
              };
              // Include key only for edges that had a user-provided key
              if (userEdgeKeys.has(eid)) {
                entry.key = eid;
              }
              edgeMap.set(eid, entry);
            }
          }
        }
      }
    }
  }

  const nodes = [...nodeMap.entries()].map(([key, attributes]) => ({ key, attributes }));
  const edges = [...edgeMap.values()].map((entry) => {
    const { key, source, target, attributes } = entry;
    return key !== undefined ? { key, source, target, attributes } : { source, target, attributes };
  });

  const result: { options?: NonNullable<GraphInput['options']>; attributes?: NonNullable<GraphInput['attributes']>; nodes: typeof nodes; edges: typeof edges; _hasGraphData: boolean } = {
    nodes,
    edges,
    _hasGraphData: nodeMap.size > 0 || edgeMap.size > 0,
  };

  if (opts?.rootOptions) result.options = opts.rootOptions;
  if (opts?.rootAttributes) result.attributes = opts.rootAttributes;

  return result;
}

// ── Graph Loading ────────────────────────────────────────────────────────────

async function readJsonFile(source: 'file' | 'stdin', path?: string): Promise<GraphInput> {
  let content: string;
  if (source === 'file') {
    try {
      content = readFileSync(resolve(path!), 'utf-8');
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        throw new GraphError(`Graph file not found: ${path}`);
      }
      throw new GraphError(`Failed to read graph: ${error.message}`);
    }
  } else {
    if (process.stdin.isTTY) {
      throw new GraphError('No input received on stdin. Pipe a JSON graph file or use -g <file>.');
    }
    // Read entire stdin via event listeners (reliable across all platforms)
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
      process.stdin.on('end', () => resolve());
      process.stdin.on('error', reject);
    });
    content = Buffer.concat(chunks).toString('utf-8');
  }
  if (!content.trim()) {
    throw new GraphError('Empty input received. Pipe a JSON graph file or use -g <file>.');
  }
  try {
    return JSON.parse(content);
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new GraphError(`Invalid JSON: ${err.message}`);
    }
    throw new GraphError(`Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.version) {
      process.stdout.write(`${VERSION}\n`);
      process.exit(0);
    }

    if (args.help) {
      printHelp();
      process.exit(0);
    }

    // ── Install command ────────────────────────────────────────────────

    if (args.install) {
      if (args.expr || args.graph) {
        throw new GraphError('--install cannot be combined with -e/--expr or -g/--graph.');
      }

      await runInstall(args.install, process.cwd());
      process.exit(0);
    }

    // ── Query execution ────────────────────────────────────────────────

    if (!args.expr) {
      throw new GraphError('Missing required option: -e, --expr <query>\n\nUse "gcyphrq --help" for usage information.');
    }

    if (!args.graph) {
      throw new GraphError('Missing required option: -g, --graph <file>\n\nUse "gcyphrq --help" for usage information.');
    }

    // Load graph data
    const graphData = args.graph === '-'
      ? await readJsonFile('stdin')
      : await readJsonFile('file', args.graph);

    // Collect user-provided edge keys for round-trip preservation
    const userEdgeKeys = new Set(
      Array.isArray(graphData.edges)
        ? graphData.edges.filter((e: any) => typeof e?.key === 'string').map((e: any) => e.key as string)
        : [],
    );

    // Build graph, indexes, and execute query using the library
    const config = {
      labelProperty: args.labelProperty ?? 'label',
      edgeTypeProperty: args.edgeTypeProperty ?? 'type',
    };
    const graph = createGraph(graphData, { onWarning: (msg) => console.warn(msg) });
    const indexes = buildGraphIndexes(graphData, graph, { config, onWarning: (msg) => console.warn(msg) });
    const engine = new GraphEngine(graph, indexes);
    const ast = parseCypher(args.expr);
    const results = ast.type === 'UnionQuery'
      ? engine.executeUnion(ast)
      : engine.execute(ast);

    // Default to graph format for chaining (stdout → stdin)
    // Falls back to rows when results contain only scalars (no nodes/edges)
    const format = args.format ?? 'graph';
    let output: unknown;
    if (format === 'graph') {
      const toGraphOpts: Parameters<typeof resultsToGraph>[2] = {};
      if (graphData.options) toGraphOpts.rootOptions = graphData.options;
      if (graphData.attributes) toGraphOpts.rootAttributes = graphData.attributes;
      const graphResult = resultsToGraph(results, userEdgeKeys, toGraphOpts);
      output = graphResult._hasGraphData
        ? ({
            ...(graphResult.options && { options: graphResult.options }),
            ...(graphResult.attributes && { attributes: graphResult.attributes }),
            nodes: graphResult.nodes,
            edges: graphResult.edges,
          })
        : results;
    } else {
      output = results;
    }
    console.log(JSON.stringify(output, null, 2));
  } catch (err: unknown) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
