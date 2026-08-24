/**
 * The locked palette. art-direction.md §5.
 *
 * Three rules, and every one of them is load-bearing.
 *
 *   Land is desaturated and tonal. It is a ground, not a subject.
 *   Water is the one large saturated field, and it anchors the composition.
 *   Vehicles are the most saturated things on screen, and they move.
 *
 * Semantic colour — congestion, warning, failure — is reserved and appears
 * nowhere else, which is why the livery set is a constraint rather than a free
 * choice. If a new asset wants a hue that is already spoken for, the asset is
 * wrong, or the ramp is, and that is a conversation rather than a local fix.
 */

export type RGB = [number, number, number];

/**
 * A palette entry, given as the hex you would type into a colour picker — that
 * is, sRGB — and returned linear, because that is the only space in which
 * multiplying by a light is meaningful.
 *
 * Skipping this is the classic way to end up fighting your own art direction:
 * lighting sRGB values directly makes every mid-tone muddy, so you compensate
 * by raising the ambient, which flattens the facets, so you compensate by
 * saturating the palette — and now the land is a subject and the vehicles have
 * nowhere left to go. The renderer encodes back to sRGB on output, so a colour
 * under full light comes out as the hex it was authored as.
 */
export function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return [
    srgbToLinear(((n >> 16) & 255) / 255),
    srgbToLinear(((n >> 8) & 255) / 255),
    srgbToLinear((n & 255) / 255),
  ];
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Multiply a colour toward black; used for the dark value of a three-value set. */
export function shade(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

// ------------------------------------------------------------------- land

// Desaturated on purpose, and further than feels right in a swatch. Read as a
// palette these look drab; read as a *ground* under a warm key light, with
// saturated vehicles moving over them, they are what lets the machines be the
// subject. The first pass at these was a cheerful yellow-green and the result
// was a picture of a field with some lorries lost in it.
export const LAND = {
  ocean: hex('#16283c'),
  oceanDeep: hex('#0d1a28'),
  shallows: hex('#2a5570'),
  beach: hex('#9a9179'),
  grass: hex('#586550'),
  farmland: hex('#6d7055'),
  moor: hex('#5e5b4e'),
  forest: hex('#3f4d3c'),
  rock: hex('#6d6a63'),
  snow: hex('#c6cbd2'),
  river: hex('#2e5f7c'),
  marsh: hex('#525a49'),
} as const;

/** Indexed by the Biome enum in sim/terrain.ts. The order is a contract. */
export const BIOME_COLOURS: RGB[] = [
  LAND.ocean, LAND.shallows, LAND.beach, LAND.grass, LAND.farmland,
  LAND.moor, LAND.forest, LAND.rock, LAND.snow, LAND.river, LAND.marsh,
];

/** Seasonal tint applied to the land, Phase 4. Winter desaturates and cools;
 *  the accent-emissive rule is what keeps the world readable under snow. */
export const SEASON_TINT: RGB[] = [
  [1.02, 1.03, 0.98], // spring
  [1.06, 1.04, 0.92], // summer
  [1.05, 0.95, 0.82], // autumn
  [0.90, 0.94, 1.02], // winter
];

// ---------------------------------------------------------------- liveries
//
// art-direction.md §10: construction says what it is, livery says whose it is,
// and you must be able to tell both apart with the colour removed. So a livery
// is a pattern *and* a colour. Four companies is comfortable; the pattern set
// is what would have to carry eight (O5).

export interface Livery {
  name: string;
  colour: RGB;
  /** Secondary, for the flash or band. */
  accent: RGB;
  /** 0 plain, 1 band, 2 roof panel, 3 diagonal flash, 4 twin stripe. */
  pattern: number;
}

export const LIVERIES: Livery[] = [
  { name: 'Authority', colour: hex('#6b6f74'), accent: hex('#9aa0a6'), pattern: 0 },
  { name: 'Green', colour: hex('#2f7d5c'), accent: hex('#d9e2c4'), pattern: 1 },
  { name: 'Crimson', colour: hex('#9c2f38'), accent: hex('#e8d9b8'), pattern: 3 },
  { name: 'Indigo', colour: hex('#39518f'), accent: hex('#c9d4e8'), pattern: 2 },
  { name: 'Ochre', colour: hex('#a8712a'), accent: hex('#33291d'), pattern: 4 },
  { name: 'Teal', colour: hex('#1f6b73'), accent: hex('#e0ded0'), pattern: 1 },
  { name: 'Plum', colour: hex('#6a3a63'), accent: hex('#ded0d8'), pattern: 3 },
  { name: 'Slate', colour: hex('#3f4a52'), accent: hex('#b9c2c8'), pattern: 2 },
  { name: 'Moss', colour: hex('#55632c'), accent: hex('#e2e0c0'), pattern: 4 },
];

// ---------------------------------------------------------------- semantic
//
// Reserved. Nothing else in the game may use these hues.

export const SEMANTIC = {
  free: hex('#4fb477'),
  busy: hex('#e0b040'),
  congested: hex('#d4632f'),
  jammed: hex('#c02f2f'),
  warning: hex('#e8a33d'),
  failure: hex('#c02f2f'),
  good: hex('#4fb477'),
  selection: hex('#f2f0e6'),
  /** Ownership overlay: yours, theirs, the authority's. */
  owned: hex('#4fb477'),
  rival: hex('#c85a3c'),
  public: hex('#7c8288'),
} as const;

// ------------------------------------------------------------- structures

export const WAY_COLOURS: Record<string, RGB> = {
  track: hex('#6b5f4b'),
  macadam: hex('#7b756e'),
  tarmac: hex('#4e5055'),
  dual: hex('#46484d'),
  motorway: hex('#3e4045'),
  'rail-light': hex('#5c5348'),
  'rail-standard': hex('#544c42'),
  'rail-double': hex('#4d463d'),
  'rail-electric': hex('#464f54'),
  'rail-high-speed': hex('#42525c'),
  canal: hex('#2f5f7c'),
  pipeline: hex('#6f675c'),
  transmission: hex('#7d7f86'),
  conveyor: hex('#6b6154'),
};

/** Industry material identity, art-direction.md §5.2 — oxide, timber,
 *  concrete, verdigris — so a smelter reads different from a sawmill by colour
 *  family before its shape resolves. */
export const INDUSTRY_FAMILY: Record<string, RGB> = {
  mine: hex('#3d3a3c'),
  pit: hex('#7b6a55'),
  yard: hex('#7a5c37'),
  works: hex('#5e5a54'),
  farm: hex('#8a7a44'),
  wharf: hex('#4a6470'),
  power: hex('#4a4740'),
  water: hex('#4a7a94'),
  wind: hex('#b8bec4'),
  solar: hex('#33404f'),
  resort: hex('#3f9484'),
  retail: hex('#b8823a'),
  shed: hex('#8e8674'),
  rig: hex('#3a3a34'),
};

/** Town building palette: three values, and the accent is the lit window. */
export const TOWN = {
  wall: hex('#8a7f70'),
  wallDark: hex('#6d6357'),
  roof: hex('#5c4a44'),
  roofDark: hex('#463832'),
  window: hex('#f2c46a'),
  stone: hex('#9a9287'),
} as const;

// -------------------------------------------------------------------- sky

export const SKY = {
  day: hex('#aebfcf'),
  dusk: hex('#c08e6a'),
  night: hex('#111a29'),
  fogDay: hex('#a9bccc'),
  fogNight: hex('#0d1522'),
} as const;

/** Back to a hex string, for the DOM overlay — which is in sRGB like every
 *  other part of a web page. */
export function rgbToHex(c: RGB): string {
  const b = (v: number): string =>
    Math.round(Math.max(0, Math.min(1, linearToSrgb(v))) * 255).toString(16).padStart(2, '0');
  return `#${b(c[0])}${b(c[1])}${b(c[2])}`;
}
