/**
 * Fields, by dividing land rather than by colouring tiles.
 *
 * This exists because of a picture. `art/target_frame.py` was built before any
 * of this to answer "what does the game look like", and the thing it settled
 * was the ground: the old renderer gave every tile a colour from its biome,
 * which is a per-tile lottery and reads as camouflage. Real countryside is
 * *parcels* — hard-edged fields, each one crop, separated by hedgerows you can
 * see from a mile off — and the hedge is what turns a green blur into a place.
 *
 * The generator went through three versions in the target frame, and only the
 * third works:
 *
 *   Hand-placed rectangles left bare ground showing between them, and the bare
 *   ground dominated the frame.
 *
 *   A jittered grid still read as a grid, because a jittered grid is a grid.
 *
 *   Recursive subdivision reads as countryside, because that is how
 *   countryside was made: English enclosure fields are the result of land being
 *   divided, repeatedly, by people who did not consult a lattice. Split a
 *   rectangle at a random ratio on its longer axis, stop when it is small
 *   enough, and you get parcels of genuinely different sizes meeting at
 *   T-junctions rather than crossroads.
 *
 * That is ten lines of code and it is the single biggest visual decision in the
 * project, which is the argument for making the picture first: it told us what
 * to write.
 *
 * What this does *not* do is place hedges. It labels every land tile with the
 * parcel it belongs to, and the renderer draws a hedge wherever two
 * neighbouring tiles disagree. That keeps a hedge as thin as the geometry wants
 * rather than as thick as a tile, which at five tiles to a field is the
 * difference between a hedgerow and a wall.
 */

import type { Rng } from './rng.ts';

/** What is growing. The renderer maps these to colours; the sim uses them for
 *  nothing at all, which is deliberate — a field's crop is scenery, and the
 *  moment it is scenery it can be chosen to look right. */
export const Crop = {
  Pasture: 0,
  PastureRich: 1,
  Meadow: 2,
  Wheat: 3,
  WheatRipe: 4,
  Plough: 5,
  Rough: 6,
  /** Turned and drilled: bare earth with drill lines in it. */
  Drilled: 7,
  /** Up and green, but nowhere near a crop yet. */
  Growing: 8,
  /** Cut, and the straw still on it. */
  Stubble: 9,
  /** Cut and cleared, waiting for the plough. */
  Bare: 10,
} as const;
export type Crop = (typeof Crop)[keyof typeof Crop];
export const CROP_COUNT = 11;

/**
 * The arable year, in order, with the month each stage begins.
 *
 * This is the whole reason for the four new crops. A field that is the same
 * colour in February and August is scenery; a field that is turned earth in
 * autumn, drilled in spring, green by May, gold in August and stubble in
 * September is a *place where the year passes* — and it costs four colours and a
 * lookup, because the crop was always only ever scenery (see the note on `Crop`)
 * and scenery can be chosen to look right.
 *
 * Winter wheat, which is what most of England grows: in the ground before
 * Christmas, harvested in high summer. Months are 0-based, so 8 is September.
 */
const YEAR: { from: number; crop: Crop }[] = [
  { from: 0, crop: Crop.Growing },     // January: in the ground, low and green
  { from: 3, crop: Crop.Wheat },       // April: away
  { from: 6, crop: Crop.WheatRipe },   // July: turning
  { from: 7, crop: Crop.Stubble },     // August: cut
  { from: 8, crop: Crop.Bare },        // September: cleared
  { from: 9, crop: Crop.Plough },      // October: turned over
  { from: 10, crop: Crop.Drilled },    // November: drilled
];

/**
 * The stages that somebody has to go out and do.
 *
 * The line this draws is between what the weather does and what a farm does.
 * Grass greening, a crop coming up, wheat turning gold: those need nobody, and
 * they happen on the day the calendar says. Ploughing, drilling, cutting and
 * clearing need a tractor on the field, and they are the only stages a tractor
 * is allowed to write - which is what turns the tractors from scenery into the
 * thing that changes the district.
 */
export const NEEDS_WORK: ReadonlySet<number> = new Set<number>([
  Crop.Plough, Crop.Drilled, Crop.Stubble, Crop.Bare,
]);

/**
 * What an arable field looks like on a given day.
 *
 * `offset` shifts a parcel's year by up to a month either way, so a district
 * does not turn gold all at once — real farms drill and cut on different days,
 * and a whole valley changing colour in one frame would look like a switch being
 * thrown. Derived from the parcel id by the caller, so it is stable.
 */
export function arableStage(month: number, offset: number): Crop {
  const m = ((month - offset) % 12 + 12) % 12;
  let crop: Crop = YEAR[0].crop;
  for (const step of YEAR) if (m >= step.from) crop = step.crop;
  return crop;
}

/**
 * And grass, which changes far less — but not nothing.
 *
 * A meadow is cut for hay in June and is pasture the rest of the year. Getting
 * this wrong in the other direction is the risk: grass that cycled as hard as
 * wheat would make the whole district pulse, and grass in England is green.
 */
export function grassStage(month: number, offset: number, base: Crop): Crop {
  if (base !== Crop.Meadow) return base;
  const m = ((month - offset) % 12 + 12) % 12;
  return m === 6 || m === 7 ? Crop.Stubble : Crop.Meadow;
}

/** Crops that want good flat ground, in rough order of how much they want it.
 *  A ploughed field on a hillside is possible and a wheat field on a cliff is
 *  not, and getting that wrong is visible immediately. */
const ARABLE: Crop[] = [Crop.Wheat, Crop.WheatRipe, Crop.Plough];
const GRASS: Crop[] = [Crop.Pasture, Crop.PastureRich, Crop.Meadow];

/** No parcel here — water, or too steep to be worth enclosing. */
export const NO_PARCEL = -1;

export interface FieldSettings {
  /** Stop dividing when a parcel is smaller than this on both axes. */
  minSide: number;
  /** And never let one get bigger than this, however the splits fall. */
  maxSide: number;
  /** Chance of stopping early, which is what produces the occasional big
   *  field among the small ones. */
  stopEarly: number;
  /** Ground steeper than this stays rough grazing and gets no hedge. */
  maxSlope: number;
}

export const DEFAULT_FIELDS: FieldSettings = {
  minSide: 6,
  maxSide: 15,
  stopEarly: 0.16,
  /*
   * Generous, because the first pass left too much unenclosed.
   *
   * At 26 the pale unenclosed grazing covered most of the district and the
   * fields read as islands in it. Real farmland goes a long way up a hill; only
   * genuine crag is left open. Raising this and requiring less of a parcel to be
   * land is what turns the ground from patches into countryside.
   */
  maxSlope: 52,
};

export interface FieldMap {
  /** Parcel index per tile, or NO_PARCEL. */
  parcel: Int32Array;
  /** Crop per tile. Constant within a parcel. */
  crop: Uint8Array;
  count: number;
}

/**
 * Divide the map into fields.
 *
 * `isLand` decides what may be enclosed at all, and `slopeAt` decides what is
 * worth enclosing — steep ground becomes rough grazing with no boundary, which
 * is both true and useful, because it stops hedgerows marching up a hillside
 * they would never have been planted on.
 */
export function generateFields(
  size: number,
  rng: Rng,
  isLand: (tile: number) => boolean,
  slopeAt: (tile: number) => number,
  settings: FieldSettings = DEFAULT_FIELDS,
): FieldMap {
  const parcel = new Int32Array(size * size).fill(NO_PARCEL);
  const crop = new Uint8Array(size * size).fill(Crop.Rough);

  interface Box { x0: number; y0: number; x1: number; y1: number }
  const out: Box[] = [];

  const divide = (b: Box, depth: number): void => {
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const small = w <= settings.minSide && h <= settings.minSide;
    const huge = w > settings.maxSide || h > settings.maxSide;
    if (depth <= 0 || small || (!huge && rng.chance(1, Math.round(1 / settings.stopEarly)))) {
      out.push(b);
      return;
    }
    // Split the longer axis, so parcels stay roughly compact rather than
    // degenerating into ribbons.
    const along = w > h * 1.15 ? 0 : h > w * 1.15 ? 1 : rng.int(2);
    // A third to two thirds. Anything nearer the middle produces halves and
    // the result looks like a grid again; anything nearer the edge produces
    // slivers.
    const t = 34 + rng.int(33);
    if (along === 0) {
      const cut = b.x0 + Math.max(1, Math.round((w * t) / 100));
      divide({ ...b, x1: cut }, depth - 1);
      divide({ ...b, x0: cut }, depth - 1);
    } else {
      const cut = b.y0 + Math.max(1, Math.round((h * t) / 100));
      divide({ ...b, y1: cut }, depth - 1);
      divide({ ...b, y0: cut }, depth - 1);
    }
  };

  divide({ x0: 0, y0: 0, x1: size, y1: size }, 12);

  let kept = 0;
  for (const b of out) {
    /*
     * Decide the parcel's crop from the ground it actually covers, then paint
     * it. A parcel that is mostly water or mostly cliff is not a field at all
     * and gets dropped, which is what keeps the coastline and the hills free of
     * rectangular enclosures that were never there.
     */
    let land = 0;
    let tiles = 0;
    let slope = 0;
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const t = y * size + x;
        tiles++;
        if (!isLand(t)) continue;
        land++;
        slope += slopeAt(t);
      }
    }
    if (tiles === 0 || land / tiles < 0.45) continue;
    const meanSlope = slope / Math.max(1, land);
    // Flat ground gets arable, slopes get grass, and anything steeper than the
    // threshold is left unenclosed.
    const list = meanSlope > settings.maxSlope ? null
      : meanSlope > settings.maxSlope * 0.55 ? GRASS
        : rng.chance(1, 2) ? ARABLE : GRASS;
    if (!list) continue;
    const c = list[rng.int(list.length)];
    const id = kept++;
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const t = y * size + x;
        if (!isLand(t)) continue;
        parcel[t] = id;
        crop[t] = c;
      }
    }
  }

  return { parcel, crop, count: kept };
}

/**
 * Is there a hedge on the edge between these two tiles?
 *
 * Asked by the renderer per tile edge rather than stored per tile, because a
 * hedge lives on a *boundary* and a tile is not a boundary. Storing it per tile
 * makes every hedge one tile wide, which at five tiles to a field is a wall.
 */
export function hedgeBetween(f: FieldMap, a: number, b: number): boolean {
  const pa = f.parcel[a];
  const pb = f.parcel[b];
  if (pa === pb) return false;
  // A boundary needs a field on at least one side. The edge of the enclosed
  // land meets rough grazing, moor or water with no hedge, which is right:
  // nobody planted a hedgerow along a cliff.
  return pa !== NO_PARCEL && pb !== NO_PARCEL;
}
