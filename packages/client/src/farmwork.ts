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

import { FARM_LIVERY, FARM_PAINT_FROM } from '@interchange/render';

/** How many are out at once across the district. */
const TRACTORS = 7;

/** How far a tractor will travel from its farm, in tiles. */
const REACH = 26;

/**
 * The headland: how far inside the boundary the worked ground starts.
 *
 * One constant, because two functions need it and they had a copy each — the
 * furrow that runs up the field and the turn at the end of it. A turn that used a
 * different figure from the furrow it was joining put the tractor through the
 * hedge by a tenth of a tile, which is the kind of disagreement that only exists
 * because the number was written down twice.
 *
 * Wide enough that `TURN_BULGE` fits inside it, which is what stops the turn
 * leaving the field, and which is also why a real headland is as wide as it is.
 */
const HEADLAND = 0.42;

/** How far out of the furrow the turn loops. Must stay under `HEADLAND`. */
const TURN_BULGE = 0.36;

/**
 * Where on the machine the work actually happens, in tiles from its centre.
 *
 * Measured off the models: a plough or a drill toolbar sits about a fifth of a
 * tile behind the tractor, and a combine's header about a third of one in front.
 */
const IMPLEMENT_BEHIND = 0.20;
const HEADER_AHEAD = 0.30;

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
  /** A pass has been made over this tile. Turn it over, drill it, cut it. */
  work: (tile: number) => void;
  /** Is there a job to do on this tile? Used to choose where to send one. */
  needsWork: (tile: number) => boolean;
  /** How important a road is, so a tractor knows when to wait at the end of a
   *  farm lane. `-1` where there is no road. */
  rank: (tile: number) => number;
  /** Which machine the job on this tile calls for. */
  job: (tile: number) => Job;
}

/** What is out in the field, which decides both the model and the speed. */
export type Job = 'plough' | 'drill' | 'combine' | 'mow' | 'spray' | 'none';

/** Which model index draws each machine. Filled in by the client, which is the
 *  only place that knows what order the models were loaded in. */
export interface Machines {
  plough: number;
  drill: number;
  sprayer: number;
  combine: number;
}

type Phase = 'idle' | 'out' | 'entering' | 'working' | 'turning' | 'leaving' | 'home';

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
  /**
   * What it is out to do, decided when it is dispatched and kept for the visit.
   *
   * Fixed at dispatch rather than read per frame, and that is deliberate: the
   * machine changes the field as it goes, so a job re-derived each frame would
   * flip to `spray` under the tractor's own wheels the moment it had turned over
   * the tile it was standing on — and the model drawn would change from a plough
   * to a sprayer halfway down the first furrow.
   */
  job: Job;
  /** Furrow progress: which pass, and how far along it. */
  pass: number;
  passes: number;
  along: number;
  /** 0..1 through a headland turn between one pass and the next. */
  turn: number;
  /**
   * The gate run: start, finish, and the gateway in between.
   *
   * Held explicitly rather than derived, because both ends have to be *exactly*
   * the position the neighbouring phase hands over or takes over at, and the two
   * neighbours are different kinds of thing — a Bézier along a lane at one end, a
   * furrow head at the other. Every time one of these was recomputed instead of
   * remembered, the two disagreed by half a tile and the tractor slid.
   */
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** True when the furrows run along X rather than Z. */
  lengthwise: boolean;
  /** The last tile it turned over, so it is not asked again every frame. */
  lastTile: number;
  /** Held up behind something on the lane, and for how long. */
  hold: boolean;
  waited: number;
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
  /**
   * Which fields already have a machine on them or on the way, by parcel.
   *
   * Nothing used to stop two machines being sent to the same field. With seven of
   * them and only a handful of fields wanting work in a given week, that happened
   * constantly — and the second one to arrive drove the whole field towing a
   * plough over ground the first had already turned over. Which is exactly what
   * "a tractor going over ground it has supposedly ploughed and hasn't" is: the
   * machine was real, the work was real, and it had been done an hour earlier by
   * somebody else.
   *
   * A map from field to *which machine holds it*, not a set of fields, and the
   * difference is a bug I wrote and caught: a claim nobody owns can be released
   * by anybody. Two machines that had each visited the same field at some point
   * both thought the release was theirs to make, so one working machine had its
   * field freed under it and a second was sent straight in.
   */
  private readonly claimed = new Map<number, number>();
  /**
   * How many more tractors may start out already in a field.
   *
   * Only spent at the beginning. After that a tractor that wants a field drives
   * to it, because by then there is someone watching the lanes.
   */
  private opening = Math.ceil(TRACTORS / 2);

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
  private dispatch(t: Tractor, alreadyThere = false): boolean {
    const farm = this.pick(this.farmsCache);
    if (!farm) return false;
    const near = this.fieldsCache.filter((f) => {
      const cx = (f.x0 + f.x1) / 2;
      const cz = (f.z0 + f.z1) / 2;
      return Math.hypot(cx - farm.x, cz - farm.z) < REACH;
    });
    /*
     * A field with work in it, if there is one.
     *
     * Otherwise the tractors of the district potter about in finished fields
     * while the one that needs cutting stands ripe for a fortnight. `needsWork`
     * is asked at the field's gateway tile, which is inside the parcel, so one
     * question settles it for the whole field.
     */
    const mine = this.tractors.indexOf(t);
    const free = near.filter((f) => {
      const holder = this.claimed.get(f.parcel);
      return holder === undefined || holder === mine;
    });
    const wanting = free.filter((f) => this.world.needsWork(
      Math.floor(f.entryZ) * this.world.size + Math.floor(f.entryX),
    ));
    /*
     * Somewhere with a job, or failing that somewhere with a crop to spray.
     *
     * Never a field with nothing on it and nothing to do: that is where the
     * sprayer-on-bare-earth came from. If neither list has anything in it the
     * machine simply stays in the yard, which is what a farm does in a quiet
     * week.
     */
    const idle = free.filter((f) => this.world.job(
      Math.floor(f.entryZ) * this.world.size + Math.floor(f.entryX),
    ) !== 'none');
    const field = this.pick(wanting.length > 0 ? wanting : idle);
    if (!field) return false;
    // A tractor already in its field still needs a way home, so the route is
    // required either way. Nothing else would notice until it tried to leave.
    const path = this.world.route(farm.tile, field.road);
    if (path.length < 3) return false;

    this.release(t);
    this.claimed.set(field.parcel, mine);
    t.farmTile = farm.tile;
    /*
     * It starts at the farm, and saying so matters.
     *
     * A tractor that is held up on the very first frame of its journey never
     * reaches the code that computes a position, so whatever was in `x` and `z`
     * is what gets drawn — and for a tractor that has never moved that is the
     * corner of the map.
     */
    t.x = farm.x;
    t.z = farm.z;
    t.hold = false;
    t.waited = 0;
    t.field = field;
    // Or the first tile change in the new field also works a tile in the old
    // one, which may be half the district away.
    t.lastTile = -1;
    t.path = path;
    t.leg = 1;
    t.t = 0;
    t.phase = 'out';
    t.job = this.world.job(
      Math.floor(field.entryZ) * this.world.size + Math.floor(field.entryX),
    );
    /*
     * A combine moves through a crop faster than a plough moves through soil,
     * and a sprayer faster than either. Not a detail: the machine and its pace
     * are the same observation, and a combine crawling like a plough looks
     * wrong before you have worked out why.
     */
    const pace = t.job === 'combine' ? 1.25 : t.job === 'spray' ? 1.5 : 1;
    // Half, with the same district-wide slowdown as the roads. The relative paces
    // are kept: a combine still moves through a crop faster than a plough through
    // soil, both of them at half of what they were.
    t.speed = (0.28 + this.rnd() * 0.13) * pace;
    // Which way the furrows run: along the longer side, so a field is worked in
    // few long passes rather than many short ones. Which is both what happens and
    // what looks purposeful.
    t.lengthwise = (field.x1 - field.x0) >= (field.z1 - field.z0);
    const across = t.lengthwise ? field.z1 - field.z0 + 1 : field.x1 - field.x0 + 1;
    t.passes = Math.max(2, Math.min(14, Math.round(across / 0.9)));
    t.pass = 0;
    t.along = 0;
    t.turn = 0;
    /*
     * Some of them start out in the field rather than driving to it.
     *
     * Without this the district is empty for the first half minute of every
     * session, because seven tractors all begin in their yards and a field is
     * twenty tiles of lane away. The opening shot is the one every player sees
     * and most of them judge the game on, and it should be of a worked
     * countryside — so half the tractors begin mid-furrow, at a random pass,
     * exactly as if they had been out since breakfast. Which, in the fiction,
     * they have.
     */
    if (alreadyThere) {
      t.phase = 'working';
      t.pass = Math.floor(this.rnd() * t.passes);
      t.along = this.rnd();
      const at = this.furrow(t);
      t.x = at.x;
      t.z = at.z;
      t.heading = (Math.atan2(at.dx, -at.dz) / (Math.PI * 2) + 1) % 1;
    }
    return true;
  }

  /**
   * Where a tractor is on its road path, for a given leg and progress.
   *
   * Pulled out of the driving phase so the gate run can ask the same question and
   * get the same answer. The whole class of bug in this file has been two pieces
   * of code computing the same position two ways.
   */
  private roadPoint(t: Tractor, leg: number, u: number): { x: number; z: number } {
    const { size } = this.world;
    const at = Math.max(1, Math.min(leg, t.path.length - 2));
    const cx = (t.path[at] % size) + 0.5;
    const cz = ((t.path[at] / size) | 0) + 0.5;
    const px = (t.path[at - 1] % size) + 0.5;
    const pz = ((t.path[at - 1] / size) | 0) + 0.5;
    const nx = (t.path[at + 1] % size) + 0.5;
    const nz = ((t.path[at + 1] / size) | 0) + 0.5;
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
    return { x: bx + (-tz / tl) * 0.16, z: bz + (tx / tl) * 0.16 };
  }

  /**
   * The headland turn between one furrow and the next.
   *
   * This is the fix for "it looks like some of the tractors are drifting". They
   * were: at the end of a pass the position jumped sideways by one furrow spacing
   * — up to a tile — and the renderer, seeing a jump too small to be a teleport,
   * dutifully eased across it. So the tractor slid sideways across the field
   * while still facing along the furrow, which is exactly what drifting looks
   * like. The bug was not in the smoothing; it was that a real tractor does not
   * arrive at the next furrow, it *drives* there.
   *
   * So it does. Out past the end of the field, across by one spacing, and back in
   * facing the other way — a loop on the headland, which is both what happens and
   * the most recognisable thing a tractor does all day. The bulge is what makes it
   * a turn rather than a slide: without it the path is a straight line sideways
   * and we are back where we started.
   */
  private headland(t: Tractor): { x: number; z: number } {
    const f = t.field as FarmField;
    const lo = t.lengthwise ? f.x0 + HEADLAND : f.z0 + HEADLAND;
    const hi = t.lengthwise ? f.x1 + 1 - HEADLAND : f.z1 + 1 - HEADLAND;
    const sLo = t.lengthwise ? f.z0 + HEADLAND : f.x0 + HEADLAND;
    const sHi = t.lengthwise ? f.z1 + 1 - HEADLAND : f.x1 + 1 - HEADLAND;
    const step = t.passes > 1 ? (sHi - sLo) / (t.passes - 1) : 0;

    // The end it is turning at: the far end of the pass just finished.
    const finishedBack = t.pass % 2 === 1;
    const at = finishedBack ? lo : hi;
    // Which way is "out of the field" from there.
    const outward = finishedBack ? -1 : 1;

    const k = Math.min(1, Math.max(0, t.turn));
    // Across by one spacing, eased so it leaves and rejoins the furrow straight.
    const side = sLo + step * (t.pass + k);
    // And a bulge out past the headland and back, which is the turn.
    const along = at + outward * Math.sin(k * Math.PI) * TURN_BULGE;
    return t.lengthwise ? { x: along, z: side } : { x: side, z: along };
  }

  /**
   * Give up the claim on a field.
   *
   * Called on every route back to `idle`, and dispatch calls it too — belt and
   * braces, because a claim that leaks is a field no machine will ever visit
   * again, and that failure is invisible until somebody notices a field standing
   * in stubble all winter.
   */
  private release(t: Tractor): void {
    if (!t.field) return;
    const mine = this.tractors.indexOf(t);
    if (this.claimed.get(t.field.parcel) === mine) {
      this.claimed.delete(t.field.parcel);
    }
  }

  /** A point on the current furrow, and the direction of travel along it. */
  private furrow(t: Tractor): { x: number; z: number; dx: number; dz: number } {
    const f = t.field as FarmField;
    // Inset by the headland: a tractor does not drive through the hedge, and the
    // strip it leaves round the edge is a real thing you can see in a worked field.
    const lo = t.lengthwise ? f.x0 + HEADLAND : f.z0 + HEADLAND;
    const hi = t.lengthwise ? f.x1 + 1 - HEADLAND : f.z1 + 1 - HEADLAND;
    const sLo = t.lengthwise ? f.z0 + HEADLAND : f.x0 + HEADLAND;
    const sHi = t.lengthwise ? f.z1 + 1 - HEADLAND : f.x1 + 1 - HEADLAND;

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
    dt: number, machines: Machines, n0: number,
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
        lengthwise: true, lastTile: -1, hold: false, waited: 0, job: 'spray',
        turn: 0, fromX: 0, fromZ: 0, toX: 0, toZ: 0,
        x: 0, z: 0, heading: 0, speed: 0.6,
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
          if (t.wait <= 0) {
            const straightToWork = this.opening > 0;
            if (this.dispatch(t, straightToWork)) {
              if (straightToWork) this.opening--;
            } else {
              t.wait = 2;
            }
          }
          // Nothing to draw: it is in the yard, behind the farm buildings.
          continue;

        case 'out':
        case 'home': {
          if (t.path.length < 3) { this.release(t); t.phase = 'idle'; t.wait = 8; continue; }
          /*
           * Held up behind something. Redraw where it already is, and give up
           * after a few seconds — a lorry loading at a farm gate stands on the
           * lane indefinitely, and a tractor that waited for it forever would be
           * a permanent obstruction of its own.
           */
          if (t.hold) {
            t.waited += dt;
            if (t.waited > 3.5) { t.hold = false; t.waited = 0; }
            break;
          }
          t.waited = 0;
          t.t += dt * t.speed * 1.6;
          while (t.t >= 1) {
            t.t -= 1;
            t.leg++;
            if (t.leg >= t.path.length - 1) {
              if (t.phase === 'out') {
                t.phase = 'entering';
                t.t = 0;
                // In through the gate from where it actually is on the road, to
                // the head of furrow zero — which `furrow` gives, because `pass`
                // and `along` are both still zero.
                t.fromX = t.x;
                t.fromZ = t.z;
                const head = this.furrow(t);
                t.toX = head.x;
                t.toZ = head.z;
              } else {
                this.release(t);
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
          if (!this.world.usable(here)) { this.release(t); t.phase = 'idle'; t.wait = 10; continue; }
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
          /*
           * A tractor on a lane gives way to everything.
           *
           * Same rule as the ambient traffic and for the same reason, except that
           * a tractor is the slowest thing on the road and is written into these
           * arrays last — so it yields to the fleet, to the cars and to the other
           * tractors, and nothing yields to it. Which is both convenient and true.
           *
           * Decided *after* moving and acted on next frame, exactly as the ambient
           * traffic does it. The first attempt tried to undo the advance once it
           * had found something in the way, and that is not a rollback: the same
           * advance may already have stepped `leg` on to the next tile of the
           * path, and putting `t` back leaves the two disagreeing. A flag read at
           * the top of the next frame has no such halfway state.
           *
           * Only while it is on the road. In a field it is the only thing there,
           * and a tractor that stopped for its neighbour two furrows over would
           * never finish a pass.
           */
          const fwdX = tx / tl;
          const fwdZ = tz / tl;
          // Where it is about to be, for the give-way test below.
          const peekX = t.x + fwdX * 0.85;
          const peekZ = t.z + fwdZ * 0.85;
          const myRank = this.world.rank(here);
          // Only when actually joining a better road — see the note in
          // `ambient.ts`. A lane running alongside a trunk road is not a
          // junction, and treating it as one makes a vehicle stutter the whole
          // way down it.
          const joining = this.world.rank(t.path[leg + 1]) > myRank;
          t.hold = false;
          for (let k = 0; k < n; k++) {
            const gx = vx[k] - t.x;
            const gz = vz[k] - t.z;
            const infront = gx * fwdX + gz * fwdZ;
            if (gx * gx + gz * gz <= 0.7 * 0.7 && infront > 0.08) {
              t.hold = true;
              break;
            }
            /*
             * And it waits at the end of the farm lane.
             *
             * The one place a tractor genuinely holds up the traffic of England,
             * and the one place it should not: pulling out of a track onto a
             * road without looking. Same rank test the cars use.
             */
            const theirs = this.world.rank(
              ((vz[k] | 0) * size + (vx[k] | 0)) | 0,
            );
            if (joining && theirs > myRank) {
              const jx = vx[k] - peekX;
              const jz = vz[k] - peekZ;
              if (jx * jx + jz * jz <= 0.95 * 0.95) { t.hold = true; break; }
            }
          }
          break;
        }

        case 'entering':
        case 'leaving': {
          const f = t.field;
          if (!f) { this.release(t); t.phase = 'idle'; t.wait = 6; continue; }
          const entering = t.phase === 'entering';
          /*
           * Through the gateway, in two straight runs.
           *
           * A single straight line from the road to the head of the first furrow
           * cuts the corner, and the corner it cuts is somebody else's field: the
           * gate is on one side of the parcel and the furrow starts at a corner of
           * it, so the direct line leaves the field entirely. Two segments with
           * the gateway as the knee keeps a tractor on ground it is entitled to,
           * and looks like what it is — in at the gate, then up to the top of the
           * first run.
           */
          const gateX = f.entryX;
          const gateZ = f.entryZ;
          /*
           * Paced by the distance, not by the segment.
           *
           * `t` running 0..1 over a leg means the leg takes the same *time*
           * however long it is — so the run from the far corner of a big field
           * back to the gate, seven tiles of it, was covered in about a second.
           * Six tiles a second, on a machine whose speed is set to two thirds of
           * one. That is what "some of the tractors are drifting" was: not a
           * teleport and not the smoothing, just a leg of the journey travelling
           * ten times too fast in a dead straight line.
           *
           * Dividing by the length of the segment it is actually on makes one
           * speed mean one speed everywhere.
           */
          const legLen = t.t < 1
            ? Math.hypot(gateX - t.fromX, gateZ - t.fromZ)
            : Math.hypot(t.toX - gateX, t.toZ - gateZ);
          t.t += (dt * t.speed * 1.1) / Math.max(0.35, legLen);
          // In: road → gate → furrow. Out: furrow → gate → road.
          const ax = entering ? t.fromX : t.fromX;
          const az = entering ? t.fromZ : t.fromZ;
          const cx = t.toX;
          const cz = t.toZ;
          let px: number;
          let pz: number;
          let qx: number;
          let qz: number;
          let k: number;
          if (t.t < 1) {
            px = ax; pz = az; qx = gateX; qz = gateZ; k = t.t;
          } else {
            px = gateX; pz = gateZ; qx = cx; qz = cz; k = Math.min(1, t.t - 1);
          }
          t.x = px + (qx - px) * k;
          t.z = pz + (qz - pz) * k;
          if (Math.abs(qx - px) + Math.abs(qz - pz) > 1e-4) {
            t.heading = (Math.atan2(qx - px, -(qz - pz)) / (Math.PI * 2) + 1) % 1;
          }
          if (t.t >= 2) {
            t.t = 0;
            if (entering) {
              /*
               * Ask again, at the gate, what the field actually needs.
               *
               * The answer can have changed since the machine set off: the
               * off-screen catch-up brings fields on a share at a time, and a
               * journey across the district takes the best part of a minute. A
               * machine that arrives to find the job already done should not then
               * drive the whole field towing a plough over ground that will not
               * change — it should be the thing that *does* cross a finished
               * field, which is a sprayer.
               *
               * Asked once, here, and never again. Re-deriving it per frame would
               * flip the model to a sprayer under the machine's own wheels the
               * moment it turned over the tile it was standing on.
               */
              t.job = this.world.job(
                Math.floor(f.entryZ) * size + Math.floor(f.entryX),
              );
              if (t.job === 'none') {
                // Somebody else finished it while this one was on the road, and
                // there is nothing growing to spray. Turn round at the gate.
                this.release(t);
                t.phase = 'idle';
                t.wait = 4;
                continue;
              }
              t.phase = 'working';
              t.pass = 0;
              t.along = 0;
            } else {
              // The route home was planned before the run started, and this run
              // finished exactly where it begins.
              t.phase = 'home';
            }
          }
          break;
        }

        case 'turning': {
          const f = t.field;
          if (!f) { this.release(t); t.phase = 'idle'; t.wait = 6; continue; }
          const across = t.passes > 1
            ? (t.lengthwise ? f.z1 + 1 - f.z0 : f.x1 + 1 - f.x0) / (t.passes - 1)
            : 1;
          // Paced by the distance covered, so a wide spacing takes longer than a
          // narrow one and the tractor moves at one speed all afternoon.
          t.turn += (dt * t.speed) / Math.max(0.5, across + 0.9);
          const was = { x: t.x, z: t.z };
          const at = this.headland(t);
          t.x = at.x;
          t.z = at.z;
          /*
           * Facing wherever it is actually going.
           *
           * Taken from the movement rather than computed, because the turn is an
           * arc and the one thing that must never happen again here is a position
           * and a heading that disagree. If it has barely moved, keep the last
           * heading rather than deriving one from noise.
           */
          const mx = t.x - was.x;
          const mz = t.z - was.z;
          if (mx * mx + mz * mz > 1e-6) {
            t.heading = (Math.atan2(mx, -mz) / (Math.PI * 2) + 1) % 1;
          }
          if (t.turn >= 1) {
            t.pass++;
            t.turn = 0;
            t.along = 0;
            t.phase = 'working';
          }
          break;
        }

        case 'working': {
          const f = t.field;
          if (!f) { this.release(t); t.phase = 'idle'; t.wait = 6; continue; }
          const long = t.lengthwise ? f.x1 - f.x0 + 1 : f.z1 - f.z0 + 1;
          // Along the furrow at the tractor's own speed, so a long field takes
          // longer — which is obvious and is exactly why it has to be right.
          t.along += (dt * t.speed) / Math.max(1, long);
          if (t.along >= 1) {
            t.along = 0;
            if (t.pass + 1 >= t.passes) {
              /*
               * Done. Plan the way home *now*, and aim the gate run at the exact
               * point that route will start from.
               *
               * The road phases put a vehicle on a quadratic through the tile it
               * is in, which begins at the *midpoint of the edge it came in on* —
               * half a tile from the tile's centre. A gate run that finished at
               * the centre therefore handed over half a tile away from where the
               * road phase would pick up, and that mismatch was the last of the
               * sideways slides. Planning the route before the run rather than
               * after it is what makes the two agree.
               */
              const back = this.world.route(f.road, t.farmTile);
              if (back.length < 3) { this.release(t); t.phase = 'idle'; t.wait = 10; continue; }
              t.path = back;
              t.leg = 1;
              t.pass++;
              t.phase = 'leaving';
              t.t = 0;
              t.fromX = t.x;
              t.fromZ = t.z;
              const start = this.roadPoint(t, 1, 0);
              t.toX = start.x;
              t.toZ = start.z;
              break;
            }
            // Round the headland to the next furrow, rather than appearing on it.
            t.phase = 'turning';
            t.turn = 0;
            break;
          }
          const at = this.furrow(t);
          t.x = at.x;
          t.z = at.z;
          t.heading = (Math.atan2(at.dx, -at.dz) / (Math.PI * 2) + 1) % 1;
          /*
           * And the ground under it changes.
           *
           * Only when the tile changes, not every frame: the sim's `workField`
           * is idempotent, but each real change drops a chunk of ground for
           * rebuilding and there is no sense asking sixty times for one answer.
           *
           * One tile, not two. This used to offer the tile behind as well, in case
           * a fast pass skipped one — a real risk when a leg of the journey could
           * cover seven tiles in a second. Now that every phase is paced by
           * distance nothing moves more than four hundredths of a tile in a frame,
           * so a whole tile cannot be jumped, and the second call was doing
           * nothing but asking for ground that had already been worked.
           */
          {
            /*
             * The ground changes under the *working part*, not under the cab.
             *
             * A plough and a drill are dragged behind; a combine's header is slung
             * out in front. Taking the tile under the machine's centre put the
             * change a fifth of a tile away from the thing doing it in both cases
             * — ahead of the plough, behind the header — which at this zoom is a
             * quarter of a machine length and reads as the ground changing on the
             * *line* the tractor is following rather than where it actually is.
             *
             * The forward vector comes from the heading the same way the models
             * are oriented: a heading of `h` turns points along
             * (sin 2*pi*h, -cos 2*pi*h).
             */
            const fwd = t.job === 'combine' ? HEADER_AHEAD : -IMPLEMENT_BEHIND;
            const a = t.heading * Math.PI * 2;
            const wx = t.x + Math.sin(a) * fwd;
            const wz = t.z - Math.cos(a) * fwd;
            const here = Math.floor(wz) * size + Math.floor(wx);
            if (here !== t.lastTile) {
              this.world.work(here);
              t.lastTile = here;
            }
          }
          break;
        }
      }

      if (n >= vx.length) break;
      /*
       * Not drawn outside your influence.
       *
       * "Tractors that are out of frame, like in the fog of war, should not be
       * showing." Quite right, and it is not only a matter of taste: the ground
       * out there is drawn faded, so a tractor at full colour on top of it reads
       * as a rendering fault. It keeps working - the district carries on whether
       * you can see it or not - it just is not shown.
       */
      const onTile = Math.floor(t.z) * size + Math.floor(t.x);
      if (onTile < 0 || onTile >= size * size || !this.world.usable(onTile)) continue;
      vx[n] = t.x;
      vz[n] = t.z;
      vHeading[n] = t.heading;
      // A colour per tractor, stable for as long as it is out.
      /*
       * The colour belongs to the farm, not to the machine.
       *
       * Hashed from the farm's own tile, so a farm's tractor, its drill and its
       * combine are all the same colour and two neighbouring farms are not. That
       * is worth more than variety for its own sake: it is the thing that makes a
       * machine in a field read as belonging to the buildings half a mile away.
       */
      const farm = t.farmTile < 0 ? 0 : t.farmTile;
      vLivery[n] = FARM_PAINT_FROM
        + ((farm * 2654435761) >>> 0) % FARM_LIVERY.length;
      vModel[n] = t.job === 'combine' ? machines.combine
        : t.job === 'drill' ? machines.drill
          : t.job === 'spray' ? machines.sprayer
            : machines.plough;
      // Below the ambient traffic's negative ids, so nothing can collide.
      vId[n] = -1000 - i;
      n++;
    }
    return n;
  }
}
