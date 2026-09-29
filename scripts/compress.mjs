// Pre-compress built web assets (brotli + gzip) so the server can send them without compressing per request.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = path.resolve(process.argv[2] ?? 'apps/web/dist');
const EXT = /\.(js|mjs|css|html|svg|json|webmanifest|txt|map)$/;
let files = 0;
let before = 0;
let after = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.test(name) && st.size > 1024) {
      const buf = readFileSync(p);
      const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      writeFileSync(`${p}.br`, br);
      writeFileSync(`${p}.gz`, gzipSync(buf, { level: 9 }));
      files++;
      before += buf.length;
      after += br.length;
    }
  }
}
walk(root);
console.log(`compressed ${files} files: ${(before / 1024).toFixed(0)} KiB → ${(after / 1024).toFixed(0)} KiB (brotli)`);
