/**
 * A shared world, as the relay sees it. architecture.md §8.
 *
 * The relay does not simulate, so a room is not a world — it is a command log,
 * a list of who is connected, and a record of what hash each of them last
 * reported. Everything a player experiences is reconstructed on their own
 * machine from the log, which is the point of the whole architecture.
 *
 * Written as a plain class with no transport in it so it can be tested
 * directly, driven from a WebSocket in the same process, or driven from a
 * headless authoritative simulation for anti-cheat, without any of those
 * knowing about each other.
 */

import {
  compareCommands, LATENCY_TICKS, type ServerMessage, type WireCommand,
} from './protocol.ts';

export interface RoomConfig {
  seed: number;
  size: number;
  townCount: number;
  companyCount: number;
}

export interface Player {
  id: number;
  name: string;
  spectator: boolean;
  /** Last hash this client reported, and at which tick. */
  lastHashTick: number;
  lastHash: number;
  /** Ticks the room has advanced without hearing from them. */
  silentFor: number;
}

/** How far apart two clients' hash reports may be before we stop comparing
 *  them. Hashes are only produced every 256 ticks, so anything inside one
 *  interval is a client mid-catch-up rather than a disagreement. */
export const HASH_INTERVAL = 256;

export class Room {
  readonly log: WireCommand[] = [];
  readonly players = new Map<number, Player>();
  /** Latest snapshot anybody has offered, for late joiners. */
  snapshot: { tick: number; blob: string } | null = null;
  /** The tick the room believes everybody has reached. Advanced by the
   *  fastest client, because in lockstep the slowest one is what everybody
   *  waits for and the relay's job is only to schedule far enough ahead. */
  tick = 0;

  private nextId = 1;
  private desyncs = 0;
  readonly name: string;
  readonly config: RoomConfig;

  // Written out rather than as constructor parameter properties, which the
  // project bans via erasableSyntaxOnly: they are TypeScript that emits
  // JavaScript, and everything here has to survive plain type-stripping.
  constructor(name: string, config: RoomConfig) {
    this.name = name;
    this.config = config;
  }

  /**
   * Let somebody in.
   *
   * A joiner is a spectator until a company is free, because the alternative
   * — refusing the connection — makes "can I watch?" and "the room is full"
   * the same error, and they are not the same thing. Spectating is a feature
   * the roadmap asks for, and it falls out of allowing this.
   */
  join(name: string): { player: Player; welcome: ServerMessage } {
    let seated = 0;
    for (const p of this.players.values()) if (!p.spectator) seated++;
    const player: Player = {
      id: this.nextId++,
      name,
      // Company 0 is the authority and company 1 is the first human seat.
      spectator: seated + 1 >= this.config.companyCount,
      lastHashTick: -1,
      lastHash: 0,
      silentFor: 0,
    };
    this.players.set(player.id, player);
    return {
      player,
      welcome: {
        t: 'welcome',
        you: player.id,
        room: this.name,
        seed: this.config.seed,
        size: this.config.size,
        townCount: this.config.townCount,
        companyCount: this.config.companyCount,
        tick: this.tick,
        log: this.log.slice(),
        snapshot: this.snapshot,
        players: this.roster(),
      },
    };
  }

  leave(id: number): void {
    this.players.delete(id);
  }

  roster(): { id: number; name: string; spectator: boolean }[] {
    return [...this.players.values()]
      .sort((a, b) => a.id - b.id)
      .map((p) => ({ id: p.id, name: p.name, spectator: p.spectator }));
  }

  /**
   * Accept commands from one client and schedule them.
   *
   * Two rules, and both matter more than they look.
   *
   * The tick is the relay's to decide, not the client's. A client that could
   * name its own tick could schedule into the past, which every other client
   * has already simulated past — an unfixable desync, and the easiest cheat
   * in a lockstep game to write.
   *
   * And a client may only issue commands as itself. This is the one game rule
   * the relay can enforce without knowing any of the game, so it enforces it:
   * everything else is the authoritative sim's problem.
   */
  submit(from: Player, commands: WireCommand[]): WireCommand[] {
    if (from.spectator) return [];
    const at = this.tick + LATENCY_TICKS;
    const accepted: WireCommand[] = [];
    for (const c of commands) {
      if (c.issuer !== from.id) continue;
      accepted.push({ ...c, tick: at });
    }
    accepted.sort(compareCommands);
    this.log.push(...accepted);
    return accepted;
  }

  /**
   * Note a client's rolling hash and say whether the room disagrees.
   *
   * Compared only against another client that reported the *same* tick.
   * Comparing across ticks would flag every client that is merely behind,
   * which during a late join is all of them.
   */
  report(from: Player, tick: number, hash: number): ServerMessage | null {
    from.lastHashTick = tick;
    from.lastHash = hash;
    from.silentFor = 0;
    for (const other of this.players.values()) {
      if (other.id === from.id || other.lastHashTick !== tick) continue;
      if (other.lastHash === hash) continue;
      this.desyncs++;
      return { t: 'desync', tick, yours: hash, theirs: other.lastHash };
    }
    return null;
  }

  /** How many times any two clients have disagreed. The Phase 5 gate is that
   *  this stays zero over a full era run. */
  get desyncCount(): number {
    return this.desyncs;
  }

  offerSnapshot(tick: number, blob: string): void {
    if (!this.snapshot || tick > this.snapshot.tick) this.snapshot = { tick, blob };
  }

  /** Move the room's clock to the furthest any client has reached. */
  advanceTo(tick: number): void {
    if (tick > this.tick) this.tick = tick;
  }
}
