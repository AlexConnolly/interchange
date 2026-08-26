/**
 * A business nobody supplies has to look like one.
 *
 * `satisfaction` is an output measure and only moves when a cycle *completes*,
 * so a works with empty sheds never touched it: measured, a creamery cut off
 * from milk sat at a hundred per cent, state Thriving, having produced nothing
 * for ninety days. Every decay rule in the game reads satisfaction, so a place
 * starved of supply was in perfect health by every number the simulation had —
 * and since the price of a business is what you judge a purchase on, every
 * starved works was also priced as a going concern.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, TICKS_PER_DAY, SiteState } from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const make = () => createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });

/** A works: something with inputs, so it can be starved of them. */
function worksOf(w: ReturnType<typeof make>): number {
  for (let s = 0; s < w.sites.count; s++) {
    if (w.recipes.inputs[w.sites.def[s]].length > 0
      && w.recipes.outputs[w.sites.def[s]].length > 0) return s;
  }
  return -1;
}

describe('a starved business', () => {
  it('starts fed and stops being fed once its sheds are empty', () => {
    const w = make();
    w.primeStock();
    const works = worksOf(w);
    expect(w.sites.fed[works]).toBe(100);
    for (let d = 0; d < 60; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    expect(w.sites.fed[works]).toBeLessThan(20);
  });

  it('reads as struggling rather than thriving', () => {
    const w = make();
    w.primeStock();
    const works = worksOf(w);
    for (let d = 0; d < 60; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    expect(w.sites.state[works]).toBe(SiteState.Struggling);
  });

  it('is not closed down for it, because one haulier cannot supply a district', () => {
    /*
     * The distinction the `fed` measure exists to make. Nobody taking what you
     * make is fatal; nobody bringing what you need is not, or a district would
     * shut down around a player who was doing nothing wrong.
     */
    const w = make();
    w.primeStock();
    const works = worksOf(w);
    for (let d = 0; d < 200; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    expect(w.sites.state[works]).not.toBe(SiteState.Mothballed);
    expect(w.sites.state[works]).not.toBe(SiteState.Dead);
  });

  it('costs less to buy than the same place supplied', () => {
    const fed = make();
    fed.primeStock();
    const works = worksOf(fed);
    const full = fed.priceOf(works);

    const starved = make();
    starved.primeStock();
    for (let d = 0; d < 60; d++) for (let t = 0; t < TICKS_PER_DAY; t++) starved.step();
    const cheap = starved.priceOf(works);

    expect(cheap).toBeLessThan(full);
    // Half price at the extreme, so the discount is worth chasing and never
    // makes a business free.
    expect(cheap).toBeGreaterThan(full * 0.45);
  });

  it('can be bought without owning a producer of anything', () => {
    /*
     * The gate that used to be here demanded you own a supplier of every input
     * first, which made the entry price of a rung the price of the whole chain
     * beneath it. What replaces it is the fleet: you may buy this today and
     * discover it wants lorries you have not got.
     */
    const w = make();
    w.primeStock();
    const works = worksOf(w);
    w.refreshInfluence([{ x: w.sites.x[works], y: w.sites.y[works], strength: 2.4 }]);
    w.companies.cash[w.player] = 500_000_00;
    let owned = 0;
    for (let s = 0; s < w.sites.count; s++) if (w.sites.owner[s] === w.player) owned++;
    expect(owned).toBe(0);
    const verdict = w.canBuySite(works);
    expect(verdict.ok, verdict.reason).toBe(true);
    // And it still says what you will have to arrange.
    expect(verdict.needs.length).toBeGreaterThan(0);
  });
});

describe('supplying a place you own', () => {
  it('sets up a run inbound, not only outbound', () => {
    /*
     * The mechanism existed and pointed one way. It insisted you owned the
     * *origin*, which covers selling what you make and leaves the more pressing
     * half — getting goods to a business you have just bought — with no
     * mechanism at all. Nobody in this district delivers, so that half is the
     * whole of what owning a business asks of you.
     */
    const w = createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });
    w.primeStock();
    let shop = -1;
    for (let s = 0; s < w.sites.count; s++) {
      if (w.content.industries[w.sites.def[s]].id === 'village-shop') { shop = s; break; }
    }
    expect(shop).toBeGreaterThanOrEqual(0);
    const produce = w.content.cargo.findIndex((c) => c.id === 'produce');
    let farm = -1;
    for (let s = 0; s < w.sites.count; s++) {
      const outs = w.recipes.outputs[w.sites.def[s]];
      for (let i = 0; i < outs.length; i += 2) if (outs[i] === produce) { farm = s; break; }
      if (farm >= 0) break;
    }
    expect(farm).toBeGreaterThanOrEqual(0);

    // Neither end is yours: there is nothing to arrange.
    expect(w.supply(farm, shop, produce)).toBe(false);

    w.refreshInfluence([{ x: w.sites.x[shop], y: w.sites.y[shop], strength: 2.4 }]);
    w.companies.cash[w.player] = 500_000_00;
    w.sites.servedDay[shop] = w.day;
    expect(w.buySite(shop).ok).toBe(true);

    const before = w.services.count;
    expect(w.supply(farm, shop, produce)).toBe(true);
    expect(w.services.count).toBe(before + 1);
  });
});
