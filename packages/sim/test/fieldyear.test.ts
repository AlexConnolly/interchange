import { describe, expect, it } from 'vitest';
import { Crop, arableStage, grassStage } from '../src/fields.ts';

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
