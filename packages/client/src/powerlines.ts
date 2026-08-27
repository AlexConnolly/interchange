/**
 * Power lines across the district, from the seed.
 *
 * The grid comes from somewhere else and goes somewhere else. That one sentence
 * decides everything here: a line **enters at one edge of the map and leaves at
 * another**, it does not begin or end at anything, and it serves nothing the
 * player owns. It is the most ordinary landscape feature there is — you have
 * driven under ten thousand of them and never once looked — and putting it in is
 * the difference between a countryside and a diorama of a countryside.
 *
 * Old-school American timber poles rather than lattice pylons, and that is a
 * scale decision as much as a style one. A steel pylon is a landmark, and a
 * landmark in a district whose tallest building is a farmhouse would dominate
 * everything; a wooden pole is furniture. See `pole()` in `art/build_props.py`.
 *
 * ## Why the step length never varies
 *
 * The renderer draws scatter as instanced geometry: one mesh, many transforms,
 * and no per-instance shape. So a span of wire cannot be stretched to fit an
 * arbitrary gap — it is a fixed mesh exactly one gap long. Which means the layout
 * has to guarantee that every gap *is* one gap long, and it does: a step is
 * always `SPAN` units at some angle, never a tile-to-tile hop, so a diagonal is
 * the same length as a straight and one span mesh fits the whole district.
 *
 * That constraint turned out to be a gift. Fixed-length steps at free angles is
 * exactly how a real line is surveyed — straight runs with occasional angles at a
 * bend pole — where a grid walk would have given staircases.
 *
 * ## The edge of the map is not the edge of the land
 *
 * "Connecting to the edges of the map" was the ask, and taken literally it laid
 * nothing at all: measured, the generated district is an *island*, so every point
 * on the map boundary is sea and every line began in the water and was refused.
 *
 * So a line starts at the outermost dry ground on its bearing and runs until it
 * can go no further, which on an island means shore to shore. That is the same
 * thing in spirit and better in fact — the wires still arrive from off the map and
 * leave at the other side, and where they stop is a coast rather than an arbitrary
 * grid boundary. What comes ashore in 1985 is somebody else's problem.
 *
 * ## Repeatable
 *
 * Everything here comes out of a hash of the world seed and nothing else, so the
 * same seed gives the same lines for ever, and two seeds give different ones.
 * That is the rule for every generated thing in this game and there is no reason
 * a power line should be the exception.
 */

/**
 * How far apart the poles stand, in tiles.
 *
 * Shared with `POLE_SPAN` in `art/build_props.py`, which builds a span of wire
 * exactly this long. It is the one number the model and the layout have to agree
 * on, and if they ever disagree the wires stop meeting the poles — so it is
 * stated in both places with a note pointing at the other.
 */
export const SPAN = 3.0;

/**
 * How high above the pole's foot the wires attach, in world units.
 *
 * The top of the insulators, and shared with `POLE_WIRE_H` in
 * `art/build_props.py`, which derives it from the crossarm rather than guessing
 * at it. The guess is what went wrong the first time: the span was built at
 * `POLE_H - 0.045` and the insulator tops are at `0.628`, so every wire in the
 * district ran 5cm *below* the arm it was supposed to be sitting on — "the cables
 * don't line up correctly on the model itself, they are offset".
 *
 * Two numbers in two languages that have to be equal is a thing to state loudly
 * rather than to hide, so it is stated in both places with a note pointing at the
 * other.
 */
export const WIRE_H = 0.628;

/** A pole, and the direction of the wire leaving it. */
export interface Pole {
  x: number;
  z: number;
  /**
   * Which way the run goes from here, in turns, or -1 at the end of a line.
   *
   * A plain world bearing — `atan2(dz, dx)` over a full turn — because that is
   * what is testable and what the layout means. The renderer's yaw runs the other
   * way round; converting is the client's job, at the point of use.
   *
   * Doubles as "is there a span here": the last pole of a run has a crossarm and
   * no wire leaving it, which is what the edge of the district looks like.
   */
  run: number;
  /** The pole this one's wire reaches, so the span can be aimed at it. Absent on
   *  the last pole of a run. */
  toX?: number;
  toZ?: number;
}

/** What the district needs to be able to tell us. */
export interface PowerWorld {
  size: number;
  /** Height at a tile, so a line can be kept out of the water. */
  height: (tile: number) => number;
  /** Is a town centre near this point? Lines go round settlements, not through. */
  builtUp: (x: number, z: number) => boolean;
}

/**
 * A hash, not a generator.
 *
 * The same shape used by the tree scatter and by `World.mix`: pure, so any part
 * of the layout can be recomputed without replaying the ones before it, which is
 * what makes a bug here findable.
 */
function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * How many lines cross a district.
 *
 * Three, and sometimes four. Two was the first answer and it was too few for a
 * reason that only showed up on screen: the influence area is a fraction of the
 * district, so most of any line is fogged, and two lines across a 128-tile map
 * left a good chance that a player could look at their own farm for an hour
 * without a pole in sight. Measured on the opening district, 37 of 219 poles were
 * unfogged and none of them were near the opening view.
 *
 * Three is also simply truer. A parish has more than two lines crossing it. Five
 * would start to look like a substation, and there isn't one.
 */
function lineCount(seed: number): number {
  return hash(seed, 8101) < 0.4 ? 4 : 3;
}

/**
 * Where a line enters and leaves: two points on two *different* edges.
 *
 * Different edges, always, because a line that comes in and goes out of the same
 * side has doubled back and no longer reads as passing through. Opposite sides
 * most of the time and adjacent sometimes, which is the difference between a line
 * that crosses the map and one that clips a corner of it — both happen in life.
 */
function ends(seed: number, i: number, size: number): {
  ax: number; az: number; bx: number; bz: number;
} {
  const m = size - 1;
  // A little in from the corners: a line arriving exactly at a corner leaves at
  // an angle that looks surveyed rather than inherited.
  const along = (r: number): number => size * 0.12 + r * size * 0.76;
  const side = Math.floor(hash(seed, 1700 + i * 31) * 4);
  const opposite = hash(seed, 1900 + i * 17) < 0.72;
  const other = opposite ? (side + 2) % 4 : (side + 1 + Math.floor(hash(seed, 2100 + i) * 2) * 2) % 4;
  const at = (which: number, r: number): { x: number; z: number } => {
    const t = along(r);
    if (which === 0) return { x: t, z: 0 };
    if (which === 1) return { x: m, z: t };
    if (which === 2) return { x: t, z: m };
    return { x: 0, z: t };
  };
  const a = at(side, hash(seed, 2300 + i * 13));
  const b = at(other, hash(seed, 2500 + i * 7));
  return { ax: a.x, az: a.z, bx: b.x, bz: b.z };
}

/**
 * The outermost dry ground on the way in from an edge point.
 *
 * The district is an island, so an edge point is sea and a line starting there is
 * refused before it takes a step. Marching inward until the ground comes up gives
 * the shore, which is where a line arriving from off the map would actually make
 * landfall.
 *
 * Bounded, because a bearing that runs the length of a bay would otherwise walk to
 * the middle of the district and start a line from nowhere in particular.
 */
function landfall(
  world: PowerWorld, x: number, z: number, towardX: number, towardZ: number,
): { x: number; z: number } | null {
  const size = world.size;
  const len = Math.hypot(towardX - x, towardZ - z);
  if (len < 1) return null;
  const ux = (towardX - x) / len;
  const uz = (towardZ - z) / len;
  for (let step = 0; step <= 16; step++) {
    const px = x + ux * step * SPAN;
    const pz = z + uz * step * SPAN;
    const tx = Math.floor(px);
    const tz = Math.floor(pz);
    if (tx < 0 || tz < 0 || tx >= size || tz >= size) continue;
    if (world.height(tz * size + tx) > 0) return { x: px, z: pz };
  }
  return null;
}

/**
 * Lay the poles out.
 *
 * A greedy walk from one edge to the other: at each pole, take the heading that
 * points at the far end, and if the pole would land somewhere it has no business
 * being — water, a town — turn until it would not. Angles are quantised to
 * sixteenths of a turn, which is what gives the straight runs and decisive bends
 * of a surveyed line rather than a wandering curve.
 *
 * The turning happens in two passes, and the reason is in the step itself: a
 * narrow fan keeps runs straight, and a full sweep when the narrow fan is blocked
 * keeps the line out of the lake. Both are needed — measured with the narrow fan
 * alone, four per cent of poles across sixty seeds stood in water.
 */
export function powerLines(world: PowerWorld, seed: number): Pole[] {
  const size = world.size;
  const out: Pole[] = [];
  const wet = (x: number, z: number): boolean => {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= size || tz >= size) return true;
    return world.height(tz * size + tx) <= 0;
  };

  /**
   * One attempt at a crossing, or null if it could not get there.
   *
   * Returning null rather than a half-line is the whole of the water fix, and it
   * took a measurement to see why. The first version stepped straight ahead when
   * every heading was blocked - reasoning that an awkward pole beats a line that
   * gives up - and on the real district that put 38 of 292 poles in water. The
   * breakdown is what gave it away: 34 of them were *mid-run*, which cannot
   * happen from one bad step. Once a line is forced into a lake it is surrounded
   * by lake, so every following step is blocked too and it swims to the far shore.
   *
   * One forced step does not cost one pole, it costs the rest of the line. So
   * there are no forced steps: the attempt fails, and the caller tries again on a
   * different bearing.
   */
  const attempt = (
    ax: number, az: number, bx: number, bz: number,
  ): Pole[] | null => {
    const line: Pole[] = [];
    let x = ax;
    let z = az;
    if (wet(x, z)) return null;
    /*
     * A step bound rather than "until it arrives". The diagonal is `size *
     * sqrt(2)`, so a crossing cannot honestly want more steps than that over the
     * span with a margin for bends - and without the bound, a walk that gets
     * cornered loops until something else stops it, which in a frame loop is the
     * frame.
     */
    const most = Math.ceil((size * 1.8) / SPAN) + 6;
    const quantum = (Math.PI * 2) / 16;
    for (let n = 0; n < most; n++) {
      const left = Math.hypot(bx - x, bz - z);
      /*
       * Near enough the far edge is the end of the line, and that is the point of
       * it: the wires are supposed to leave. The last pole keeps its crossarm and
       * drops its span, so a run stops at a pole rather than in mid-air.
       */
      if (left <= SPAN * 1.1) {
        line.push({ x, z, run: -1 });
        return line;
      }
      const base = Math.round(Math.atan2(bz - z, bx - x) / quantum);
      const clear = (off: number): { x: number; z: number } | null => {
        const a = (base + off) * quantum;
        const tx = x + Math.cos(a) * SPAN;
        const tz = z + Math.sin(a) * SPAN;
        if (wet(tx, tz)) return null;
        if (world.builtUp(tx, tz)) return null;
        return { x: tx, z: tz };
      };
      /*
       * Two passes, and the order of them is the whole character of the line.
       *
       * The first is narrow - straight on, then a sixteenth either side, then two
       * - because the look of these depends on long straight runs, and a line that
       * swings ninety degrees to dodge a pond is a line that wanders.
       *
       * The second happens only when the narrow fan is completely blocked, and
       * sweeps outward to a quarter turn either side. That is the difference
       * between skirting an obstacle and walking into it: with the narrow fan
       * alone, four per cent of poles across sixty seeds stood in water. A wide
       * turn taken only when cornered still reads as a bend pole rather than as a
       * wander.
       */
      let at: { x: number; z: number } | null = null;
      for (const off of [0, 1, -1, 2, -2]) {
        at = clear(off);
        if (at) break;
      }
      for (let off = 3; off <= 8 && !at; off++) {
        at = clear(off) ?? clear(-off);
      }
      /*
       * Nowhere to go. On an island that is usually the far shore, which is a
       * perfectly good end to a line — so a run that has already crossed a decent
       * stretch is kept and simply ends here. A short one is a line that got
       * cornered in a bay two poles from where it started, and that is litter.
       */
      if (!at) {
        if (line.length >= 8) {
          line[line.length - 1].run = -1;
          return line;
        }
        return null;
      }
      line.push({
        x,
        z,
        run: (Math.atan2(at.z - z, at.x - x) / (Math.PI * 2) + 1) % 1,
        toX: at.x,
        toZ: at.z,
      });
      x = at.x;
      z = at.z;
      if (x < 0 || z < 0 || x > size - 1 || z > size - 1) {
        line[line.length - 1].run = -1;
        return line;
      }
    }
    return null;
  };

  for (let i = 0; i < lineCount(seed); i++) {
    /*
     * Several bearings tried, first one that crosses wins.
     *
     * Because a refusal to walk into water means an attempt can genuinely fail,
     * and a district with a big lake or a long coast will fail a few. Four goes
     * at different pairs of edge points is enough to get a crossing nearly always
     * without the layout becoming a search - and if all four fail, that line
     * simply is not there, which is better than a line through the sea.
     */
    let laid: Pole[] | null = null;
    for (let go = 0; go < 4 && !laid; go++) {
      const e = ends(seed, i * 4 + go, size);
      const a = landfall(world, e.ax, e.az, e.bx, e.bz);
      const b = landfall(world, e.bx, e.bz, e.ax, e.az);
      if (!a || !b) continue;
      laid = attempt(a.x, a.z, b.x, b.z);
      // And the other way round, because a walk is not symmetrical: it can get
      // out of a bay it could not get into.
      if (!laid) laid = attempt(b.x, b.z, a.x, a.z);
    }
    /*
     * A run of one or two poles is not a power line, it is litter.
     */
    if (laid && laid.length >= 4) {
      laid[laid.length - 1].run = -1;
      out.push(...laid);
    }
  }
  return out;
}
