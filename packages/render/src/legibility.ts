/**
 * Can you tell them apart? art-direction.md §10, and the Phase 6 gate.
 *
 * The rule the art direction sets is specific and testable: *construction says
 * what it is, livery says whose it is, and you must be able to tell both apart
 * with the colour removed*. Most projects state something like that and then
 * never check it, and the check is the whole value — a palette drifts one hex
 * at a time, and the day two companies become indistinguishable to a
 * deuteranope is not a day anybody notices.
 *
 * So this measures three separate things, because they can fail separately:
 *
 *   1. the colours are far enough apart in normal vision
 *   2. they are still far enough apart under each of the three common forms of
 *      colour blindness, which between them are about one man in twelve
 *   3. identity does not depend on colour at all, because the pattern set
 *      distinguishes them with the colour thrown away entirely
 *
 * The third is the one that actually matters and the one the art direction is
 * really about. The first two are the belt to its braces: a scheme that passes
 * three but fails two is legible and ugly, and one that passes two but fails
 * three is a scheme that stops working in fog, at dusk, and at fourteen pixels.
 */

import { LIVERIES, SEMANTIC, type RGB } from './palette.ts';

/**
 * Convert to CIE L*a*b*, which is where perceptual distance means something.
 *
 * Distance in RGB is not distance to an eye — the green channel dominates
 * luminance and the blue barely contributes, so two colours a long way apart
 * in RGB can look identical and two adjacent ones can look nothing alike.
 * Every threshold below would be measuring the wrong thing without this.
 */
function toLab(c: RGB): [number, number, number] {
  // Linear already: the palette converts on load, which is what the colour
  // management note in the renderer is about.
  const f = (v: number): number => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = f((c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047);
  const y = f(c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722);
  const z = f((c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Plain Euclidean distance in Lab. Good enough for "are these two things
 *  different", which is the only question here. */
export function perceptualDistance(a: RGB, b: RGB): number {
  const p = toLab(a);
  const q = toLab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export const Vision = {
  Normal: 0,
  /** No long-wave cones: reds darken and collapse toward green. ~1% of men. */
  Protanopia: 1,
  /** No medium-wave cones: the commonest, ~1.5% of men. */
  Deuteranopia: 2,
  /** No short-wave cones: rare, but blues and yellows collapse. */
  Tritanopia: 3,
} as const;
export type Vision = (typeof Vision)[keyof typeof Vision];

export const VISION_NAMES = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];

/**
 * Simulate dichromatic vision.
 *
 * The Brettel–Viénot–Mollon projection, in the linear RGB the renderer already
 * works in. It is an approximation — every simulation of colour blindness is —
 * but it is the standard one, and the point is to catch a livery pair that
 * collapses rather than to reproduce anybody's experience exactly.
 */
export function simulate(c: RGB, vision: Vision): RGB {
  if (vision === Vision.Normal) return c;
  const [r, g, b] = c;
  if (vision === Vision.Protanopia) {
    return [
      0.170556992 * r + 0.829443014 * g,
      0.170556991 * r + 0.829443008 * g,
      -0.004517144 * r + 0.004517144 * g + b,
    ];
  }
  if (vision === Vision.Deuteranopia) {
    return [
      0.33066007 * r + 0.66933993 * g,
      0.33066007 * r + 0.66933993 * g,
      -0.02785538 * r + 0.02785538 * g + b,
    ];
  }
  return [
    r,
    0.5 * g + 0.5 * b,
    0.5 * g + 0.5 * b,
  ];
}

export interface Clash {
  a: string;
  b: string;
  vision: string;
  distance: number;
}

/**
 * Every pair of liveries under every vision, against a threshold.
 *
 * The threshold is in Lab units, where about 2.3 is the smallest difference a
 * person can see side by side. Twelve is far above that on purpose: these are
 * small tinted regions on moving objects seen from above, often against
 * foliage, sometimes at night, and "technically distinguishable in a
 * laboratory" is not the bar.
 */
export function findClashes(threshold = 12): Clash[] {
  const out: Clash[] = [];
  const visions: Vision[] = [Vision.Normal, Vision.Protanopia, Vision.Deuteranopia, Vision.Tritanopia];
  for (const vision of visions) {
    for (let i = 0; i < LIVERIES.length; i++) {
      for (let j = i + 1; j < LIVERIES.length; j++) {
        // Two liveries with different patterns are told apart by the pattern,
        // so the colour only has to carry the difference when the shapes are
        // the same. That is the whole reason for having patterns.
        if (LIVERIES[i].pattern !== LIVERIES[j].pattern) continue;
        const d = perceptualDistance(
          simulate(LIVERIES[i].colour, vision),
          simulate(LIVERIES[j].colour, vision),
        );
        if (d < threshold) {
          out.push({
            a: LIVERIES[i].name, b: LIVERIES[j].name, vision: VISION_NAMES[vision], distance: d,
          });
        }
      }
    }
  }
  return out;
}

/**
 * The semantic colours, which are a harder case than the liveries.
 *
 * Free, busy, congested and jammed are green, amber, orange and red — the one
 * scheme every guide on the subject names as the worst possible choice for a
 * deuteranope. It is used anyway, because it is also the scheme every player
 * already knows, and the resolution is that these four are *always* ordered:
 * they appear on a scale where position carries the meaning and hue only
 * confirms it. What must not happen is two of them landing on the same colour,
 * so this checks that they at least stay ordered by lightness — which is what
 * survives when the hue does not.
 */
export function semanticOrderHolds(): { vision: string; ok: boolean; lightness: number[] }[] {
  const scale: RGB[] = [SEMANTIC.free, SEMANTIC.busy, SEMANTIC.congested, SEMANTIC.jammed];
  const visions: Vision[] = [Vision.Normal, Vision.Protanopia, Vision.Deuteranopia, Vision.Tritanopia];
  return visions.map((vision) => {
    const lightness = scale.map((c) => toLab(simulate(c, vision))[0]);
    let ok = true;
    for (let i = 1; i < lightness.length; i++) {
      // Monotone in either direction is fine; what is not fine is a fold,
      // where two rungs of the ladder end up at the same height.
      if (Math.abs(lightness[i] - lightness[i - 1]) < 4) ok = false;
    }
    return { vision: VISION_NAMES[vision], ok, lightness };
  });
}

/** Does every livery have a pattern that some other livery does not share,
 *  or a partner it is distinguished from by colour alone? */
export function patternsCarryIdentity(maxCompanies: number): boolean {
  const seen = new Map<number, number>();
  for (let i = 0; i < Math.min(maxCompanies, LIVERIES.length); i++) {
    const p = LIVERIES[i].pattern;
    seen.set(p, (seen.get(p) ?? 0) + 1);
  }
  // With the colour removed entirely, two companies sharing a pattern are
  // indistinguishable. Four companies is what art-direction.md calls
  // comfortable, and the pattern set has to cover at least that many.
  for (const count of seen.values()) if (count > 1) return false;
  return true;
}
