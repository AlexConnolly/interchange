/**
 * Birds, crossing.
 *
 * The one piece of motion in the district that has nothing to do with the
 * player. Everything else that moves is either theirs or the world working —
 * lorries, tractors, traffic, smoke off a chimney somebody lit. A flock going
 * over is the countryside carrying on regardless, and it is the cheapest thing
 * on this list by a distance: two models, one draw call each, nine instances.
 *
 * They are deliberately occasional. A sky with birds in it permanently is an
 * aquarium; a sky that is empty for a minute and then has nine gulls crossing it
 * is a place where something happened. The waiting is most of the effect.
 *
 * ## Flapping without animation
 *
 * There is no skeletal animation anywhere in this project and there is not going
 * to be for a bird four pixels across. The flap is two models — wings up, wings
 * down — and each bird is drawn into whichever of the two instanced meshes its
 * phase currently says. That is how every hand-drawn bird worked before about
 * 1996, and at this size it reads better than an interpolation would: a smooth
 * blend of two extremes spends most of its time in the middle, which is the one
 * wing position that looks like nothing at all.
 */

import {
  InstancedMesh, Matrix4, type Material, Quaternion, Scene, Vector3,
} from 'three';
import type { Model } from './glb.ts';
import { groundHeightAt, type GroundSource } from './ground.ts';

/** How many in a flock. Nine reads as a skein; three reads as an accident. */
const FLOCK = 9;

/** Tiles a second. A gull is faster than a lorry and it should look it. */
const SPEED = 3.4;

/** Wingbeats a second. */
const FLAP = 5.5;

interface Bird {
  /** Offset from the leader, across and along the line of flight. */
  across: number;
  along: number;
  /** Its own bob and its own flap, so the flock is not one rigid object. */
  phase: number;
  lift: number;
}

export interface Birds {
  setModels(up: Model, down: Model, material: Material): void;
  step(
    src: GroundSource, camX: number, camZ: number, tilesAcross: number,
    dt: number, level: number,
  ): void;
  dispose(): void;
}

export function makeBirds(scene: Scene): Birds {
  let up: InstancedMesh | null = null;
  let down: InstancedMesh | null = null;

  /*
   * The flock, as a leader and a set of offsets.
   *
   * A skein is not nine independent birds and must not be simulated as nine
   * independent birds — the thing that makes it read as a flock is that they
   * hold station on each other, so the shape is authored once and flown as a
   * rigid body with a little per-bird bob on top. Boids would be more correct
   * and completely invisible at this size.
   */
  const birds: Bird[] = [];
  for (let i = 0; i < FLOCK; i++) {
    // A rough V, alternating sides, with the leader at the point.
    const rank = Math.ceil(i / 2);
    const side = i === 0 ? 0 : (i % 2 === 0 ? 1 : -1);
    birds.push({
      across: side * rank * 0.62 + (Math.random() - 0.5) * 0.22,
      along: -rank * 0.5 + (Math.random() - 0.5) * 0.2,
      phase: Math.random(),
      lift: (Math.random() - 0.5) * 0.5,
    });
  }

  let flying = false;
  /** Seconds until the next flock. Starts short so one goes over early on. */
  let wait = 12 + Math.random() * 20;
  let x = 0;
  let z = 0;
  let dx = 1;
  let dz = 0;
  let height = 5;
  let crossed = 0;
  let span = 0;

  const m = new Matrix4();
  const pos = new Vector3();
  const rot = new Quaternion();
  const scale = new Vector3(1.15, 1.15, 1.15);
  const axis = new Vector3(0, 1, 0);

  return {
    setModels(u: Model, d: Model, material: Material): void {
      for (const old of [up, down]) {
        if (!old) continue;
        scene.remove(old);
        old.dispose();
      }
      // The same lit material as everything else, so a bird takes the sun and
      // goes to a silhouette at dusk with the rest of the district.
      up = new InstancedMesh(u.body, material, FLOCK);
      down = new InstancedMesh(d.body, material, FLOCK);
      for (const mesh of [up, down]) {
        /*
         * No shadow, and that is a decision rather than an oversight. A bird's
         * shadow at this height is a speck a hundred yards from the bird, which
         * nobody will connect to it, and it costs a shadow-map pass on geometry
         * that moves every frame. What you lose is nothing; what you would gain
         * is a mysterious dot crossing a field.
         */
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.visible = false;
        scene.add(mesh);
      }
    },

    step(src, camX, camZ, tilesAcross, dt, level): void {
      if (!up || !down) return;
      if (level <= 0.01) {
        up.visible = false;
        down.visible = false;
        return;
      }

      if (!flying) {
        wait -= dt;
        if (wait > 0) {
          up.visible = false;
          down.visible = false;
          return;
        }
        /*
         * Launch, from outside the frame and heading across it.
         *
         * Started off screen rather than at the edge, so a flock is never seen
         * to appear — the first you know of it is one already on its way over.
         * The span is measured from the zoom, so the crossing takes roughly the
         * same time whether you are looking at a field or at the whole district.
         */
        span = tilesAcross * 0.95;
        const a = Math.random() * Math.PI * 2;
        dx = Math.cos(a);
        dz = Math.sin(a);
        x = camX - dx * span;
        z = camZ - dz * span;
        height = 4.5 + Math.random() * 3;
        crossed = 0;
        flying = true;
      }

      x += dx * SPEED * dt;
      z += dz * SPEED * dt;
      crossed += SPEED * dt;
      if (crossed > span * 2) {
        flying = false;
        // Long enough that the sky is properly empty in between. A minute is a
        // quarter of a game day, which is about right for something you are
        // meant to notice.
        wait = 35 + Math.random() * 70;
        up.visible = false;
        down.visible = false;
        return;
      }

      // Left of the line of flight, for the across offsets.
      const lx = dz;
      const lz = -dx;
      // Models are authored nose along +X, and the world's facing is measured
      // the same way — see `facingFromMotion` in `scene.ts`.
      const facing = Math.atan2(-dz, dx);
      rot.setFromAxisAngle(axis, facing);

      let nUp = 0;
      let nDown = 0;
      for (const b of birds) {
        b.phase += dt * FLAP;
        const bx = x + lx * b.across + dx * b.along;
        const bz = z + lz * b.across + dz * b.along;
        /*
         * Height above the ground under them, not above sea level.
         *
         * A flock at a fixed altitude flies into the hills. Following the ground
         * is both correct and much easier to read: birds crossing a valley stay
         * the same distance above the fields, which is what tells you how high
         * they are at all.
         */
        const y = groundHeightAt(src, bx, bz) + height + b.lift
          + Math.sin(b.phase * 1.7) * 0.16;
        pos.set(bx, y, bz);
        m.compose(pos, rot, scale);
        // Wings up for the first half of the beat, down for the second. Each
        // bird has its own phase, so the flock is not one flapping object.
        const wingsUp = b.phase % 1 < 0.5;
        if (wingsUp) up.setMatrixAt(nUp++, m);
        else down.setMatrixAt(nDown++, m);
      }
      up.count = nUp;
      down.count = nDown;
      up.visible = nUp > 0;
      down.visible = nDown > 0;
      up.instanceMatrix.needsUpdate = true;
      down.instanceMatrix.needsUpdate = true;
    },

    dispose(): void {
      for (const mesh of [up, down]) {
        if (!mesh) continue;
        scene.remove(mesh);
        mesh.dispose();
      }
      up = null;
      down = null;
    },
  };
}
