// Solara Bay — static file server for game/ on http://localhost:8080 (dev only).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'game');
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

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function isInsideRoot(path) {
  const root = ROOT.endsWith(sep) ? ROOT : ROOT + sep;
  return path === ROOT || path.startsWith(root);
}

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'bad request');
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = resolve(ROOT, '.' + normalize('/' + pathname));
  if (!isInsideRoot(filePath)) return send(res, 403, 'forbidden');
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return send(res, 404, 'not found');
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    send(res, 200, body, { 'Content-Type': type, 'Content-Length': body.length });
  } catch {
    send(res, 404, 'not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Solara Bay dev server: http://localhost:${PORT}/`);
});
