/**
 * Buying land, by the field.
 *
 * It was a grid of four-by-four squares first, and the unit was wrong: a grid laid
 * over a district whose fields are already enclosed by hedges cuts every one of
 * them in half, so you could buy half of one field and half of another. The unit
 * is the parcel now — the thing the hedges enclose and one crop grows in.
 *
 * What is pinned here is the *reach* rule, because it is the only rule; the price
 * *shape*, because a market where everything costs the same is not a market; and
 * that nobody sells you the ground under their own house.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, facilitiesFor, NO_OWNER, NO_WAY, Mode,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;

function district() {
  const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 1 });
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
  it('is one entry per field, not per square', () => {
    const w = district();
    expect(w.land.owner.length).toBe(w.terrain.fields.count);
    // And every field knows its own tiles.
    let tiles = 0;
    for (let p = 0; p < w.land.owner.length; p++) tiles += w.land.acres(p);
    // About a quarter of a district is enclosed; the rest is hill, water and road.
    expect(tiles).toBeGreaterThan(D * D * 0.15);
  });

  it('puts a field s label inside the field', () => {
    /*
     * The centroid rather than the middle of the bounding box. An enclosure field
     * is rarely a rectangle, so the centre of its bounds can fall outside it — on
     * the far side of a hedge, pointing at somebody else's grass.
     */
    const w = district();
    let checked = 0;
    for (let p = 0; p < w.land.owner.length && checked < 40; p++) {
      if (w.land.acres(p) < 6) continue;
      const c = w.land.centres[p];
      const t = Math.floor(c.y) * D + Math.floor(c.x);
      expect(w.terrain.fields.parcel[t], `field ${p}`).toBe(p);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('starts with nothing owned', () => {
    const w = district();
    expect([...w.land.owner].every((o) => o === NO_OWNER)).toBe(true);
  });
});

describe('what a field costs', () => {
  it('charges by the acre, so a big field costs more than a small one', () => {
    /*
     * The one thing the uniform grid had going for it was that every unit cost the
     * same. Losing that is the point: pretending four acres of hillside is four
     * acres of river meadow was the dishonest part.
     */
    const w = district();
    const sale = w.landForSale();
    expect(sale.length).toBeGreaterThan(4);
    const big = sale.reduce((a, b) => (w.land.acres(a.parcel) > w.land.acres(b.parcel) ? a : b));
    const small = sale.reduce((a, b) => (w.land.acres(a.parcel) < w.land.acres(b.parcel) ? a : b));
    expect(w.land.acres(big.parcel)).toBeGreaterThan(w.land.acres(small.parcel));
    expect(big.price).toBeGreaterThan(small.price);
  });

  it('is worthless if it is all water', () => {
    const w = district();
    for (let p = 0; p < w.land.owner.length; p++) {
      const tiles = w.land.tiles[p];
      if (tiles.length === 0) continue;
      if (tiles.every((t) => w.terrain.height[t] <= 0)) {
        expect(w.landPriceOf(p)).toBe(0);
        expect(w.canBuyLand(w.player, p).ok).toBe(false);
        return;
      }
    }
  });

  it('costs a handful of fields to match a business', () => {
    // "Cheaper to buy a business in most cases, but not buy a massive amount."
    const w = district();
    const sale = w.landForSale();
    const median = sale.map((s) => s.price).sort((a, b) => a - b)[sale.length >> 1];
    const business = w.priceOf(0);
    expect(median).toBeLessThan(business);
    expect(median * 60).toBeGreaterThan(business);
  });
});

describe('what you may buy', () => {
  it('offers fields by a road even before you own any', () => {
    // The foothold: without this a player who owns no land can never own any.
    const w = district();
    expect(w.landForSale().length).toBeGreaterThan(0);
  });

  it('refuses a field that touches neither your own nor a road', () => {
    const w = district();
    let lonely = -1;
    for (let p = 0; p < w.land.owner.length && lonely < 0; p++) {
      const tiles = w.land.tiles[p];
      if (tiles.length < 6) continue;
      if (w.landPriceOf(p) <= 0) continue;
      let road = false;
      for (const t of tiles) {
        const x = t % D;
        const y = (t / D) | 0;
        for (let dy = -1; dy <= 1 && !road; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= D || ny >= D) continue;
            if (w.layers[Mode.Road].cls[ny * D + nx] !== NO_WAY) { road = true; break; }
          }
        }
        if (road) break;
      }
      if (!road) lonely = p;
    }
    expect(lonely).toBeGreaterThanOrEqual(0);
    expect(w.canBuyLand(w.player, lonely).ok).toBe(false);
  });

  it('opens up the neighbouring fields once you own one', () => {
    /*
     * A holding grows outward from itself, which is what makes buying toward
     * something a strategy rather than a shopping list. Neighbours are found per
     * *tile*, which on an irregular map is the same thing as sharing a hedge.
     */
    const w = district();
    /*
     * A field that *has* a neighbour, rather than whichever is first on the list.
     *
     * Not every field does: only about a quarter of a district is enclosed, so
     * plenty of them stand alone in open hill with nothing within reach. Buying one
     * of those and asserting that its neighbours opened up tests nothing, which is
     * what the first version of this did.
     */
    const near = (parcel: number): Set<number> => {
      const out = new Set<number>();
      for (const t of w.land.tiles[parcel]) {
        const x = t % D;
        const y = (t / D) | 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= D || ny >= D) continue;
            const p = w.terrain.fields.parcel[ny * D + nx];
            if (p >= 0 && p !== parcel) out.add(p);
          }
        }
      }
      return out;
    };
    const first = w.landForSale().find((s) => near(s.parcel).size > 0);
    expect(first).toBeTruthy();
    if (!first) return;
    expect(w.buyLand(first.parcel).ok).toBe(true);

    const touching = near(first.parcel);
    expect(touching.size).toBeGreaterThan(0);
    for (const p of touching) {
      if (w.landPriceOf(p) <= 0) continue;
      expect(w.canBuyLand(w.player, p).reason)
        .not.toBe('Too far out. Buy toward it, or find a road.');
    }
  });

  it('takes the money and hands over the ground', () => {
    const w = district();
    const first = w.landForSale()[0];
    const cash = w.companies.cash[w.player];
    expect(w.buyLand(first.parcel).ok).toBe(true);
    expect(w.companies.cash[w.player]).toBe(cash - first.price);
    expect(w.land.owner[first.parcel]).toBe(w.player);
    for (const t of w.land.tiles[first.parcel]) {
      expect(w.ownsLandAt(t)).toBe(true);
    }
  });

  it('will not sell the same field twice', () => {
    const w = district();
    const first = w.landForSale()[0];
    expect(w.buyLand(first.parcel).ok).toBe(true);
    expect(w.buyLand(first.parcel).ok).toBe(false);
    expect(w.canBuyLand(w.player, first.parcel).reason).toBe('Already yours.');
  });

  it('hands back every owned tile as one list, for one merged outline', () => {
    /*
     * "Make the squares join, not lots of squares — one big one." The renderer
     * draws a border only where a tile's neighbour is outside the set, so the whole
     * holding has to arrive as a single list or it gets a hedgerow drawn down the
     * middle of itself.
     */
    const w = district();
    const sale = w.landForSale();
    expect(w.buyLand(sale[0].parcel).ok).toBe(true);
    const tiles = w.landOwnedTiles();
    expect(tiles.length).toBe(w.land.acres(sale[0].parcel));
    expect(new Set(tiles).size).toBe(tiles.length);
  });
});

describe('land with somebody on it', () => {
  it('is not for sale under a house', () => {
    /*
     * The village is laid out in the client — once, at startup — so the simulation
     * has no idea where anybody's cottage is unless it is told.
     */
    const w = district();
    const first = w.landForSale()[0].parcel;
    w.registerBuildings([w.land.tiles[first][0]]);
    expect(w.canBuyLand(w.player, first).ok).toBe(false);
    expect(w.landForSale().some((s) => s.parcel === first)).toBe(false);
  });

  it('is not for sale under somebody else s works', () => {
    const w = district();
    const theirs = w.terrain.fields.parcel[w.sites.tile[0]];
    if (theirs >= 0) expect(w.canBuyLand(w.player, theirs).ok).toBe(false);
  });

  it('is for sale under your own works, which is the point', () => {
    // The distinction that matters is *whose*: buying the ground under a business
    // you already own is exactly what this is for.
    const w = district();
    let mine = -1;
    for (let s = 0; s < w.sites.count; s++) {
      const p = w.terrain.fields.parcel[w.sites.tile[s]];
      if (p < 0) continue;
      if (w.canBuyLand(w.player, p).reason === 'Somebody else s property stands on it.') {
        w.sites.owner[s] = w.player;
        mine = p;
        break;
      }
    }
    expect(mine).toBeGreaterThanOrEqual(0);
    expect(w.canBuyLand(w.player, mine).reason)
      .not.toBe('Somebody else s property stands on it.');
  });

  it('says where it is, rather than making a joke about acres', () => {
    const w = district();
    const name = w.landPlaceName(w.landForSale()[0].parcel);
    expect(name).not.toContain('acres');
    expect(/of |^In |^Open country/.test(name)).toBe(true);
  });
});
