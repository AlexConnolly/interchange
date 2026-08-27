/**
 * The opening, as arithmetic.
 *
 * `introAt` is a pure function of the clock, and that is the whole reason it is a
 * separate file: the sequence it describes is impossible to check in a browser at
 * the frame rate a headless one runs at — measured, sampling a ten-second timeline
 * on software GL took eight seconds to take the first sample — so the timings are
 * checked here and only the *look* is checked in a screenshot.
 *
 * What matters is the shape: solid cloud while there is nothing to see, a descent
 * that overlaps the cloud clearing, no interface until the descent is over, and no
 * input until the whole thing is.
 */

import { describe, expect, it } from 'vitest';
import { introAt, INTRO_LENGTH, INTRO_ACROSS } from '../src/intro.ts';

/** The zoom the game opens at, which is what the descent aims for. */
const TARGET = 36.4;

describe('the first three seconds', () => {
  it('are solid cloud, with nothing of the district showing', () => {
    for (const t of [0, 0.5, 1.5, 2.9]) {
      const at = introAt(t, TARGET);
      expect(at.veil, `t=${t}`).toBe(1);
      expect(at.clear).toBe(0);
    }
  });

  it('hold the camera right out, so the descent has somewhere to come from', () => {
    for (const t of [0, 1, 2.9]) {
      expect(introAt(t, TARGET).across).toBe(INTRO_ACROSS);
    }
    // And that is further out than the wheel will ever go, which is the point:
    // the opening shot is a view you cannot get back to.
    expect(INTRO_ACROSS).toBeGreaterThan(70);
  });

  it('say we are loading, and stop saying it before the descent ends', () => {
    expect(introAt(0, TARGET).label).toBe(true);
    expect(introAt(3.9, TARGET).label).toBe(true);
    expect(introAt(4.1, TARGET).label).toBe(false);
    /*
     * Gone before the interface arrives, so the last thing on screen before the
     * furniture slides in is only countryside. A label still up at that moment
     * would be a third thing animating over the other two.
     */
    expect(introAt(6.9, TARGET).label).toBe(false);
  });
});

describe('the descent', () => {
  it('comes down all the way to the opening zoom, and no further', () => {
    expect(introAt(7, TARGET).across).toBeCloseTo(TARGET, 6);
    expect(introAt(INTRO_LENGTH, TARGET).across).toBe(TARGET);
    // Monotonic. A descent that went out again on any frame would read as a jolt.
    let last = Infinity;
    for (let t = 3; t <= 7; t += 0.05) {
      const now = introAt(t, TARGET).across;
      expect(now).toBeLessThanOrEqual(last + 1e-9);
      last = now;
    }
  });

  it('clears the cloud before it finishes falling', () => {
    /*
     * The overlap is what sells it: you break out into clear air and are *still*
     * coming down, which is the moment the district arrives. Cloud thinning all
     * the way to the ground would read as fog instead.
     */
    const cleared = introAt(3 + (7 - 3) * 0.62 + 0.01, TARGET);
    expect(cleared.veil).toBeCloseTo(0, 3);
    expect(cleared.across).toBeGreaterThan(TARGET + 1);
  });

  it('is smooth at both ends', () => {
    // Eased, so nothing in the sequence starts or stops abruptly. The derivative
    // at each end should be near zero, which a linear ramp would fail.
    const d = (t: number): number => (
      introAt(t + 0.01, TARGET).across - introAt(t, TARGET).across
    );
    expect(Math.abs(d(3.02))).toBeLessThan(Math.abs(d(5)));
    expect(Math.abs(d(6.96))).toBeLessThan(Math.abs(d(5)));
  });
});

describe('the interface', () => {
  it('stays away until the descent is over', () => {
    for (const t of [0, 3, 5, 6.9]) expect(introAt(t, TARGET).ui, `t=${t}`).toBe(false);
    expect(introAt(7.1, TARGET).ui).toBe(true);
  });

  it('gets the last three seconds to itself, and input comes only after', () => {
    /*
     * `ui` and `done` are deliberately different moments. The furniture has to be
     * on screen to slide in, so it appears at seven seconds; nothing may be
     * pressed until ten, so the first thing a player can touch is a thing that has
     * already stopped moving.
     */
    expect(introAt(7.1, TARGET).done).toBe(false);
    expect(introAt(9.9, TARGET).done).toBe(false);
    expect(introAt(INTRO_LENGTH, TARGET).done).toBe(true);
    expect(introAt(INTRO_LENGTH + 5, TARGET).done).toBe(true);
  });

  it('lands on the plain playing state once it is over', () => {
    const after = introAt(INTRO_LENGTH + 1, TARGET);
    expect(after).toEqual({
      clear: 1, veil: 0, across: TARGET, label: false, ui: true, done: true,
    });
  });
});
