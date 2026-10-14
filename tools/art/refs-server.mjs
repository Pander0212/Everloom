// Serves the reference images (~/Everloom-Tripo/refs) read-only on 127.0.0.1, so a browser tab can
// hand one to an upload field (the built-in browser can't open the native file picker).
//   node tools/art/refs-server.mjs [port]
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = process.env.ART_RAW_DIR || path.join(os.homedir(), 'Everloom-Tripo', 'refs');
const port = Number(process.argv[2] ?? 8790);
http
  .createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0].slice(1));
    if (name === 'send.html') {
      // Opened as a popup by the page that wants the picture: hands it back with postMessage.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><meta charset="utf-8"><title>refs</title><script>
const f = new URLSearchParams(location.search).get('file');
fetch('/' + encodeURIComponent(f)).then((r) => r.blob()).then((b) => { (window.opener || window.parent).postMessage({ everloomRef: f, blob: b }, '*'); document.title = 'sent'; setTimeout(() => window.close(), 300); });
</script>`);
      return;
    }
    const file = path.join(dir, name);
    const ok = /^[\w.-]+\.(jpg|png|webp)$/i.test(name) && file.startsWith(dir) && existsSync(file) && statSync(file).isFile();
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!ok) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg' });
    createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`refs on http://127.0.0.1:${port}/ from ${dir}`));
