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
  const PEAK = 4200; // half-metre units, so a top ridge is around 1000 m
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const f = landField(x, y, size, cfg.seed);
      const i = y * size + x;
      t.height[i] = f <= 0 ? -6 : Math.min(32000, Math.trunc((f * PEAK) / FX_ONE));
    }
  }
  deepenOffshore(t);

  // ---- 2. rivers ---------------------------------------------------------
  carveRivers(t, rng, Math.max(5, Math.round(size / 128) * 4));

  // ---- 3. biomes and buildability ---------------------------------------
  classify(t, cfg.seed);

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
    for (let k = 0; k < 40; k++) {
      const x = rng.range(4, size - 5);
      const y = rng.range(4, (size >> 1) - 5);
      const h = t.height[y * size + x];
      if (h > best) {
        best = h;
        sx = x;
        sy = y;
      }
    }
    if (best < 900) continue;

    let x = sx;
    let y = sy;
    const visited = new Set<number>();
    for (let step = 0; step < size * 3; step++) {
      const i = y * size + x;
      if (visited.has(i)) break;
      visited.add(i);
      if (t.height[i] <= SEA_LEVEL) break;

      // Widen as it descends: a stream on the moor, an estuary at the coast.
      const width = Math.min(2, Math.trunc(step / Math.max(1, size >> 2)));
      carveAt(t, x, y, width);

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
      x = bx;
      y = by;
    }
  }
}

function carveAt(t: Terrain, x: number, y: number, width: number): void {
  const size = t.size;
  const bed = Math.max(SEA_LEVEL + 1, t.height[y * size + x] - 4);
  for (let dy = -width; dy <= width; dy++) {
    for (let dx = -width; dx <= width; dx++) {
      if (dx * dx + dy * dy > width * width + 1) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (t.height[j] > SEA_LEVEL) t.height[j] = Math.min(t.height[j], bed);
      t.flags[j] |= TileFlag.River;
    }
  }
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
        t.flags[i] |= TileFlag.Buildable;
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

function placeTowns(t: Terrain, rng: Rng, count: number): TownSeed[] {
  const size = t.size;
  const out: TownSeed[] = [];
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
    { kind: Deposit.Sand, weight: 6, test: (x, y) => t.biome[t.idx(x, y)] === Biome.Beach },
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

  const totalWeight = rules.reduce((a, r) => a + r.weight, 0);
  let guard = 0;
  while (out.length < target && guard < target * 500) {
    guard++;
    let w = rng.int(totalWeight);
    let rule = rules[0];
    for (const r of rules) {
      if (w < r.weight) {
        rule = r;
        break;
      }
      w -= r.weight;
    }
    const x = rng.range(3, size - 4);
    const y = rng.range(3, size - 4);
    if (!rule.test(x, y)) continue;
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
    out.push({ x, y, kind: rule.kind, richness: 40 + rng.int(61) });
    t.deposit[t.idx(x, y)] = rule.kind;
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}
