/**
 * What counts as water. One answer, for everything that has to know.
 *
 * This file exists because two systems disagreed about it and the disagreement was
 * invisible in the source. The renderer decides whether to *draw* water; the farm
 * machinery decides whether to *drive* on it; and those have to be the same
 * question or you get tractors fording a river that is plainly there on screen.
 *
 * They were not the same question. The renderer asked "river flag, and above sea
 * level" — a channel cut into dry ground, which is what a beck is. The tractors
 * asked "at or below sea level", which is the *coast*. Measured on the opening
 * district: 385 of 387 river tiles sit above sea level, so the tractors' test
 * waved every one of them through. Sixteen of the eighty-seven workable fields
 * have a river across them; the sea-level test was catching six.
 *
 * So both answers come from here now. Not because it is less code — it is barely
 * any less — but because a comment saying "these two agree" is a promise, and one
 * function is a fact.
 */

import { TileFlag } from '@interchange/sim';

/**
 * A river: flagged as one, and standing on ground above sea level.
 *
 * The "above sea level" half is not redundant. A river flag on ground already
 * under the sea is the mouth of it, and drawing a channel across open water is
 * drawing a line on the sea.
 */
export function isStream(flags: number, height: number): boolean {
  return (flags & TileFlag.River) !== 0 && height > 0;
}

/**
 * Water of any kind: the sea, or a river cut through dry land.
 *
 * The question anything that moves should be asking. Nothing here is about
 * *visibility* — that is the fog of war, and conflating the two is how this went
 * wrong the first time: `usable` said yes to a beck because you could see it.
 */
export function isWet(flags: number, height: number): boolean {
  return height <= 0 || isStream(flags, height);
}
