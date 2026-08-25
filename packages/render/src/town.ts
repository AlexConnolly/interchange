/**
 * Dealing a street out of the building kit. art-direction.md 8.
 *
 * features.md is explicit that you influence towns and never place buildings,
 * so a town's job on the art side is not to be authored but to be *dealt*: a
 * placement rule takes the kit `art/build_town.py` exports and lays out a
 * street from it. This file is that rule, and it is deliberately the only
 * thing in the renderer that knows where a building goes.
 *
 * Two properties matter more than how it looks.
 *
 * It has to be **stable under growth**. A town's mesh is rebuilt as its
 * population crosses a band, and if the layout depends on how many buildings
 * there are then adding one moves all the others — which is what happened in
 * the generated-geometry version and read, exactly as reported, as houses
 * changing every day. Building *i* here lands in the same place whatever the
 * total is, so growth only ever extends a street.
 *
 * And it has to **agree with itself**. What makes a town look like a town is
 * not the buildings, it is that they share a frontage and face the same way.
 * The same buildings at random angles is a car park.
 */

import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { eraBand } from './models.ts';

/** Every model this file can place, and the order the kit is loaded in. */
export const TOWN_KIT = [
  'town_terrace_2', 'town_terrace_3', 'town_terrace_stone',
  'town_villa', 'town_villa_large',
  'town_shed',
  'town_slab_6', 'town_slab_12',
] as const;

/**
 * What each era builds with, and in what proportion.
 *
 * Weighted rather than uniform, because a town is mostly one thing with a few
 * exceptions — a Victorian town is terraces with the odd villa, and a town of
 * equal parts everything reads as a sample book rather than as a place. The
 * era bands are `eraBand`'s: horse and rail, motor, modern.
 */
const PALETTE: string[][] = [
  // 1860-1930: terraces, a villa or two, the occasional works shed.
  [
    'town_terrace_2', 'town_terrace_2', 'town_terrace_2', 'town_terrace_stone',
    'town_terrace_stone', 'town_terrace_3', 'town_villa', 'town_shed',
  ],
  // 1930-2000: taller terraces, more villas, the first blocks.
  [
    'town_terrace_3', 'town_terrace_3', 'town_terrace_2', 'town_villa',
    'town_villa_large', 'town_slab_6', 'town_shed', 'town_terrace_stone',
  ],
  // 2000-2100: blocks, with the old streets still standing.
  [
    'town_slab_6', 'town_slab_6', 'town_slab_12', 'town_villa_large',
    'town_terrace_3', 'town_terrace_2', 'town_slab_6', 'town_shed',
  ],
];

export interface Placement {
  model: string;
  matrix: Matrix4;
}

/** A small deterministic generator. Stable per town and per index, so the
 *  same building is always the same building. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Lay out a town of `count` buildings.
 *
 * Returns placements rather than geometry, so the caller decides whether to
 * merge them into one mesh or instance them — and so this function is testable
 * without a GPU, which for a rule about stability is most of the point.
 */
export function layOutTown(seed: number, count: number, era: number): Placement[] {
  const band = eraBand(era);
  const palette = PALETTE[band];
  // One street or two, from the seed alone. Never from the count: see above.
  const rows = (seed & 8) === 0 ? 1 : 2;
  const alongX = (seed & 4) === 0;
  const cursors = [-0.42, -0.42];
  const out: Placement[] = [];

  for (let i = 0; i < count; i++) {
    const row = i % rows;
    const r1 = hash(seed, i * 3);
    const r2 = hash(seed, i * 3 + 1);

    const model = palette[Math.floor(r1 * palette.length) % palette.length];
    // Building footprints come out of the kit at a fixed size, so the pitch
    // along the street is the model's own width plus a gap — approximated
    // here from the palette, because reading it back out of the geometry would
    // make the layout depend on load order.
    const width = model.startsWith('town_shed') ? 0.46
      : model.startsWith('town_slab') ? 0.30
        : model.startsWith('town_villa') ? 0.38 : 0.32;
    // Mostly touching, which is what makes a terrace; the occasional break is
    // what stops it being a wall.
    const gap = r2 < 0.7 ? 0.01 : 0.05 + r2 * 0.06;

    if (cursors[row] + width > 0.46) continue;
    const along = cursors[row] + width / 2;
    cursors[row] += width + gap;

    // The frontage this row shares, either side of the street.
    const frontage = rows === 1 ? 0 : row === 0 ? -0.24 : 0.24;
    const x = alongX ? along : frontage;
    const z = alongX ? frontage : along;

    /*
     * Which way it faces. The models are authored with their ridge across X
     * and their front on -Z, so a building on the near side of the street
     * needs no rotation and one opposite is turned to face back across it —
     * which is what makes two rows read as a street rather than as two
     * unrelated rows.
     */
    let turn = alongX ? 0 : Math.PI / 2;
    if (rows === 2 && row === 1) turn += Math.PI;

    const matrix = new Matrix4().compose(
      new Vector3(x, 0, z),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn),
      new Vector3(1, 1, 1),
    );
    out.push({ model, matrix });
  }
  return out;
}

/**
 * How many buildings a town of this size shows.
 *
 * Banded, so a town does not regenerate its geometry every time somebody moves
 * in, and capped, because past a couple of dozen the buildings are smaller
 * than the gaps between them and adding more only costs triangles.
 */
export function buildingCount(population: number): number {
  return Math.max(3, Math.min(24, Math.round(Math.sqrt(population) / 3.4)));
}

/** Merge a laid-out town into one geometry, given the loaded kit. */
export function mergeTown(
  places: Placement[], kit: Map<string, BufferGeometry>,
): BufferGeometry | null {
  const used = places.filter((p) => kit.has(p.model));
  if (used.length === 0) return null;

  let total = 0;
  for (const p of used) total += (kit.get(p.model) as BufferGeometry).getAttribute('position').count;

  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const emit = new Float32Array(total);
  const livery = new Float32Array(total);
  const v = new Vector3();
  let w = 0;
  for (const p of used) {
    const g = kit.get(p.model) as BufferGeometry;
    const gp = g.getAttribute('position');
    const gc = g.getAttribute('color');
    const ge = g.getAttribute('emit');
    const gl = g.getAttribute('livery');
    for (let i = 0; i < gp.count; i++) {
      v.set(gp.getX(i), gp.getY(i), gp.getZ(i)).applyMatrix4(p.matrix);
      pos[(w + i) * 3] = v.x;
      pos[(w + i) * 3 + 1] = v.y;
      pos[(w + i) * 3 + 2] = v.z;
      col[(w + i) * 3] = gc.getX(i);
      col[(w + i) * 3 + 1] = gc.getY(i);
      col[(w + i) * 3 + 2] = gc.getZ(i);
      emit[w + i] = ge ? ge.getX(i) : 0;
      // A building is never anybody's livery, and saying so explicitly stops
      // an instance colour from tinting a whole town.
      void gl;
      livery[w + i] = 0;
    }
    w += gp.count;
  }

  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('color', new BufferAttribute(col, 3));
  out.setAttribute('emit', new BufferAttribute(emit, 1));
  out.setAttribute('livery', new BufferAttribute(livery, 1));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}
