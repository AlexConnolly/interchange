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

import { DIORAMA_ELEVATION } from '@interchange/render';

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
 * How deep the block is cut, in world units. Mirrors `BASE_DEPTH` in the ground
 * builder, which the framing has to know about because the bottom of the cut is
 * the lowest thing on screen.
 */
export const DIORAMA_BASE = 2.9;

/**
 * The narrowest the frame is allowed to be, in tiles.
 *
 * *Narrower* than the world, which looks wrong and is not: the menu camera sits at
 * 28 degrees rather than the game's 38, so sixty-four tiles of depth project to
 * about thirty on screen, and the limit on the framing is the width rather than
 * the diagonal.
 *
 * Seventy-two is set from the measurement, not from taste. At 70 across and 38
 * degrees the near edge of the block projected to y=1000 in a thousand-pixel
 * window — its cut face was one pixel below the bottom of the screen, which is
 * what made three separate screenshots look as though the slab had not been built.
 * Tipping the camera to 28 degrees is what buys that back: sixty-four tiles of
 * depth project to thirty rather than thirty-nine, so the near edge comes up into
 * the frame without the view having to back away from the model.
 *
 * The far corners of a turning square do pass outside the frame — a square is its
 * diagonal wide at 45 degrees, which is ninety-one tiles here, and framing for that
 * would shrink everything by a third to keep two triangles of empty sea on screen.
 * The corners of this block *are* empty sea. What has to stay in frame is the four
 * edge midpoints, because that is where the cut face reads, and at 72 they do.
 */
export const DIORAMA_ACROSS = 72;

/**
 * And how wide it actually needs to be for a given window shape.
 *
 * A fixed number was wrong and only just wrong, which is the dangerous kind. At
 * 1600 by 1000 the block fits at 72 with a quarter of the frame to spare; on a
 * 21:9 window the same 72 tiles gives fifteen and a half tiles of vertical room
 * where the block needs seventeen and a half, and the near cut face goes off the
 * bottom of the screen again — the exact bug this was all about, back for anybody
 * with a wide monitor.
 *
 * So the frame is solved from the block rather than chosen. Under an orthographic
 * camera at elevation `el`, an edge midpoint `size/2` from the centre sits
 * `(size/2)·sin(el)` from the middle of the screen vertically, and the cut hangs
 * `base·cos(el)` below the waterline. Double that is what has to fit, and the
 * window's aspect converts it into tiles across.
 *
 * The hills are deliberately not in the sum. A peak poking above the top of the
 * frame is empty sky lost; the cut edge going off the bottom is the subject lost.
 */
export function dioramaAcross(aspect: number): number {
  const half = (DIORAMA_SIZE / 2) * Math.sin(DIORAMA_ELEVATION)
    + DIORAMA_BASE * Math.cos(DIORAMA_ELEVATION);
  // Guarded, because a window one pixel tall would otherwise ask for infinity.
  return Math.max(DIORAMA_ACROSS, (2 * half) / Math.max(0.25, aspect));
}

/**
 * What day of the year the little world sits on.
 *
 * High summer, and not the day the game opens on.
 *
 * The game starts at day sixty because a seasonal mechanic has to arrive as
 * something you were warned about rather than as the first thing that happens —
 * open in January and the one van you own is immobilised for want of tyres. That
 * argument is about *playing*, and the menu is not playing.
 *
 * At day sixty the parish is bare: no leaf on the trees, nothing standing in the
 * fields, and pale ground on every hill. It photographs like February because it
 * nearly is. Day 186 is the same district with the hedges in full leaf and corn in
 * the fields, which is what a model of an English parish is supposed to look like.
 */
export const DIORAMA_DAY = 186;

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
