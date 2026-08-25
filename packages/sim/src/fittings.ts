/**
 * Fittings, and the winter that makes one of them matter.
 *
 * design.md §5. A vehicle is bought once and then *fitted*, and fittings are
 * the only customisation in the game. There is exactly one at the start:
 * winter tyres.
 *
 * The rule is that a vehicle without winter tyres **stops** once the snow is
 * down. Not "goes slower" — stops, and says why. That is deliberately the same
 * shape as the yard rule, which is the best rule in the design:
 *
 *   The refusal is one sentence and obviously true.
 *   It is fixed by a purchase, not by research.
 *   **You can see it.** The world turns white and the lorry that stopped is
 *   standing still in the snow with a badge over it.
 *
 * The last one is why this is worth having and a fuel gauge is not. A modifier
 * on a spreadsheet is a tax. A lorry stopped in the snow is a *story*, and it
 * is the only reason the calendar has a job at all — without a season a year
 * is a number going up.
 *
 * One purchase per vehicle, permanent. There is no seasonal swapping chore:
 * fit them once and the lorry uses the right rubber at the right time on its
 * own. The interesting decision is *which* of your vehicles get them and when,
 * not clicking twice a year.
 */

import { DAYS_PER_YEAR } from './constants.ts';

/**
 * What a vehicle can have fitted. A bitmask, matching `Facility` in yards.ts —
 * the two are asked the same kind of question and answer it in one
 * instruction.
 */
export const Fitting = {
  /** Runs in snow. Without it the vehicle stops for the winter. */
  WinterTyres: 1 << 0,
} as const;
export type Fitting = (typeof Fitting)[keyof typeof Fitting];

export const FITTING_NAMES: [number, string][] = [
  [Fitting.WinterTyres, 'Winter tyres'],
];

/** What each one costs, in pence.
 *
 * £2,400 against a £18,000 lorry: about an eighth, which is the right weight.
 * Cheap enough that fitting the whole fleet is affordable by the second winter
 * and expensive enough that in the first one you have to choose. */
export const FITTING_COST: Record<number, number> = {
  [Fitting.WinterTyres]: 240_000,
};

/**
 * How deep the snow is, 0..1, from the day of the year.
 *
 * A cosine of the year with a smooth threshold on it, so it is continuous and
 * exactly periodic — the same discipline the sun's day needs and for the same
 * reason. A season that snaps on the first of December would make the whole
 * district change between one frame and the next.
 *
 * The thresholds were set by sampling the year rather than by taste. The first
 * pair gave Dec, Jan *and* Feb all above 0.84 — a quarter of every year deep
 * enough to stop an unfitted lorry, which is not a season, it is a climate.
 * These put full cover from 20 December to 11 January, snow on the ground from
 * late November to early February, and lorries stopping for about seven weeks
 * of it. Long enough to plan for, short enough not to be the game.
 */
export function snowCover(day: number): number {
  const f = ((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR / DAYS_PER_YEAR;
  // 1 on 1 January, -1 in July.
  const w = Math.cos(f * Math.PI * 2);
  const t = Math.max(0, Math.min(1, (w - 0.80) / (0.985 - 0.80)));
  return t * t * (3 - 2 * t);
}

/**
 * How much snow stops a lorry that is not fitted for it.
 *
 * Below this the roads are passable — a dusting is not a blockage, and a rule
 * that fired on the first white pixel would be unreadable, because the player
 * would have no way of telling "some snow" from "too much snow". At 0.5 the
 * district is unmistakably under snow by the time anything refuses to move.
 */
export const SNOW_STOPS = 0.5;

/** Is this vehicle stopped by the weather? The whole rule, in one line. */
export function stoppedBySnow(fittings: number, snow: number): boolean {
  return snow >= SNOW_STOPS && (fittings & Fitting.WinterTyres) === 0;
}
