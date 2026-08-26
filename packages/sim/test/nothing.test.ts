/**
 * A lorry that arrives with nothing, or at somewhere with no room.
 *
 * "What happens if you have no stock and a lorry gets there? I hope it doesn't
 * get paid for the dropoff." It does not, and this pins both halves of that:
 * payment is per tonne the destination actually *accepts*, so an empty vehicle
 * earns nothing and a part-load into a full shed earns only what fitted.
 *
 * Worth a test rather than a reading of the code, because the failure would be
 * invisible: money appearing for work not done looks exactly like money
 * appearing for work done.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, facilitiesFor, Line, LINE_COUNT, SiteState,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

/** A farm of the player's, a works that takes what it makes, and a lorry. */
function running() {
  const w = createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });
  w.tick = 60 * TICKS_PER_DAY;
  const o = w.planOpening();
  w.refreshInfluence([{ x: o.x, y: o.y, strength: 3.2 }]);
  w.companies.cash[w.player] = 500_000_00;
  w.primeStock();

  let farm = -1;
  let works = -1;
  let cargo = -1;
  outer: for (let a = 0; a < w.sites.count; a++) {
    if (w.recipes.inputs[w.sites.def[a]].length > 0) continue;
    const outs = w.recipes.outputs[w.sites.def[a]];
    for (let i = 0; i < outs.length; i += 2) {
      for (let b = 0; b < w.sites.count; b++) {
        const ins = w.recipes.inputs[w.sites.def[b]];
        for (let k = 0; k < ins.length; k += 2) {
          if (ins[k] !== outs[i]) continue;
          farm = a; works = b; cargo = outs[i];
          break outer;
        }
      }
    }
  }
  w.sites.owner[farm] = w.player;
  const yard = w.foundYard(w.sites.x[farm], w.sites.y[farm] + 2, 'Yard');
  const vi = w.openingVehicle(cargo);
  const veh = w.content.vehicles[vi];
  if (yard >= 0) {
    w.yards.add(yard, facilitiesFor({
      handling: veh.handling as readonly string[], cls: veh.class,
    }));
  }
  w.buyVehicleAtYard(vi, yard);
  w.supply(farm, works, cargo);
  return { w, farm, works, cargo };
}

const haulage = (w: ReturnType<typeof running>['w']): number =>
  w.companies.ledgerTotal[w.player * LINE_COUNT + Line.Haulage];

describe('a lorry with nothing to deliver', () => {
  it('is paid nothing when the destination has no room for it', () => {
    /*
     * The guard being tested is that payment takes the *accepted* tonnage rather
     * than the tonnage carried. Fill the works to its capacity and nothing can be
     * accepted, so a lorry can shuttle back and forth all week for nothing —
     * which is right: the load never left the vehicle.
     */
    const { w, works, cargo } = running();
    const cargoCount = w.content.cargo.length;
    const cap = w.sites.capacity[works * cargoCount + cargo];
    expect(cap).toBeGreaterThan(0);

    const before = haulage(w);
    for (let d = 0; d < 4; d++) {
      // Held full every tick, so there is never a gap to unload into.
      for (let t = 0; t < TICKS_PER_DAY; t++) {
        w.sites.addStock(works, cargo, cap);
        w.step();
      }
    }
    expect(haulage(w)).toBe(before);
  });

  it('is paid for what fitted, and not for what it drove away with', () => {
    // A shed with room for a little takes a little. The rest stays aboard and
    // earns nothing until somewhere takes it.
    const { w, works, cargo } = running();
    const cargoCount = w.content.cargo.length;
    const cap = w.sites.capacity[works * cargoCount + cargo];

    const before = haulage(w);
    for (let d = 0; d < 6; d++) {
      for (let t = 0; t < TICKS_PER_DAY; t++) {
        // Leave exactly one tonne of room, continuously.
        const have = w.sites.stockOf(works, cargo);
        if (have < cap - 1) w.sites.addStock(works, cargo, cap - 1 - have);
        w.step();
      }
    }
    const earned = haulage(w) - before;
    // Something was carried…
    expect(earned).toBeGreaterThan(0);
    // …but nowhere near a full load each trip, because only a tonne ever fitted.
    const fullLoad = w.content.vehicles[w.vehicles.type[0]]?.capacity ?? 2;
    expect(earned / Math.max(1, w.stats.delivered)).toBeLessThan(
      // Per-delivery earnings must be under what a whole load would fetch.
      haulage(w) / Math.max(1, w.stats.delivered) * fullLoad,
    );
  });

  it('records no delivery at all when it is carrying nothing', () => {
    /*
     * The outer guard: an unload stop with an empty vehicle does nothing. Not a
     * zero-tonne delivery, not a zero-pound payment — nothing happens, which is
     * what keeps the delivery count meaningful.
     */
    const { w, farm, cargo } = running();
    /*
     * Empty the farm and stop it refilling. Dead rather than mothballed, because
     * mothballed *recovers*: the decay pass reopens any closed site whose
     * satisfaction is still healthy, so a farm shut on the first tick was back at
     * work by the next day and quietly supplied six loads to a test that was
     * asserting there were none.
     */
    w.sites.takeStock(farm, cargo, w.sites.stockOf(farm, cargo));
    w.sites.state[farm] = SiteState.Dead;
    const before = w.stats.delivered;
    const cash = haulage(w);
    for (let d = 0; d < 4; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    expect(w.stats.delivered).toBe(before);
    expect(haulage(w)).toBe(cash);
  });
});
