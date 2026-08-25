import { describe, expect, it } from 'vitest';
import {
  Crop, NEEDS_WORK, arableStage, grassStage, springSown,
} from '../src/fields.ts';

/*
 * The farming year, which is the only part of the seasons that has an answer you
 * can be wrong about. Everything else in the change of seasons is a colour.
 */
describe('the arable year', () => {
  it('is gold in August and turned earth in October', () => {
    expect(arableStage(6, 0)).toBe(Crop.WheatRipe);
    expect(arableStage(9, 0)).toBe(Crop.Plough);
  });

  it('passes through every stage exactly once in twelve months', () => {
    const seen: number[] = [];
    for (let m = 0; m < 12; m++) {
      const c = arableStage(m, 0);
      if (seen[seen.length - 1] !== c) seen.push(c);
    }
    expect(seen).toEqual([
      Crop.Growing, Crop.Wheat, Crop.WheatRipe,
      Crop.Stubble, Crop.Bare, Crop.Plough, Crop.Drilled,
    ]);
  });

  it('never leaves a field without a stage, whatever the offset', () => {
    for (let off = -4; off <= 4; off++) {
      for (let m = 0; m < 12; m++) {
        expect(arableStage(m, off)).toBeGreaterThanOrEqual(0);
        expect(arableStage(m, off)).toBeLessThan(11);
      }
    }
  });

  it('staggers a district: two parcels a month apart are not in step', () => {
    // The whole point of the offset. If this passes for every month there is no
    // stagger at all and the valley turns gold in one frame.
    let differ = 0;
    for (let m = 0; m < 12; m++) if (arableStage(m, 0) !== arableStage(m, 1)) differ++;
    expect(differ).toBeGreaterThan(0);
  });
});

describe('grass', () => {
  it('leaves pasture alone all year', () => {
    for (let m = 0; m < 12; m++) {
      expect(grassStage(m, 0, Crop.Pasture)).toBe(Crop.Pasture);
      expect(grassStage(m, 0, Crop.PastureRich)).toBe(Crop.PastureRich);
    }
  });

  it('cuts a meadow for hay in the summer and lets it back', () => {
    expect(grassStage(6, 0, Crop.Meadow)).toBe(Crop.Stubble);
    expect(grassStage(2, 0, Crop.Meadow)).toBe(Crop.Meadow);
    expect(grassStage(10, 0, Crop.Meadow)).toBe(Crop.Meadow);
  });
});


/**
 * The one thing about the farming year that is not a matter of taste.
 *
 * A tractor only has something to do when a field's stage changes into one that
 * needs working, and for a while the calendar had a four-month hole in it — March
 * to June, which happen to be the four months a new player sees, because the
 * world opens in March. The tractors were correct the whole time and there was
 * nothing for them to do, which looked exactly like a broken feature and was
 * reported as one.
 *
 * A count of jobs per month is therefore not a nicety. It is the assertion that
 * the district is *worked*, and it is the one that would fail silently if anybody
 * ever retuned the rotations.
 */
function jobsIn(month: number): number {
  const before = (month + 11) % 12;
  let n = 0;
  for (const spring of [false, true]) {
    for (const off of [0, 1, 2]) {
      const now = arableStage(month, off, spring);
      if (now !== arableStage(before, off, spring) && NEEDS_WORK.has(now)) n++;
    }
  }
  for (const off of [0, 1, 2]) {
    const now = grassStage(month, off, Crop.Meadow);
    if (now !== grassStage(before, off, Crop.Meadow) && NEEDS_WORK.has(now)) n++;
  }
  return n;
}

describe('the district is worked all year', () => {
  it('has a job for a tractor in every single month', () => {
    for (let m = 0; m < 12; m++) {
      expect(jobsIn(m), `month ${m} has no field work in it`).toBeGreaterThan(0);
    }
  });

  it('is busiest in the autumn, which is when a farm is', () => {
    const autumn = jobsIn(8) + jobsIn(9) + jobsIn(10);
    const spring = jobsIn(2) + jobsIn(3) + jobsIn(4);
    expect(autumn).toBeGreaterThan(spring);
  });

  it('splits the arable land between two rotations', () => {
    // Neither all nor none, or the second rotation is not doing its job.
    let spring = 0;
    for (let p = 0; p < 400; p++) if (springSown(p)) spring++;
    expect(spring).toBeGreaterThan(40);
    expect(spring).toBeLessThan(360);
  });

  it('drills spring barley in March and cuts it in September', () => {
    expect(arableStage(2, 0, true)).toBe(Crop.Drilled);
    expect(arableStage(8, 0, true)).toBe(Crop.Stubble);
    // And the winter crop is doing something else at both of those moments,
    // which is the entire point of having two.
    expect(arableStage(2, 0, false)).not.toBe(Crop.Drilled);
    expect(arableStage(8, 0, false)).not.toBe(Crop.Stubble);
  });
});

describe('meadows', () => {
  it('are cut twice in the summer, not once', () => {
    let cuts = 0;
    for (let m = 0; m < 12; m++) {
      const now = grassStage(m, 0, Crop.Meadow);
      if (now !== grassStage((m + 11) % 12, 0, Crop.Meadow) && now === Crop.Stubble) cuts++;
    }
    expect(cuts).toBe(2);
  });
});
