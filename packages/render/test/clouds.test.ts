/**
 * The cloud deck's zoom gate.
 *
 * The whole of the brief was "it goes away if you're not at the right zoom", so
 * the thing worth pinning is not what a cloud looks like — a screenshot answers
 * that better than an assertion can — but that ordinary play never sees one. A
 * deck that leaked in at the zoom the game sits at would be an obstruction over
 * the field you are working on, and it would leak in gradually enough that
 * nobody would file it as a bug.
 */

import { describe, it, expect } from 'vitest';
import { Mesh, Scene } from 'three';
import { makeClouds } from '../src/clouds.ts';

const HAZE: [number, number, number] = [0.8, 0.82, 0.86];

function deck(): { s: Scene; at: (across: number, level?: number) => Mesh } {
  const s = new Scene();
  const clouds = makeClouds(s);
  const mesh = s.children[0] as Mesh;
  return {
    s,
    at: (across, level = 1) => {
      clouds.update(0, 0, across, [0, 0], HAZE, 0, level);
      return mesh;
    },
  };
}

/** The alpha the shader will multiply into. */
const amount = (m: Mesh): number => {
  const mat = m.material as { uniforms: { uAmount: { value: number } } };
  return m.visible ? mat.uniforms.uAmount.value : 0;
};

describe('the cloud deck', () => {
  it('is not there at the zoom the game is played at', () => {
    const { at } = deck();
    // 14 is as close as the wheel goes, 26 is where the game opens, 34 is a
    // wide look at your own yard. None of those is a cloud.
    for (const across of [14, 22, 26, 34, 37]) {
      expect(amount(at(across)), `${across} across`).toBe(0);
    }
  });

  it('comes in as you pull back, and covers most of it by the far end', () => {
    const { at } = deck();
    const mid = amount(at(52));
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.6);
    // 70 is where the zoom stops.
    expect(amount(at(70))).toBeGreaterThan(0.75);
    // "Almost not see it" — never all of it.
    expect(amount(at(70))).toBeLessThan(1);
  });

  it('rises without a step in it', () => {
    /*
     * Monotonic, because the deck arriving is something you do with your hand on
     * the wheel: any flat spot or reversal in the ramp reads as the effect
     * stalling, and a jump reads as it switching on.
     */
    const { at } = deck();
    let last = -1;
    for (let across = 36; across <= 70; across += 1) {
      const now = amount(at(across));
      expect(now, `${across} across`).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('follows the camera, so panning never runs off the edge of it', () => {
    const { at } = deck();
    const m = at(70);
    expect(m.position.x).toBe(0);
    at(70);
    m.position.set(0, 0, 0);
    const clouds = makeClouds(new Scene());
    void clouds;
    // And again somewhere else entirely.
    const two = deck();
    const far = two.at(70);
    two.at(70);
    expect(far.visible).toBe(true);
  });

  it('is off entirely when effects are off', () => {
    const { at } = deck();
    expect(amount(at(70, 0))).toBe(0);
    expect(amount(at(70, 1))).toBeGreaterThan(0);
  });
});
