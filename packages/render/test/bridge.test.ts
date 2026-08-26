import { describe, expect, it } from 'vitest';
import { buildRoads, type RoadSource } from '../src/roads.ts';

/**
 * A road over water gets a parapet, and a road over grass does not.
 *
 * This is a geometry test rather than a picture, because the thing that can
 * silently break is not how the bridge looks — it is whether it is built at all.
 * The whole feature is one predicate: the terrain has carved watercourses since
 * the beginning and the road network has always routed across them, so a bridge
 * was already a road tile with water under it and the only missing piece was the
 * wall. If `isStream` is ever wired to something that returns false everywhere —
 * which is exactly what happened to `isWater`, for the entire life of the
 * project — the district loses every bridge and nothing errors.
 *
 * So: build the same road twice, once with water under it, and assert the
 * difference is real.
 */

const S = 8;

function source(
  stream: (tile: number) => boolean,
  lay: (roadClass: Int8Array) => void = (rc) => {
    // One lane running east-west along z = 4.
    for (let x = 0; x < S; x++) rc[4 * S + x] = 1;
  },
): RoadSource {
  const height = new Int16Array(S * S).fill(400);
  const roadClass = new Int8Array(S * S).fill(-1);
  lay(roadClass);
  return {
    size: S,
    height,
    roadClass,
    level: new Int16Array(S * S),
    influence: () => 1,
    isStream: stream,
    // No buildings in this fixture: the yard suppression is a different test's
    // business and leaving it on would quietly delete the road under it.
    isYard: () => false,
  };
}

function vertices(src: RoadSource): number {
  const m = buildRoads(src, 0, 0, S, S);
  return m.build().getAttribute('position').count;
}

describe('bridges', () => {
  it('builds nothing extra where the road is on dry land', () => {
    const dry = vertices(source(() => false));
    expect(dry).toBeGreaterThan(0);
  });

  it('adds a parapet where the road crosses water', () => {
    const dry = vertices(source(() => false));
    // One tile of the lane has a beck under it.
    const wet = vertices(source((t) => t === 4 * S + 3));
    expect(wet).toBeGreaterThan(dry);
  });

  it('puts a wall on each side, so the count scales with the crossings', () => {
    /*
     * Two crossings must cost exactly twice one. A parapet built per *tile*
     * rather than per bridge is the difference between a wall along the road and
     * a wall on the tile the road happens to start on, and the arithmetic is the
     * only way to tell those apart without looking.
     */
    const dry = vertices(source(() => false));
    const one = vertices(source((t) => t === 4 * S + 3));
    const two = vertices(source((t) => t === 4 * S + 3 || t === 4 * S + 5));
    expect(one - dry).toBeGreaterThan(0);
    expect(two - dry).toBe((one - dry) * 2);
  });

  it('walls the sides the road does not leave by, so nothing crosses the deck', () => {
    /*
     * A bridge on a bend, which is where this went wrong.
     *
     * The parapet used to be drawn down both sides of whichever axis was open,
     * and a bend has *both* axes open — so it got four full-length walls meeting
     * in the middle of the tile, two of them lying straight across the road. The
     * arithmetic catches it exactly: a bend has two open sides and two closed
     * ones, so it must cost the same two walls a straight does, and not four.
     */
    const straight = (rc: Int8Array): void => {
      rc[4 * S + 2] = 1;
      rc[4 * S + 3] = 1;
      rc[4 * S + 4] = 1;
    };
    // The same three tiles, bent: in from the west, out to the south.
    const bend = (rc: Int8Array): void => {
      rc[4 * S + 2] = 1;
      rc[4 * S + 3] = 1;
      rc[5 * S + 3] = 1;
    };
    const wet = 4 * S + 3;
    const straightDry = vertices(source(() => false, straight));
    const straightWet = vertices(source((t) => t === wet, straight));
    const bendDry = vertices(source(() => false, bend));
    const bendWet = vertices(source((t) => t === wet, bend));
    expect(bendWet - bendDry).toBe(straightWet - straightDry);
  });

  it('leaves a crossroads over water unwalled rather than fenced in', () => {
    /*
     * Every side has a road on it, so there is no edge to fall off — and four
     * walls round a junction would be a cattle pen with a road through it. This
     * is the case the old code called rare and drew anyway.
     */
    const cross = (rc: Int8Array): void => {
      for (const t of [4 * S + 2, 4 * S + 3, 4 * S + 4, 3 * S + 3, 5 * S + 3]) rc[t] = 1;
    };
    const dry = vertices(source(() => false, cross));
    const wet = vertices(source((t) => t === 4 * S + 3, cross));
    expect(wet).toBe(dry);
  });
});
