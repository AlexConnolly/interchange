/**
 * The relay's rules, which are few but load-bearing.
 *
 * Everything here protects lockstep. A relay that lets a client name its own
 * tick, or issue as somebody else, or that orders two commands differently for
 * two clients, produces a desync that shows up hundreds of ticks later with no
 * trace of what caused it — which is the single worst failure mode this
 * project has.
 */

import { describe, expect, it } from 'vitest';
import { Room } from '../src/room.ts';
import { compareCommands, LATENCY_TICKS, type WireCommand } from '../src/protocol.ts';

const config = { seed: 42, size: 256, townCount: 8, companyCount: 3 };

function command(over: Partial<WireCommand> = {}): WireCommand {
  return { tick: 0, issuer: 1, kind: 10, a: 0, b: 0, c: 0, d: 0, ...over };
}

describe('joining', () => {
  it('seats players until the companies run out, then seats spectators', () => {
    const room = new Room('r', config);
    // companyCount 3 means the authority plus two humans.
    const a = room.join('A').player;
    const b = room.join('B').player;
    const c = room.join('C').player;
    expect(a.spectator).toBe(false);
    expect(b.spectator).toBe(false);
    expect(c.spectator).toBe(true);
  });

  it('hands a joiner the whole log so it can catch up by replaying', () => {
    const room = new Room('r', config);
    const a = room.join('A').player;
    room.advanceTo(500);
    room.submit(a, [command({ issuer: a.id })]);

    const { welcome } = room.join('B');
    expect(welcome.t).toBe('welcome');
    if (welcome.t !== 'welcome') return;
    expect(welcome.log.length).toBe(1);
    expect(welcome.seed).toBe(config.seed);
    expect(welcome.tick).toBe(500);
  });

  it('offers a snapshot when one has been given, so a late joiner need not replay a century', () => {
    const room = new Room('r', config);
    room.advanceTo(100000);
    room.offerSnapshot(99000, 'blob');
    const { welcome } = room.join('Late');
    if (welcome.t !== 'welcome') throw new Error('expected welcome');
    expect(welcome.snapshot).toEqual({ tick: 99000, blob: 'blob' });
  });

  it('keeps the newest snapshot offered', () => {
    const room = new Room('r', config);
    room.offerSnapshot(500, 'old');
    room.offerSnapshot(200, 'older');
    room.offerSnapshot(900, 'new');
    expect(room.snapshot?.tick).toBe(900);
  });
});

describe('commands', () => {
  it('schedules into the future by the latency budget, whatever the client asked for', () => {
    const room = new Room('r', config);
    const a = room.join('A').player;
    room.advanceTo(1000);
    // A client trying to schedule into the past, which every other client has
    // already simulated through. Unfixable if allowed, so it is not.
    const out = room.submit(a, [command({ issuer: a.id, tick: 5 })]);
    expect(out.length).toBe(1);
    expect(out[0].tick).toBe(1000 + LATENCY_TICKS);
  });

  it('refuses a command issued as somebody else', () => {
    const room = new Room('r', config);
    const a = room.join('A').player;
    const b = room.join('B').player;
    const out = room.submit(a, [command({ issuer: b.id })]);
    expect(out).toEqual([]);
    expect(room.log.length).toBe(0);
  });

  it('refuses commands from a spectator', () => {
    const room = new Room('r', config);
    room.join('A');
    room.join('B');
    const watcher = room.join('C').player;
    expect(watcher.spectator).toBe(true);
    expect(room.submit(watcher, [command({ issuer: watcher.id })])).toEqual([]);
  });

  it('orders identical-tick commands identically however they arrive', () => {
    const one = [
      command({ issuer: 2, kind: 5 }),
      command({ issuer: 1, kind: 9 }),
      command({ issuer: 1, kind: 5, a: 2 }),
      command({ issuer: 1, kind: 5, a: 1 }),
    ];
    const other = [one[3], one[0], one[2], one[1]];
    const key = (xs: WireCommand[]) => xs.slice().sort(compareCommands)
      .map((c) => `${c.issuer}/${c.kind}/${c.a}`).join(' ');
    expect(key(one)).toBe(key(other));
    expect(key(one)).toBe('1/5/1 1/5/2 1/9/0 2/5/0');
  });
});

describe('desync detection', () => {
  it('says nothing while everybody agrees', () => {
    const room = new Room('r', config);
    const a = room.join('A').player;
    const b = room.join('B').player;
    expect(room.report(a, 256, 12345)).toBeNull();
    expect(room.report(b, 256, 12345)).toBeNull();
    expect(room.desyncCount).toBe(0);
  });

  it('reports a disagreement at the same tick', () => {
    const room = new Room('r', config);
    const a = room.join('A').player;
    const b = room.join('B').player;
    room.report(a, 256, 111);
    const problem = room.report(b, 256, 222);
    expect(problem?.t).toBe('desync');
    expect(room.desyncCount).toBe(1);
  });

  it('does not mistake a client that is merely behind for a desync', () => {
    const room = new Room('r', config);
    const a = room.join('A').player;
    const b = room.join('B').player;
    room.report(a, 512, 111);
    // B is still catching up and is reporting an older tick entirely.
    expect(room.report(b, 256, 999)).toBeNull();
    expect(room.desyncCount).toBe(0);
  });
});
