/**
 * One process serving the built client and the relay on the same origin.
 *
 * Two servers would mean two tunnels, two hostnames and a cross-origin
 * WebSocket, which is three problems in exchange for a separation nothing
 * needs: the relay holds no game state and the static files hold no secrets.
 * On one origin the client can derive its relay address from its own location,
 * which is why the start card's default just works.
 *
 *   node packages/server/src/serve.ts [port] [dist]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { Relay } from './relay.ts';
import { PROTOCOL_VERSION } from './protocol.ts';

const port = Number(process.argv[2] ?? 8080);
const root = process.argv[3] ?? 'packages/client/dist';
const relay = new Relay();

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/health') {
    const rooms = [...relay.rooms.values()].map((r) => ({
      name: r.name, players: r.players.size, tick: r.tick, desyncs: r.desyncCount,
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, rooms }));
    return;
  }
  // Anything that is not a file is the app: this is a single page and the
  // routing is all in the query string.
  // Strip leading separators after normalising, so a path cannot climb out
  // of the served directory.
  let rel = normalize(url === '/' ? '/index.html' : url);
  while (rel.startsWith('/') || rel.startsWith(sep)) rel = rel.slice(1);
  const path = join(root, rel);
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(root, 'index.html'));
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  }
});

server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket as Duplex, head));
server.listen(port, () => {
  process.stdout.write(`Interchange serving ${root} and relaying on ${port}\n`);
});
