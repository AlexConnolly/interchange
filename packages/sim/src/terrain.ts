/**
 * Region generation. One continuous 1024 x 1024 landscape per seed (D6).
 *
 * O2 is closed as a temperate island: highland north, industrial midlands,
 * an estuary and lowland to the south-east. A recognisable geography buys
 * personality for free and pins the place-name set and the industry mix.
 *
 * Everything here is a pure function of (x, y, seed) via `noise.ts`, so a
 * chunk generated on demand is identical to the same chunk generated in a
 * full-region pass. That is what makes streaming possible at all.
 */

import { FX_ONE, fx, fxMul, fxDiv, fxHypot, fxSqrt, type Fx } from './fixed.ts';
import { fbm, ridged, warpedFbm, hash3 } from './noise.ts';
import { erode } from './erosion.ts';
import { generateFields, type FieldMap } from './fields.ts';
import { Rng } from './rng.ts';

/** One height unit is half a metre. Sea level is zero. */
export const HEIGHT_UNIT_CM = 50;
export const SEA_LEVEL = 0;

/** One tile is 32 m across. See docs/scale.md for why vehicle speed is not
 *  reconciled with the calendar. */
export const TILE_METRES = 32;

// Enums are not erasable syntax, and the sim has to run under Node's native
// type stripping as well as through a bundler, so every enumeration in this
// package is a frozen const object with a companion union type.
export const Biome = {
  Ocean: 0,
  Shallows: 1,
  Beach: 2,
  Grass: 3,
  Farmland: 4,
  Moor: 5,
  Forest: 6,
  Rock: 7,
  Snow: 8,
  River: 9,
  Marsh: 10,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];
export const BIOME_NAMES = [
  'ocean', 'shallows', 'beach', 'grass', 'farmland', 'moor',
  'forest', 'rock', 'snow', 'river', 'marsh',
] as const;

export const TileFlag = {
  River: 1,
  Coast: 2,
  Buildable: 4,
  TownLand: 8,
  Steep: 16,
  /**
   * On the largest connected run of land.
   *
   * Four-connected, because that is how the road router walks: a tile you can
   * only reach diagonally is a tile no road can get to, so eight-connectivity
   * would call an island reachable and be contradicted by everything downstream.
   *
   * A flag rather than a local check because *everything* placed on the map wants
   * it and each thing that forgets fails differently and silently. A town on an
   * islet takes the road network down with it; a creamery on one is simply never
   * connected, and the district quietly opens on a different cargo.
   */
  Mainland: 32,
} as const;
export type TileFlag = (typeof TileFlag)[keyof typeof TileFlag];

/** Natural deposits. Index 0 is "nothing here". */
export const Deposit = {
  None: 0,
  Coal: 1,
  IronOre: 2,
  Stone: 3,
  Timber: 4,
  Clay: 5,
  Bauxite: 6,
  Oil: 7,
  Fish: 8,
  Farm: 9,
  Sand: 10,
  Lithium: 11,
} as const;
export type Deposit = (typeof Deposit)[keyof typeof Deposit];
export const DEPOSIT_NAMES = [
  'none', 'coal', 'iron ore', 'stone', 'timber', 'clay',
  'bauxite', 'oil', 'fish', 'farmland', 'sand', 'lithium',
] as const;

export interface WorldConfig {
  /** Tiles per side. 1024 desktop, 512 tablet tier, 256 for tests. */
  size: number;
  seed: number;
  townCount: number;
  companyCount: number;
}

export const DEFAULT_CONFIG: WorldConfig = {
  size: 1024,
  seed: 1860,
  townCount: 14,
  companyCount: 4,
};

export interface TownSeed {
  x: number;
  y: number;
  name: string;
  /** 0 market, 1 industrial, 2 port, 3 resort, 4 dormitory */
  character: number;
  population: number;
}

export interface DepositSeed {
  x: number;
  y: number;
  kind: Deposit;
  /** Richness 0..100; drives extraction rate and how long it lasts. */
  richness: number;
}

export class Terrain {
  readonly size: number;
  readonly seed: number;
  /** Field parcels. See fields.ts — this is what the ground is made of, and
   *  the single biggest visual decision in the project. */
  fields!: FieldMap;
  readonly height: Int16Array;
  readonly biome: Uint8Array;
  readonly flags: Uint8Array;
  readonly deposit: Uint8Array;
  /** Base amenity before any industry or traffic penalty. design.md 2.3. */
  readonly amenityBase: Uint8Array;

  towns: TownSeed[] = [];
  deposits: DepositSeed[] = [];

  constructor(size: number, seed: number) {
    this.size = size;
    this.seed = seed;
    const n = size * size;
    this.height = new Int16Array(n);
    this.biome = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.deposit = new Uint8Array(n);
    this.amenityBase = new Uint8Array(n);
  }

  idx(x: number, y: number): number {
    return y * this.size + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  heightAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return -200;
    return this.height[y * this.size + x];
  }

  isWater(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    const i = y * this.size + x;
    return this.height[i] <= SEA_LEVEL || (this.flags[i] & TileFlag.River) !== 0;
  }

  isLand(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.height[y * this.size + x] > SEA_LEVEL;
  }
}

/**
 * The land mass. Returns a value in Q16.16 where anything above zero is land.
 *
 * Three fields multiplied rather than added: a warped continental blob for the
 * coastline, a ridged field pushed toward the north for the highlands, and
 * broad rolling ground everywhere. Adding them gives a uniform lumpy plateau;
 * multiplying keeps the coastline sharp, because the continental term goes to
 * zero at the shore and takes everything else with it.
 */
function landField(x: number, y: number, size: number, seed: number): Fx {
  const inv = fxDiv(FX_ONE, fx(size));
  const u = fxMul(fx(x), inv);
  const v = fxMul(fx(y), inv);

  // Distance from centre, squashed so the island is wider than it is tall.
  const cx = (u - (FX_ONE >> 1)) | 0;
  const cy = fxMul((v - (FX_ONE >> 1)) | 0, fx(1.25));
  const r = fxHypot(cx, cy);

  // Warped noise on the shore radius turns a disc into a coastline with
  // inlets and headlands.
  // Two scales of coast noise. One alone gives a smooth oval with a slow
  // wobble: the low frequency has to carry the bays and headlands, and a
  // second, sharper term has to bite the coves into them.
  const bays = warpedFbm(fxMul(u, fx(9)), fxMul(v, fx(9)), seed ^ 0x51ab, 5, fx(0.45));
  const coves = fbm(fxMul(u, fx(26)), fxMul(v, fx(26)), seed ^ 0x9d17, 3);
  const shore =
    (fx(0.33) + fxMul(bays, fx(0.20)) + fxMul((coves - (FX_ONE >> 1)) | 0, fx(0.06))) | 0;

  // The mask is a narrow ramp at the shore, not a falloff from the centre.
  // Squaring a centre-relative falloff — the obvious first move — pulls the
  // whole interior down with it, and the highlands the design asks for end up
  // as 200 m hills because the northern uplands sit closest to the coast.
  const EDGE = fx(0.07);
  let mask = fxDiv((shore - r) | 0, EDGE);
  if (mask <= 0) return 0;
  if (mask > FX_ONE) mask = FX_ONE;
  // Smoothstep the ramp so the shoreline is not a visible ring.
  mask = fxMul(fxMul(mask, mask), (3 * FX_ONE - 2 * mask) | 0);

  // Three elevation bands, each with its own north-weighting, rather than one
  // blended field. A single term cannot give thousand-metre highlands in the
  // north *and* flat estuary country in the south — whatever weight makes the
  // peaks tall puts the whole midlands at three hundred metres with it, which
  // is exactly what the first two attempts did.
  const nb = (FX_ONE - v) | 0;
  const nb2 = fxMul(nb, nb);
  const nb4 = fxMul(nb2, nb2);

  //   highland — mountains, confined hard to the north by a fourth power
  const mountains = ridged(fxMul(u, fx(5)), fxMul(v, fx(5)), seed ^ 0x2f19, 6);
  const highland = fxMul(mountains, nb4);

  //   hills — the industrial midlands, a broader and gentler weighting
  const hillNoise = fbm(fxMul(u, fx(14)), fxMul(v, fx(14)), seed ^ 0x3ba7, 4);
  const hills = fxMul(hillNoise, fxMul(nb, fxSqrt(nb)));

  //   rolling — everywhere, damped south so the lowlands are genuinely low
  const rolling = fbm(fxMul(u, fx(9)), fxMul(v, fx(9)), seed ^ 0x77c3, 5);
  const rollDamp = (fx(0.45) + fxMul(nb, fx(0.55))) | 0;

  const elevation =
    (fx(0.02) +
      fxMul(highland, fx(0.85)) +
      fxMul(hills, fx(0.22)) +
      fxMul(fxMul(rolling, rollDamp), fx(0.09))) | 0;

  return fxMul(mask, elevation);
}

export function generateTerrain(cfg: WorldConfig): Terrain {
  const t = new Terrain(cfg.size, cfg.seed);
  const size = cfg.size;
  const rng = new Rng(cfg.seed ^ 0x5eed);

  // ---- 1. elevation ------------------------------------------------------
  // Raised to leave room for the erosion pass below, which takes a fifth off
  // the high ground on its way to carving valleys into it.
  const PEAK = 5100; // half-metre units, so a top ridge is around 1000 m after erosion
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const f = landField(x, y, size, cfg.seed);
      const i = y * size + x;
      t.height[i] = f <= 0 ? -6 : Math.min(32000, Math.trunc((f * PEAK) / FX_ONE));
    }
  }
  /*
   * And then weather it. erosion.ts has the reasoning; the short version is
   * that noise makes a lump and water makes a landscape, and the valleys this
   * cuts are also where any sensible person would put a railway.
   *
   * Before the rivers, deliberately: the river carver looks for the lowest
   * path across the region, and after erosion there is a drainage network for
   * it to find instead of whichever way the noise happened to sag.
   */
  erode(t.height, size);
  deepenOffshore(t);

  // ---- 2. rivers ---------------------------------------------------------
  /*
   * Sixty sources, which sounds absurd and is not.
   *
   * Most of them never become anything: a source that runs into an existing
   * course within eight tiles is discarded rather than carved, so what this
   * number really sets is how *finely* the district is sampled for places a
   * watercourse could start. At twenty-four the answer was 1.2% of the land under
   * water and the nearest beck to the opening twenty-eight tiles away — real
   * drainage that no player would ever see. At sixty it is 2.9% and nine tiles,
   * which is a stream in view from the start.
   *
   * Five wide rivers was a map with a barrier on it. This is a map with
   * drainage, which is what lowland England looks like from the air: every few
   * fields a ditch or a beck, half of them noticeable only by the line of
   * willows along them.
   */
  carveRivers(t, rng, Math.max(60, Math.round(size / 128) * 60));

  // ---- 3. biomes and buildability ---------------------------------------
  classify(t, cfg.seed);
  /*
   * And which land is the mainland, once, now that the heights are final.
   *
   * Everything placed after this asks the same question — towns, industries,
   * yards — and the answer cannot change, so it is computed once and flagged
   * rather than rediscovered by each of them with its own idea of connectivity.
   */
  markMainland(t);

  /*
   * Fields. After the biomes, because a parcel's crop is decided from the
   * ground it covers, and after erosion, because what is steep enough to leave
   * unenclosed depends on the erosion pass having happened.
   */
  t.fields = generateFields(
    size, rng,
    (tile) => t.height[tile] > SEA_LEVEL && (t.flags[tile] & TileFlag.River) === 0,
    (tile) => slopeAt(t, tile % size, (tile / size) | 0),
  );

  // ---- 4. amenity --------------------------------------------------------
  computeBaseAmenity(t);

  // ---- 5. towns and deposits --------------------------------------------
  t.towns = placeTowns(t, rng, cfg.townCount);
  t.deposits = placeDeposits(t, rng);

  return t;
}

/** Push the sea floor down with distance from land, so the coast reads as a
 *  shelf rather than a cliff and shallows become a usable biome. */
function deepenOffshore(t: Terrain): void {
  const size = t.size;
  const n = size * size;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (t.height[i] > SEA_LEVEL) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % size;
    const y = (i / size) | 0;
    const d = dist[i];
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (dist[j] !== -1) continue;
      dist[j] = d + 1;
      queue[tail++] = j;
    }
  }
  for (let i = 0; i < n; i++) {
    if (t.height[i] > SEA_LEVEL) continue;
    const d = dist[i] < 0 ? 64 : dist[i];
    t.height[i] = -Math.min(240, 2 + Math.trunc((d * d) / 4)) | 0;
  }
}

/**
 * Rivers by steepest descent from high ground.
 *
 * Walking downhill stalls in a local pit, and on a noisy field pits are
 * everywhere, so a stalled walk lowers the basin and continues from the lowest
 * rim tile. Without that the north of the map ends up with thirty rivers that
 * each stop after four tiles.
 */
function carveRivers(t: Terrain, rng: Rng, count: number): void {
  const size = t.size;
  for (let n = 0; n < count; n++) {
    // Source: the highest of a handful of candidates, so rivers start on
    // ridges rather than wherever the first draw happened to land.
    let sx = 0;
    let sy = 0;
    let best = -1;
    /*
     * Anywhere on the map, and it used to be only the top half.
     *
     * `rng.range(4, (size >> 1) - 5)` confined every source to the northern
     * quarter of the district, so every watercourse ran out of the north and the
     * south had none at all. Measured on the shipping seed: 438 stream tiles, the
     * nearest one 39.6 tiles from where the game opens, and *zero* of them inside
     * the player's influence — so the water was real, drainable, and had never
     * been seen by anybody.
     *
     * Sampling the whole map costs nothing: the "highest of forty candidates"
     * below is what makes a river start on a ridge, and that works wherever the
     * ridges are.
     */
    /*
     * One source per sector, so the district drains everywhere and not just off
     * the highlands.
     *
     * "Highest of forty candidates drawn from the whole map" sounds like a
     * spread and is the opposite of one: it is an argmax, so every walk finds
     * the same range of hills and the entire network ends up in one corner.
     * Measured with thirty-four rivers and 5.5% of the land under water, a
     * seven-hundred-tile disc around the opening still contained *none* of it,
     * on three seeds out of three.
     *
     * A grid of sectors with the highest point in each fixes it without giving
     * up what the argmax was for — a river still starts on the local ridge, it
     * just has to be the local one. Which is also true of rivers.
     */
    /*
     * The sector grid follows the count, rather than being fixed at four.
     *
     * A 4x4 grid on a 128-tile map is sectors thirty-two tiles across, and one
     * source per sector means the nearest watercourse to any given point can
     * easily be twenty or thirty tiles away — which is to say, off screen. That
     * is how the shipping district ended up with real streams that the player
     * could never see: 174 of them, none within thirty-five tiles of where the
     * game opens.
     *
     * Matching the grid to the count keeps the spread even as the count rises,
     * instead of stacking more and more sources into the same sixteen cells.
     */
    const grid = Math.max(2, Math.round(Math.sqrt(count)));
    const cell = Math.max(8, Math.floor(size / grid));
    const gx = Math.min(size - cell - 1, (n % grid) * cell);
    const gy = Math.min(size - cell - 1, (Math.floor(n / grid) % grid) * cell);
    for (let k = 0; k < 24; k++) {
      const x = Math.min(size - 5, Math.max(4, gx + rng.int(cell)));
      const y = Math.min(size - 5, Math.max(4, gy + rng.int(cell)));
      const h = t.height[y * size + x];
      if (h > best) {
        best = h;
        sx = x;
        sy = y;
      }
    }
    /*
     * A source wants high ground, but not *that* high.
     *
     * At 900 a district whose hills happen to be gentle got no watercourses at
     * all — the threshold was written against one map and silently deleted the
     * feature on others. Six hundred is a shoulder rather than a summit, which
     * is where a spring is anyway.
     */
    if (best < 600) continue;

    let x = sx;
    let y = sy;
    const visited = new Set<number>();
    /*
     * The path is collected first and cut afterwards.
     *
     * Carving as it walks meant a source that ran two tiles and then met an
     * existing river left those two tiles behind as water — a pond in the middle
     * of a field, with no channel leading in or out. With a source in every
     * sector and most of them draining into the same few valleys, the district
     * filled up with them, and they are unmistakable from above: little blue
     * rectangles sitting in the grass.
     *
     * Collecting first also means the walk follows the terrain as it *found* it
     * rather than as it has just altered it, which is the more honest model
     * anyway: a river follows the valley, and the valley is the thing the river
     * cut over rather longer than one pass.
     */
    const course: number[] = [];
    let digs = 0;
    for (let step = 0; step < size * 3; step++) {
      const i = y * size + x;
      if (visited.has(i)) break;
      visited.add(i);
      if (t.height[i] <= SEA_LEVEL) break;
      /*
       * Stop once it is down on the flat, rather than wandering about on it.
       *
       * When the walk finds no lower neighbour it lowers the basin and carries
       * on from the rim, which is what stops a river stalling in a pit — and on
       * the wide flat ground near the coast it turns into a machine for filling
       * that ground in. The walk meanders, every tile it touches is flagged, and
       * the result is not a channel at all but a lake: measured, a median width
       * of six tiles and a worst of thirteen, on a generator whose channel is one
       * tile wide by construction.
       *
       * A river reaching the levels is at its mouth. Ending it there is both what
       * happens and what keeps it a river.
       */
      if (t.height[i] < SEA_LEVEL + 60) break;
      /*
       * Met another watercourse: join it and stop.
       *
       * Steepest descent means several sources funnel into the same valley, so
       * without this the lower reaches get carved once per tributary — each pass
       * widening the channel and re-flagging its neighbours. Measured: 13.5% of
       * the land under water district-wide and 47% of it within fifteen tiles of
       * where the game opens, which is not drainage, it is a flood.
       *
       * Stopping is also what actually happens. A beck that meets a river does
       * not continue as a separate beck; it *is* the river from there on, and
       * the river has already been carved by whichever walk got there first.
       * Not before `step > 2`, or two sources that start beside each other kill
       * one another immediately.
       *
       * On the tile itself, not alongside it. Stopping when merely *adjacent* to
       * an existing course was an attempt to fix the width and fixed nothing —
       * measured either way, the median channel stayed six tiles — because the
       * width was never coming from tributaries running in parallel. It was
       * coming from the basin escape below. All that rule achieved was to kill
       * most of the tributaries, which is where the district's water went.
       */
      if (step > 2 && (t.flags[i] & TileFlag.River) !== 0) break;

      /*
       * Widen as it descends: a trickle on the moor, a beck by the village.
       *
       * Capped at one rather than two. Two gives a channel five tiles across,
       * which at five tiles to a field is not a stream — it is a river, and it
       * cuts the district in half wherever it runs. "Small rivers/streams, just
       * small ones" is right, and it is also what most of England actually has:
       * the water you cross without noticing, on a bridge you would not look at
       * twice.
       */
      const width = Math.min(1, Math.trunc(step / Math.max(1, size >> 1)));
      course.push(i, width);

      // Steepest descent among eight neighbours, with a positional jitter so a
      // flat run does not produce a ruler-straight line.
      let bx = -1;
      let by = -1;
      let bh = t.height[i];
      for (let d = 0; d < 8; d++) {
        const nx = x + NEIGH8X[d];
        const ny = y + NEIGH8Y[d];
        if (nx < 1 || ny < 1 || nx >= size - 1 || ny >= size - 1) continue;
        const j = ny * size + nx;
        if (visited.has(j)) continue;
        const h = t.height[j] + ((hash3(nx, ny, t.seed ^ 0xbeef) & 7) - 3);
        if (h < bh) {
          bh = h;
          bx = nx;
          by = ny;
        }
      }
      if (bx < 0) {
        /*
         * Stalled in a pit. Dig out of it — but only so many times.
         *
         * Lowering the rim and carrying on is what stops a walk dying four tiles
         * from its source on a noisy heightfield, and it is also a machine for
         * filling flat ground in: every tile the walk touches is flagged, and on
         * the levels it does not descend so much as wander, stall, dig, wander.
         * Measured, that produced a median channel width of six tiles and a worst
         * of twenty, from a generator whose channel is one tile wide by
         * construction. It was not a river; it was a lake with a river's
         * paperwork.
         *
         * Six escapes is enough to cross the pitted upland the erosion pass
         * leaves behind, and far too few to excavate a floodplain. A watercourse
         * that has had to dig its way out of six basins has reached the levels,
         * and the levels are where rivers end.
         */
        if (++digs > 6) break;
        let lx = -1;
        let ly = -1;
        let lh = 1 << 30;
        for (let d = 0; d < 8; d++) {
          const nx = x + NEIGH8X[d];
          const ny = y + NEIGH8Y[d];
          if (nx < 1 || ny < 1 || nx >= size - 1 || ny >= size - 1) continue;
          if (visited.has(ny * size + nx)) continue;
          const h = t.height[ny * size + nx];
          if (h < lh) {
            lh = h;
            lx = nx;
            ly = ny;
          }
        }
        if (lx < 0) break;
        t.height[ly * size + lx] = Math.min(t.height[i] - 1, lh);
        bx = lx;
        by = ly;
      }
      /*
       * Step the corner as well, so the channel is joined up.
       *
       * The descent walks eight neighbours, so most steps are diagonal — and two
       * tiles that meet only at a corner are not a channel, they are two tiles.
       * Drawn, that is a dotted line of separate blue squares lying across a
       * field, which is exactly what it looked like: the water was there, in the
       * right places, and read as scattered ponds because nothing joined them.
       *
       * Carrying the corner tile makes the course four-connected, which is also
       * the connectivity the road router uses — so a beck the eye sees as
       * continuous is continuous to everything else that asks.
       */
      if (bx !== x && by !== y) course.push(by * size + x, width);

      x = bx;
      y = by;
    }

    /*
     * And only if it got somewhere. Eight tiles is the shortest thing that reads
     * as a watercourse rather than as a puddle; anything shorter is a source
     * that met a river almost at once, and the river it met is already drawn.
     */
    if (course.length < 8 * 2) continue;
    for (let k = 0; k < course.length; k += 2) {
      const tile = course[k];
      carveAt(t, tile % size, (tile / size) | 0, course[k + 1]);
    }
  }
}

/**
 * Cut the channel, and grade the banks down to it.
 *
 * Carving the channel alone leaves a knife-edge gash wherever the river runs
 * across a slope: the bed drops by four units and the tile beside it does not,
 * so a valley side becomes a row of shards. A real river has cut its banks
 * too, and the fix is to taper outward for a couple of tiles past the channel.
 */
function carveAt(t: Terrain, x: number, y: number, width: number): void {
  const size = t.size;
  /*
   * How deep the channel is cut, and it is now two rather than four.
   *
   * Four was written for five wide rivers and is far too much for a network of
   * brooks: the trench plus its graded banks tips the surrounding tiles over the
   * slope threshold that decides whether ground is buildable, so spreading
   * streams across the district quietly deleted a fifth of its industries.
   * Measured over thirty seeds: 25.3 sites an average district before, 20.4
   * after, and the openings that need a pair of them fell from 28 in 30 to 20.
   *
   * A beck two units below the field it runs through is still a beck. It reads
   * the same from above — what says "water" is the colour and the banks, not the
   * depth, which is the one dimension this camera cannot see.
   */
  const bed = Math.max(SEA_LEVEL + 1, t.height[y * size + x] - 2);
  const bank = width + 1;
  for (let dy = -bank; dy <= bank; dy++) {
    for (let dx = -bank; dx <= bank; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      const r2 = dx * dx + dy * dy;
      /*
       * The channel. A width of nought is one tile and not five.
       *
       * `r2 <= width * width + 1` is what rounds the blob off at every other
       * width, and at nought it quietly becomes a plus five tiles across — so
       * the narrowest possible headwater was three tiles wide and there was no
       * way to ask for a ditch. A brook you can step over is the commonest
       * watercourse in England and it needs to be expressible.
       */
      const channel = width === 0 ? r2 === 0 : r2 <= width * width + 1;
      if (channel) {
        if (t.height[j] > SEA_LEVEL) t.height[j] = Math.min(t.height[j], bed);
        t.flags[j] |= TileFlag.River;
      } else if (r2 <= bank * bank + 1 && t.height[j] > SEA_LEVEL) {
        // Bank: pulled a fraction of the way down to the bed, so the profile
        // reads as a valley rather than as a slot.
        const d = Math.sqrt(r2) - width;
        const k = Math.max(0, 1 - d / 1.4);
        const target = bed + (t.height[j] - bed) * (1 - k * 0.75);
        if (target < t.height[j]) t.height[j] = Math.round(target);
      }
    }
  }
}

/** Is this tile, or anything touching it, already a watercourse? */
function nearRiver(t: Terrain, x: number, y: number): boolean {
  const size = t.size;
  if ((t.flags[y * size + x] & TileFlag.River) !== 0) return true;
  for (let d = 0; d < 8; d++) {
    const nx = x + NEIGH8X[d];
    const ny = y + NEIGH8Y[d];
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    if ((t.flags[ny * size + nx] & TileFlag.River) !== 0) return true;
  }
  return false;
}

const NEIGH8X = [1, 1, 0, -1, -1, -1, 0, 1];
const NEIGH8Y = [0, 1, 1, 1, 0, -1, -1, -1];

/** Steepest local drop across one tile, in height units. Drives buildability,
 *  construction cost, and the rock biome above the tree line. */
export function slopeAt(t: Terrain, x: number, y: number): number {
  const h = t.heightAt(x, y);
  let m = 0;
  for (let d = 0; d < 8; d++) {
    const s = Math.abs(t.heightAt(x + NEIGH8X[d], y + NEIGH8Y[d]) - h);
    if (s > m) m = s;
  }
  return m;
}

function classify(t: Terrain, seed: number): void {
  const size = t.size;
  const inv = fxDiv(FX_ONE, fx(size));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const h = t.height[i];
      const slope = slopeAt(t, x, y);
      if (slope > 34) t.flags[i] |= TileFlag.Steep;

      if (h <= SEA_LEVEL) {
        t.biome[i] = h > -20 ? Biome.Shallows : Biome.Ocean;
        continue;
      }
      if ((t.flags[i] & TileFlag.River) !== 0) {
        t.biome[i] = Biome.River;
        // Guarded: this file runs in the browser client as well as under
        // Node (the balance tool, the test suite), and `process` does not
        // exist there unless a bundler chooses to polyfill it. Vite does
        // not, so the unguarded read threw on every page load and blanked
        // the client to a plain background colour before React ever got a
        // chance to render — `WETBUILD` is a debug knob for the Node-side
        // tools and was never meant to be reachable from the client at all.
        if (typeof process !== 'undefined' && process.env.WETBUILD) t.flags[i] |= TileFlag.Buildable;
        /*
         * And *not* buildable, which it used to be marked explicitly.
         *
         * That was survivable while the watercourses were five rivers in the far
         * north that nothing was ever placed near. It stopped being survivable
         * the moment the district drained properly: measured on the shipping
         * seed, eight of twenty businesses and two of the three towns were
         * standing in the water. From above, a village in a stream.
         *
         * Roads are unaffected — the road network's own water test is the sea
         * level and nothing else, which is what lets a lane cross a beck and get
         * a bridge. Building in one is a different question and the answer is no.
         */
        continue;
      }

      let coastal = false;
      for (let d = 0; d < 8 && !coastal; d++) {
        if (t.heightAt(x + NEIGH8X[d], y + NEIGH8Y[d]) <= SEA_LEVEL) coastal = true;
      }
      if (coastal) t.flags[i] |= TileFlag.Coast;

      const u = fxMul(fx(x), inv);
      const v = fxMul(fx(y), inv);
      const moisture = fbm(fxMul(u, fx(7)), fxMul(v, fx(7)), seed ^ 0x11d3, 4);
      const scatter = fbm(fxMul(u, fx(22)), fxMul(v, fx(22)), seed ^ 0x4ce1, 3);

      if (h > 2400 || (h > 1900 && slope > 26)) t.biome[i] = Biome.Snow;
      else if (h > 1700 || slope > 40) t.biome[i] = Biome.Rock;
      else if (h > 950) t.biome[i] = Biome.Moor;
      else if (coastal && h < 55 && slope < 10) t.biome[i] = Biome.Beach;
      else if (h < 40 && slope < 5 && moisture > fx(0.66)) t.biome[i] = Biome.Marsh;
      else if ((moisture + fxMul(scatter, fx(0.25))) > fx(0.70) && h < 1200) t.biome[i] = Biome.Forest;
      else if (h < 560 && slope < 14 && moisture > fx(0.3)) t.biome[i] = Biome.Farmland;
      else t.biome[i] = Biome.Grass;

      if (slope < 24) t.flags[i] |= TileFlag.Buildable;
    }
  }
}

/**
 * Base amenity, design.md 2.3: elevation variance, water proximity, tree cover
 * and coastline raise it. Industry and traffic subtract at run time, which is
 * why the base is stored separately from the live value.
 */
function computeBaseAmenity(t: Terrain): void {
  const size = t.size;
  const n = size * size;
  const CAP = 24;
  const dist = new Int32Array(n).fill(CAP);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (t.height[i] <= SEA_LEVEL || (t.flags[i] & TileFlag.River) !== 0) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i];
    if (d >= CAP) continue;
    const x = i % size;
    const y = (i / size) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (dist[j] <= d + 1) continue;
      dist[j] = d + 1;
      queue[tail++] = j;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (t.height[i] <= SEA_LEVEL) {
        t.amenityBase[i] = 60;
        continue;
      }
      let a = 34;
      a += Math.max(0, 22 - dist[i] * 2);
      a += Math.min(20, slopeAt(t, x, y));
      const b = t.biome[i];
      if (b === Biome.Forest) a += 16;
      else if (b === Biome.Beach) a += 20;
      else if (b === Biome.Moor) a += 10;
      else if (b === Biome.Snow) a += 12;
      else if (b === Biome.Marsh) a -= 8;
      if ((t.flags[i] & TileFlag.Coast) !== 0) a += 10;
      t.amenityBase[i] = Math.max(0, Math.min(100, a));
    }
  }
}

// ------------------------------------------------------------------ towns

const TOWN_PREFIX = [
  'Ald', 'Bram', 'Cald', 'Dun', 'East', 'Fen', 'Gart', 'Hal', 'Kir', 'Lang',
  'Mar', 'Nether', 'Ox', 'Pen', 'Quarr', 'Rid', 'Stan', 'Thorn', 'Up', 'Wea',
  'Bar', 'Chart', 'Dray', 'Elm', 'Grim', 'Hem', 'Ing', 'Kel', 'Lyn', 'Mos',
];
const TOWN_SUFFIX = [
  'bridge', 'burn', 'by', 'caster', 'combe', 'dale', 'ford', 'gate', 'ham',
  'haven', 'hithe', 'holm', 'ley', 'mouth', 'pool', 'port', 'ridge', 'stead',
  'stoke', 'thorpe', 'ton', 'wick', 'worth', 'field', 'moor', 'well',
];

/** Mark `TileFlag.Mainland` on the largest connected run of land. */
function markMainland(t: Terrain): void {
  const size = t.size;
  const n = size * size;
  const label = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  let best = -1;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || t.height[start] <= SEA_LEVEL) continue;
    const id = next++;
    let count = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      count++;
      const x = i % size;
      const y = (i / size) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR4X[d];
        const ny = y + DIR4Y[d];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        if (label[j] !== -1 || t.height[j] <= SEA_LEVEL) continue;
        label[j] = id;
        stack.push(j);
      }
    }
    if (count > bestSize) { bestSize = count; best = id; }
  }
  if (best < 0) return;
  for (let i = 0; i < n; i++) if (label[i] === best) t.flags[i] |= TileFlag.Mainland;
}

const DIR4X = [1, -1, 0, 0];
const DIR4Y = [0, 0, 1, -1];

function placeTowns(t: Terrain, rng: Rng, count: number): TownSeed[] {
  const size = t.size;
  const out: TownSeed[] = [];
  /*
   * Only on the mainland, and this was a real one.
   *
   * The score below rewards a candidate for the sea around it — up to
   * twenty-four points of `nearCoast`, because a town wants to be on the water.
   * A one-tile island maximises that term. So the generator was actively
   * *seeking out* islets, and it found them: measured across thirty seeds, a
   * third of districts had their largest settlement on an island of one to five
   * tiles, and on the shipping seed one of the three towns sat alone on a single
   * tile in the sea.
   *
   * Everything downstream then failed silently. The road network grows outward
   * from the biggest settlement, so an island seed connects nothing — zero road
   * tiles in the entire district, every site without an access tile, no opening
   * pair, and a game that begins with nothing to do and no error anywhere.
   *
   * Being near the coast is still worth points. Being *surrounded* by it is not
   * a town, it is a rock.
   */

  let landTiles = 0;
  for (let i = 0; i < size * size; i++) if (t.height[i] > SEA_LEVEL) landTiles++;
  // Spacing follows the land area, not the map size. A 512 map that is 40%
  // sea has room for fourteen towns at 52 tiles apart and none at all at the
  // 128 that size/sqrt(count) suggests.
  const minSep = Math.max(14, Math.trunc(Math.sqrt(landTiles / Math.max(1, count)) * 0.62));
  const used = new Set<string>();

  // Score every candidate rather than rejection-sample. A town wants flat, low,
  // buildable ground near water; on a map with this much moor, rejection
  // sampling takes thousands of draws to find one and the result is arbitrary.
  const candidates: { x: number; y: number; score: number }[] = [];
  const stride = Math.max(2, (size / 160) | 0);
  for (let y = 4; y < size - 4; y += stride) {
    for (let x = 4; x < size - 4; x += stride) {
      const i = y * size + x;
      if ((t.flags[i] & TileFlag.Buildable) === 0) continue;
      if ((t.flags[i] & TileFlag.Mainland) === 0) continue;
      const h = t.height[i];
      if (h <= SEA_LEVEL || h > 900) continue;
      let score = 100 - slopeAt(t, x, y) * 3 - (h >> 5);
      let nearWater = 0;
      let nearCoast = 0;
      for (let d = 0; d < 8; d++) {
        for (let r = 1; r <= 4; r++) {
          const nx = x + NEIGH8X[d] * r;
          const ny = y + NEIGH8Y[d] * r;
          if (!t.inBounds(nx, ny)) continue;
          const j = ny * size + nx;
          if ((t.flags[j] & TileFlag.River) !== 0) nearWater++;
          if (t.height[j] <= SEA_LEVEL) nearCoast++;
        }
      }
      score += Math.min(30, nearWater * 4) + Math.min(24, nearCoast * 2);
      let flat = 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + NEIGH8X[d] * 3;
        const ny = y + NEIGH8Y[d] * 3;
        if (t.inBounds(nx, ny) && (t.flags[t.idx(nx, ny)] & TileFlag.Buildable) !== 0) flat++;
      }
      score += flat * 3;
      score += hash3(x, y, t.seed ^ 0x70a) & 15;
      if (score > 40) candidates.push({ x, y, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);

  for (const c of candidates) {
    if (out.length >= count) break;
    let ok = true;
    for (const o of out) {
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      if (dx * dx + dy * dy < minSep * minSep) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    let name = '';
    for (let k = 0; k < 40; k++) {
      const n = rng.pick(TOWN_PREFIX) + rng.pick(TOWN_SUFFIX);
      if (!used.has(n)) {
        name = n;
        used.add(n);
        break;
      }
    }
    if (!name) continue;

    const coastal = (t.flags[t.idx(c.x, c.y)] & TileFlag.Coast) !== 0 || nearSea(t, c.x, c.y, 6);
    const upland = t.height[t.idx(c.x, c.y)] > 300;
    const character = coastal ? 2 : upland ? 3 : out.length % 3 === 0 ? 1 : 0;
    out.push({
      x: c.x,
      y: c.y,
      name,
      character,
      population: 400 + rng.int(1400) + (coastal ? 300 : 0),
    });
  }
  // Largest first, so town 0 is a sensible starting position.
  out.sort((a, b) => b.population - a.population || a.y - b.y || a.x - b.x);
  return out;
}

function nearSea(t: Terrain, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (t.heightAt(x + dx, y + dy) <= SEA_LEVEL) return true;
    }
  }
  return false;
}

// --------------------------------------------------------------- deposits

interface DepositRule {
  kind: Deposit;
  weight: number;
  test: (x: number, y: number) => boolean;
}

function placeDeposits(t: Terrain, rng: Rng): DepositSeed[] {
  const size = t.size;
  const out: DepositSeed[] = [];
  const target = Math.max(24, Math.trunc((size * size) / 12000));

  // Deposits are keyed to the geology the terrain already implies: coal and
  // iron in the midland hills, stone high up, timber in forest, clay and farm
  // on lowland, fish offshore. This is what makes the map's personality show
  // up in the economy and not only in the picture.
  const rules: DepositRule[] = [
    {
      kind: Deposit.Coal,
      weight: 16,
      test: (x, y) => {
        const h = t.height[t.idx(x, y)];
        return h > 240 && h < 1500 && y > size * 0.26 && y < size * 0.74;
      },
    },
    {
      kind: Deposit.IronOre,
      weight: 12,
      test: (x, y) => {
        const h = t.height[t.idx(x, y)];
        return h > 600 && h < 2200;
      },
    },
    { kind: Deposit.Stone, weight: 12, test: (x, y) => t.biome[t.idx(x, y)] === Biome.Rock },
    { kind: Deposit.Timber, weight: 18, test: (x, y) => t.biome[t.idx(x, y)] === Biome.Forest },
    {
      kind: Deposit.Clay,
      weight: 8,
      test: (x, y) => {
        const h = t.height[t.idx(x, y)];
        return h > SEA_LEVEL && h < 200;
      },
    },
    { kind: Deposit.Farm, weight: 20, test: (x, y) => t.biome[t.idx(x, y)] === Biome.Farmland },
    // Beaches are a thin strip and the spacing rule thins them further, so the
    // weight is high relative to how much sand a region needs: without a sand
    // pit somewhere there is no glass anywhere.
    { kind: Deposit.Sand, weight: 14, test: (x, y) => t.biome[t.idx(x, y)] === Biome.Beach },
    {
      kind: Deposit.Bauxite,
      weight: 5,
      test: (x, y) => {
        const h = t.height[t.idx(x, y)];
        return h > 700 && h < 2000 && y < size * 0.45;
      },
    },
    {
      kind: Deposit.Oil,
      weight: 4,
      test: (x, y) => {
        const h = t.height[t.idx(x, y)];
        return h <= SEA_LEVEL && h > -90;
      },
    },
    {
      kind: Deposit.Fish,
      weight: 8,
      test: (x, y) => {
        const h = t.height[t.idx(x, y)];
        return h <= SEA_LEVEL && h > -140;
      },
    },
    {
      kind: Deposit.Lithium,
      weight: 3,
      test: (x, y) => t.biome[t.idx(x, y)] === Biome.Moor && t.height[t.idx(x, y)] > 1100,
    },
  ];

  /*
   * Sample from the tiles that qualify, not from the whole map.
   *
   * This was rejection sampling: pick a rule by weight, pick a tile at random,
   * and try again if the tile does not suit. That works for coal, which can be
   * almost anywhere, and fails completely for anything whose ground is rare. A
   * sand pit wants a beach and a lithium works wants high moor, and both are a
   * thin fraction of the region, so a random tile essentially never landed on
   * one: across four seeds the generator placed forty-four coal deposits, zero
   * sand and zero lithium. Two industries in the content could therefore never
   * exist in any region, and the two cargoes they make could never move.
   *
   * Building the candidate list first costs one sweep of the map at worldgen
   * and makes every rule that has anywhere to go actually go there.
   */
  const candidates: number[][] = rules.map(() => []);
  for (let y = 3; y < size - 4; y++) {
    for (let x = 3; x < size - 4; x++) {
      for (let r = 0; r < rules.length; r++) {
        if (rules[r].test(x, y)) candidates[r].push(y * size + x);
      }
    }
  }

  // A rule with nowhere to go cannot take its share of the region, so its
  // weight goes back into the pool rather than producing empty draws.
  let totalWeight = 0;
  for (let r = 0; r < rules.length; r++) if (candidates[r].length > 0) totalWeight += rules[r].weight;
  if (totalWeight === 0) return out;

  let guard = 0;
  while (out.length < target && guard < target * 60) {
    guard++;
    let w = rng.int(totalWeight);
    let pick = -1;
    for (let r = 0; r < rules.length; r++) {
      if (candidates[r].length === 0) continue;
      if (w < rules[r].weight) { pick = r; break; }
      w -= rules[r].weight;
    }
    if (pick < 0) continue;
    const list = candidates[pick];
    const tile = list[rng.int(list.length)];
    const x = tile % size;
    const y = (tile / size) | 0;
    let tooClose = false;
    for (const o of out) {
      const dx = o.x - x;
      const dy = o.y - y;
      if (dx * dx + dy * dy < 16 * 16) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    out.push({ x, y, kind: rules[pick].kind, richness: 40 + rng.int(61) });
    t.deposit[t.idx(x, y)] = rules[pick].kind;
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}
