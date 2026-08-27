/**
 * What a contract has paid, and giving it back.
 *
 * The board carried a rate per tonne and a count of loads, and a rate is a
 * *promise* rather than a result: two jobs at the same rate pay differently
 * because one is a longer round trip, one has a lorry that keeps waiting at a full
 * yard, and one was taken three weeks earlier. "How much you've made so far" is
 * the question a haulier asks about work in hand, and nothing in the game could
 * answer it.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, facilitiesFor, ContractState, NONE,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;

/** A district with a yard, a lorry, and money enough not to be the variable. */
function district() {
  const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 4 });
  w.tick = 60 * TICKS_PER_DAY;
  const o = w.planOpening();
  const yard = w.foundYard(Math.round(o.x), Math.round(o.y) + 2, 'Yard');
  const vi = w.openingVehicle(o.cargo);
  const veh = w.content.vehicles[vi];
  if (yard >= 0) {
    w.yards.add(yard, facilitiesFor({
      handling: veh.handling as readonly string[], cls: veh.class,
    }));
  }
  w.buyVehicleAtYard(vi, yard);
  w.companies.cash[w.player] = 5_000_000_00;
  w.refreshInfluence();
  /*
   * And a few days on the clock, because the board is not full at tick zero.
   * Offers appear as businesses fill their yards, which is a thing the simulation
   * does over time rather than a thing worldgen writes down.
   */
  for (let i = 0; i < 6 * TICKS_PER_DAY; i++) w.step();
  return w;
}

/** The first offer on the board that a lorry of ours could actually run. */
function takeable(w: ReturnType<typeof district>): number {
  const b = w.contractBoard;
  for (let i = 0; i < b.count; i++) {
    if (b.state[i] !== ContractState.Offered) continue;
    if (b.from[i] < 0 || b.to[i] < 0) continue;
    if (w.driversFor(i).some((d) => d.suitable)) return i;
  }
  return NONE;
}

describe('a contract that has never run', () => {
  it('has earned nothing and reports no daily rate', () => {
    /*
     * Zero rather than a division by zero, and worth pinning: `perDay` divides by
     * elapsed days, and a contract that was never taken has no start tick at all.
     * The first version of this arithmetic would have produced Infinity on the
     * offers tab, which renders as "£Infinity" and looks like a very good job.
     */
    const w = district();
    const id = takeable(w);
    expect(id).not.toBe(NONE);
    const e = w.contractEarned(id);
    expect(e.total).toBe(0);
    expect(e.perDay).toBe(0);
    expect(Number.isFinite(e.perDay)).toBe(true);
  });

  it('answers safely for an id that is not a contract', () => {
    const w = district();
    for (const id of [-1, 9999]) {
      const e = w.contractEarned(id);
      expect(e).toEqual({ total: 0, perDay: 0, days: 0 });
    }
  });
});

describe('a contract with a lorry on it', () => {
  it('earns money, and the earnings are its own rather than the fleet s', () => {
    /*
     * Run long enough for loads to actually arrive, then check the contract's own
     * total against the company's haulage income. They are not equal — the fleet
     * may be doing other work — but the contract cannot have earned *more* than
     * the company took, and it must have earned something.
     */
    const w = district();
    const id = takeable(w);
    expect(id).not.toBe(NONE);
    const free = w.driversFor(id).find((d) => d.suitable);
    expect(free).toBeTruthy();
    if (!free) return;
    expect(w.acceptContract(id, w.player, free.vehicle)).toBe(true);
    expect(w.contractBoard.tookTick[id]).toBeGreaterThan(0);

    for (let i = 0; i < 45 * TICKS_PER_DAY; i++) w.step();

    const e = w.contractEarned(id);
    expect(e.total, 'the contract earned something').toBeGreaterThan(0);
    expect(e.days, 'and knows how long it has been running').toBeGreaterThan(20);
    expect(e.perDay).toBeGreaterThan(0);
    // The arithmetic the panel prints has to be the arithmetic the panel means.
    expect(e.perDay).toBe(Math.round(e.total / e.days));
  });

  it('does not credit a load to a contract that is not running it', () => {
    // One lorry, one contract, so every other contract on the board must still
    // read zero after a long run. The scan that finds the contract from the
    // vehicle's service is the thing that could get this wrong.
    const w = district();
    const id = takeable(w);
    if (id === NONE) return;
    const free = w.driversFor(id).find((d) => d.suitable);
    if (!free) return;
    w.acceptContract(id, w.player, free.vehicle);
    for (let i = 0; i < 30 * TICKS_PER_DAY; i++) w.step();
    const b = w.contractBoard;
    for (let i = 0; i < b.count; i++) {
      if (i === id) continue;
      if (b.service[i] !== NONE && b.state[i] === ContractState.Running) continue;
      expect(b.earned[i], `contract ${i}`).toBe(0);
    }
  });
});

describe('giving a contract back', () => {
  it('frees the lorry and puts the work back on the board', () => {
    /*
     * Back on the board rather than closed, because the work still wants doing:
     * the farm still wants its milk moved. Closing it would quietly delete a job
     * from the district because the player changed their mind about one lorry.
     */
    const w = district();
    const id = takeable(w);
    expect(id).not.toBe(NONE);
    const free = w.driversFor(id).find((d) => d.suitable);
    expect(free).toBeTruthy();
    if (!free) return;
    w.acceptContract(id, w.player, free.vehicle);
    for (let i = 0; i < 10 * TICKS_PER_DAY; i++) w.step();

    expect(w.cancelContract(id).ok).toBe(true);
    expect(w.contractBoard.state[id]).toBe(ContractState.Offered);
    expect(w.contractBoard.service[id]).toBe(NONE);
    expect(w.vehicles.service[free.vehicle]).toBe(NONE);
    // And it can be taken on again, which is the point of putting it back.
    expect(w.driversFor(id).some((d) => d.suitable)).toBe(true);
  });

  it('costs nothing', () => {
    // A penalty would be the right rule in a game about reputation, and this one
    // has the planning board for that. Making every experiment expensive is how a
    // player stops experimenting.
    const w = district();
    const id = takeable(w);
    if (id === NONE) return;
    const free = w.driversFor(id).find((d) => d.suitable);
    if (!free) return;
    w.acceptContract(id, w.player, free.vehicle);
    const cash = w.companies.cash[w.player];
    expect(w.cancelContract(id).ok).toBe(true);
    expect(w.companies.cash[w.player]).toBe(cash);
  });

  it('refuses an offer you never took, and says which it is', () => {
    const w = district();
    const id = takeable(w);
    if (id === NONE) return;
    expect(w.cancelContract(id)).toEqual({
      ok: false, reason: 'You have not taken it on.',
    });
    expect(w.cancelContract(-1).ok).toBe(false);
  });

  it('resets the earnings, so the next taker starts from nothing', () => {
    const w = district();
    const id = takeable(w);
    if (id === NONE) return;
    const free = w.driversFor(id).find((d) => d.suitable);
    if (!free) return;
    w.acceptContract(id, w.player, free.vehicle);
    for (let i = 0; i < 30 * TICKS_PER_DAY; i++) w.step();
    expect(w.contractBoard.earned[id]).toBeGreaterThan(0);
    w.cancelContract(id);
    expect(w.contractBoard.earned[id]).toBe(0);
    expect(w.contractEarned(id).perDay).toBe(0);
  });
});
