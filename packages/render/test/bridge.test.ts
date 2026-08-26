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

function source(stream: (tile: number) => boolean): RoadSource {
  const height = new Int16Array(S * S).fill(400);
  const roadClass = new Int8Array(S * S).fill(-1);
  // One lane running east-west along z = 4.
  for (let x = 0; x < S; x++) roadClass[4 * S + x] = 1;
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
});
