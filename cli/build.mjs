import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const opts = {
  absWorkingDir: __dirname,
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'bin/gitlike.mjs',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node\n' },
  packages: 'external',
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await build(opts);
  console.log('Built bin/gitlike.mjs');
}
