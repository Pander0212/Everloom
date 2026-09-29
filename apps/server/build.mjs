import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/index.js',
  sourcemap: true,
  // Native / heavy deps stay external and are resolved from node_modules at runtime.
  external: ['better-sqlite3', 'sharp', 'js-tiktoken', 'qrcode', 'yauzl', 'yazl', 'fastify', '@fastify/*'],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});
console.log('server built');
