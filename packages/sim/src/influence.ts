/**
 * The influence area: what you can see, and therefore what you can work in.
 *
 * One mechanic doing four jobs. Beyond your influence the district fades out —
 * you cannot see it, take contracts in it, or buy anything there — so it is
 * fog of war, and it is also the tutorial (the only visible things are the
 * things to do next), the tech tree (progress is a place on the map rather than
 * a list), and the reason you cannot open the game by driving into the city.
 *
 * It grows two ways, both of them things the player is doing anyway:
 *
 *   **Trading**, which pushes the boundary out from everywhere you already are.
 *
 *   **Owning**, which is the interesting one: every place you buy is a
 *   *beachhead* that projects influence around itself. That turns a purchase
 *   into a foothold rather than an income, so buying the far shop and buying
 *   the near farm become genuinely different decisions — one is cheap and pays,
 *   the other is dear and opens the map.
 *
 * Stored as a field rather than a set of circles because the renderer wants a
 * per-tile number to fade with, and because overlapping circles with a hard
 * union produce exactly the lumpy scalloped edge that would make this look like
 * a mechanic instead of like a place.
 */

/** How far influence reaches from a source, per unit of its strength. */
export const REACH_PER_STRENGTH = 9;

/** The softness of the boundary, in tiles. Wide, because a hard line on the
 *  ground reads as a game rule and a soft one reads as distance. */
export const FALLOFF = 11;

export interface InfluenceSource {
  x: number;
  y: number;
  /** How far this one reaches. A yard is modest; a shop in a town is not. */
  strength: number;
}

export class InfluenceField {
  readonly size: number;
  /** 0 outside, 1 well inside. The renderer fades with this. */
  readonly value: Float32Array;
  /** Bumped whenever the field changes, so the renderer knows to rebuild
   *  rather than sampling it every frame. */
  version = 0;

  constructor(size: number) {
    this.size = size;
    this.value = new Float32Array(size * size);
  }

  /**
   * Recompute from a list of sources.
   *
   * Called on purchase and on a slow tick, never per frame. A brute-force pass
   * over every tile against every source is fine at a handful of sources and a
   * 128² district — sixteen thousand tiles against a dozen beachheads is
   * nothing, and it is exact, which a flood fill would not be.
   */
  rebuild(sources: InfluenceSource[]): void {
    const s = this.size;
    this.value.fill(0);
    for (const src of sources) {
      const reach = src.strength * REACH_PER_STRENGTH;
      const outer = reach + FALLOFF;
      const x0 = Math.max(0, Math.floor(src.x - outer));
      const x1 = Math.min(s - 1, Math.ceil(src.x + outer));
      const y0 = Math.max(0, Math.floor(src.y - outer));
      const y1 = Math.min(s - 1, Math.ceil(src.y + outer));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - src.x;
          const dy = y - src.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > outer) continue;
          /*
           * Smooth, and taken as a maximum rather than a sum.
           *
           * Summing would make two adjacent yards reach further together than
           * either does alone, which sounds reasonable and is not: influence is
           * about presence, and being present twice in one village does not put
           * you in the next one. A maximum also keeps the union of several
           * sources a smooth blob rather than a scalloped edge.
           */
          const t = d <= reach ? 1 : 1 - (d - reach) / FALLOFF;
          const eased = t * t * (3 - 2 * t);
          const i = y * s + x;
          if (eased > this.value[i]) this.value[i] = eased;
        }
      }
    }
    this.version++;
  }

  at(tile: number): number {
    return this.value[tile] ?? 0;
  }

  /** Can the player act here at all? The threshold is low, so the visible edge
   *  and the usable edge are close but the usable one is inside it. */
  usable(tile: number): boolean {
    return (this.value[tile] ?? 0) > 0.35;
  }
}
