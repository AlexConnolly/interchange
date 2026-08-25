/**
 * What kind of place a town becomes. features.md §8, two rows of it:
 *
 *   Town character: industrial, market, resort, dormitory
 *   Zoning influence rather than direct control
 *
 * They are one mechanism seen from either end. The first is what a town *is*;
 * the second is how it gets that way, and the note against it is the design in
 * a line — *you are not a city builder; you shape conditions.*
 *
 * So there is no zoning tool and no zoning command. A town's character drifts
 * toward whatever its circumstances say it should be, and its circumstances are
 * very largely things a transport company decided. Put a colliery beside it and
 * keep the coal moving and it turns industrial. Serve it from three directions
 * and it becomes a market town. Leave the amenity high and bring visitors and
 * it turns to tourism. Give it a fast service to somewhere else and it becomes
 * a dormitory, because people will live where the train goes — which is a real
 * thing that happens to a town when somebody builds a railway to it.
 *
 * Every input is something the player can see and did, and the drift is slow,
 * because a town does not change its nature in a season.
 *
 * The character list itself is worldgen's, from sites.ts, and port is in it.
 * Port is geography rather than circumstance: you cannot shape a landlocked
 * town into a harbour however you serve it, so it is the one character that is
 * only ever available to a coastal town.
 */

import type { TownTable } from './sites.ts';

export const Character = {
  Market: 0, Industrial: 1, Port: 2, Resort: 3, Dormitory: 4,
} as const;
export type Character = (typeof Character)[keyof typeof Character];

/** Years of consistent circumstances before a town changes its nature. */
export const DRIFT_YEARS = 12;

/** How clear the case has to be before the clock even starts. A hair's-breadth
 *  win should not begin a transformation, or a town on the margin flickers
 *  between two natures for a century. */
export const DRIFT_MARGIN = 12;

export interface CharacterContext {
  /** Industry on the doorstep, weighted by how much of it there is. */
  industryNearby: (town: number) => number;
  /** How many separate companies bring freight here. */
  carriers: (town: number) => number;
  /** What the surroundings are like, 0..100. amenity.ts. */
  amenity: (town: number) => number;
  /** How good the passenger service is, 0..100. transit.ts. */
  transit: (town: number) => number;
  /** Whether the town is on the coast, which is not negotiable. */
  coastal: (town: number) => boolean;
  /** Fraction of a year this pass covers. */
  yearFraction: number;
}

/**
 * Score every character for a town and drift toward the strongest.
 *
 * Scores rather than rules, so a town is never purely one thing, and a slow
 * accumulator rather than a switch, so becoming something takes a decade of
 * being clearly it.
 */
export function stepCharacter(towns: TownTable, ctx: CharacterContext): void {
  const scores = [0, 0, 0, 0, 0];
  for (let t = 0; t < towns.count; t++) {
    const industry = ctx.industryNearby(t);
    const carriers = ctx.carriers(t);
    const amenity = ctx.amenity(t);
    const transit = ctx.transit(t);

    // Market: served from several directions by several people, and pleasant
    // enough that they come to it.
    scores[Character.Market] = carriers * 26 + amenity * 0.25;
    // Industrial: works on the doorstep, and the traffic to feed them.
    scores[Character.Industrial] = industry * 22 + carriers * 4;
    // Port: geography first, then trade.
    scores[Character.Port] = ctx.coastal(t) ? 30 + carriers * 20 + industry * 6 : -1e9;
    // Resort: amenity above all, and fragile — a works nearby ruins it, which
    // is design.md 2.3's central tension arriving in the town model.
    scores[Character.Resort] = amenity * 1.1 - industry * 26;
    // Dormitory: you can get out of it easily, and there is no work in it.
    scores[Character.Dormitory] = transit * 0.9 - industry * 14;

    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;

    const current = towns.character[t];
    if (best === current || scores[best] - scores[current] < DRIFT_MARGIN) {
      // Either it is already what it should be, or the case is too fine to
      // act on. Both let the clock run down rather than resetting it, so one
      // bad year does not undo a decade of becoming something.
      towns.characterDrift[t] = Math.max(0, towns.characterDrift[t] - 1);
      continue;
    }
    /*
     * The accumulator belongs to a *destination*, not to the fact of being
     * unsettled. Without this, a town that spent ten years turning into a
     * resort and then had a works open beside it would arrive as an industrial
     * town within the year — inheriting a decade of argument for something
     * else entirely. Changing target starts the clock again, which is both
     * right and what it feels like: a place interrupted halfway through
     * becoming one thing does not instantly become another.
     */
    if (towns.characterToward[t] !== best) {
      towns.characterToward[t] = best;
      towns.characterDrift[t] = 0;
    }
    towns.characterDrift[t] = Math.min(
      0x7fff, towns.characterDrift[t] + Math.round(ctx.yearFraction * 100),
    );
    if (towns.characterDrift[t] >= DRIFT_YEARS * 100) {
      towns.character[t] = best;
      towns.characterDrift[t] = 0;
    }
  }
}

/**
 * What a character does to a town's appetite for one cargo.
 *
 * Multipliers rather than replacements, so every town still wants the whole
 * basket and a resort still burns coal — it simply wants rather more of what
 * makes it a resort and rather less of the rest. A character that rewrote the
 * basket outright would make a town's nature a switch rather than a flavour,
 * and would strand any route that happened to survive the change.
 */
export function characterAppetite(character: number, cargoId: string): number {
  switch (character) {
    case Character.Industrial:
      if (cargoId === 'coal' || cargoId === 'oil') return 1.5;
      if (cargoId === 'goods' || cargoId === 'cement' || cargoId === 'steel') return 1.25;
      if (cargoId === 'tourists') return 0.4;
      return 1;
    case Character.Market:
      if (cargoId === 'food' || cargoId === 'goods' || cargoId === 'grain') return 1.4;
      if (cargoId === 'textiles' || cargoId === 'timber') return 1.2;
      return 1;
    case Character.Port:
      // A port's appetite is other people's cargo passing through it, which the
      // network already models. What it wants for itself is fuel and food.
      if (cargoId === 'coal' || cargoId === 'oil') return 1.3;
      if (cargoId === 'food') return 1.15;
      return 1;
    case Character.Resort:
      if (cargoId === 'tourists') return 2.2;
      if (cargoId === 'food') return 1.5;
      if (cargoId === 'coal') return 0.6;
      return 1;
    case Character.Dormitory:
      // People sleep here and shop where they work, so what follows a household
      // stays and what follows a high street goes.
      if (cargoId === 'passengers') return 1.6;
      if (cargoId === 'food' || cargoId === 'mail') return 1.2;
      if (cargoId === 'goods') return 0.7;
      return 1;
    default:
      return 1;
  }
}
