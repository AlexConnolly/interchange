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
import { nearFaceIsLow } from './camera.ts';
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
  /**
   * How much leaf there is on the district, 0..1 — see `foliage` in the sim.
   *
   * The hedges need the *number*, not just the tint the material applies: "you
   * recoloured the hedges? Is that it?" A hedge in February is not a green hedge
   * in brown, it is thinner, lower and full of holes, and none of that is a
   * colour. So the geometry is built differently by season, and the chunk mesh is
   * already rebuilt when the season turns.
   */
  leafiness: number;
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
  /**
   * Ground you own, by owning what stands on it.
   *
   * Drawn because ownership you cannot see is not ownership. It is also the one
   * place in the game where the *field boundaries already there* are doing a
   * second job: your land is whole parcels, so its edge is a hedge you can
   * already point at, and the tint only has to say which side of it you are on.
   */
  ownedLand: (tile: number) => boolean;
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
/**
 * How far the ground stands proud of the water as a solid thing.
 *
 * The district was a *sheet*: two triangles a tile and nothing underneath, so
 * from any angle that saw past the coast it read as a painted plane hanging in
 * the air — "the worlds should have a bit more of cube underneath them so they
 * don't look like a flat plane". Quite. A model on a table has a side to it.
 *
 * In world units, measured down from sea level, and much deeper than it first
 * looks as though it should be.
 *
 * Started at 0.30, which is about the depth of the deepest sea in the district and
 * therefore the arithmetically tidy answer. On screen it was a *line*: the camera
 * looks down at 38 degrees, so a vertical face is foreshortened to two thirds, and
 * a third of a tile of depth on a sixty-four tile block came out six pixels tall.
 * Colouring it bright blue for one screenshot was the only way to find it.
 *
 * And it is set against the thing it has to read beside, which took a second
 * measurement to get right. The first guess put the island at "about 0.85 units at
 * its hills" — picked off a screenshot, and wrong by an order of magnitude. Asking
 * the terrain instead: the uplands run to a raw height of 1346, which is 8.8 world
 * units, so a base of a third of that is the proportion that reads as a slab of
 * ground rather than as a rim round a map.
 *
 * Worth naming because both numbers looked plausible on screen. The pale mass in
 * the near half of the menu that I twice took for the sea, and once for snow, was a
 * hillside nine units up.
 */
export const BASE_DEPTH = 2.9;

/**
 * The cut face's own two colours, dark on purpose.
 *
 * Not `LAND.bedrock` and `LAND.rock`, which is what it used the first time and
 * which came out white: those are *surface* colours, chosen to sit under a sky in
 * daylight, and a vertical face at these sun angles catches the light square on
 * and blows out. A cut edge is the one surface in any diorama that is always in
 * shade — it is the inside of the ground.
 *
 * So they are set two thirds down from the surface colours they are meant to
 * suggest. Soil directly under the grass, rock below that, and both dark enough
 * that the slab reads as depth in any light the menu's clock happens to be at.
 */
const CUT_SOIL: RGB = [0.243, 0.176, 0.125];
const CUT_ROCK: RGB = [0.278, 0.267, 0.251];

/**
 * The two bands the cut edge is drawn in, and why there are two.
 *
 * One flat colour under the grass reads as a shadow rather than as a material.
 * Two — a thin band of soil directly under the surface and rock below it — is
 * the section drawing everybody has seen, and it is the cheapest possible way to
 * say "this is a piece of ground" rather than "this is where the mesh stops".
 */
const SOIL_BAND = 0.055;

/**
 * The cut face along the edge of the map.
 *
 * Only on the map boundary, which is why it lives inside the tile loop rather
 * than in a pass of its own: chunks are sixteen tiles square and a skirt drawn
 * per chunk would put walls through the middle of the district, four of them at
 * every seam. The test is against the *map* edge, so only the outermost chunks
 * grow one and every interior chunk is untouched.
 *
 * No bottom cap. The camera is fixed at 38 degrees of elevation and can never
 * get under the district, so a floor would be triangles nobody will ever see —
 * and this mesh is rebuilt whenever a field changes colour.
 */
function skirt(
  m: Mesh, x: number, y: number, s: number,
  h00: number, h10: number, h01: number, h11: number,
): void {
  const base = -BASE_DEPTH;
  /*
   * The cut starts at the waterline, not at the seabed.
   *
   * Measured across every size the generator makes: the coast never reaches the
   * map edge — 0 land tiles on the boundary at 32, 40, 48, 56, 64 and 128 — so the
   * whole rim of the world is sea, and following the seabed gave the slab a torn
   * top edge that read as a broken-off piece rather than as a cut one. Clamping to
   * zero puts a clean line right round it at the water's surface, which is what a
   * terrarium looks like: a square of ground and water, sliced.
   *
   * `Math.max` rather than a flat zero, so that if a district ever does run to the
   * edge the cut still follows the hill up.
   */
  const top = (h: number): number => Math.max(h, 0);
  /*
   * One wall, given its two top corners in order. Wound so the outward face is
   * the one that shows: the triangles are single-sided, and getting this wrong
   * produces an island you can see straight through from one side and not from
   * the other.
   */
  const wall = (
    ax: number, az: number, ah0: number,
    bx: number, bz: number, bh0: number,
  ): void => {
    const ah = top(ah0);
    const bh = top(bh0);
    const aSoil = Math.max(base, ah - SOIL_BAND);
    const bSoil = Math.max(base, bh - SOIL_BAND);
    m.tri(ax, ah, az, bx, bh, bz, ax, aSoil, az, CUT_SOIL);
    m.tri(bx, bh, bz, bx, bSoil, bz, ax, aSoil, az, CUT_SOIL);
    m.tri(ax, aSoil, az, bx, bSoil, bz, ax, base, az, CUT_ROCK);
    m.tri(bx, bSoil, bz, bx, base, bz, ax, base, az, CUT_ROCK);
  };

  // North, south, west, east. Each pair is ordered so the face points outward.
  if (y === 0) wall(x + 1, y, h10, x, y, h00);
  if (y === s - 1) wall(x, y + 1, h01, x + 1, y + 1, h11);
  if (x === 0) wall(x, y, h00, x, y + 1, h01);
  if (x === s - 1) wall(x + 1, y + 1, h11, x + 1, y, h10);
}

export function buildGround(
  src: GroundSource, x0: number, y0: number, x1: number, y1: number,
): Mesh {
  const s = src.size;
  /*
   * Twelve floats a tile, plus the skirt's eight triangles on an edge tile.
   *
   * Sized for the worst case rather than measured, because `Mesh` grows by
   * reallocating and a district's worth of edge tiles reallocating on the first
   * frame is the one place that cost is visible.
   */
  const m = new Mesh((x1 - x0) * (y1 - y0) * 12 + (x1 - x0 + y1 - y0) * 2 * 8 * 3);

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
         * The water, with shallows only where the channel actually ends.
         *
         * The first version called any tile with dry land beside it a bank — and
         * a stream one tile wide has dry land on *both* sides of every tile it
         * has, so the entire watercourse came out in the pale gravel colour and
         * the water colour was never drawn at all. It read as a blotchy pale
         * ribbon rather than as a beck, which is a good part of why the answer to
         * "where are the streams" was "there are none".
         *
         * Counting instead of testing fixes it. A tile in a run has water on two
         * sides — behind it and ahead of it — however narrow the channel is, so
         * three dry sides means a head, a tail, or a stub, and that is the only
         * place shallows belong.
         */
        let dry = 0;
        if (x === 0 || !src.isStream(tile - 1)) dry++;
        if (x + 1 >= s || !src.isStream(tile + 1)) dry++;
        if (y === 0 || !src.isStream(tile - s)) dry++;
        if (y + 1 >= s || !src.isStream(tile + s)) dry++;
        colour = dry >= 3 ? LAND.shallow : LAND.stream;
      } else {
        const p = src.parcel[tile];
        colour = p === NO_PARCEL ? CROP[6] : (CROP[src.crop[tile]] ?? CROP[6]);
        if (p !== NO_PARCEL) {
          /*
           * Every field its own shade.
           *
           * "Each field can have a slightly different yellow tint to it." Yes —
           * and it is the single cheapest thing here, because a district of
           * barley in one identical gold reads as a texture rather than as a
           * dozen farms' worth of separate decisions. Hashed off the parcel so a
           * field is one colour along its whole length and the field next to it
           * is not, which is the only place the difference is ever seen.
           *
           * Six per cent, which sounds like nothing and is the difference
           * between a quilt and a wash.
           */
          const n = ((p + 1) * 2654435761) >>> 0;
          const vary = 0.94 + ((n >>> 11) & 255) / 255 * 0.12;
          colour = [
            Math.min(1, colour[0] * vary),
            Math.min(1, colour[1] * (0.97 + (1 - vary) * 0.6)),
            colour[2] * (2 - vary) * 0.99,
          ];
          /*
           * And a stripe on alternate tiles, still. The corrugation below is the
           * furrow; this is the *pass* — the width a machine covers in one run,
           * which is several furrows wide and is what makes a big field read as
           * having been worked in strips.
           */
          const along = (p & 1) === 0 ? y : x;
          if (along % 2 === 0) colour = shade(colour, 0.955);
        }
      }
      /*
       * A warm lift on your own ground, before the distance fade.
       *
       * Very slight, and warm rather than a wash of colour: a field you own is
       * still that field with that crop in it, and tinting it blue would be the
       * game telling you about ownership instead of showing you a farm. Three per
       * cent up on red and down on blue is enough to read as *yours* when it sits
       * next to a field that is not, which — because the land is whole parcels —
       * is exactly where it always sits.
       */
      if (src.ownedLand(tile)) {
        colour = [
          Math.min(1, colour[0] * 1.05 + 0.012),
          Math.min(1, colour[1] * 1.03 + 0.008),
          colour[2] * 0.965,
        ];
      }
      colour = faded(colour, src.influence(tile));

      /*
       * Split the quad along the shorter diagonal, so a ridge stays a ridge
       * rather than being bridged flat by whichever triangulation the loop
       * happened to pick.
       */
      /*
       * And the tilth on top of it, where the crop has any.
       *
       * After the base quad rather than instead of it: the corrugation is ridges
       * standing *on* the field, so the ground still has to be there underneath
       * — visible in the troughs, which is where the earth shows between rows of
       * barley and is half of what says the barley is growing out of something.
       *
       * Only inside the influence area, on the same argument the hedges make: out
       * there you see the shape of the country and not what is in it, and the
       * detail would be a lot of triangles for a wash of fog.
       */
      /*
       * Not through the road. "They can now plough over the roads."
       *
       * Quite. The crop state is a property of the *parcel*, and a lane crossing
       * a field does not stop the field being a field — so the tile under the
       * tarmac is still down to barley as far as the simulation is concerned, and
       * the corrugation was standing up through the road surface. A plough goes
       * round a road; so does a drill; and nothing grows on it.
       *
       * The same test the hedges use, and for the same reason: `hasRoad` is
       * already the question "is this tile paved", asked once and answered for
       * everything that has to leave a gap.
       */
      const spec = TILTH[src.crop[tile]];
      if (spec !== undefined && src.parcel[tile] !== NO_PARCEL
        && !src.hasRoad(tile) && src.influence(tile) > 0.10) {
        tilth(
          m, x, y, h00, h10, h01, h11, spec, colour,
          (src.parcel[tile] & 1) === 0,
        );
      }

      const flip = Math.abs(h00 - h11) > Math.abs(h10 - h01);
      if (flip) {
        m.tri(x, h00, y, x + 1, h11, y + 1, x + 1, h10, y, colour);
        m.tri(x, h00, y, x, h01, y + 1, x + 1, h11, y + 1, colour);
      } else {
        m.tri(x, h00, y, x, h01, y + 1, x + 1, h10, y, colour);
        m.tri(x + 1, h10, y, x, h01, y + 1, x + 1, h11, y + 1, colour);
      }

      // And the cut face, if this tile is on the edge of the world.
      if (x === 0 || y === 0 || x === s - 1 || y === s - 1) {
        skirt(m, x, y, s, h00, h10, h01, h11);
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
/**
 * What each arable state looks like as *geometry* rather than as a colour.
 *
 * "You just made it brown. It looks ridiculous. I want it to look like it's been
 * ploughed, literally been ploughed." Fair, and the whole field system was a
 * colour lookup: a ploughed field and a field of barley were the same two
 * triangles in different browns, and no amount of choosing a better brown makes
 * a flat surface look turned over.
 *
 * A field of any of these is *corrugated*, and that is the one thing they have in
 * common and the reason this is one function. What differs is how high the
 * corrugation stands, how far apart it is, and what colour the top and the side
 * are — and those three numbers are enough to tell a ploughed field from a
 * drilled one from standing barley from stubble, at the zoom the game is played
 * at, which is the only test that counts.
 *
 *   `rows`   how many across a tile. A plough leaves wide furrows; a drill
 *            leaves fine ones; barley grows in rows you can count.
 *   `height` how far it stands off the ground, in tiles. Earth is nearly flat;
 *            a ripe crop is knee-high on this scale.
 *   `fill`   how much of the pitch is ridge and how much is trough. Standing
 *            crop nearly closes over; a fresh furrow is mostly trough.
 */
/*
 * Crop indices, spelled out because this package does not depend on the
 * simulation — the same reason `CROP[6]` above is a number and not a name. They
 * must match `Crop` in `sim/fields.ts`, and the only guard against drift is that
 * a wrong one here is instantly visible: a field of barley would be ploughed.
 */
const PLOUGH = 5;
const DRILLED = 7;
const GROWING = 8;
const WHEAT = 3;
const WHEAT_RIPE = 4;
const STUBBLE = 9;
const BARE = 10;

const TILTH: Record<number, { rows: number; height: number; fill: number;
  top: number; side: number }> = {
  // Ploughed: deep, wide furrows of turned earth. The ridge catches the light
  // and the trough is in shadow all day, which is what makes a ploughed field
  // read as *striped* from the air rather than as brown.
  [PLOUGH]: { rows: 4, height: 0.055, fill: 0.60, top: 1.16, side: 0.72 },
  // Cleared and waiting for the plough: the old furrows, weathered down.
  [BARE]: { rows: 4, height: 0.032, fill: 0.66, top: 1.10, side: 0.80 },
  // Drilled and rolled: finer, flatter, and the seed lines are the only relief.
  [DRILLED]: { rows: 5, height: 0.022, fill: 0.52, top: 1.12, side: 0.84 },
  // Up and green, in rows with earth still showing between them.
  [GROWING]: { rows: 6, height: 0.045, fill: 0.62, top: 1.10, side: 0.86 },
  // In ear and not yet ripe: taller, and nearly closed over.
  [WHEAT]: { rows: 6, height: 0.085, fill: 0.84, top: 1.08, side: 0.88 },
  // Ripe. The tallest thing that is not a hedge, and the ears catch the sun.
  [WHEAT_RIPE]: { rows: 6, height: 0.105, fill: 0.88, top: 1.14, side: 0.86 },
  // Cut: short pale rows with the straw lying between them.
  [STUBBLE]: { rows: 5, height: 0.026, fill: 0.70, top: 1.12, side: 0.88 },
};

/**
 * Lay the corrugation across one tile.
 *
 * Ridges run along the parcel's own axis so a whole field is ploughed in one
 * direction — which is both what a tractor does and what makes a field read as
 * one field rather than as a patchwork of tiles. Heights come from the tile's own
 * bilinear surface, so the furrows follow the ground over a rise instead of
 * floating off it.
 */
function tilth(
  m: Mesh, x: number, y: number,
  h00: number, h10: number, h01: number, h11: number,
  spec: { rows: number; height: number; fill: number; top: number; side: number },
  colour: RGB, alongX: boolean,
): void {
  const at = (u: number, v: number): number => (
    (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v);
  const top = shade(colour, spec.top);
  const side = shade(colour, spec.side);
  /*
   * Only the near face of each ridge, which is a third of the cost for nothing
   * visible at all.
   *
   * On a corrugated surface the *far* face of every ridge is hidden behind the
   * ridge in front of it, so drawing it is pure waste — and the ground is the
   * hottest geometry in the game. Measured before trimming: a stubble tile was
   * fifty triangles against a flat field's two.
   *
   * Which face is near is *asked* rather than assumed. The first version hard-
   * coded the lower one, with a comment admitting it only held because the
   * azimuth is fixed and warning that a camera which turned would show daylight
   * through the furrows. That is a trap with a note on it. `nearFaceIsLow` reads
   * the same camera constants the camera itself uses, so the geometry follows the
   * view instead of assuming it.
   */
  const low = nearFaceIsLow(alongX);
  const pitch = 1 / spec.rows;
  const half = (pitch * spec.fill) / 2;
  for (let i = 0; i < spec.rows; i++) {
    const c = (i + 0.5) * pitch;
    const a = c - half;
    const b = c + half;
    const hi = spec.height;
    if (alongX) {
      // The ridge runs the length of the tile in X, a band in Z.
      const ya = at(0, a);
      const yb = at(1, a);
      const yc = at(1, b);
      const yd = at(0, b);
      m.quad(x, ya + hi, y + a, x + 1, yb + hi, y + a,
             x + 1, yc + hi, y + b, x, yd + hi, y + b, top);
      if (low) {
        m.quad(x, ya, y + a, x + 1, yb, y + a,
               x + 1, yb + hi, y + a, x, ya + hi, y + a, side);
      } else {
        m.quad(x, yd + hi, y + b, x + 1, yc + hi, y + b,
               x + 1, yc, y + b, x, yd, y + b, side);
      }
    } else {
      const ya = at(a, 0);
      const yb = at(a, 1);
      const yc = at(b, 1);
      const yd = at(b, 0);
      m.quad(x + a, ya + hi, y, x + a, yb + hi, y + 1,
             x + b, yc + hi, y + 1, x + b, yd + hi, y, top);
      if (low) {
        m.quad(x + a, ya, y, x + a, yb, y + 1,
               x + a, yb + hi, y + 1, x + a, ya + hi, y, side);
      } else {
        m.quad(x + b, yd + hi, y, x + b, yc + hi, y + 1,
               x + b, yc, y + 1, x + b, yd, y, side);
      }
    }
  }
}

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

    /*
     * The two green kinds are vegetation; the other two are not.
     *
     * `m.leaf` is a pen — see `Mesh.leaf` — so it has to be set before the
     * geometry and cleared after, and this is exactly why it is a pen rather
     * than a property of the mesh: the same function draws a hawthorn hedge and
     * a dry stone wall a yard apart, and a wall that turned gold in October
     * would be worse than nothing.
     */
    /*
     * Partly, not wholly — the attribute is a *degree* and a hedge is not a
     * canopy.
     *
     * At 1 every hedge in the district went the same full gold as the beech
     * woods in October, and two things went wrong at once: the country read as
     * straw, and the hedges became hard to tell from the honey stone walls, which
     * is the one distinction the boundary code exists to draw. A hawthorn hedge
     * does turn, but it is thick, twiggy and half evergreen at the base, so it
     * goes a duller russet and it does it less. An overgrown one is more canopy
     * and less hedge, so it goes further.
     */
    m.leaf = kind === 0 ? 0.55 : kind === 1 ? 0.72 : 0;

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
       * Dry stone, out of stones.
       *
       * Second attempt. The first was three long courses, and "the walls need to
       * be made of STONES not of slabs" is exactly what that was: a band running
       * the whole length of a tile is a slab however many bands you stack, and
       * stacking them only made it a wall built of three slabs instead of one.
       *
       * A dry stone wall is *rubble* — irregular blocks, no two the same length,
       * the joints of one course landing over the middles of the ones below, and
       * the whole thing battering inward as it rises. None of that survives as
       * detail at forty pixels, but the *irregularity* does: what the eye reads
       * is that the top edge is not straight and the shading is broken up along
       * the run, and those two things are the difference between masonry and a
       * kerb.
       *
       * So: two courses of four stones each, lengths and heights jittered from
       * the position so a run is stable and no two tiles match, and the second
       * course offset half a stone along to break the joints. Then the coping on
       * top, as separate stones set on edge, because that is the one course you
       * can genuinely pick out from the air.
       */
      const dark = faded(WALL.shadow, inf);
      const pale = faded(WALL.stone, inf);
      const cap = faded(WALL.coping, inf);

      /** A deterministic 0..1 from the run position and a salt. */
      const rnd = (salt: number): number => {
        const n = ((jitter + salt * 2654435761) ^ (salt * 40503)) >>> 0;
        return ((n >>> 9) & 1023) / 1023;
      };

      const stones = 4;
      for (let course = 0; course < 2; course++) {
        const from = course === 0 ? 0.02 : 0.44;
        const to = course === 0 ? 0.46 : 0.86;
        // Battered: the upper course is narrower than the one it sits on.
        const thick = T * (course === 0 ? 0.90 : 0.78);
        // Half a stone along, so the joints do not line up into a seam.
        const shift = course === 0 ? 0 : 0.5 / stones;
        for (let i = 0; i < stones; i++) {
          const r = rnd(course * 17 + i * 5 + 1);
          const r2 = rnd(course * 31 + i * 7 + 2);
          // Along the run, in units of the tile.
          const mid = ((i + 0.5) / stones + shift) % 1;
          const half = (0.5 / stones) * (0.72 + r * 0.5);
          // A stone that would hang off the end is simply shorter.
          const lo = Math.max(0, mid - half);
          const hi = Math.min(1, mid + half);
          if (hi - lo < 0.03) continue;
          const centre = (lo + hi) / 2 - 0.5;
          const [hx, hz] = ext(thick * (0.86 + r2 * 0.3), (hi - lo) / 2);
          const top = to - (1 - r2) * (to - from) * 0.22;
          wedge(
            m,
            cx + (alongZ ? 0 : centre), base + h * from, cz + (alongZ ? centre : 0),
            hx, hz, h * (top - from), 0.99,
            (i + course) % 2 === 0 ? pale : dark,
          );
        }
      }

      // The coping: five smaller stones on edge, proud of the face below.
      for (let i = 0; i < 5; i++) {
        const r = rnd(101 + i * 11);
        const centre = (i + 0.5) / 5 - 0.5;
        const [hx, hz] = ext(T * 0.84, (0.5 / 5) * 0.86);
        wedge(
          m,
          cx + (alongZ ? 0 : centre), base + h * 0.84, cz + (alongZ ? centre : 0),
          hx, hz, h * (0.15 + r * 0.06), 0.96, i % 2 === 0 ? cap : pale,
        );
      }
      return;
    }

    /*
     * A hedge, and what winter actually does to one.
     *
     * Not a recolour. A hawthorn hedge in leaf is a solid green wall you cannot
     * see a field through; the same hedge in February is a lattice of twigs —
     * thinner, a little lower, and *gappy*, so the ground shows between the
     * stems. That gappiness is the whole difference, and it is geometry: no tint
     * can put a hole in something.
     *
     * So in leaf it is one wedge, as before, which is both cheapest and correct —
     * a hedge in July has no gaps. Out of leaf it becomes four stems with air
     * between them, which costs four quads on the boundaries of a winter
     * district and is the only time of year anything pays for it.
     */
    const leafy = src.leafiness;
    if (leafy > 0.55) {
      const [hx, hz] = ext(T, 0.5);
      wedge(m, cx, base, cz, hx, hz, h, TAPER, hedge);
      return;
    }

    /*
     * Bare, or nearly. Thinner, lower, and in pieces.
     *
     * The stems stay the full height while the *mass* between them goes, because
     * that is what a cut-back hedge looks like from above: the line is still
     * there and you can see through it. Interpolated on the leaf rather than
     * switched, so the fortnight either side of the change is a hedge thinning
     * out and not a hedge being replaced.
     */
    const bareness = 1 - Math.min(1, leafy / 0.55);
    const thin = T * (1 - bareness * 0.42);
    const low = h * (1 - bareness * 0.14);
    const stems = 4;
    // The gap grows as the leaf goes: solid at the changeover, open in January.
    const fill = 1 - bareness * 0.42;
    for (let i = 0; i < stems; i++) {
      const centre = (i + 0.5) / stems - 0.5;
      const [hx, hz] = ext(thin, (0.5 / stems) * fill);
      const wob = (((jitter >>> (i * 3)) & 7) / 7 - 0.5) * 0.10;
      wedge(
        m,
        cx + (alongZ ? 0 : centre), base, cz + (alongZ ? centre : 0),
        hx, hz, low * (0.88 + Math.abs(wob) * 2.2), TAPER + bareness * 0.12, hedge,
      );
    }
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
  /*
   * Put the pen back down.
   *
   * `m.leaf` is a pen and this mesh is shared with the ground itself, so leaving
   * it up would make the next thing drawn into it — a field, a road — turn gold
   * in October. Once at the end rather than after every boundary, because
   * nothing between here and there draws anything.
   */
  m.leaf = 0;
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
