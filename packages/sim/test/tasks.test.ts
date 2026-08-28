/**
 * Tasks: standing runs of your own, with no contract behind them.
 *
 * "A contract is a task, but a task is not a contract." A contract is somebody
 * else's work — a payer, a rate, an end. A task is an instruction of yours: move
 * this from here to there, until told otherwise.
 *
 * The reason the distinction had to be named is a bug in a real game. Buying the
 * place a contract delivers to closes the contract, correctly — you cannot hold a
 * contract with yourself — and leaves the lorry running, deliberately. But the
 * lorry then appeared on no screen: "my tipper is definitely going between my
 * livestock farm and the abattoir but the business doesn't seem to know about the
 * vehicle anymore." The work was real and had no name, so nothing could list it.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, facilitiesFor, ContractState, NONE,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

/** A district with a yard, a lorry, and money enough not to be the variable. */
function district() {
  const w = createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 4 });
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
  w.companies.cash[w.player] = 500_000_000_00;
  w.refreshInfluence();
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

describe('a contract you have taken on', () => {
  it('is not a task, because a contract is already listed as a contract', () => {
    /*
     * The half of the rule that stops the same lorry appearing twice. Both lists
     * answer "what is my fleet doing", so a run under contract must be in exactly
     * one of them — and it is the contract list, because that is the one with the
     * money on it.
     */
    const w = district();
    const id = takeable(w);
    expect(id).not.toBe(NONE);
    const free = w.driversFor(id).find((d) => d.suitable);
    expect(free).toBeTruthy();
    if (!free) return;
    expect(w.acceptContract(id, w.player, free.vehicle)).toBe(true);

    const svc = w.contractBoard.service[id];
    expect(svc).not.toBe(NONE);
    expect(w.tasks().some((t) => t.service === svc)).toBe(false);
  });
});

describe('buying the place a contract delivers to', () => {
  it('leaves the work visible as a task rather than as nothing at all', () => {
    /*
     * The bug, as a test. Before tasks existed the assertions below the purchase
     * were all unanswerable: the contract closed, the lorry kept driving, and
     * there was no call in the whole simulation that would tell you it was there.
     */
    const w = district();
    const id = takeable(w);
    expect(id).not.toBe(NONE);
    const free = w.driversFor(id).find((d) => d.suitable);
    expect(free).toBeTruthy();
    if (!free) return;
    expect(w.acceptContract(id, w.player, free.vehicle)).toBe(true);

    const b = w.contractBoard;
    const from = b.from[id];
    const to = b.to[id];
    const cargo = b.cargo[id];
    const svc = b.service[id];

    for (let i = 0; i < 10 * TICKS_PER_DAY; i++) w.step();

    // Buy the far end, which is what closes the contract.
    expect(w.buySite(to).ok, 'the destination could be bought').toBe(true);
    expect(b.state[id], 'and the contract closes, because it is now with yourself')
      .toBe(ContractState.Closed);

    // The lorry is still on it. That was always true and was never the problem.
    const stillDriving = [...Array(w.vehicles.count).keys()]
      .filter((v) => w.vehicles.alive[v] && w.vehicles.service[v] === svc);
    expect(stillDriving.length, 'the lorry keeps running').toBe(1);

    // And now the work has a name and a home.
    const mine = w.tasks().find((t) => t.service === svc);
    expect(mine, 'the orphaned run is a task').toBeTruthy();
    if (!mine) return;
    expect(mine.from).toBe(from);
    expect(mine.to).toBe(to);
    expect(mine.cargo).toBe(cargo);
    expect(mine.vehicle).toBe(stillDriving[0]);
  });

  it('reports the task in tonnes, because there is nobody paying for it', () => {
    /*
     * The figure the panel prints. A delivery into a place you own moves no money
     * at the moment of unloading — quite right, it is your own shelf — so a task
     * measured in money reads as a lorry doing nothing. Measured in tonnage it
     * reads as a lorry working, which is what it is.
     */
    const w = district();
    const id = takeable(w);
    expect(id).not.toBe(NONE);
    const free = w.driversFor(id).find((d) => d.suitable);
    if (!free) return;
    expect(w.acceptContract(id, w.player, free.vehicle)).toBe(true);
    const svc = w.contractBoard.service[id];
    expect(w.buySite(w.contractBoard.to[id]).ok).toBe(true);

    for (let i = 0; i < 30 * TICKS_PER_DAY; i++) w.step();

    const c = w.taskCarried(svc);
    expect(c.tonnes, 'it has carried something').toBeGreaterThan(0);
    expect(c.days, 'and knows how long for').toBeGreaterThan(20);
    expect(c.perDay).toBeGreaterThan(0);
    // The arithmetic the panel prints has to be the arithmetic the panel means.
    expect(c.perDay).toBeCloseTo(c.tonnes / c.days, 6);
  });

  it('answers safely for a service that is not one', () => {
    const w = district();
    for (const svc of [-1, 99999]) {
      expect(w.taskCarried(svc)).toEqual({ tonnes: 0, perDay: 0, days: 0 });
    }
  });
});

describe('a run you set up yourself', () => {
  it('is a task from the moment it exists', () => {
    /*
     * Tasks are not only what contracts decay into. Buy production, arrange a
     * supply run from the sourcing screen, and that is a task too — same
     * mechanism, entered by the front door.
     */
    const w = district();
    const id = takeable(w);
    expect(id).not.toBe(NONE);
    const b = w.contractBoard;
    const from = b.from[id];
    const to = b.to[id];
    const cargo = b.cargo[id];
    expect(w.buySite(from).ok, 'the origin could be bought').toBe(true);

    const before = w.tasks().length;
    expect(w.supply(from, to, cargo), 'the run was set up').toBe(true);
    const after = w.tasks();
    expect(after.length).toBe(before + 1);
    const fresh = after.find((t) => t.from === from && t.to === to && t.cargo === cargo);
    expect(fresh, 'and it is listed as a task').toBeTruthy();
  });

  it('stops being a task when the lorry comes off it', () => {
    const w = district();
    const id = takeable(w);
    expect(id).not.toBe(NONE);
    const b = w.contractBoard;
    const from = b.from[id];
    expect(w.buySite(from).ok).toBe(true);
    expect(w.supply(from, b.to[id], b.cargo[id])).toBe(true);
    const t = w.tasks().find((x) => x.from === from);
    expect(t).toBeTruthy();
    if (!t) return;

    expect(w.endRun(t.service)).toBe(true);
    expect(w.tasks().some((x) => x.service === t.service)).toBe(false);
  });
});
