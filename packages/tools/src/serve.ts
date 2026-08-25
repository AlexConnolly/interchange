/**
 * Serve the built client. Nothing else.
 *
 *   node packages/tools/src/serve.ts [port] [dir]
 *
 * This replaces `packages/server`, which was 639 lines: a WebSocket relay, a
 * room registry, a command-ordering protocol and desync detection, with static
 * file serving attached to the side of it. All of that went with multiplayer
 * (`cut.md`), and what is actually needed to put the game in front of somebody
 * is this.
 *
 * Deliberately dependency-free and deliberately not a dev server. Vite's own
 * `preview` would do, and a separate file exists because the cloudflared
 * tunnel wants one long-lived process with a predictable port, and because a
 * thing you deploy should not be a mode of a build tool.
 */

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.argv[2] ?? 4173);
const root = resolve(process.argv[3] ?? 'packages/client/dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  /*
   * Resolve inside the root and check it, rather than trusting the join.
   *
   * `..` in a request path is the oldest hole in static file serving and it is
   * one line to close. The tunnel makes this reachable from the internet, so
   * "it is only a dev server" stops being true the moment it is running.
   */
  const wanted = resolve(join(root, normalize(url)));
  const target = wanted.startsWith(root) ? wanted : root;

  let path = target;
  try {
    if (statSync(path).isDirectory()) path = join(path, 'index.html');
  } catch {
    // Single-page app: an unknown path is a route, not a missing file.
    path = join(root, 'index.html');
  }

  try {
    statSync(path);
  } catch {
    res.writeHead(404).end('not found');
    return;
  }

  res.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    // No caching. The whole point of this process is that somebody reloads it
    // after a rebuild and sees the rebuild.
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(res);
}).listen(port, () => {
  console.log(`serving ${root} on http://localhost:${port}`);
});
