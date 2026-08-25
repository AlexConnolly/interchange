/**
 * When each house puts its light on, and what colour the bulb is.
 *
 * Every building in the district decides two hours for itself — when it lights
 * up and when it goes to bed — and one in ten never bothers at all. All of it is
 * derived from the building's own position and the world seed, so nothing is
 * stored and nothing is random: the same village lights up the same way every
 * time you play it.
 *
 * That reproducibility is the point rather than a convenience. A village where
 * the pattern of lit windows changed every evening would read as *flickering*;
 * one where the same cottage always goes dark at half past eleven reads as
 * somebody who goes to bed early. The information is identical — the difference
 * is entirely that it repeats.
 *
 * And the same hash warms or cools the bulb a little, so no two windows in a
 * street are quite the same colour. Together those two things do more for a
 * night frame than another hundred triangles anywhere would: the pattern of
 * *which* windows are lit is the only thing on screen that suggests the district
 * has people in it rather than buildings.
 */

/** Warm tungsten, before each house varies it. Matches WINDOW in build_places.py. */
const BULB: [number, number, number] = [1.0, 0.72, 0.34];

/**
 * A stable value in 0..1 from a position and a salt.
 *
 * Positions are tile coordinates so they are small integers, and the seed makes
 * two districts generated differently light up differently. Multiplying by large
 * odd constants and xor-folding is the cheapest hash that does not show its
 * structure — an earlier version used `sin(x * 12.9898)` and neighbouring houses
 * came out in visible diagonal stripes, because that trick correlates badly on a
 * lattice, which is exactly what a tile grid is.
 */
function hash(x: number, z: number, seed: number, salt: number): number {
  let h = (Math.round(x * 64) * 374761393
    + Math.round(z * 64) * 668265263
    + seed * 1274126177
    + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1103515245;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

export interface Evening {
  /** Fraction of the day the lights come on, and the fraction they go off. */
  on: number;
  off: number;
  /** Never lights up at all: an empty cottage, or somebody away. */
  dark: boolean;
  /** The bulb, varied a little from the standard warm. */
  colour: [number, number, number];
}

/**
 * Decide a building's evening, once.
 *
 * The windows are `0.52..0.66` — a spread of about a fortieth of the day, which
 * at four real minutes a day is six seconds of village lighting up one house at
 * a time, and that staggering is most of what makes it read as people rather
 * than as a switch. Bedtimes run `0.88..1.04`, so some go dark before midnight
 * and some burn past it, which needs the wrap-around test in `isLit`.
 *
 * The figures are anchored on the sun: dusk falls around 0.54 and dawn comes up
 * around 0.96, so a house lighting up at 0.52 is switching on just as the light
 * goes, and one still lit at 1.04 is up before dawn.
 */
export function eveningFor(x: number, z: number, seed: number): Evening {
  const dark = hash(x, z, seed, 7) < 0.10;
  const on = 0.52 + hash(x, z, seed, 11) * 0.14;
  const off = 0.88 + hash(x, z, seed, 13) * 0.16;
  // Warmer or cooler by a few per cent, and the green channel moves most: that
  // is the axis a tungsten bulb actually varies along as it ages, and it is the
  // one the eye reads as "warmer" rather than as "a different colour".
  const warm = hash(x, z, seed, 17);
  const colour: [number, number, number] = [
    BULB[0],
    BULB[1] * (0.86 + warm * 0.24),
    BULB[2] * (0.72 + warm * 0.52),
  ];
  return { on, off, dark, colour };
}

/**
 * Is it lit, at this point in the day?
 *
 * The wrap is the whole subtlety. A bedtime past 1.0 means the light is on
 * either side of midnight, so the test cannot be a simple range check — and
 * getting it wrong shows up as one cottage in ten being lit all day, which is
 * far more obvious than it sounds.
 */
export function isLit(e: Evening, dayFraction: number): boolean {
  if (e.dark) return false;
  const t = dayFraction;
  if (e.off > 1) return t >= e.on || t < e.off - 1;
  return t >= e.on && t < e.off;
}

/**
 * How brightly, allowing a moment to come on.
 *
 * A window that snaps to full in one frame reads as a bug; a couple of seconds
 * of fade reads as somebody reaching for a switch. The ramp is in *day*
 * fractions so it takes the same wall-clock time however long a day is.
 */
export function litness(e: Evening, dayFraction: number): number {
  if (!isLit(e, dayFraction)) return 0;
  const RAMP = 0.006;
  let since = dayFraction - e.on;
  if (since < 0) since += 1;
  return Math.min(1, since / RAMP);
}
