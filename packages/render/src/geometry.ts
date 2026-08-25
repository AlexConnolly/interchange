/**
 * Code-authored geometry, in the engine.
 *
 * This is the same argument `art-pipeline.md` makes for Blender, applied one
 * layer further in: a model that is a program can be parameterised, and this
 * game needs one lorry across eight decades of bodywork in a dozen liveries at
 * three levels of detail. Authoring that by hand is a career; authoring it as
 * a function with arguments is an afternoon.
 *
 * The vocabulary mirrors `lib.py` — a chamfered `box`, a `wedge`, a `cyl` —
 * and for the same stated reason: it makes the build functions read as
 * descriptions of shape rather than as lists of coordinates, and it enforces
 * in one place the thing that is easy to get wrong and expensive to notice
 * late. Here that is flat shading: every face gets its own vertices, so a
 * normal is never averaged across an edge that is supposed to break.
 *
 * On scale. One world unit is one tile, and a tile is 32 m — so a real lorry
 * would be a quarter of a unit long and about two pixels at playing zoom.
 * Vehicles are therefore drawn about three times life size, which is what
 * every game in this genre does and what the fourteen-pixel test in
 * art-direction.md §7 is actually measured against.
 */

import { BufferGeometry, BufferAttribute } from 'three';
import type { RGB } from './palette.ts';

export class Mesh {
  /**
   * Vertices accumulate straight into typed arrays.
   *
   * The obvious version pushes onto three plain `number[]`s and converts at
   * the end, and it is roughly four times slower — a terrain chunk took eight
   * and a half milliseconds to build, against a six millisecond streaming
   * budget, so every chunk that came into view blew the frame. Growable
   * Float32Arrays with an explicit write index cost nothing extra to write and
   * hand the geometry its buffer without a conversion.
   */
  private posBuf: Float32Array;
  private colBuf: Float32Array;
  private emitBuf: Float32Array;
  private takeBuf: Float32Array;
  private n = 0;

  /**
   * How much snow the surfaces added from now on take, 0..1. A pen state.
   *
   * Set it, draw, set it again — the same way a plotter carries a colour. The
   * alternative was an extra argument on `tri`, `quad`, `flat`, `box`, `wedge`,
   * `roof`, `cyl` and `cylX`, nearly all of which would pass the default, in
   * order to say something that changes about four times in the whole codebase.
   *
   * It exists for one picture: a road under snow, cleared to two dark wheel
   * tracks. Everything on the road takes snow except the tracks, which take
   * none, so the same geometry that draws worn tarmac in July draws swept ruts
   * in January. The mechanic did not need new triangles; it needed the surfaces
   * to say what they are.
   */
  take = 1;

  constructor(expectedVertices = 512) {
    const cap = Math.max(64, expectedVertices);
    this.posBuf = new Float32Array(cap * 3);
    this.colBuf = new Float32Array(cap * 3);
    this.emitBuf = new Float32Array(cap);
    this.takeBuf = new Float32Array(cap);
  }

  get vertexCount(): number {
    return this.n;
  }

  private ensure(extra: number): void {
    if ((this.n + extra) * 3 <= this.posBuf.length) return;
    let cap = this.posBuf.length / 3;
    while ((this.n + extra) > cap) cap *= 2;
    const p = new Float32Array(cap * 3);
    const c = new Float32Array(cap * 3);
    const e = new Float32Array(cap);
    const t = new Float32Array(cap);
    p.set(this.posBuf);
    c.set(this.colBuf);
    e.set(this.emitBuf);
    t.set(this.takeBuf);
    this.posBuf = p;
    this.colBuf = c;
    this.emitBuf = e;
    this.takeBuf = t;
  }

  private v(x: number, y: number, z: number, c: RGB, e: number): void {
    const i = this.n * 3;
    this.posBuf[i] = x;
    this.posBuf[i + 1] = y;
    this.posBuf[i + 2] = z;
    this.colBuf[i] = c[0];
    this.colBuf[i + 1] = c[1];
    this.colBuf[i + 2] = c[2];
    this.emitBuf[this.n] = e;
    this.takeBuf[this.n] = this.take;
    this.n++;
  }

  /** Copy another mesh in, offset. Used to place a scatter prop into a chunk
   *  without building a separate geometry and draw call for each one. */
  append(other: Mesh, dx: number, dy: number, dz: number): void {
    const count = other.n;
    this.ensure(count);
    const o = this.n * 3;
    this.posBuf.set(other.posBuf.subarray(0, count * 3), o);
    for (let i = 0; i < count; i++) {
      this.posBuf[o + i * 3] += dx;
      this.posBuf[o + i * 3 + 1] += dy;
      this.posBuf[o + i * 3 + 2] += dz;
    }
    this.colBuf.set(other.colBuf.subarray(0, count * 3), o);
    this.emitBuf.set(other.emitBuf.subarray(0, count), this.n);
    this.takeBuf.set(other.takeBuf.subarray(0, count), this.n);
    this.n += count;
  }

  /**
   * A triangle. The three points are given in the order you would trace them
   * looking at the face from outside, going clockwise — which is how it reads
   * when you are writing "top-left, top-right, bottom-right" — and the
   * emission order is reversed here to produce the counter-clockwise winding
   * WebGL wants for a front face.
   *
   * Getting this backwards is the single most expensive kind of mistake in a
   * geometry library, because nothing *fails*: with double-sided material the
   * shape draws perfectly and every normal points into the solid, so the whole
   * world is lit from underneath and looks like it is at the bottom of a well.
   * It is invisible in the code and obvious in a picture, which is
   * art-pipeline.md §2's entire argument for rendering the thing you built.
   */
  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    c: RGB, e = 0,
  ): void {
    this.ensure(3);
    this.v(ax, ay, az, c, e);
    this.v(cx, cy, cz, c, e);
    this.v(bx, by, bz, c, e);
  }

  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    c: RGB, e = 0,
  ): void {
    this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, c, e);
    this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, c, e);
  }

  /**
   * A horizontal quad, facing up. Two triangles.
   *
   * Roads, rails and canals are *surfaces*, and drawing them as chamfered
   * solids costs 240 triangles a tile instead of 10. On a developed region
   * that is twenty million triangles of kerbstone nobody can see, and it was
   * the entire cost of the frame in the first performance run.
   */
  flat(cx: number, y: number, cz: number, hx: number, hz: number, c: RGB, emit = 0): void {
    this.quad(
      cx - hx, y, cz - hz,
      cx + hx, y, cz - hz,
      cx + hx, y, cz + hz,
      cx - hx, y, cz + hz,
      c, emit,
    );
  }

  /**
   * A chamfered box. Centre, half-extents, and a cut on every edge.
   *
   * Chamfer rather than bevel-for-realism: a two-degree rounding is invisible
   * at this size and costs the same. A visible cut plane catches the key light
   * and gives the form an edge to sit on, which is most of what separates a
   * modelled shape from a stretched cube.
   *
   * `top` tints the upward face, which is the cheapest way to get the three
   * tonal values art-direction §5.1 asks for out of one call.
   */
  box(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    chamfer: number, c: RGB, top?: RGB, side?: RGB, emit = 0,
  ): void {
    const k = Math.min(chamfer, hx * 0.9, hy * 0.9, hz * 0.9);
    const t = top ?? c;
    const s = side ?? c;
    const x0 = cx - hx;
    const x1 = cx + hx;
    const y0 = cy - hy;
    const y1 = cy + hy;
    const z0 = cz - hz;
    const z1 = cz + hz;

    if (k <= 0) {
      this.quad(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1, t, emit);
      this.quad(x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0, c, emit);
      this.quad(x0, y0, z1, x0, y1, z1, x1, y1, z1, x1, y0, z1, s, emit);
      this.quad(x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z0, s, emit);
      this.quad(x1, y0, z1, x1, y1, z1, x1, y1, z0, x1, y0, z0, s, emit);
      this.quad(x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1, s, emit);
      return;
    }

    // Inset faces, then a quad along each of the twelve edges, then a triangle
    // at each of the eight corners. The result is one closed solid whose
    // silhouette has a visible cut on every rail.
    const X0 = x0 + k;
    const X1 = x1 - k;
    const Y0 = y0 + k;
    const Y1 = y1 - k;
    const Z0 = z0 + k;
    const Z1 = z1 - k;

    // six faces
    this.quad(X0, y1, Z0, X1, y1, Z0, X1, y1, Z1, X0, y1, Z1, t, emit);
    this.quad(X0, y0, Z1, X1, y0, Z1, X1, y0, Z0, X0, y0, Z0, c, emit);
    this.quad(X0, Y0, z1, X0, Y1, z1, X1, Y1, z1, X1, Y0, z1, s, emit);
    this.quad(X1, Y0, z0, X1, Y1, z0, X0, Y1, z0, X0, Y0, z0, s, emit);
    this.quad(x1, Y0, Z1, x1, Y1, Z1, x1, Y1, Z0, x1, Y0, Z0, s, emit);
    this.quad(x0, Y0, Z0, x0, Y1, Z0, x0, Y1, Z1, x0, Y0, Z1, s, emit);

    // four vertical edge chamfers
    this.quad(X1, Y0, z1, X1, Y1, z1, x1, Y1, Z1, x1, Y0, Z1, s, emit);
    this.quad(x1, Y0, Z0, x1, Y1, Z0, X1, Y1, z0, X1, Y0, z0, s, emit);
    this.quad(X0, Y0, z0, X0, Y1, z0, x0, Y1, Z0, x0, Y0, Z0, s, emit);
    this.quad(x0, Y0, Z1, x0, Y1, Z1, X0, Y1, z1, X0, Y0, z1, s, emit);

    // four top edge chamfers
    this.quad(X0, y1, Z1, X1, y1, Z1, X1, Y1, z1, X0, Y1, z1, t, emit);
    this.quad(X1, y1, Z0, X0, y1, Z0, X0, Y1, z0, X1, Y1, z0, t, emit);
    this.quad(X1, y1, Z1, X1, y1, Z0, x1, Y1, Z0, x1, Y1, Z1, t, emit);
    this.quad(X0, y1, Z0, X0, y1, Z1, x0, Y1, Z1, x0, Y1, Z0, t, emit);

    // four bottom edge chamfers
    this.quad(X1, y0, Z1, X0, y0, Z1, X0, Y0, z1, X1, Y0, z1, c, emit);
    this.quad(X0, y0, Z0, X1, y0, Z0, X1, Y0, z0, X0, Y0, z0, c, emit);
    this.quad(X1, y0, Z0, X1, y0, Z1, x1, Y0, Z1, x1, Y0, Z0, c, emit);
    this.quad(X0, y0, Z1, X0, y0, Z0, x0, Y0, Z0, x0, Y0, Z1, c, emit);

    // eight corners
    this.tri(X1, y1, Z1, x1, Y1, Z1, X1, Y1, z1, t, emit);
    this.tri(X0, y1, Z1, X0, Y1, z1, x0, Y1, Z1, t, emit);
    this.tri(X1, y1, Z0, X1, Y1, z0, x1, Y1, Z0, t, emit);
    this.tri(X0, y1, Z0, x0, Y1, Z0, X0, Y1, z0, t, emit);
    this.tri(X1, y0, Z1, X1, Y0, z1, x1, Y0, Z1, c, emit);
    this.tri(X0, y0, Z1, x0, Y0, Z1, X0, Y0, z1, c, emit);
    this.tri(X1, y0, Z0, x1, Y0, Z0, X1, Y0, z0, c, emit);
    this.tri(X0, y0, Z0, X0, Y0, z0, x0, Y0, Z0, c, emit);
  }

  /**
   * A box pinched to a ridge along +Z. Prows, keels, crests, blades — anything
   * whose job is to say which way the thing is pointing.
   */
  wedge(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    pinch: number, c: RGB, top?: RGB,
  ): void {
    const t = top ?? c;
    const px = hx * pinch;
    const x0 = cx - hx;
    const x1 = cx + hx;
    const y0 = cy - hy;
    const y1 = cy + hy;
    const z0 = cz - hz;
    const z1 = cz + hz;
    const fx0 = cx - px;
    const fx1 = cx + px;
    this.quad(x0, y1, z0, x1, y1, z0, fx1, y1, z1, fx0, y1, z1, t);
    this.quad(fx0, y0, z1, fx1, y0, z1, x1, y0, z0, x0, y0, z0, c);
    this.quad(x0, y0, z0, x0, y1, z0, fx0, y1, z1, fx0, y0, z1, c);
    this.quad(fx1, y0, z1, fx1, y1, z1, x1, y1, z0, x1, y0, z0, c);
    this.quad(fx0, y0, z1, fx0, y1, z1, fx1, y1, z1, fx1, y0, z1, t);
    this.quad(x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z0, c);
  }

  /**
   * A pitched roof: two sloping planes meeting at a ridge, closed by a gable
   * at each end.
   *
   * This exists because a town made of boxes reads as a town made of boxes.
   * A flat slab on top of a cuboid is what the first version drew, and at any
   * camera angle it is a grey square on a beige square — nothing in the
   * silhouette says *building*. The pitch is the single strongest cue there
   * is, because a roof is the one part of a house whose shape is dictated by
   * rain rather than by taste, and every real one has it.
   *
   * `ridgeAlongX` picks which way the house faces. Getting a whole street to
   * agree on that is most of what makes a row of houses look like a street
   * rather than like scattered dice.
   *
   * `overhang` pushes the eaves out past the walls. It is a small number and
   * it does a lot: the shadow line under the eaves is what separates the roof
   * from the wall when the sun is high and the shading is flat.
   */
  roof(
    cx: number, baseY: number, cz: number,
    hx: number, hz: number, height: number,
    ridgeAlongX: boolean, overhang: number,
    c: RGB, gable?: RGB,
  ): void {
    const g = gable ?? c;
    const ex = hx + overhang;
    const ez = hz + overhang;
    const ridgeY = baseY + height;
    if (ridgeAlongX) {
      const x0 = cx - ex;
      const x1 = cx + ex;
      // Two slopes down to the eaves on the long sides.
      this.quad(x0, ridgeY, cz, x1, ridgeY, cz, x1, baseY, cz - ez, x0, baseY, cz - ez, c);
      this.quad(x0, baseY, cz + ez, x1, baseY, cz + ez, x1, ridgeY, cz, x0, ridgeY, cz, c);
      // And a triangle closing each end.
      this.tri(x0, baseY, cz - ez, x0, baseY, cz + ez, x0, ridgeY, cz, g);
      this.tri(x1, baseY, cz + ez, x1, baseY, cz - ez, x1, ridgeY, cz, g);
    } else {
      const z0 = cz - ez;
      const z1 = cz + ez;
      this.quad(cx, ridgeY, z0, cx, ridgeY, z1, cx - ex, baseY, z1, cx - ex, baseY, z0, c);
      this.quad(cx + ex, baseY, z0, cx + ex, baseY, z1, cx, ridgeY, z1, cx, ridgeY, z0, c);
      this.tri(cx - ex, baseY, z0, cx + ex, baseY, z0, cx, ridgeY, z0, g);
      this.tri(cx + ex, baseY, z1, cx - ex, baseY, z1, cx, ridgeY, z1, g);
    }
  }

  /** A prism about the Y axis. Segments low on purpose: eight is a barrel and
   *  six is a chimney, and at playing size nothing needs more. */
  cyl(
    cx: number, cy: number, cz: number,
    r0: number, r1: number, h: number,
    segments: number, c: RGB, top?: RGB,
  ): void {
    const t = top ?? c;
    const y0 = cy;
    const y1 = cy + h;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const cb = Math.cos(b);
      const sb = Math.sin(b);
      this.quad(
        cx + ca * r0, y0, cz + sa * r0,
        cx + ca * r1, y1, cz + sa * r1,
        cx + cb * r1, y1, cz + sb * r1,
        cx + cb * r0, y0, cz + sb * r0,
        c,
      );
      this.tri(cx, y1, cz, cx + ca * r1, y1, cz + sa * r1, cx + cb * r1, y1, cz + sb * r1, t);
      this.tri(cx, y0, cz, cx + cb * r0, y0, cz + sb * r0, cx + ca * r0, y0, cz + sa * r0, c);
    }
  }

  /** A prism about the X axis: a wheel, a boiler, a roller. */
  cylX(
    cx: number, cy: number, cz: number,
    r: number, len: number, segments: number, c: RGB,
  ): void {
    const x0 = cx - len / 2;
    const x1 = cx + len / 2;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      const ya = cy + Math.cos(a) * r;
      const za = cz + Math.sin(a) * r;
      const yb = cy + Math.cos(b) * r;
      const zb = cz + Math.sin(b) * r;
      this.quad(x0, ya, za, x1, ya, za, x1, yb, zb, x0, yb, zb, c);
      this.tri(x1, cy, cz, x1, ya, za, x1, yb, zb, c);
      this.tri(x0, cy, cz, x0, yb, zb, x0, ya, za, c);
    }
  }

  /** Translate everything written so far by an offset. */
  translate(dx: number, dy: number, dz: number, fromVertex = 0): void {
    for (let i = fromVertex * 3; i < this.n * 3; i += 3) {
      this.posBuf[i] += dx;
      this.posBuf[i + 1] += dy;
      this.posBuf[i + 2] += dz;
    }
  }

  get triangleCount(): number {
    return this.n / 3;
  }

  /** Lowest point, so the floor check from `export.py` can be automated. */
  get floor(): number {
    let lo = Infinity;
    for (let i = 1; i < this.n * 3; i += 3) lo = Math.min(lo, this.posBuf[i]);
    return lo === Infinity ? 0 : lo;
  }

  get height(): number {
    let hi = -Infinity;
    for (let i = 1; i < this.n * 3; i += 3) hi = Math.max(hi, this.posBuf[i]);
    return hi === -Infinity ? 0 : hi;
  }

  isEmpty(): boolean {
    return this.n === 0;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.posBuf.subarray(0, this.n * 3), 3));
    g.setAttribute('color', new BufferAttribute(this.colBuf.subarray(0, this.n * 3), 3));
    g.setAttribute('emit', new BufferAttribute(this.emitBuf.subarray(0, this.n), 1));
    g.setAttribute('snowTake', new BufferAttribute(this.takeBuf.subarray(0, this.n), 1));
    /*
     * Livery, as a per-vertex mask rather than a whole-mesh multiply.
     *
     * Everything built here is tintable end to end, which is how the shader
     * always behaved and what the hand-authored models were designed around.
     * The attribute exists for the models coming out of the Blender pipeline,
     * where art-pipeline.md 4.2 reserves a named material slot: a lorry's
     * bodywork takes the company's colour and its tyres and glass do not, and
     * the only way the shader can tell them apart is if the geometry says so.
     *
     * Filled here rather than tracked per vertex because it is the same value
     * for every vertex of a hand-built mesh, and a whole extra buffer written
     * on every vertex to hold a constant is a cost for nothing.
     */
    g.setAttribute('livery', new BufferAttribute(new Float32Array(this.n).fill(1), 1));
    // Non-indexed, so every face owns its vertices and gets its own normal.
    // That is the whole flat-shading discipline in one line.
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
