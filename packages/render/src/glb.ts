/**
 * Loading the models the art pipeline builds. art-pipeline.md 2 and 4.2.
 *
 * The pipeline's shipped artefact is a `.glb`, and the game's shader does not
 * want a glTF material — it wants three vertex attributes: a colour, an
 * emissive weight, and a livery mask. So loading is really *baking*: walk the
 * primitives, look up what each was painted with, and write those colours into
 * the buffers the shader reads. After that a pipeline model and a hand-built
 * one are indistinguishable downstream, which is the property that lets the
 * two coexist while the library is being converted piece by piece.
 *
 * Three things this has to get right, and each of them is a bug that would
 * look like something else:
 *
 *   Flat shading. Everything in this game is faceted on purpose
 *   (art-direction.md 5.1) and the exporter writes smooth normals wherever
 *   Blender had them. The geometry is de-indexed and its normals recomputed,
 *   which is the same discipline `geometry.ts` applies to everything it builds
 *   — every face owns its vertices.
 *
 *   The livery slot. A material named `livery` marks bodywork, and only those
 *   vertices get the company's colour multiplied in. Matched by name rather
 *   than by index because a glTF material index depends on the order the
 *   exporter happened to write the slots in, which is not a contract.
 *
 *   Axes. Blender is Z-up, glTF is Y-up, and the exporter is told to convert —
 *   so a model arrives Y-up and needs no rotation here. That is worth stating
 *   because a stray rotation at load time is exactly the bug art-pipeline.md 2
 *   says only a render catches, and this is the other end of the same wire.
 */

import { BufferAttribute, BufferGeometry, Color, type Mesh as ThreeMesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Where the pipeline writes, and where the client serves from. */
export const MODEL_PATH = 'models/';

/** The reserved material slots. Must match `LIVERY` and `LAMP` in art/lib.py. */
export const LIVERY_MATERIAL = 'livery';
export const LAMP_MATERIAL = 'lamp';

/**
 * Foliage. Any material whose name says canopy is leaves.
 *
 * A third reserved slot, and it earns its place the same way the other two do:
 * it lets the *material* say what a surface is, once, in the pipeline, and lets
 * the renderer decide what that means at draw time. Here it means the season —
 * leaves go yellow-green in April, gold in October and shrink to nothing in
 * December, and none of that wants a second model or a second draw call.
 *
 * Matched by substring rather than prefix, because the tree builder names them
 * after the tree: `oak_canopy`, `oak_canopy_lit`. The slot is a *claim about the
 * surface*, and where in the name it appears is the pipeline's business.
 */
export const LEAF_MATERIAL = 'canopy';

/** Does this material name claim a reserved slot? Prefix rather than equality
 *  because Blender suffixes duplicates (`livery.001`) and the pipeline names
 *  variants (`lamp_red`), and both are still the slot they say they are. */
function isSlot(name: string, slot: string): boolean {
  return name === slot || name.startsWith(slot + '.') || name.startsWith(slot + '_');
}

/**
 * One model, in two halves.
 *
 * Everything painted with the `lamp` slot comes out as a separate geometry,
 * because a light cannot be drawn by a lit material. Put a headlamp through
 * `MeshLambertMaterial` and it is brightest at noon and black at midnight —
 * exactly inverted. The lamp half is drawn unlit and blended additively, and
 * it is the only part of a vehicle that is *brighter* after dark.
 *
 * Split at load rather than at authoring time because the pipeline's job is to
 * describe the object once. It says "this face is a lamp"; what that means for
 * a draw call is the renderer's business.
 */
export interface Model {
  body: BufferGeometry;
  /** Null when the model has no lamps — a crate has none, and that is fine. */
  lamps: BufferGeometry | null;
}

export interface Kit {
  /** Baked geometry by model name, ready to hand to an InstancedMesh. */
  models: Map<string, Model>;
  /** What failed, so a missing model is a reported absence rather than a
   *  silently invisible lorry. */
  missing: string[];
}

/**
 * Fold every primitive of a loaded glb into one flat-shaded geometry.
 *
 * One geometry rather than a group because everything here is drawn by an
 * InstancedMesh, and an instanced *group* is several draw calls pretending to
 * be one. The pipeline already merges what it can with `merge_into`; this
 * finishes the job across material boundaries, which it cannot.
 */
function bake(root: ThreeMesh | { traverse: (f: (o: unknown) => void) => void }): Model | null {
  type Part = {
    geom: BufferGeometry; colour: Color; emit: number; livery: number;
    lamp: boolean;
    /** 1 on foliage, so the season can find it. See `LEAF_MATERIAL`. */
    leaf: number;
  };
  const parts: Part[] = [];

  root.traverse((node: unknown) => {
    const o = node as ThreeMesh;
    if (!o.isMesh || !o.geometry) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    // One primitive per material is how glTF stores a multi-material mesh, so
    // by the time it is here each mesh has exactly one.
    const m = materials[0] as { name?: string; color?: Color; emissiveIntensity?: number } | undefined;
    const name = m?.name ?? '';
    const colour = m?.color ? m.color.clone() : new Color(0.7, 0.7, 0.7);
    // Bake the node's world transform in: the pipeline authors in world
    // coordinates and parents afterwards, so a part's own matrix carries real
    // placement and dropping it puts the wheels inside the axle.
    o.updateWorldMatrix(true, false);
    const geom = o.geometry.clone();
    geom.applyMatrix4(o.matrixWorld);
    parts.push({
      geom,
      colour,
      emit: m?.emissiveIntensity ? Math.min(1, m.emissiveIntensity) : 0,
      livery: isSlot(name, LIVERY_MATERIAL) ? 1 : 0,
      lamp: isSlot(name, LAMP_MATERIAL),
      leaf: name.includes(LEAF_MATERIAL) ? 1 : 0,
    });
  });

  if (parts.length === 0) return null;

  for (const p of parts) {
    // De-index first: a shared vertex cannot have two face normals, and flat
    // shading needs one normal per face.
    if (p.geom.index) {
      const flat = p.geom.toNonIndexed();
      p.geom.dispose();
      p.geom = flat;
    }
  }

  const body = weld(parts.filter((p) => !p.lamp));
  const lamps = weld(parts.filter((p) => p.lamp));
  for (const p of parts) p.geom.dispose();
  if (!body) return null;
  return { body, lamps };
}

/** Fold a set of primitives into one flat-shaded, attributed geometry. */
function weld(parts: {
  geom: BufferGeometry; colour: Color; emit: number; livery: number; leaf: number;
}[]):
BufferGeometry | null {
  let total = 0;
  for (const p of parts) total += p.geom.getAttribute('position').count;
  if (total === 0) return null;

  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const emit = new Float32Array(total);
  const livery = new Float32Array(total);
  const leaf = new Float32Array(total);
  let w = 0;
  for (const p of parts) {
    const src = p.geom.getAttribute('position');
    for (let i = 0; i < src.count; i++) {
      pos[(w + i) * 3] = src.getX(i);
      pos[(w + i) * 3 + 1] = src.getY(i);
      pos[(w + i) * 3 + 2] = src.getZ(i);
      col[(w + i) * 3] = p.colour.r;
      col[(w + i) * 3 + 1] = p.colour.g;
      col[(w + i) * 3 + 2] = p.colour.b;
      emit[w + i] = p.emit;
      livery[w + i] = p.livery;
      leaf[w + i] = p.leaf;
    }
    w += src.count;
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('emit', new BufferAttribute(emit, 1));
  g.setAttribute('livery', new BufferAttribute(livery, 1));
  g.setAttribute('leaf', new BufferAttribute(leaf, 1));
  /*
   * Snow response, one for everything in a pipeline model.
   *
   * A building's roof takes snow and its walls do not, but that difference is
   * the *normal*, which the shader already has — a face pointing up gets snow
   * and a face pointing sideways does not, with no help from the geometry. The
   * attribute is here so pipeline models and hand-built meshes present the same
   * interface to the material; per-surface variation is what `Mesh.take` is
   * for, and only the roads need it.
   */
  g.setAttribute('snowTake', new BufferAttribute(new Float32Array(total).fill(1), 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Load a named set of models.
 *
 * Resolves once every one has either arrived or failed, and never rejects: a
 * region that cannot fetch its lorry should still be playable with the
 * fallback geometry, and the caller needs the list of what is missing in order
 * to decide that. A loader that throws would take the whole scene with it over
 * one absent file.
 */
export async function loadKit(names: string[], base = MODEL_PATH): Promise<Kit> {
  const loader = new GLTFLoader();
  const models = new Map<string, Model>();
  const missing: string[] = [];

  await Promise.all(names.map(async (name) => {
    try {
      const gltf = await loader.loadAsync(`${base}${name}.glb`);
      const baked = bake(gltf.scene);
      if (baked) models.set(name, baked);
      else missing.push(name);
    } catch {
      missing.push(name);
    }
  }));

  return { models, missing };
}
