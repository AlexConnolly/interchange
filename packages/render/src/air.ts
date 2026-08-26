/**
 * The air: mist, smoke and exhaust.
 *
 * Ported from Tribewars' `ambient.ts`, which is where the idea belongs — a
 * valley whose only motion is your own army reads as a diorama, and a district
 * whose only motion is your own lorries reads as a model railway. What fixes it
 * is not more things, it is *continuous* things: something drifting, something
 * rising, something the wind is doing whether or not you are looking.
 *
 * None of it is gameplay and none of it may ever tell you anything. Smoke over a
 * building must not mean the building is working, or it becomes a readout, and a
 * readout that only appears in certain weather is a bad readout.
 *
 * Everything here is pooled and camera-local: one `BufferGeometry` and one draw
 * call per field, particles recycled rather than allocated, and nothing emitted
 * outside the frame. The cost is set by what is on screen and not by how big the
 * district is.
 *
 * ## Point size under an orthographic camera
 *
 * Three's `sizeAttenuation` divides the point size by the view-space depth,
 * which is the correct perspective formula and completely wrong here: this
 * camera is orthographic, so depth has nothing to do with apparent size and a
 * particle would shrink as it moved *away across a flat field*. The sizes below
 * are therefore in **tiles**, converted to pixels once a frame from the zoom —
 * which is exact rather than approximately right, and has the side effect that a
 * bank of mist stays the same size in the world as you zoom into it.
 */

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color,
  NormalBlending, Points, PointsMaterial, Scene, type Texture,
} from 'three';
import { groundHeightAt, type GroundSource } from './ground.ts';

/**
 * A soft round dot, drawn once and shared.
 *
 * A bare `PointsMaterial` draws hard squares. That is survivable for a spark and
 * hopeless for smoke: a column of grey squares reads as a rendering fault, not
 * as a fire. The falloff is deliberately not linear — a linear gradient still
 * has a visible edge where it reaches zero, and the whole job of this texture is
 * that there is no edge anywhere.
 */
let DOT: Texture | null = null;

function softDot(): Texture {
  if (DOT) return DOT;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const x = c.getContext('2d');
  if (x) {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  }
  DOT = new CanvasTexture(c);
  return DOT;
}

/**
 * How a particle moves and how it fades, given its age.
 *
 * `k` is 1 at birth and 0 at death, which is the only clock a particle has. It
 * returns the alpha rather than writing it, because every field wants a
 * different curve and none of them wants to remember which array it lives in.
 */
type Behave = (
  f: FieldArrays, i: number, k: number, dt: number, time: number,
) => number;

interface FieldArrays {
  pos: Float32Array;
  vel: Float32Array;
  seed: Float32Array;
}

/** One pooled cloud of particles. One geometry, one draw call. */
class Field {
  readonly points: Points;

  private readonly pos: Float32Array;

  private readonly vel: Float32Array;

  private readonly life: Float32Array;

  private readonly max: Float32Array;

  private readonly seed: Float32Array;

  private readonly alpha: Float32Array;

  /**
   * Per-particle size, which `PointsMaterial` also does not have.
   *
   * Smoke that does not expand is not smoke, it is a string of beads. A plume
   * widens as it rises because it is cooling and mixing, and that widening is
   * most of what the eye uses to tell smoke from dust — so it is worth the
   * second attribute and the second line of shader.
   */
  private readonly grow: Float32Array;

  private readonly geo: BufferGeometry;

  private readonly mat: PointsMaterial;

  private readonly count: number;

  /** In tiles. Converted to pixels every frame — see the note at the top. */
  private readonly tiles: number;

  private readonly behave: Behave;

  /** How much bigger it gets over its life. Zero for anything that does not
   *  expand — a bird-sized speck of exhaust, or mist, which is already vast. */
  private readonly spread: number;

  private cursor = 0;

  constructor(scene: Scene, o: {
    count: number; tiles: number; colour: string; opacity: number;
    additive?: boolean; behave: Behave; order?: number; spread?: number;
  }) {
    this.count = o.count;
    this.tiles = o.tiles;
    this.behave = o.behave;
    this.spread = o.spread ?? 0;
    this.pos = new Float32Array(o.count * 3);
    this.vel = new Float32Array(o.count * 3);
    this.life = new Float32Array(o.count);
    this.max = new Float32Array(o.count);
    this.seed = new Float32Array(o.count);
    this.alpha = new Float32Array(o.count);
    this.grow = new Float32Array(o.count).fill(1);
    for (let i = 0; i < o.count; i++) this.seed[i] = Math.random() * 6.283;

    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.geo.setAttribute('aSize', new BufferAttribute(this.grow, 1));
    this.mat = new PointsMaterial({
      color: new Color(o.colour),
      size: 1,
      map: softDot(),
      transparent: true,
      opacity: o.opacity,
      depthWrite: false,
      sizeAttenuation: false,
      blending: o.additive === true ? AdditiveBlending : NormalBlending,
    });
    /*
     * Per-particle alpha, which `PointsMaterial` does not have.
     *
     * Without it every particle in a field is equally opaque and they all pop in
     * and out at full strength, which is the single most obvious way a particle
     * system announces itself. Injected rather than written as a ShaderMaterial
     * so the material keeps its fog, its tone mapping and its map handling.
     */
    this.mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute float aAlpha;\nvarying float vAlpha;\n${
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vAlpha = aAlpha;',
        )}`;
      shader.fragmentShader = `varying float vAlpha;\n${
        shader.fragmentShader.replace(
          '#include <premultiplied_alpha_fragment>',
          '  gl_FragColor.a *= vAlpha;\n#include <premultiplied_alpha_fragment>',
        )}`;
    };
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = o.order ?? 3;
    scene.add(this.points);
  }

  /**
   * Put one particle into the world.
   *
   * Round-robin over the pool rather than a free list. A free list is the
   * obvious structure and it is worse here: when the pool is full the oldest
   * particle is exactly the one that should go, and a cursor gives that for
   * nothing while a free list gives an emitter that silently stops emitting.
   */
  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number, life: number, age = 0,
  ): void {
    const i = this.cursor;
    this.cursor = (i + 1) % this.count;
    const j = i * 3;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.vel[j] = vx;
    this.vel[j + 1] = vy;
    this.vel[j + 2] = vz;
    this.life[i] = life * (1 - age);
    this.max[i] = life;
    this.seed[i] = Math.random() * 6.283;
  }

  /** How many are alive. A field that is empty needs priming, not filling. */
  live(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.life[i] > 0) n++;
    return n;
  }

  /** Master opacity, and the pixel size for this zoom. */
  aim(level: number, pixelsPerTile: number): void {
    this.mat.opacity = level;
    this.mat.size = this.tiles * pixelsPerTile;
    this.points.visible = level > 0.004;
  }

  step(dt: number, time: number): void {
    if (!this.points.visible) return;
    const arrays: FieldArrays = { pos: this.pos, vel: this.vel, seed: this.seed };
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      const k = this.life[i] / this.max[i];
      const j = i * 3;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.alpha[i] = this.behave(arrays, i, k, dt, time);
      // Grows as it ages, if the field asked for it. 1 at birth by construction.
      this.grow[i] = 1 + (1 - k) * this.spread;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    if (this.spread > 0) this.geo.attributes.aSize.needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** What the air needs to know about the world, once a frame. */
export interface AirFrame {
  camX: number;
  camZ: number;
  /** Tiles across the frame, for the point size and the emission radius. */
  tilesAcross: number;
  pixelsPerTile: number;
  /** 0 at six in the morning, as the rest of the renderer has it. */
  dayFraction: number;
  night: number;
  snow: number;
  /** 0..1, the global VFX dial. Zero switches the whole thing off. */
  level: number;
  /** How far through the turn, so the leaves know whether to be falling. */
  autumn: number;
  /** Which day it is, so which chimneys are lit changes from one to the next. */
  day: number;
}

/**
 * What the air emits from.
 *
 * Extends `GroundSource` because every emitter needs the ground under the point
 * it is emitting at: mist lies *on* the field, a chimney stands *on* a building,
 * and an exhaust is a foot off the road. Nothing here samples the terrain for
 * any other reason.
 */
export interface AirSource extends GroundSource {
  placeCount: number;
  px: Float32Array;
  pz: Float32Array;
  vehicleCount: number;
  vx: Float32Array;
  vz: Float32Array;
  vHeading: Float32Array;
  vStopped: Uint8Array;
  /**
   * The scatter, because the falling leaves come off the trees in it.
   *
   * This list is already packed and filtered by influence every frame, so a
   * random index into it is a tree that is definitely on screen — which is both
   * the cheapest way to find one and the reason no trees in view means no leaves.
   */
  scatterCount: number;
  sx: Float32Array;
  sz: Float32Array;
  sScale: Float32Array;
  sSheds: Uint8Array;
}

export interface Air {
  step(src: AirSource, frame: AirFrame, dt: number, time: number): void;
  dispose(): void;
}

/**
 * The district's wind: one direction, for everything that drifts.
 *
 * "The particles for the chimneys just burst in a random direction. Wouldn't it
 * be better if they were all going the same world direction?" Yes, and it is the
 * whole difference between smoke and a firework. Each puff was leaning by a sine
 * of *its own* seed, so nine puffs from one chimney set off nine different ways
 * and the plume came apart at the top of the roof.
 *
 * Air does not work like that. Wind is a property of the *place*, so every plume
 * in the district leans the same way at the same moment, and the only thing that
 * should differ between two puffs is a little turbulence about that mean. One
 * shared direction also means the plumes agree with each other across the valley,
 * which is a thing you notice without ever looking at it.
 *
 * West-south-west, because the prevailing wind in England is south-westerly and
 * it costs nothing to be right about that.
 */
const WIND_X = 0.80;
const WIND_Z = -0.38;

/**
 * How much mist there is, given the hour.
 *
 * Radiation fog forms overnight on still clear ground and burns off within an
 * hour or two of the sun getting to it, which in England means it is a thing you
 * see between about four and nine in the morning and at no other time. Modelled
 * as a plateau with a fast edge on the sunny side, because that is the shape of
 * it: it does not fade evenly, it sits there and then it goes.
 *
 * Deliberately not tied to the weather. Fog and rain are close to mutually
 * exclusive in life, but the district's weather changes on a daily seed and
 * tying the two together would mean whole weeks with no mornings in them.
 */
export function mistAt(hour: number): number {
  if (hour < 3 || hour > 10) return 0;
  if (hour < 4) return (hour - 3);
  if (hour < 7.5) return 1;
  return Math.max(0, 1 - (hour - 7.5) / 2.5);
}

export function makeAir(scene: Scene): Air {
  /*
   * Mist, and it is the one that is easy to overdo.
   *
   * Wide, slow, and very faint indeed: the moment you can pick out an individual
   * puff it stops being weather and becomes confetti. Everything about the
   * numbers here is chosen to stop that happening — the sprites are three tiles
   * across so they overlap into a sheet rather than reading as objects, the
   * opacity is under a tenth, and they barely move.
   */
  const mist = new Field(scene, {
    count: 220,
    tiles: 3.2,
    colour: '#dfe7ea',
    opacity: 0.075,
    order: 2,
    behave: (f, i, k, dt, time) => {
      const j = i * 3;
      // On the same wind as the smoke, at a fraction of it: fog on a windy
      // morning is fog that has already gone.
      f.vel[j] += (WIND_X * 0.05 + Math.sin(time * 0.21 + f.seed[i]) * 0.05) * dt;
      f.vel[j + 2] += (WIND_Z * 0.05 + Math.cos(time * 0.17 + f.seed[i]) * 0.05) * dt;
      // In slowly, out slowly, and never at full strength at the edges of its
      // life — a bank of fog has no beginning.
      return Math.min(1, (1 - k) * 4) * Math.min(1, k * 2.2);
    },
  });
  let mistAcc = 0;

  /*
   * Chimney smoke. The oldest trick there is for making a house look lived in,
   * and the reason it works is that it is the only vertical motion in a
   * landscape that is otherwise entirely horizontal.
   *
   * It leans as it rises and slows as it cools, which is two lines and is most
   * of the difference between smoke and a column of dots.
   */
  const smoke = new Field(scene, {
    count: 520,
    tiles: 0.42,
    colour: '#cfd3d2',
    opacity: 0.34,
    // Two and a half times its birth size by the end, which is a plume that
    // opens out rather than a column of identical dots.
    spread: 1.6,
    behave: (f, i, k, dt, time) => {
      const j = i * 3;
      /*
       * Rises, slows, and leans downwind — in that order of importance.
       *
       * The lean builds with age rather than being applied flat, because that is
       * what a plume does: it goes up out of the chimney and bends over as it
       * loses the heat that was driving it. `1 - k` is the age, so the wind gets
       * its say later and the bottom of the plume stays vertical.
       */
      f.vel[j + 1] *= 1 - dt * 0.5;
      const lean = (1 - k) * 1.4 + 0.25;
      f.vel[j] += WIND_X * lean * dt;
      f.vel[j + 2] += WIND_Z * lean * dt;
      /*
       * And a little turbulence, shared rather than per particle.
       *
       * Driven by `time` and by *position along the plume* — the seed only sets
       * where in the wobble this puff sits — so neighbouring puffs move together
       * the way air does, instead of each choosing its own direction.
       */
      const gust = Math.sin(time * 0.9 + f.seed[i] * 0.6);
      f.vel[j] += gust * dt * 0.10;
      f.vel[j + 2] += Math.cos(time * 0.7 + f.seed[i] * 0.6) * dt * 0.10;
      return Math.min(1, (1 - k) * 3.4) * k * k;
    },
  });

  /*
   * Exhaust. Small, dark, brief — a 1985 diesel at the moment it pulls away.
   *
   * Behind the vehicle rather than under it, and that is why the heading is in
   * the source at all. A puff that appears at the centre of a lorry looks like
   * the lorry is on fire; a puff that appears a quarter of a tile behind it and
   * is immediately left behind reads as an exhaust without anyone deciding it
   * has.
   */
  const exhaust = new Field(scene, {
    count: 200,
    tiles: 0.22,
    colour: '#8e9092',
    opacity: 0.34,
    spread: 1.1,
    behave: (f, i, k, dt) => {
      const j = i * 3;
      f.vel[j + 1] *= 1 - dt * 0.9;
      // The same wind, so a lorry's exhaust and the farmhouse chimney behind it
      // agree about which way the air is going.
      f.vel[j] += WIND_X * dt * 0.5;
      f.vel[j + 2] += WIND_Z * dt * 0.5;
      return Math.min(1, (1 - k) * 5) * k * k * 0.9;
    },
  });
  let exhaustAcc = 0;

  /*
   * Leaves, coming off the trees.
   *
   * The one part of the year that is *motion* rather than colour. A canopy that
   * turns gold and then simply is not there any more has skipped the bit
   * everybody actually pictures when they think of autumn, and it is the same
   * pooled field as the smoke — a few hundred specks, one draw call.
   *
   * Emitted in a ring around the camera rather than from the trees. That sounds
   * like a cheat and is the right model: what you see on a windy October
   * afternoon is not leaves leaving a *particular* branch, it is leaves in the
   * air, and tying each one to a tree would cost a lookup per spawn to place
   * them somewhere the eye cannot check anyway.
   */
  const leaves = new Field(scene, {
    count: 380,
    /*
     * A leaf, measured in pixels rather than in metres.
     *
     * 0.13 of a tile was seven pixels at the zoom the game is played at, which
     * is a speck; 0.2 read as a blob once they were spread evenly over the
     * field like rain. Coming off the trees they cluster, so they can be smaller
     * again and still be found — a leaf is legible because of *where* it is far
     * more than because of how big it is.
     */
    tiles: 0.16,
    colour: '#c07a2c',
    opacity: 0.95,
    spread: 0,
    behave: (f, i, k, dt, time) => {
      const j = i * 3;
      /*
       * A leaf does not fall, it *slips* — and it slips about a point, which is
       * the bit the first version missed. Sine on the position rather than the
       * velocity, so it swings back and forth across its own line of descent
       * instead of being blown steadily off it. That difference is the whole
       * reason one reads as a leaf and not as a drop of rain.
       */
      f.pos[j] += Math.sin(time * 2.6 + f.seed[i] * 5) * dt * 0.9;
      f.pos[j + 2] += Math.cos(time * 2.1 + f.seed[i] * 5) * dt * 0.9;
      // Terminal velocity, quickly: a leaf is nearly all drag, so it does not
      // accelerate the way a stone does. Then downwind, gently.
      f.vel[j + 1] *= 1 - dt * 1.6;
      f.vel[j] += WIND_X * dt * 0.30;
      f.vel[j + 2] += WIND_Z * dt * 0.30;
      return Math.min(1, k * 8) * Math.min(1, (1 - k) * 6 + 0.15);
    },
  });
  let leafAcc = 0;

  const fields = [mist, smoke, exhaust, leaves];

  return {
    step(src, frame, dt, time): void {
      const hour = (frame.dayFraction * 24 + 6) % 24;
      const reach = frame.tilesAcross * 0.62;

      /*
       * Mist strength, and the season is half of it.
       *
       * The great fog mornings are autumn ones — long nights, warm ground, damp
       * air — so it is doubled through the back half of the year and thinned in
       * high summer when the sun is up before the fog can form. Snow suppresses
       * it outright: fog over snow is a whiteout, and a whiteout is not a
       * picture.
       */
      const mistLevel = mistAt(hour) * (1 - frame.snow * 0.85) * frame.level;
      mist.aim(0.14 * mistLevel, frame.pixelsPerTile);
      if (mistLevel > 0.01) {
        /*
         * Fill it in at once the first time, rather than drifting in over ten
         * seconds.
         *
         * A bank of fog has no beginning. Emitting at a steady rate from empty
         * means the first thing you see on a foggy morning is fog *arriving*,
         * which is not a thing fog does — and it is also what you get every time
         * the camera crosses the district faster than the emitter can keep up.
         * So an empty field is primed with a full complement at random ages, and
         * the ages are the point: spawned all at once with the same life they
         * would all die at the same moment and the fog would blink.
         */
        const prime = mist.live() < 12 ? 150 : 0;
        mistAcc += dt * 26 * mistLevel + prime;
        while (mistAcc >= 1) {
          mistAcc -= 1;
          const a = Math.random() * 6.283;
          const r = Math.sqrt(Math.random()) * reach;
          const x = frame.camX + Math.cos(a) * r;
          const z = frame.camZ + Math.sin(a) * r;
          const g = groundHeightAt(src, x, z);
          /*
           * Only in the low ground, and this is the whole picture.
           *
           * Fog everywhere is a grey filter over the frame. Fog lying in the
           * valleys with the hills standing out of it is the thing people
           * photograph, and the difference between the two is this one test.
           * Measured against the ground under the camera, so it follows you
           * across the district rather than needing a survey of it.
           */
          const here = groundHeightAt(src, frame.camX, frame.camZ);
          if (g > here + 0.9) continue;
          mist.spawn(
            x, g + 0.12 + Math.random() * 0.30, z,
            (Math.random() - 0.5) * 0.10, 0.006, (Math.random() - 0.5) * 0.10,
            12 + Math.random() * 8,
            prime > 0 ? Math.random() * 0.85 : 0,
          );
        }
      }

      /*
       * Smoke, on the cold mornings and evenings that a coal fire is lit.
       *
       * Not all day and not all year: a chimney going at two in the afternoon in
       * June says the house is on fire. Morning and evening, doubled in winter,
       * which the renderer already knows as `snow` — an imperfect proxy for cold
       * and the only one to hand, but it is the right shape.
       */
      /*
       * Smoke, per chimney in view rather than sampled from the district.
       *
       * The old emitter picked a random place out of *all* of them and threw the
       * pick away if it was off screen. Instrumented: forty-eight attempts over a
       * run, twenty-five of them discarded for being out of view, fourteen puffs
       * actually spawned — one or two per chimney at a time, which is not a plume,
       * it is a speck. Every guess I made about why it was invisible (too pale
       * against the snow, born inside the roof) was wrong, and the counter said so
       * in one run.
       *
       * Walking the places in view instead makes the rate mean what it says: this
       * many puffs a second *per chimney that is lit*, with nothing wasted. And it
       * is cheap — there are twenty places in a district, not twenty thousand.
       */
      const cold = 0.55 + frame.snow * 0.45;
      const lit = hour < 9.5 ? 1 : hour > 16 ? 1 : 0.2;
      const smokeLevel = cold * lit * frame.level;
      smoke.aim(0.36 * frame.level, frame.pixelsPerTile);
      if (smokeLevel > 0.02) {
        /*
         * Puffs a second from one chimney, so the density is the same whatever
         * the frame rate. Four a second against four and a half seconds of life
         * is about eighteen in the air at once, which is a column rather than a
         * dotted line.
         *
         * Not verified by eye, and worth saying so: a headless browser on
         * software GL runs this scene at three frames a second, which cannot
         * accumulate a plume however fast it is emitting — every screenshot I
         * took of it was empty while the counters said fourteen puffs were alive
         * and visible. The arithmetic is framerate-independent; the picture was
         * not.
         */
        const chance = 4 * dt * smokeLevel;
        for (let p = 0; p < src.placeCount; p++) {
          const x = src.px[p];
          const z = src.pz[p];
          if (Math.abs(x - frame.camX) > reach || Math.abs(z - frame.camZ) > reach) continue;
          /*
           * Which chimneys are going, decided by the building and the day.
           *
           * Stable within a day and different the next, which is better than the
           * per-puff coin flip it replaces: that gave every chimney a thin
           * intermittent wisp, where what actually happens is that some houses
           * have a fire lit and some do not. The pattern is the realism.
           */
          const h = Math.sin((x * 12.9898 + z * 78.233 + frame.day * 3.1) * 43758.5453);
          if (h - Math.floor(h) > 0.62) continue;
          if (Math.random() > chance) continue;
          /*
           * At the chimney, which is higher than it looks.
           *
           * The buildings measure 0.63 to 1.22 tall, most of them 0.95, so the
           * old 0.85 put the plume *inside the roof* — depth-tested away for the
           * part of its life when it is brightest.
           */
          /*
           * Out of a chimney, not off a firework. The horizontal kick is gone —
           * a puff leaves a chimney going *up*, and everything sideways after
           * that is the wind's doing.
           */
          smoke.spawn(
            x + (Math.random() - 0.5) * 0.16,
            groundHeightAt(src, x, z) + 1.2 + Math.random() * 0.12,
            z + (Math.random() - 0.5) * 0.16,
            0, 0.46 + Math.random() * 0.14, 0,
            3.6 + Math.random() * 2.0,
          );
        }
      }

      exhaust.aim(0.34 * frame.level, frame.pixelsPerTile);
      if (src.vehicleCount > 0 && frame.level > 0.02) {
        exhaustAcc += dt * 22 * frame.level;
        while (exhaustAcc >= 1) {
          exhaustAcc -= 1;
          const v = (Math.random() * src.vehicleCount) | 0;
          // Standing still, standing quiet. A parked lorry with smoke coming off
          // it is a lorry somebody left running.
          if (src.vStopped[v] === 1) continue;
          const x = src.vx[v];
          const z = src.vz[v];
          if (Math.abs(x - frame.camX) > reach || Math.abs(z - frame.camZ) > reach) continue;
          // Behind it, along its own heading. Models are authored nose along +X
          // and `facing` is measured the same way, so back is simply minus that.
          const a = src.vHeading[v] * Math.PI * 2;
          const bx = x - Math.cos(a) * 0.26;
          const bz = z + Math.sin(a) * 0.26;
          exhaust.spawn(
            bx, groundHeightAt(src, bx, bz) + 0.14, bz,
            (Math.random() - 0.5) * 0.06, 0.16 + Math.random() * 0.10,
            (Math.random() - 0.5) * 0.06,
            0.9 + Math.random() * 0.7,
          );
        }
      }

      /*
       * How many leaves are in the air. Peaks with the turn and stops when the
       * trees are bare, because a leaf falling off a bare tree in January is a
       * leaf from nowhere.
       */
      const falling = frame.autumn * frame.level;
      leaves.aim(0.95 * frame.level, frame.pixelsPerTile);
      if (falling > 0.02 && src.scatterCount > 0) {
        leafAcc += dt * 40 * falling;
        while (leafAcc >= 1) {
          leafAcc -= 1;
          /*
           * Off a tree, not out of the sky.
           *
           * "They're supposed to come from the trees themselves, not randomly
           * floating around like rain." Quite right, and the ring of specks I had
           * before was defended in a comment as the correct model on the grounds
           * that you cannot tell which branch a leaf left. That misses what you
           * *can* tell: whether there is a tree above them. Evenly spread, they
           * fall in the middle of empty fields, and a leaf in the middle of a
           * field with nothing near it is rain.
           *
           * Sampling the scatter list is what makes this cheap. It is already the
           * list of every tree on screen, packed and filtered by influence, so
           * one random index gets a tree that is definitely in view — and no
           * trees in view now means no leaves, which is the whole point.
           */
          const i = (Math.random() * src.scatterCount) | 0;
          if (src.sSheds[i] === 0) continue;
          const x = src.sx[i];
          const z = src.sz[i];
          if (Math.abs(x - frame.camX) > reach || Math.abs(z - frame.camZ) > reach) continue;
          /*
           * Somewhere in the canopy, and out of the outer half of it.
           *
           * A leaf leaves the edge of a crown rather than the middle — the middle
           * is where the trunk is — so the offset is biased outward, which also
           * happens to make the fall visibly *around* the tree rather than
           * through it. The height is the tree's own scale, because a big oak
           * drops from higher up than a hawthorn and the fall time should say so.
           */
          const sc = src.sScale[i];
          const a = Math.random() * 6.283;
          const rad = (0.20 + Math.random() * 0.24) * sc;
          const bx = x + Math.cos(a) * rad;
          const bz = z + Math.sin(a) * rad;
          leaves.spawn(
            bx, groundHeightAt(src, bx, bz) + (0.42 + Math.random() * 0.30) * sc + 0.22, bz,
            0, -(0.30 + Math.random() * 0.14), 0,
            2.4 + Math.random() * 2.0,
          );
        }
      }

      for (const f of fields) f.step(dt, time);
    },
    dispose(): void {
      for (const f of fields) f.dispose();
    },
  };
}
