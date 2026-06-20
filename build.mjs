import { build } from 'esbuild';
import { chmod } from 'fs/promises';

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
