import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { GraphError, createGraph, parseCypher, GraphEngine, buildGraphIndexes, explainQuery } from './lib';
import type { GraphInput } from './lib';
import { runInstall } from './install';
import { formatExtensionsList, convertWithExtension, registerFunctionExtension, preprocessQueryForExtensions } from './ext/registry';
import { getExtensionFunctions, getExtensionAggregations } from './ext/registry';
import { computeCacheKey, readCache, writeCache } from './cache';

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
  --explain              Show the query execution plan instead of executing. Does not require a graph file (-g is optional)
  --ext <name>           Use a graph-input extension to parse the input file (e.g., --ext gexf)
  --ext-fn <name>        Load a function extension (repeatable, e.g., --ext-fn apoc-commons)
  --no-cache             Disable graph caching for input extensions (enabled by default)
  --pass-through         Output the input graph as-is without executing a Cypher query. Requires -g, ignores -e. Useful with --ext to convert file formats to Graphology JSON
  --list-extensions      List all available extensions with descriptions
  --install-skill <mode> Install the gcyphrq skill for AI coding agents. Mode: "global" (symlinks) or "local" (copies into current directory)
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
  gcyphrq -g data.gexf --ext gexf -e 'MATCH (n) RETURN n'
  gcyphrq -g graph.json --ext-fn apoc-commons -e 'RETURN apoc.text.capitalize("hello")'
  gcyphrq --list-extensions
  gcyphrq --install-skill global      # Install skill globally (symlinks)
  gcyphrq --install-skill local       # Install skill in current project (copies)
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
  explain: boolean;
  help: boolean;
  version: boolean;
  install: 'global' | 'local' | undefined;
  ext: string | undefined;
  extFn: string[];
  listExtensions: boolean;
  passThrough: boolean;
  noCache: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { expr: undefined, graph: undefined, labelProperty: undefined, edgeTypeProperty: undefined, format: undefined, explain: false, help: false, version: false, install: undefined, ext: undefined, extFn: [], listExtensions: false, passThrough: false, noCache: false };
  let exprFlag: string | null = null;
  let graphFlag: string | null = null;
  let labelFlag: string | null = null;
  let typeFlag: string | null = null;
  let formatFlag: string | null = null;
  let extFlag: string | null = null;

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

    if (arg === '--install-skill') {
      if (i + 1 >= argv.length) {
        throw new GraphError('The --install-skill option requires a value ("global" or "local").');
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

    if (arg === '--explain') {
      args.explain = true;
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

    if (arg === '--ext') {
      if (i + 1 >= argv.length) {
        throw new GraphError('The --ext option requires a value.');
      }
      if (extFlag) {
        throw new GraphError('The option "--ext" was provided multiple times. Use it only once.');
      }
      extFlag = arg;
      args.ext = argv[++i]!;
      continue;
    }

    if (arg === '--ext-fn') {
      if (i + 1 >= argv.length) {
        throw new GraphError('The --ext-fn option requires a value.');
      }
      args.extFn.push(argv[++i]!);
      continue;
    }

    if (arg === '--list-extensions') {
      args.listExtensions = true;
      continue;
    }

    if (arg === '--pass-through') {
      args.passThrough = true;
      continue;
    }

    if (arg === '--no-cache') {
      args.noCache = true;
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

  /** Check if an object looks like an edge (has string id+source+target). Edges are checked before nodes. */
  const isEdgeObject = (obj: Record<string, unknown>): boolean => {
    return typeof obj.id === 'string' && typeof obj.source === 'string' && typeof obj.target === 'string';
  };

  /** Register a single edge into the edge map. */
  const registerEdge = (e: Record<string, unknown>) => {
    const eid = e.id as string;
    if (eid && !edgeMap.has(eid)) {
      const { id: _eid, source, target, ...attrs } = e;
      const entry: { key?: string; source: string; target: string; attributes: Record<string, unknown> } = {
        source: source as string,
        target: target as string,
        attributes: attrs,
      };
      if (userEdgeKeys.has(eid)) entry.key = eid;
      edgeMap.set(eid, entry);
    }
  };

  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (value === null || value === undefined) continue;

      // Edges: single edge objects (single-hop patterns) — distinguished by having id+source+target
      if (typeof value === 'object' && !Array.isArray(value) && isEdgeObject(value as Record<string, unknown>)) {
        registerEdge(value as Record<string, unknown>);
        continue;
      }

      // Nodes: objects with "id" that are not arrays and not edges
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
          if (edge && typeof edge === 'object' && isEdgeObject(edge as Record<string, unknown>)) {
            registerEdge(edge as Record<string, unknown>);
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

// ── Cache-aware graph loading ──────────────────────────────────────────────

/**
 * Load a graph using a graph-input extension, with optional disk caching.
 *
 * When caching is enabled (default), the parsed GraphInput is cached on disk
 * keyed by file path, extension name, and config parameters. Subsequent runs
 * against the same file skip the parsing step.
 */
async function loadGraphWithCache(
  filePath: string,
  extensionName: string,
  labelProperty: string | undefined,
  edgeTypeProperty: string | undefined,
  noCache: boolean,
): Promise<GraphInput> {
  const resolvedPath = resolve(filePath);
  const stat = statSync(resolvedPath);

  // Try cache first (unless disabled)
  if (!noCache) {
    const { hash } = computeCacheKey(resolvedPath, extensionName, labelProperty, edgeTypeProperty);
    const cached = readCache(hash, stat.mtimeMs, stat.size);
    if (cached !== undefined) {
      return cached;
    }
  }

  // Cache miss or cache disabled — run the extension
  const content = readFileSync(resolvedPath, 'utf-8');
  const extContext: import('./ext/types').GraphInputExtensionContext = {
    content,
    filePath,
  };
  if (labelProperty !== undefined) extContext.labelProperty = labelProperty;
  if (edgeTypeProperty !== undefined) extContext.edgeTypeProperty = edgeTypeProperty;
  const { graph, cacheable } = await convertWithExtension(extensionName, extContext);

  // Write to cache unless disabled or extension opted out
  if (!noCache && cacheable) {
    const { hash, key } = computeCacheKey(resolvedPath, extensionName, labelProperty, edgeTypeProperty);
    try {
      writeCache(hash, key, stat.mtimeMs, stat.size, graph);
    } catch {
      // Cache write failure is non-fatal — graph was parsed successfully
    }
  }

  return graph;
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

    // ── List extensions ────────────────────────────────────────────────

    if (args.listExtensions) {
      process.stdout.write(formatExtensionsList() + '\n');
      process.exit(0);
    }

    // ── Install command ────────────────────────────────────────────────

    if (args.install) {
      if (args.expr || args.graph || args.passThrough) {
        throw new GraphError('--install-skill cannot be combined with -e/--expr, -g/--graph, or --pass-through.');
      }

      await runInstall(args.install, process.cwd());
      process.exit(0);
    }

    // ── Pass-through mode (output graph as-is, no query) ──────────────

    if (args.passThrough) {
      if (args.expr) {
        throw new GraphError('--pass-through cannot be combined with -e/--expr.');
      }
      if (!args.graph) {
        throw new GraphError('The --pass-through option requires -g/--graph <file>.');
      }
      if (args.ext && args.graph === '-') {
        throw new GraphError('The --ext option cannot be used with stdin (-g -).');
      }
      if (args.explain) {
        throw new GraphError('--pass-through cannot be combined with --explain.');
      }
      if (args.extFn.length > 0) {
        throw new GraphError('--pass-through cannot be combined with --ext-fn.');
      }

      // Load graph data
      let passThroughData: GraphInput;
      if (args.ext) {
        passThroughData = await loadGraphWithCache(
          args.graph!,
          args.ext,
          args.labelProperty,
          args.edgeTypeProperty,
          args.noCache,
        );
      } else {
        passThroughData = args.graph === '-'
          ? await readJsonFile('stdin')
          : await readJsonFile('file', args.graph);
      }

      // Validate the graph data (ensures structural correctness)
      createGraph(passThroughData, { onWarning: (msg) => console.warn(msg) });

      // Output the graph data as-is
      console.log(JSON.stringify(passThroughData, null, 2));
      process.exit(0);
    }

    // ── Query execution ────────────────────────────────────────────────

    if (!args.expr) {
      throw new GraphError('Missing required option: -e, --expr <query>\n\nUse "gcyphrq --help" for usage information.');
    }

    // ── Validation ─────────────────────────────────────────────────────

    if (args.ext && !args.graph) {
      throw new GraphError('The --ext option requires -g/--graph <file>.');
    }
    if (args.ext && args.graph === '-') {
      throw new GraphError('The --ext option cannot be used with stdin (-g -).');
    }
    if (args.ext && args.explain) {
      throw new GraphError('The --ext option cannot be used with --explain.');
    }
    if (args.extFn.length > 0 && args.explain) {
      throw new GraphError('The --ext-fn option cannot be used with --explain.');
    }

    if (!args.graph && !args.explain) {
      throw new GraphError('Missing required option: -g, --graph <file>\n\nUse "gcyphrq --help" for usage information.');
    }

    // ── Explain mode (no graph needed) ─────────────────────────────────

    if (args.explain) {
      const plan = explainQuery(args.expr);
      console.log(JSON.stringify(plan, null, 2));
      process.exit(0);
    }

    // ── Load function extensions ───────────────────────────────────────

    for (const extName of args.extFn) {
      await registerFunctionExtension(extName);
    }

    // ── Load graph data ────────────────────────────────────────────────

    let graphData: GraphInput;
    if (args.ext) {
      graphData = await loadGraphWithCache(
        args.graph!,
        args.ext,
        args.labelProperty,
        args.edgeTypeProperty,
        args.noCache,
      );
    } else {
      graphData = args.graph === '-'
        ? await readJsonFile('stdin')
        : await readJsonFile('file', args.graph);
    }

    // Collect user-provided edge keys for round-trip preservation
    const userEdgeKeys = new Set(
      Array.isArray(graphData.edges)
        ? graphData.edges.filter((e: any) => typeof e?.key === 'string').map((e: any) => e.key as string)
        : [],
    );

    // Pre-process query for dotted function names (extension functions)
    let query = args.expr;
    if (args.extFn.length > 0) {
      query = preprocessQueryForExtensions(query);
    }

    // Build graph, indexes, and execute query using the library
    const config = {
      labelProperty: args.labelProperty ?? 'label',
      edgeTypeProperty: args.edgeTypeProperty ?? 'type',
    };
    const graph = createGraph(graphData, { onWarning: (msg) => console.warn(msg) });
    const indexes = buildGraphIndexes(graphData, graph, { config, onWarning: (msg) => console.warn(msg) });

    const engine = new GraphEngine(graph, indexes, undefined, getExtensionFunctions(), getExtensionAggregations());
    const ast = parseCypher(query);
    const results = ast.type === 'UnionQuery'
      ? await engine.executeUnion(ast)
      : await engine.execute(ast);

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
