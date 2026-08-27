/**
 * Power lines: repeatable, crossing, and dry.
 *
 * Three properties, and they are the three things that would make the feature
 * wrong rather than merely different.
 *
 * **Repeatable**, because that is the rule for everything generated in this game
 * and there is no reason wires should be the exception.
 *
 * **Crossing**, because the whole idea is that the grid comes from somewhere else
 * and goes somewhere else. A line that starts in the middle of a field serves
 * something, and nothing here is served.
 *
 * **Dry**, because a pole standing in a lake is the same class of bug as a tractor
 * fording a beck, and that one got reported twice.
 */

import { describe, expect, it } from 'vitest';
import { powerLines, SPAN, type PowerWorld } from '../src/powerlines.ts';

const SIZE = 128;

/** A district that is land everywhere, with a lake and one town. */
function district(over: Partial<PowerWorld> = {}): PowerWorld {
  return {
    size: SIZE,
    // A lake across the middle-left, big enough that a line aiming through it has
    // to do something about it.
    height: (t) => {
      const x = t % SIZE;
      const z = Math.floor(t / SIZE);
      if (x > 20 && x < 45 && z > 50 && z < 78) return -3;
      return 400;
    },
    builtUp: (x, z) => Math.hypot(x - 96, z - 32) < 10,
    ...over,
  };
}

describe('the same seed gives the same lines', () => {
  it('is identical over and over', () => {
    const a = powerLines(district(), 1985);
    const b = powerLines(district(), 1985);
    expect(a.length).toBeGreaterThan(10);
    expect(b).toEqual(a);
  });

  it('and a different seed gives different ones', () => {
    /*
     * Checked over several seeds rather than one pair, because two seeds landing
     * on the same layout by chance is possible and would make a one-pair test
     * flaky rather than wrong.
     */
    const shapes = new Set<string>();
    for (const seed of [1985, 1986, 2001, 7, 40_000]) {
      shapes.add(powerLines(district(), seed)
        .map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join('|'));
    }
    expect(shapes.size).toBe(5);
  });
});

describe('a line crosses the district', () => {
  it('crosses a long way, and ends where it can go no further', () => {
    /*
     * Runs are contiguous in the returned list and separated by the `run: -1`
     * that ends each one, so walking the list and splitting on that gives the
     * lines back. That structure is worth pinning because the client relies on it
     * to decide where a span goes.
     *
     * The property is *crossing*, not "touches the map boundary", and that
     * distinction was measured rather than chosen: the generated district is an
     * island, so a line taken literally to the map edge starts in the sea. It
     * starts at the shore instead and runs until it cannot continue, which on an
     * island is the far shore. What matters is that it goes a long way — a line
     * that serves nothing and crosses nothing would be neither.
     */
    const poles = powerLines(district(), 1985);
    const runs: typeof poles[] = [];
    let cur: typeof poles = [];
    for (const p of poles) {
      cur.push(p);
      if (p.run < 0) { runs.push(cur); cur = []; }
    }
    expect(runs.length).toBeGreaterThanOrEqual(2);
    for (const run of runs) {
      expect(run.length).toBeGreaterThanOrEqual(4);
      const a = run[0];
      const b = run[run.length - 1];
      expect(Math.hypot(b.x - a.x, b.z - a.z), 'end to end').toBeGreaterThan(SIZE * 0.3);
    }
  });

  it('keeps every step exactly one span long', () => {
    /*
     * The constraint the renderer imposes, and the one that would fail silently:
     * a span of wire is a fixed mesh exactly `SPAN` long, so a step of any other
     * length leaves a visible gap between the wire and the next pole — or an
     * overshoot through it. Nothing would throw; it would just look broken.
     */
    const poles = powerLines(district(), 1985);
    for (let i = 0; i < poles.length - 1; i++) {
      if (poles[i].run < 0) continue;
      const d = Math.hypot(poles[i + 1].x - poles[i].x, poles[i + 1].z - poles[i].z);
      expect(d).toBeCloseTo(SPAN, 6);
    }
  });

  it('points each span at the pole it reaches', () => {
    // The other half of the same invariant: right length, right direction.
    const poles = powerLines(district(), 1985);
    for (let i = 0; i < poles.length - 1; i++) {
      const run = poles[i].run;
      if (run < 0) continue;
      const want = (Math.atan2(poles[i + 1].z - poles[i].z, poles[i + 1].x - poles[i].x)
        / (Math.PI * 2) + 1) % 1;
      expect(run).toBeCloseTo(want, 6);
    }
  });
});

describe('where a line will not go', () => {
  it('keeps its poles out of the water', () => {
    const w = district();
    for (const p of powerLines(w, 1985)) {
      const t = Math.floor(p.z) * SIZE + Math.floor(p.x);
      expect(w.height(t), `pole at ${p.x.toFixed(1)},${p.z.toFixed(1)}`)
        .toBeGreaterThan(0);
    }
  });

  it('keeps out of the water over many seeds, which is where a walk gets cornered', () => {
    /*
     * One seed proves the happy path. The interesting case is a line that enters
     * a corner hemmed in by water, where the fan of headings finds nothing and
     * the walk takes its straight-ahead step regardless — deliberately, because a
     * line that gives up halfway across is worse than an awkward pole. So this
     * measures how often that fallback actually lands wet, and holds it near
     * zero rather than at zero.
     */
    const w = district();
    let wet = 0;
    let all = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const p of powerLines(w, seed)) {
        all++;
        const t = Math.floor(p.z) * SIZE + Math.floor(p.x);
        if (w.height(t) <= 0) wet++;
      }
    }
    expect(all).toBeGreaterThan(600);
    expect(wet / all).toBeLessThan(0.01);
  });

  it('goes round a town rather than through it', () => {
    const w = district();
    let inside = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const p of powerLines(w, seed)) {
        if (w.builtUp(p.x, p.z)) inside++;
      }
    }
    expect(inside).toBeLessThan(6);
  });
});
