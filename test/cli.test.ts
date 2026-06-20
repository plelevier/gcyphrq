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
    execFile('npx', ['tsx', join('src', 'index.ts'), ...args], { cwd: PROJECT_ROOT }, (error, stdout, stderr) => {
      resolveResult({
        stdout,
        stderr,
        code: error?.code ?? 0,
      });
    });
  });
}

const simpleGraph = {
  nodes: [
    { id: 'a', label: 'User', name: 'Alice' },
    { id: 'b', label: 'User', name: 'Bob' },
  ],
  edges: [{ source: 'a', target: 'b', type: 'FRIEND' }],
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
    const { stdout, code } = await runCli(['-g', path, '-e', 'MATCH (u:User) RETURN u.name']);
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
      nodes: [{ id: 'a', label: 'X' }, { id: 'a', label: 'Y' }],
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
      nodes: [{ id: 'a', label: 'X' }],
      edges: [{ source: 'a', target: 'ghost', type: 'LINK' }],
    });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('unknown');
  });

  it('errors on duplicate edge', async () => {
    const d = mkSubdir('dup-edge');
    const path = writeFile(d, 'dup.json', {
      nodes: [{ id: 'a', label: 'X' }, { id: 'b', label: 'Y' }],
      edges: [
        { source: 'a', target: 'b', type: 'LINK' },
        { source: 'a', target: 'b', type: 'LINK2' },
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

  it('errors on node missing id', async () => {
    const d = mkSubdir('no-id');
    const path = writeFile(d, 'bad.json', { nodes: [{ label: 'X' }], edges: [] });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('id');
  });

  it('errors on edge missing source', async () => {
    const d = mkSubdir('no-source');
    const path = writeFile(d, 'bad.json', {
      nodes: [{ id: 'a', label: 'X' }],
      edges: [{ target: 'a', type: 'LINK' }],
    });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('source');
  });

  it('errors on edge missing target', async () => {
    const d = mkSubdir('no-target');
    const path = writeFile(d, 'bad.json', {
      nodes: [{ id: 'a', label: 'X' }],
      edges: [{ source: 'a', type: 'LINK' }],
    });
    const { stderr, code } = await runCli(['-g', path, '-e', 'MATCH (n) RETURN n']);
    expect(code).toBe(1);
    expect(stderr).toContain('Error:');
    expect(stderr).toContain('target');
  });

  it('works with --expr and --graph long flags', async () => {
    const d = mkSubdir('long-flags');
    const path = writeFile(d, 'graph.json', simpleGraph);
    const { stdout, code } = await runCli(['--graph', path, '--expr', 'MATCH (u:User) RETURN u.name']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
