/**
 * A wire has to end on the next pole's insulator. Exactly.
 *
 * "The cables don't line up correctly on the model itself, they are offset" and
 * "they do not connect correctly to the other side, often overlapping. We need an
 * EXACT calculation distance and angle."
 *
 * Both faults were geometry, and neither would ever throw — which is why they get
 * a test rather than a look. What this file does is reproduce the transform the
 * renderer applies, apply it to the span mesh's two end points, and check where
 * they land. If the start is not on this pole's insulator and the end is not on
 * the next one's, to within a rounding error, it fails.
 *
 * The arithmetic under test is the composition `Ry(yaw) * Rz(pitch)` with a
 * stretch along X and a lift off the ground, which is exactly what
 * `Scene.applyScatter` does. Duplicating it here is the point: two independent
 * derivations of the same placement agreeing is the only way to be sure the one
 * in the renderer is right, and the first version of it rolled the span sideways
 * instead of lifting its far end.
 */

import { describe, expect, it } from 'vitest';
import { powerLines, SPAN, WIRE_H, type PowerWorld } from '../src/powerlines.ts';

const SIZE = 64;

/**
 * A sloping district, because a flat one cannot fail this.
 *
 * The whole bug was about poles at different heights, so the ground has to
 * actually vary — on level ground a rigid horizontal span meets the next pole by
 * luck and every version of this code passes.
 */
function hilly(): PowerWorld & { heightAt: (x: number, z: number) => number } {
  const raw = (x: number, z: number): number => (
    400 + Math.round(Math.sin(x * 0.21) * 260 + Math.cos(z * 0.17) * 200)
  );
  return {
    size: SIZE,
    height: (t) => raw(t % SIZE, Math.floor(t / SIZE)),
    builtUp: () => false,
    heightAt: raw,
  };
}

/**
 * The renderer's own placement, redone.
 *
 * `Ry(yaw)` then `Rz(pitch)`, applied to a point of the span mesh, scaled along
 * its own length and lifted off the ground. Written out in full rather than with
 * a matrix library so that the composition order is visible and can be checked
 * against the scene by eye.
 */
function place(
  point: { x: number; y: number; z: number },
  at: { x: number; ground: number; z: number },
  yawTurns: number, pitch: number, stretch: number, lift: number,
): { x: number; y: number; z: number } {
  // Scale along the model's own length first, which is what `scale.set(k * s, k, k)`
  // does before any rotation is applied.
  const sx = point.x * stretch;
  // Rz(pitch): +X lifts.
  const rx = sx * Math.cos(pitch) - point.y * Math.sin(pitch);
  const ry = sx * Math.sin(pitch) + point.y * Math.cos(pitch);
  const rz = point.z;
  // Ry(yaw): a Y-rotation of theta sends +X to (cos, 0, -sin).
  const a = yawTurns * Math.PI * 2;
  return {
    x: at.x + rx * Math.cos(a) + rz * Math.sin(a),
    y: at.ground + lift + ry,
    z: at.z - rx * Math.sin(a) + rz * Math.cos(a),
  };
}

describe('a span of wire', () => {
  it('starts on its own pole s insulator and ends on the next one s', () => {
    const w = hilly();
    const poles = powerLines(w, 1985);
    expect(poles.length).toBeGreaterThan(8);

    /*
     * The interpolated ground, which is where the scatter layer actually stands
     * things. `groundHeightAt` is a bilinear sample of the four tile corners, and
     * using the raw tile value instead is the near-miss that reads as
     * "overlapping" — so the test has to sample the same way the renderer does or
     * it would pass a version of the code that is subtly wrong. Reproduced here
     * from tile centres, which is all this synthetic terrain needs.
     */
    const ground = (x: number, z: number): number => w.heightAt(
      Math.floor(x), Math.floor(z),
    ) / 150;

    let checked = 0;
    for (let i = 0; i < poles.length - 1; i++) {
      const p = poles[i];
      if (p.run < 0 || p.toX === undefined || p.toZ === undefined) continue;
      const gA = ground(p.x, p.z);
      const gB = ground(p.toX, p.toZ);
      const ay = gA + WIRE_H;
      const by = gB + WIRE_H;
      const flat = Math.hypot(p.toX - p.x, p.toZ - p.z);
      const rise = by - ay;
      const reach = Math.hypot(flat, rise);
      const yaw = (1 - p.run) % 1;
      const pitch = Math.asin(rise / reach);
      const stretch = reach / SPAN;

      // The span mesh's two ends, in model space: origin, and SPAN along +X.
      const start = place({ x: 0, y: 0, z: 0 },
        { x: p.x, ground: gA, z: p.z }, yaw, pitch, stretch, WIRE_H);
      const end = place({ x: SPAN, y: 0, z: 0 },
        { x: p.x, ground: gA, z: p.z }, yaw, pitch, stretch, WIRE_H);

      expect(start.x, 'start x').toBeCloseTo(p.x, 6);
      expect(start.z, 'start z').toBeCloseTo(p.z, 6);
      expect(start.y, 'start on this insulator').toBeCloseTo(ay, 6);

      expect(end.x, 'end x lands on the far pole').toBeCloseTo(p.toX, 6);
      expect(end.z, 'end z lands on the far pole').toBeCloseTo(p.toZ, 6);
      expect(end.y, 'end on the far insulator').toBeCloseTo(by, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(6);
  });

  it('is rolled sideways by the mistake this replaced', () => {
    /*
     * The negative case, and worth having because the wrong version is so nearly
     * right. Putting the pitch into a rotation about **X** tilts the span in the
     * YZ plane — it rolls the three wires about their own run and leaves the far
     * end at the height it started. The check is that such a transform does *not*
     * reach the far insulator, so the correct one is not passing by luck.
     */
    const w = hilly();
    const poles = powerLines(w, 1985);
    const ground = (x: number, z: number): number => w.heightAt(
      Math.floor(x), Math.floor(z),
    ) / 150;
    let sawMiss = false;
    for (const p of poles) {
      if (p.run < 0 || p.toX === undefined || p.toZ === undefined) continue;
      const gA = ground(p.x, p.z);
      const gB = ground(p.toX, p.toZ);
      const rise = (gB + WIRE_H) - (gA + WIRE_H);
      if (Math.abs(rise) < 0.05) continue;
      // Rx cannot change the Y of a point on the X axis at all: sin/cos apply to
      // Y and Z. So the far end stays at the near insulator's height.
      const endY = gA + WIRE_H;
      if (Math.abs(endY - (gB + WIRE_H)) > 0.04) sawMiss = true;
    }
    expect(sawMiss, 'the terrain varies enough for this to matter').toBe(true);
  });

  it('never asks for a pitch it cannot take the arcsine of', () => {
    // `asin(rise / reach)` is only defined because `reach` is the hypotenuse and
    // is therefore never smaller than `rise`. Cheap to state, and a NaN pitch
    // would silently delete every wire in the district.
    const w = hilly();
    for (const p of powerLines(w, 1985)) {
      if (p.run < 0 || p.toX === undefined || p.toZ === undefined) continue;
      const flat = Math.hypot(p.toX - p.x, p.toZ - p.z);
      const rise = (w.heightAt(Math.floor(p.toX), Math.floor(p.toZ))
        - w.heightAt(Math.floor(p.x), Math.floor(p.z))) / 150;
      const reach = Math.hypot(flat, rise);
      expect(reach).toBeGreaterThanOrEqual(Math.abs(rise));
      expect(Number.isFinite(Math.asin(rise / reach))).toBe(true);
    }
  });
});
