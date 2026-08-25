/**
 * Rain, and snow, falling in the world rather than on the screen.
 *
 * The distinction matters more than anything else in this file. Precipitation
 * drawn in screen space slides across the frame when the camera pans and sits
 * still when it does not, which reads instantly as a filter over a photograph —
 * and at a three-quarter view it is worse, because streaks that should be
 * vertical in the world are vertical on the screen and the two are forty degrees
 * apart.
 *
 * So every drop has a world position and falls in world units. What makes that
 * affordable is that the drops do not need to be *the same* drops: they live in a
 * box centred on the camera, and one that leaves the box is wrapped by exactly
 * the width of the box. Because the distribution inside is uniform, wrapping is
 * invisible — the drop that appears on the far side is indistinguishable from the
 * one that left, and no drop ever slides with the camera.
 *
 * One mesh does both rain and snow. They differ in scale, speed, colour and how
 * they wander, all of which is per-instance, and none of which is worth a second
 * batch.
 */

import {
  AdditiveBlending, Color, DoubleSide, InstancedMesh, MeshBasicMaterial,
  NormalBlending, Object3D, PlaneGeometry, type Scene,
} from 'three';

/** How many drops at the heaviest. */
const CAPACITY = 900;

/**
 * The side of the box drops live in, in tiles.
 *
 * A little wider than the frame at the default zoom, so a drop is never seen to
 * appear at the edge. Fixed rather than tracking the zoom: recomputing it would
 * mean rewrapping every drop when the player scrolls the wheel, and a sudden
 * reshuffle of the rain is far more noticeable than a few wasted instances.
 */
const SPAN = 44;

/** How high above the camera's ground they start. */
const CEILING = 14;

export class Precipitation {
  private readonly mesh: InstancedMesh;
  private readonly material: MeshBasicMaterial;
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly z = new Float32Array(CAPACITY);
  /** Fall speed and a phase, so no two drops move alike. */
  private readonly speed = new Float32Array(CAPACITY);
  private readonly phase = new Float32Array(CAPACITY);
  private readonly tmp = new Object3D();
  private seeded = false;
  private clock = 0;
  private wasSnow = false;
  private styled = false;

  constructor(scene: Scene) {
    /*
     * A unit quad, scaled per instance.
     *
     * Not billboarded. The camera never rotates in this game — it is a fixed
     * three-quarter orthographic view — so a quad facing the camera once faces it
     * for ever, and a billboarding pass would be per-instance work for a
     * rotation that never changes.
     */
    const geom = new PlaneGeometry(1, 1);
    this.material = new MeshBasicMaterial({
      color: new Color(0.78, 0.84, 0.92),
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      /*
       * Double-sided, and it is the whole reason the first attempt drew nothing.
       *
       * `PlaneGeometry` faces +Z. This camera sits at a negative X and Z from its
       * target, so it looks *along* +Z — at the back of every drop, which
       * `MeshBasicMaterial` culls by default. Nine hundred instances, all
       * correctly positioned, entirely invisible.
       *
       * The same fact caught the ground mesh for a different reason (see the
       * DoubleSide note in scene.ts), which is a hint that a fixed camera looking
       * one way is something this renderer should assume out loud rather than
       * rediscover.
       */
      side: DoubleSide,
    });
    this.mesh = new InstancedMesh(geom, this.material, CAPACITY);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** Scatter the drops through the box, once. */
  private seed(camX: number, camY: number, camZ: number): void {
    for (let i = 0; i < CAPACITY; i++) {
      this.x[i] = camX + (Math.random() - 0.5) * SPAN;
      this.z[i] = camZ + (Math.random() - 0.5) * SPAN;
      this.y[i] = camY + Math.random() * CEILING;
      this.speed[i] = 0.8 + Math.random() * 0.5;
      this.phase[i] = Math.random() * Math.PI * 2;
    }
    this.seeded = true;
  }

  /**
   * Advance and draw.
   *
   * `rain` and `snow` are both 0..1 and whichever is larger wins — it does not
   * rain and snow at once, and in winter a shower falls as snow. The count of
   * live drops scales with the amount, so a light shower is a few dozen streaks
   * and a downpour is nine hundred, without changing anything about how any one
   * of them behaves.
   */
  update(
    dt: number, camX: number, camY: number, camZ: number,
    rain: number, snow: number,
  ): void {
    const amount = Math.max(rain, snow);
    if (amount < 0.01) {
      this.mesh.visible = false;
      return;
    }
    if (!this.seeded) this.seed(camX, camY, camZ);
    this.clock += dt;

    const snowing = snow > rain;
    if (snowing !== this.wasSnow || !this.styled) {
      this.wasSnow = snowing;
      // On the *first* call as well as on every change. Keying only on the change
      // meant the material kept its constructor defaults for as long as the
      // weather did not switch — so the first shower of a game was drawn with
      // whatever happened to be in the constructor rather than with rain's
      // settings.
      this.styled = true;
      /*
       * Snow is drawn over the scene and rain into it.
       *
       * Rain is water on a dark ground: it takes light from behind and reads as a
       * slight lift, which is normal blending at low opacity. Snow is opaque and
       * *brighter than anything it crosses*, including a white field, so additive
       * would make it vanish over the one background it most needs to be visible
       * against. The blend mode is the whole difference between snow you can see
       * and snow you cannot.
       */
      this.material.blending = snowing ? NormalBlending : AdditiveBlending;
      this.material.color.setRGB(
        snowing ? 1 : 0.62,
        snowing ? 1 : 0.70,
        snowing ? 1 : 0.86,
      );
      this.material.opacity = snowing ? 0.92 : 0.62;
      this.material.needsUpdate = true;
    }

    const live = Math.max(1, Math.round(CAPACITY * amount));
    // Snow falls at about a tenth the speed and wanders; rain goes nearly
    // straight down and fast.
    /*
     * Fourteen, not twenty-six.
     *
     * At twenty-six a drop crossed the whole visible column in about half a
     * second, which is faster than rain and reads as static rather than as
     * falling — you see the streaks and not the movement. Fourteen is still
     * quick and you can follow one down.
     */
    const fall = snowing ? 1.9 : 14;
    const half = SPAN / 2;
    const floor = camY - 1.5;
    const top = camY + CEILING;

    for (let i = 0; i < live; i++) {
      this.y[i] -= fall * this.speed[i] * dt;
      if (snowing) {
        // A lazy lateral wander, different for every flake.
        this.x[i] += Math.sin(this.clock * 0.7 + this.phase[i]) * 0.55 * dt;
        this.z[i] += Math.cos(this.clock * 0.5 + this.phase[i] * 1.7) * 0.45 * dt;
      } else {
        // Rain leans with the wind, and the lean is the same for all of it.
        this.x[i] += 2.2 * dt;
      }

      if (this.y[i] < floor) {
        this.y[i] = top;
        this.x[i] = camX + (Math.random() - 0.5) * SPAN;
        this.z[i] = camZ + (Math.random() - 0.5) * SPAN;
      }
      /*
       * Wrap by exactly the width of the box.
       *
       * A world-space translation by a multiple of `SPAN` on a uniform
       * distribution is invisible, and it is what lets the drops be world-placed
       * without needing to exist outside the frame. Moving them *to* the camera
       * instead would make every drop slide sideways whenever the camera did,
       * which is the screen-space look this file exists to avoid.
       */
      if (this.x[i] < camX - half) this.x[i] += SPAN;
      else if (this.x[i] > camX + half) this.x[i] -= SPAN;
      if (this.z[i] < camZ - half) this.z[i] += SPAN;
      else if (this.z[i] > camZ + half) this.z[i] -= SPAN;

      this.tmp.position.set(this.x[i], this.y[i], this.z[i]);
      if (snowing) {
        const k = 0.055 + (this.speed[i] - 0.8) * 0.05;
        this.tmp.scale.set(k, k, k);
        this.tmp.rotation.set(0, 0, this.clock * 0.6 + this.phase[i]);
      } else {
        // A streak, and long: the length is what says it is falling fast. Leaned
        // to match the drift, or the streaks and their direction disagree.
        this.tmp.scale.set(0.030, 0.52 + this.speed[i] * 0.26, 1);
        /*
         * Positive, and it was negative — so the streaks leaned *into* their own
         * direction of travel, which is the one arrangement that cannot happen.
         *
         * A rotation of +θ about Z carries the quad's +Y axis toward −X, so the
         * top of the streak trails behind a drop moving toward +X. That is the
         * lean rain has: the top is where the drop *was*.
         */
        this.tmp.rotation.set(0, 0, 0.16);
      }
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
    }

    this.mesh.count = live;
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
