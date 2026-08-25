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
import { CROP, FENCE, HEDGE, WALL, LAND, shade, type RGB } from './palette.ts';

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
  /**
   * A stream or a river, as opposed to the sea.
   *
   * Asked separately because they are not the same thing to look at and were
   * being drawn as the same thing — which is to say, as grass. The terrain has
   * carved watercourses since the beginning (see `carveRivers`), five of them,
   * a few hundred tiles between them, complete with graded banks. Nothing ever
   * drew them: `isWater` tested the sea level and nothing tested the flag, so
   * every stream in the district was a dry valley with a green floor.
   */
  isStream: (tile: number) => boolean;
  /** 0 outside your influence, 1 well inside. The world fades out beyond it. */
  influence: (tile: number) => number;
}

/**
 * The colour of what you cannot reach.
 *
 * A pale, slightly cool mist rather than a dark shroud or a grey wash. The
 * district beyond your influence should still read as countryside — it is
 * scenery you can see the shape of and cannot touch — and a black fog would
 * make the map look small, which is the opposite of the intended effect.
 */
const MIST: RGB = [0.80, 0.845, 0.86];

/** Fade a colour out toward the mist. */
function faded(c: RGB, influence: number): RGB {
  if (influence >= 0.999) return c;
  // Squared, so the inside of the boundary stays fully coloured and the falloff
  // happens close to the edge. A linear fade washes out half the visible world.
  const k = influence * influence;
  return [
    c[0] * k + MIST[0] * (1 - k),
    c[1] * k + MIST[1] * (1 - k),
    c[2] * k + MIST[2] * (1 - k),
  ];
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
 * The height of the ground surface at any point, exactly as drawn.
 *
 * "The cars are still bouncing on the ground. I think they sample the max
 * height of the square rather than floating along its current height" — which is
 * precisely what was happening. The old reading took the *highest of the four
 * corners of the tile*, which is one value for the whole tile, so a vehicle
 * crossing a slope climbed in tile-sized steps and hopped at every boundary.
 *
 * This reads the surface itself. Same corner heights, same choice of diagonal,
 * and then the barycentric interpolation inside whichever of the two triangles
 * the point actually falls in — so the answer is not merely smooth, it is the
 * height of the very triangle being rendered under the wheels. It lives here,
 * next to the loop that builds those triangles, because the two agreeing is the
 * whole point and a copy in another file would drift.
 */
export function groundHeightAt(src: GroundSource, x: number, z: number): number {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  const h00 = cornerHeight(src, tx, tz);
  const h10 = cornerHeight(src, tx + 1, tz);
  const h01 = cornerHeight(src, tx, tz + 1);
  const h11 = cornerHeight(src, tx + 1, tz + 1);
  const u = x - tx;
  const v = z - tz;
  // The same shorter-diagonal test the mesh uses, so a ridge is a ridge here too.
  if (Math.abs(h00 - h11) > Math.abs(h10 - h01)) {
    return u >= v
      ? h00 + (h10 - h00) * u + (h11 - h10) * v
      : h00 + (h01 - h00) * v + (h11 - h01) * u;
  }
  return u + v <= 1
    ? h00 + (h10 - h00) * u + (h01 - h00) * v
    : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
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
      } else if (src.isStream(tile)) {
        /*
         * The water, and a wet edge where it meets the field.
         *
         * A tile with dry land on any side of it is the bank, and gets the
         * paler gravel colour. Nothing in England has a hard edge between water
         * and grass, and at this scale a stream two tiles wide with a hard edge
         * reads as a painted stripe — the one tile of shallows is most of what
         * makes it read as water lying in a channel instead.
         */
        const bank = (x > 0 && !src.isStream(tile - 1))
          || (x + 1 < s && !src.isStream(tile + 1))
          || (y > 0 && !src.isStream(tile - s))
          || (y + 1 < s && !src.isStream(tile + s));
        colour = bank ? LAND.shallow : LAND.stream;
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
      colour = faded(colour, src.influence(tile));

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
  /*
   * Thin and low. Two passes at this: 0.13 by 0.40 read as garden walls, and at
   * a ten-tile field they were the loudest thing in the frame. A hedge wants to
   * be the strongest *line* and not the tallest object.
   */
  const T = 0.095;
  const H = 0.21;
  const TAPER = 0.80;

  /**
   * What kind of boundary two fields share.
   *
   * Keyed on the *pair* of parcel ids, not on the tile, and that is the whole
   * trick: every tile along one boundary gets the same answer, so a run is a
   * wall for its length and the next one along is a hedge. Hashing the tile
   * instead would change material every yard, which is not a boundary, it is a
   * skip.
   */
  const kindOf = (a: number, b: number): number => {
    const pa = src.parcel[a];
    const pb = src.parcel[b];
    const lo = Math.min(pa, pb);
    const hi = Math.max(pa, pb);
    const n = (((lo + 1) * 2654435761) ^ ((hi + 1) * 2246822519)) >>> 0;
    const r = (n >>> 8) & 1023;
    if (r < 560) return 0;        // hedge, and still most of the country
    if (r < 700) return 1;        // an overgrown one
    if (r < 880) return 2;        // post and rail
    return 3;                     // dry stone
  };

  /**
   * Draw one tile's worth of boundary, whichever kind it is.
   *
   * `alongZ` says which way the run goes, and it is the only difference between
   * the two axes — everything else is shared, so adding a kind of boundary is one
   * case here rather than two.
   */
  const boundary = (
    kind: number, alongZ: boolean, cx: number, base: number, cz: number,
    h: number, inf: number, jitter: number, hedge: RGB,
  ): void => {
    /** Half-extents for something `t` thick across the run and `l` along it. */
    const ext = (t: number, l: number): [number, number] => (
      alongZ ? [t, l] : [l, t]);

    if (kind === 1) {
      // Overgrown: nearly twice as thick and a little taller, and it keeps the
      // hedge colour — an old hedge is the same plant, left alone.
      const [hx, hz] = ext(T * 1.9, 0.5);
      wedge(m, cx, base, cz, hx, hz, h * 1.14, 0.70, hedge);
      return;
    }

    if (kind === 2) {
      /*
       * Post and rail.
       *
       * Two rails and three posts, which is the fewest that reads as a fence: the
       * rails give the horizontal line and the posts break it up, and without the
       * posts it is a plank on edge. Deliberately *lower* than a hedge — you can
       * see over a fence, which is most of why a paddock is fenced and not
       * hedged, and at this size the difference in height is what tells them
       * apart before the colour does.
       */
      const rail = faded(FENCE.rail, inf);
      const post = faded(FENCE.post, inf);
      const fh = h * 0.72;
      for (const at of [0.62, 0.30]) {
        const [hx, hz] = ext(0.026, 0.5);
        wedge(m, cx, base + fh * at, cz, hx, hz, fh * 0.16, 1, rail);
      }
      for (const off of [-0.34, 0, 0.34]) {
        const [hx, hz] = ext(0.05, 0.05);
        wedge(m, alongZ ? cx : cx + off, base, alongZ ? cz + off : cz,
          hx, hz, fh, 0.9, post);
      }
      return;
    }

    if (kind === 3) {
      /*
       * Dry stone. Vertical rather than tapered, because that is what makes it
       * read as *built* — a hedge narrows toward the top and a wall does not, and
       * that silhouette difference survives at any zoom the game is played at.
       * A course of paler stone along the top catches the light the way a coping
       * does.
       */
      const stone = faded((jitter & 3) === 0 ? WALL.stone : WALL.shadow, inf);
      const cap = faded(WALL.stone, inf);
      const [hx, hz] = ext(T * 1.3, 0.5);
      wedge(m, cx, base, cz, hx, hz, h * 0.82, 0.97, stone);
      const [cx2, cz2] = ext(T * 1.45, 0.5);
      wedge(m, cx, base + h * 0.82, cz, cx2, cz2, h * 0.09, 0.9, cap);
      return;
    }

    const [hx, hz] = ext(T, 0.5);
    wedge(m, cx, base, cz, hx, hz, h, TAPER, hedge);
  };

  const wants = (a: number, b: number): boolean => {
    if (src.parcel[a] === src.parcel[b]) return false;
    if (src.parcel[a] === NO_PARCEL || src.parcel[b] === NO_PARCEL) return false;
    /*
     * No hedges outside your influence, and this is a fix rather than a saving.
     *
     * Fading their *colour* was not enough: a hedge is a vertical surface, so
     * its sides catch almost no light from a sun overhead, and a pale hedge in
     * pale mist still renders as a dark dash. The result was the far half of the
     * district reading as scattered black marks on fog.
     *
     * Dropping the detail is also what the mechanic wants. Beyond the boundary
     * you can see the *shape* of the country and not what is in it, which is
     * both truer and the reason to go there.
     */
    if (Math.max(src.influence(a), src.influence(b)) < 0.06) return false;
    // A gap where the road goes through.
    return !src.hasRoad(a) && !src.hasRoad(b);
  };

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const tile = y * s + x;
      // Vary the colour and height along a run so a boundary is a hedgerow
      // rather than an extrusion.
      const jitter = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const inf = src.influence(tile);
      /*
       * Hedges shrink into the ground as influence falls away.
       *
       * Cutting them off at a threshold left a ragged fringe of dark marks
       * along the boundary — a hedge is a vertical surface, so it catches almost
       * no light from a high sun and stays dark however pale its colour is
       * made. Scaling the height means they sink rather than pop, so the
       * boundary is a place where the country loses its detail instead of a line
       * where the hedges stop.
       */
      const h = (H + ((jitter & 63) / 63 - 0.4) * 0.20) * Math.min(1, inf * 1.6);
      const c = faded((jitter & 3) === 0 ? HEDGE.lit : HEDGE.dark, inf);
      if (h < 0.02) continue;

      if (x + 1 < s && wants(tile, tile + 1)) {
        const base = Math.max(cornerHeight(src, x + 1, y), cornerHeight(src, x + 1, y + 1));
        boundary(kindOf(tile, tile + 1), true, x + 1, base, y + 0.5, h, inf, jitter, c);
      }
      if (y + 1 < s && wants(tile, tile + s)) {
        const base = Math.max(cornerHeight(src, x, y + 1), cornerHeight(src, x + 1, y + 1));
        boundary(kindOf(tile, tile + s), false, x + 0.5, base, y + 1, h, inf, jitter, c);
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
