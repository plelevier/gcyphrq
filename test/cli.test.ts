import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// All temp files live in the system temp dir, not inside the project.
let cliTmpRoot: string;

function mkSubdir(name: string): string {
  const dir = join(cliTmpRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(dir: string, name: string, content: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(content));
  return path;
}

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolveResult) => {
    execFile('npx', ['tsx', join('src', 'index.ts'), ...args], { cwd: PROJECT_ROOT, timeout: 10000 }, (error, stdout, stderr) => {
      resolveResult({
        stdout,
        stderr,
        code: typeof error?.code === 'number' ? error.code : 0,
      });
    });
  });
}

const simpleGraph = {
  nodes: [
    { key: 'a', attributes: { label: 'User', name: 'Alice' } },
    { key: 'b', attributes: { label: 'User', name: 'Bob' } },
  ],
  edges: [{ source: 'a', target: 'b', attributes: { type: 'FRIEND' } }],
};

describe('CLI - integration', () => {
  beforeAll(() => {
    cliTmpRoot = join(tmpdir(), 'gcyphrq-cli-tests');
    mkdirSync(cliTmpRoot, { recursive: true });
  });

  afterAll(() => {
    if (cliTmpRoot) rmSync(cliTmpRoot, { recursive: true, force: true });
  });

  it('shows help with --help', async () => {
    const { stdout, code } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: gcyphrq');
    expect(stdout).toContain('-e, --expr');
    expect(stdout).toContain('-g, --graph');
  });

  it('shows help with -h', async () => {
    const { stdout, code } = await runCli(['-h']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: gcyphrq');
  });

  it('errors when -e is missing', async () => {
    const { stderr, code } = await runCli(['-g', 'examples/social-graph.json']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('expr');
  });

  it('errors when -g is missing', async () => {
    const { stderr, code } = await runCli(['-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('graph');
  });

  it('errors on unknown option', async () => {
    const { stderr, code } = await runCli(['--unknown', 'foo']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('Unknown option');
  });

  it('errors on missing file', async () => {
    const { stderr, code } = await runCli(['-g', 'nonexistent.json', '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('not found');
  });

  it('errors on invalid JSON', async () => {
    const d = mkSubdir('invalid-json');
    writeFileSync(join(d, 'bad.json'), '{not valid json');
    const { stderr, code } = await runCli(['-g', join(d, 'bad.json'), '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('JSON');
  });

  it('outputs raw JSON for valid query', async () => {
    const d = mkSubdir('valid-query');
    const path = writeFile(d, 'graph.json', simpleGraph);
    const { stdout, code } = await runCli(['-g', path, '-e', 'MATCH (u:User) RETURN u.name', '--format', 'rows']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
  });

  it('errors on invalid graph schema (missing nodes array)', async () => {
    const d = mkSubdir('bad-schema');
    const path = writeFile(d, 'bad.json', { edges: [] });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('nodes');
  });

  it('errors on invalid graph schema (missing edges array)', async () => {
    const d = mkSubdir('bad-schema2');
    const path = writeFile(d, 'bad.json', { nodes: [] });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('edges');
  });

  it('errors on duplicate node id', async () => {
    const d = mkSubdir('dup-node');
    const path = writeFile(d, 'dup.json', {
      nodes: [{ key: 'a', attributes: { label: 'X' } }, { key: 'a', attributes: { label: 'Y' } }],
      edges: [],
    });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('duplicate');
  });

  it('errors on edge referencing non-existent node', async () => {
    const d = mkSubdir('bad-edge');
    const path = writeFile(d, 'bad.json', {
      nodes: [{ key: 'a', attributes: { label: 'X' } }],
      edges: [{ source: 'a', target: 'ghost', attributes: { type: 'LINK' } }],
    });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('unknown');
  });

  it('errors on duplicate edge', async () => {
    const d = mkSubdir('dup-edge');
    const path = writeFile(d, 'dup.json', {
      nodes: [{ key: 'a', attributes: { label: 'X' } }, { key: 'b', attributes: { label: 'Y' } }],
      edges: [
        { source: 'a', target: 'b', attributes: { type: 'LINK' } },
        { source: 'a', target: 'b', attributes: { type: 'LINK2' } },
      ],
    });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('duplicate');
  });

  it('errors on invalid Cypher query', async () => {
    const d = mkSubdir('bad-cypher');
    const path = writeFile(d, 'graph.json', simpleGraph);
    const { stderr, code } = await runCli(['-g', path, '-e', 'INVALID QUERY HERE']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
  });

  it('errors on empty graph file', async () => {
    const d = mkSubdir('empty');
    writeFileSync(join(d, 'empty.json'), '');
    const { stderr, code } = await runCli(['-g', join(d, 'empty.json'), '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
  });

  it('errors on node missing key', async () => {
    const d = mkSubdir('no-key');
    const path = writeFile(d, 'bad.json', { nodes: [{ attributes: { label: 'X' } }], edges: [] });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('key');
  });

  it('errors on edge missing source', async () => {
    const d = mkSubdir('no-source');
    const path = writeFile(d, 'bad.json', {
      nodes: [{ key: 'a', attributes: { label: 'X' } }],
      edges: [{ target: 'a', attributes: { type: 'LINK' } }],
    });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('source');
  });

  it('errors on edge missing target', async () => {
    const d = mkSubdir('no-target');
    const path = writeFile(d, 'bad.json', {
      nodes: [{ key: 'a', attributes: { label: 'X' } }],
      edges: [{ source: 'a', attributes: { type: 'LINK' } }],
    });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('target');
  });

  it('works with --expr and --graph long flags', async () => {
    const d = mkSubdir('long-flags');
    const path = writeFile(d, 'graph.json', simpleGraph);
    const { stdout, code } = await runCli(['--graph', path, '--expr', 'MATCH (u:User) RETURN u.name', '--format', 'rows']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });
});

describe('CLI - graph format output', () => {
  beforeAll(() => {
    cliTmpRoot = join(tmpdir(), 'gcyphrq-cli-tests');
    mkdirSync(cliTmpRoot, { recursive: true });
  });

  afterAll(() => {
    if (cliTmpRoot) rmSync(cliTmpRoot, { recursive: true, force: true });
  });

  it('preserves root options in graph format output', async () => {
    const d = mkSubdir('root-options');
    const path = writeFile(d, 'graph.json', {
      options: { type: 'directed' },
      nodes: [
        { key: 'a', attributes: { label: 'User', name: 'Alice' } },
      ],
      edges: [],
    });
    const { stdout, code } = await runCli(['-g', path, '-e', 'MATCH (u:User) RETURN u']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.options).toEqual({ type: 'directed' });
    expect(parsed.attributes).toBeUndefined();
  });

  it('preserves root attributes in graph format output', async () => {
    const d = mkSubdir('root-attrs');
    const path = writeFile(d, 'graph.json', {
      attributes: { name: 'My Graph', version: '2.0' },
      nodes: [
        { key: 'a', attributes: { label: 'User', name: 'Alice' } },
      ],
      edges: [],
    });
    const { stdout, code } = await runCli(['-g', path, '-e', 'MATCH (u:User) RETURN u']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.attributes).toEqual({ name: 'My Graph', version: '2.0' });
    expect(parsed.options).toBeUndefined();
  });

  it('preserves both root options and attributes', async () => {
    const d = mkSubdir('root-both');
    const path = writeFile(d, 'graph.json', {
      options: { type: 'directed' },
      attributes: { name: 'Test', author: 'me' },
      nodes: [
        { key: 'a', attributes: { label: 'User', name: 'Alice' } },
      ],
      edges: [],
    });
    const { stdout, code } = await runCli(['-g', path, '-e', 'MATCH (u:User) RETURN u']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.options).toEqual({ type: 'directed' });
    expect(parsed.attributes).toEqual({ name: 'Test', author: 'me' });
  });

  it('omits root options/attributes when input has none', async () => {
    const d = mkSubdir('root-none');
    const path = writeFile(d, 'graph.json', {
      nodes: [
        { key: 'a', attributes: { label: 'User', name: 'Alice' } },
      ],
      edges: [],
    });
    const { stdout, code } = await runCli(['-g', path, '-e', 'MATCH (u:User) RETURN u']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.options).toBeUndefined();
    expect(parsed.attributes).toBeUndefined();
  });

  it('preserves edge keys in graph format output', async () => {
    const d = mkSubdir('edge-keys');
    const path = writeFile(d, 'graph.json', {
      nodes: [
        { key: 'a', attributes: { label: 'User', name: 'Alice' } },
        { key: 'b', attributes: { label: 'User', name: 'Bob' } },
      ],
      edges: [
        { key: 'alice-friends-bob', source: 'a', target: 'b', attributes: { type: 'FRIEND' } },
      ],
    });
    const { stdout, code } = await runCli(['-g', path, '-e', 'MATCH (a)-[r:FRIEND]->(b) RETURN a, r, b']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].key).toBe('alice-friends-bob');
    expect(parsed.edges[0].source).toBe('a');
    expect(parsed.edges[0].target).toBe('b');
  });

  it('omits edge key when input edge has no key', async () => {
    const d = mkSubdir('edge-no-key');
    const path = writeFile(d, 'graph.json', {
      nodes: [
        { key: 'a', attributes: { label: 'User', name: 'Alice' } },
        { key: 'b', attributes: { label: 'User', name: 'Bob' } },
      ],
      edges: [
        { source: 'a', target: 'b', attributes: { type: 'FRIEND' } },
      ],
    });
    const { stdout, code } = await runCli(['-g', path, '-e', 'MATCH (a)-[r:FRIEND]->(b) RETURN a, r, b']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].key).toBeUndefined();
    expect(parsed.edges[0].source).toBe('a');
    expect(parsed.edges[0].target).toBe('b');
  });

  it('handles mixed edges (some with keys, some without)', async () => {
    const d = mkSubdir('edge-mixed');
    const path = writeFile(d, 'graph.json', {
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
        { key: 'c', attributes: { label: 'N' } },
      ],
      edges: [
        { key: 'my-edge-1', source: 'a', target: 'b', attributes: { type: 'LINK' } },
        { source: 'b', target: 'c', attributes: { type: 'LINK' } },
      ],
    });
    const { stdout, code } = await runCli(['-g', path, '-e', 'MATCH ()-[r]->() RETURN r']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.edges).toHaveLength(2);

    const withKey = parsed.edges.find((e: any) => e.key === 'my-edge-1');
    expect(withKey).toBeDefined();
    const withoutKey = parsed.edges.find((e: any) => e.key === undefined);
    expect(withoutKey).toBeDefined();
  });

  it('preserves edge keys through variable-length paths', async () => {
    const d = mkSubdir('edge-vl');
    const path = writeFile(d, 'graph.json', {
      nodes: [
        { key: 'a', attributes: { label: 'N' } },
        { key: 'b', attributes: { label: 'N' } },
        { key: 'c', attributes: { label: 'N' } },
      ],
      edges: [
        { key: 'first-edge', source: 'a', target: 'b', attributes: { type: 'LINK' } },
        { key: 'second-edge', source: 'b', target: 'c', attributes: { type: 'LINK' } },
      ],
    });
    const { stdout, code } = await runCli(['-g', path, '-e', 'MATCH (a)-[r*1..2]->(b) RETURN a, r, b']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.edges).toHaveLength(2);
    expect(parsed.edges[0].key).toBe('first-edge');
    expect(parsed.edges[1].key).toBe('second-edge');
  });

  it('round-trips edge keys through chaining', async () => {
    const d = mkSubdir('edge-chain');
    const path = writeFile(d, 'graph.json', {
      nodes: [
        { key: 'a', attributes: { label: 'User', name: 'Alice' } },
        { key: 'b', attributes: { label: 'User', name: 'Bob' } },
      ],
      edges: [
        { key: 'my-link', source: 'a', target: 'b', attributes: { type: 'FRIEND' } },
      ],
    });

    // First query: return nodes and edges
    const { stdout: firstOutput } = await runCli(['-g', path, '-e', 'MATCH (a)-[r]->(b) RETURN a, r, b']);
    const firstParsed = JSON.parse(firstOutput);
    expect(firstParsed.edges[0].key).toBe('my-link');

    // Pipe output back in for a second query
    const d2 = mkSubdir('edge-chain-2');
    const chainPath = writeFile(d2, 'chain.json', firstParsed);
    const { stdout: secondOutput, code: code2 } = await runCli(['-g', chainPath, '-e', 'MATCH ()-[r]->() RETURN r']);
    expect(code2).toBe(0);
    const secondParsed = JSON.parse(secondOutput);
    expect(secondParsed.edges[0].key).toBe('my-link');
  });

  it('round-trips root options and attributes through chaining', async () => {
    const d = mkSubdir('chain-meta');
    const path = writeFile(d, 'graph.json', {
      options: { type: 'directed' },
      attributes: { name: 'My Graph', version: '1.0' },
      nodes: [
        { key: 'a', attributes: { label: 'User', name: 'Alice' } },
      ],
      edges: [],
    });

    // First query
    const { stdout: firstOutput } = await runCli(['-g', path, '-e', 'MATCH (u:User) RETURN u']);
    const firstParsed = JSON.parse(firstOutput);
    expect(firstParsed.options).toEqual({ type: 'directed' });
    expect(firstParsed.attributes).toEqual({ name: 'My Graph', version: '1.0' });

    // Pipe output back in — force graph format so root metadata is included
    const d2 = mkSubdir('chain-meta-2');
    const chainPath = writeFile(d2, 'chain.json', firstParsed);
    const { stdout: secondOutput, code: code2 } = await runCli(
      ['-g', chainPath, '-e', 'MATCH (u:User) RETURN u', '--format', 'graph'],
    );
    expect(code2).toBe(0);
    const secondParsed = JSON.parse(secondOutput);
    // Root metadata should still be present after chaining
    expect(secondParsed.options).toEqual({ type: 'directed' });
    expect(secondParsed.attributes).toEqual({ name: 'My Graph', version: '1.0' });
  });
});

describe('CLI - extensions', () => {
  beforeAll(() => {
    cliTmpRoot = join(tmpdir(), 'gcyphrq-cli-tests');
    mkdirSync(cliTmpRoot, { recursive: true });
  });

  afterAll(() => {
    if (cliTmpRoot) rmSync(cliTmpRoot, { recursive: true, force: true });
  });

  it('shows --list-extensions output when no extensions installed', async () => {
    const { stdout, code } = await runCli(['--list-extensions']);
    expect(code).toBe(0);
    expect(stdout).toContain('No extensions installed');
  });

  it('errors when --ext is used without -g', async () => {
    const { stderr, code } = await runCli(['--ext', 'gexf', '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('--ext option requires -g');
  });

  it('errors when --ext is used with stdin', async () => {
    const { stderr, code } = await runCli(['--ext', 'gexf', '-g', '-', '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('stdin');
  });

  it('errors when --ext is used with --explain', async () => {
    const { stderr, code } = await runCli(['--ext', 'gexf', '-g', 'test.json', '--explain', '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('--explain');
  });

  it('errors when --ext-fn is used with --explain', async () => {
    const { stderr, code } = await runCli(['--ext-fn', 'apoc', '--explain', '-e', 'RETURN 1']);
    expect(code).toBe(1);
    expect(stderr).toContain('--explain');
  });

  it('errors when extension not found', async () => {
    const d = mkSubdir('ext-not-found');
    const path = writeFile(d, 'graph.json', simpleGraph);
    const { stderr, code } = await runCli(['-g', path, '--ext', 'nonexistent', '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('not found');
  });

  it('errors when function extension not found', async () => {
    const d = mkSubdir('ext-fn-not-found');
    const path = writeFile(d, 'graph.json', simpleGraph);
    const { stderr, code } = await runCli(['-g', path, '--ext-fn', 'nonexistent', '-e', 'RETURN 1']);
    expect(code).toBe(1);
    expect(stderr).toContain('not found');
  });

  it('errors on unknown option --ext with missing value', async () => {
    const { stderr, code } = await runCli(['--ext']);
    expect(code).toBe(1);
    expect(stderr).toContain('requires a value');
  });

  it('errors on unknown option --ext-fn with missing value', async () => {
    const { stderr, code } = await runCli(['--ext-fn']);
    expect(code).toBe(1);
    expect(stderr).toContain('requires a value');
  });
});
