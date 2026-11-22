// Solara Bay — static file server for local play.
//
//   node serve.ts            # http://localhost:8080/
//   PORT=9000 node serve.ts
//
// Serves the repository root (so game/index.html is /game/index.html and the
// screenshots sit at /screenshots/). Node 22, standard library only. Every
// request is resolved inside the root and anything that would climb out is
// refused with 403. No directory listings, no caching of game code.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE);
const PORT = Number.parseInt(process.env.PORT ?? '8080', 10) || 8080;

/** How each file extension is announced to the browser. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

/** The URL path as a file path under ROOT, or null when it climbs out. */
function targetPath(url: string): string | null {
  const raw = url.split('?')[0]!.split('#')[0]!;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  const full = resolve(join(ROOT, rel));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

const sendStatus = (res: ServerResponse, code: number, text: string): void => {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
};

function handle(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendStatus(res, 405, 'Only GET and HEAD are served.\n');
    return;
  }
  let full = targetPath(req.url ?? '/');
  if (full === null) {
    sendStatus(res, 403, 'That path is outside this server.\n');
    return;
  }
  if (existsSync(full) && statSync(full).isDirectory()) full = join(full, 'index.html');
  if (!existsSync(full) || !statSync(full).isFile()) {
    sendStatus(res, 404, `Not found: ${req.url ?? '/'}\n`);
    return;
  }
  const info = statSync(full);
  res.writeHead(200, {
    'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(full)
    .on('error', () => sendStatus(res, 500, 'Read failed.\n'))
    .pipe(res);
}

createServer(handle).listen(PORT, () => {
  console.log(`Solara Bay at http://localhost:${PORT}/game/index.html`);
});
