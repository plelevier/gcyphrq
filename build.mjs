import { build } from 'esbuild';
import { chmod, mkdir } from 'fs/promises';
import { spawnSync } from 'child_process';

// ── CLI entry point (bundled) ────────────────────────────────────────────────

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  banner: {
    js: '#!/usr/bin/env node',
  },
});

await chmod('dist/index.js', 0o755);

// ── Library entry point (bundled + declarations) ─────────────────────────────

await build({
  entryPoints: ['src/lib.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/lib.js',
  external: ['graphology', 'antlr4', '@neo4j-cypher/antlr4'],
});

// Generate TypeScript declarations for the library using tsc
await mkdir('dist', { recursive: true });
const tscResult = spawnSync('npx', ['tsc', '--project', 'tsconfig.lib.json'], {
  stdio: 'inherit',
  encoding: 'utf-8',
});
if (tscResult.status !== 0) {
  process.exit(tscResult.status ?? 1);
}
