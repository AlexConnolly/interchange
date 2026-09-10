/**
 * What a building costs, which is one figure and the same figure everywhere.
 *
 * It used to be a curve — the going-concern value of one *here*, doubling at a
 * town gate, minus the worth of the ground under it because you had bought that
 * ground yourself — and the Build tray could therefore only quote the cheapest the
 * thing could be. This file used to be about that quote: that it was a floor and
 * not an average, that some tile in the district actually charged it, and that the
 * premium the preview printed in brackets was exactly the difference.
 *
 * All of it was careful and all of it was answering the wrong question. Reported
 * from play: "it said I did not have enough money when I did" — which is what a
 * price that doubles between the tray and the ground feels like from the outside.
 * A quote a player can only ever be charged *more* than is not a decision, it is a
 * surprise, and the brackets were an attempt to make the surprise legible rather
 * than to stop it.
 *
 * So what is pinned here now is the flatness itself, in both directions: that the
 * price does not move with the location, and that building and buying have stayed
 * level with each other — because they were a matched pair and flattening one
 * without the other would make building the only sensible move near a town.
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
  it('is the price everywhere in the district, not a floor under it', () => {
    /*
     * The whole of the fix, and the reason it is stated as an equality rather than
     * as a bound: a bound is what the old formula satisfied. The tray's figure has
     * to be the figure, at the town gate and up a lane and on the tile in between.
     */
    const w = district();
    const { near, far } = ends(w);
    expect(toTown(w, near)).toBeLessThan(5);
    expect(toTown(w, far)).toBeGreaterThan(34);
    for (let i = 0; i < w.content.industries.length; i++) {
      const price = w.foundPrice(i);
      expect(price, w.content.industries[i].id).toBeGreaterThan(0);
      for (const t of [near, far]) {
        const verdict = w.canPlaceSite(w.player, i, t);
        expect(verdict.price, `${w.content.industries[i].id} at tile ${t}`).toBe(price);
      }
    }
  });

  it('is what the checkout charges, wherever you point', () => {
    /*
     * The preview reads `verdict.price` and the tray reads `foundPrice`, and both
     * have to be the formula that takes the money. This is the check that they are,
     * and it is the one test in this file that survived the rewrite unchanged in
     * spirit: a list price the till does not honour is the bug either way.
     */
    const w = district();
    const shop = w.content.industries.findIndex((i) => i.id === 'village-shop');
    let checked = 0;
    for (let t = 0; t < D * D; t += 71) {
      if (w.terrain.height[t] <= 0) continue;
      expect(w.canPlaceSite(w.player, shop, t).price).toBe(w.foundPrice(shop));
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('does not move when the parish grows into the field next door', () => {
    /*
     * Flat against *time* as well as against place. The build price used to be
     * computed from the towns, so a district that grew re-priced every building in
     * it — quietly, between one look at the tray and the next.
     */
    const w = district();
    const before = w.content.industries.map((_, i) => w.foundPrice(i));
    for (let t = 0; t < w.towns.count; t++) w.towns.population[t] *= 3;
    const after = w.content.industries.map((_, i) => w.foundPrice(i));
    expect(after).toEqual(before);
  });
});

describe('building against buying', () => {
  it('is dearer to build than to buy the same thing running', () => {
    /*
     * The direction the error has to fall in. "The big value in building is having
     * it exactly where you want it", so a player should be paying for that rather
     * than saving by it — and on top of this they buy the field.
     *
     * Measured against a *fed* works, which is the dearest the market ever prices
     * one at, so this is the tightest the comparison gets.
     */
    const w = district();
    let checked = 0;
    for (let s = 0; s < w.sites.count; s++) {
      w.sites.fed[s] = 100;
      const name = w.content.industries[w.sites.def[s]].name;
      expect(w.foundPrice(w.sites.def[s]), name)
        .toBeGreaterThanOrEqual(w.priceOf(s));
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('keeps the going-concern discount, which is the lever that was worth keeping', () => {
    // Flattening the town premium out of `priceOf` must not flatten this: a works
    // nobody supplies is half price, and that is what makes the cheap businesses
    // the ones that need what you are already good at.
    const w = district();
    const s = 0;
    w.sites.fed[s] = 100;
    const fed = w.priceOf(s);
    w.sites.fed[s] = 0;
    expect(w.priceOf(s)).toBe(Math.round(fed * 0.5));
  });

  it('prices two of the same business alike, however built-up they are', () => {
    /*
     * Two creameries at opposite ends of the district used to differ by up to
     * double. The going concern is now the only thing that separates them, which
     * is a difference a player can act on rather than one they have to survey for.
     */
    const w = district();
    const seen = new Map<number, number[]>();
    for (let s = 0; s < w.sites.count; s++) {
      w.sites.fed[s] = 100;
      const list = seen.get(w.sites.def[s]) ?? [];
      list.push(w.priceOf(s));
      seen.set(w.sites.def[s], list);
    }
    let pairs = 0;
    for (const [def, prices] of seen) {
      if (prices.length < 2) continue;
      pairs++;
      for (const p of prices) {
        expect(p, w.content.industries[def].id).toBe(prices[0]);
      }
    }
    expect(pairs, 'no business appears twice in the district').toBeGreaterThan(0);
  });
});
