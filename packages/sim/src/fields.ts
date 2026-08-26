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

import { DAYS_PER_YEAR } from './constants.ts';
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
  /*
   * Woodland, and it is a land use rather than a crop.
   *
   * The district had no woods at all: trees appeared along hedgerows and thinly
   * over rough grazing, which is a countryside of *field boundaries* and nothing
   * else. England is a tenth woodland, and a wood is the one landscape feature
   * that reads at any zoom — a dark mass with a hard edge, against fields that
   * are all pale and all flat. Leaving it out made every part of the map look
   * like every other part.
   *
   * Two kinds, because the difference is one of the clearest things in a British
   * landscape and it costs one enum value. Broadleaf is the old wood in the
   * corner of a farm: irregular, mixed, mid-green. Conifer is the plantation —
   * planted on ground nobody could farm, darker, bluer, and unmistakably square,
   * which is exactly why people complain about them.
   */
  Wood: 11,
  Conifer: 12,
} as const;
export type Crop = (typeof Crop)[keyof typeof Crop];
export const CROP_COUNT = 13;

/**
 * Is this land under trees?
 *
 * Asked in four places — the seasons, the tractors, the hedges and the scatter —
 * and every one of them wants "trees" rather than "which trees", so the question
 * is worth having a name.
 */
export function isWood(c: number): boolean {
  return c === Crop.Wood || c === Crop.Conifer;
}

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
const WINTER_SOWN: { from: number; crop: Crop }[] = [
  { from: 0, crop: Crop.Growing },     // January: in the ground, low and green
  { from: 3, crop: Crop.Wheat },       // April: away
  { from: 6, crop: Crop.WheatRipe },   // July: turning
  { from: 7, crop: Crop.Stubble },     // August: cut
  { from: 8, crop: Crop.Bare },        // September: cleared
  { from: 9, crop: Crop.Plough },      // October: turned over
  { from: 10, crop: Crop.Drilled },    // November: drilled
];

/**
 * And the other half of the district: spring barley.
 *
 * Not variety for its own sake — it is the fix for a real hole. Winter wheat is
 * drilled before Christmas and cut in August, so every job that *shows* on a
 * winter-sown field falls between August and November. A district growing
 * nothing else has four months, March to June, in which there is no field work
 * anywhere in it at all, and those are precisely the months a new player sees:
 * the world opens in March, and the first tractor with anything to do would have
 * appeared about eight hours in. Reported, correctly, as "visually I can't see a
 * difference as tractors go over the ground".
 *
 * Spring barley is the answer a farm would give. It sits as ploughed ground over
 * winter, is drilled in March, is up by April and cut in September — so it works
 * in exactly the months the winter crop does not, and a mixed district has
 * something going on in nearly every one of them. Which is also just what
 * English farmland is: nobody puts a whole parish into one crop.
 */
const SPRING_SOWN: { from: number; crop: Crop }[] = [
  { from: 0, crop: Crop.Plough },       // January: turned over, waiting on the weather
  { from: 2, crop: Crop.Drilled },      // March: drilled
  { from: 3, crop: Crop.Growing },      // April: through
  { from: 4, crop: Crop.Wheat },        // May: away
  { from: 7, crop: Crop.WheatRipe },    // August: turning
  { from: 8, crop: Crop.Stubble },      // September: cut
  { from: 9, crop: Crop.Bare },         // October: cleared
  { from: 11, crop: Crop.Plough },      // December: ploughed for the spring
];

/**
 * Which rotation a parcel is on, from its own id.
 *
 * Two in five, and stable for the life of the world because it is a pure
 * function of the parcel. A random draw per call would have a field changing its
 * mind about what it is growing every time anything asked.
 */
/**
 * The year, as three numbers about leaves.
 *
 * The district has had four seasons since the beginning and the vegetation has
 * never known about any of them: the same tree, in the same green, in January
 * and July. Snow was wired up because snow is *ground*, and the ground had a
 * uniform waiting for it — foliage had nothing.
 *
 * Three scalars rather than a season name, because everything that reads this
 * wants to *blend*. A named season is a switch, and a switch means the whole
 * district changes its trees between one frame and the next, which is the same
 * mistake the sun made before it was made continuous. So:
 *
 *   `leaf`   — how much foliage there is. Bare in January, full by June.
 *   `spring` — the fresh, yellow-green, blossom-and-daffodils part of it.
 *   `autumn` — how far the turn has gone, gold at its peak.
 *
 * English rather than generic. Leaf comes late here and goes late: nothing much
 * before the end of March, full canopy by the start of June, the turn through
 * October, and bare by the end of November. That asymmetry — six weeks to come
 * into leaf, ten to go over — is most of what makes a year feel like a year
 * rather than a sine wave.
 */
export function foliage(day: number): { leaf: number; spring: number; autumn: number } {
  const t = (((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR) / DAYS_PER_YEAR;
  // Fractions of the year: the calendar is twelve thirty-day months.
  const march = 3 / 12;
  const june = 5 / 12;
  const october = 8.6 / 12;
  const december = 11 / 12;
  const ramp = (a: number, b: number): number =>
    Math.max(0, Math.min(1, (t - a) / (b - a)));
  // Up through spring, held through summer, down through autumn.
  const coming = ramp(march, june);
  const going = 1 - ramp(october, december);
  const leaf = Math.min(coming, going);
  /*
   * Spring is the *arrival*, not a date range: it is at its strongest while the
   * leaf is still coming and gone once the canopy is full. Squared so the
   * yellow-green is a fortnight of the year rather than a season of it.
   */
  const rising = coming * (1 - coming);
  const spring = Math.min(1, rising * 4) * (1 - going * 0 + 0);
  /*
   * And autumn is the *going*, which is why it is derived from the same ramp
   * rather than from another pair of dates. Peaks when half the leaf has gone.
   */
  const falling = (1 - going) * going;
  const autumn = Math.min(1, falling * 4);
  return { leaf, spring, autumn };
}

export function springSown(parcel: number): boolean {
  return ((parcel * 2246822519) >>> 0) % 5 < 2;
}

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
/**
 * The stages that have something living on them.
 *
 * Used to decide whether a field with no job on it is worth visiting at all. A
 * sprayer belongs on a growing crop; ploughed earth and stubble have nobody in
 * them, and a machine crawling over bare ground doing nothing is worse than an
 * empty field, because it invites the question of what it is for.
 */
export const GROWING: ReadonlySet<number> = new Set<number>([
  Crop.Pasture, Crop.PastureRich, Crop.Meadow,
  Crop.Growing, Crop.Wheat, Crop.WheatRipe,
]);

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
export function arableStage(month: number, offset: number, spring = false): Crop {
  const year = spring ? SPRING_SOWN : WINTER_SOWN;
  const m = ((month - offset) % 12 + 12) % 12;
  let crop: Crop = year[0].crop;
  for (const step of year) if (m >= step.from) crop = step.crop;
  return crop;
}

/**
 * And grass, which changes far less — but not nothing, and not once.
 *
 * A meadow is cut more than annually: silage in the middle of May, a second cut
 * in July, and it is green again within a fortnight of each. Cutting it once was
 * both wrong and the reason the early summer had nothing in it — May and June
 * are the busiest weeks of the grass year and the district was standing still
 * through them.
 *
 * Getting this wrong in the other direction is the real risk, and it is why only
 * *meadows* are touched. Pasture is grazed rather than cut, it is the majority of
 * the grass in the district, and grass that cycled as hard as wheat would make
 * the whole valley pulse. England is green; the meadows are the part that gets
 * mown.
 */
export function grassStage(month: number, offset: number, base: Crop): Crop {
  if (base !== Crop.Meadow) return base;
  const m = ((month - offset) % 12 + 12) % 12;
  // Cut in May and again in July, green in between and after.
  return m === 4 || m === 6 ? Crop.Stubble : Crop.Meadow;
}

/** Crops that want good flat ground, in rough order of how much they want it.
 *  A ploughed field on a hillside is possible and a wheat field on a cliff is
 *  not, and getting that wrong is visible immediately. */
const ARABLE: Crop[] = [Crop.Wheat, Crop.WheatRipe, Crop.Plough];
const GRASS: Crop[] = [Crop.Pasture, Crop.PastureRich, Crop.Meadow];
// One each, because a wood is not a rotation: unlike a field it is the same
// thing every year, and the variety in it comes from the trees rather than from
// the ground under them.
const BROADLEAF: Crop[] = [Crop.Wood];
const CONIFER: Crop[] = [Crop.Conifer];

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
    /*
     * Flat ground gets arable, slopes get grass, and steep ground gets planted.
     *
     * The steep parcels used to be dropped and left as unenclosed rough, which
     * is where the district's total absence of woodland came from — the one
     * category of land that in England reliably *is* a wood was the one category
     * being thrown away. Ground too steep to plough is not empty. It is grazed,
     * or it is under trees, and which of the two it is is the difference between
     * a bare hillside and a wooded one.
     *
     * One steep parcel in four, and the proportion is the whole of the tuning.
     * Rather more than half the parcels in a district come out above `maxSlope`,
     * so planting even two thirds of them put a third of the map under trees —
     * which reads as Scandinavia. The point of an English wood is that it is a
     * dark patch in a green quilt rather than the quilt itself, and the rest of
     * the steep ground stays what it was: open hill.
     */
    let list: readonly Crop[] | null;
    if (meanSlope > settings.maxSlope) {
      if (!rng.chance(1, 4)) continue;
      // The steepest goes to plantation, which is exactly how it happened: the
      // Forestry Commission planted conifers on the ground nobody else wanted.
      list = meanSlope > settings.maxSlope * 2.2 ? CONIFER : BROADLEAF;
    } else if (meanSlope > settings.maxSlope * 0.55) {
      // A hanging wood on the shoulder of a hill. One parcel in ten, which is
      // enough that a wood turns up in the middle distance without the hillsides
      // closing over.
      list = rng.chance(1, 10) ? BROADLEAF : GRASS;
    } else {
      // And a spinney down on the flat, rarer still: on good land trees are what
      // you keep rather than what you plant.
      list = rng.chance(1, 24) ? BROADLEAF
        : rng.chance(1, 2) ? ARABLE : GRASS;
    }
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
  if (pa === NO_PARCEL || pb === NO_PARCEL) return false;
  /*
   * And two woods that meet are one wood.
   *
   * Woodland is a parcel like any other so that it gets an id, a colour and a
   * shape — but the subdivision that produced those parcels was dividing *land*,
   * not planting, so a large wood arrives as three or four boxes side by side.
   * Fencing between them would draw a hedgerow through the middle of a forest.
   *
   * The boundary between a wood and a field stays, because that one is real: it
   * is the fence that keeps the stock out of the trees, and it is what gives a
   * wood the hard edge that makes it read as a wood.
   */
  return !(isWood(f.crop[a]) && isWood(f.crop[b]));
}
