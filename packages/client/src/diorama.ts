/**
 * The little world behind the menu.
 *
 * The title card used to show the district you were about to play, held at
 * altitude with the last of the cloud over it. Handsome, and too big: a hundred
 * and twenty-eight tiles seen from far enough away to fit is a map, and a map read
 * as a loading screen with a picture on it. "Rather than a huge one, could we not
 * just create a cute little slice of it? ... a small square with a yard, road,
 * maybe the pylons."
 *
 * So the menu gets a world of its own — a sixty-four tile block, generated fresh,
 * framed whole. Small enough that a farm is a farm rather than a green speck, and
 * small enough that the cut edge of the ground is in shot, which is what makes it
 * read as a model on a table rather than as a photograph of a map.
 *
 * ## A different seed every time
 *
 * "OR rotate the seed every time... ghenius!" It is, and it costs nothing: a
 * sixty-four tile world generates in about thirty milliseconds, measured, so the
 * menu can afford to make one on every launch and throw it away.
 *
 * It cannot afford to make a *bad* one, though, and some seeds are bad. Measured
 * over thirty seeds at this size, two produced no town, no road and two lone farms
 * — a barren green lump. Seven per cent of launches opening on that is not a risk
 * worth taking for a title card, so the seed is chosen by trying and checking
 * rather than by trusting.
 */

/**
 * Tiles across the menu's world.
 *
 * Sixty-four, and the floor is set by the generator rather than by taste: below
 * about forty-eight it produces no towns and no roads at all — measured at 32, 40
 * and 48 — because the town placer needs room to stand back from the coast. At 48
 * it is patchy, at 56 it is usually there, and at 64 it is reliable. So 64 is the
 * smallest size that reliably contains the things the diorama is *for*.
 */
export const DIORAMA_SIZE = 64;

/**
 * How wide the frame is, in tiles.
 *
 * A shade more than the world, so the cut edge of the block has air round it on
 * every side as it turns. Exactly the world's width would put the corners through
 * the edge of the screen twice a revolution.
 */
export const DIORAMA_ACROSS = 70;

/** How many seeds to try before settling for whatever the last one gave. */
export const DIORAMA_TRIES = 8;

/** The bits of a generated world that decide whether it is worth looking at. */
export interface DioramaFacts {
  towns: number;
  sites: number;
  roadTiles: number;
}

/**
 * Is there enough here to be a diorama?
 *
 * All three, because they fail together and for the same reason: a world whose
 * land came out too broken for a town gets no town, and with no town the road
 * network has nothing to join up, and with no roads the industry placer has
 * nowhere to put anything. Checking one would do; checking three says what the
 * picture actually needs to have in it.
 *
 * The thresholds are the bottom of the *good* range rather than the top of the bad
 * one — measured, a passing seed at this size gives one or two towns, five to
 * twelve sites and thirty-five to a hundred and thirty road tiles, and a failing
 * one gives nought, two and nought. There is no middle to draw a fine line
 * through.
 */
export function goodEnough(f: DioramaFacts): boolean {
  return f.towns >= 1 && f.sites >= 4 && f.roadTiles >= 20;
}

/**
 * A seed, different on every launch and different again on every retry.
 *
 * Off the clock rather than off `Math.random`, so that two launches in the same
 * second still differ — the attempt is mixed in, and the whole thing is hashed so
 * consecutive milliseconds do not give consecutive districts. A district that is
 * *nearly* the last one is worse than a repeat: it looks like the game failed to
 * regenerate.
 */
export function seedFor(now: number, attempt: number): number {
  let h = (now ^ (attempt * 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  // Away from zero, which some generators treat as "no seed given".
  return (h % 1_000_000) + 1;
}
