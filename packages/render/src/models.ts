/**
 * The model library. Every asset is a function.
 *
 * art-direction.md §9's rule is the one to hold on to here: **construction
 * language changes across eras, form language does not.** Era 1 is timber,
 * iron, rivets, tall and narrow, with the mechanism on the outside. Era 4 is
 * pressed steel, welded, enclosed, horizontal. Era 8 is composite, sealed,
 * seamless, symmetrical. All of them are flat-shaded chamfered forms on the
 * same palette with three values and one accent — so an 1890 steam lorry can
 * stand beside a 2070 autonomous convoy and read as two things from the same
 * world, three centuries apart.
 *
 * Every ownable model reserves a `livery` colour that the caller tints per
 * company, and pairs it with a *pattern* — a band, a flash, a roof panel — so
 * that company identity survives desaturation and fourteen pixels (§10).
 */

import { Mesh } from './geometry.ts';
import { INDUSTRY_FAMILY, TOWN, shade, type RGB, type Livery } from './palette.ts';

const IRON: RGB = [0.16, 0.17, 0.18];
const IRON_LIT: RGB = [0.28, 0.29, 0.30];
const TIMBER: RGB = [0.36, 0.26, 0.16];
const TIMBER_LIT: RGB = [0.46, 0.34, 0.21];
const STEEL: RGB = [0.42, 0.45, 0.48];
const GLASS: RGB = [0.22, 0.29, 0.34];
const LAMP: RGB = [1.0, 0.84, 0.45];
const BRASS: RGB = [0.55, 0.42, 0.18];

/** Which construction language an era speaks. */
export function eraBand(era: number): 0 | 1 | 2 {
  return era <= 2 ? 0 : era <= 5 ? 1 : 2;
}

export interface ModelParams {
  cls: string;
  era: number;
  livery: Livery;
  /** True for the authored far LOD — a second, simpler silhouette whose only
   *  job is to say "lorry" at fourteen pixels. Not a decimation (§7). */
  far: boolean;
}

export function buildVehicle(p: ModelParams): Mesh {
  const m = new Mesh();
  if (p.far) return farVehicle(m, p);
  switch (p.cls) {
    case 'dray': dray(m, p); break;
    case 'lorry': case 'van': case 'tipper': case 'tanker': lorry(m, p); break;
    case 'artic': artic(m, p); break;
    case 'bus': case 'coach': bus(m, p); break;
    case 'tram': tram(m, p); break;
    case 'loco': loco(m, p); break;
    case 'unit': multipleUnit(m, p); break;
    case 'barge': barge(m, p); break;
    case 'coaster': case 'bulker': case 'ferry': ship(m, p, 1.7); break;
    case 'container-ship': ship(m, p, 2.6); break;
    case 'light-freight': case 'airliner': case 'widebody': aircraft(m, p); break;
    case 'drone': drone(m, p); break;
    default: lorry(m, p); break;
  }
  return m;
}

/**
 * The far LOD: a second, simpler silhouette whose only job is to say "lorry"
 * at fourteen pixels (art-direction.md 7). A design task, not an optimisation
 * task — which is why it is a separate function rather than a decimation of
 * the near model, and why it keeps the *proportions* that distinguish the
 * classes and throws away everything else.
 *
 * No chamfers. A two-degree cut plane is most of the near model's triangle
 * budget and is invisible at six pixels. Roughly forty triangles each.
 */
function farVehicle(m: Mesh, p: ModelParams): Mesh {
  const L = p.livery;
  const dark = shade(L.colour, 0.62);
  const pale: RGB = [0.86, 0.86, 0.84];
  switch (p.cls) {
    case 'dray':
      // Two short blocks with a gap: cart, then horse. The gap is the read.
      m.box(0, 0.13, -0.07, 0.085, 0.055, 0.15, 0, L.colour, L.accent);
      m.box(0, 0.15, 0.28, 0.05, 0.075, 0.12, 0, dark);
      break;
    case 'lorry': case 'van': case 'tipper': case 'tanker':
      // A low bonnet in front of a taller box. One step in the roof line is
      // the whole difference between a lorry and a bus at this size.
      m.box(0, 0.11, 0.24, 0.10, 0.075, 0.10, 0, dark, L.accent);
      m.box(0, 0.17, -0.06, 0.11, 0.135, 0.22, 0, L.colour, L.accent);
      break;
    case 'artic':
      m.box(0, 0.15, 0.40, 0.11, 0.115, 0.11, 0, dark, L.accent);
      m.box(0, 0.22, 0.00, 0.12, 0.105, 0.30, 0, L.colour, L.accent);
      break;
    case 'bus': case 'coach':
      // Tall, uniform, no step. A bus is a box on end compared with a lorry.
      m.box(0, 0.23, 0, 0.115, 0.185, 0.36, 0, L.colour, L.accent);
      break;
    case 'tram':
      // A bus that is shorter and has something on the roof.
      m.box(0, 0.21, 0, 0.10, 0.165, 0.30, 0, L.colour, L.accent);
      m.box(0, 0.39, -0.02, 0.04, 0.02, 0.10, 0, dark);
      break;
    case 'loco':
      // A long low body with one raised block: that bump is "engine", and it
      // is what stops a locomotive reading as a carriage.
      m.box(0, 0.15, -0.04, 0.105, 0.105, 0.40, 0, L.colour, L.accent);
      m.box(0, 0.30, -0.26, 0.10, 0.075, 0.13, 0, dark);
      break;
    case 'unit':
      // Long, low, even, with a nose. A train that is all one height.
      m.box(0, 0.17, -0.06, 0.10, 0.115, 0.44, 0, L.colour, L.accent);
      m.wedge(0, 0.17, 0.46, 0.10, 0.115, 0.10, 0.45, dark, L.accent);
      break;
    case 'barge':
      // Very low and very wide. Nothing else in the game has this profile.
      m.box(0, 0.045, 0, 0.19, 0.045, 0.46, 0, dark, L.colour);
      break;
    case 'coaster': case 'bulker': case 'ferry':
      m.box(0, 0.07, 0.05, 0.20, 0.07, 0.62, 0, dark, L.colour);
      m.wedge(0, 0.07, 0.80, 0.20, 0.07, 0.16, 0.3, dark, L.colour);
      m.box(0, 0.20, -0.42, 0.13, 0.065, 0.14, 0, pale);
      break;
    case 'container-ship':
      m.box(0, 0.09, 0.10, 0.27, 0.09, 1.00, 0, dark, L.colour);
      m.wedge(0, 0.09, 1.24, 0.27, 0.09, 0.22, 0.25, dark, L.colour);
      m.box(0, 0.26, -0.72, 0.17, 0.08, 0.18, 0, pale);
      // Two stacks, so the deck load reads as cargo rather than as a lid.
      m.box(0, 0.18, 0.30, 0.22, 0.05, 0.34, 0, shade(L.colour, 0.8));
      m.box(0, 0.18, -0.20, 0.22, 0.05, 0.28, 0, shade(L.colour, 0.8));
      break;
    case 'light-freight': case 'airliner': case 'widebody':
      m.box(0, 0.10, 0, 0.055, 0.055, 0.34, 0, L.colour, L.accent);
      m.box(0, 0.10, 0.02, 0.32, 0.012, 0.08, 0, pale);
      m.box(0, 0.10, -0.30, 0.12, 0.012, 0.05, 0, pale);
      m.box(0, 0.16, -0.30, 0.010, 0.06, 0.06, 0, L.accent);
      break;
    case 'drone':
      m.box(0, 0.06, 0, 0.05, 0.018, 0.05, 0, L.colour);
      m.box(0, 0.06, 0, 0.11, 0.010, 0.011, 0, dark);
      m.box(0, 0.06, 0, 0.011, 0.010, 0.11, 0, dark);
      break;
    default:
      m.box(0, 0.17, 0, 0.11, 0.10, 0.28, 0, L.colour, L.accent);
      break;
  }
  return m;
}

// ------------------------------------------------------------------- road

/**
 * The mark that says whose it is with the colour taken away.
 *
 * art-direction.md 10 asks that construction say what a thing is and livery
 * say whose, and that both survive desaturation — so a livery is a pattern as
 * well as a colour. Only two of the eleven vehicle models used to draw one,
 * which meant nine of them said whose they were with colour alone, and for a
 * colourblind player at fourteen pixels that is nothing at all.
 *
 * One helper rather than a branch inside each model, so a new vehicle gets
 * the marks by calling it and cannot quietly forget to.
 *
 *   x, y, z   centre of the body it is going on
 *   hw, hh, hd  half-extents of that body
 */
function liveryMark(
  m: Mesh, L: Livery, x: number, y: number, z: number, hw: number, hh: number, hd: number,
): void {
  const a = L.accent;
  // Standing slightly proud of the body, or z-fighting turns the mark into a
  // shimmer, which is worse than not having one.
  const out = 0.004;
  switch (L.pattern) {
    case 1: // band: a waistline stripe the full length
      m.box(x, y, z, hw + out, Math.min(0.018, hh * 0.3), hd, 0, a);
      break;
    case 2: // roof panel: a flat cap, which reads best from directly above
      m.box(x, y + hh - out, z, hw * 0.86, 0.007, hd * 0.9, 0, a);
      break;
    case 3: // diagonal flash: three descending blocks, a stripe at size
      for (let i = 0; i < 3; i++) {
        m.box(x, y - hh * 0.4 + i * hh * 0.42, z - hd * 0.4 + i * hd * 0.4,
          hw + out, Math.min(0.016, hh * 0.26), hd * 0.24, 0, a);
      }
      break;
    case 4: // twin stripe: two thin lines, unmistakable in silhouette
      m.box(x, y + hh * 0.45, z, hw + out, 0.010, hd, 0, a);
      m.box(x, y - hh * 0.35, z, hw + out, 0.010, hd, 0, a);
      break;
    default: // plain: the authority, which is meant to be anonymous
      break;
  }
}

function wheels(m: Mesh, count: number, z0: number, dz: number, r: number, halfWidth: number, y: number): void {
  for (let i = 0; i < count; i++) {
    const z = z0 + i * dz;
    m.cylX(-halfWidth, y + r, z, r, 0.035, 7, IRON);
    m.cylX(halfWidth, y + r, z, r, 0.035, 7, IRON);
  }
}

function dray(m: Mesh, p: ModelParams): void {
  const L = p.livery;
  const w = 0.10;
  // Cart: a plank body on tall spoked wheels, sitting high and narrow. The
  // proportion is the whole read at this size — a dray that is as wide as it
  // is tall looks like a modern van.
  m.box(0, 0.13, -0.03, w, 0.045, 0.20, 0.012, TIMBER, TIMBER_LIT, shade(TIMBER, 0.8));
  if (!p.far) {
    m.box(0, 0.175, -0.16, w * 0.95, 0.04, 0.045, 0.01, L.colour, L.accent, L.colour);
    // The body is bare timber, so the mark goes on the painted seat board —
    // which is where a carrier would have put their name in 1860 anyway.
    liveryMark(m, L, 0, 0.175, -0.16, w * 0.95, 0.04, 0.045);
    // Shafts running forward to the horse.
    m.box(-w * 0.6, 0.135, 0.24, 0.008, 0.008, 0.10, 0, TIMBER);
    m.box(w * 0.6, 0.135, 0.24, 0.008, 0.008, 0.10, 0, TIMBER);
  }
  wheels(m, 2, -0.13, 0.20, 0.075, w + 0.012, 0.0);
  // Horse: a body, a neck and a head. Four legs are invisible at size and cost
  // a quarter of the model, so they are two blocks.
  const hz = 0.40;
  m.box(0, 0.15, hz, 0.045, 0.055, 0.11, 0.02, [0.30, 0.22, 0.16], [0.38, 0.29, 0.20]);
  if (!p.far) {
    m.box(0, 0.195, hz + 0.10, 0.032, 0.045, 0.035, 0.012, [0.26, 0.19, 0.14]);
    m.box(0, 0.225, hz + 0.145, 0.024, 0.028, 0.04, 0.01, [0.24, 0.17, 0.13]);
    m.box(0, 0.055, hz - 0.05, 0.030, 0.045, 0.022, 0, [0.22, 0.16, 0.12]);
    m.box(0, 0.055, hz + 0.06, 0.030, 0.045, 0.022, 0, [0.22, 0.16, 0.12]);
  }
}

function lorry(m: Mesh, p: ModelParams): void {
  const band = eraBand(p.era);
  const L = p.livery;
  const w = 0.12;
  const bodyTop = band === 0 ? 0.30 : band === 1 ? 0.26 : 0.24;

  if (band === 0) {
    // Steam lorry: chimney, exposed boiler, a cab like a shed.
    m.box(0, 0.16, -0.10, w, 0.09, 0.20, 0.015, L.colour, L.accent, shade(L.colour, 0.78));
    m.box(0, 0.22, 0.16, w * 0.8, 0.09, 0.10, 0.015, TIMBER, TIMBER_LIT);
    if (!p.far) {
      m.cyl(0, 0.30, 0.20, 0.022, 0.026, 0.12, 6, IRON, IRON_LIT);
      m.box(0, 0.14, 0.29, w * 0.7, 0.055, 0.05, 0.01, IRON, IRON_LIT);
      m.box(0, 0.255, 0.145, w * 0.55, 0.006, 0.055, 0, GLASS, GLASS, GLASS, 0.35);
      liveryMark(m, L, 0, 0.16, -0.10, w, 0.09, 0.20);
    }
    wheels(m, 3, -0.20, 0.20, 0.058, w + 0.012, 0.0);
  } else {
    // Pressed steel: enclosed, horizontal, a cab and a box.
    m.box(0, 0.055 + bodyTop / 2, -0.08, w, bodyTop / 2, 0.22, 0.018, L.colour, L.accent, shade(L.colour, 0.8));
    m.box(0, 0.05 + bodyTop * 0.42, 0.20, w * 0.94, bodyTop * 0.42, 0.10, 0.02, shade(L.colour, 0.9), L.accent);
    if (!p.far) {
      m.box(0, 0.055 + bodyTop * 0.72, 0.288, w * 0.8, 0.028, 0.012, 0, GLASS, GLASS, GLASS, 0.4);
      liveryMark(m, L, 0, 0.055 + bodyTop / 2, -0.08, w, bodyTop / 2, 0.22);
      m.box(-w * 0.6, 0.10, 0.30, 0.016, 0.012, 0.006, 0, LAMP, LAMP, LAMP, 1);
      m.box(w * 0.6, 0.10, 0.30, 0.016, 0.012, 0.006, 0, LAMP, LAMP, LAMP, 1);
    }
    wheels(m, 3, -0.22, 0.22, 0.055, w + 0.010, 0.0);
  }
}

function artic(m: Mesh, p: ModelParams): void {
  const L = p.livery;
  const w = 0.13;
  const band = eraBand(p.era);
  // Tractor unit, then a gap, then the trailer. The gap is what says
  // "articulated" at fourteen pixels; without it this is a long lorry.
  m.box(0, 0.20, 0.34, w * 0.95, 0.10, 0.13, 0.02, shade(L.colour, 0.92), L.accent);
  m.box(0, 0.245, 0.02, w, 0.115, 0.30, 0.02, L.colour, L.accent, shade(L.colour, 0.82));
  if (!p.far) {
    m.box(0, 0.29, 0.462, w * 0.78, 0.03, 0.014, 0, GLASS, GLASS, GLASS, 0.4);
    liveryMark(m, L, 0, 0.245, 0.02, w, 0.115, 0.30);
    if (band === 2) m.box(0, 0.365, 0.30, w * 0.6, 0.03, 0.08, 0.02, shade(L.colour, 0.8));
  }
  wheels(m, 2, 0.30, 0.12, 0.05, w + 0.008, 0.0);
  wheels(m, 3, -0.20, 0.11, 0.05, w + 0.008, 0.0);
}

function bus(m: Mesh, p: ModelParams): void {
  const L = p.livery;
  const band = eraBand(p.era);
  const w = 0.125;
  const h = band === 0 ? 0.20 : 0.17;
  m.box(0, 0.06 + h, 0, w, h, 0.36, 0.022, L.colour, L.accent, shade(L.colour, 0.82));
  if (!p.far) {
    // A window band is what makes a bus a bus rather than a van.
    m.box(0, 0.09 + h * 1.25, 0, w + 0.003, 0.030, 0.30, 0, GLASS, GLASS, GLASS, 0.35);
    // A bus already carries a waistline stripe as part of being a bus, so the
    // livery mark goes above it rather than replacing it.
    m.box(0, 0.09 + h * 0.55, 0, w + 0.004, 0.012, 0.34, 0, L.accent);
    liveryMark(m, L, 0, 0.06 + h, 0, w, h, 0.36);
    if (band === 0) m.box(0, 0.06 + h * 2 + 0.012, 0, w * 0.9, 0.012, 0.32, 0, TIMBER);
  }
  wheels(m, 2, -0.22, 0.42, 0.05, w + 0.008, 0.0);
}

function tram(m: Mesh, p: ModelParams): void {
  const L = p.livery;
  const w = 0.11;
  m.box(0, 0.20, 0, w, 0.12, 0.44, 0.022, L.colour, L.accent, shade(L.colour, 0.82));
  if (!p.far) {
    liveryMark(m, L, 0, 0.20, 0, w, 0.12, 0.44);
    m.box(0, 0.255, 0, w + 0.003, 0.032, 0.38, 0, GLASS, GLASS, GLASS, 0.35);
    // Pantograph: the one detail that says electric from directly above.
    m.box(0, 0.335, -0.06, 0.006, 0.012, 0.05, 0, IRON);
    m.box(0, 0.345, 0.02, w * 0.5, 0.004, 0.006, 0, IRON_LIT);
  }
  wheels(m, 2, -0.16, 0.32, 0.036, w, 0.0);
}

// ------------------------------------------------------------------- rail

function loco(m: Mesh, p: ModelParams): void {
  const band = eraBand(p.era);
  const L = p.livery;
  const w = 0.115;
  if (band === 0) {
    // Steam: a boiler barrel, a chimney, a cab, and a tender. Tall, narrow,
    // and with the mechanism showing — which is the whole era-1 language.
    m.cylX(0, 0.185, 0.10, 0.085, 0.30, 8, L.colour);
    m.box(0, 0.075, 0.10, w, 0.05, 0.20, 0.012, IRON, IRON_LIT);
    m.box(0, 0.215, -0.16, w * 0.95, 0.105, 0.10, 0.015, shade(L.colour, 0.86), L.accent);
    if (!p.far) {
      m.cyl(0, 0.26, 0.235, 0.028, 0.036, 0.075, 7, IRON, IRON_LIT);
      m.cyl(0, 0.255, 0.14, 0.024, 0.024, 0.035, 6, BRASS, BRASS);
      m.box(0, 0.25, -0.115, w * 0.7, 0.026, 0.008, 0, GLASS, GLASS, GLASS, 0.4);
      m.box(0, 0.09, 0.285, w * 0.8, 0.03, 0.02, 0.006, IRON);
      m.box(0, 0.13, -0.34, w * 0.9, 0.055, 0.11, 0.015, TIMBER, TIMBER_LIT);
      m.box(0, 0.145, 0.30, 0.012, 0.012, 0.01, 0, LAMP, LAMP, LAMP, 1);
      // On the cab side, where a railway painted its arms.
      liveryMark(m, L, 0, 0.215, -0.16, w * 0.95, 0.105, 0.10);
    }
    wheels(m, 4, -0.16, 0.13, 0.062, w + 0.006, 0.0);
  } else if (band === 1) {
    // Diesel-electric: a slab hood, a cab at each end, horizontal emphasis.
    m.box(0, 0.175, 0, w, 0.095, 0.46, 0.02, L.colour, L.accent, shade(L.colour, 0.8));
    if (!p.far) {
      m.box(0, 0.245, 0.30, w * 0.95, 0.045, 0.12, 0.02, shade(L.colour, 0.88), L.accent);
      m.box(0, 0.255, 0.418, w * 0.8, 0.026, 0.010, 0, GLASS, GLASS, GLASS, 0.4);
      liveryMark(m, L, 0, 0.175, 0, w, 0.095, 0.46);
      m.box(0, 0.10, 0.474, w * 0.5, 0.014, 0.008, 0, LAMP, LAMP, LAMP, 1);
    }
    m.box(0, 0.075, 0, w * 0.92, 0.03, 0.44, 0.01, IRON);
    wheels(m, 6, -0.22, 0.09, 0.048, w + 0.004, 0.0);
  } else {
    // Sealed and aerodynamic: one continuous body, a raked nose, no mechanism.
    m.box(0, 0.175, -0.06, w, 0.095, 0.40, 0.035, L.colour, L.accent, shade(L.colour, 0.84));
    m.wedge(0, 0.175, 0.40, w, 0.095, 0.12, 0.45, shade(L.colour, 0.94), L.accent);
    if (!p.far) {
      liveryMark(m, L, 0, 0.175, -0.06, w, 0.095, 0.40);
      m.box(0, 0.215, 0, w + 0.003, 0.026, 0.36, 0, GLASS, GLASS, GLASS, 0.3);
      m.box(0, 0.12, 0.50, w * 0.4, 0.012, 0.01, 0, LAMP, LAMP, LAMP, 1);
    }
    m.box(0, 0.07, 0, w * 0.9, 0.026, 0.42, 0.01, IRON);
    wheels(m, 6, -0.22, 0.09, 0.042, w + 0.003, 0.0);
  }
}

function multipleUnit(m: Mesh, p: ModelParams): void {
  const band = eraBand(p.era);
  const L = p.livery;
  const w = 0.115;
  const len = 0.52;
  m.box(0, 0.185, 0, w, 0.105, len, band === 2 ? 0.045 : 0.025, L.colour, L.accent, shade(L.colour, 0.82));
  if (band === 2) m.wedge(0, 0.185, len + 0.09, w, 0.105, 0.10, 0.4, shade(L.colour, 0.94), L.accent);
  if (!p.far) {
    liveryMark(m, L, 0, 0.185, 0, w, 0.105, len);
    m.box(0, 0.235, 0, w + 0.003, 0.034, len * 0.86, 0, GLASS, GLASS, GLASS, 0.35);
    m.box(0, 0.125, 0, w + 0.004, 0.014, len * 0.9, 0, L.accent);
    if (band >= 1) {
      m.box(0, 0.30, -0.10, 0.006, 0.014, 0.05, 0, IRON);
      m.box(0, 0.312, -0.02, w * 0.5, 0.004, 0.006, 0, IRON_LIT);
    }
  }
  m.box(0, 0.075, 0, w * 0.9, 0.026, len * 0.94, 0.01, IRON);
  wheels(m, 4, -0.34, 0.226, 0.042, w + 0.003, 0.0);
}

// ------------------------------------------------------------------ water

function barge(m: Mesh, p: ModelParams): void {
  const L = p.livery;
  const w = 0.16;
  m.box(0, 0.05, -0.05, w, 0.05, 0.42, 0.02, shade(L.colour, 0.7), L.colour);
  m.wedge(0, 0.05, 0.44, w, 0.05, 0.10, 0.35, shade(L.colour, 0.75), L.colour);
  if (!p.far) {
    liveryMark(m, L, 0, 0.05, -0.05, w, 0.05, 0.42);
    m.box(0, 0.115, -0.34, w * 0.7, 0.045, 0.08, 0.015, TIMBER, TIMBER_LIT);
    m.box(0, 0.085, 0.05, w * 0.82, 0.02, 0.30, 0, [0.20, 0.17, 0.13]);
  }
}

function ship(m: Mesh, p: ModelParams, scale: number): void {
  const band = eraBand(p.era);
  const L = p.livery;
  const w = 0.20 * (scale / 1.7);
  const len = 0.55 * scale;
  // Hull: a slab with a pinched bow. The sheer line is one chamfer.
  m.box(0, 0.06, -0.08 * scale, w, 0.06, len * 0.7, 0.025, shade(L.colour, 0.55), shade(L.colour, 0.75));
  m.wedge(0, 0.06, len * 0.72 - 0.08 * scale, w, 0.06, len * 0.3, 0.28, shade(L.colour, 0.6), shade(L.colour, 0.8));
  if (!p.far) {
    liveryMark(m, L, 0, 0.06, -0.08 * scale, w, 0.06, len * 0.7);
    // Superstructure aft, which is where it has been since about 1950 and is
    // most of what says "ship" rather than "boat" from above.
    m.box(0, 0.16, -len * 0.62, w * 0.7, 0.06, 0.10 * scale, 0.02, [0.86, 0.86, 0.84], [0.94, 0.94, 0.92]);
    m.box(0, 0.235, -len * 0.62, w * 0.5, 0.022, 0.06 * scale, 0.01, GLASS, GLASS, GLASS, 0.35);
    if (band === 0) {
      m.cyl(0, 0.24, -len * 0.5, 0.022, 0.026, 0.10, 6, IRON, IRON_LIT);
    } else {
      m.box(0, 0.28, -len * 0.66, 0.022, 0.045, 0.03, 0.008, L.accent);
    }
    if (scale > 2) {
      // Container stacks: the cargo is the silhouette on a box boat.
      for (let i = -2; i <= 2; i++) {
        for (let k = -1; k <= 1; k++) {
          const c: RGB = ((i + k) & 1) === 0 ? [0.62, 0.32, 0.24] : [0.24, 0.40, 0.52];
          m.box(k * w * 0.55, 0.14, i * 0.19, w * 0.24, 0.035, 0.085, 0.006, c, [c[0] * 1.2, c[1] * 1.2, c[2] * 1.2]);
        }
      }
    }
  }
}

// -------------------------------------------------------------------- air

function aircraft(m: Mesh, p: ModelParams): void {
  const L = p.livery;
  const band = eraBand(p.era);
  const fuse = band === 0 ? 0.055 : 0.075;
  const len = band === 0 ? 0.34 : 0.55;
  const span = band === 0 ? 0.44 : 0.62;
  m.cylX(0, 0.10, 0, fuse, 0.0, 6, L.colour);
  // The fuselage as a prism about Z rather than X, since the plane points +Z.
  m.box(0, 0.10, 0, fuse, fuse, len, fuse * 0.9, L.colour, L.accent, shade(L.colour, 0.86));
  if (!p.far) liveryMark(m, L, 0, 0.10, 0, fuse, fuse, len);
  m.wedge(0, 0.10, len + 0.09, fuse, fuse * 0.9, 0.10, 0.25, shade(L.colour, 0.95), L.accent);
  m.box(0, 0.10, 0.02, span / 2, 0.012, 0.09, 0.01, [0.86, 0.87, 0.88], [0.94, 0.95, 0.96]);
  m.box(0, 0.10, -len * 0.9, span * 0.22, 0.010, 0.05, 0.008, [0.86, 0.87, 0.88]);
  m.box(0, 0.155, -len * 0.9, 0.010, 0.055, 0.06, 0.01, L.accent);
  if (!p.far && band >= 1) {
    m.box(-span * 0.24, 0.075, 0.05, 0.024, 0.024, 0.05, 0.012, IRON, IRON_LIT);
    m.box(span * 0.24, 0.075, 0.05, 0.024, 0.024, 0.05, 0.012, IRON, IRON_LIT);
  }
}

function drone(m: Mesh, p: ModelParams): void {
  const L = p.livery;
  m.box(0, 0.06, 0, 0.05, 0.02, 0.09, 0.012, L.colour, L.accent);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
    m.box(dx * 0.085, 0.075, dz * 0.085, 0.006, 0.005, 0.006, 0, IRON);
    m.cyl(dx * 0.085, 0.080, dz * 0.085, 0.038, 0.038, 0.004, 8, [0.3, 0.31, 0.33]);
  }
}

// -------------------------------------------------------------- industries

export const SiteVisual = { Thriving: 0, Struggling: 1, Dead: 2 } as const;

/**
 * An industry is a kit, not a model (art-pipeline.md §4.4): a headframe, spoil
 * heaps, conveyors and sheds placed by rule so that no two mines look
 * identical and all of them look related.
 *
 * The three visual states from art-direction.md §6 are the same kit with a
 * different material set and one or two swapped parts — a parameter, not a new
 * asset. That is the whole reason the cost of forty industries times three
 * states is affordable.
 */
export function buildIndustry(kit: string, state: number, seed: number, footprint: number): Mesh {
  const m = new Mesh();
  const base = INDUSTRY_FAMILY[kit] ?? INDUSTRY_FAMILY.works;
  const dead = state === SiteVisual.Dead;
  const struggling = state === SiteVisual.Struggling;
  // Dead sites lose saturation and gain weeds; struggling ones dim.
  const k = dead ? 0.55 : struggling ? 0.82 : 1.0;
  const body: RGB = [base[0] * k, base[1] * k, base[2] * k];
  const lit: RGB = [Math.min(1, body[0] * 1.35), Math.min(1, body[1] * 1.35), Math.min(1, body[2] * 1.35)];
  const glow = dead ? 0 : struggling ? 0.3 : 1;
  // Plan is smaller and height is larger than instinct says, because at an
  // orthographic 35 degrees a ground length along the view axis arrives at
  // 0.57 of itself while height arrives at 0.82 (art-direction.md §1). A shed
  // authored square in plan reads as a slab; the same volume stood up reads as
  // a building.
  const S = footprint * 0.32;

  let r = seed | 1;
  const rnd = (): number => {
    r = (Math.imul(r, 1103515245) + 12345) & 0x7fffffff;
    return r / 0x7fffffff;
  };
  // Straight for order, irregular for age (art-direction §4): a dead site
  // leans and loses its symmetry, which is a mechanic rendered as form.
  const lean = dead ? 0.07 : struggling ? 0.02 : 0;

  switch (kit) {
    case 'mine': {
      // Headframe: tall and narrow, and at 35 degrees it will read taller than
      // it is authored, which is exactly what a headframe should do.
      m.box(0, 0.05, 0, S * 0.7, 0.05, S * 0.7, 0.03, shade(body, 0.8), body);
      // A headframe is the tallest thing for miles and it should dominate. At
      // this camera it will read taller still than authored, which is right.
      const hh = 1.05 * (dead ? 0.85 : 1);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
        m.box(dx * S * 0.24 + lean * hh, 0.10 + hh / 2, dz * S * 0.24, 0.022, hh / 2, 0.022, 0.006, IRON, IRON_LIT);
      }
      m.box(lean * hh * 2, 0.10 + hh, 0, S * 0.30, 0.035, S * 0.30, 0.02, IRON, IRON_LIT);
      m.cylX(lean * hh * 2, 0.10 + hh + 0.06, 0, 0.055, S * 0.20, 8, dead ? IRON : BRASS);
      m.box(S * 0.70, 0.20, S * 0.42, S * 0.30, 0.20, S * 0.22, 0.025, body, lit);
      m.box(S * 0.70, 0.42, S * 0.42, S * 0.32, 0.03, S * 0.24, 0.02, shade(body, 0.8), shade(body, 1.0));
      if (!dead) m.box(S * 0.70, 0.24, S * 0.42 + S * 0.225, S * 0.14, 0.035, 0.006, 0, [1, 0.82, 0.42], [1, 0.82, 0.42], [1, 0.82, 0.42], glow);
      // Spoil heap: the extraction penalty made visible.
      m.cyl(-S * 0.75, 0.0, -S * 0.55, S * 0.42, S * 0.10, 0.20, 7, [0.28, 0.25, 0.21], [0.33, 0.30, 0.25]);
      break;
    }
    case 'pit': {
      m.cyl(0, 0.0, 0, S * 0.95, S * 0.55, 0.02, 8, shade(body, 0.7), shade(body, 0.85));
      for (let i = 0; i < 3; i++) {
        const a = rnd() * 6.28;
        m.cyl(Math.cos(a) * S * 0.8, 0.0, Math.sin(a) * S * 0.8, S * 0.28, S * 0.06, 0.14 + rnd() * 0.08, 6, shade(body, 0.75), body);
      }
      m.box(S * 0.7, 0.13, -S * 0.6, S * 0.28, 0.09, S * 0.20, 0.02, body, lit);
      break;
    }
    case 'works': case 'power': {
      // A hall with a stack. Smoke rate says how hard it is working, so a cold
      // stack is the struggling state and a leaning one is dead.
      const hall = 0.30;
      m.box(0, hall, 0, S * 0.78, hall, S * 0.46, 0.035, body, lit, shade(body, 0.78));
      // A pitched roof, because a flat-topped box at this angle is a slab and
      // the ridge line is most of what says "works" from above.
      m.box(0, hall * 2 + 0.035, 0, S * 0.80, 0.035, S * 0.48, 0.03, shade(body, dead ? 0.6 : 0.86), shade(body, dead ? 0.7 : 1.05));
      m.box(0, hall * 2 + 0.10, 0, S * 0.34, 0.06, S * 0.50, 0.03, shade(body, dead ? 0.55 : 0.74));
      // A lower annexe, so the silhouette steps rather than being one mass.
      m.box(-S * 0.98, 0.17, S * 0.34, S * 0.30, 0.17, S * 0.30, 0.03, shade(body, 0.88), lit);
      const sh = kit === 'power' ? 1.45 : 1.05;
      m.cyl(S * 0.58 + lean * sh, 0.05, -S * 0.42, 0.05, 0.036, sh * (dead ? 0.72 : 1), 8, [0.30, 0.29, 0.27], [0.38, 0.36, 0.34]);
      if (!dead) {
        m.cyl(S * 0.58 + lean * sh, 0.05 + sh, -S * 0.42, 0.055, 0.05, 0.05, 8, [0.24, 0.23, 0.22]);
        // Lit windows along the hall: three values and one accent, and the
        // accent is the only emissive surface.
        m.box(0, hall * 0.95, S * 0.47, S * 0.55, 0.045, 0.008, 0, [1, 0.82, 0.42], [1, 0.82, 0.42], [1, 0.82, 0.42], glow);
        m.box(0, hall * 0.95, -S * 0.47, S * 0.55, 0.045, 0.008, 0, [1, 0.82, 0.42], [1, 0.82, 0.42], [1, 0.82, 0.42], glow);
      }
      if (kit === 'power') {
        // Cooling tower: the one silhouette nobody mistakes for anything else.
        m.cyl(-S * 0.7, 0.05, S * 0.55, 0.20, 0.15, 0.62, 10, [0.68, 0.68, 0.66], [0.76, 0.76, 0.74]);
        m.cyl(-S * 0.7, 0.62, S * 0.55, 0.15, 0.185, 0.14, 10, [0.60, 0.60, 0.58], [0.70, 0.70, 0.68]);
      }
      break;
    }
    case 'yard': case 'shed': case 'retail': {
      // A row of bays with a saw-tooth roof: the repeat is the read.
      for (let i = 0; i < 3; i++) {
        const dx = (i - 1) * S * 0.68;
        m.box(dx, 0.20, 0, S * 0.28, 0.20, S * 0.46, 0.028, body, lit, shade(body, 0.78));
        m.box(dx, 0.425, 0, S * 0.30, 0.028, S * 0.48, 0.02, shade(body, 0.70), shade(body, 0.95));
        if (!dead) m.box(dx, 0.24, S * 0.47, S * 0.20, 0.035, 0.008, 0, [1, 0.82, 0.42], [1, 0.82, 0.42], [1, 0.82, 0.42], glow);
      }
      if (!dead) {
        for (let i = 0; i < 4; i++) {
          m.box(-S * 0.7 + i * S * 0.35, 0.045, S * 0.75, S * 0.12, 0.045, S * 0.10, 0.01, TIMBER, TIMBER_LIT);
        }
      }
      break;
    }
    case 'farm': {
      m.box(-S * 0.4, 0.18, -S * 0.4, S * 0.22, 0.18, S * 0.22, 0.02, TOWN.wall, TOWN.stone);
      m.box(-S * 0.4, 0.40, -S * 0.4, S * 0.25, 0.05, S * 0.25, 0.02, TOWN.roof, shade(TOWN.roof, 1.3));
      m.box(S * 0.42, 0.16, S * 0.14, S * 0.30, 0.16, S * 0.20, 0.02, TIMBER, TIMBER_LIT);
      m.box(S * 0.42, 0.36, S * 0.14, S * 0.32, 0.04, S * 0.22, 0.02, shade(TIMBER, 0.7), TIMBER);
      // Field strips: the one place a flat plane is the right answer.
      for (let i = 0; i < 4; i++) {
        const c: RGB = i % 2 === 0 ? [0.52, 0.50, 0.28] : [0.44, 0.46, 0.26];
        m.box(0, 0.006, -S * 0.7 + i * S * 0.45, S * 0.95, 0.006, S * 0.2, 0, c);
      }
      break;
    }
    case 'wharf': case 'rig': {
      m.box(0, 0.045, 0, S * 0.9, 0.045, S * 0.4, 0.02, TIMBER, TIMBER_LIT);
      m.box(-S * 0.4, 0.14, 0, S * 0.22, 0.09, S * 0.22, 0.02, body, lit);
      m.box(S * 0.45, 0.30 + lean, S * 0.05, 0.018, 0.26, 0.018, 0.006, IRON, IRON_LIT);
      m.box(S * 0.45, 0.55, S * 0.05, 0.10, 0.014, 0.014, 0, IRON_LIT);
      break;
    }
    case 'water': {
      m.cyl(0, 0.0, 0, S * 0.85, S * 0.85, 0.06, 10, [0.24, 0.42, 0.54], [0.28, 0.50, 0.64]);
      m.box(S * 0.6, 0.12, -S * 0.5, S * 0.26, 0.10, S * 0.2, 0.02, body, lit);
      break;
    }
    case 'wind': {
      for (let i = 0; i < 3; i++) {
        const dx = (i - 1) * S * 0.7;
        m.cyl(dx, 0.0, (i % 2) * S * 0.4 - S * 0.2, 0.020, 0.013, 0.85, 7, [0.86, 0.87, 0.89], [0.92, 0.93, 0.95]);
        for (let b = 0; b < 3; b++) {
          const a = (b / 3) * 6.283 + i;
          m.box(dx + Math.cos(a) * 0.16, 0.85 + Math.sin(a) * 0.16, (i % 2) * S * 0.4 - S * 0.2, 0.16, 0.012, 0.006, 0, [0.90, 0.91, 0.93]);
        }
      }
      break;
    }
    case 'solar': {
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
          m.box(-S * 0.7 + i * S * 0.46, 0.05, -S * 0.6 + j * S * 0.6, S * 0.20, 0.006, S * 0.24, 0, [0.11, 0.13, 0.20], [0.16, 0.20, 0.30]);
          m.box(-S * 0.7 + i * S * 0.46, 0.025, -S * 0.6 + j * S * 0.6, 0.008, 0.025, 0.008, 0, IRON);
        }
      }
      break;
    }
    case 'resort': {
      for (let i = 0; i < 3; i++) {
        m.box((i - 1) * S * 0.55, 0.14 + i * 0.02, (i % 2) * S * 0.3, S * 0.24, 0.13 + i * 0.02, S * 0.26, 0.025, [0.92, 0.90, 0.85], [0.98, 0.97, 0.94]);
        m.box((i - 1) * S * 0.55, 0.29 + i * 0.04, (i % 2) * S * 0.3, S * 0.26, 0.02, S * 0.28, 0.012, [0.30, 0.58, 0.52]);
      }
      m.box(0, 0.008, -S * 0.7, S * 0.5, 0.008, S * 0.22, 0, [0.28, 0.62, 0.68]);
      break;
    }
    default: {
      m.box(0, 0.26, 0, S * 0.72, 0.26, S * 0.46, 0.03, body, lit, shade(body, 0.8));
      m.box(0, 0.545, 0, S * 0.74, 0.03, S * 0.48, 0.025, shade(body, 0.8), shade(body, 1.02));
      m.cyl(S * 0.52 + lean, 0.05, -S * 0.34, 0.045, 0.034, 0.85, 7, [0.30, 0.29, 0.27]);
      if (!dead) m.box(0, 0.24, S * 0.47, S * 0.48, 0.04, 0.008, 0, [1, 0.82, 0.42], [1, 0.82, 0.42], [1, 0.82, 0.42], glow);
      break;
    }
  }
  return m;
}

// ------------------------------------------------------------------ towns
//
// You influence towns; you do not place houses (features.md, out of scope). So
// a town is generated massing rather than authored buildings — but it still
// has to grow visibly, because a town that never changes shape is a cargo sink
// with a name.

export function buildTownBlock(seed: number, size: number, era: number, night: boolean): Mesh {
  const m = new Mesh();
  let r = seed | 1;
  const rnd = (): number => {
    r = (Math.imul(r, 1103515245) + 12345) & 0x7fffffff;
    return r / 0x7fffffff;
  };
  const band = eraBand(era);
  const count = Math.max(3, Math.min(22, Math.round(size)));

  /*
   * A street, not a scatter.
   *
   * The first version put every building at a random point in the block with
   * a random footprint, and the result read as a heap of dice however good
   * the individual shapes were — because what makes a town look like a town
   * is not the houses, it is that they *agree with each other*. Real buildings
   * share a frontage, face the same way, and sit shoulder to shoulder.
   *
   * So the block gets an axis, and everything on it lines up along that axis
   * with a common frontage. Two short terraces facing each other across a gap
   * is a street; the same buildings at random angles is a car park.
   */
  const alongX = (seed & 4) === 0;
  /*
   * Both of these come from the seed and never from the size, and that is a
   * correctness requirement rather than a preference.
   *
   * A town's mesh is rebuilt as it grows, and if the layout depends on how
   * many buildings there are then adding one moves all the others: the first
   * version decided one street or two from the count and then filled row by
   * row, so a town crossing from twelve buildings to thirteen rebuilt itself
   * as a different town. Houses appeared to move about on their own.
   *
   * Dealing the buildings alternately between fixed rows makes building *i*
   * land in the same place whatever the total is, so growth only ever adds to
   * the end of a street.
   */
  const rows = (seed & 8) === 0 ? 1 : 2;
  const cursors = [-0.82, -0.82];

  {
    for (let i = 0; i < count; i++) {
      const row = i % rows;
      // The frontage this row shares, offset either side of the street.
      const frontage = rows === 1 ? 0 : row === 0 ? -0.44 : 0.44;
      let cursor = cursors[row];
      /*
       * Width varies, depth much less: a terrace is a row of narrow houses of
       * the same depth, and letting depth wander as freely as width is what
       * made the earlier version look chewed.
       */
      const w = (band === 0 ? 0.085 : 0.10) + rnd() * (band === 2 ? 0.10 : 0.05);
      const d = 0.115 + rnd() * 0.035;
      // A gap only sometimes: mostly they touch, which is what makes a
      // terrace, and the occasional break is what stops it being a wall.
      const gap = rnd() < 0.72 ? 0.004 : 0.03 + rnd() * 0.05;
      if (cursor + w * 2 > 0.86) continue;
      const along = cursor + w;
      cursors[row] = cursor + w * 2 + gap;

      const x = alongX ? along : frontage;
      const z = alongX ? frontage : along;
      const hx = alongX ? w : d;
      const hz = alongX ? d : w;

      // Storeys rather than a continuous height: buildings come in floors, and
      // a run of them sharing a floor height is another thing that reads as a
      // street. Later eras build taller.
      const storeyH = band === 0 ? 0.075 : band === 1 ? 0.082 : 0.095;
      const storeys = band === 0
        ? 2 + (rnd() < 0.3 ? 1 : 0)
        : band === 1 ? 2 + ((rnd() * 3) | 0) : 3 + ((rnd() * 6) | 0);
      const h = storeyH * storeys;

      const wallTone = 0.88 + rnd() * 0.24;
      const wall: RGB = [TOWN.wall[0] * wallTone, TOWN.wall[1] * wallTone, TOWN.wall[2] * wallTone];
      m.box(x, h / 2, z, hx, h / 2, hz, 0.010, wall, shade(wall, 1.12), TOWN.wallDark);

      /*
       * The roof, and the reason any of this was worth doing.
       *
       * Pitched everywhere in the first two eras, and mostly flat in the
       * third — which is a real change in how buildings were built and reads
       * immediately as a change of century, so the era arc shows up in the
       * skyline without anybody being told about it.
       */
      const flatRoof = band === 2 && rnd() < 0.72;
      if (flatRoof) {
        // A parapet rather than a bare slab: the lip is what stops a flat roof
        // reading as an unfinished box.
        m.box(x, h + 0.006, z, hx * 1.02, 0.006, hz * 1.02, 0.004, TOWN.roofDark, shade(TOWN.roofDark, 1.2));
        m.box(x, h + 0.020, z, hx * 0.94, 0.014, hz * 0.94, 0.004, TOWN.roof, shade(TOWN.roof, 1.15));
      } else {
        // The ridge runs along the terrace, which is what a terrace does.
        const pitch = (alongX ? hz : hx) * (0.75 + rnd() * 0.4);
        m.roof(x, h, z, hx, hz, pitch, alongX, 0.012, TOWN.roof, TOWN.roofDark);
        // A chimney on the gable end, era permitting. One small cylinder, and
        // it is most of what makes a Victorian roofline read as one.
        if (band < 2 && rnd() < 0.8) {
          const cx2 = alongX ? x + hx * 0.7 : x;
          const cz2 = alongX ? z : z + hz * 0.7;
          m.cyl(cx2, h + pitch * 0.45, cz2, 0.014, 0.014, 0.055, 4, TOWN.wallDark, shade(TOWN.wallDark, 0.8));
        }
      }

      // Lit windows carry the night. The floor on legibility (§13) is that
      // this is emissive, so the town still reads when the shading flattens.
      // One per storey now rather than one per building, so a tall block in
      // 2050 glows like a tall block instead of like a cottage.
      if (night) {
        for (let f = 0; f < storeys; f++) {
          if (rnd() > 0.62) continue;
          const y = storeyH * (f + 0.55);
          const hh = storeyH * 0.26;
          // A quad on the wall, not a box in front of it. A chamfered box is
          // fifty-six triangles and a lit window is two, and there are eight
          // of them per building on twenty-two buildings in fourteen towns.
          if (alongX) {
            const zf = z + hz + 0.002;
            const ww = hx * 0.6;
            m.quad(x - ww, y - hh, zf, x + ww, y - hh, zf, x + ww, y + hh, zf, x - ww, y + hh, zf, TOWN.window, 1);
          } else {
            const xf = x + hx + 0.002;
            const ww = hz * 0.6;
            m.quad(xf, y - hh, z - ww, xf, y - hh, z + ww, xf, y + hh, z + ww, xf, y + hh, z - ww, TOWN.window, 1);
          }
        }
      }
    }
  }
  return m;
}

/**
 * A private car. Deliberately not a vehicle in the fleet sense.
 *
 * features.md has "private car adoption from era 4", and the note against it
 * is that the car is "the pressure that makes public transport a real fight".
 * The simulation models that properly — transit.ts takes a share of every
 * town's travel away from whoever runs the buses, and the share grows every
 * era — but it was entirely invisible. A player in 1975 watching their
 * omnibus receipts fall had no way to see *why*, and an empty road is a poor
 * illustration of a road full of cars.
 *
 * So the roads get traffic that belongs to nobody. It carries nothing, it is
 * not in any company's fleet, and no part of the simulation knows it exists —
 * it is the visible face of a number that was already there.
 */
export function buildCar(seed: number): Mesh {
  const m = new Mesh(64);
  let r = seed | 1;
  const rnd = (): number => {
    r = (Math.imul(r, 1103515245) + 12345) & 0x7fffffff;
    return r / 0x7fffffff;
  };
  // Muted and various: a car park of primary colours would pull the eye off
  // the network, which art-direction 5.2 reserves the saturation for.
  const hue = rnd();
  const body: RGB = hue < 0.3 ? [0.42, 0.44, 0.47]
    : hue < 0.55 ? [0.30, 0.34, 0.40]
      : hue < 0.75 ? [0.46, 0.36, 0.31]
        : hue < 0.9 ? [0.34, 0.40, 0.35] : [0.52, 0.50, 0.46];
  m.box(0, 0.030, 0, 0.030, 0.020, 0.058, 0.008, body, shade(body, 1.2), shade(body, 0.7));
  // A cabin set back from the bonnet, which is the whole silhouette at this
  // size — without it a car is a brick.
  m.box(0, 0.058, -0.006, 0.024, 0.016, 0.030, 0.006, shade(body, 0.85), shade(body, 1.05));
  return m;
}

/** Vegetation is massing, not individual plants (art-direction §11). */
export function buildTreeClump(seed: number): Mesh {
  const m = new Mesh();
  let r = seed | 1;
  const rnd = (): number => {
    r = (Math.imul(r, 1103515245) + 12345) & 0x7fffffff;
    return r / 0x7fffffff;
  };
  for (let i = 0; i < 5; i++) {
    const x = (rnd() - 0.5) * 0.8;
    const z = (rnd() - 0.5) * 0.8;
    const h = 0.10 + rnd() * 0.09;
    const g = 0.24 + rnd() * 0.12;
    m.cyl(x, 0, z, 0.075 + rnd() * 0.03, 0.012, h, 6, [g * 0.55, g, g * 0.5], [g * 0.75, g * 1.25, g * 0.7]);
  }
  return m;
}
