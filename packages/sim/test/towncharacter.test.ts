/**
 * Town character, and the reason it is not a zoning tool.
 *
 * features.md wants "zoning influence rather than direct control", and the
 * whole of that phrase lives in these assertions: there is no command that
 * sets a character, a character changes only because circumstances argued for
 * it consistently for years, and one character — port — cannot be reached at
 * all by anything the player does, because it is geography.
 */

import { describe, expect, it } from 'vitest';
import {
  TownTable, Character, stepCharacter, characterAppetite, DRIFT_YEARS,
} from '../src/index.ts';

function town(character: number): TownTable {
  const t = new TownTable(4);
  t.alloc(10, 10, 0, 'Wentbridge', 4000, character);
  return t;
}

const QUIET = {
  industryNearby: () => 0,
  carriers: () => 0,
  amenity: () => 0,
  transit: () => 0,
  coastal: () => false,
  yearFraction: 1,
};

describe('drift', () => {
  it('takes years, not a season', () => {
    const towns = town(Character.Market);
    const ctx = { ...QUIET, amenity: () => 95 };
    for (let y = 0; y < DRIFT_YEARS - 1; y++) {
      stepCharacter(towns, ctx);
      expect(towns.character[0]).toBe(Character.Market);
    }
    stepCharacter(towns, ctx);
    expect(towns.character[0]).toBe(Character.Resort);
  });

  it('does not move on a hair\'s breadth, however long it is held', () => {
    // Market scores carriers*26 + amenity*0.25; dormitory scores transit*0.9.
    // Pick a transit that beats it by less than the margin and hold it for
    // twice the drift period: a town on the edge must not flicker.
    const towns = town(Character.Market);
    const ctx = { ...QUIET, transit: () => 5 };
    for (let y = 0; y < DRIFT_YEARS * 2; y++) stepCharacter(towns, ctx);
    expect(towns.character[0]).toBe(Character.Market);
  });

  it('does not let years spent becoming one thing count toward another', () => {
    /*
     * A town nearly finished turning into a resort has a works open beside it.
     * The case for a resort evaporates and the case for an industrial town
     * appears — and the decade already banked must not carry across, or the
     * town arrives as industrial within the year having never argued for it.
     */
    const towns = town(Character.Market);
    const nice = { ...QUIET, amenity: () => 95 };
    for (let y = 0; y < DRIFT_YEARS - 2; y++) stepCharacter(towns, nice);
    const works = { ...QUIET, amenity: () => 95, industryNearby: () => 6, carriers: () => 2 };
    stepCharacter(towns, works);
    expect(towns.characterDrift[0]).toBeLessThanOrEqual(100);
    expect(towns.character[0]).toBe(Character.Market);
    for (let y = 0; y < 3; y++) stepCharacter(towns, works);
    expect(towns.character[0]).toBe(Character.Market);
  });
});

describe('what circumstances argue for', () => {
  it('turns a town with works on its doorstep industrial', () => {
    const towns = town(Character.Market);
    const ctx = { ...QUIET, industryNearby: () => 3, carriers: () => 1 };
    for (let y = 0; y < DRIFT_YEARS; y++) stepCharacter(towns, ctx);
    expect(towns.character[0]).toBe(Character.Industrial);
  });

  it('turns a well-served pleasant town into a market', () => {
    const towns = town(Character.Industrial);
    const ctx = { ...QUIET, carriers: () => 4, amenity: () => 60 };
    for (let y = 0; y < DRIFT_YEARS; y++) stepCharacter(towns, ctx);
    expect(towns.character[0]).toBe(Character.Market);
  });

  it('turns a town you can commute out of into a dormitory', () => {
    const towns = town(Character.Market);
    const ctx = { ...QUIET, transit: () => 90 };
    for (let y = 0; y < DRIFT_YEARS; y++) stepCharacter(towns, ctx);
    expect(towns.character[0]).toBe(Character.Dormitory);
  });

  it('will not make a landlocked town a port, whatever is done to it', () => {
    const towns = town(Character.Market);
    const ctx = { ...QUIET, carriers: () => 8, industryNearby: () => 2 };
    for (let y = 0; y < DRIFT_YEARS * 4; y++) stepCharacter(towns, ctx);
    expect(towns.character[0]).not.toBe(Character.Port);
  });

  it('ruins a resort by putting a works beside it', () => {
    const towns = town(Character.Resort);
    const ctx = { ...QUIET, amenity: () => 80, industryNearby: () => 3, carriers: () => 2 };
    for (let y = 0; y < DRIFT_YEARS; y++) stepCharacter(towns, ctx);
    expect(towns.character[0]).toBe(Character.Industrial);
  });
});

describe('appetite', () => {
  it('flavours a basket rather than replacing it', () => {
    // Every character still wants everything: the multiplier is never zero, so
    // a route into a town that changes its nature loses traffic but does not
    // die overnight.
    for (const ch of Object.values(Character)) {
      for (const cargo of ['coal', 'food', 'goods', 'tourists', 'passengers', 'mail']) {
        expect(characterAppetite(ch, cargo)).toBeGreaterThan(0);
      }
    }
  });

  it('sends a resort more visitors and an industrial town fewer', () => {
    expect(characterAppetite(Character.Resort, 'tourists'))
      .toBeGreaterThan(characterAppetite(Character.Industrial, 'tourists'));
    expect(characterAppetite(Character.Industrial, 'coal'))
      .toBeGreaterThan(characterAppetite(Character.Resort, 'coal'));
  });

  it('makes a dormitory a source of commuters and not of shopping', () => {
    expect(characterAppetite(Character.Dormitory, 'passengers')).toBeGreaterThan(1);
    expect(characterAppetite(Character.Dormitory, 'goods')).toBeLessThan(1);
  });

  it('leaves anything it has no opinion about alone', () => {
    expect(characterAppetite(Character.Market, 'lithium')).toBe(1);
  });
});
