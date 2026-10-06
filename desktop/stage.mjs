// Puts together what the installer ships, in ./stage:
//   node/    the Node runtime the server runs on (this machine's node: run this on Windows x64)
//   server/  the built server and its production dependencies (native modules for this platform)
//   web/     the built web app
// Run `npm run build` at the repository root first.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const stage = path.join(here, 'stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(path.join(stage, 'node'), { recursive: true });

for (const f of ['apps/server/dist/index.js', 'apps/server/dist/frame-runtime.js', 'apps/web/dist/index.html']) {
  if (!existsSync(path.join(root, f))) throw new Error(`Missing ${f}: run npm run build at the repository root first`);
}
cpSync(path.join(root, 'apps/web/dist'), path.join(stage, 'web'), { recursive: true });
mkdirSync(path.join(stage, 'server'), { recursive: true });
for (const f of ['index.js', 'frame-runtime.js', 'avatar-worker.js', 'blender-worker.py']) cpSync(path.join(root, 'apps/server/dist', f), path.join(stage, 'server', f));

// The server's runtime dependencies (the workspace engine is bundled into index.js).
const serverPkg = JSON.parse(readFileSync(path.join(root, 'apps/server/package.json'), 'utf8'));
const deps = Object.fromEntries(Object.entries(serverPkg.dependencies ?? {}).filter(([name]) => !name.startsWith('@everloom/')));
const rootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
writeFileSync(path.join(stage, 'server', 'package.json'), JSON.stringify({ name: 'everloom-server', version: rootPkg.version, private: true, type: 'module', dependencies: deps }, null, 2));
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock --ignore-scripts', { cwd: path.join(stage, 'server'), stdio: 'inherit' });

const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
cpSync(process.execPath, path.join(stage, 'node', nodeName));
console.log(`Staged in ${stage} with Node ${process.version} (${process.platform}-${process.arch})`);
