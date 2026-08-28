/**
 * Approval: what the parish thinks of you, place by place.
 *
 * This replaces a planning board that was the last rung of the ladder and the
 * weakest one. Approval used to be a currency: serve the district, watch a number
 * rise, spend it on a road widening or on the board agreeing you belong. The
 * objection to it was exact — "I don't like that it only allows you to influence,
 * not do" — and it is right. A mechanic whose only output is permission to ask for
 * a favour is a mechanic about paperwork.
 *
 * So it is turned inside out. Approval is not spent and not bought. It is a
 * **consequence of what you build** and a **gate on what you may build next**, and
 * it is *local*.
 *
 * ## Three rules
 *
 * **Every building you put up changes what people think of you, within a radius.**
 * A village shop is welcome. A distribution centre is not: lorries at six in the
 * morning, and the fact that it pollutes almost nothing is beside the point.
 * Nothing says industrialising is bad — you read it off what you are then allowed
 * to do.
 *
 * **The gate is checked where you are standing, not on a district total.** To put
 * an abattoir *here*, the parish *here* has to think well enough of you. Which
 * makes the interesting move the one the old design could not express: improve a
 * neighbourhood, then earn the right to industrialise it. A green and a shop on
 * the edge of Marchford are what buys you the depot behind them.
 *
 * **Doing the job is the baseline.** Deliveries into the parish and keeping the
 * shelves of a place you own stocked lift the whole district's regard for you,
 * slowly, and the drift pulls it back toward indifference. That part is unchanged
 * and it is what stops this becoming a game purely about placing ornaments: a
 * haulier with a good record has room to do one unpopular thing.
 *
 * ## Why the impact is its own number rather than the amenity penalty
 *
 * Because pollution and unpopularity are different things and the district's two
 * best examples disagree. A quarry is the worst amenity penalty in the game — 34
 * over a wide radius — and it is out in the hills where nobody lives. A
 * distribution centre has an amenity penalty of 2 and would be the most resented
 * building in the parish. Reusing one number for both would make the quarry the
 * hard one to place and the depot free, which is backwards.
 */

import { NONE } from './network.ts';

/**
 * Tiles per cell, matching the amenity field.
 *
 * Approval is not a per-tile quantity in any meaningful sense: the difference of
 * opinion between one tile and the tile beside it is nil, and storing it per tile
 * would be sixteen thousand floats to hold a few dozen overlapping circles.
 */
export const APPROVAL_CELL = 4;

/**
 * Where opinion sits when nothing has happened.
 *
 * Thirty rather than zero, because a haulier nobody has heard of is not hated.
 * It is also the figure the build thresholds are set against: at rest you may put
 * up a shop, a farm or a filling station, and not a creamery.
 */
export const APPROVAL_REST = 30;

/**
 * How fast regard drifts back toward indifference, per day.
 *
 * Without it the earned part is a ratchet — every delivery you ever made counts
 * for ever — and by the second year it is pinned at a hundred and has stopped
 * being a constraint at all. Drifting means standing still costs you, slowly.
 *
 * Note what it does *not* touch: the local part. A depot you built is still there
 * and people can still see it, so its impact does not fade while it stands. What
 * fades is your record, which is fair — being useful last spring is worth less
 * than being useful now.
 */
export const APPROVAL_DRIFT_PER_DAY = 0.16;

/** What one load delivered into the parish is worth. Small: this is meant to
 *  accumulate over months of running, not over an afternoon. */
export const APPROVAL_PER_LOAD = 0.055;

/**
 * And what a day of keeping the village supplied is worth, per place you own that
 * serves it, scaled by how full its shelves are.
 *
 * Read against the drift, which is 0.16 a day: a well-stocked shop nets a little
 * under half a point a week. Set much lower and the drift eats it; much higher and
 * the shop *is* the mechanic.
 */
export const PARISH_PER_DAY = 0.3;

/**
 * Local approval at or above this in a town and the parish counts you as one of
 * their own, which widens your reach.
 *
 * This is what became of "ask to be counted", which used to be a button costing
 * nine thousand pounds and twenty-two points of approval. Buying it was the purest
 * form of the thing being complained about, so now it is not bought at all: it
 * happens, in a town, because of what you did there. Sixty is comfortably above
 * the resting thirty and below the hardest build threshold, so it lands while you
 * are working on a neighbourhood rather than after you have finished with it.
 */
export const COUNTED_AT = 60;

/**
 * What the parish wants of you before it will let you make a lane up to a road.
 *
 * Checked *locally*, at the place the lane serves, like every other threshold now.
 * Thirty-five against a resting thirty: a haulier who has been running a while, or
 * who has put something the village wanted near it, and not one who turned up on
 * Tuesday.
 *
 * No impact of its own on the way back. A made-up road brings traffic and the
 * amenity field already models that, weighted by how busy the road actually gets —
 * charging approval for it as well would be counting the same lorries twice.
 */
export const WIDEN_APPROVAL = 35;

/** One reason approval where you are standing is what it is. */
export interface ApprovalSource {
  x: number;
  y: number;
  /** Signed: positive is welcome, negative is resented. */
  impact: number;
  /** In tiles. */
  radius: number;
  /** Which site it is, so the interface can say what it is looking at. */
  site: number;
}

/**
 * The local part of approval, on a coarse grid.
 *
 * Only the local part. The earned, district-wide part is a scalar on the world and
 * is added when the field is read — keeping them apart is what lets the drift
 * apply to one and not the other, and it means this whole structure is derived
 * from the sites table and never has to be kept in step with it.
 */
export class ApprovalField {
  readonly cols: number;
  readonly rows: number;
  /** Signed sum of nearby impacts, in approval points. */
  readonly local: Float32Array;
  /** Bumped on every rebuild, so a renderer or a panel can cache against it. */
  version = 0;

  constructor(size: number) {
    this.cols = Math.ceil(size / APPROVAL_CELL);
    this.rows = Math.ceil(size / APPROVAL_CELL);
    this.local = new Float32Array(this.cols * this.rows);
  }

  cellOf(x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.cols - 1, (x / APPROVAL_CELL) | 0));
    const cy = Math.max(0, Math.min(this.rows - 1, (y / APPROVAL_CELL) | 0));
    return cy * this.cols + cx;
  }

  at(x: number, y: number): number {
    return this.local[this.cellOf(x, y)] ?? 0;
  }

  /**
   * The middle of a cell, in tiles.
   *
   * Everything measures distance from here rather than from cell indices, which is
   * what makes the field and the list of reasons behind the dial agree. They did
   * not: the field summed `impact * (1 - cellDistance / radiusInCells)` over
   * integer cell offsets while the reasons used the exact tile distance, so a green
   * four tiles from a spot contributed 4.0 to the number on screen and 3.1 to the
   * explanation of it. Small, and the sort of thing a player notices precisely
   * because both figures are on the same panel.
   */
  static centreOf(cell: number, cols: number): { x: number; y: number } {
    const cx = cell % cols;
    const cy = (cell / cols) | 0;
    return { x: cx * APPROVAL_CELL + APPROVAL_CELL / 2, y: cy * APPROVAL_CELL + APPROVAL_CELL / 2 };
  }

  /**
   * Recompute from the buildings that are causing it.
   *
   * Summed rather than taken as a maximum, which is the opposite of how influence
   * combines and deliberately so. Influence is about presence and being present
   * twice in one village does not put you in the next one; resentment *does*
   * accumulate — two depots either side of a village are worse than one, and a
   * green next to a depot genuinely takes the edge off it. Sums also make the
   * mechanic legible: the panel can list the reasons and they add up to the
   * figure shown.
   */
  rebuild(sources: readonly ApprovalSource[]): void {
    this.local.fill(0);
    for (const s of sources) {
      if (s.impact === 0) continue;
      const radius = Math.max(1, s.radius);
      /*
       * Walked in cells, measured in tiles.
       *
       * The radius in the content is in tiles and stays in tiles — the amenity
       * field next door compares a *cell* distance against a radius given in
       * tiles, so every amenity radius there is quietly four times what it reads
       * as. That is long-standing and the amenity balance depends on it, so it is
       * left alone; this field is honest about its units and the two numbers are
       * not interchangeable.
       */
      const reach = Math.ceil(radius / APPROVAL_CELL);
      const cx = Math.max(0, Math.min(this.cols - 1, (s.x / APPROVAL_CELL) | 0));
      const cy = Math.max(0, Math.min(this.rows - 1, (s.y / APPROVAL_CELL) | 0));
      for (let dy = -reach; dy <= reach; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= this.rows) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= this.cols) continue;
          const cell = y * this.cols + x;
          const c = ApprovalField.centreOf(cell, this.cols);
          const d = Math.sqrt(Math.pow(c.x - s.x, 2) + Math.pow(c.y - s.y, 2));
          if (d > radius) continue;
          /*
           * Linear, for the same reason the amenity field is linear: a quadratic
           * falloff makes the boundary invisible and the player cannot tell where
           * the depot stops mattering. They have to be able to see the edge to
           * plan against it.
           */
          this.local[cell] += s.impact * (1 - d / radius);
        }
      }
    }
    this.version++;
  }
}

/** One line of the answer to "why is it this?", for the panel behind the dial. */
export interface ApprovalReason {
  /** What to call it. */
  label: string;
  /** Its contribution in points, signed. */
  points: number;
  /** The site responsible, or NONE for the earned baseline and the drift. */
  site: number;
}

/**
 * The reasons approval at a point is what it is, worst first.
 *
 * Worst first because the panel exists to answer "why can't I build here", and
 * the answer to that is always the largest negative. A list sorted by magnitude
 * would put a +16 park at the top of the screen when the player is looking for
 * the depot that is costing them 22.
 */
export function reasonsAt(
  x: number, y: number, earned: number, sources: readonly ApprovalSource[],
  nameOf: (site: number) => string, cols: number,
): ApprovalReason[] {
  const out: ApprovalReason[] = [
    { label: 'Your record in the parish', points: earned, site: NONE },
  ];
  /*
   * From the middle of the cell the point falls in, not from the point.
   *
   * Which is what makes these numbers add up to the one on the dial: the field is
   * stored per cell, so the figure a player is being shown *is* a cell's figure,
   * and explaining it from anywhere else produces a list that does not sum to it.
   */
  const cell = Math.max(0, Math.min(cols - 1, (x / APPROVAL_CELL) | 0))
    + cols * Math.max(0, (y / APPROVAL_CELL) | 0);
  const c = ApprovalField.centreOf(cell, cols);
  for (const s of sources) {
    if (s.impact === 0) continue;
    const radius = Math.max(1, s.radius);
    const d = Math.sqrt(Math.pow(c.x - s.x, 2) + Math.pow(c.y - s.y, 2));
    if (d > radius) continue;
    const points = s.impact * (1 - d / radius);
    if (Math.abs(points) < 0.05) continue;
    out.push({ label: nameOf(s.site), points, site: s.site });
  }
  out.sort((a, b) => a.points - b.points);
  return out;
}
