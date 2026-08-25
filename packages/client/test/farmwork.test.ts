import { describe, expect, it } from 'vitest';
import { Farmwork, type FarmField } from '../src/farmwork.ts';

/*
 * A tractor working a field, on a district of one lane, one farm and one field.
 *
 * What is worth testing here is not that a tractor exists — it is that it stays
 * inside the hedge and that it works the field rather than parking in it. Both
 * were things I got wrong on paper first: an inset of zero drives through the
 * boundary, and a furrow that does not alternate produces a tractor that
 * teleports back to the same end of every pass.
 */

const SIZE = 32;
const t = (x: number, z: number): number => z * SIZE + x;

// A lane along z = 10, from the farm at x = 4 to the field gate at x = 14.
const LANE: number[] = [];
for (let x = 4; x <= 14; x++) LANE.push(t(x, 10));

const FIELD: FarmField = {
  parcel: 1,
  x0: 12, x1: 19, z0: 12, z1: 17,
  road: t(14, 10),
  entryX: 14.5,
  entryZ: 12.5,
};

function district(worked?: Set<number>): Farmwork {
  return new Farmwork({
    size: SIZE,
    farms: () => [{ tile: t(4, 10), x: 4.5, z: 10.5 }],
    fields: () => [FIELD],
    usable: () => true,
    // Out along the lane, and back the same way.
    route: (from) => (from === t(4, 10) ? [...LANE] : [...LANE].reverse()),
    work: (tile) => { worked?.add(tile); },
    needsWork: () => true,
  });
}

/** Run the district for a while, collecting every position drawn. */
function run(seconds: number, worked?: Set<number>): { x: number; z: number }[] {
  const farm = district(worked);
  const cap = 64;
  const vx = new Float32Array(cap);
  const vz = new Float32Array(cap);
  const vh = new Float32Array(cap);
  const vl = new Uint8Array(cap);
  const vm = new Uint8Array(cap);
  const vi = new Int32Array(cap);
  const seen: { x: number; z: number }[] = [];
  const dt = 1 / 30;
  for (let s = 0; s < seconds * 30; s++) {
    const n = farm.step(dt, 3, 0, vx, vz, vh, vl, vm, vi);
    for (let k = 0; k < n; k++) seen.push({ x: vx[k], z: vz[k] });
  }
  return seen;
}

describe('tractors', () => {
  it('work the ground they pass over, and only inside the field', () => {
    // The whole point of them, and the assertion that matters: every tile they
    // report working must be one of the field's own. A tractor that ploughed
    // the lane it drove down would be very obvious and very wrong.
    const worked = new Set<number>();
    run(120, worked);
    expect(worked.size).toBeGreaterThan(6);
    for (const tile of worked) {
      const x = tile % SIZE;
      const z = Math.floor(tile / SIZE);
      expect(x).toBeGreaterThanOrEqual(FIELD.x0);
      expect(x).toBeLessThanOrEqual(FIELD.x1);
      expect(z).toBeGreaterThanOrEqual(FIELD.z0);
      expect(z).toBeLessThanOrEqual(FIELD.z1);
    }
  });

  it('come out of the farm and get drawn', () => {
    expect(run(20).length).toBeGreaterThan(0);
  });

  it('never leave the field or the lane they are entitled to', () => {
    // Everything drawn must be inside the field, on the lane, or on the short
    // run between the two. A tractor across the district is the failure this
    // catches, and it is the one that would be most obvious on screen.
    for (const p of run(120)) {
      const inField = p.x >= FIELD.x0 && p.x <= FIELD.x1 + 1
        && p.z >= FIELD.z0 && p.z <= FIELD.z1 + 1;
      const onLane = p.x >= 4 && p.x <= 15 && p.z >= 9.5 && p.z <= 11.5;
      const atGate = p.x >= 14 && p.x <= 15.5 && p.z >= 10 && p.z <= 13;
      expect(inField || onLane || atGate).toBe(true);
    }
  });

  it('works the field in passes rather than parking in it', () => {
    const inside = run(180).filter(
      (p) => p.x > FIELD.x0 && p.x < FIELD.x1 + 1 && p.z > FIELD.z0 + 0.2,
    );
    expect(inside.length).toBeGreaterThan(30);
    // Both ends of a furrow, and more than one furrow: the marks of a
    // boustrophedon rather than a tractor sat still.
    const xs = inside.map((p) => p.x);
    const zs = inside.map((p) => p.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(4);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(1);
  });
});
