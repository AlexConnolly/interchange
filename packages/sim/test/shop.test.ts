/**
 * The village shop, which is the ladder's second rung.
 *
 * Three rules meet at it and each one was wrong in a way nothing caught: a shop
 * could not sell one thing without all three, no district ever generated one,
 * and buying it demanded that you own a brewery first. All three were invisible
 * from inside the game — a missing industry looks exactly like an industry you
 * have not found yet — so they are pinned here.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, TICKS_PER_DAY } from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const make = (seed: number) =>
  createWorld({ seed, size: 128, townCount: 3, companyCount: 1 });

const shopOf = (w: ReturnType<typeof make>): number => {
  for (let s = 0; s < w.sites.count; s++) {
    if (w.content.industries[w.sites.def[s]].id === 'village-shop') return s;
  }
  return -1;
};

describe('the village shop', () => {
  it('is generated in every district', () => {
    for (const seed of [1985, 7, 42, 101, 2024, 555]) {
      expect(shopOf(make(seed)), `seed ${seed}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('stands in the village rather than out in the fields', () => {
    /*
     * Within five tiles of a town centre. A works belongs out at four to eleven
     * because it is noisy; a shop with no lorries of its own belongs on the
     * street the people are on, and this is the only thing asserting that.
     */
    for (const seed of [1985, 7, 42]) {
      const w = make(seed);
      const shop = shopOf(w);
      let nearest = Infinity;
      for (let tn = 0; tn < w.towns.count; tn++) {
        const dx = w.towns.x[tn] - w.sites.x[shop];
        const dy = w.towns.y[tn] - w.sites.y[shop];
        nearest = Math.min(nearest, Math.hypot(dx, dy));
      }
      expect(nearest, `seed ${seed}`).toBeLessThanOrEqual(6);
    }
  });

  it('sells one cargo without waiting for the others', () => {
    /*
     * The all-or-nothing rule belongs to a works, which must not eat its milk
     * and make nothing. A shop assembles nothing, so a crate of milk cannot be
     * un-sellable because the beer has not arrived — and under the old rule it
     * was, which quietly took the shop out of the game: it filled with the one
     * cargo you could supply, ran out of room, and stopped being a buyer.
     */
    const w = make(1985);
    const shop = shopOf(w);
    const produce = w.content.cargo.findIndex((c) => c.id === 'produce');
    w.sites.addStock(shop, produce, 12);
    const before = w.sites.stockOf(shop, produce);
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) w.step();
    expect(w.sites.stockOf(shop, produce)).toBeLessThan(before);
  });

  it('wants nothing that needs a fridge', () => {
    /*
     * The point of the shop is that it is the cheapest possible first customer,
     * and a cargo's handling class is what decides the price of the van that can
     * carry it. It listed milk, dairy and beer — a refrigerated van for two of
     * them and a tanker for the third, so the "easy earner from the start" could
     * not be served by the six-thousand-pound Transit at all.
     */
    const w = make(1985);
    const ins = w.recipes.inputs[w.sites.def[shopOf(w)]];
    const handling = new Set<string>();
    for (let i = 0; i < ins.length; i += 2) handling.add(w.content.cargo[ins[i]].handling);
    expect([...handling]).toEqual(['general']);

    const van = w.content.vehicles.find((v) => v.id === 'van-transit');
    expect(van?.handling).toContain('general');
  });

  it('is bought on trade, not on owning its suppliers', () => {
    const w = make(1985);
    const shop = shopOf(w);
    w.refreshInfluence([{ x: w.sites.x[shop], y: w.sites.y[shop], strength: 2.4 }]);
    w.companies.cash[w.player] = 50_000_00;

    expect(w.canBuySite(shop).ok).toBe(false);
    // What a delivery leaves behind. A fortnight ago is too long ago.
    w.sites.servedDay[shop] = w.day - 30;
    expect(w.canBuySite(shop).ok).toBe(false);
    w.sites.servedDay[shop] = w.day;
    expect(w.buySite(shop).ok).toBe(true);
    expect(w.sites.owner[shop]).toBe(w.player);
  });

  it('earns standing while its shelves are full, and not once it runs dry', () => {
    const w = make(1985);
    const shop = shopOf(w);
    w.refreshInfluence([{ x: w.sites.x[shop], y: w.sites.y[shop], strength: 2.4 }]);
    w.companies.cash[w.player] = 50_000_00;
    w.sites.servedDay[shop] = w.day;
    expect(w.buySite(shop).ok).toBe(true);

    const produce = w.content.cargo.findIndex((c) => c.id === 'produce');
    const start = w.approval;
    for (let d = 0; d < 20; d++) {
      w.sites.addStock(shop, produce, 99);
      for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    }
    const stocked = w.approval;
    expect(stocked).toBeGreaterThan(start);

    // And left to run dry it gives the ground back, because approval is for
    // serving the place rather than for having bought a building in it.
    for (let d = 0; d < 20; d++) {
      for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    }
    expect(w.approval).toBeLessThan(stocked);
  });
});
