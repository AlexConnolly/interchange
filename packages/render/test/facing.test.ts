import { describe, expect, it } from 'vitest';
import {
  LANE_OFFSET, facingFromHeading, facingFromMotion, laneOffset,
} from '../src/scene.ts';

/**
 * The two ways a vehicle's facing is worked out have to agree.
 *
 * One comes from the simulation's bearing, the other from the direction the drawn
 * position is actually moving — and the renderer now uses the second precisely so
 * that facing and travel cannot disagree, which is what the drifting was. If the
 * two conversions differ by a quarter turn then every vehicle is broadside to its
 * own direction of travel, which has happened here once before.
 */
const same = (a: number, b: number): boolean => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) < 1e-9;
};

describe('which way a vehicle is pointing', () => {
  it('agrees between the bearing and the motion, all the way round', () => {
    for (let i = 0; i < 64; i++) {
      const turns = i / 64;
      // The world direction that bearing means: 0 is north, which is -Z.
      const mx = Math.sin(turns * Math.PI * 2);
      const mz = -Math.cos(turns * Math.PI * 2);
      expect(
        same(facingFromHeading(turns), facingFromMotion(mx, mz)),
        `bearing ${turns.toFixed(3)} disagrees with its own motion`,
      ).toBe(true);
    }
  });

  it('points north for a bearing of zero', () => {
    // North is -Z, and the nose is +X, so the rotation is a quarter turn.
    expect(facingFromHeading(0)).toBeCloseTo(Math.PI / 2, 12);
    expect(facingFromMotion(0, -1)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('points east for a quarter turn', () => {
    expect(facingFromHeading(0.25)).toBeCloseTo(0, 12);
    expect(facingFromMotion(1, 0)).toBeCloseTo(0, 12);
  });
});


/**
 * Which side of the road a vehicle sits on.
 *
 * It is 1985 in England, so the left — and this had been the right for as long as
 * the offset had existed, under a comment saying otherwise. North is -Z, which is
 * the trap: for a vehicle travelling east the naive normal points south, and south
 * is its right.
 */
describe('keeping left', () => {
  it('puts an eastbound vehicle to the north of the centreline', () => {
    // East is +X; the nose points along +X at a facing of zero. Left is north,
    // which is -Z.
    const o = laneOffset(facingFromHeading(0.25));
    expect(o.z).toBeLessThan(-LANE_OFFSET * 0.9);
    expect(Math.abs(o.x)).toBeLessThan(1e-9);
  });

  it('puts a northbound vehicle to the west', () => {
    const o = laneOffset(facingFromHeading(0));
    expect(o.x).toBeLessThan(-LANE_OFFSET * 0.9);
    expect(Math.abs(o.z)).toBeLessThan(1e-9);
  });

  it('is always exactly one offset from the centreline, whichever way round', () => {
    for (let i = 0; i < 32; i++) {
      const o = laneOffset(facingFromHeading(i / 32));
      expect(Math.hypot(o.x, o.z)).toBeCloseTo(LANE_OFFSET, 12);
    }
  });

  it('is perpendicular to the direction of travel', () => {
    for (let i = 0; i < 32; i++) {
      const a = facingFromHeading(i / 32);
      const o = laneOffset(a);
      // The nose points along (cos a, -sin a).
      expect(Math.cos(a) * o.x + -Math.sin(a) * o.z).toBeCloseTo(0, 12);
    }
  });
});
