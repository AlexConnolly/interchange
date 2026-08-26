/**
 * Animals in the fields, moving.
 *
 * The district had sheep and cattle already and they were part of the scatter —
 * the same layer as the trees and the hay bales, which is to say nailed down. A
 * field of livestock that never moves reads as a field of ornaments, and it is
 * the one thing in a pastoral landscape that has no business being still: a cow
 * shifts a few yards an hour and it is *always* one of the things moving.
 *
 * ## How it draws
 *
 * Through the vehicle arrays, the same trick `farmwork.ts` uses for tractors.
 * Anything written into those gets instanced drawing, motion smoothing and the
 * renderer's own easing for nothing, and none of those systems has to learn that
 * animals exist. The cost of a grazing cow is therefore the same as the cost of a
 * lorry, which is very close to nothing.
 *
 * ## How it moves
 *
 * Not by pathfinding, and not by wandering freely either. Each animal is tied to
 * an *anchor* — a grass tile it belongs to — and picks little targets within a
 * tile or two of it, standing still for long stretches in between. That is what
 * grazing looks like from a distance: a slow drift with pauses, in a bounded
 * patch, and a herd that stays a herd because its members share an anchor rather
 * than because anything is steering them.
 *
 * The one hard rule is that they stay off the roads. A cow standing in the lane
 * is funny once and then it is a bug, so every target is tested before it is
 * accepted and a refused target simply means standing still a bit longer.
 */

/** What the client has to be able to tell us about a tile. */
export interface GrazingWorld {
  size: number;
  /** Grass, no road, not water, and inside what the player can see. */
  grazeable: (tile: number) => boolean;
  usable: (tile: number) => boolean;
  /** Which model draws a sheep, and which a cow. */
  sheepModel: number;
  cattleModel: number;
}

/**
 * How many animals are out at once.
 *
 * They share the vehicle arrays with the fleet, the traffic and the tractors, so
 * this is a budget rather than a wish. Forty-eight is four or five decent groups
 * on screen, which at the zoom this game is played at is a countryside with
 * stock in it rather than a zoo.
 */
const ANIMALS = 48;

/** Tiles a second, while walking. A cow ambles; nothing here is in a hurry. */
const WALK = 0.085;

/** How far from its anchor an animal will stray. */
const ROAM = 1.8;

interface Beast {
  /** The grass tile it belongs to. */
  anchor: number;
  x: number;
  z: number;
  /** Where it is heading, and how long until it thinks again. */
  tx: number;
  tz: number;
  wait: number;
  heading: number;
  cattle: boolean;
}

export class Grazing {
  private readonly world: GrazingWorld;
  private readonly beasts: Beast[] = [];
  /** Grass tiles worth standing in, sampled coarsely. Rebuilt as sight grows. */
  private anchors: number[] = [];
  private age = 0;

  constructor(world: GrazingWorld) {
    this.world = world;
  }

  /**
   * A coarse sample of the grass, not every tile of it.
   *
   * Every fourth tile in each direction, which is a few hundred anchors for a
   * district instead of tens of thousands, and is plenty: an anchor is only the
   * middle of a patch an animal wanders around, so missing three quarters of the
   * candidates costs nothing anybody can see.
   */
  private findAnchors(camX: number, camZ: number): void {
    const { size } = this.world;
    const out: number[] = [];
    const x0 = Math.max(1, Math.floor(camX - 40));
    const x1 = Math.min(size - 2, Math.ceil(camX + 40));
    const z0 = Math.max(1, Math.floor(camZ - 40));
    const z1 = Math.min(size - 2, Math.ceil(camZ + 40));
    for (let z = z0; z <= z1; z += 4) {
      for (let x = x0; x <= x1; x += 4) {
        const t = z * size + x;
        if (!this.world.grazeable(t) || !this.world.usable(t)) continue;
        out.push(t);
      }
    }
    this.anchors = out;
  }

  /** Put one animal somewhere sensible, or leave it where it is. */
  private settle(b: Beast, seed: number): void {
    if (this.anchors.length === 0) return;
    const t = this.anchors[(seed * 7919) % this.anchors.length];
    const { size } = this.world;
    b.anchor = t;
    b.x = (t % size) + 0.5 + (Math.random() - 0.5) * 0.7;
    b.z = Math.floor(t / size) + 0.5 + (Math.random() - 0.5) * 0.7;
    b.tx = b.x;
    b.tz = b.z;
    b.wait = Math.random() * 8;
  }

  step(
    dt: number, camX: number, camZ: number, n0: number,
    vx: Float32Array, vz: Float32Array, vHeading: Float32Array,
    vLivery: Uint8Array, vModel: Uint8Array, vId: Int32Array,
  ): number {
    // The grass does not move, so once every couple of seconds is plenty.
    this.age -= dt;
    if (this.age <= 0 || this.anchors.length === 0) {
      this.findAnchors(camX, camZ);
      this.age = 2;
    }
    if (this.anchors.length === 0) return n0;

    const { size } = this.world;
    while (this.beasts.length < ANIMALS) {
      const b: Beast = {
        anchor: -1, x: 0, z: 0, tx: 0, tz: 0, wait: 0, heading: 0,
        /*
         * Two thirds sheep, because there are more sheep than cattle in England
         * and a field of both in equal numbers looks like a petting zoo.
         *
         * By index rather than by coin toss. A toss gives the right *average* and
         * no guarantee about any particular herd, which made a test asserting
         * "mostly sheep" fail about once in every few hundred runs — an assertion
         * that is usually true is worse than none, because the failure teaches
         * nobody anything. Counting instead makes the mix exact and means a field
         * does not reshuffle its livestock between one look and the next.
         */
        cattle: this.beasts.length % 3 === 0,
      };
      this.settle(b, this.beasts.length + 1);
      this.beasts.push(b);
    }

    let n = n0;
    for (let i = 0; i < this.beasts.length; i++) {
      const b = this.beasts[i];
      if (n >= vx.length - 1) break;

      /*
       * Off screen, or somewhere that has stopped being grass — a road was laid
       * through it, a field was ploughed — and it moves to a new patch. Silently,
       * because it is off screen: an animal that is visible is never relocated,
       * which is the difference between a herd wandering and a herd teleporting.
       */
      const here = Math.floor(b.z) * size + Math.floor(b.x);
      const far = Math.abs(b.x - camX) > 46 || Math.abs(b.z - camZ) > 46;
      if (far || !this.world.grazeable(here) || !this.world.usable(here)) {
        if (far) this.settle(b, i + Math.floor(camX) + Math.floor(camZ) * 31);
        else b.wait = 0.1;
        if (far) continue;
      }

      if (b.wait > 0) {
        b.wait -= dt;
      } else {
        const dx = b.tx - b.x;
        const dz = b.tz - b.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.05) {
          /*
           * Arrived: stand about, then pick somewhere else close by.
           *
           * Long pauses on purpose. An animal that is always walking looks like
           * it is going somewhere, and grazing is the opposite of going
           * somewhere — most of a cow's day is spent standing in one place with
           * its head down.
           */
          b.wait = 4 + Math.random() * 16;
          const ax = (b.anchor % size) + 0.5;
          const az = Math.floor(b.anchor / size) + 0.5;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * ROAM;
          const nx = ax + Math.cos(a) * r;
          const nz = az + Math.sin(a) * r;
          // Only if it is still grass there, and never onto a road.
          const nt = Math.floor(nz) * size + Math.floor(nx);
          if (this.world.grazeable(nt)) {
            b.tx = nx;
            b.tz = nz;
          }
        } else {
          /*
           * Test the step, not just the destination.
           *
           * Checking only the target tile is not enough and a test caught it
           * within seconds: an animal on one side of a lane, offered a perfectly
           * good patch of grass on the other side, walks straight *through* the
           * road to reach it. Both ends of the journey were grass; the middle was
           * tarmac.
           *
           * So each step is validated before it is taken, and a refused step ends
           * the journey where it stands — which is also what an animal does when
           * it reaches a fence.
           */
          const step = Math.min(d, WALK * dt);
          const nx = b.x + (dx / d) * step;
          const nz = b.z + (dz / d) * step;
          if (this.world.grazeable(Math.floor(nz) * size + Math.floor(nx))) {
            b.x = nx;
            b.z = nz;
            // Models are authored nose along +X, like everything else that moves.
            b.heading = Math.atan2(-dz, dx);
          } else {
            b.tx = b.x;
            b.tz = b.z;
            b.wait = 3 + Math.random() * 8;
          }
        }
      }

      vx[n] = b.x;
      vz[n] = b.z;
      vHeading[n] = b.heading;
      vLivery[n] = 0;
      vModel[n] = b.cattle ? this.world.cattleModel : this.world.sheepModel;
      /*
       * A stable id, offset well clear of anything else that uses these arrays.
       *
       * The renderer keys its motion smoothing on this: reuse an id the fleet or
       * the traffic is using and two unrelated things ease toward each other's
       * positions across the district.
       */
      vId[n] = 900000 + i;
      n++;
    }
    return n;
  }
}
