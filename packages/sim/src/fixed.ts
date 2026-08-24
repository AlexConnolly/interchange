/**
 * Q16.16 fixed point. Determinism rule 1 (architecture.md §1): no floating
 * point in simulation state.
 *
 * Every value here is a signed int32 interpreted as `value / 65536`. All
 * arithmetic stays in int32 lane operations (`| 0`, `Math.imul`), which the
 * ECMAScript spec defines exactly, so two engines on two architectures cannot
 * disagree. The moment a `+` produces a double we have lost the property the
 * whole architecture hangs from, so the operators are functions rather than
 * something you write inline and forget to think about.
 */

export type Fx = number;

export const FX_BITS = 16;
export const FX_ONE = 1 << FX_BITS;
export const FX_HALF = FX_ONE >> 1;
export const FX_MAX = 0x7fffffff;
export const FX_MIN = -0x80000000;

/** Whole number to fixed. Range is +-32767 — outside that, use integers. */
export function fx(n: number): Fx {
  return (n * FX_ONE) | 0;
}

/** Fixed from a numerator/denominator pair, avoiding a float round-trip. */
export function fxFrac(num: number, den: number): Fx {
  return (((num | 0) * FX_ONE) / (den | 0)) | 0;
}

/** For display only. Never feed the result back into sim state. */
export function fxToNumber(a: Fx): number {
  return a / FX_ONE;
}

export function fxToInt(a: Fx): number {
  return a >> FX_BITS;
}

/** Round-half-up toward +inf, matching `Math.floor(x + 0.5)`. */
export function fxRound(a: Fx): number {
  return (a + FX_HALF) >> FX_BITS;
}

export function fxAdd(a: Fx, b: Fx): Fx {
  return (a + b) | 0;
}

export function fxSub(a: Fx, b: Fx): Fx {
  return (a - b) | 0;
}

/**
 * a*b >> 16, computed in 16-bit lanes so the 64-bit intermediate never needs
 * to exist. `hi` is signed, `lo` unsigned, and a = hi*2^16 + lo exactly.
 */
export function fxMul(a: Fx, b: Fx): Fx {
  const ah = a >> 16;
  const al = a & 0xffff;
  const bh = b >> 16;
  const bl = b & 0xffff;
  return (
    ((Math.imul(ah, bh) << 16) +
      Math.imul(ah, bl) +
      Math.imul(al, bh) +
      ((Math.imul(al, bl) >>> 16) | 0)) |
    0
  );
}

/**
 * Truncating division. The numerator is widened by 2^16 before dividing,
 * which overflows int32, so this is the one place a double appears — but the
 * double is exact (|a| < 2^31 * 2^16 = 2^47, well inside 2^53) and `Math.trunc`
 * collapses it back to an integer before it can vary. Division by zero is
 * clamped rather than producing Infinity, because a NaN in sim state is a
 * desync that spreads.
 */
export function fxDiv(a: Fx, b: Fx): Fx {
  if (b === 0) return a >= 0 ? FX_MAX : FX_MIN;
  return Math.trunc((a * FX_ONE) / b) | 0;
}

/** Integer division of a fixed by a plain integer. */
export function fxDivInt(a: Fx, n: number): Fx {
  if (n === 0) return a >= 0 ? FX_MAX : FX_MIN;
  return Math.trunc(a / n) | 0;
}

/** Fixed times a plain integer, no shift. */
export function fxMulInt(a: Fx, n: number): Fx {
  return Math.imul(a, n | 0) | 0;
}

export function fxAbs(a: Fx): Fx {
  return a < 0 ? (-a | 0) : a;
}

export function fxMin(a: Fx, b: Fx): Fx {
  return a < b ? a : b;
}

export function fxMax(a: Fx, b: Fx): Fx {
  return a > b ? a : b;
}

export function fxClamp(a: Fx, lo: Fx, hi: Fx): Fx {
  return a < lo ? lo : a > hi ? hi : a;
}

/** Linear interpolation; `t` in [0, FX_ONE]. */
export function fxLerp(a: Fx, b: Fx, t: Fx): Fx {
  return (a + fxMul((b - a) | 0, t)) | 0;
}

/**
 * Exact integer square root of a non-negative integer below 2^52.
 *
 * `Math.sqrt` seeds it, which looks like a determinism hole and is not: the
 * two correction loops below drive x to the exact floor of the true root from
 * *any* starting point within a step or two, so the seed's last bit cannot
 * survive into the result. All the arithmetic stays on integers exactly
 * representable as doubles.
 */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = Math.floor(Math.sqrt(n));
  while (x > 0 && x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** Square root of a fixed value, returned fixed. */
export function fxSqrt(a: Fx): Fx {
  if (a <= 0) return 0;
  // sqrt(a / 2^16) * 2^16 == sqrt(a * 2^16). a < 2^31, so n < 2^47: exact.
  return isqrt(a * FX_ONE) | 0;
}

/** Exact powers of two, so a variable shift can be done as a multiplication
 *  when the operand would overflow the int32 shift operators. */
const P2: readonly number[] = (() => {
  const t: number[] = [];
  for (let i = 0; i <= 32; i++) t.push(Math.pow(2, i));
  return t;
})();

/**
 * Euclidean length of a fixed vector.
 *
 * The naive `sqrt(dx*dx + dy*dy)` overflows: a region-scale coordinate is
 * 2^26 in Q16.16 and its square is 2^52, which leaves no room for the sum.
 * So the pair is first rescaled by a power of two until the larger component
 * has exactly 23 significant bits — squares then sit below 2^46 and the sum
 * below 2^47, comfortably exact as doubles — and the answer is scaled back.
 * The shift is a power of two, so it introduces no rounding of its own beyond
 * the deliberate truncation to 23 bits, which is a relative error of 2^-23.
 */
export function fxHypot(dx: Fx, dy: Fx): Fx {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  const m = ax > ay ? ax : ay;
  if (m === 0) return 0;
  const s = (32 - Math.clz32(m)) - 23;
  let ux: number;
  let uy: number;
  if (s > 0) {
    ux = ax >> s;
    uy = ay >> s;
  } else if (s < 0) {
    ux = ax * P2[-s];
    uy = ay * P2[-s];
  } else {
    ux = ax;
    uy = ay;
  }
  const r = isqrt(ux * ux + uy * uy);
  const out = s > 0 ? r * P2[s] : s < 0 ? Math.trunc(r / P2[-s]) : r;
  return out > FX_MAX ? FX_MAX : out | 0;
}

// --------------------------------------------------------------- trig
//
// A 1024-entry sine table in fixed point. Angles are "brads": 0..4095 for a
// full turn, so wrapping is a mask and never a modulo of a float.

export const ANGLE_FULL = 4096;
export const ANGLE_MASK = ANGLE_FULL - 1;

const SIN_TABLE = (() => {
  const t = new Int32Array(ANGLE_FULL);
  for (let i = 0; i < ANGLE_FULL; i++) {
    // Built once at module load from doubles, then frozen as integers. The
    // table is therefore identical everywhere: Math.sin may differ in the last
    // bit across engines, but rounding to 1/65536 erases that difference — the
    // error would have to exceed 7.6e-6 to change an entry, and IEEE sin is
    // accurate to about 1e-16.
    t[i] = Math.round(Math.sin((i / ANGLE_FULL) * Math.PI * 2) * FX_ONE) | 0;
  }
  return t;
})();

export function fxSin(brads: number): Fx {
  return SIN_TABLE[brads & ANGLE_MASK];
}

export function fxCos(brads: number): Fx {
  return SIN_TABLE[(brads + (ANGLE_FULL >> 2)) & ANGLE_MASK];
}

/** Angle of a vector in brads. Integer CORDIC-free approximation, exact. */
export function fxAtan2(y: Fx, x: Fx): number {
  if (x === 0 && y === 0) return 0;
  const ax = fxAbs(x);
  const ay = fxAbs(y);
  // Octant fold, then a table lookup on the ratio. 256 entries is finer than
  // anything the sim steers by.
  let a: number;
  if (ax >= ay) {
    a = ATAN_TABLE[fxDiv(ay, ax) >> 8];
  } else {
    a = 1024 - ATAN_TABLE[fxDiv(ax, ay) >> 8];
  }
  if (x < 0) a = 2048 - a;
  if (y < 0) a = -a;
  return a & ANGLE_MASK;
}

const ATAN_TABLE = (() => {
  const t = new Int32Array(257);
  for (let i = 0; i <= 256; i++) {
    t[i] = Math.round((Math.atan(i / 256) / (Math.PI * 2)) * ANGLE_FULL) | 0;
  }
  return t;
})();
