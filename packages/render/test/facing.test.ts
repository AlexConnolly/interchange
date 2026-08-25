import { describe, expect, it } from 'vitest';
import { facingFromHeading, facingFromMotion } from '../src/scene.ts';

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
