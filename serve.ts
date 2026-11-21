// Tiny static server for the game folder. Node 22, no dependencies.
// Usage: node serve.ts  →  http://localhost:8080

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'game');
const PORT = 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function safePath(urlPath) {
  const clean = decodeURIComponent((urlPath || '/').split('?')[0].split('#')[0]);
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  const target = safePath(req.url);
  if (!target) {
    res.writeHead(403, { 'Cache-Control': 'no-store' });
    res.end('forbidden');
    return;
  }
  try {
    const info = await stat(target);
    const file = info.isDirectory() ? path.join(target, 'index.html') : target;
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`SOLARA BAY serving ${ROOT} at http://localhost:${PORT}`);
});
