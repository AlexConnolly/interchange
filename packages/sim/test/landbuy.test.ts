/**
 * Buying land.
 *
 * The rung between owning a business and building one, and the simplest
 * transaction in the game: money, and the block has to be somewhere you could
 * plausibly reach. No board, no approval, no charter — owning land is not a favour
 * the parish does you.
 *
 * What is pinned here is the *reach* rule, because it is the only rule, and the
 * price *shape*, because a market where everything costs the same is not a market.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, facilitiesFor, LAND_BLOCK, NO_OWNER, NO_WAY, Mode,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

function district() {
  const w = createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });
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
  return w;
}

describe('the land register', () => {
  it('divides the district into uniform squares', () => {
    /*
     * Uniform is the requirement rather than a simplification: field boundaries
     * follow hedges, and a hedge is not a thing you can offer for sale at a price.
     * A market in land needs a unit whose edges everybody can see.
     */
    const w = district();
    expect(w.land.across).toBe(128 / LAND_BLOCK);
    expect(w.land.owner.length).toBe(w.land.across * w.land.across);

    // Every tile in a block maps to that block, and the block's bounds contain it.
    const b = w.land.blockAt(40 * 128 + 40, 128);
    const bounds = w.land.bounds(b);
    expect(bounds.x1 - bounds.x0).toBe(LAND_BLOCK - 1);
    expect(40).toBeGreaterThanOrEqual(bounds.x0);
    expect(40).toBeLessThanOrEqual(bounds.x1);
  });

  it('starts with nothing owned', () => {
    const w = district();
    expect([...w.land.owner].every((o) => o === NO_OWNER)).toBe(true);
  });
});

describe('what land costs', () => {
  it('is dearer by a town than out in the country', () => {
    const w = district();
    const near = w.land.blockAt(
      Math.round(w.towns.y[0]) * 128 + Math.round(w.towns.x[0]), 128,
    );
    // A block as far from every town as the map allows.
    let far = -1;
    let best = -1;
    for (let b = 0; b < w.land.owner.length; b++) {
      const c = w.land.centre(b);
      let d = 1e9;
      for (let t = 0; t < w.towns.count; t++) {
        d = Math.min(d, Math.hypot(w.towns.x[t] - c.x, w.towns.y[t] - c.y));
      }
      if (d > best && w.landPriceOf(b) > 0) { best = d; far = b; }
    }
    expect(w.landPriceOf(near)).toBeGreaterThan(w.landPriceOf(far));
  });

  it('is worthless if it is all water', () => {
    const w = district();
    let wet = -1;
    for (let b = 0; b < w.land.owner.length; b++) {
      const bounds = w.land.bounds(b);
      let dry = 0;
      for (let y = bounds.y0; y <= bounds.y1; y++) {
        for (let x = bounds.x0; x <= bounds.x1; x++) {
          if (x < 128 && y < 128 && w.terrain.height[y * 128 + x] > 0) dry++;
        }
      }
      if (dry === 0) { wet = b; break; }
    }
    if (wet >= 0) {
      expect(w.landPriceOf(wet)).toBe(0);
      expect(w.canBuyLand(w.player, wet).ok).toBe(false);
    }
  });

  it('costs a dozen blocks to match a business', () => {
    /*
     * The intended exchange rate — "it should be cheaper to buy a business in most
     * cases, but not buy a massive amount". Land is the patient purchase.
     */
    const w = district();
    const sale = w.landForSale();
    expect(sale.length).toBeGreaterThan(10);
    const median = sale.map((s) => s.price).sort((a, b) => a - b)[sale.length >> 1];
    const business = w.priceOf(0);
    expect(median * 4).toBeLessThan(business);
    expect(median * 40).toBeGreaterThan(business);
  });
});

describe('what you may buy', () => {
  it('offers land by a road even before you own any', () => {
    // The foothold: without this a player who owns no land can never own any.
    const w = district();
    const sale = w.landForSale();
    expect(sale.length).toBeGreaterThan(0);
  });

  it('refuses land that touches neither your own nor a road', () => {
    const w = district();
    // A block far from everything, with no road anywhere near it.
    let lonely = -1;
    for (let b = 0; b < w.land.owner.length && lonely < 0; b++) {
      const bounds = w.land.bounds(b);
      let road = 0;
      let dry = 0;
      for (let y = bounds.y0 - 1; y <= bounds.y1 + 1; y++) {
        for (let x = bounds.x0 - 1; x <= bounds.x1 + 1; x++) {
          if (x < 0 || y < 0 || x >= 128 || y >= 128) continue;
          if (w.layers[Mode.Road].cls[y * 128 + x] !== NO_WAY) road++;
          if (w.terrain.height[y * 128 + x] > 0) dry++;
        }
      }
      if (road === 0 && dry > 10) lonely = b;
    }
    expect(lonely).toBeGreaterThanOrEqual(0);
    const verdict = w.canBuyLand(w.player, lonely);
    expect(verdict.ok).toBe(false);
  });

  it('opens up the neighbours once you own one', () => {
    /*
     * A holding grows outward from itself. That is what makes buying toward
     * something a strategy rather than a shopping list.
     */
    const w = district();
    const first = w.landForSale()[0];
    expect(w.buyLand(first.block).ok).toBe(true);
    for (const n of w.land.neighbours(first.block)) {
      if (w.landPriceOf(n) <= 0) continue;
      // Reachability is satisfied; only money or fog could refuse it now.
      const why = w.canBuyLand(w.player, n).reason;
      expect(why).not.toBe('Too far out. Buy toward it, or find a road.');
    }
  });

  it('takes the money and hands over the ground', () => {
    const w = district();
    const first = w.landForSale()[0];
    const cash = w.companies.cash[w.player];
    expect(w.buyLand(first.block).ok).toBe(true);
    expect(w.companies.cash[w.player]).toBe(cash - first.price);
    expect(w.land.owner[first.block]).toBe(w.player);
    const c = w.land.centre(first.block);
    expect(w.ownsLandAt(Math.floor(c.y) * 128 + Math.floor(c.x))).toBe(true);
  });

  it('will not sell the same field twice', () => {
    const w = district();
    const first = w.landForSale()[0];
    expect(w.buyLand(first.block).ok).toBe(true);
    expect(w.buyLand(first.block).ok).toBe(false);
    expect(w.canBuyLand(w.player, first.block).reason).toBe('Already yours.');
  });
});
