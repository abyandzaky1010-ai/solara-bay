// Tiny static file server for the game/ directory. Run: node serve.ts
// Serves on http://localhost:8080 with a MIME map, a traversal guard and no-store caching.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'game');
const PORT = 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

createServer(async (req, res) => {
  const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const target = rawPath === '/' ? '/index.html' : rawPath;
  const full = normalize(resolve(ROOT, '.' + target));

  if (full !== ROOT && !full.startsWith(ROOT + sep)) {
    return send(res, 403, 'forbidden');
  }

  try {
    const info = await stat(full);
    if (info.isDirectory()) return send(res, 404, 'not found');
    const body = await readFile(full);
    const type = MIME[extname(full).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    send(res, 404, 'not found');
  }
}).listen(PORT, () => {
  console.log(`Solara Bay served at http://localhost:${PORT} (root: ${ROOT})`);
});
