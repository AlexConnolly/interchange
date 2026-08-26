/**
 * Nothing without an engine gets a light.
 *
 * This has gone wrong twice from two different directions, which is why it is
 * pinned. The first time the *drawn* lamps were on the sheep; that was fixed with
 * `vMotor` and a densely packed lamp counter. The second time the drawn lamps
 * were right and the pool of eight real point lights was not — it tested `vId >= 0`
 * for "one of the player's", and grazing numbered its animals from 900000. A
 * positive id, so every cow qualified, and what followed them round the field at
 * night was a pool of white light rather than a pair of headlamps.
 *
 * The id ranges below are the real ones: see `ambient.ts`, `farmwork.ts` and
 * `grazing.ts`.
 */

import { describe, expect, it } from 'vitest';
import { throwsLight } from '../src/scene.ts';

describe('what gets one of the eight real lights', () => {
  it('gives one to the player s own lorry', () => {
    expect(throwsLight(0, 1)).toBe(true);
    expect(throwsLight(37, 1)).toBe(true);
  });

  it('refuses ambient traffic, which carries a drawn beam instead', () => {
    expect(throwsLight(-1, 1)).toBe(false);
    expect(throwsLight(-42, 1)).toBe(false);
  });

  it('refuses tractors for the same reason', () => {
    expect(throwsLight(-1000, 1)).toBe(false);
  });

  it('refuses a cow, whose id is positive and whose engine is not', () => {
    // The regression itself: 900000 + i passes a sign test and fails this one.
    expect(throwsLight(900000, 0)).toBe(false);
    expect(throwsLight(900047, 0)).toBe(false);
  });
});
