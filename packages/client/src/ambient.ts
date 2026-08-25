/**
 * Traffic that is nobody's business.
 *
 * The district had exactly one moving object in it — the player's van — and read
 * as a diorama. "Why is there zero road traffic at all? I feel like the world is
 * unlived in" was exactly right, and it is not a simulation problem: rival
 * hauliers were tried and cut, because with rivals the district changes for
 * reasons that are not yours, which is fatal to a building game (design.md §7).
 *
 * So this is *scenery that moves*. Not in the simulation at all: no economy, no
 * ownership, nothing to synchronise. A couple of dozen cars, vans and lorries go
 * about their business, and the roads look used — which matters for a reason
 * beyond atmosphere. A road with traffic on it reads as a road; an empty one
 * reads as a grey stripe, and the hierarchy the road generator works so hard on
 * is only legible when you can see that more things use the big one.
 *
 * **Every vehicle has somewhere to go.** The first version picked a random road
 * neighbour at each junction, which produced traffic that "just kinda seems to
 * be flying all over the place, hitting places, spinning right around" — and it
 * did, because a random walk on a graph turns back on itself constantly. Now
 * each one picks a *destination* — a business, a village — routes to it with the
 * same road A* the contract preview uses, drives the route, and picks another
 * when it arrives. The path is committed, so it never doubles back, and the
 * difference in how the district reads is out of all proportion to the change.
 *
 * Movement along the path is continuous: the tile behind, the tile ahead, and a
 * fraction between them, with the heading taken from the same vector as the
 * position so the two can never disagree. That last part is what made the
 * *simulated* vehicles jerk — they took position from an interpolation and
 * facing from an eight-way octant table.
 */

/**
 * How many are on the road at once.
 *
 * Twenty-two, down from forty-four. Forty-four was more traffic than a district
 * of three villages could justify: the lanes were busier than the A-road and it
 * read as a city ring road rather than as countryside. Twenty-two puts one or
 * two in shot at any moment, which is what a quiet English valley looks like.
 */
export const AMBIENT_COUNT = 22;

/**
 * How much traffic the *area* justifies, 0..1.
 *
 * Twenty-two vehicles was still far too many, and the reason is that a flat
 * count is the wrong shape: the same number of cars is deserted on a trunk road
 * through a market town and absurd on a farm track. So the count is scaled by
 * what is around the camera — settlements near by, weighted by size, plus a
 * little for the roads themselves.
 *
 * At the opening village it comes out at four or five vehicles in shot, which is
 * a quiet lane in 1985. Round the biggest town it is three times that. Nothing
 * about it is tuned to a target; it is a density, and it reads as one.
 */
export function areaDemand(
  towns: { x: number; y: number; population: number }[],
  x: number, z: number, reach: number,
): number {
  let people = 0;
  for (const t of towns) {
    const d = Math.hypot(t.x - x, t.y - z);
    if (d > reach * 2.2) continue;
    // Falls off with distance: a town ten tiles away puts traffic on your lane,
    // one sixty tiles away does not.
    people += t.population / (1 + (d / Math.max(1, reach)) ** 2);
  }
  // A hamlet is a few hundred; the market town is a couple of thousand.
  return Math.max(0.12, Math.min(1, people / 2600));
}

/**
 * How close is too close, in tiles, and how long a car will wait.
 *
 * A vehicle is about four tenths of a tile long, so seven tenths leaves a small
 * gap rather than a nose-to-tail queue — which at this zoom is the difference
 * between traffic and a car park.
 */
const GAP = 0.7;
const PATIENCE = 3.5;

/**
 * How far ahead a vehicle looks for the junction it is about to enter, and how
 * wide a berth it gives traffic already there.
 *
 * Bigger than `GAP`, because giving way is not the same as not running into the
 * back of something: you have to stop *before* the junction, which means noticing
 * the car on the main road while there is still road left to stop on.
 */
const LOOK_AHEAD = 0.85;
const JUNCTION_BERTH = 0.95;

/** How much faster a car drives when a lorry is filling its mirrors. */
const CHASED = 1.85;

interface Wanderer {
  /** The route it is driving, as tiles, and how far along it is. */
  path: number[];
  /** Index of the tile it has left; it is heading for `leg + 1`. */
  leg: number;
  /** 0..1 between `leg` and the next. */
  t: number;
  /** Tiles a second. Per vehicle, so a line of them is not a rigid comb. */
  speed: number;
  /**
   * Standing behind something, and for how long.
   *
   * Ambient traffic had no idea the other vehicles existed, so it drove through
   * them — most visibly at junctions, where two cars would occupy the same
   * square yard of tarmac. The timer is the important half: a lorry loading at a
   * farm gate sits on the lane indefinitely, and a car that yielded to it
   * forever would be a permanent jam in the middle of the district. After a few
   * seconds it squeezes past, which is worse than a traffic model and far better
   * than a queue that never moves.
   */
  hold: boolean;
  held: number;
  /** A fleet lorry is close behind, so put your foot down. */
  chased: boolean;
  model: number;
  livery: number;
  /** Ticks to wait before setting off again, so arrivals pause like deliveries
   *  rather than turning on a sixpence. */
  dwell: number;
}

export interface AmbientRoads {
  size: number;
  /** True where a vehicle may drive. */
  isRoad: (tile: number) => boolean;
  /**
   * How important this road is. Higher gives way to nobody, lower gives way to
   * higher. `-1` where there is no road at all.
   *
   * This is the whole of the junction model, and it is the real English rule: at
   * an unmarked country crossroads nobody has priority by law, but a lane meeting
   * a B road has a give-way line across it, and every driver in the country
   * behaves accordingly. The road classes already exist, so the rule costs a
   * lookup.
   */
  rank: (tile: number) => number;
  /** False beyond the player's influence, where nothing is drawn. */
  usable: (tile: number) => boolean;
  /** A route along the roads between two tiles, or empty if there is none. */
  route: (from: number, to: number) => number[];
  /** Somewhere worth driving to. Recomputed as influence grows. */
  places: () => number[];
}

export class Ambient {
  private readonly cars: Wanderer[] = [];
  private readonly roads: AmbientRoads;
  private readonly models: number[];
  /** A deterministic stream, so the same district gets the same traffic — one
   *  fewer thing that changes when you look away and back. */
  private seed = 0x9e3779b9;
  /** Destinations, cached: `places()` walks every site and town, and doing that
   *  per vehicle per frame would be the most expensive thing in the file. */
  private places: number[] = [];
  private placesAge = 0;
  /** How busy the area round the camera is, 0..1. Set by the caller. */
  demand = 0.4;

  // Written out rather than declared in the parameter list: the project builds
  // with `erasableSyntaxOnly`, so a constructor parameter property is a syntax
  // error here. Worth four lines to keep the flag on.
  constructor(roads: AmbientRoads, models: number[]) {
    this.roads = roads;
    this.models = models;
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) | 0;
    return ((this.seed >>> 8) & 0xffff) / 0x10000;
  }

  private pick<T>(list: T[]): T | undefined {
    if (list.length === 0) return undefined;
    return list[Math.floor(this.rnd() * list.length) % list.length];
  }

  /**
   * Send a vehicle somewhere.
   *
   * Between two *places* rather than between two road tiles, because a
   * destination that means something is what makes the driving look purposeful.
   * A route that comes back too short is rejected: a car appearing, driving four
   * tiles and stopping is worse than no car.
   */
  private dispatch(w: Wanderer, fromTile: number): boolean {
    for (let attempt = 0; attempt < 6; attempt++) {
      const to = this.pick(this.places);
      if (to === undefined || to === fromTile) continue;
      const path = this.roads.route(fromTile, to);
      // Three tiles minimum for a Bézier; six so a journey is a journey.
      if (path.length < 6) continue;
      w.path = path;
      w.leg = 0;
      w.t = 0;
      w.dwell = 0;
      return true;
    }
    return false;
  }

  /** Start a vehicle from scratch, somewhere near the camera. */
  private spawn(w: Wanderer): boolean {
    const start = this.pick(this.places);
    if (start === undefined) return false;
    /*
     * Half what it was.
     *
     * Everything was "driving way too fast" at one and a half to three tiles a
     * second, which on a camera showing twenty-six tiles is a car crossing the
     * frame in ten seconds — motorway speed on a country lane. Three quarters of
     * a tile to a tile and a half reads as a drive.
     */
    // Half what it was. A car crossing a twenty-six tile frame in twenty seconds
    // is motorway pace on a country lane; forty seconds is a lane.
    w.speed = 0.38 + this.rnd() * 0.35;
    w.model = this.models[Math.floor(this.rnd() * this.models.length) % this.models.length];
    w.livery = Math.floor(this.rnd() * 4) % 4;
    if (!this.dispatch(w, start)) return false;
    // Somewhere along its journey rather than all of them at the start line.
    w.leg = 1 + Math.floor(this.rnd() * Math.max(1, w.path.length - 3));
    return true;
  }

  /**
   * Advance, and write into the render source's vehicle arrays after whatever
   * the caller has already put there. Returns the new count.
   *
   * Writing into the same arrays as the player's fleet is deliberate: to the
   * renderer a lorry is a lorry, and giving traffic its own instancing path
   * would be a second implementation of the same thing.
   */
  step(
    dt: number, nearX: number, nearZ: number, reach: number,
    n0: number,
    vx: Float32Array, vz: Float32Array, vHeading: Float32Array,
    vLivery: Uint8Array, vModel: Uint8Array, vId: Int32Array,
  ): number {
    const { size } = this.roads;
    // Once a second is plenty: the list only changes when influence grows.
    this.placesAge -= dt;
    if (this.placesAge <= 0 || this.places.length === 0) {
      this.places = this.roads.places();
      this.placesAge = 1;
    }
    if (this.places.length < 2) return n0;

    let n = n0;
    // How many the area justifies right now, not a constant.
    const want = Math.max(2, Math.round(AMBIENT_COUNT * this.demand));
    while (this.cars.length < AMBIENT_COUNT) {
      this.cars.push({
        path: [], leg: 0, t: 0, speed: 2, model: 0, livery: 0, dwell: 0,
        hold: false, held: 0, chased: false,
      });
    }

    for (let i = 0; i < this.cars.length; i++) {
      // Beyond what the area supports, park the rest. Kept in the list rather
      // than destroyed so driving into a town and out again does not churn.
      if (i >= want) { this.cars[i].path = []; continue; }
      const w = this.cars[i];
      if (w.path.length < 2 && !this.spawn(w)) continue;

      if (w.hold) {
        // Held up behind whatever is in front. Nothing else changes: the
        // position below is recomputed from an unchanged `t`, so it stands
        // exactly still rather than creeping.
        w.held += dt;
        if (w.held > PATIENCE) { w.hold = false; w.held = 0; }
      } else if (w.dwell > 0) {
        w.dwell -= dt;
      } else {
        w.held = 0;
        /*
         * Get a move on when a lorry is right behind.
         *
         * The fleet cannot be asked to give way. It is simulated on a graph whose
         * state is hashed and covered by a determinism test, and feeding it the
         * positions of client-side scenery would make the simulation depend on
         * what is being drawn — which is the one coupling this codebase does not
         * allow anywhere. So the yielding is all on this side: hold when the
         * fleet is in front, and pull away when it is behind. Between the two
         * there is very little left for a lorry to drive into.
         */
        w.t += dt * w.speed * (w.chased ? CHASED : 1);
        while (w.t >= 1) {
          w.t -= 1;
          w.leg++;
          // One short of the end: `leg` indexes the tile a curve is drawn
          // *inside*, and the last tile has no outgoing edge to curve toward.
          if (w.leg >= w.path.length - 2) {
            // Arrived. Stand for a moment, then go somewhere else — starting
            // from where it actually is, so journeys chain into a working day
            // rather than teleporting between unrelated trips.
            const here = w.path[w.path.length - 1];
            if (!this.dispatch(w, here)) { w.path = []; break; }
            w.dwell = 0.8 + this.rnd() * 3.5;
            break;
          }
        }
      }
      if (w.path.length < 3) continue;

      /*
       * Corners are arcs, not pivots.
       *
       * Interpolating straight between tile centres means the direction of
       * travel changes in a single frame at every junction, and the vehicle
       * spins on the spot — "I hate that things turn on the spot". Easing the
       * *heading* did not fix it, because the position was still turning
       * instantly and the body was merely late.
       *
       * A quadratic Bézier per tile fixes it exactly. The curve inside tile *k*
       * runs from the midpoint of the edge it came in on, through the tile
       * centre as the control point, to the midpoint of the edge it leaves by.
       * On a straight run those three points are collinear, so it *is* a
       * straight line and costs nothing; at a corner it is a proper arc through
       * the junction. And because the heading comes from the curve's own
       * derivative, position and facing cannot disagree at any point along it.
       *
       * `leg` therefore indexes a *tile* now rather than an edge, which is why
       * the path needs three tiles rather than two.
       */
      const leg = Math.max(1, Math.min(w.leg, w.path.length - 2));
      const here = w.path[leg];
      if (!this.roads.usable(here)) { w.path = []; continue; }

      const cx = (here % size) + 0.5;
      const cz = ((here / size) | 0) + 0.5;
      const px = (w.path[leg - 1] % size) + 0.5;
      const pz = ((w.path[leg - 1] / size) | 0) + 0.5;
      const nx2 = (w.path[leg + 1] % size) + 0.5;
      const nz2 = ((w.path[leg + 1] / size) | 0) + 0.5;

      // Out of sight: park it and let it be reused nearer the camera.
      if (Math.abs(cx - nearX) > reach * 1.5
        || Math.abs(cz - nearZ) > reach * 1.5) { w.path = []; continue; }
      if (n >= vx.length) break;

      const u = w.dwell > 0 ? 1 : w.t;
      const inX = (px + cx) / 2;
      const inZ = (pz + cz) / 2;
      const outX = (cx + nx2) / 2;
      const outZ = (cz + nz2) / 2;
      const v = 1 - u;
      const bx = v * v * inX + 2 * v * u * cx + u * u * outX;
      const bz = v * v * inZ + 2 * v * u * cz + u * u * outZ;
      // The tangent, which is the heading and also which way "left" is.
      const tx = 2 * v * (cx - inX) + 2 * u * (outX - cx);
      const tz = 2 * v * (cz - inZ) + 2 * u * (outZ - cz);
      const tl = Math.hypot(tx, tz) || 1;

      /*
       * Keep to the left. It is 1985 in England.
       *
       * A sixth of a tile off the centreline, perpendicular to travel — which
       * also means two vehicles passing do so on the correct sides, for free,
       * with no traffic model at all. Taken from the curve's normal rather than
       * the edge direction, so the offset follows the vehicle round the bend
       * instead of jumping sides at the apex.
       */
      const atX = bx + (-tz / tl) * 0.16;
      const atZ = bz + (tx / tl) * 0.16;
      /*
       * Anything close in front? Then stop, next frame.
       *
       * Only the vehicles already written this frame are visible here — the
       * fleet, and the ambient cars with a lower index — which is exactly the
       * right asymmetry: the one behind gives way and the one in front carries
       * on, and two cars can never both yield to each other and deadlock. It
       * also means scenery yields to the player's lorries rather than the other
       * way round, which is the correct order of precedence for scenery.
       *
       * "In front" is a dot product against the direction of travel, not a plain
       * distance. Without it a car would brake for the vehicle it had just
       * overtaken, and for the one coming the other way on the far side of the
       * lane.
       */
      const fx = tx / tl;
      const fz = tz / tl;
      // The point it is about to drive into, which is where a give-way decision
      // has to be made rather than at the bumper.
      const aheadX = atX + fx * LOOK_AHEAD;
      const aheadZ = atZ + fz * LOOK_AHEAD;
      const mine = this.roads.rank(here);
      /*
       * Only give way when actually joining a better road.
       *
       * Without this the test fires on any vehicle that happens to be within a
       * tile of the look-ahead point — including one on a trunk road running
       * *parallel* to the lane, a tile away, which is not a junction and never
       * requires anybody to stop. The result would be a car that halts, waits out
       * its patience, drives on, halts again: a stutter all the way down the
       * road, caused by a rule that was right about priority and wrong about
       * where priority applies.
       */
      const joining = this.roads.rank(w.path[leg + 1]) > mine;
      w.hold = false;
      w.chased = false;
      for (let k = 0; k < n; k++) {
        const gx = vx[k] - atX;
        const gz = vz[k] - atZ;
        const near = gx * gx + gz * gz;
        const infront = gx * fx + gz * fz;
        // Something close in front: stop behind it.
        if (near <= GAP * GAP && infront > 0.08) { w.hold = true; break; }
        /*
         * Give way to the major road.
         *
         * Applied regardless of who was written first, which the plain
         * following rule above deliberately is not: a lane must always wait for
         * the B road, not merely when the index order happens to fall that way.
         * It cannot deadlock, because the test is strictly asymmetric — only the
         * lower-ranked vehicle ever holds.
         */
        const theirs = this.roads.rank(
          ((vz[k] | 0) * size + (vx[k] | 0)) | 0,
        );
        if (joining && theirs > mine) {
          const jx = vx[k] - aheadX;
          const jz = vz[k] - aheadZ;
          if (jx * jx + jz * jz <= JUNCTION_BERTH * JUNCTION_BERTH) {
            w.hold = true;
            break;
          }
        }
        // A lorry closing from behind. Not a reason to stop — a reason to move.
        if (near <= GAP * GAP * 2.6 && infront < -0.08 && vId[k] >= 0) {
          w.chased = true;
        }
      }
      vx[n] = atX;
      vz[n] = atZ;
      // Heading in turns, matching the simulation: 0 is north (-Z), increasing
      // clockwise. From the curve's own tangent, so the two cannot disagree.
      vHeading[n] = (Math.atan2(tx / tl, -tz / tl) / (Math.PI * 2) + 1) % 1;
      vLivery[n] = w.livery;
      vModel[n] = w.model;
      // Negative ids, so the renderer's smoothing keys these apart from the
      // player's vehicles and no id can ever collide.
      vId[n] = -1 - i;
      n++;
    }
    return n;
  }
}
