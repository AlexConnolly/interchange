import { describe, expect, it } from 'vitest';
import { BoxGeometry, MeshBasicMaterial, Scene } from 'three';
import { makeBirds } from '../src/birds.ts';
import type { GroundSource } from '../src/ground.ts';

/**
 * A flock goes over, and then the sky is empty again.
 *
 * The whole effect is the *waiting*. A sky with birds in it permanently is an
 * aquarium; a sky that is empty for a minute and then has nine gulls crossing it
 * is a place where something happened. So what is worth pinning is not that the
 * birds exist — it is the cycle: nothing, then a flock, then nothing again, on
 * its own without anything asking.
 *
 * The second thing pinned here is that every bird is drawn exactly once. The
 * flap is two instanced meshes and each bird goes into whichever one its phase
 * says, so a rounding slip in that choice drops birds out of the sky or draws
 * them twice, and neither would throw.
 */

const S = 16;

function ground(): GroundSource {
  return {
    size: S,
    height: new Int16Array(S * S).fill(400),
    parcel: new Int32Array(S * S).fill(-1),
    crop: new Uint8Array(S * S),
    hasRoad: () => false,
    isWater: () => false,
    isStream: () => false,
    influence: () => 1,
  };
}

function flock(): { step: (dt: number) => number } {
  const scene = new Scene();
  const b = makeBirds(scene);
  const geo = new BoxGeometry(1, 1, 1);
  b.setModels({ body: geo, lamps: null }, { body: geo, lamps: null },
              new MeshBasicMaterial());
  const src = ground();
  return {
    step: (dt: number): number => {
      b.step(src, 8, 8, 26, dt, 1);
      let n = 0;
      for (const o of scene.children) {
        const mesh = o as unknown as { visible: boolean; count: number };
        if (mesh.visible) n += mesh.count;
      }
      return n;
    },
  };
}

describe('birds', () => {
  it('leaves the sky empty at first', () => {
    const f = flock();
    // The first flock is a good few seconds out, so nothing on the first frames.
    expect(f.step(1 / 60)).toBe(0);
    expect(f.step(1 / 60)).toBe(0);
  });

  it('sends a flock over, and draws every bird exactly once', () => {
    const f = flock();
    let seen = 0;
    let flying = 0;
    // Five minutes at a thirtieth, which is long enough for several flocks even
    // at the far end of the random wait.
    for (let i = 0; i < 300 * 30; i++) {
      const n = f.step(1 / 30);
      if (n > 0) {
        flying++;
        seen = Math.max(seen, n);
        /*
         * Nine, always. Not "at most nine": a bird whose phase lands on the
         * boundary must go into one mesh or the other, never neither and never
         * both, and the only symptom of getting that wrong is a flock that is
         * quietly the wrong size.
         */
        expect(n).toBe(9);
      }
    }
    expect(seen).toBe(9);
    expect(flying).toBeGreaterThan(0);
  });

  it('empties the sky again between flocks', () => {
    const f = flock();
    let wasFlying = false;
    let landedAgain = false;
    for (let i = 0; i < 300 * 30; i++) {
      const n = f.step(1 / 30);
      if (n > 0) wasFlying = true;
      else if (wasFlying) { landedAgain = true; break; }
    }
    expect(wasFlying).toBe(true);
    expect(landedAgain).toBe(true);
  });
});
