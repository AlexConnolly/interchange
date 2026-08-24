/**
 * Positional value noise on an integer lattice.
 *
 * Deliberately not driven by the world Rng: noise must be a pure function of
 * (x, y, seed) so that regenerating one chunk of terrain gives the same answer
 * as generating the whole region in one pass. A stream-based generator would
 * make the result depend on evaluation order, which is exactly the property
 * chunked streaming cannot have.
 *
 * Everything is Q16.16. The interpolant is a fixed-point smoothstep.
 */

import { FX_ONE, fxMul, type Fx } from './fixed.ts';

/** Hash three integers to a well-mixed 32-bit value. */
export function hash3(x: number, y: number, seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (y | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Lattice value in [0, FX_ONE). */
function latticeValue(x: number, y: number, seed: number): Fx {
  return (hash3(x, y, seed) >>> 16) | 0;
}

/** 3t^2 - 2t^3 in fixed point, t in [0, FX_ONE]. */
function smooth(t: Fx): Fx {
  const t2 = fxMul(t, t);
  const t3 = fxMul(t2, t);
  return ((3 * t2 - 2 * t3) | 0);
}

function lerpFx(a: Fx, b: Fx, t: Fx): Fx {
  return (a + fxMul((b - a) | 0, t)) | 0;
}

/**
 * Value noise sampled at fixed-point coordinates. Returns [0, FX_ONE).
 * `x` and `y` are in lattice units, Q16.16.
 */
export function valueNoise(x: Fx, y: Fx, seed: number): Fx {
  const xi = x >> 16;
  const yi = y >> 16;
  const xf = smooth(x & 0xffff);
  const yf = smooth(y & 0xffff);
  const v00 = latticeValue(xi, yi, seed);
  const v10 = latticeValue(xi + 1, yi, seed);
  const v01 = latticeValue(xi, yi + 1, seed);
  const v11 = latticeValue(xi + 1, yi + 1, seed);
  return lerpFx(lerpFx(v00, v10, xf), lerpFx(v01, v11, xf), yf);
}

/**
 * Fractional Brownian motion. `octaves` doublings of frequency, each at half
 * the amplitude. Returns [0, FX_ONE).
 */
export function fbm(x: Fx, y: Fx, seed: number, octaves: number): Fx {
  let sum = 0;
  let amp = FX_ONE >> 1;
  let total = 0;
  let px = x;
  let py = y;
  for (let o = 0; o < octaves; o++) {
    sum = (sum + fxMul(valueNoise(px, py, (seed + o * 0x9e3779b9) | 0), amp)) | 0;
    total = (total + amp) | 0;
    amp >>= 1;
    px = (px << 1) | 0;
    py = (py << 1) | 0;
    if (amp === 0) break;
  }
  if (total === 0) return 0;
  return Math.trunc((sum * FX_ONE) / total) | 0;
}

/**
 * Ridged fBm — the absolute value folded about the midpoint, which turns the
 * smooth humps of value noise into the sharp crests a mountain range needs.
 */
export function ridged(x: Fx, y: Fx, seed: number, octaves: number): Fx {
  let sum = 0;
  let amp = FX_ONE >> 1;
  let total = 0;
  let px = x;
  let py = y;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(px, py, (seed + o * 0x9e3779b9) | 0);
    // fold: 1 - |2n - 1|
    const folded = (FX_ONE - Math.abs((2 * n - FX_ONE) | 0)) | 0;
    sum = (sum + fxMul(fxMul(folded, folded), amp)) | 0;
    total = (total + amp) | 0;
    amp >>= 1;
    px = (px << 1) | 0;
    py = (py << 1) | 0;
    if (amp === 0) break;
  }
  if (total === 0) return 0;
  return Math.trunc((sum * FX_ONE) / total) | 0;
}

/**
 * Domain warp: displace the sample point by another noise field before
 * sampling. This is what stops fBm reading as a blurry cloud and gives
 * coastlines their inlets and headlands.
 */
export function warpedFbm(
  x: Fx, y: Fx, seed: number, octaves: number, strength: Fx,
): Fx {
  const wx = ((fbm(x, y, (seed ^ 0x1234567) | 0, 3) - (FX_ONE >> 1)) | 0);
  const wy = ((fbm(x, y, (seed ^ 0x7654321) | 0, 3) - (FX_ONE >> 1)) | 0);
  return fbm(
    (x + fxMul(wx, strength)) | 0,
    (y + fxMul(wy, strength)) | 0,
    seed,
    octaves,
  );
}
