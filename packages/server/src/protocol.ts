/**
 * The wire protocol for a shared world. architecture.md §8.
 *
 * The whole of multiplayer here is a consequence of one decision made in
 * Phase 0: the simulation is deterministic lockstep, so a shared world does
 * not need a server that simulates. It needs a post box that puts commands in
 * an agreed order and hands the same list to everybody. That is the entire
 * job, and it is why the roadmap calls this phase small.
 *
 * Two things follow that are worth stating, because they look like omissions.
 *
 * The relay never sends world state, only commands. A join therefore needs
 * either the whole command log from tick zero — cheap, since a whole game is
 * a couple of kilobytes — or a snapshot, and the log is authoritative in
 * either case. A relay that streamed state would be the naive architecture
 * this project rejected on the first page of architecture.md.
 *
 * And the relay does not validate the *game*. It cannot: it does not know the
 * rules and deliberately holds none of them, so anti-cheat is a headless
 * authoritative sim running the same TypeScript, which is a separate thing
 * that happens to speak the same protocol. What the relay does enforce is the
 * one rule it can see from here — that a client may only issue commands as
 * itself.
 */

/** Bumped when the shape below changes in a way an old client cannot read. */
export const PROTOCOL_VERSION = 1;

/**
 * How far ahead of the current tick a command is scheduled.
 *
 * This is the latency budget, and it is the only number in multiplayer that
 * is a genuine trade-off rather than a consequence: raise it and every action
 * feels heavier, lower it and a slow connection starts arriving late, which
 * in lockstep means everybody waits. Twelve ticks is about six hundred
 * milliseconds at twenty hertz, which covers most domestic connections
 * without the delay reading as sluggishness in a game where the fastest
 * interaction is placing a road.
 */
export const LATENCY_TICKS = 12;

/** A command as it travels. Deliberately the same four integers plus payload
 *  the simulation already uses — the wire format is the command model. */
export interface WireCommand {
  tick: number;
  issuer: number;
  kind: number;
  a: number;
  b: number;
  c: number;
  d: number;
  data?: number[] | string;
}

export type ClientMessage =
  /** Asking to be let in. */
  | { t: 'join'; room: string; name: string; version: number }
  /** Commands this client wants applied. Tick is advisory; the relay decides. */
  | { t: 'cmd'; commands: WireCommand[] }
  /** The rolling state hash, for desync detection. */
  | { t: 'hash'; tick: number; hash: number }
  /** A snapshot this client is offering, so a late joiner need not replay. */
  | { t: 'snapshot'; tick: number; blob: string }
  /** Keep-alive. */
  | { t: 'ping' };

export type ServerMessage =
  /** You are in. Everything needed to start simulating. */
  | {
    t: 'welcome';
    you: number;
    room: string;
    seed: number;
    size: number;
    townCount: number;
    companyCount: number;
    tick: number;
    /** Every command so far, so a joiner can catch up by replaying. */
    log: WireCommand[];
    /** A snapshot to start from instead, when one is available. */
    snapshot: { tick: number; blob: string } | null;
    players: { id: number; name: string; spectator: boolean }[];
  }
  /** Commands, ordered and scheduled. Everybody gets the same list. */
  | { t: 'cmd'; commands: WireCommand[] }
  /** Somebody joined or left. */
  | { t: 'players'; players: { id: number; name: string; spectator: boolean }[] }
  /** Your hash disagrees with the room's. Resync. */
  | { t: 'desync'; tick: number; yours: number; theirs: number }
  /** Somebody please send a snapshot; there is a joiner waiting. */
  | { t: 'wantSnapshot'; tick: number }
  | { t: 'pong' }
  | { t: 'error'; reason: string };

/**
 * Order two commands the same way on every machine.
 *
 * This is the whole of the relay's authority and it has to be a total order
 * with no ties, because two clients that apply the same two commands in
 * different orders have desynced and will not find out for up to two hundred
 * and fifty-six ticks. Tick first, then issuer, then kind, then the payload
 * fields — by the time all of those match, the commands are identical and the
 * order between them cannot be observed.
 */
export function compareCommands(x: WireCommand, y: WireCommand): number {
  return x.tick - y.tick
    || x.issuer - y.issuer
    || x.kind - y.kind
    || x.a - y.a
    || x.b - y.b
    || x.c - y.c
    || x.d - y.d;
}
