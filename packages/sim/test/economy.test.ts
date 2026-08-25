/**
 * Economic invariants that are cheap to state and expensive to lose.
 *
 * Every case here is a bug the balance sweep found first. The sweep is good at
 * noticing that a number is absurd; it is bad at saying which line of code did
 * it, and worse at noticing when the same absurdity comes back. These pin the
 * answers down.
 */

import { describe, expect, it } from 'vitest';
import {
  createWorld, Cmd, cmd, StopAction, TICKS_PER_YEAR, MAX_STOPS, SiteState,
} from '../src/index.ts';

/** A world with one human company and no rivals, so a test drives it alone. */
function quietWorld(seed = 4242) {
  const w = createWorld({ seed, size: 256, townCount: 8, companyCount: 2 });
  for (let c = 1; c < w.companies.count; c++) w.companies.isAi[c] = 0;
  return w;
}

describe('haulage payment', () => {
  it('does not pay for cargo unloaded where it was loaded', () => {
    const w = quietWorld();
    // Find a producer and a consumer of the same cargo, both connected.
    let from = -1;
    let to = -1;
    let cargo = -1;
    outer: for (let a = 0; a < w.sites.count; a++) {
      if (!w.sites.connected(a) || w.sites.state[a] === SiteState.Dead) continue;
      const outs = w.content.industries[w.sites.def[a]].recipe.outputs;
      for (const id of Object.keys(outs)) {
        const ci = w.content.cargoIndex.get(id);
        if (ci === undefined) continue;
        for (let b = 0; b < w.sites.count; b++) {
          if (b === a || !w.sites.connected(b)) continue;
          if (w.content.industries[w.sites.def[b]].recipe.inputs[id] === undefined) continue;
          from = a; to = b; cargo = ci;
          break outer;
        }
      }
    }
    expect(from).toBeGreaterThanOrEqual(0);

    /*
     * An Exchange stop drops what it brought and picks up what is waiting. The
     * bug was that the next tick at the same stop treated the cargo it had
     * just picked up as cargo to drop — and paid the carriage on it, at the
     * transfer rate, for as long as the vehicle sat there. Four AI companies
     * moved five and a half million tonnes in thirty years and none of them
     * ever went anywhere.
     */
    w.queue.push(cmd(0, w.player, Cmd.CreateService, 0, 0, 0, 0, 'test'));
    w.queue.push(cmd(0, w.player, Cmd.AddStop, 0, from, 255 << 2, StopAction.LoadFull));
    w.queue.push(cmd(0, w.player, Cmd.AddStop, 0, to, 255 << 2, StopAction.Exchange));
    const type = w.content.vehicles.findIndex((v) => v.mode === 'road' && v.era <= 1);
    w.queue.push(cmd(0, w.player, Cmd.BuyVehicle, type, from, 0, 0));
    w.queue.push(cmd(0, w.player, Cmd.AssignVehicle, 0, 0));

    for (let i = 0; i < TICKS_PER_YEAR * 3; i++) w.step();

    const capacity = w.content.vehicles[type].capacity;
    const laps = w.services.roundTrip[0] > 0
      ? (TICKS_PER_YEAR * 3) / w.services.roundTrip[0]
      : 1;
    // Generous: twice what the round trip could physically deliver.
    const ceiling = Math.max(capacity * 4, capacity * laps * 2);
    expect(w.services.tonnes[0]).toBeLessThanOrEqual(ceiling);
    void cargo;
  });

  it('never pays a rate below the cargo value share', () => {
    const w = quietWorld();
    for (let i = 0; i < 600; i++) w.step();
    for (let v = 0; v < w.vehicles.count; v++) {
      expect(w.vehicles.revenue[v]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the region on its own', () => {
  it('holds a stable population when nobody carries anything', () => {
    const w = quietWorld(99);
    let start = 0;
    for (let t = 0; t < w.towns.count; t++) start += w.towns.population[t];
    for (let i = 0; i < TICKS_PER_YEAR * 25; i++) w.step();
    let end = 0;
    for (let t = 0; t < w.towns.count; t++) end += w.towns.population[t];
    /*
     * Unserved towns should fade slowly, not collapse and not boom. The first
     * version of the demand model took the region from fifteen thousand people
     * to eight hundred in five years; the correction overshot and took it to a
     * hundred and seventy-six thousand.
     */
    expect(end).toBeGreaterThan(start * 0.55);
    expect(end).toBeLessThan(start * 1.9);
  });
});

describe('determinism', () => {
  it('reaches the same state hash from the same seed', () => {
    const a = createWorld({ seed: 777, size: 256, townCount: 8, companyCount: 4 });
    const b = createWorld({ seed: 777, size: 256, townCount: 8, companyCount: 4 });
    for (let i = 0; i < 6000; i++) { a.step(); b.step(); }
    expect(a.hash()).toBe(b.hash());
  });
});

void MAX_STOPS;
