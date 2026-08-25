/**
 * Amenity: the central tension, and the one that emerges rather than being
 * scripted. design.md §2.3.
 *
 * Every tile has a base amenity from the terrain — elevation variance, water,
 * trees, coastline — and that part is generated once and never changes. What
 * changes is what gets built on it. An industry emits a penalty field with a
 * radius and a falloff; a road emits noise weighted by how much traffic it
 * actually carries. Subtract those from the base and you have what the place
 * is like to be in.
 *
 * The reason this matters is one sentence in the design document: open a
 * bauxite pit above a lake valley and the resort down the shore starts losing
 * money, and *you own both*. Nothing anywhere says "industrialising is bad".
 * The player works it out from their own accounts, which is the only way a
 * game ever says anything.
 *
 * Two implementation notes that are really design notes.
 *
 * The field is computed on a coarse grid. A region is a hundred and fifty
 * thousand tiles and the penalty from one colliery touches a few hundred of
 * them; recomputing all of it every day would be the most expensive thing in
 * the simulation, to produce a number that moves by one point a decade. Cells
 * of four tiles are finer than any decision made against them.
 *
 * And it decays back. An industry that closes stops emitting immediately, but
 * the ground it stood on does not recover immediately, and remediation in the
 * later eras is the player paying to make it recover faster. That asymmetry —
 * quick to spoil, slow to mend — is the whole moral shape of the thing, and
 * it is also just true.
 */

import { NONE } from './network.ts';
import type { SiteTable } from './sites.ts';
import type { Terrain } from './terrain.ts';

/** Tiles per amenity cell. Four is finer than any decision made against it. */
export const CELL = 4;

/** How fast spoiled ground drifts back toward its potential when whatever was
 *  spoiling it has gone. Points per year, so a wrecked valley takes decades. */
export const RECOVERY_PER_YEAR = 1.5;

/** And how fast remediation moves it, for the money. Roughly twelve times
 *  nature, which is expensive enough to be a decision and fast enough to be
 *  worth making inside one player's game. */
export const REMEDIATION_PER_YEAR = 18;

/** Noise a busy way emits, at its worst. Traffic-weighted below. */
const NOISE_MAX = 22;

export class AmenityField {
  readonly cols: number;
  readonly rows: number;
  /** What the terrain alone would give, averaged over the cell. */
  readonly potential: Uint8Array;
  /** What it is actually like now. */
  readonly current: Uint8Array;
  /** Remediation credit bought by the player, spent down as it applies. */
  readonly restored: Float32Array;
  /** Scratch for the penalty accumulation, so a pass allocates nothing. Not
   *  private only because the pass below is a free function, which is how the
   *  rest of this codebase separates state from the rules over it. */
  readonly penalty: Float32Array;

  constructor(size: number) {
    this.cols = Math.ceil(size / CELL);
    this.rows = Math.ceil(size / CELL);
    const n = this.cols * this.rows;
    this.potential = new Uint8Array(n);
    this.current = new Uint8Array(n);
    this.restored = new Float32Array(n);
    this.penalty = new Float32Array(n);
  }

  cellOf(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, (x / CELL) | 0);
    const cy = Math.min(this.rows - 1, (y / CELL) | 0);
    return cy * this.cols + cx;
  }

  /** Average the generated base into cells. Once, at worldgen. */
  seed(terrain: Terrain): void {
    const size = terrain.size;
    const sum = new Float64Array(this.potential.length);
    const count = new Float64Array(this.potential.length);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = this.cellOf(x, y);
        sum[c] += terrain.amenityBase[y * size + x];
        count[c]++;
      }
    }
    for (let i = 0; i < this.potential.length; i++) {
      const v = count[i] > 0 ? Math.round(sum[i] / count[i]) : 0;
      this.potential[i] = v;
      this.current[i] = v;
    }
  }

  /** What it is like at a tile, 0..100. */
  at(x: number, y: number): number {
    return this.current[this.cellOf(x, y)];
  }
}

export interface AmenityContext {
  size: number;
  /** Penalty and radius per industry definition. */
  penaltyOf: (def: number) => number;
  radiusOf: (def: number) => number;
  /** How busy the way on a tile is, 0..1, or -1 for no way. Noise is weighted
   *  by traffic because an empty motorway is quieter than a busy lane, and a
   *  model that ignores that makes building roads nobody uses a free way to
   *  ruin a valley. */
  trafficAt: (tile: number) => number;
  /** Fraction of a year this pass covers, for the drift rates. */
  yearFraction: number;
}

/**
 * Recompute the field.
 *
 * Called rarely — monthly is plenty, given the fastest thing here moves
 * eighteen points a year. The whole pass is one sweep over the sites and one
 * over the cells, so its cost is in the number of industries rather than in
 * the size of the region.
 */
export function stepAmenity(
  field: AmenityField, sites: SiteTable, ctx: AmenityContext,
): void {
  const penalty = field.penalty;
  penalty.fill(0);

  // ---- what is spoiling it ---------------------------------------------
  for (let s = 0; s < sites.count; s++) {
    if (sites.nodeOf(s, 0) === NONE && sites.x[s] === 0 && sites.y[s] === 0) continue;
    const def = sites.def[s];
    const emit = ctx.penaltyOf(def);
    if (emit <= 0) continue;
    const radius = Math.max(1, ctx.radiusOf(def));
    const cx = field.cellOf(sites.x[s], sites.y[s]);
    const cxx = cx % field.cols;
    const cyy = (cx / field.cols) | 0;
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      const y = cyy + dy;
      if (y < 0 || y >= field.rows) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = cxx + dx;
        if (x < 0 || x >= field.cols) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > radius) continue;
        // Linear falloff. A quadratic one makes the boundary invisible and
        // the player cannot tell where the pit stops mattering.
        penalty[y * field.cols + x] += emit * (1 - d / radius);
      }
    }
  }

  // ---- and the traffic --------------------------------------------------
  const size = ctx.size;
  for (let cy = 0; cy < field.rows; cy++) {
    for (let cx = 0; cx < field.cols; cx++) {
      let worst = 0;
      for (let y = cy * CELL; y < Math.min(size, (cy + 1) * CELL); y++) {
        for (let x = cx * CELL; x < Math.min(size, (cx + 1) * CELL); x++) {
          const t = ctx.trafficAt(y * size + x);
          if (t > worst) worst = t;
        }
      }
      if (worst > 0) penalty[cy * field.cols + cx] += NOISE_MAX * worst;
    }
  }

  // ---- drift toward what it deserves ------------------------------------
  const recover = RECOVERY_PER_YEAR * ctx.yearFraction;
  for (let i = 0; i < field.current.length; i++) {
    const target = Math.max(0, field.potential[i] - penalty[i]);
    const now = field.current[i];
    if (now > target) {
      // Spoiling is immediate. A pit does not ease itself into the valley.
      field.current[i] = Math.round(target);
      continue;
    }
    let gain = recover;
    if (field.restored[i] > 0) {
      const extra = Math.min(field.restored[i], REMEDIATION_PER_YEAR * ctx.yearFraction);
      field.restored[i] -= extra;
      gain += extra;
    }
    field.current[i] = Math.round(Math.min(target, now + gain));
  }
}

/**
 * How well a tourism business does here, as a multiplier on its output.
 *
 * A resort in a spoiled valley is a resort nobody goes to. The curve is steep
 * on purpose: the design says a pit above a lake makes the resort down the
 * shore lose money, and it can only do that if the difference between amenity
 * seventy and amenity forty is most of the business rather than a rounding.
 */
export function tourismYield(amenity: number): number {
  if (amenity <= 20) return 0;
  const t = (amenity - 20) / 80;
  return Math.round(t * t * 100) / 100;
}

/** Cost of restoring one cell by one point, in pence. Expensive: design.md
 *  calls remediation "expensive and slow", and the redemption arc is only
 *  worth anything if it cost something. */
export const REMEDIATION_PRICE = 26000;

/** The era anybody thinks to restore land. design.md's era table puts
 *  remediation in the Transition era, with the electric fleets. */
export const REMEDIATION_FROM_ERA = 7;
