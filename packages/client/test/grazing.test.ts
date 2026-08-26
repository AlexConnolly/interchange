/**
 * Animals stay in the fields.
 *
 * The one hard rule, and the only one worth a test: a cow standing in the lane
 * is funny once and then it is a bug. Everything else about grazing — how long
 * they pause, how far they stray — is a matter of taste and a screenshot answers
 * it better than an assertion can.
 */

import { describe, it, expect } from 'vitest';
import { Grazing } from '../src/grazing.ts';

const SIZE = 32;

/** A world that is grass everywhere except one road running down the middle. */
function world(roadX = 16) {
  return {
    size: SIZE,
    grazeable: (t: number) => {
      if (t < 0 || t >= SIZE * SIZE) return false;
      return (t % SIZE) !== roadX;
    },
    usable: () => true,
    sheepModel: 3,
    cattleModel: 4,
  };
}

function arrays() {
  return {
    vx: new Float32Array(512),
    vz: new Float32Array(512),
    vHeading: new Float32Array(512),
    vLivery: new Uint8Array(512),
    vModel: new Uint8Array(512),
    vId: new Int32Array(512),
  };
}

function run(g: Grazing, a: ReturnType<typeof arrays>, seconds: number): number {
  let n = 0;
  // Sixty steps a second for the given time, which is long enough that every
  // animal has arrived somewhere and chosen again several times over.
  for (let i = 0; i < seconds * 60; i++) {
    n = g.step(1 / 60, 16, 16, 0, a.vx, a.vz, a.vHeading, a.vLivery, a.vModel, a.vId);
  }
  return n;
}

describe('grazing animals', () => {
  it('puts animals out', () => {
    const a = arrays();
    const n = run(new Grazing(world()), a, 2);
    expect(n).toBeGreaterThan(0);
  });

  it('never stands one in the road', () => {
    const a = arrays();
    const g = new Grazing(world());
    // Sampled over a long stretch, because the failure would be intermittent:
    // an animal only enters the road if it *chooses* a target there.
    for (let s = 0; s < 40; s++) {
      const n = run(g, a, 3);
      for (let i = 0; i < n; i++) {
        expect(Math.floor(a.vx[i]), `animal ${i} at x=${a.vx[i].toFixed(2)}`).not.toBe(16);
      }
    }
  });

  it('moves them, but slowly', () => {
    const a = arrays();
    const g = new Grazing(world());
    const n = run(g, a, 1);
    const x0 = Array.from(a.vx.slice(0, n));
    const z0 = Array.from(a.vz.slice(0, n));
    run(g, a, 20);
    let moved = 0;
    let furthest = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(a.vx[i] - x0[i], a.vz[i] - z0[i]);
      if (d > 0.05) moved++;
      furthest = Math.max(furthest, d);
    }
    // Something moved…
    expect(moved).toBeGreaterThan(0);
    // …and nothing bolted. Twenty seconds at a tenth of a tile a second, with
    // pauses, cannot cross a field.
    expect(furthest).toBeLessThan(4);
  });

  it('draws them as sheep and cattle, and mostly sheep', () => {
    const a = arrays();
    const n = run(new Grazing(world()), a, 2);
    let sheep = 0;
    let cattle = 0;
    for (let i = 0; i < n; i++) {
      if (a.vModel[i] === 3) sheep++;
      if (a.vModel[i] === 4) cattle++;
    }
    expect(sheep).toBeGreaterThan(0);
    expect(cattle).toBeGreaterThan(0);
    expect(sheep).toBeGreaterThan(cattle);
  });

  it('gives every animal an id of its own, clear of the fleet', () => {
    // The renderer keys its motion smoothing on the id: reuse one the fleet or
    // the traffic holds and two unrelated things ease toward each other's
    // positions across the district.
    const a = arrays();
    const n = run(new Grazing(world()), a, 2);
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      expect(a.vId[i]).toBeGreaterThan(500000);
      expect(seen.has(a.vId[i])).toBe(false);
      seen.add(a.vId[i]);
    }
  });
});
