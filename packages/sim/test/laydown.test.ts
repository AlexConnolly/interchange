/**
 * Land you buy stops being farmed, so it lays down to grass.
 *
 * "If you buy a field that's been ploughed it always stays ploughed."
 *
 * Not frozen by accident — by the rules working exactly as written. `cropBase`
 * holds what worldgen sowed a field with and the whole rotation is derived from it,
 * so an arable base runs the arable year for ever and changing hands touched
 * nothing. Meanwhile ploughing and cutting are *work*, and the farm that used to do
 * that work does not own the field any more, so the ground sat at whatever stage it
 * had reached on the day of the sale.
 *
 * Which is wrong in the model as much as on screen: a field is arable because
 * somebody is growing corn in it.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, TICKS_PER_YEAR, Crop, facilitiesFor, isWood,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;

/** A district with a presence, so land is for sale and affordable. */
function district() {
  const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 4 });
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
  /*
   * And a wider reach than a first-day haulier's, because the opening influence
   * contains no arable land at all.
   *
   * Measured on seed 1985: the twenty-one parcels for sale at the start are pasture,
   * meadow and wood, and the district's four hundred and fifty-seven tiles of wheat
   * and plough are all outside them. So the bug cannot be reproduced on day one —
   * you have to have grown, which is exactly when it was reported. At three towns
   * counting you, three of the twenty-eight parcels for sale have arable in them.
   */
  w.standing = 3;
  w.refreshInfluence();
  // One season step, so the crop rotation is up and running before anything is
  // bought — which is the state a real purchase happens in.
  w.step();
  return w;
}

/** Grass, in any of the states the grass year passes through. */
const GRASS = new Set<number>([Crop.Pasture, Crop.PastureRich, Crop.Meadow]);

/** The crops that mean somebody is growing corn here. */
const ARABLE = new Set<number>([
  Crop.Wheat, Crop.WheatRipe, Crop.Plough, Crop.Drilled, Crop.Growing,
  Crop.Stubble, Crop.Bare,
]);

/** A parcel for sale with arable ground in it, and the arable tiles in it. */
function arableParcel(w: ReturnType<typeof district>): { parcel: number; tiles: number[] } {
  const fields = w.terrain.fields;
  for (const f of w.landForSale()) {
    const tiles = (w.land.tiles[f.parcel] ?? [])
      .filter((t) => ARABLE.has(fields.crop[t]));
    if (tiles.length > 0) return { parcel: f.parcel, tiles };
  }
  return { parcel: -1, tiles: [] };
}

describe('buying a field that is under the plough', () => {
  it('lays it down to grass', () => {
    const w = district();
    const { parcel, tiles } = arableParcel(w);
    expect(parcel, 'a parcel with arable ground in it').toBeGreaterThanOrEqual(0);

    expect(w.buyLand(parcel).ok).toBe(true);
    for (const t of tiles) {
      expect(GRASS.has(w.terrain.fields.crop[t]), `tile ${t} is grass now`).toBe(true);
    }
  });

  it('keeps it grass for the rest of the year, rather than for a month', () => {
    /*
     * The half that matters. Setting the *visible* crop to grass and leaving
     * `cropBase` arable would look fixed and then plough itself again at the turn
     * of the month, because the rotation is derived from the base — which is the
     * mechanism that caused this in the first place.
     */
    const w = district();
    const { parcel, tiles } = arableParcel(w);
    if (parcel < 0) return;
    expect(w.buyLand(parcel).ok).toBe(true);

    for (let i = 0; i < TICKS_PER_YEAR; i += TICKS_PER_DAY * 8) {
      for (let n = 0; n < TICKS_PER_DAY * 8; n++) w.step();
      for (const t of tiles) {
        const c = w.terrain.fields.crop[t];
        expect(ARABLE.has(c), `tile ${t} is not back under the plough in ${w.dateString()}`)
          .toBe(false);
      }
    }
  });

  it('marks the ground dirty, so the picture is rebuilt', () => {
    /*
     * The simulation changing and the screen not is the failure this game has hit
     * more than once — a road laid during play that was never drawn, a business
     * placed that rendered nothing. A crop change that does not touch
     * `seasonRevision` is the same bug waiting.
     */
    const w = district();
    const { parcel } = arableParcel(w);
    if (parcel < 0) return;
    const before = w.seasonRevision;
    expect(w.buyLand(parcel).ok).toBe(true);
    expect(w.seasonRevision).toBeGreaterThan(before);
  });
});

describe('buying a field with a wood in it', () => {
  it('leaves the trees alone', () => {
    /*
     * A wood is not in the rotation and nobody is farming it, so turning one to
     * pasture on purchase would be clearing somebody else's trees as a side effect
     * of a land deal.
     */
    const w = district();
    const fields = w.terrain.fields;
    const found = w.landForSale()
      .map((f) => ({
        parcel: f.parcel,
        wood: (w.land.tiles[f.parcel] ?? []).filter((t) => isWood(fields.crop[t])),
      }))
      .find((f) => f.wood.length > 0);
    if (!found) return;

    expect(w.buyLand(found.parcel).ok).toBe(true);
    for (const t of found.wood) {
      expect(isWood(fields.crop[t]), `tile ${t} is still a wood`).toBe(true);
    }
  });
});

describe('the land you have not bought', () => {
  it('carries on being farmed', () => {
    /*
     * The other side of the rule, and worth pinning: it would be easy to lay the
     * whole district down to grass and pass the tests above.
     */
    const w = district();
    const { parcel } = arableParcel(w);
    if (parcel < 0) return;
    const fields = w.terrain.fields;
    const elsewhere = arableParcel(w);
    const others = (w.land.tiles[elsewhere.parcel] ?? []).length > 0
      ? w.landForSale().map((f) => f.parcel).filter((p) => p !== parcel)
      : [];
    const watch: number[] = [];
    for (const p of others) {
      for (const t of w.land.tiles[p] ?? []) {
        if (ARABLE.has(fields.crop[t])) watch.push(t);
      }
      if (watch.length > 6) break;
    }
    expect(w.buyLand(parcel).ok).toBe(true);
    expect(watch.some((t) => ARABLE.has(fields.crop[t])), 'somebody is still farming')
      .toBe(true);
  });
});
