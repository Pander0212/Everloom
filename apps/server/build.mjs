import { copyFileSync } from 'node:fs';
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
  external: ['better-sqlite3-multiple-ciphers', 'sharp', 'ktx2-encoder', 'js-tiktoken', 'qrcode', 'yauzl', 'yazl', 'fastify', '@fastify/*'],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});
// Model optimization runs in a worker thread (texture encoding is slow).
await build({
  entryPoints: ['src/services/avatars/worker.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/avatar-worker.js',
  external: ['sharp', 'ktx2-encoder'],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});
copyFileSync('src/blender/worker.py', 'dist/blender-worker.py');
// The script sandbox's in-frame runtime is plain JavaScript, inlined into the frame document at run time.
copyFileSync('src/sandbox/frame-runtime.js', 'dist/frame-runtime.js');
console.log('server built');
