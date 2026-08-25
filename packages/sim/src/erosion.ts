/**
 * Erosion. The difference between noise and landscape.
 *
 * The heightfield out of `landField` is fractal noise — several octaves of it,
 * masked and weighted carefully — and it makes a region that is unmistakably
 * *generated*. Everything is rounded. Ridges are humps, valleys are dents, and
 * water sits wherever the noise happens to dip rather than anywhere it would
 * actually run. It reads, in a word, viscous: like something that was poured.
 *
 * The reason is that real ground is not a random field. It is a random field
 * that has had a hundred thousand years of water and gravity applied to it,
 * and almost everything the eye recognises as landscape is the *residue* of
 * that process rather than the noise underneath. Two passes recover most of
 * it, and neither is expensive:
 *
 *   Stream power — water flows downhill, collects, and cuts in proportion to
 *   how much of it there is and how steeply it is going. This is the one that
 *   matters. It carves a branching valley network out of an undifferentiated
 *   lump, and a branching valley network is the single strongest cue that a
 *   piece of ground is real. It also produces the thing a transport game most
 *   needs: valleys are the natural routes, so the map starts arguing about
 *   where a line should go before anybody has drawn one.
 *
 *   Talus — rock will not stand steeper than its angle of repose, so material
 *   above that angle falls. This sharpens ridges into ridges rather than
 *   swells, flattens valley floors into something you could build on, and puts
 *   scree at the foot of steep ground.
 *
 * Determinism: this runs once at worldgen and writes back into the Int16
 * heightfield, so nothing here is in the simulation's state. It still has to
 * agree exactly between clients, so it uses only the IEEE-754 operations that
 * are exactly specified — add, subtract, multiply, divide, sqrt — and never
 * `Math.pow`, which is not.
 */

/** Neighbour offsets, eight-way. Diagonals matter: a four-way flow field
 *  produces valleys that run north-south and east-west and nothing else, which
 *  looks worse than no erosion at all. */
const NX = [-1, 0, 1, -1, 1, -1, 0, 1];
const NY = [-1, -1, -1, 0, 0, 1, 1, 1];
/** Reciprocal distance to each, so a diagonal step is not treated as a step of
 *  one. Written out rather than computed, because 1/sqrt(2) is a constant. */
const NR = [
  0.70710678118654752, 1, 0.70710678118654752,
  1, 1,
  0.70710678118654752, 1, 0.70710678118654752,
];

export interface ErosionSettings {
  /** How hard the water cuts. The single most visible number here. */
  incision: number;
  /** The steepest slope rock will hold, in height units per tile. */
  talus: number;
  /** How many talus passes. Three is enough to settle; more only rounds. */
  talusPasses: number;
  /** Nothing below this is touched — the sea has no rivers in it. */
  seaLevel: number;
  /** A ceiling on how much any one cell may be cut, as a fraction of its
   *  height above the sea. Without it a single high-flow cell can be cut to
   *  the waterline and punch a hole through a ridge. */
  maxCut: number;
}

export const DEFAULT_EROSION: ErosionSettings = {
  incision: 0.34,
  talus: 42,
  talusPasses: 3,
  seaLevel: 0,
  maxCut: 0.20,
};

/**
 * Cut valleys into a heightfield and let the steep ground fall.
 *
 * Modifies `height` in place. Cells at or below sea level are left alone
 * entirely, which is what keeps a coastline where the coast generator put it.
 */
export function erode(
  height: Int16Array, size: number, settings: ErosionSettings = DEFAULT_EROSION,
): void {
  const n = size * size;

  /*
   * Flow accumulation, by processing cells from the top down.
   *
   * Every cell sends its water to its steepest downhill neighbour, and because
   * the cells are visited in descending order of height, a cell always
   * receives everything upstream of it before it passes anything on. That is
   * the whole algorithm, and it is one sort and one sweep rather than the
   * thousands of simulated raindrops the technique is usually written with.
   */
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // Sort by height, tallest first. Ties broken by index so the result does not
  // depend on the sort's stability, which is not something to rely on across
  // engines when two clients have to agree.
  const heights = height;
  const sorted = Array.from(order).sort((a, b) => {
    const d = heights[b] - heights[a];
    return d !== 0 ? d : a - b;
  });

  const flow = new Float64Array(n).fill(1);
  const downhill = new Int32Array(n).fill(-1);
  const slope = new Float64Array(n);

  for (let k = 0; k < n; k++) {
    const i = sorted[k];
    const h = heights[i];
    if (h <= settings.seaLevel) continue;
    const x = i % size;
    const y = (i / size) | 0;
    let best = -1;
    let bestDrop = 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + NX[d];
      const ny = y + NY[d];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      // Gradient, not raw difference: a diagonal neighbour is further away.
      const drop = (h - heights[j]) * NR[d];
      if (drop > bestDrop) {
        bestDrop = drop;
        best = j;
      }
    }
    if (best < 0) continue;
    downhill[i] = best;
    slope[i] = bestDrop;
    flow[best] += flow[i];
  }

  /*
   * Incision: cut each cell by the stream power passing through it.
   *
   * The classic form is K·Aᵐ·Sⁿ. Taking m as a half and n as one turns the
   * area term into a square root and the slope term into a plain multiply,
   * which is both the conventional choice and — conveniently — the only one
   * that avoids `Math.pow` and stays bit-exact between machines.
   */
  const cut = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const h = heights[i];
    if (h <= settings.seaLevel || downhill[i] < 0) continue;
    const power = Math.sqrt(flow[i]) * slope[i];
    const limit = (h - settings.seaLevel) * settings.maxCut;
    const amount = settings.incision * power;
    cut[i] = amount < limit ? amount : limit;
  }
  for (let i = 0; i < n; i++) {
    if (cut[i] <= 0) continue;
    const next = heights[i] - cut[i];
    heights[i] = next > settings.seaLevel ? Math.round(next) : settings.seaLevel + 1;
  }

  /*
   * Talus: nothing stands steeper than its angle of repose.
   *
   * Applied after the water rather than before, because its job here is partly
   * to tidy up after it — stream power leaves cliff edges on the sides of the
   * channels it cuts, and left alone they read as terracing. Moving half the
   * excess rather than all of it converges without oscillating between a pair
   * of cells that keep handing the same material back and forth.
   */
  const delta = new Float64Array(n);
  for (let pass = 0; pass < settings.talusPasses; pass++) {
    delta.fill(0);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const h = heights[i];
        if (h <= settings.seaLevel) continue;
        // Find the lowest neighbour, and shed only towards that one: shedding
        // to all of them at once flattens a ridge from both sides at once and
        // erases it, which is the opposite of what this pass is for.
        let lowest = -1;
        let biggest = settings.talus;
        for (let d = 0; d < 8; d++) {
          const nx = x + NX[d];
          const ny = y + NY[d];
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const j = ny * size + nx;
          if (heights[j] <= settings.seaLevel) continue;
          const diff = (h - heights[j]) * NR[d];
          if (diff > biggest) {
            biggest = diff;
            lowest = j;
          }
        }
        if (lowest < 0) continue;
        const move = (biggest - settings.talus) * 0.5;
        delta[i] -= move;
        delta[lowest] += move;
      }
    }
    for (let i = 0; i < n; i++) {
      if (delta[i] === 0) continue;
      const next = heights[i] + delta[i];
      heights[i] = next > settings.seaLevel ? Math.round(next) : settings.seaLevel + 1;
    }
  }
}
