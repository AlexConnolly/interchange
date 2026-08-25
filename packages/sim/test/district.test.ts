import { describe, expect, it } from 'vitest';
import { createWorld, NO_WAY, TICKS_PER_DAY } from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

/**
 * Every district is playable, not just the lucky ones.
 *
 * This exists because of a failure that produced no error of any kind. Towns are
 * scored partly on how much sea is around them — a town wants to be on the water
 * — and a one-tile island maximises that term, so the generator sought islets out
 * and found them. The road network then grows outward from the *biggest*
 * settlement, so a district whose biggest town was on a rock connected nothing:
 * zero road tiles anywhere, every site without an access tile, no opening pair,
 * and a game that starts with nothing to do.
 *
 * Measured when it was found: it happened to one district in three, and even the
 * shipping seed had one of its three towns alone on a single tile in the sea.
 * Nothing threw. The only visible symptom was an empty contract board, which
 * looks exactly like a balance problem.
 *
 * A district is a lot of machinery — terrain, water, towns, roads, industries,
 * contracts — and the thing worth asserting is not any one stage but that the
 * chain comes out the other end with a game in it. So: thirty seeds, and each one
 * must produce a road network, sites that can be reached, and a first job.
 */

loadContent();

const D = 128;
const SEEDS = Array.from({ length: 30 }, (_, i) => 1980 + i);

function district(seed: number): ReturnType<typeof createWorld> {
  const w = createWorld({ seed, size: D, townCount: 3, companyCount: 1 });
  w.tick = 60 * TICKS_PER_DAY;
  return w;
}

describe('any district', () => {
  it('lays a road network', () => {
    for (const seed of SEEDS) {
      const w = district(seed);
      let road = 0;
      for (let i = 0; i < D * D; i++) if (w.layers[0].cls[i] !== NO_WAY) road++;
      // A hundred tiles is a low bar and deliberately so: what is being caught
      // is *nothing at all*, which is what the failure actually looked like.
      expect(road, `seed ${seed} has no roads`).toBeGreaterThan(100);
    }
  });

  it('puts its towns somewhere a road can reach', () => {
    for (const seed of SEEDS) {
      const w = district(seed);
      const h = w.terrain.height;
      /*
       * The mainland, found the way the road router walks it: four-connected
       * over land. A tile reachable only diagonally is a tile no road can get
       * to, so eight-connectivity would call an island fine and be contradicted
       * by everything downstream.
       */
      let bestRun = 0;
      const label = new Int32Array(D * D).fill(-1);
      let next = 0;
      let bestId = -1;
      for (let s0 = 0; s0 < D * D; s0++) {
        if (label[s0] !== -1 || h[s0] <= 0) continue;
        const id = next++;
        const stack = [s0];
        label[s0] = id;
        let n = 0;
        while (stack.length > 0) {
          const i = stack.pop() as number;
          n++;
          const x = i % D;
          const y = (i / D) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= D || ny >= D) continue;
            const j = ny * D + nx;
            if (label[j] !== -1 || h[j] <= 0) continue;
            label[j] = id;
            stack.push(j);
          }
        }
        if (n > bestRun) { bestRun = n; bestId = id; }
      }
      for (let k = 0; k < w.towns.count; k++) {
        const tile = w.towns.y[k] * D + w.towns.x[k];
        expect(label[tile], `seed ${seed} town ${k} is on an island`).toBe(bestId);
      }
    }
  });

  it('always has a first job to offer', () => {
    for (const seed of SEEDS) {
      const w = district(seed);
      const o = w.planOpening();
      expect(o.from, `seed ${seed} has no opening`).toBeGreaterThanOrEqual(0);
      expect(o.to, `seed ${seed} has no opening`).toBeGreaterThanOrEqual(0);
    }
  });
});
