/**
 * The face the parish pulls at you.
 *
 * One thing here matters more than the rest and it is the reason this file exists:
 * a game that has just started must not open with the parish looking cross. The
 * obvious implementation — five even bands across nought to a hundred — does
 * exactly that, because `APPROVAL_REST` is 30 and 30 falls in the fourth of five
 * even bands. It shipped that way for about ten minutes and a screenshot caught
 * it: a frowning face on a brand new game, before the player had done anything.
 */

import { describe, expect, it } from 'vitest';
import { APPROVAL_REST } from '@interchange/sim';
import { mood, mouthPath, type Mood } from '../src/parish.ts';

const ORDER: Mood[] = ['cross', 'cool', 'fair', 'warm', 'glad'];

describe('a game that has just started', () => {
  it('shows a neutral face, not an unhappy one', () => {
    const m = mood(APPROVAL_REST);
    expect(m.face).toBe('fair');
  });

  it('keeps rest well inside the neutral band rather than on its edge', () => {
    /*
     * Well inside, because the earned part drifts a tenth of a point a day in
     * whichever direction: sitting rest on a boundary would make the face flicker
     * between two moods over a week of doing nothing in particular.
     */
    for (const nudge of [-4, -2, 0, 2, 4, 8]) {
      expect(mood(APPROVAL_REST + nudge).face, `at ${APPROVAL_REST + nudge}`).toBe('fair');
    }
  });
});

describe('the five faces', () => {
  it('never go backwards as approval rises', () => {
    let worst = -1;
    for (let a = 0; a <= 100; a++) {
      const rank = ORDER.indexOf(mood(a).face);
      expect(rank, `at ${a}`).toBeGreaterThanOrEqual(worst);
      worst = rank;
    }
  });

  it('uses all five, so no band is unreachable', () => {
    const seen = new Set<string>();
    for (let a = 0; a <= 100; a++) seen.add(mood(a).face);
    expect([...seen].sort()).toEqual([...ORDER].sort());
  });

  it('gives every band room to be read', () => {
    /*
     * No band narrower than eight points. A band a player passes through in a day
     * is a face they never see, and one they cannot act on if they do.
     */
    const width = new Map<string, number>();
    for (let a = 0; a <= 100; a++) {
      const f = mood(a).face;
      width.set(f, (width.get(f) ?? 0) + 1);
    }
    for (const [face, n] of width) {
      expect(n, `${face} is ${n} points wide`).toBeGreaterThanOrEqual(8);
    }
  });

  it('answers for figures outside the range without inventing a sixth', () => {
    for (const a of [-20, -1, 101, 1000, Number.NaN]) {
      const f = mood(a).face;
      expect(ORDER).toContain(f);
    }
  });

  it('has a mouth for each, and the neutral one is flat', () => {
    for (const face of ORDER) {
      expect(mouthPath(face).length).toBeGreaterThan(6);
    }
    // A straight line: no curve command in it at all.
    expect(mouthPath('fair')).not.toContain('q');
    for (const face of ['glad', 'warm', 'cool', 'cross'] as Mood[]) {
      expect(mouthPath(face)).toContain('q');
    }
  });

  it('does not give two moods the same mouth', () => {
    const mouths = ORDER.map(mouthPath);
    expect(new Set(mouths).size).toBe(ORDER.length);
  });
});
