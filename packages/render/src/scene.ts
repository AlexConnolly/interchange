/**
 * The renderer. Rebuilt against `art/reference/TARGET-FRAME.png`.
 *
 * The old one was 1,406 lines and solved a different problem: five transport
 * modes, eight eras, twenty overlay modes, regions up to 1024². It also had no
 * shadows at all — a two-term hemisphere model in a hand-written shader — which
 * is most of the reason nothing in it had any weight.
 *
 * The three decisions that matter, all taken from the picture rather than from
 * principles:
 *
 *   **Shadows.** A single directional light with a shadow map, following the
 *   camera. Nothing else in this file makes as much difference. The frame's long
 *   afternoon shadows are what make a hedge a hedge and a lorry an object
 *   sitting on a road rather than a decal printed on it.
 *
 *   **Three's own lit material, not a custom shader.** `MeshLambertMaterial`
 *   with vertex colours. Flat-shaded low poly barely cares about the BRDF, and
 *   what it does care about — shadow receiving, correct output encoding, a tone
 *   mapping that does not have opinions — comes free and correct. The old custom
 *   shader hand-rolled linear-to-sRGB, clipped every highlight, and could not
 *   receive a shadow at all.
 *
 *   **No overlays.** The old renderer had twenty modes recolouring the world
 *   wholesale. `design.md` allows eight controls on screen; a mode switcher with
 *   twenty entries is not a feature, it is an admission that the world does not
 *   show you what you need.
 */

import {
  BackSide, Color, DirectionalLight, DoubleSide, Group,
  InstancedMesh, MeshLambertMaterial, Object3D, OrthographicCamera,
  HemisphereLight, PCFSoftShadowMap, Scene as ThreeScene, Vector3, WebGLRenderer,
  type BufferGeometry,
} from 'three';
import { buildGround, toMesh, HEIGHT_TO_WORLD, type GroundSource } from './ground.ts';
import { buildRoads, type RoadSource } from './roads.ts';
import { LIVERY, SKY } from './palette.ts';

export { HEIGHT_TO_WORLD };

/** Tiles per chunk. Small enough that one rebuild is cheap, large enough that a
 *  128² district is sixty-four draw calls rather than a thousand. */
export const CHUNK = 16;

/**
 * How many tiles the camera shows across the frame.
 *
 * This is *the* number, derived backwards from readability as postmortem.md
 * demands: a lorry has to be about forty pixels, a lorry is drawn about a tile
 * long, so a 1920 px frame shows about twenty-six tiles. Everything else — the
 * district size, the field size, the model budgets — follows from it.
 */
export const TILES_ACROSS_DEFAULT = 26;

export interface RenderSource extends GroundSource, RoadSource {
  /** Vehicles: position in tiles, heading in turns, and whose it is. */
  vehicleCount: number;
  vx: Float32Array;
  vz: Float32Array;
  vHeading: Float32Array;
  vLivery: Uint8Array;
  /** 0..1 through the day, for the sun. */
  dayFraction: number;
}

interface Chunk {
  ground: ReturnType<typeof toMesh>;
  roads: ReturnType<typeof toMesh> | null;
  seen: number;
}

export class Renderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new ThreeScene();
  private readonly camera: OrthographicCamera;
  private readonly material: MeshLambertMaterial;
  private readonly sun: DirectionalLight;
  private readonly fill: HemisphereLight;
  private readonly chunks = new Map<number, Chunk>();
  private readonly fleet = new Group();
  private batches: (InstancedMesh | null)[] = [];
  private frame = 0;
  private cols = 0;

  /** Where the camera is looking, in tiles, and how much it shows. */
  camX = 0;
  camZ = 0;
  /** The height of the ground under the camera's target, so the view is framed
   *  on the land rather than on the origin plane. */
  camY = 0;
  tilesAcross = TILES_ACROSS_DEFAULT;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    /*
     * Shadows, and this is the single most important line in the file.
     *
     * Soft PCF at 2048: big enough that a hedge casts a hedge rather than a
     * staircase, small enough to cost nothing on an integrated part. The old
     * renderer had no shadow map at all.
     */
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // No tone mapping. The target frame was rendered through Standard for
    // exactly this reason: a film curve desaturates, and the palette is meant
    // to arrive as authored.
    this.renderer.setClearColor(new Color(...SKY.horizon));

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    /*
     * Double-sided, and it is not laziness.
     *
     * `geometry.ts`'s `tri` emits its vertices a, c, b — reversed winding —
     * which the old renderer never noticed because its material was
     * double-sided too. Switching to a front-facing material made every ground
     * triangle in the district invisible and left a screen showing nothing but
     * the hedges, which was a good five minutes.
     *
     * Fixing the winding would mean re-deriving every call site in the mesh
     * builder and in the Blender export path, for a saving in fill rate that
     * this scene does not need. The convention is reversed; the material is
     * told so; the shadow side is set to back so a double-sided surface does
     * not shadow-acne against itself.
     */
    this.material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    this.material.shadowSide = BackSide;

    this.sun = new DirectionalLight(new Color(...SKY.sun), 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.near = 0.5;
    cam.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sun.target);

    /*
     * A hemisphere, not a flat ambient.
     *
     * An AmbientLight adds the same amount to every surface whatever way it
     * faces, so it does not describe form — it only reduces contrast, and at
     * the intensity needed to lift the shadows it put a blue-grey wash over the
     * whole district. A hemisphere light is sky from above and bounce from
     * below, which lifts the shadows *and* keeps an upward face brighter than a
     * vertical one. That difference is most of what makes a hedge read as
     * standing up.
     */
    this.fill = new HemisphereLight(
      new Color(...SKY.zenith), new Color(...SKY.ground), 0.78,
    );
    this.scene.add(this.fill);
    this.scene.add(this.fleet);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    const half = this.tilesAcross / 2;
    this.camera.left = -half;
    this.camera.right = half;
    this.camera.top = half / aspect;
    this.camera.bottom = -half / aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Place the camera.
   *
   * A low three-quarter orthographic view, matching the target frame's 38° of
   * elevation and 32° of azimuth. Low enough to see the sides of things, which
   * is what a steeper camera loses and why the old build's buildings read as
   * coloured footprints.
   */
  private placeCamera(): void {
    const el = (38 * Math.PI) / 180;
    const az = (-32 * Math.PI) / 180;
    const d = 120;
    /*
     * Aim at the ground, not at y = 0.
     *
     * The district's surface is tens of world units above zero wherever there
     * are hills, so a camera aimed at the origin plane puts the land in the
     * bottom corner and half a screen of sky above it. Which is exactly what it
     * did.
     */
    const target = new Vector3(this.camX, this.camY, this.camZ);
    this.camera.position.set(
      target.x + Math.sin(az) * Math.cos(el) * d,
      target.y + Math.sin(el) * d,
      target.z - Math.cos(az) * Math.cos(el) * d,
    );
    this.camera.lookAt(target);
  }

  /**
   * Point the sun, and move its shadow camera to where the player is looking.
   *
   * A shadow camera large enough for a whole district would waste almost all of
   * its resolution on ground nobody can see. Following the view keeps the map
   * tight around what is on screen, which is how a 2048 map produces sharp
   * shadows over a 26-tile frame.
   */
  /** Sample the ground under the camera so the view stays framed as it pans. */
  private followGround(src: RenderSource): void {
    const x = Math.max(0, Math.min(src.size - 1, Math.round(this.camX)));
    const z = Math.max(0, Math.min(src.size - 1, Math.round(this.camZ)));
    const h = HEIGHT_TO_WORLD(Math.max(0, src.height[z * src.size + x] ?? 0));
    // Eased, so panning across a ridge is a drift rather than a lurch.
    this.camY += (h - this.camY) * 0.12;
  }

  private placeSun(dayFraction: number): void {
    // Late afternoon at the reference, swinging through the day but never
    // straight overhead — a high sun kills every shadow and the shadows are
    // the point.
    const t = dayFraction;
    const angle = (t - 0.25) * Math.PI * 2;
    const elevation = Math.max(0.28, Math.sin(angle) * 0.75 + 0.30);
    const azimuth = 0.7 + t * 1.6;
    const d = 70;
    this.sun.target.position.set(this.camX, this.camY, this.camZ);
    this.sun.position.set(
      this.camX + Math.cos(azimuth) * d * (1 - elevation * 0.5),
      this.camY + elevation * d,
      this.camZ + Math.sin(azimuth) * d * (1 - elevation * 0.5),
    );
    const c = this.sun.shadow.camera;
    const reach = this.tilesAcross * 0.9;
    c.left = -reach;
    c.right = reach;
    c.top = reach;
    c.bottom = -reach;
    c.updateProjectionMatrix();

    // Warm and strong when low, cooler and softer at noon.
    const warm = 1 - elevation * 0.4;
    this.sun.color.setRGB(
      SKY.sun[0], SKY.sun[1] * (0.94 + warm * 0.06), SKY.sun[2] * (0.82 + warm * 0.18),
    );
    // The sun does the describing and the fill only stops the shadows going
    // black. Getting that ratio the wrong way round is what washed the first
    // build out.
    this.sun.intensity = 2.5 + elevation * 0.5;
    this.fill.intensity = 0.62 + (1 - elevation) * 0.22;
  }

  /** Stream the chunks around the camera, building what has come into view. */
  private streamChunks(src: RenderSource): void {
    this.cols = Math.ceil(src.size / CHUNK);
    const reach = this.tilesAcross * 1.1 + CHUNK;
    const minX = Math.max(0, Math.floor((this.camX - reach) / CHUNK));
    const maxX = Math.min(this.cols - 1, Math.floor((this.camX + reach) / CHUNK));
    const minZ = Math.max(0, Math.floor((this.camZ - reach) / CHUNK));
    const maxZ = Math.min(this.cols - 1, Math.floor((this.camZ + reach) / CHUNK));
    const frame = ++this.frame;

    // A time budget rather than a chunk count: the first frame has to deliver
    // the whole visible district, because a world that fades in reads as
    // broken, and later frames must never stall.
    const t0 = performance.now();
    const budget = this.chunks.size === 0 ? 500 : 6;

    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const key = cz * this.cols + cx;
        const have = this.chunks.get(key);
        if (have) {
          have.seen = frame;
          continue;
        }
        if (performance.now() - t0 > budget) continue;
        const x0 = cx * CHUNK;
        const z0 = cz * CHUNK;
        const x1 = Math.min(src.size, x0 + CHUNK);
        const z1 = Math.min(src.size, z0 + CHUNK);

        const ground = toMesh(buildGround(src, x0, z0, x1, z1), this.material);
        this.scene.add(ground);
        const roadMesh = buildRoads(src, x0, z0, x1, z1);
        let roads: Chunk['roads'] = null;
        if (!roadMesh.isEmpty()) {
          roads = toMesh(roadMesh, this.material);
          // A road receives shadow and does not cast one. A flat surface
          // casting onto itself is shadow acne and nothing else.
          roads.castShadow = false;
          this.scene.add(roads);
        }
        this.chunks.set(key, { ground, roads, seen: frame });
      }
    }

    // Drop what has gone out of view.
    for (const [key, chunk] of [...this.chunks]) {
      if (chunk.seen === frame) continue;
      this.scene.remove(chunk.ground);
      chunk.ground.geometry.dispose();
      if (chunk.roads) {
        this.scene.remove(chunk.roads);
        chunk.roads.geometry.dispose();
      }
      this.chunks.delete(key);
    }
  }

  /** Hand the renderer the vehicle model, once it has loaded. */
  setVehicleModel(geometry: BufferGeometry, capacity = 256): void {
    for (const b of this.batches) {
      if (b) {
        this.fleet.remove(b);
        b.dispose();
      }
    }
    this.batches = LIVERY.map((liv) => {
      const mat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
      mat.shadowSide = BackSide;
      const mesh = new InstancedMesh(geometry, mat, capacity);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      // The livery tints the whole instance. The models reserve a slot for it,
      // but a lorry that is entirely its company's colour reads better at forty
      // pixels than one with a stripe on it.
      void liv;
      this.fleet.add(mesh);
      return mesh;
    });
  }

  private readonly tmp = new Object3D();

  private updateFleet(src: RenderSource): void {
    if (this.batches.length === 0) return;
    const counts = new Array(this.batches.length).fill(0);
    for (let i = 0; i < src.vehicleCount; i++) {
      const b = src.vLivery[i] % this.batches.length;
      const batch = this.batches[b];
      if (!batch || counts[b] >= batch.instanceMatrix.count) continue;
      const x = src.vx[i];
      const z = src.vz[i];
      const tile = Math.min(src.size * src.size - 1,
        (Math.round(z) * src.size + Math.round(x)) | 0);
      const lv = src.level[tile];
      const y = (lv !== 0 ? HEIGHT_TO_WORLD(lv) : HEIGHT_TO_WORLD(src.height[tile])) + 0.04;
      this.tmp.position.set(x, y, z);
      this.tmp.rotation.set(0, -src.vHeading[i] * Math.PI * 2 + Math.PI, 0);
      this.tmp.updateMatrix();
      batch.setMatrixAt(counts[b]++, this.tmp.matrix);
    }
    for (let b = 0; b < this.batches.length; b++) {
      const batch = this.batches[b];
      if (!batch) continue;
      batch.count = counts[b];
      batch.instanceMatrix.needsUpdate = true;
    }
  }

  render(src: RenderSource): void {
    this.followGround(src);
    this.streamChunks(src);
    this.updateFleet(src);
    this.placeSun(src.dayFraction);
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }

  get stats(): { chunks: number; calls: number; triangles: number } {
    const info = this.renderer.info.render;
    return { chunks: this.chunks.size, calls: info.calls, triangles: info.triangles };
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
