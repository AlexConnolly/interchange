/**
 * The palette, lifted straight off the target frame.
 *
 * These are the exact values in `art/target_frame.py`, which is the picture the
 * project is aimed at. They are not a scheme derived from principles — the last
 * palette was, and the principle was "the land is a ground, not a subject:
 * desaturated and tonal", which produced a grey-green blob field.
 *
 * So: saturated pastels, and a standard view transform rather than a film
 * emulation. The first render of the target frame went through AgX Punchy and a
 * field authored at #7fa04a came out pale sage. Whatever is written here is what
 * appears on screen; there is no tone curve in between quietly having opinions.
 */

export type RGB = [number, number, number];

/** sRGB hex to linear-ish float triple. The renderer's output encoding does the
 *  gamma, so these stay as authored. */
export function hex(s: string): RGB {
  const h = s.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export function shade(c: RGB, k: number): RGB {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

// ------------------------------------------------------------------ the land

/** Crops, indexed to match `Crop` in the sim's fields.ts. */
export const CROP: RGB[] = [
  hex('#7fa04a'), // pasture
  hex('#8fae55'), // pasture, rich
  hex('#a8b656'), // meadow
  hex('#9db855'), // wheat, away and still green
  hex('#dfc164'), // wheat, ripe
  hex('#8c6a4c'), // ploughed
  hex('#8a9c68'), // rough grazing — unenclosed, so no hedge round it
  /*
   * The four stages of the arable year that were missing, and the spread between
   * them is the point. Drilled earth is darker and greyer than ploughed because
   * it has been rolled; growing wheat is a much bluer green than pasture; stubble
   * is the palest thing in the district; bare ground after the straw is off is
   * ploughed earth again but flatter.
   *
   * `wheat` moved too. It was a gold that belonged to a ripe crop, which left
   * nothing for the three months of green between drilling and harvest.
   */
  hex('#6e5540'), // drilled: rolled earth, darker than ploughed
  hex('#7e9c5f'), // growing: low and blue-green
  hex('#d6cfa2'), // stubble: straw, the palest thing in the district
  hex('#9a8464'), // bare: cleared, waiting for the plough
  /*
   * And the woods, which are the darkest ground in the district by a distance.
   *
   * That is the whole job of these two colours. The trees do the drawing, but a
   * canopy has gaps and what shows through them has to read as forest floor, not
   * as the pasture next door with trees standing on it. Everything else in `CROP`
   * sits between #7f and #df; these sit twenty per cent below the darkest of them,
   * so a wood is a dark mass at any zoom, including the one where the trees are
   * three pixels tall and the colour is all there is.
   *
   * Broadleaf is warm and slightly olive — leaf litter and dappled light.
   * Plantation is colder and bluer, which is the actual difference between an
   * oak wood and a spruce block seen from a hill, and the reason conifers are
   * the thing people object to on a skyline.
   */
  hex('#4e6b39'), // broadleaf wood: dark, warm, a little olive
  hex('#3c5844'), // conifer plantation: darker still, and blue with it
];

export const LAND = {
  /** Under everything, and it should almost never be visible: the fields tile
   *  the ground. The first target frame left this showing between parcels and
   *  it dominated the picture. */
  bedrock: hex('#8c6a4c'),
  moor: hex('#8b8a62'),
  rock: hex('#8f8b84'),
  scree: hex('#9a958c'),
  beach: hex('#ddd0a8'),
  water: hex('#5f93b8'),
  /*
   * A stream, which is not the sea in a smaller size.
   *
   * Inland water takes its colour from what is under it and what is over it — a
   * bed of silt and gravel, and a bank of trees — where the sea takes its colour
   * from the sky. So it is greener and darker than the sea, and that is what
   * stops a beck across a field looking like an inlet.
   *
   * The first attempt took that reasoning much too far: a desaturated slate,
   * which is a fair description of river water under an overcast sky and was
   * completely wrong on screen. Every tile in this game is faded *toward the
   * mist* by distance and by influence, so a colour that starts out grey arrives
   * as grey ground — the streams were being drawn, correctly, in a shade
   * indistinguishable from a shaded field, and the verdict was "there are no
   * streams".
   *
   * A colour here is not a paint sample. It has to survive being mixed halfway
   * into fog and still say what it is, which means the part that identifies it —
   * blue, for water — must be strong enough to lose half of itself and still be
   * the loudest thing in the tile.
   */
  stream: hex('#4a86a0'),
  /** Wet gravel at the edge of it, a tile wide. Nothing in England has a hard
   *  edge between water and grass. */
  shallow: hex('#6e9ba6'),
  waterDeep: hex('#3f6f92'),
  river: hex('#6fa3c4'),
};

export const HEDGE = {
  dark: hex('#3f5c33'),
  lit: hex('#4e6e3c'),
};

/**
 * The other things a field can be bounded by.
 *
 * A district enclosed entirely in hedge reads as one estate laid out on one
 * afternoon, and English fields are not that: they are centuries of separate
 * decisions, so a lane has a hedge on one side and a wall on the other and the
 * paddock behind the farm is post and rail. Which boundary a pair of fields
 * shares is fixed by their two ids, so a run is one thing for its whole length —
 * a boundary that changed material every tile would read as rubble.
 *
 * The palette matters as much as the geometry. Both of these are *paler and
 * cooler* than a hedge, so they read as a different material at forty pixels
 * rather than as a hedge with something wrong with it — which is what a
 * differently-shaped green line would have looked like.
 */
export const FENCE = {
  rail: hex('#8d7c62'),
  post: hex('#6f6049'),
};

export const WALL = {
  stone: hex('#8e8d85'),
  shadow: hex('#75746d'),
};

export const TREE = {
  trunk: hex('#54402f'),
  canopy: hex('#3e6b34'),
  canopyLit: hex('#528a41'),
};

// ------------------------------------------------------------------ the road

export const ROAD = {
  verge: hex('#6a8a3e'),
  /** Three grades, because a hierarchy you can see is the difference between a
   *  network and a spiderweb. */
  spine: hex('#4e5257'),
  lane: hex('#55585d'),
  track: hex('#6d6350'),
  worn: hex('#63666b'),
  line: hex('#dcdcd2'),
};

// -------------------------------------------------------------- what is built

export const BUILT = {
  brick: hex('#a3624a'),
  render: hex('#cfc4ae'),
  slate: hex('#4a4d55'),
  steelRoof: hex('#8d9298'),
  concrete: hex('#b3aca2'),
  glass: hex('#5f7a86'),
  silo: hex('#d8dade'),
};

// ---------------------------------------------------------------- the fleet

/** Liveries. Pattern as well as colour, because at forty pixels two mid-tone
 *  colours are the same colour. */
export const LIVERY: { body: RGB; accent: RGB }[] = [
  { body: hex('#b8402f'), accent: hex('#f0e6d2') },
  { body: hex('#2f6ea8'), accent: hex('#f0e6d2') },
  { body: hex('#3f8a5a'), accent: hex('#f5efdc') },
  { body: hex('#c98a2f'), accent: hex('#43423f') },
];

/**
 * The colours farm machinery comes in. **Edit this list to change them.**
 *
 * Add a line and every farm in the district can paint a machine that colour;
 * remove one and none of them can. Nothing else needs touching: the renderer
 * builds one batch per model per entry in `PAINT` below, and a farm picks its
 * colour by hashing its own tile into this list — so a farm's tractor, its drill
 * and its combine all match, which is both true and the single cheapest thing
 * that makes a district feel owned by somebody.
 *
 * Kept separate from `LIVERY` because they answer to different things. A haulage
 * livery is a *choice a player makes* and there are four so the choice is legible;
 * these are the makes of machine that were in an English field in 1985 and they
 * are what they are. Massey red, Deere green, Ford blue, New Holland yellow, and
 * the grey of something twenty years old that still starts.
 */
export const FARM_LIVERY: { body: RGB; accent: RGB }[] = [
  { body: hex('#bf3327'), accent: hex('#e8e2d4') },
  { body: hex('#3d7a36'), accent: hex('#e9d64a') },
  { body: hex('#2b6390'), accent: hex('#e8e2d4') },
  { body: hex('#d79f22'), accent: hex('#3a3c40') },
  { body: hex('#8b8f96'), accent: hex('#c8442e') },
];

/**
 * Every colour a vehicle can be painted, in one list.
 *
 * The renderer's batch grid is `[model][paint]`, so this is the axis it is built
 * on. Company liveries come first and keep their indices, which matters: a
 * company's livery is `company & 3`, and putting anything before them would
 * silently repaint the entire fleet.
 */
export const PAINT: { body: RGB; accent: RGB }[] = [...LIVERY, ...FARM_LIVERY];

/** Where the farm colours start in `PAINT`. */
export const FARM_PAINT_FROM = LIVERY.length;

export const VEHICLE = {
  tank: hex('#d8dade'),
  tyre: hex('#1f2124'),
  glass: hex('#5f7a86'),
  chassis: hex('#3a3c40'),
};

// -------------------------------------------------------------------- the sky

export const SKY = {
  /** Late afternoon, which is the light in the target frame and the reason
   *  everything in it has a long shadow. */
  zenith: hex('#7ba6d4'),
  horizon: hex('#bcd0e0'),
  sun: hex('#fff0d2'),
  /** Bounce off the ground. Never black, or the shaded side of every hedge is a
   *  silhouette. */
  ground: hex('#6a6250'),
};

// -------------------------------------------------------------------- meaning

/** The only colours allowed to mean something. Four, and they are checked for
 *  perceptual distance rather than chosen by eye. */
/** The two halves of a haulage job, and they must not look alike: one earns and
 *  one does not. */
export const RUN = {
  /** Out from the yard to the pickup. Empty, and it costs you. */
  empty: hex('#c8683c'),
  /** Pickup to drop. This is the part that pays. */
  loaded: hex('#f0c04a'),
};

export const SEMANTIC = {
  yours: hex('#f0c04a'),
  offered: hex('#4ab0d0'),
  busy: hex('#e08040'),
  refused: hex('#d05050'),
};

// ------------------------------------------------------------------ the winter

/**
 * Snow.
 *
 * Not white. #ffffff on a lit surface clips the moment the sun is on it, and a
 * field of clipped white has no form at all — every fold in the ground
 * disappears. A touch below, and faintly blue, so the shaded side of a drift
 * reads as blue-grey against the lit side rather than as grey against grey.
 *
 * `wet` is the other half and the part that makes the picture: a road under
 * snow is *cleared*, so it is darker and shinier than in summer, and the whole
 * frame's contrast inverts for three months — dark roads on a bright ground,
 * where the rest of the year is pale roads on green.
 */
export const SNOW = {
  lit: hex('#e7edf4'),
  wet: hex('#3f454d'),
};

// ------------------------------------------------------------------ the night

/**
 * Night, and it is a blue evening rather than a blackout.
 *
 * The rule is that the district stays readable: a casual game that goes dark
 * enough to hide the road has stopped being playable for a third of every day,
 * and the player will simply learn to look away until it is over. So the night
 * palette is a *moonlit* one — deep blue, not black, with a fill that never
 * reaches zero.
 *
 * What night is actually for is the lights. Nothing in the day frame can be
 * brighter than the sky, so nothing in the day frame can glow. At night the
 * cat's eyes and the headlamps are the brightest things on screen, and a chain
 * of them along a lane tells you where your fleet is from across the district.
 */
export const NIGHT = {
  zenith: hex('#16223d'),
  horizon: hex('#1d2b48'),
  /** The light source itself, once the sun is under the horizon. */
  moon: hex('#93a9cd'),
  /** Bounce, and it must not be black — see SKY.ground. */
  ground: hex('#161b2b'),
};

/**
 * Things that emit, drawn unlit and blended additively.
 *
 * These are deliberately near-white: an additive blend adds to whatever is
 * behind it, so a saturated glow colour tints the road instead of lighting it.
 * The warmth belongs in the lamp, not in the glow.
 */
export const GLOW = {
  /** Cat's eyes. Reflective rather than emitting, which is why they are the
   *  faintest of the three and why a farm track has none. */
  catseye: hex('#ffeeb4'),
  head: hex('#fff6e0'),
  tail: hex('#ff5238'),
};
