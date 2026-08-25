/**
 * The ground: fields, hedges, and the relief under them.
 *
 * Built against `art/reference/TARGET-FRAME.png`, which is the whole point of
 * this file existing rather than the old `scene.ts` terrain pass. That pass
 * coloured every tile from its biome, which is a per-tile lottery and reads as
 * camouflage — the single largest reason the old build looked like a prototype.
 *
 * Three things here, in the order they matter:
 *
 *   **Fields.** One mesh per parcel, one colour per parcel, with crop rows.
 *   The parcels come from the sim (`fields.ts`, recursive subdivision), so the
 *   renderer's job is only to draw them as surfaces rather than as tiles.
 *
 *   **Hedges.** Geometry on the *boundary* between two parcels, not a tile
 *   painted green. At five tiles to a field, a one-tile hedge is a wall; a
 *   hedge on the edge is a hedge. Gaps where a road crosses, because a lane
 *   ploughing through a hedgerow looks wrong before you can say why.
 *
 *   **Crop rows.** A handful of slightly darker stripes per field. Cheap, and
 *   they do more for "this is cultivated" than any colour choice — a flat
 *   colour reads as paper.
 */

import { BufferGeometry, Mesh as ThreeMesh, type Material } from 'three';
import { Mesh } from './geometry.ts';
import { CROP, HEDGE, LAND, shade, type RGB } from './palette.ts';

/** Height units to world units. A tile is one world unit. */
export const HEIGHT_TO_WORLD = (h: number): number => (h / 64) * 0.42;

export interface GroundSource {
  size: number;
  height: Int16Array;
  /** Parcel index per tile, or -1. */
  parcel: Int32Array;
  /** Crop index per tile. */
  crop: Uint8Array;
  /** True where a road covers the tile, so hedges leave a gap. */
  hasRoad: (tile: number) => boolean;
  isWater: (tile: number) => boolean;
}

const NO_PARCEL = -1;

/**
 * Corner height, averaged over the four tiles meeting there.
 *
 * Averaging is what makes the surface continuous. It also rounds everything
 * off, which was a fair complaint about the old terrain — but the fix for that
 * was erosion in the *heightfield*, not sharper triangles here. A discontinuous
 * mesh is worse than a smooth one.
 */
function cornerHeight(src: GroundSource, x: number, y: number): number {
  const s = src.size;
  let sum = 0;
  for (let dy = -1; dy <= 0; dy++) {
    for (let dx = -1; dx <= 0; dx++) {
      const tx = Math.max(0, Math.min(s - 1, x + dx));
      const ty = Math.max(0, Math.min(s - 1, y + dy));
      sum += src.height[ty * s + tx];
    }
  }
  return HEIGHT_TO_WORLD(sum / 4);
}

/**
 * Build the ground for one chunk of the map.
 *
 * Chunked because a 128² district is sixteen thousand tiles and rebuilding all
 * of it when one field changes is a stall. Everything below writes into one
 * mesh, so a chunk is one draw call.
 */
export function buildGround(
  src: GroundSource, x0: number, y0: number, x1: number, y1: number,
): Mesh {
  const s = src.size;
  const m = new Mesh((x1 - x0) * (y1 - y0) * 12);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const tile = y * s + x;
      const h00 = cornerHeight(src, x, y);
      const h10 = cornerHeight(src, x + 1, y);
      const h01 = cornerHeight(src, x, y + 1);
      const h11 = cornerHeight(src, x + 1, y + 1);

      let colour: RGB;
      if (src.isWater(tile)) {
        colour = LAND.water;
      } else {
        const p = src.parcel[tile];
        colour = p === NO_PARCEL ? CROP[6] : (CROP[src.crop[tile]] ?? CROP[6]);
        /*
         * Crop rows, as a stripe on alternate tiles across the field.
         *
         * Done per tile rather than as separate geometry: a field is five to
         * thirteen tiles across, so striping every other tile row gives a
         * rhythm at exactly the frequency the target frame has, for no extra
         * triangles at all.
         */
        if (p !== NO_PARCEL) {
          const along = (p & 1) === 0 ? y : x;
          if (along % 2 === 0) colour = shade(colour, 0.945);
        }
      }

      /*
       * Split the quad along the shorter diagonal, so a ridge stays a ridge
       * rather than being bridged flat by whichever triangulation the loop
       * happened to pick.
       */
      const flip = Math.abs(h00 - h11) > Math.abs(h10 - h01);
      if (flip) {
        m.tri(x, h00, y, x + 1, h11, y + 1, x + 1, h10, y, colour);
        m.tri(x, h00, y, x, h01, y + 1, x + 1, h11, y + 1, colour);
      } else {
        m.tri(x, h00, y, x, h01, y + 1, x + 1, h10, y, colour);
        m.tri(x + 1, h10, y, x, h01, y + 1, x + 1, h11, y + 1, colour);
      }
    }
  }

  buildHedges(src, m, x0, y0, x1, y1);
  return m;
}

/**
 * Hedges, on the boundaries.
 *
 * A hedge is a low wedge standing on the edge between two tiles whose parcels
 * differ. Tapered towards the top so it is a hedge and not a wall — the target
 * frame tapered to 0.72 first and they read as grass banks, so 0.80 it is.
 */
function buildHedges(
  src: GroundSource, m: Mesh, x0: number, y0: number, x1: number, y1: number,
): void {
  const s = src.size;
  /** Thin. A hedge wants to be a line, and the strongest lines in the frame. */
  const T = 0.13;
  const H = 0.40;
  const TAPER = 0.80;

  const wants = (a: number, b: number): boolean => {
    if (src.parcel[a] === src.parcel[b]) return false;
    if (src.parcel[a] === NO_PARCEL || src.parcel[b] === NO_PARCEL) return false;
    // A gap where the road goes through.
    return !src.hasRoad(a) && !src.hasRoad(b);
  };

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const tile = y * s + x;
      // Vary the colour and height along a run so a boundary is a hedgerow
      // rather than an extrusion.
      const jitter = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const h = H + ((jitter & 63) / 63 - 0.4) * 0.20;
      const c = (jitter & 3) === 0 ? HEDGE.lit : HEDGE.dark;

      if (x + 1 < s && wants(tile, tile + 1)) {
        const base = Math.max(cornerHeight(src, x + 1, y), cornerHeight(src, x + 1, y + 1));
        wedge(m, x + 1, base, y + 0.5, T, 0.5, h, TAPER, c);
      }
      if (y + 1 < s && wants(tile, tile + s)) {
        const base = Math.max(cornerHeight(src, x, y + 1), cornerHeight(src, x + 1, y + 1));
        wedge(m, x + 0.5, base, y + 1, 0.5, T, h, TAPER, c);
      }
    }
  }
}

/** A tapered box: four sides and a narrower top. Six quads and it is a hedge. */
function wedge(
  m: Mesh, cx: number, base: number, cz: number,
  hx: number, hz: number, height: number, taper: number, c: RGB,
): void {
  const top = base + height;
  const tx = hx * taper;
  const tz = hz * taper;
  const lit = shade(c, 1.18);
  // Top.
  m.quad(cx - tx, top, cz - tz, cx + tx, top, cz - tz,
         cx + tx, top, cz + tz, cx - tx, top, cz + tz, lit);
  // Four sides, sloping inwards.
  m.quad(cx - hx, base, cz - hz, cx + hx, base, cz - hz,
         cx + tx, top, cz - tz, cx - tx, top, cz - tz, c);
  m.quad(cx + hx, base, cz + hz, cx - hx, base, cz + hz,
         cx - tx, top, cz + tz, cx + tx, top, cz + tz, c);
  m.quad(cx - hx, base, cz + hz, cx - hx, base, cz - hz,
         cx - tx, top, cz - tz, cx - tx, top, cz + tz, shade(c, 0.88));
  m.quad(cx + hx, base, cz - hz, cx + hx, base, cz + hz,
         cx + tx, top, cz + tz, cx + tx, top, cz - tz, shade(c, 1.06));
}

/** Wrap a built mesh so the caller does not need three.js imported. */
export function toMesh(m: Mesh, material: Material): ThreeMesh {
  const g: BufferGeometry = m.build();
  const mesh = new ThreeMesh(g, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
