import { describe, expect, it } from 'vitest';
import { buildGround, type GroundSource } from '../src/ground.ts';
import { cameraOffset, nearFaceIsLow } from '../src/camera.ts';

/**
 * The furrows, and the one assumption they used to make.
 *
 * A corrugated field only needs the *near* face of each ridge drawn, because the
 * far face of every ridge is hidden behind the ridge in front of it. That halves
 * the cost of the hottest geometry in the game and it is entirely correct — but
 * only if "near" is asked rather than assumed.
 *
 * The first version hard-coded the lower face with a comment admitting it held
 * only because the camera cannot be turned, and warning that a camera which
 * could would show daylight through the furrows. This is that warning turned
 * into a test: the choice is derived from the same camera constants the camera
 * itself uses, and if anybody moves the view round, these fail rather than the
 * fields quietly developing holes.
 */

describe('which face of a furrow is visible', () => {
  it('is the one on the camera\u2019s side of the ridge', () => {
    const o = cameraOffset();
    /*
     * The shipped view: the camera sits at negative X and negative Z of whatever
     * it is looking at, so for a ridge banded across either axis the near face is
     * the low one. Asserting the *offset* rather than the angle, because the
     * offset is what the geometry actually depends on.
     */
    expect(o.x).toBeLessThan(0);
    expect(o.z).toBeLessThan(0);
    expect(nearFaceIsLow(true)).toBe(true);
    expect(nearFaceIsLow(false)).toBe(true);
  });

  it('agrees with the camera on both axes, whatever the azimuth', () => {
    /*
     * The property that matters, stated without reference to the shipped angle:
     * the face chosen is the one on the same side as the camera. A ridge running
     * along X is banded across Z, so it is the Z offset that decides it.
     */
    const o = cameraOffset();
    expect(nearFaceIsLow(true)).toBe(o.z < 0);
    expect(nearFaceIsLow(false)).toBe(o.x < 0);
  });
});

const S = 32;

function source(crop: number, parcel = 2): GroundSource {
  return {
    size: S,
    height: new Int16Array(S * S).fill(400),
    parcel: new Int32Array(S * S).fill(parcel),
    crop: new Uint8Array(S * S).fill(crop),
    hasRoad: () => false,
    isWater: () => false,
    isStream: () => false,
    influence: () => 1,
    ownedLand: () => false,
    leafiness: 1,
  };
}

function tris(crop: number, parcel = 2): number {
  const g = buildGround(source(crop, parcel), 0, 0, 8, 8).build();
  return g.getAttribute('position').count / 3;
}

const PASTURE = 0;
const PLOUGH = 5;
const RIPE = 4;

describe('ploughed ground', () => {
  it('is more than a colour', () => {
    /*
     * The whole complaint this answers: "you just made it brown". A ploughed
     * field and a pasture were the same two triangles a tile in different
     * browns, and no brown makes a flat surface look turned over.
     */
    expect(tris(PLOUGH)).toBeGreaterThan(tris(PASTURE) * 5);
    expect(tris(RIPE)).toBeGreaterThan(tris(PASTURE) * 5);
  });

  it('leaves grass alone', () => {
    // Two triangles a tile, which is what a field of grass should cost.
    expect(tris(PASTURE)).toBe(8 * 8 * 2);
  });

  it('costs what it is meant to, so the saving cannot be lost quietly', () => {
    /*
     * A ceiling rather than an exact figure, because the numbers are art
     * direction and will move. What must not move is the *order*: this was 50
     * triangles a tile before the hidden faces were dropped, and a change that
     * puts it back there is a change that halves the frame rate over farmland
     * without anything looking different.
     */
    for (const crop of [PLOUGH, RIPE, 7, 8, 9, 10]) {
      const perTile = tris(crop) / (8 * 8);
      expect(perTile, `crop ${crop}`).toBeLessThanOrEqual(30);
    }
  });
});
