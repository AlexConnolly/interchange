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
  hex('#d8c05e'), // wheat
  hex('#e0cb70'), // wheat, ripe
  hex('#8c6a4c'), // ploughed
  hex('#8a9c68'), // rough grazing — unenclosed, so no hedge round it
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
  waterDeep: hex('#3f6f92'),
  river: hex('#6fa3c4'),
};

export const HEDGE = {
  dark: hex('#3f5c33'),
  lit: hex('#4e6e3c'),
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
export const SEMANTIC = {
  yours: hex('#f0c04a'),
  offered: hex('#4ab0d0'),
  busy: hex('#e08040'),
  refused: hex('#d05050'),
};
