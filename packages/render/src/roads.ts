/**
 * Roads that look like roads.
 *
 * "The roads aren't even real roads" was the right complaint about the old
 * build, and it was right for two reasons that both live here.
 *
 * **They had no hierarchy.** Every way was drawn the same width in the same
 * grey, so a network joining everything to everything read as a spiderweb
 * rather than as a road system. Measured, the density was actually *lower* than
 * a real district's — 50 km of road in an 8 km square against a real 120 —
 * so the problem was never how much. It was that an A-road, a lane and a farm
 * track looked identical.
 *
 * **They were drawn as diagrams.** A hub in the middle of the tile and an arm
 * to each connected edge, sized so junctions read from above. That is a graph
 * visualisation. A road is a *surface*: a verge, a cambered top, two worn wheel
 * tracks, and lining. Four layers, and it reads immediately — which is what the
 * target frame demonstrates.
 *
 * So each class has its own width, colour and furniture, and each is built as a
 * continuous ribbon that meets its neighbour at the midpoint of the shared tile
 * edge. That last part is what stops a road on a gradient becoming a string of
 * disconnected plates.
 */

import { Mesh } from './geometry.ts';
import { ROAD, GLOW, type RGB } from './palette.ts';
import { HEIGHT_TO_WORLD } from './ground.ts';

/**
 * The hierarchy. Three classes, and the differences are deliberately large —
 * the whole failure of the old renderer was that they were not.
 */
export const RoadClass = { Track: 0, Lane: 1, Spine: 2 } as const;
export type RoadClass = (typeof RoadClass)[keyof typeof RoadClass];

interface Style {
  /** Half-width of the running surface, in tiles. */
  half: number;
  /** Cat's eyes down the middle. A farm track has none, which is both true and
   *  the cheapest possible way to make the hierarchy legible after dark. */
  studs: boolean;
  /** Half-width of the verge outside it. */
  verge: number;
  surface: RGB;
  /** Worn wheel tracks, or none on a farm track that is mud anyway. */
  worn: boolean;
  /** Dashed centre line, which only a proper road gets. */
  lined: boolean;
}

const STYLE: Style[] = [
  { half: 0.16, studs: false, verge: 0.26, surface: ROAD.track, worn: false, lined: false },
  { half: 0.26, studs: true, verge: 0.40, surface: ROAD.lane, worn: true, lined: false },
  { half: 0.36, studs: true, verge: 0.52, surface: ROAD.spine, worn: true, lined: true },
];

export interface RoadSource {
  size: number;
  height: Int16Array;
  /** Road class per tile, or -1 for none. */
  roadClass: Int8Array;
  /** The formation level per tile, if the way was graded. 0 means follow the
   *  ground. */
  level: Int16Array;
  influence: (tile: number) => number;
}

/** Matches ground.ts. A road that stayed sharp while the fields round it faded
 *  would draw the eye to exactly the part of the map you cannot use. */
const MIST: RGB = [0.80, 0.845, 0.86];

function faded(c: RGB, influence: number): RGB {
  if (influence >= 0.999) return c;
  const k = influence * influence;
  return [
    c[0] * k + MIST[0] * (1 - k),
    c[1] * k + MIST[1] * (1 - k),
    c[2] * k + MIST[2] * (1 - k),
  ];
}

const DX = [0, 1, 0, -1];
const DZ = [-1, 0, 1, 0];

function surfaceY(src: RoadSource, tile: number): number {
  const lv = src.level[tile];
  return (lv !== 0 ? HEIGHT_TO_WORLD(lv) : HEIGHT_TO_WORLD(src.height[tile])) + 0.02;
}

/**
 * Build the roads in a chunk.
 *
 * A tile's road is a hub plus an arm towards each neighbour that also has road,
 * and the arm reaches exactly half a tile so it meets its neighbour's arm on
 * the shared edge. Both tiles compute the same height for that edge — the mean
 * of the two surface levels — so the ribbon is continuous however steep the
 * ground.
 */
export function buildRoads(
  src: RoadSource, x0: number, y0: number, x1: number, y1: number,
): Mesh {
  const s = src.size;
  const m = new Mesh((x1 - x0) * (y1 - y0) * 40);

  /*
   * Paved, not segmented.
   *
   * The first version drew a hub in the middle of each tile and an arm out to
   * each connected edge. Even with the arms ramping to meet at the shared edge
   * that reads as "drawn in segments rather than perfectly paved", because it
   * *is* segments: every tile contributes its own quads, so every tile boundary
   * is a seam where two surfaces meet at slightly different angles and the light
   * catches the join.
   *
   * The fix is to stop thinking per tile. A road tile's surface is one quad
   * spanning the whole tile — corner to corner, at the four corner heights — so
   * neighbouring tiles share their corner heights exactly and the surface is
   * continuous by construction. The width comes from insetting the quad on the
   * axes the road does *not* run along, so a straight run is a ribbon and a
   * junction is the full tile.
   *
   * It is also fewer triangles: two per tile for the surface instead of ten.
   */
  const cornerY = (x: number, z: number): number => {
    // Mean of the up-to-four road tiles meeting at this corner, so two
    // neighbours agree on the height of the edge they share.
    let sum = 0;
    let hits = 0;
    for (let dz = -1; dz <= 0; dz++) {
      for (let dx = -1; dx <= 0; dx++) {
        const tx = x + dx;
        const tz = z + dz;
        if (tx < 0 || tz < 0 || tx >= s || tz >= s) continue;
        const t = tz * s + tx;
        if (src.roadClass[t] < 0) continue;
        sum += surfaceY(src, t);
        hits++;
      }
    }
    if (hits > 0) return sum / hits;
    // No road at this corner: sit on the ground.
    const tx = Math.max(0, Math.min(s - 1, x));
    const tz = Math.max(0, Math.min(s - 1, z));
    return HEIGHT_TO_WORLD(src.height[tz * s + tx]) + 0.02;
  };

  for (let z = y0; z < y1; z++) {
    for (let x = x0; x < x1; x++) {
      const tile = z * s + x;
      const cls = src.roadClass[tile];
      if (cls < 0) continue;
      const st = STYLE[cls] ?? STYLE[1];
      const inf = src.influence(tile);

      // Which way the road runs through this tile.
      let west = x > 0 && src.roadClass[tile - 1] >= 0;
      let east = x + 1 < s && src.roadClass[tile + 1] >= 0;
      let north = z > 0 && src.roadClass[tile - s] >= 0;
      let south = z + 1 < s && src.roadClass[tile + s] >= 0;
      const ends = (west ? 1 : 0) + (east ? 1 : 0) + (north ? 1 : 0) + (south ? 1 : 0);
      // A dead end still needs a stub, or a farm track stops a tile short of
      // the farm.
      if (ends === 0) { west = true; east = true; }

      /*
       * The inset. A tile the road runs east-west is full width across X and
       * narrow in Z; a junction is full width both ways. That single rule gives
       * ribbons along runs and proper squares at crossings, with no special
       * cases for corners — a corner is simply a tile that is open on one of
       * each axis.
       */
      const openX = west || east;
      const openZ = north || south;
      const nx0 = west ? 0 : 0.5 - st.half;
      const nx1 = east ? 1 : 0.5 + st.half;
      const nz0 = north ? 0 : 0.5 - st.half;
      const nz1 = south ? 1 : 0.5 + st.half;
      // Narrow the axis the road does not run along.
      const sx0 = openX ? nx0 : 0.5 - st.half;
      const sx1 = openX ? nx1 : 0.5 + st.half;
      const sz0 = openZ ? nz0 : 0.5 - st.half;
      const sz1 = openZ ? nz1 : 0.5 + st.half;

      // Verge first and wider, so the surface sits inside it.
      const v = st.verge - st.half;
      quadAt(m, cornerY, x, z,
             sx0 - v, sz0 - v, sx1 + v, sz1 + v, -0.008, faded(ROAD.verge, inf));
      quadAt(m, cornerY, x, z, sx0, sz0, sx1, sz1, 0, faded(st.surface, inf));

      if (st.worn && inf > 0.18) {
        // Two wheel tracks along whichever way the road runs.
        const w2 = st.half * 0.30;
        if (openX) {
          for (const off of [-st.half * 0.48, st.half * 0.48]) {
            quadAt(m, cornerY, x, z, sx0, 0.5 + off - w2, sx1, 0.5 + off + w2,
                   0.004, faded(ROAD.worn, inf));
          }
        } else {
          for (const off of [-st.half * 0.48, st.half * 0.48]) {
            quadAt(m, cornerY, x, z, 0.5 + off - w2, sz0, 0.5 + off + w2, sz1,
                   0.004, faded(ROAD.worn, inf));
          }
        }
      }
      if (st.lined && inf > 0.18 && ends === 2 && (openX !== openZ)) {
        // A dash down the middle of a straight run only. A junction with lining
        // through it looks like a mistake.
        const d = 0.03;
        if (openX) {
          quadAt(m, cornerY, x, z, 0.28, 0.5 - d, 0.72, 0.5 + d,
                 0.006, faded(ROAD.line, inf));
        } else {
          quadAt(m, cornerY, x, z, 0.5 - d, 0.28, 0.5 + d, 0.72,
                 0.006, faded(ROAD.line, inf));
        }
      }
    }
  }
  return m;
}

/**
 * Cat's eyes.
 *
 * A separate mesh from the road, because these are the one thing on the ground
 * that must not be lit: they are drawn unlit and blended additively, so they
 * are invisible against a bright afternoon and are the brightest things in the
 * district after dark. A lit stud would go out at dusk, which is precisely
 * backwards.
 *
 * Two studs on a straight tile and one at a junction, down whichever axis the
 * road runs, so a lane reads as a dotted line at any zoom. Tracks get none —
 * an unadopted farm track has no reflective studs, and the absence is worth
 * more than the geometry: after dark the network shows you its own hierarchy.
 *
 * The whole thing is about three hundred triangles per chunk, which is less
 * than one hedge.
 */
export function buildCatsEyes(
  src: RoadSource, x0: number, y0: number, x1: number, y1: number,
): Mesh {
  const s = src.size;
  const m = new Mesh((x1 - x0) * (y1 - y0) * 12);
  const R = 0.028;

  const studAt = (x: number, z: number, u: number, v: number, c: RGB): void => {
    const t = z * s + x;
    const y = surfaceY(src, t) + 0.014;
    m.quad(
      x + u - R, y, z + v - R, x + u + R, y, z + v - R,
      x + u + R, y, z + v + R, x + u - R, y, z + v + R, c, 1,
    );
  };

  for (let z = y0; z < y1; z++) {
    for (let x = x0; x < x1; x++) {
      const tile = z * s + x;
      const cls = src.roadClass[tile];
      if (cls < 0) continue;
      const st = STYLE[cls] ?? STYLE[1];
      if (!st.studs) continue;
      // Beyond your influence there is nothing to see, at any hour.
      if (src.influence(tile) < 0.18) continue;

      const west = x > 0 && src.roadClass[tile - 1] >= 0;
      const east = x + 1 < s && src.roadClass[tile + 1] >= 0;
      const north = z > 0 && src.roadClass[tile - s] >= 0;
      const south = z + 1 < s && src.roadClass[tile + s] >= 0;
      const openX = west || east;
      const openZ = north || south;

      if (openX !== openZ) {
        // A straight run: two studs, so the spacing reads as a rhythm rather
        // than as one dot per tile.
        if (openX) {
          studAt(x, z, 0.25, 0.5, GLOW.catseye);
          studAt(x, z, 0.75, 0.5, GLOW.catseye);
        } else {
          studAt(x, z, 0.5, 0.25, GLOW.catseye);
          studAt(x, z, 0.5, 0.75, GLOW.catseye);
        }
      } else {
        studAt(x, z, 0.5, 0.5, GLOW.catseye);
      }
    }
  }
  return m;
}

/**
 * One quad within a tile, with its corners taken from the shared corner
 * heights so it lines up exactly with its neighbours.
 */
function quadAt(
  m: Mesh, cornerY: (x: number, z: number) => number,
  tx: number, tz: number,
  u0: number, v0: number, u1: number, v1: number, lift: number, c: RGB,
): void {
  // Bilinear over the tile's four corner heights, so a quad that does not reach
  // the tile edge still sits on the same surface as one that does.
  const h00 = cornerY(tx, tz);
  const h10 = cornerY(tx + 1, tz);
  const h01 = cornerY(tx, tz + 1);
  const h11 = cornerY(tx + 1, tz + 1);
  const at = (u: number, v: number): number => {
    const a = h00 * (1 - u) + h10 * u;
    const b = h01 * (1 - u) + h11 * u;
    return a * (1 - v) + b * v + lift;
  };
  m.quad(
    tx + u0, at(u0, v0), tz + v0,
    tx + u1, at(u1, v0), tz + v0,
    tx + u1, at(u1, v1), tz + v1,
    tx + u0, at(u0, v1), tz + v1,
    c,
  );
}



