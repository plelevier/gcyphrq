import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GraphError, createGraph, parseCypher, GraphEngine, buildGraphIndexesExport } from './lib';
import type { GraphFile } from './lib';

// ── CLI Help ─────────────────────────────────────────────────────────────────

const HELP_TEXT = `
Usage: gcyphrq [options]

A graph query tool that executes Cypher queries against an in-memory graph.

Options:
  -e, --expr <query>   Cypher query expression (required)
  -g, --graph <file>   Path to a JSON graph file (required, or "-" to read from stdin)
  -h, --help           Show this help message

Graph file format:
  {
    "nodes": [ { "id": "<id>", "label": "<label>", ... } ],
    "edges": [ { "source": "<id>", "target": "<id>", "type": "<type>", ... } ]
  }

Examples:
  gcyphrq -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'
  gcyphrq --graph examples/social-graph.json --expr 'MATCH (u:User {name: "Alice"})-[r:FRIEND*1..2]->(f:User) RETURN u, f'
  gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {type: "RPC"}) RETURN s.name'
  cat my-graph.json | gcyphrq -g - -e 'MATCH (n) RETURN n'
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
  help: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { expr: undefined, graph: undefined, help: false };
  let exprFlag: string | null = null;
  let graphFlag: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;

    if (arg === '-h' || arg === '--help') {
      args.help = true;
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

    if (arg.startsWith('-')) {
      throw new GraphError(`Unknown option "${arg}".\n\nUse "gcyphrq --help" for usage information.`);
    }
  }

  return args;
}

// ── Graph Loading ────────────────────────────────────────────────────────────

async function readJsonFile(source: 'file' | 'stdin', path?: string): Promise<GraphFile> {
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

    if (args.help) {
      printHelp();
      process.exit(0);
    }

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

    // Build graph, indexes, and execute query using the library
    const graph = createGraph(graphData);
    const indexes = buildGraphIndexesExport(graphData, graph);
    const engine = new GraphEngine(graph, indexes);
    const ast = parseCypher(args.expr);
    const results = engine.execute(ast);

    console.log(JSON.stringify(results, null, 2));
  } catch (err: unknown) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
