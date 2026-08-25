/**
 * The relay itself: WebSockets in, ordered commands out. architecture.md §8.
 *
 * Everything interesting is in room.ts. This is the transport, kept separate
 * so the rules of a shared world can be tested without opening a socket, and
 * so the same room can be driven by the headless authoritative simulation.
 *
 *   node packages/server/src/relay.ts [port]
 *
 * Uses `node:http` and a minimal RFC 6455 frame codec rather than a WebSocket
 * dependency. That is not asceticism: this project has no runtime
 * dependencies outside Three and React, and a relay that does nothing but
 * order small JSON messages does not justify becoming the first.
 */

import { createServer, type IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { Room, type Player } from './room.ts';
import {
  PROTOCOL_VERSION, type ClientMessage, type ServerMessage,
} from './protocol.ts';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ------------------------------------------------------------ frame codec

/** Encode one text frame. Payloads here are small JSON, so no fragmentation
 *  and no compression — both would be complexity for no gain. */
function encode(text: string): Buffer {
  const body = Buffer.from(text, 'utf8');
  const n = body.length;
  let header: Buffer;
  if (n < 126) {
    header = Buffer.from([0x81, n]);
  } else if (n < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(n, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([header, body]);
}

/**
 * Pull whole frames out of a buffer, returning what is left over.
 *
 * A socket hands over bytes, not messages, so a frame can arrive in pieces or
 * three can arrive together. Getting this wrong produces a relay that works
 * on a fast local connection and corrupts commands over a real one, which is
 * the worst possible failure mode for lockstep: a corrupted command is a
 * desync nobody can reproduce.
 */
function decode(buf: Buffer): { messages: string[]; rest: Buffer; closed: boolean } {
  const messages: string[] = [];
  let closed = false;
  let at = 0;
  for (;;) {
    if (buf.length - at < 2) break;
    const opcode = buf[at] & 0x0f;
    const masked = (buf[at + 1] & 0x80) !== 0;
    let len = buf[at + 1] & 0x7f;
    let offset = at + 2;
    if (len === 126) {
      if (buf.length - at < 4) break;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length - at < 10) break;
      len = Number(buf.readBigUInt64BE(offset));
      offset += 8;
    }
    const maskKey = offset;
    if (masked) offset += 4;
    if (buf.length - offset < len) break;
    if (opcode === 0x8) {
      closed = true;
      at = offset + len;
      break;
    }
    const body = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) {
      body[i] = masked ? buf[offset + i] ^ buf[maskKey + (i & 3)] : buf[offset + i];
    }
    if (opcode === 0x1) messages.push(body.toString('utf8'));
    at = offset + len;
  }
  return { messages, rest: buf.subarray(at), closed };
}

// ------------------------------------------------------------------ relay

interface Connection {
  socket: Duplex;
  room: Room | null;
  player: Player | null;
  buffer: Buffer;
}

export class Relay {
  readonly rooms = new Map<string, Room>();
  private connections = new Set<Connection>();

  /** Rooms are created on first join. There is no lobby and no room list:
   *  a room is a name two people agree on, which is the least ceremony that
   *  works and the easiest thing to put in a URL. */
  roomFor(name: string, seed: number): Room {
    let room = this.rooms.get(name);
    if (!room) {
      room = new Room(name, { seed, size: 384, townCount: 14, companyCount: 5 });
      this.rooms.set(name, room);
    }
    return room;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const conn: Connection = { socket, room: null, player: null, buffer: head ?? Buffer.alloc(0) };
    this.connections.add(conn);
    socket.on('data', (chunk: Buffer) => this.onData(conn, chunk));
    socket.on('close', () => this.onClose(conn));
    socket.on('error', () => this.onClose(conn));
  }

  private onData(conn: Connection, chunk: Buffer): void {
    conn.buffer = Buffer.concat([conn.buffer, chunk]);
    const { messages, rest, closed } = decode(conn.buffer);
    conn.buffer = rest;
    for (const text of messages) {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(text) as ClientMessage;
      } catch {
        continue;
      }
      this.onMessage(conn, msg);
    }
    if (closed) this.onClose(conn);
  }

  private send(conn: Connection, msg: ServerMessage): void {
    if (conn.socket.destroyed) return;
    conn.socket.write(encode(JSON.stringify(msg)));
  }

  private broadcast(room: Room, msg: ServerMessage, except?: Connection): void {
    for (const c of this.connections) {
      if (c.room !== room || c === except) continue;
      this.send(c, msg);
    }
  }

  private onMessage(conn: Connection, msg: ClientMessage): void {
    if (msg.t === 'ping') {
      this.send(conn, { t: 'pong' });
      return;
    }
    if (msg.t === 'join') {
      if (msg.version !== PROTOCOL_VERSION) {
        this.send(conn, { t: 'error', reason: `Protocol ${PROTOCOL_VERSION} required.` });
        return;
      }
      // The room's seed comes from whoever opened it. Everybody after that
      // gets told what it is, because the seed is half of what determines the
      // world and a client that picked its own would be in a different one.
      const room = this.roomFor(msg.room, hashSeed(msg.room));
      const { player, welcome } = room.join(msg.name || 'Player');
      conn.room = room;
      conn.player = player;
      this.send(conn, welcome);
      this.broadcast(room, { t: 'players', players: room.roster() });
      /*
       * If the joiner has a long way to catch up, ask somebody for a snapshot.
       * Replaying is always correct — the log is authoritative — but replaying
       * a century takes a moment, and a player waiting on a progress bar for
       * a thing that could have been sent to them is a poor first impression.
       */
      if (room.tick > 20000 && (!room.snapshot || room.tick - room.snapshot.tick > 20000)) {
        this.broadcast(room, { t: 'wantSnapshot', tick: room.tick }, conn);
      }
      return;
    }

    const room = conn.room;
    const player = conn.player;
    if (!room || !player) return;

    if (msg.t === 'cmd') {
      const accepted = room.submit(player, msg.commands);
      if (accepted.length > 0) this.broadcast(room, { t: 'cmd', commands: accepted });
      return;
    }
    if (msg.t === 'hash') {
      room.advanceTo(msg.tick);
      const problem = room.report(player, msg.tick, msg.hash);
      if (problem) this.send(conn, problem);
      return;
    }
    if (msg.t === 'snapshot') {
      room.offerSnapshot(msg.tick, msg.blob);
    }
  }

  private onClose(conn: Connection): void {
    if (!this.connections.delete(conn)) return;
    if (conn.room && conn.player) {
      conn.room.leave(conn.player.id);
      this.broadcast(conn.room, { t: 'players', players: conn.room.roster() });
    }
    conn.socket.destroy();
  }
}

/** A stable seed from a room name, so two people who agree on a name get the
 *  same region without anybody having to send a number. */
export function hashSeed(name: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 100000;
}

// ------------------------------------------------------------------- main

const isMain = process.argv[1]?.endsWith('relay.ts');
if (isMain) {
  const port = Number(process.argv[2] ?? 8787);
  const relay = new Relay();
  const server = createServer((req, res) => {
    // CORS on the health endpoint only: it is the one thing a page served
    // from somewhere else might reasonably ask for, and the socket does its
    // own origin handling through the upgrade.
    res.setHeader('access-control-allow-origin', '*');
    if (req.url === '/health') {
      const rooms = [...relay.rooms.values()].map((r) => ({
        name: r.name, players: r.players.size, tick: r.tick, desyncs: r.desyncCount,
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, rooms }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket as Duplex, head));
  server.listen(port, () => {
    process.stdout.write(`Interchange relay listening on ${port}\n`);
  });
}
