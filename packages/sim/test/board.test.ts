/**
 * The contract board shows the district, not the first five things in it.
 *
 * Three bugs met here and each one was invisible from inside the game — a
 * cargo nobody offers looks exactly like a cargo nobody wants, and a place that
 * never appears as a destination looks like a place with no needs. All three were
 * loop bounds.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, TICKS_PER_DAY } from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

/** A world with the whole district in sight, so nothing is hidden by fog. */
function district(seed: number) {
  const w = createWorld({ seed, size: 128, townCount: 3, companyCount: 1 });
  w.tick = 60 * TICKS_PER_DAY;
  w.primeStock();
  const src: { x: number; y: number; strength: number }[] = [];
  for (let x = 8; x < 128; x += 12) {
    for (let z = 8; z < 128; z += 12) src.push({ x, y: z, strength: 3.2 });
  }
  w.refreshInfluence(src);
  return w;
}

/** Every offer seen over ten rounds of the board. */
function sweep(w: ReturnType<typeof district>): {
  cargoes: Set<string>; froms: Set<number>; tos: Set<number>;
} {
  const cargoes = new Set<string>();
  const froms = new Set<number>();
  const tos = new Set<number>();
  for (let r = 0; r < 10; r++) {
    w.offerWorkNow();
    const b = w.contractBoard;
    for (let i = 0; i < b.count; i++) {
      if (b.state[i] === 3) continue;
      cargoes.add(w.content.cargo[b.cargo[i]].id);
      froms.add(b.from[i]);
      tos.add(b.to[i]);
    }
    for (let d = 0; d < 9; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
  }
  return { cargoes, froms, tos };
}

describe('the contract board', () => {
  it('offers more than one cargo from a place that makes two', () => {
    /*
     * An arable farm grows grain *and* produce. The board asked each site for its
     * fullest shed and refused it a second offer, so grain — always the bigger
     * heap — was the only thing an arable farm ever offered, and produce was
     * never offered anywhere in the district on any seed.
     */
    const w = district(1985);
    const { cargoes } = sweep(w);
    expect(cargoes.has('grain')).toBe(true);
    expect(cargoes.has('produce')).toBe(true);
  });

  it('draws on more of the district than the lowest-numbered corner of it', () => {
    /*
     * Six slots and twenty-odd places, so the scan fills up long before the end
     * of the list — and it began at site zero every time, so the same handful of
     * places owned the board for the whole game. Measured before the fix: fifty
     * offers drawing on three cargoes out of thirteen; after, five.
     *
     * The numbers here are modest on purpose, and the reason is worth knowing: an
     * offer *stays* on the board until it is taken, so a full board makes very few
     * new offers per round however fairly it scans. Rotation decides who gets the
     * slots as they free up, not how fast they free up.
     */
    const w = district(1985);
    const { froms, cargoes } = sweep(w);
    expect(froms.size).toBeGreaterThan(3);
    expect(cargoes.size).toBeGreaterThan(3);
  });

  it('offers work into a village shop, which it never once did', () => {
    // The shop's whole reason to exist is that it is somewhere to haul to early.
    // Between the two bugs above it was never a destination on any seed.
    let seenOnAnySeed = false;
    for (const seed of [1985, 42]) {
      const w = district(seed);
      let shop = -1;
      for (let s = 0; s < w.sites.count; s++) {
        if (w.content.industries[w.sites.def[s]].id === 'village-shop') { shop = s; break; }
      }
      expect(shop).toBeGreaterThanOrEqual(0);
      if (sweep(w).tos.has(shop)) seenOnAnySeed = true;
    }
    expect(seenOnAnySeed).toBe(true);
  });

  it('still opens on the milk run the ladder is tuned to', () => {
    // The board decides the first job, so widening it could quietly retune the
    // opening. It does not: the anchor is a second van at about eight minutes.
    const w = district(1985);
    const opening = w.planOpening();
    expect(w.content.cargo[opening.cargo].id).toBe('milk');
  });
});
