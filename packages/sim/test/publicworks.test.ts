/**
 * The authority's road scheme, which features.md wants to be genuinely
 * frightening — and which therefore has to be genuinely fair.
 *
 * Every case here is one of the three properties that make it fair: it is
 * provoked by the price rather than by the person, it can be called off by
 * dropping the price, and it never arrives without warning.
 */

import { describe, expect, it } from 'vitest';
import {
  SchemeTable, stepPublicWorks, SchemeState, DEAR_CHARGE, BUSY_PASSES,
  CONSULTATION_YEARS, PUBLIC_WORKS_FROM_ERA, AssetTable, Mode, AUTHORITY,
  TICKS_PER_YEAR,
} from '../src/index.ts';

function corridor(charge: number, passes: number) {
  const assets = new AssetTable();
  const a = assets.alloc(Mode.Road, 0, 1, charge, 0);
  assets.tiles[a] = 40;
  assets.passesPrev[a] = passes;
  return { assets, a };
}

const ends = () => ({ from: 100, to: 900 });

describe('a public road scheme', () => {
  it('is not considered before its era', () => {
    const s = new SchemeTable();
    const { assets } = corridor(DEAR_CHARGE * 2, BUSY_PASSES * 2);
    const r = stepPublicWorks(s, assets, PUBLIC_WORKS_FROM_ERA - 1, 0, TICKS_PER_YEAR, ends);
    expect(r.proposed).toEqual([]);
    expect(s.count).toBe(0);
  });

  it('leaves a cheap road alone however busy it is', () => {
    const s = new SchemeTable();
    const { assets } = corridor(2, BUSY_PASSES * 8);
    const r = stepPublicWorks(s, assets, PUBLIC_WORKS_FROM_ERA, 0, TICKS_PER_YEAR, ends);
    expect(r.proposed).toEqual([]);
  });

  it('leaves a dear road alone if nobody uses it', () => {
    const s = new SchemeTable();
    const { assets } = corridor(DEAR_CHARGE * 4, 3);
    const r = stepPublicWorks(s, assets, PUBLIC_WORKS_FROM_ERA, 0, TICKS_PER_YEAR, ends);
    expect(r.proposed).toEqual([]);
  });

  it('proposes against a road that is both dear and busy, and warns first', () => {
    const s = new SchemeTable();
    const { assets } = corridor(DEAR_CHARGE * 2, BUSY_PASSES * 2);
    const r = stepPublicWorks(s, assets, PUBLIC_WORKS_FROM_ERA, 0, TICKS_PER_YEAR, ends);
    expect(r.proposed.length).toBe(1);
    expect(r.build).toEqual([]);
    expect(s.state[0]).toBe(SchemeState.Proposed);

    // Nothing is built until the consultation is over.
    for (let y = 1; y < CONSULTATION_YEARS; y++) {
      const step = stepPublicWorks(s, assets, PUBLIC_WORKS_FROM_ERA, y * TICKS_PER_YEAR, TICKS_PER_YEAR, ends);
      expect(step.build).toEqual([]);
    }
    const last = stepPublicWorks(
      s, assets, PUBLIC_WORKS_FROM_ERA, CONSULTATION_YEARS * TICKS_PER_YEAR, TICKS_PER_YEAR, ends,
    );
    expect(last.build).toEqual([0]);
    expect(s.state[0]).toBe(SchemeState.Built);
  });

  it('is called off if the charge comes down while it is in consultation', () => {
    const s = new SchemeTable();
    const { assets, a } = corridor(DEAR_CHARGE * 2, BUSY_PASSES * 2);
    stepPublicWorks(s, assets, PUBLIC_WORKS_FROM_ERA, 0, TICKS_PER_YEAR, ends);
    expect(s.state[0]).toBe(SchemeState.Proposed);

    // The operator takes the hint.
    assets.charge[a] = 4;
    const r = stepPublicWorks(s, assets, PUBLIC_WORKS_FROM_ERA, TICKS_PER_YEAR, TICKS_PER_YEAR, ends);
    expect(r.withdrawn).toEqual([0]);
    expect(r.build).toEqual([]);
    expect(s.state[0]).toBe(SchemeState.Withdrawn);
  });

  it('is called off if the operator sells up to the authority', () => {
    const s = new SchemeTable();
    const { assets, a } = corridor(DEAR_CHARGE * 2, BUSY_PASSES * 2);
    stepPublicWorks(s, assets, PUBLIC_WORKS_FROM_ERA, 0, TICKS_PER_YEAR, ends);
    assets.owner[a] = AUTHORITY;
    const r = stepPublicWorks(s, assets, PUBLIC_WORKS_FROM_ERA, TICKS_PER_YEAR, TICKS_PER_YEAR, ends);
    expect(r.withdrawn).toEqual([0]);
  });

  it('runs one scheme at a time, not a programme of them', () => {
    const s = new SchemeTable();
    const assets = new AssetTable();
    for (let i = 0; i < 5; i++) {
      const a = assets.alloc(Mode.Road, 0, 1, DEAR_CHARGE * 2, 0);
      assets.tiles[a] = 40;
      assets.passesPrev[a] = BUSY_PASSES * 2;
    }
    let live = 0;
    for (let y = 0; y < 3; y++) {
      stepPublicWorks(s, assets, PUBLIC_WORKS_FROM_ERA, y * TICKS_PER_YEAR, TICKS_PER_YEAR, ends);
      live = 0;
      for (let i = 0; i < s.count; i++) if (s.state[i] === SchemeState.Proposed) live++;
      expect(live).toBeLessThanOrEqual(1);
    }
  });
});
