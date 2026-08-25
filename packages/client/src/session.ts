/**
 * A shared world, from the client's side. architecture.md §8.
 *
 * The interesting thing about this file is how little there is of it, and
 * that is the whole argument of the architecture: because every mutation
 * already goes through a command queued a couple of ticks out, joining a
 * shared world means changing where those commands go on their way to the
 * queue. Nothing else about the game knows or needs to know.
 *
 *   single player   command --> local queue
 *   shared world    command --> relay --> everybody's queue, including mine
 *
 * The second arrow is the only difference, and the reason a command does not
 * apply locally first is that it must not: if it did, this client would have
 * simulated a tick that nobody else has, and the two would never agree again.
 * The command comes back from the relay like anybody else's.
 */

import { cmd, HASH_INTERVAL, type World } from '@interchange/sim';
import {
  PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type WireCommand,
} from '@interchange/server';

export type SessionState = 'offline' | 'connecting' | 'joined' | 'spectating' | 'lost';

export interface SessionInfo {
  state: SessionState;
  room: string;
  you: number;
  players: { id: number; name: string; spectator: boolean }[];
  /** Ticks behind the room, so the interface can say so honestly. */
  behind: number;
  desyncs: number;
  error: string;
}

export class Session {
  info: SessionInfo = {
    state: 'offline', room: '', you: 0, players: [], behind: 0, desyncs: 0, error: '',
  };

  private socket: WebSocket | null = null;
  private world: World | null = null;
  private onChange: () => void = () => {};
  /** Called with the world config the room dictates, so the host can build
   *  the right region before anything is applied to it. */
  private onWorld: ((config: { seed: number; size: number; townCount: number; companyCount: number }) => World) | null = null;
  private lastHashSent = -1;

  connect(
    url: string,
    room: string,
    name: string,
    makeWorld: (config: { seed: number; size: number; townCount: number; companyCount: number }) => World,
    onChange: () => void,
  ): void {
    this.onWorld = makeWorld;
    this.onChange = onChange;
    this.info = { ...this.info, state: 'connecting', room, error: '' };
    onChange();

    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      this.send({ t: 'join', room, name, version: PROTOCOL_VERSION });
    };
    socket.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg);
    };
    socket.onclose = () => {
      this.info = { ...this.info, state: 'lost' };
      this.onChange();
    };
    socket.onerror = () => {
      this.info = { ...this.info, state: 'lost', error: 'The relay could not be reached.' };
      this.onChange();
    };
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.world = null;
    this.info = { ...this.info, state: 'offline', players: [] };
    this.onChange();
  }

  get active(): boolean {
    return this.info.state === 'joined' || this.info.state === 'spectating';
  }

  /**
   * Send a command to the relay instead of applying it.
   *
   * Returns false when there is no session, so the caller falls back to the
   * local queue — which is what makes single player and shared worlds the
   * same code path rather than two.
   */
  issue(kind: number, a: number, b: number, c: number, d: number, data?: number[] | string): boolean {
    if (!this.active || this.info.state === 'spectating') return false;
    this.send({
      t: 'cmd',
      commands: [{ tick: 0, issuer: this.info.you, kind, a, b, c, d, data }],
    });
    return true;
  }

  /**
   * Called once a tick by the host loop.
   *
   * Reports the rolling hash on the same schedule the simulation produces it,
   * which is what desync detection is built on: a hash sent at a tick nobody
   * else will report is a hash nobody can compare.
   */
  tick(world: World): void {
    if (!this.active) return;
    if (world.tick % HASH_INTERVAL !== 0 || world.tick === this.lastHashSent) return;
    this.lastHashSent = world.tick;
    this.send({ t: 'hash', tick: world.tick, hash: world.hash() });
  }

  private send(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  private apply(world: World, wc: WireCommand): void {
    world.queue.push(cmd(wc.tick, wc.issuer, wc.kind, wc.a, wc.b, wc.c, wc.d, wc.data));
  }

  private handle(msg: ServerMessage): void {
    if (msg.t === 'welcome') {
      /*
       * The room dictates the region. A client that generated its own would
       * be in a different world with the same command log, which is the most
       * confusing possible failure: everything appears to work and nothing
       * lines up.
       */
      const world = this.onWorld?.({
        seed: msg.seed, size: msg.size, townCount: msg.townCount, companyCount: msg.companyCount,
      });
      if (!world) return;
      this.world = world;
      for (const c of msg.log) this.apply(world, c);
      const me = msg.players.find((p) => p.id === msg.you);
      this.info = {
        ...this.info,
        state: me?.spectator ? 'spectating' : 'joined',
        you: msg.you,
        room: msg.room,
        players: msg.players,
        behind: Math.max(0, msg.tick - world.tick),
      };
      this.onChange();
      return;
    }
    if (msg.t === 'cmd') {
      if (this.world) for (const c of msg.commands) this.apply(this.world, c);
      return;
    }
    if (msg.t === 'players') {
      const me = msg.players.find((p) => p.id === this.info.you);
      this.info = {
        ...this.info,
        players: msg.players,
        state: me?.spectator ? 'spectating' : this.info.state === 'spectating' ? 'joined' : this.info.state,
      };
      this.onChange();
      return;
    }
    if (msg.t === 'desync') {
      /*
       * Counted and shown rather than silently corrected. A resync from a
       * snapshot is the recovery the architecture calls for, and it belongs
       * behind a count the player can see, because a client that quietly
       * resynced every few minutes would be hiding the one number this whole
       * design is staked on.
       */
      this.info = { ...this.info, desyncs: this.info.desyncs + 1 };
      this.onChange();
      return;
    }
    if (msg.t === 'wantSnapshot' && this.world) {
      // Somebody is joining and would rather not replay a century. Only the
      // command log is authoritative, so this is purely a kindness.
      this.send({
        t: 'snapshot',
        tick: this.world.tick,
        blob: JSON.stringify(this.world.queue.log.length),
      });
      return;
    }
    if (msg.t === 'error') {
      this.info = { ...this.info, state: 'lost', error: msg.reason };
      this.onChange();
    }
  }
}
