/**
 * Turning the parish's regard into a face.
 *
 * Its own module for the reason `intro.ts` and `water.ts` are: it is arithmetic
 * with a right answer, the answer is not obvious, and it got the obvious answer
 * wrong first time. Splitting nought to a hundred into five even bands is the
 * thing anybody would write, and it put `APPROVAL_REST` — 30, where every game
 * starts and where a haulier nobody has heard of sits — into the *fourth* band.
 * Every new game opened with the parish pulling a face at a player who had not yet
 * done anything at all.
 *
 * So the bands are centred on rest rather than on the range. The neutral one is
 * wide and sits over 30; the two unhappy faces are narrow, because the only way to
 * get below rest is to have actually built something they did not want.
 */

/** The five, in order. Used as a CSS suffix, so the names are part of the style. */
export type Mood = 'cross' | 'cool' | 'fair' | 'warm' | 'glad';

export interface MoodBand {
  face: Mood;
  /** What it says in words, for the tooltip and the panel's subtitle. */
  word: string;
}

/**
 * Which face, and what it is called.
 *
 * Wide bands generally, so it does not flicker between two as the number drifts a
 * tenth of a point a day — the drift alone would otherwise walk it back and forth
 * across a boundary for a week.
 */
export function mood(approval: number): MoodBand {
  if (approval >= 70) return { face: 'glad', word: 'They are glad you are here' };
  if (approval >= 45) return { face: 'warm', word: 'Well thought of' };
  if (approval >= 25) return { face: 'fair', word: 'They have no strong view' };
  if (approval >= 12) return { face: 'cool', word: 'You have put some backs up' };
  return { face: 'cross', word: 'You are not welcome here' };
}

/**
 * The mouth, which is the whole of the face.
 *
 * The eyes never move, so the only thing changing between the five is one curve.
 * That is what makes them read as one thing in five moods rather than as five
 * different icons — and it is why the neutral one is a straight line rather than a
 * slight smile: a slight smile is a sixth mood nobody asked for.
 */
export function mouthPath(face: Mood): string {
  switch (face) {
    case 'glad': return 'M8 14.2q4 4 8 0';
    case 'warm': return 'M8.4 14.4q3.6 2.4 7.2 0';
    case 'fair': return 'M8.6 15h6.8';
    case 'cool': return 'M8.4 15.8q3.6 -2 7.2 0';
    default: return 'M8 16.4q4 -3.4 8 0';
  }
}
