/**
 * A village you can actually deliver to.
 *
 * `stepTowns` has grown a fed town and shrunk a starved one since the beginning,
 * `deliverToTown` has always accepted a load, and `stepStops` has always branched
 * on a stop kind that says which of the two tables to put the goods in. None of
 * it was reachable. Every path the interface could take passed stop kind 0, the
 * one generator of town-destined contracts had no callers, and the shopping list
 * the whole thing ran on named fourteen cargoes of which two existed.
 *
 * So the district's population was a fixed drift: `served` sat at
 * `min(100, 760/pop)` for ever, every town settled at whatever its own fields
 * could support, and the one number the region grows by was a decoration a player
 * could not touch. Everything below is about that being false now.
 *
 * Worth stating what is *not* tested here, because it is the reason this looked
 * fine for so long: the balance harness runs no player, and with nobody hauling
 * the service rate collapses to `min(100, 760/pop)` **whatever the basket
 * contains** — both what a town wants and what its hinterland supplies are linear
 * in the same weight, so they cancel. Measured across twelve thirty-year runs,
 * widening the basket moved the district's population by zero. It can only be
 * seen from the player's end, which is where these tests stand.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, TICKS_PER_DAY, StopAction, MAX_STOPS } from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;

/** A district the player can see all of, so influence is not the variable. */
function district(seed = 1985): ReturnType<typeof createWorld> {
  const w = createWorld({ seed, size: D, townCount: 3, companyCount: 1 });
  w.tick = 60 * TICKS_PER_DAY;
  w.primeStock();
  const src: { x: number; y: number; strength: number }[] = [];
  for (let x = 8; x < D; x += 12) {
    for (let z = 8; z < D; z += 12) src.push({ x, y: z, strength: 3.2 });
  }
  w.refreshInfluence(src);
  w.companies.cash[w.player] = 500_000_00;
  /*
   * And a shed of finished goods somewhere, which `primeStock` does not give.
   *
   * It primes what comes out of the ground, and a village wants what comes out of
   * a works — so on a fresh district there is no dairy, no meat and no beer
   * anywhere, and no village-bound job can exist. That is the right behaviour and
   * it is the feature's own pacing: nobody in this district hauls but the player,
   * so the first surplus of a finished good is one the player created by carting
   * milk to a creamery. The loop closes on itself, and it closes weeks in.
   *
   * Seeded here so the tests below are about the village and not about how long
   * it takes to get a creamery running.
   */
  for (const id of ['dairy', 'meat', 'beer']) {
    const ci = w.content.cargoIndex.get(id) as number;
    for (let s = 0; s < w.sites.count; s++) {
      const outs = w.recipes.outputs[w.sites.def[s]];
      for (let i = 0; i < outs.length; i += 2) {
        if (outs[i] === ci) w.sites.addStock(s, ci, 60);
      }
    }
  }
  return w;
}

/**
 * The first town-bound offer the board will make, given time.
 *
 * The board holds five and **an offer stays until it is taken**, so a full board
 * makes almost no new offers however fairly it rotates. Twenty-one sites and
 * eighteen surpluses means the finished goods a village wants sit behind a queue
 * of aggregate and grain: released here each round so the scan gets round the
 * district, which is what a player does by accepting work.
 */
function townOffers(w: ReturnType<typeof district>): number[] {
  for (let r = 0; r < 40; r++) {
    w.offerWorkNow();
    const b = w.contractBoard;
    const found: number[] = [];
    for (let i = 0; i < b.count; i++) {
      if (b.state[i] === 3) continue;
      if (b.toIsTown[i] === 1) found.push(i);
    }
    if (found.length > 0) return found;
    for (let i = 0; i < b.count; i++) {
      if (b.state[i] !== 3) b.release(i);
    }
    for (let d = 0; d < 3; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
  }
  return [];
}

describe('work into a village', () => {
  it('is offered at all, which it never was', () => {
    const w = district();
    expect(townOffers(w).length).toBeGreaterThan(0);
  });

  it('is offered only for what a village actually eats', () => {
    /*
     * The basket is dairy, meat and beer — the finished goods nothing in the
     * district retails. Produce, parcels and fuel are deliberately absent: the
     * village shop takes the first two and a filling station takes the third, so
     * a town wanting them as well would be the same appetite served twice, and it
     * put the shop into a coin-toss with the village behind it for every load.
     */
    const w = district();
    const wanted = new Set(['dairy', 'meat', 'beer']);
    for (const id of ['produce', 'parcels', 'fuel', 'milk', 'grain', 'aggregate']) {
      const ci = w.content.cargoIndex.get(id);
      expect(ci, id).toBeDefined();
      expect(w.townDemandFor(ci as number), `a town should not want ${id}`).toBe(0);
    }
    for (const id of wanted) {
      const ci = w.content.cargoIndex.get(id) as number;
      expect(w.townDemandFor(ci), `a town should want ${id}`).toBeGreaterThan(0);
    }
  });

  it('names the village rather than whichever works shares its number', () => {
    /*
     * The bug this shape exists to prevent. A town index and a site index are both
     * small integers, so the eight places the interface looked `to` up in the site
     * table would each have named a business at random. One accessor, and it knows
     * which table it is reading.
     */
    const w = district();
    const [id] = townOffers(w);
    expect(id).toBeDefined();
    const b = w.contractBoard;
    const name = w.contractToName(id);
    expect(name).toBe(w.towns.names[b.to[id]]);
    expect(name).not.toBe(w.content.industries[w.sites.def[b.to[id]]]?.name);
    expect(w.contractToTile(id)).toBe(w.townAccessTile[b.to[id]]);
  });

  it('makes a town stop when you take it on', () => {
    // The whole of what was missing: kind 1, so `stepStops` unloads through
    // `deliverToTown` instead of into a site's shed.
    const w = district();
    const [id] = townOffers(w);
    expect(id).toBeDefined();
    expect(w.acceptContract(id, w.player)).toBe(true);
    const svc = w.contractBoard.service[id];
    expect(svc).toBeGreaterThanOrEqual(0);
    let unloadKind = -1;
    for (let k = 0; k < w.services.stopCount[svc]; k++) {
      const si = svc * MAX_STOPS + k;
      if (w.services.stopAction[si] === StopAction.Unload) {
        unloadKind = w.services.stopKind[si];
      }
    }
    expect(unloadKind, 'the unload stop is not a town stop').toBe(1);
  });

  it('is not absorbed when you buy the business that shares its number', () => {
    /*
     * `absorbContracts` releases every contract bound *for* a site you have just
     * bought, on the argument that it is now your own supply run. Without the town
     * guard, buying site 3 would quietly cancel every job bound for town 3.
     */
    const w = district();
    const [id] = townOffers(w);
    expect(id).toBeDefined();
    const town = w.contractBoard.to[id];
    if (town >= w.sites.count) return;
    w.sites.owner[town] = w.player;
    w.refreshInfluence();
    expect(w.contractBoard.toIsTown[id]).toBe(1);
    expect(w.contractBoard.state[id]).not.toBe(3);
  });
});

describe('a village that gets its deliveries', () => {
  it('reads as better served than one that does not', () => {
    /*
     * Measured at the seam rather than through a lorry, because what is being
     * pinned is the response and not the plumbing: a town holding stock of what it
     * wants covers the shortfall its own fields cannot, and `served` is the
     * ten-day average of that.
     */
    const w = district();
    const dairy = w.content.cargoIndex.get('dairy') as number;
    const meat = w.content.cargoIndex.get('meat') as number;
    const beer = w.content.cargoIndex.get('beer') as number;
    const cc = w.towns.cargoCount;

    // The biggest town, so its own hinterland is furthest from covering it.
    let fed = 0;
    for (let t = 1; t < w.towns.count; t++) {
      if (w.towns.population[t] > w.towns.population[fed]) fed = t;
    }
    const starved = fed === 0 ? 1 : 0;

    for (let d = 0; d < 120; d++) {
      for (const c of [dairy, meat, beer]) w.towns.stock[fed * cc + c] = 40;
      for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    }

    expect(w.towns.served[fed], 'a supplied town is not well served')
      .toBeGreaterThan(w.towns.served[starved]);
    expect(w.towns.served[fed]).toBeGreaterThan(60);
  });

  it('grows, where an unserved one does not', () => {
    /*
     * The point of all of it. Growth turns on `served` above 60, so a town whose
     * shortfall is covered climbs and one left alone drifts to whatever its own
     * fields support and stops.
     */
    const w = district();
    const dairy = w.content.cargoIndex.get('dairy') as number;
    const meat = w.content.cargoIndex.get('meat') as number;
    const beer = w.content.cargoIndex.get('beer') as number;
    const cc = w.towns.cargoCount;

    let fed = 0;
    for (let t = 1; t < w.towns.count; t++) {
      if (w.towns.population[t] > w.towns.population[fed]) fed = t;
    }
    const before = w.towns.population[fed];

    for (let d = 0; d < 200; d++) {
      for (const c of [dairy, meat, beer]) w.towns.stock[fed * cc + c] = 40;
      for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    }
    expect(w.towns.population[fed], 'a well-served town did not grow')
      .toBeGreaterThan(before);
  });

  it('never collapses when nobody comes, which is the other half of the rule', () => {
    // Stagnation, not ruin. A district the player ignores has to keep ticking
    // over, or neglect becomes a loss condition nobody was warned about.
    const w = district();
    const before = w.towns.population.slice(0, w.towns.count);
    for (let d = 0; d < 400; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    for (let t = 0; t < w.towns.count; t++) {
      expect(w.towns.population[t], `town ${t} emptied out`).toBeGreaterThan(59);
      expect(w.towns.population[t]).toBeLessThan(before[t] * 3);
    }
  });
});
