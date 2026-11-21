// Solara Bay — tiny static file server for game/ (development only).
// Usage: node serve.ts  →  http://localhost:8080

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'game');
const PORT = 8080;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

function safePath(urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  const full = safePath(req.url ?? '/');
  if (!full) {
    res.writeHead(403, { 'Cache-Control': 'no-store' }).end('forbidden');
    return;
  }
  try {
    const body = await readFile(full);
    const type = MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Cache-Control': 'no-store' }).end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`Solara Bay served from ${ROOT}`);
  console.log(`open http://localhost:${PORT}`);
});
