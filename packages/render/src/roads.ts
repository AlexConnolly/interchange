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
import { ROAD, shade, type RGB } from './palette.ts';
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
  /** Half-width of the verge outside it. */
  verge: number;
  surface: RGB;
  /** Worn wheel tracks, or none on a farm track that is mud anyway. */
  worn: boolean;
  /** Dashed centre line, which only a proper road gets. */
  lined: boolean;
}

const STYLE: Style[] = [
  { half: 0.16, verge: 0.26, surface: ROAD.track, worn: false, lined: false },
  { half: 0.26, verge: 0.40, surface: ROAD.lane, worn: true, lined: false },
  { half: 0.36, verge: 0.52, surface: ROAD.spine, worn: true, lined: true },
];

export interface RoadSource {
  size: number;
  height: Int16Array;
  /** Road class per tile, or -1 for none. */
  roadClass: Int8Array;
  /** The formation level per tile, if the way was graded. 0 means follow the
   *  ground. */
  level: Int16Array;
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

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const tile = y * s + x;
      const cls = src.roadClass[tile];
      if (cls < 0) continue;
      const st = STYLE[cls] ?? STYLE[1];
      const yy = surfaceY(src, tile);
      const cx = x + 0.5;
      const cz = y + 0.5;

      // The verge goes down first and wider, so the surface sits inside it.
      flat(m, cx, yy - 0.006, cz, st.verge, st.verge, ROAD.verge);
      flat(m, cx, yy, cz, st.half, st.half, st.surface);

      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const nz = y + DZ[d];
        if (nx < 0 || nz < 0 || nx >= s || nz >= s) continue;
        const n = nz * s + nx;
        if (src.roadClass[n] < 0) continue;
        // The shared edge, at the mean of the two surfaces.
        const edgeY = (yy + surfaceY(src, n)) / 2;
        arm(m, cx, cz, d, st.verge, yy - 0.006, edgeY - 0.006, ROAD.verge);
        arm(m, cx, cz, d, st.half, yy, edgeY, st.surface);

        if (st.worn) {
          for (const off of [-st.half * 0.5, st.half * 0.5]) {
            armOffset(m, cx, cz, d, st.half * 0.30, off,
                      yy + 0.003, edgeY + 0.003, ROAD.worn);
          }
        }
        if (st.lined) {
          // Dashed: one dash per tile, which at forty pixels a tile is the
          // right rhythm and costs two triangles.
          armOffset(m, cx, cz, d, 0.035, 0,
                    yy + 0.005, edgeY + 0.005, ROAD.line, 0.42);
        }
      }
    }
  }
  return m;
}

function flat(m: Mesh, cx: number, y: number, cz: number, hx: number, hz: number, c: RGB): void {
  m.quad(cx - hx, y, cz - hz, cx + hx, y, cz - hz,
         cx + hx, y, cz + hz, cx - hx, y, cz + hz, c);
}

/** One arm, from the hub out to the shared edge, sloping to meet it. */
function arm(
  m: Mesh, cx: number, cz: number, d: number, half: number,
  inner: number, outer: number, c: RGB,
): void {
  armOffset(m, cx, cz, d, half, 0, inner, outer, c);
}

function armOffset(
  m: Mesh, cx: number, cz: number, d: number, half: number, side: number,
  inner: number, outer: number, c: RGB, shorten = 1.0,
): void {
  const ox = DX[d] * 0.5 * shorten;
  const oz = DZ[d] * 0.5 * shorten;
  // Perpendicular, for the lateral offset of a wheel track.
  const px = -DZ[d] * side;
  const pz = DX[d] * side;
  const ax = cx + px;
  const az = cz + pz;
  const bx = ax + ox;
  const bz = az + oz;
  const lit = shade(c, 1.0);
  if (DX[d] !== 0) {
    m.quad(ax, inner, az - half, bx, outer, bz - half,
           bx, outer, bz + half, ax, inner, az + half, lit);
  } else {
    m.quad(ax - half, inner, az, ax + half, inner, az,
           bx + half, outer, bz, bx - half, outer, bz, lit);
  }
}
