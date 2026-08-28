/**
 * What a building costs, and what the location adds to it.
 *
 * The Build tray quotes a price per building and the placement preview shows the
 * premium in brackets — "£189,560 (+£59,540)". Two figures out of one formula, and
 * the whole reason the formula is one function is that a quote the checkout does not
 * honour is worse than no quote at all.
 *
 * So the tray's figure is the *cheapest the thing can be* rather than an average.
 * A player who can only ever be charged more than the quote has been misled; one
 * who can only be charged less has been given a decision.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, TICKS_PER_DAY } from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;

function district() {
  const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 4 });
  w.tick = 60 * TICKS_PER_DAY;
  return w;
}

/** How far a tile is from the nearest town, in plain tiles. */
function toTown(w: ReturnType<typeof district>, tile: number): number {
  const x = tile % D;
  const y = (tile / D) | 0;
  let best = Infinity;
  for (let t = 0; t < w.towns.count; t++) {
    best = Math.min(best, Math.hypot(w.towns.x[t] - x, w.towns.y[t] - y));
  }
  return best;
}

/** The land tile nearest a town, and the one furthest from every town. */
function ends(w: ReturnType<typeof district>): { near: number; far: number } {
  let near = -1;
  let far = -1;
  let bestNear = Infinity;
  let bestFar = -1;
  for (let t = 0; t < D * D; t++) {
    if (w.terrain.height[t] <= 0) continue;
    const d = toTown(w, t);
    if (d < bestNear) { bestNear = d; near = t; }
    if (d > bestFar) { bestFar = d; far = t; }
  }
  return { near, far };
}

describe('the price the tray quotes', () => {
  it('is never more than the price anywhere in the district', () => {
    /*
     * The promise the quote makes. If a single tile in the whole district were
     * cheaper than the "from" figure, the figure would be an average pretending to
     * be a floor.
     */
    const w = district();
    for (let i = 0; i < w.content.industries.length; i++) {
      const base = w.foundPriceBase(i);
      for (let t = 0; t < D * D; t += 37) {
        if (w.terrain.height[t] <= 0) continue;
        expect(w.foundPriceAt(i, t), `${w.content.industries[i].id} at tile ${t}`)
          .toBeGreaterThanOrEqual(base);
      }
    }
  });

  it('is actually reachable, rather than a theoretical floor', () => {
    /*
     * A "from" price nowhere in the district charges would be a different kind of
     * lie from an average, and just as much a lie.
     *
     * Scanned rather than checked at the furthest tile, which is what the first
     * version of this did and got wrong: the cheapest point is not the far end of
     * the map. The site premium runs out at 30 tiles and the ground premium at 34,
     * so a spot at 30 pays the country site price while still having town-priced
     * ground deducted from it — and is therefore cheaper than the middle of nowhere.
     */
    const w = district();
    for (let i = 0; i < w.content.industries.length; i++) {
      const base = w.foundPriceBase(i);
      let paid = false;
      for (let t = 0; t < D * D && !paid; t++) {
        if (w.terrain.height[t] <= 0) continue;
        if (w.foundPriceAt(i, t) === base) paid = true;
      }
      expect(paid, `nowhere in the district charges ${w.content.industries[i].id}`
        + ` its quoted ${base}`).toBe(true);
    }
  });

  it('sits at the dip between the two premiums, not at the far end of the map', () => {
    /*
     * Pinning the shape, because the fix depends on it and the two constants live in
     * two different files. If `LAND_TOWN_REACH` and the site premium's 30 are ever
     * brought into line, this becomes an equality and somebody should look at the
     * comment in `foundPriceBase` rather than at a red test.
     */
    const w = district();
    const farm = w.content.industries.findIndex((i) => i.id === 'dairy-farm');
    const { far } = ends(w);
    expect(toTown(w, far)).toBeGreaterThan(34);
    expect(w.foundPriceBase(farm)).toBeLessThanOrEqual(w.foundPriceAt(farm, far));
  });
});

describe('the premium in brackets', () => {
  it('is exactly the difference between here and the country price', () => {
    /*
     * The arithmetic the preview prints has to be the arithmetic the preview means.
     * The two figures come from one function with one argument changed, and this is
     * what keeps them able to be added up by a player.
     */
    const w = district();
    const { near, far } = ends(w);
    for (let i = 0; i < w.content.industries.length; i++) {
      for (const t of [near, far]) {
        expect(w.foundPremiumAt(i, t))
          .toBe(Math.max(0, w.foundPriceAt(i, t) - w.foundPriceBase(i)));
      }
    }
  });

  it('is never negative, whatever the ground is worth', () => {
    const w = district();
    for (let i = 0; i < w.content.industries.length; i++) {
      for (let t = 0; t < D * D; t += 53) {
        expect(w.foundPremiumAt(i, t)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is worth showing: a town gate costs about double the country', () => {
    /*
     * If the spread were a few per cent the brackets would be noise. Measured on
     * seed 1985 it is 100% for every building in the game, which is the land-value
     * gradient doing exactly what design.md asks of it — and the reason a player
     * needs to see it before they commit rather than after.
     */
    const w = district();
    const { near } = ends(w);
    for (let i = 0; i < w.content.industries.length; i++) {
      const base = w.foundPriceBase(i);
      const ratio = w.foundPremiumAt(i, near) / base;
      expect(ratio, `${w.content.industries[i].id} premium share`)
        .toBeGreaterThan(0.5);
    }
  });

  it('falls as you move away from a town', () => {
    const w = district();
    const { near, far } = ends(w);
    const creamery = w.content.industries.findIndex((i) => i.id === 'creamery');
    expect(w.foundPremiumAt(creamery, near))
      .toBeGreaterThan(w.foundPremiumAt(creamery, far));
  });
});

describe('the quote and the charge', () => {
  it('agree with what `canPlaceSite` says you will pay', () => {
    /*
     * The preview reads `verdict.price` and the tray reads `foundPriceBase`, and
     * both have to be the same formula as the one that takes the money. This is the
     * check that they are.
     */
    const w = district();
    const shop = w.content.industries.findIndex((i) => i.id === 'village-shop');
    for (let t = 0; t < D * D; t += 71) {
      if (w.terrain.height[t] <= 0) continue;
      const verdict = w.canPlaceSite(w.player, shop, t);
      expect(verdict.price).toBe(w.foundPriceAt(shop, t));
    }
  });
});
