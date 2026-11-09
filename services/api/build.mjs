// Bundles the local server (the API, the built SPA host and the background retention job) into
// one ESM file. sharp ships native binaries, so it stays external and comes from node_modules.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm(new URL('./dist', import.meta.url), { recursive: true, force: true });
await build({
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  minify: false,
  external: ['sharp', 'pg-native', 'esbuild'],
  // esbuild's ESM output needs require() for a few CJS dependencies.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
  entryPoints: ['src/local.ts'],
  outfile: 'dist/local.js',
});
