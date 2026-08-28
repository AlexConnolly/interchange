/**
 * The district is a solid thing, not a painted sheet.
 *
 * It was a sheet: two triangles a tile and nothing underneath, so from any angle
 * that saw past the coast it read as a plane hanging in the air. "The worlds
 * should have a bit more of cube underneath them so they don't look like a flat
 * plane."
 *
 * A geometry test rather than a picture, for the reason the bridge test gives and
 * one more: this is the menu, which renders at about three frames a second in a
 * headless browser behind a cloud layer, so a screenshot of it answers "is there a
 * slab" with a shrug. The triangles either exist at the right depth or they do
 * not, and that is a thing arithmetic can settle.
 */

import { describe, expect, it } from 'vitest';
import { buildGround, BASE_DEPTH, HEIGHT_TO_WORLD, type GroundSource } from '../src/ground.ts';

const S = 12;

/**
 * A little island: land in the middle, sea round the rim.
 *
 * Which is the shape the generator actually makes at every size — measured, the
 * coast never reaches the map edge on any world from 32 tiles to 128 — so the rim
 * being water is the case the slab has to look right in.
 */
function island(): GroundSource {
  const height = new Int16Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.max(Math.abs(x - S / 2 + 0.5), Math.abs(y - S / 2 + 0.5));
      height[y * S + x] = d < 3 ? 40 : -24;
    }
  }
  return {
    size: S,
    height,
    crop: new Uint8Array(S * S).fill(6),
    parcel: new Int32Array(S * S).fill(-1),
    isWater: (t) => height[t] <= 0,
    isStream: () => false,
    hasRoad: () => false,
    influence: () => 1,
    ownedLand: () => false,
    leafiness: 1,
  } as unknown as GroundSource;
}

/**
 * Every vertex y in the mesh, which is all these tests need to look at.
 *
 * Through `build()` rather than the buffers, which are private — the same way the
 * bridge test counts its vertices.
 */
function heights(m: ReturnType<typeof buildGround>): number[] {
  const pos = m.build().getAttribute('position');
  const out: number[] = [];
  for (let i = 0; i < pos.count; i++) out.push(pos.getY(i));
  return out;
}

describe('the edge of the world', () => {
  it('is cut down to a base rather than stopping dead', () => {
    const m = buildGround(island(), 0, 0, S, S);
    const ys = heights(m);
    const lowest = Math.min(...ys);
    expect(lowest).toBeCloseTo(-BASE_DEPTH, 5);
    // And a fair number of vertices are down there, not one stray triangle.
    expect(ys.filter((y) => y <= -BASE_DEPTH + 1e-6).length).toBeGreaterThan(20);
  });

  it('cuts from the waterline, so the top of the slab is one flat line', () => {
    /*
     * The bug this pins. Following the seabed gave the slab a torn top edge that
     * read as a broken-off piece rather than a cut one — the sea floor is not
     * level, so the rim rose and fell by a tenth of a unit all the way round.
     *
     * Every wall on a water rim must therefore start at exactly zero.
     */
    const src = island();
    const m = buildGround(src, 0, 0, S, S);
    /*
     * The seabed is well below zero here, so anything in the mesh at exactly zero
     * can only be the top of the cut: no terrain triangle is at that height.
     */
    const seabed = HEIGHT_TO_WORLD(-24);
    expect(seabed).toBeLessThan(-0.05);
    const atWaterline = heights(m).filter((y) => Math.abs(y) < 1e-6).length;
    expect(atWaterline).toBeGreaterThan(10);
  });

  it('leaves the inside of the map alone', () => {
    /*
     * The reason the cut is tested against the *map* edge and not the chunk it is
     * being built in. Chunks are sixteen tiles square, so a slab drawn per chunk
     * would put walls through the middle of the district — four of them at every
     * seam — and it would only show up as dark seams in a screenshot.
     */
    const src = island();
    const inner = buildGround(src, 3, 3, 9, 9);
    const lowest = Math.min(...heights(inner));
    expect(lowest).toBeGreaterThan(-BASE_DEPTH + 0.01);
  });

  it('grows a wall on each of the four sides', () => {
    /*
     * One side at a time, because a winding mistake shows up as a wall that is
     * there and invisible — the triangles are single-sided, so getting the order
     * wrong on one edge gives an island you can see straight through from the
     * north and not from the south.
     */
    const src = island();
    const strips: [string, number, number, number, number][] = [
      ['north', 0, 0, S, 1],
      ['south', 0, S - 1, S, S],
      ['west', 0, 0, 1, S],
      ['east', S - 1, 0, S, S],
    ];
    for (const [name, x0, y0, x1, y1] of strips) {
      const m = buildGround(src, x0, y0, x1, y1);
      const deep = heights(m).filter((y) => y <= -BASE_DEPTH + 1e-6).length;
      expect(deep, `${name} edge has a wall`).toBeGreaterThan(4);
    }
  });
});
