/**
 * 開発用の静的サーバー（依存なし）
 *   node tools/serve.mjs            → http://localhost:4173
 *   node tools/serve.mjs 5173
 *
 * ES Modules は file:// だと動かないので、確認は必ず http 経由で行う。
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

export function createStaticServer({ root = ROOT } = {}) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const filePath = resolve(join(root, normalize(pathname)));
      if (!filePath.startsWith(root + sep) && filePath !== root) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const info = await stat(filePath);
      if (info.isDirectory()) {
        res.writeHead(302, { Location: `${pathname}/` }).end();
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    }
  });
}

export async function startServer({ root = ROOT, port = 0 } = {}) {
  const server = createStaticServer({ root });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolvePromise);
  });
  const { port: actualPort } = server.address();
  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.argv[2] ?? 4173);
  const { url } = await startServer({ port });
  console.log(`SHOOTOUT 4 → ${url}`);
}
