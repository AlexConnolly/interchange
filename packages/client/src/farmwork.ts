/**
 * Tractors, out working the fields.
 *
 * "I'd really love to see farmers out in fields in their tractors" — and the
 * honest answer to how hard it is turned out to be *not very*, because almost
 * all of it already existed. The ambient traffic knows how to route along roads
 * and take corners as arcs; the fleet knows how to draw an instanced vehicle
 * with lamps and smooth its motion; the fields know where they are. A tractor is
 * those three things plus one new idea, which is what to do once it has left the
 * road.
 *
 * That new idea is the whole of this file: a tractor drives out of a farm, along
 * the lanes, turns off into a field, works it **up and down in furrows**, and
 * drives home. The furrows are the part that matters. A tractor parked in a
 * field is a prop; a tractor working across a field in straight passes is the
 * most recognisable thing in English agriculture, and it is a boustrophedon over
 * a bounding box — twenty lines of arithmetic.
 *
 * No gates and no farm tracks. The suggestion was there and then withdrawn in
 * the same breath, rightly: a lane to every field would double the road network
 * and halve the countryside, and a tractor that simply drives off the road and
 * across the grass looks exactly like one using a gateway you cannot see.
 * Nothing about it needs modelling.
 *
 * Dependencies are deliberately not checked. A tractor works whichever arable
 * field is near a farm, regardless of who owns what or what is growing — because
 * the point of it is that the district looks worked, and a correctness rule
 * nobody can see is a rule that only costs.
 */

/** How many are out at once across the district. */
const TRACTORS = 7;

/** How far a tractor will travel from its farm, in tiles. */
const REACH = 26;

export interface FarmField {
  parcel: number;
  /** Tile bounds, inclusive. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** The road tile it is reached from, and the point just inside the gateway. */
  road: number;
  entryX: number;
  entryZ: number;
}

export interface FarmworkWorld {
  size: number;
  /** Farms, by the tile their lane meets the road. */
  farms: () => { tile: number; x: number; z: number }[];
  fields: () => FarmField[];
  usable: (tile: number) => boolean;
  route: (from: number, to: number) => number[];
}

type Phase = 'idle' | 'out' | 'entering' | 'working' | 'leaving' | 'home';

interface Tractor {
  phase: Phase;
  /** Seconds left of whatever it is doing, for the phases that are timed. */
  wait: number;
  /** Road path, and where along it. */
  path: number[];
  leg: number;
  t: number;
  /** The field it is going to, and the farm it came from. */
  field: FarmField | null;
  farmTile: number;
  /** Furrow progress: which pass, and how far along it. */
  pass: number;
  passes: number;
  along: number;
  /** True when the furrows run along X rather than Z. */
  lengthwise: boolean;
  /** Where it is and which way it faces, so a phase change does not teleport. */
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export class Farmwork {
  private readonly tractors: Tractor[] = [];
  private readonly world: FarmworkWorld;
  private seed = 0x1f2e3d4c;
  private fieldsCache: FarmField[] = [];
  private farmsCache: { tile: number; x: number; z: number }[] = [];
  private age = 0;

  constructor(world: FarmworkWorld) {
    this.world = world;
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) | 0;
    return ((this.seed >>> 8) & 0xffff) / 0x10000;
  }

  private pick<T>(list: T[]): T | undefined {
    return list.length === 0 ? undefined : list[Math.floor(this.rnd() * list.length) % list.length];
  }

  /**
   * Send a tractor out, or leave it in the yard.
   *
   * Farm first and then a field near *that* farm, rather than a field and then
   * the nearest farm — because a tractor should belong to a farm, and picking
   * the field first would occasionally send one across the district past three
   * other farms to reach it.
   */
  private dispatch(t: Tractor): boolean {
    const farm = this.pick(this.farmsCache);
    if (!farm) return false;
    const near = this.fieldsCache.filter((f) => {
      const cx = (f.x0 + f.x1) / 2;
      const cz = (f.z0 + f.z1) / 2;
      return Math.hypot(cx - farm.x, cz - farm.z) < REACH;
    });
    const field = this.pick(near);
    if (!field) return false;
    const path = this.world.route(farm.tile, field.road);
    if (path.length < 3) return false;

    t.farmTile = farm.tile;
    t.field = field;
    t.path = path;
    t.leg = 1;
    t.t = 0;
    t.phase = 'out';
    t.speed = 0.55 + this.rnd() * 0.25;
    // Which way the furrows run: along the longer side, so a field is worked in
    // few long passes rather than many short ones. Which is both what happens and
    // what looks purposeful.
    t.lengthwise = (field.x1 - field.x0) >= (field.z1 - field.z0);
    const across = t.lengthwise ? field.z1 - field.z0 + 1 : field.x1 - field.x0 + 1;
    t.passes = Math.max(2, Math.min(14, Math.round(across / 0.9)));
    t.pass = 0;
    t.along = 0;
    return true;
  }

  /** A point on the current furrow, and the direction of travel along it. */
  private furrow(t: Tractor): { x: number; z: number; dx: number; dz: number } {
    const f = t.field as FarmField;
    // Inset by a third of a tile: a tractor does not drive through the hedge,
    // and the headland it leaves is a real thing you can see in a worked field.
    const IN = 0.34;
    const lo = t.lengthwise ? f.x0 + IN : f.z0 + IN;
    const hi = t.lengthwise ? f.x1 + 1 - IN : f.z1 + 1 - IN;
    const sLo = t.lengthwise ? f.z0 + IN : f.x0 + IN;
    const sHi = t.lengthwise ? f.z1 + 1 - IN : f.x1 + 1 - IN;

    const step = t.passes > 1 ? (sHi - sLo) / (t.passes - 1) : 0;
    const side = sLo + step * t.pass;
    // Alternate direction each pass, which is what makes it a boustrophedon and
    // not a series of unexplained returns to the same end of the field.
    const back = t.pass % 2 === 1;
    const from = back ? hi : lo;
    const to = back ? lo : hi;
    const at = from + (to - from) * t.along;
    const dir = back ? -1 : 1;
    return t.lengthwise
      ? { x: at, z: side, dx: dir, dz: 0 }
      : { x: side, z: at, dx: 0, dz: dir };
  }

  /**
   * Advance every tractor and write them into the render source's vehicle
   * arrays, after whatever is already there.
   *
   * Same arrays as the fleet and the traffic, so a tractor gets instanced
   * drawing, headlamps at dusk, motion smoothing and engine sound without any of
   * those systems knowing tractors exist.
   */
  step(
    dt: number, model: number, n0: number,
    vx: Float32Array, vz: Float32Array, vHeading: Float32Array,
    vLivery: Uint8Array, vModel: Uint8Array, vId: Int32Array,
  ): number {
    // The lists change only as influence grows, so once a second is plenty.
    this.age -= dt;
    if (this.age <= 0) {
      this.fieldsCache = this.world.fields();
      this.farmsCache = this.world.farms();
      this.age = 1.5;
    }
    if (this.fieldsCache.length === 0 || this.farmsCache.length === 0) return n0;

    const { size } = this.world;
    let n = n0;
    while (this.tractors.length < TRACTORS) {
      this.tractors.push({
        /*
         * Out almost at once, spread over a second and a half.
         *
         * The first figure was up to six seconds, which meant a district with no
         * tractors in it for the whole of the time a player spends looking at it
         * for the first time. The spread still matters — seven tractors leaving
         * seven farms on the same frame is a convoy — but it only has to be long
         * enough that they do not move in lockstep.
         */
        phase: 'idle', wait: this.rnd() * 1.5, path: [], leg: 1, t: 0,
        field: null, farmTile: -1, pass: 0, passes: 4, along: 0,
        lengthwise: true, x: 0, z: 0, heading: 0, speed: 0.6,
      });
    }

    for (let i = 0; i < this.tractors.length; i++) {
      const t = this.tractors[i];

      switch (t.phase) {
        case 'idle':
          t.wait -= dt;
          // A dispatch can fail on the first frame or two, before influence has
          // been resolved and while there is nothing usable to drive to. Try
          // again shortly rather than treating it as a permanent verdict.
          if (t.wait <= 0 && !this.dispatch(t)) t.wait = 2;
          // Nothing to draw: it is in the yard, behind the farm buildings.
          continue;

        case 'out':
        case 'home': {
          if (t.path.length < 3) { t.phase = 'idle'; t.wait = 8; continue; }
          t.t += dt * t.speed * 1.6;
          while (t.t >= 1) {
            t.t -= 1;
            t.leg++;
            if (t.leg >= t.path.length - 1) {
              if (t.phase === 'out') {
                t.phase = 'entering';
                t.t = 0;
              } else {
                t.phase = 'idle';
                /*
                 * A rest, but not a long one.
                 *
                 * The first figures — twenty-five to ninety-five seconds — meant
                 * that with five tractors there was usually *none* in view, and a
                 * feature you cannot see is one that may as well not be there.
                 * Seven tractors resting eight to thirty seconds keeps two or
                 * three out at any moment, which is a working district rather
                 * than either an empty one or a rally.
                 */
                t.wait = 8 + this.rnd() * 26;
              }
              break;
            }
          }
          if (t.phase !== 'out' && t.phase !== 'home') continue;
          const leg = Math.max(1, Math.min(t.leg, t.path.length - 2));
          const here = t.path[leg];
          if (!this.world.usable(here)) { t.phase = 'idle'; t.wait = 10; continue; }
          // The same per-tile quadratic Bézier the traffic uses, so a tractor
          // takes a corner the way everything else does.
          const cx = (here % size) + 0.5;
          const cz = ((here / size) | 0) + 0.5;
          const px = (t.path[leg - 1] % size) + 0.5;
          const pz = ((t.path[leg - 1] / size) | 0) + 0.5;
          const nx = (t.path[leg + 1] % size) + 0.5;
          const nz = ((t.path[leg + 1] / size) | 0) + 0.5;
          const u = t.t;
          const v = 1 - u;
          const inX = (px + cx) / 2;
          const inZ = (pz + cz) / 2;
          const outX = (cx + nx) / 2;
          const outZ = (cz + nz) / 2;
          const bx = v * v * inX + 2 * v * u * cx + u * u * outX;
          const bz = v * v * inZ + 2 * v * u * cz + u * u * outZ;
          const tx = 2 * v * (cx - inX) + 2 * u * (outX - cx);
          const tz = 2 * v * (cz - inZ) + 2 * u * (outZ - cz);
          const tl = Math.hypot(tx, tz) || 1;
          t.x = bx + (-tz / tl) * 0.16;
          t.z = bz + (tx / tl) * 0.16;
          t.heading = (Math.atan2(tx / tl, -tz / tl) / (Math.PI * 2) + 1) % 1;
          break;
        }

        case 'entering':
        case 'leaving': {
          const f = t.field;
          if (!f) { t.phase = 'idle'; t.wait = 6; continue; }
          const roadX = (f.road % size) + 0.5;
          const roadZ = ((f.road / size) | 0) + 0.5;
          t.t += dt * t.speed * 1.1;
          const entering = t.phase === 'entering';
          const fromX = entering ? roadX : f.entryX;
          const fromZ = entering ? roadZ : f.entryZ;
          const toX = entering ? f.entryX : roadX;
          const toZ = entering ? f.entryZ : roadZ;
          const k = Math.min(1, t.t);
          t.x = fromX + (toX - fromX) * k;
          t.z = fromZ + (toZ - fromZ) * k;
          t.heading = (Math.atan2(toX - fromX, -(toZ - fromZ)) / (Math.PI * 2) + 1) % 1;
          if (t.t >= 1) {
            t.t = 0;
            if (entering) {
              t.phase = 'working';
              t.pass = 0;
              t.along = 0;
            } else {
              // Home the way it came.
              const back = this.world.route(f.road, t.farmTile);
              if (back.length < 3) { t.phase = 'idle'; t.wait = 10; continue; }
              t.path = back;
              t.leg = 1;
              t.phase = 'home';
            }
          }
          break;
        }

        case 'working': {
          const f = t.field;
          if (!f) { t.phase = 'idle'; t.wait = 6; continue; }
          const long = t.lengthwise ? f.x1 - f.x0 + 1 : f.z1 - f.z0 + 1;
          // Along the furrow at the tractor's own speed, so a long field takes
          // longer — which is obvious and is exactly why it has to be right.
          t.along += (dt * t.speed) / Math.max(1, long);
          if (t.along >= 1) {
            t.along = 0;
            t.pass++;
            if (t.pass >= t.passes) {
              t.phase = 'leaving';
              t.t = 0;
              break;
            }
          }
          const at = this.furrow(t);
          t.x = at.x;
          t.z = at.z;
          t.heading = (Math.atan2(at.dx, -at.dz) / (Math.PI * 2) + 1) % 1;
          break;
        }
      }

      if (n >= vx.length) break;
      vx[n] = t.x;
      vz[n] = t.z;
      vHeading[n] = t.heading;
      // A colour per tractor, stable for as long as it is out.
      vLivery[n] = i % 4;
      vModel[n] = model;
      // Below the ambient traffic's negative ids, so nothing can collide.
      vId[n] = -1000 - i;
      n++;
    }
    return n;
  }
}
