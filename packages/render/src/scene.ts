/**
 * The renderer. Orthographic, instanced, chunked.
 *
 * Three rules from art-direction.md drive the whole file.
 *
 *   The camera decides everything (§1). Orthographic at a fixed elevation,
 *   rotatable in ninety-degree steps. Height survives; footprint along the
 *   view axis does not.
 *
 *   The world is never dressed with UI (§14). No floating labels, no icons in
 *   the resting state. Overlay modes recolour the world wholesale rather than
 *   adding marks to it — each mode is a different drawing of the same place.
 *
 *   Motion is art direction, not polish (§12). The renderer interpolates
 *   between simulation ticks so a queue reads as a queue; a dropped frame
 *   costs a frame and never a tick.
 */

import {
  BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, Mesh as ThreeMesh,
  OrthographicCamera, Quaternion, Scene as ThreeScene, Vector3, WebGLRenderer,
} from 'three';
import {
  BIOME_COLOURS, LAND, LIVERIES, SEMANTIC, WAY_COLOURS, shade, type RGB,
} from './palette.ts';
import { Mesh } from './geometry.ts';
import { buildIndustry, buildTownBlock, buildTreeClump, buildVehicle } from './models.ts';
import { applyLighting, createWorldMaterial, lightingForTime, makeLighting } from './material.ts';

/** Tiles per render chunk. Small enough that an edit rebuilds little, large
 *  enough that a region is not a hundred thousand draw calls. */
export const CHUNK = 32;

/**
 * Vertical exaggeration.
 *
 * One height unit is half a metre and one tile is thirty-two, so real
 * elevation is already correct at 1.0 — a 1000 m ridge stands 31 tiles tall.
 * At an orthographic 35 degrees that reads flatter than it measures, because
 * the eye reads relief against the *ground* distance the camera is
 * foreshortening. 1.5 puts the highlands back where the map says they are.
 */
export const VERTICAL = 1.5;

export const HEIGHT_TO_WORLD = (h: number) => (h / 64) * VERTICAL;

export const OverlayMode = {
  None: 0,
  Congestion: 1,
  Ownership: 2,
  Amenity: 3,
  Catchment: 4,
  Power: 5,
  Water: 6,
  Cargo: 7,
} as const;
export type OverlayMode = (typeof OverlayMode)[keyof typeof OverlayMode];

/** Everything the renderer needs from the simulation. Deliberately a plain
 *  data interface: the renderer must never reach into sim state and must never
 *  write to it (determinism rule 6). */
export interface RenderSource {
  size: number;
  height: Int16Array;
  biome: Uint8Array;
  flags: Uint8Array;
  amenity: Uint8Array;
  /** Per-mode tile layers. */
  wayClass: Uint8Array[];
  wayDir: Uint8Array[];
  wayAsset: Int32Array[];
  wayLink: Int32Array[];
  /** Formation level per tile, per mode. A way sits on this, not the ground. */
  wayLevel: Int16Array[];
  /** Embankment / cutting / bridge / tunnel bits. */
  wayFlags: Uint8Array[];
  assetOwner: Int16Array;
  assetCondition: Uint8Array;
  linkFlowPrev: Int32Array;
  linkCellCount: Int32Array;
  wayColourOf: (cls: number) => RGB;
  /** Vehicles, already projected to world tiles in Q16.16. */
  vehicleCount: number;
  vAlive: Uint8Array;
  vType: Uint8Array;
  vCompany: Int16Array;
  vX: Int32Array;
  vY: Int32Array;
  vHeading: Int32Array;
  vState: Uint8Array;
  vLoad: Int32Array;
  vehicleClassOf: (type: number) => string;
  vehicleEraOf: (type: number) => number;
  /** Sites. */
  siteCount: number;
  sX: Int32Array;
  sY: Int32Array;
  sState: Uint8Array;
  sDef: Int32Array;
  sOwner: Int16Array;
  industryKitOf: (def: number) => string;
  industryFootprintOf: (def: number) => number;
  /** Towns. */
  townCount: number;
  tX: Int32Array;
  tY: Int32Array;
  tPopulation: Int32Array;
  /**
   * A per-tile field, 0..1, for whichever overlay wants one — amenity,
   * catchment, and later the noise and pollution fields. Null when the current
   * overlay does not use one.
   *
   * Overlay modes recolour the world wholesale rather than adding marks to it
   * (art-direction.md §14), so a field is the natural shape: each mode is a
   * different drawing of the same place, and the drawing is a function from
   * tile to colour.
   */
  overlayField: Float32Array | null;
  /** Per-mode grid satisfaction, 0..100, indexed by the grid a tile is on. */
  gridSatisfaction: Float32Array | null;
  gridOfTile: Int32Array | null;
  /** Calendar. */
  dayFraction: number;
  season: number;
  era: number;
  player: number;
}

interface Chunk {
  terrain: ThreeMesh;
  ways: ThreeMesh | null;
  props: ThreeMesh | null;
  overlayVersion: number;
  wayVersion: number;
  /** Frame this chunk was last wanted, for eviction without a per-frame Set. */
  seen: number;
}

interface VehicleBatch {
  mesh: InstancedMesh;
  count: number;
  /** Which LOD the geometry in this batch was built at. */
  far: boolean;
}

export interface CameraState {
  /** Centre of view, in tiles. */
  x: number;
  z: number;
  /** Tiles visible vertically. Smaller is closer in. */
  view: number;
  /** 0..3, ninety degrees apart. */
  rotation: number;
  /** Degrees above the horizon. art-direction.md §1 leaves this open for
   *  Phase 0 to settle with real geometry; 35 is the proposal. */
  elevation: number;
}

export class Renderer {
  readonly scene = new ThreeScene();
  readonly camera: OrthographicCamera;
  readonly renderer: WebGLRenderer;
  readonly material = createWorldMaterial();

  camState: CameraState = { x: 0, z: 0, view: 90, rotation: 0, elevation: 35 };
  overlay: OverlayMode = OverlayMode.None;
  showGrid = false;
  selectedVehicle = -1;
  selectedTile = -1;

  private chunks = new Map<number, Chunk>();
  private vehicleBatches = new Map<number, VehicleBatch>();
  private siteMeshes = new Map<number, ThreeMesh>();
  private townMeshes = new Map<number, ThreeMesh>();
  private sea: ThreeMesh | null = null;
  private previewMesh: ThreeMesh | null = null;
  private overlayVersion = 0;
  private wayVersion = 0;
  private cols = 0;

  private frameCounter = 0;
  private terrainScratchPos = new Float32Array(0);
  private terrainScratchCol = new Float32Array(0);
  /** Reused, so the day/night cycle does not allocate four colours a frame. */
  private light = makeLighting();

  /** Live count per vehicle type, so instance buffers can be sized correctly. */
  private typeCounts = new Int32Array(256);

  /** Previous vehicle positions, for tick interpolation. */
  private prevX = new Int32Array(0);
  private prevY = new Int32Array(0);
  private prevHeading = new Int32Array(0);
  private havePrev = false;

  /**
   * Where the frame went. Kept permanently rather than added for one
   * investigation: roadmap.md Phase 6 wants frame time tracked against
   * per-device budgets over time, and a single total tells you that you are
   * over budget without telling you which part to look at.
   */
  stats = {
    chunks: 0, instances: 0, drawCalls: 0, triangles: 0,
    buildMs: 0, sitesMs: 0, townsMs: 0, vehiclesMs: 0, drawMs: 0,
    chunksBuilt: 0, sitesBuilt: 0, townsBuilt: 0, batchesBuilt: 0,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio ?? 1));
    this.camera = new OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
    this.scene.background = new Color(0.06, 0.09, 0.13);
  }

  dispose(): void {
    for (const c of this.chunks.values()) {
      c.terrain.geometry.dispose();
      c.ways?.geometry.dispose();
      c.props?.geometry.dispose();
    }
    this.chunks.clear();
    this.renderer.dispose();
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.updateCamera(width / height);
  }

  /**
   * A ghost alignment, drawn over the world while the player is dragging one
   * out. Rebuilt whenever it changes rather than every frame: a drag produces
   * a new route only when the cursor crosses a tile boundary.
   */
  setPreview(
    tiles: ArrayLike<number> | null,
    levels: ArrayLike<number> | null,
    flags: ArrayLike<number> | null,
    ok: boolean,
    size: number,
  ): void {
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
      this.previewMesh = null;
    }
    if (!tiles || tiles.length === 0) return;
    const m = new Mesh(tiles.length * 40);
    // The semantic set, and nothing else: a legal alignment is the good hue
    // and an illegal one is the failure hue, both reserved.
    const good: RGB = [0.36, 0.78, 0.52];
    const bad: RGB = [0.86, 0.28, 0.24];
    const c = ok ? good : bad;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const x = tile % size;
      const y = (tile / size) | 0;
      const level = levels ? levels[i] : 0;
      const yy = HEIGHT_TO_WORLD(level) + 0.09;
      m.flat(x + 0.5, yy, y + 0.5, 0.34, 0.34, c, 0.85);
      const f = flags ? flags[i] : 0;
      // A marker on anything that is not ordinary construction, so the player
      // sees the expensive tiles before they see the bill.
      if (f !== 0) m.box(x + 0.5, yy + 0.10, y + 0.5, 0.09, 0.09, 0.09, 0.02, c, c, c, 1);
    }
    const mesh = new ThreeMesh(m.build(), this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.previewMesh = mesh;
  }

  /** Recolour everything. Cheap enough to call on a mode change. */
  invalidateOverlay(): void {
    this.overlayVersion++;
  }

  /** The network changed; way meshes must be rebuilt. */
  invalidateWays(): void {
    this.wayVersion++;
  }

  private updateCamera(aspect: number): void {
    const c = this.camState;
    const halfH = c.view / 2;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;

    const el = (c.elevation * Math.PI) / 180;
    const az = (c.rotation * Math.PI) / 2 + Math.PI / 4;
    this.camera.position.set(
      c.x + Math.cos(az) * Math.cos(el) * CAMERA_DISTANCE,
      Math.sin(el) * CAMERA_DISTANCE,
      c.z + Math.sin(az) * Math.cos(el) * CAMERA_DISTANCE,
    );
    this.camera.lookAt(c.x, 0, c.z);
    this.camera.updateProjectionMatrix();
  }

  /**
   * The foreshortening constants for the current camera, art-direction.md §1.
   *
   * For an orthographic camera at elevation θ a world-vertical length arrives
   * at cos(θ), a ground length across the view at 1, and a ground length along
   * the view axis at sin(θ). These are exact — but the document is right that
   * the *method* is what transfers and the constant is what must be measured,
   * because the numbers below are only true if the axes are what we think they
   * are. `packages/tools/src/foreshorten.ts` measures them off a real render.
   */
  foreshortening(): { vertical: number; across: number; along: number } {
    const el = (this.camState.elevation * Math.PI) / 180;
    return { vertical: Math.cos(el), across: 1, along: Math.sin(el) };
  }

  // -------------------------------------------------------------- terrain

  private terrainColour(src: RenderSource, tile: number): RGB {
    const h = src.height[tile];
    if (this.overlay === OverlayMode.Amenity) {
      const a = src.amenity[tile] / 100;
      return [0.75 - a * 0.55, 0.30 + a * 0.50, 0.32 + a * 0.18];
    }
    if (this.overlay === OverlayMode.Catchment && src.overlayField) {
      // How many people can reach here inside a commute. The field is the
      // whole answer to "where should this industry go", so it gets the
      // strongest treatment of any overlay.
      const v = Math.min(1, src.overlayField[tile]);
      if (h <= 0) return [0.05, 0.07, 0.10];
      return [0.10 + v * 0.62, 0.13 + v * 0.52, 0.30 - v * 0.14];
    }
    if ((this.overlay === OverlayMode.Power || this.overlay === OverlayMode.Water) && h <= 0) {
      return [0.05, 0.07, 0.10];
    }
    if (this.overlay !== OverlayMode.None && h > 0) {
      // Every other overlay wants the land as a neutral ground so the marks on
      // top carry all the information.
      const v = 0.16 + Math.min(0.18, h / 9000);
      return [v, v * 1.02, v * 1.06];
    }
    if (h <= 0) {
      // Depth, not a flat field. Two colours lerped over the shelf gives the
      // coast a readable edge; a single ocean blue makes every bay look like
      // deep water and hides where a wharf could go.
      const t = Math.min(1, -h / 90);
      return [
        LAND.shallows[0] + (LAND.oceanDeep[0] - LAND.shallows[0]) * t,
        LAND.shallows[1] + (LAND.oceanDeep[1] - LAND.shallows[1]) * t,
        LAND.shallows[2] + (LAND.oceanDeep[2] - LAND.shallows[2]) * t,
      ];
    }
    const c = BIOME_COLOURS[src.biome[tile]] ?? LAND.grass;
    // A gentle lift with altitude, so relief reads even where the biome is
    // uniform. The land is a ground, not a subject: this stays small.
    const lift = Math.min(0.07, h / 40000);
    return [c[0] + lift, c[1] + lift, c[2] + lift];
  }

  private buildTerrainChunk(src: RenderSource, cx: number, cy: number): ThreeMesh {
    const size = src.size;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const x1 = Math.min(size, x0 + CHUNK);
    const y1 = Math.min(size, y0 + CHUNK);

    const cornerH = (x: number, y: number): number => {
      // Average the four tiles meeting at this corner; clamping at the edge
      // keeps the border from folding down into the sea.
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const tx = Math.max(0, Math.min(size - 1, x + dx));
          const ty = Math.max(0, Math.min(size - 1, y + dy));
          sum += src.height[ty * size + tx];
          n++;
        }
      }
      return HEIGHT_TO_WORLD(sum / n);
    };

    // Exactly six vertices per tile, so the buffers are sized once and written
    // by index. The array-of-numbers version of this was the single slowest
    // thing in the renderer.
    const tiles = (x1 - x0) * (y1 - y0);
    const pos = this.terrainScratchPos.length >= tiles * 18
      ? this.terrainScratchPos
      : (this.terrainScratchPos = new Float32Array(tiles * 18));
    const col = this.terrainScratchCol.length >= tiles * 18
      ? this.terrainScratchCol
      : (this.terrainScratchCol = new Float32Array(tiles * 18));
    let w = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const tile = y * size + x;
        const c = this.terrainColour(src, tile);
        const isSea = src.height[tile] <= 0;
        const h00 = isSea ? 0 : cornerH(x, y);
        const h10 = isSea ? 0 : cornerH(x + 1, y);
        const h01 = isSea ? 0 : cornerH(x, y + 1);
        const h11 = isSea ? 0 : cornerH(x + 1, y + 1);
        // Split the quad along the shorter diagonal so a ridge stays a ridge
        // rather than being bridged flat by an arbitrary triangulation.
        const flip = Math.abs(h00 - h11) > Math.abs(h10 - h01);
        const px: number[] = flip
          ? [x, h00, y, x + 1, h11, y + 1, x + 1, h10, y, x, h00, y, x, h01, y + 1, x + 1, h11, y + 1]
          : [x, h00, y, x, h01, y + 1, x + 1, h10, y, x + 1, h10, y, x, h01, y + 1, x + 1, h11, y + 1];
        for (let k = 0; k < 18; k += 3) {
          pos[w] = px[k];
          pos[w + 1] = px[k + 1];
          pos[w + 2] = px[k + 2];
          col[w] = c[0];
          col[w + 1] = c[1];
          col[w + 2] = c[2];
          w += 3;
        }
      }
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos.slice(0, w), 3));
    g.setAttribute('color', new BufferAttribute(col.slice(0, w), 3));
    // Terrain has no emissive surfaces, so the attribute is a shared zero
    // buffer rather than one per chunk.
    g.setAttribute('emit', new BufferAttribute(zeroEmit(w / 3), 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new ThreeMesh(g, this.material);
    mesh.frustumCulled = true;
    return mesh;
  }

  /**
   * Ways, drawn as a hub and arms rather than a full tile.
   *
   * A road that fills its tile reads as a coloured floor; a road drawn as a
   * narrow band with arms reaching to the connected edges reads as a road, and
   * — more usefully — its junctions become visible as junctions, which is the
   * thing the player is actually reading the map for.
   */
  private buildWayChunk(src: RenderSource, cx: number, cy: number): ThreeMesh | null {
    const size = src.size;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const x1 = Math.min(size, x0 + CHUNK);
    const y1 = Math.min(size, y0 + CHUNK);
    const m = new Mesh(CHUNK * CHUNK * 30);
    const DIRDX = [0, 1, 0, -1];
    const DIRDY = [-1, 0, 1, 0];

    for (let mode = 0; mode < src.wayClass.length; mode++) {
      const cls = src.wayClass[mode];
      const dir = src.wayDir[mode];
      const wayLevel = src.wayLevel[mode];
      const wayFlags = src.wayFlags[mode];
      if (!cls) continue;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const tile = y * size + x;
          const c = cls[tile];
          if (c === 255) continue;
          const groundY = HEIGHT_TO_WORLD(Math.max(0, src.height[tile]));
          // The formation, not the ground. A level of zero means the way was
          // laid before the profile existed, so fall back to the ground.
          const level = wayLevel[tile];
          const yy = (level === 0 ? groundY : HEIGHT_TO_WORLD(level)) + 0.05;
          let colour = src.wayColourOf(c);

          if (this.overlay === OverlayMode.Ownership) {
            const asset = src.wayAsset[mode][tile];
            const owner = asset < 0 ? 0 : src.assetOwner[asset];
            colour = owner === src.player ? SEMANTIC.owned : owner === 0 ? SEMANTIC.public : SEMANTIC.rival;
          } else if (this.overlay === OverlayMode.Power || this.overlay === OverlayMode.Water) {
            // Only the network that carries the utility is lit; everything
            // else recedes, so the grid reads as a grid.
            const wanted = this.overlay === OverlayMode.Power ? 5 : 4;
            if (mode !== wanted) {
              colour = [0.16, 0.17, 0.19];
            } else if (src.gridOfTile && src.gridSatisfaction) {
              const gi = src.gridOfTile[tile];
              const sat = gi >= 0 ? src.gridSatisfaction[gi] : 0;
              colour = sat >= 99 ? SEMANTIC.free
                : sat >= 70 ? SEMANTIC.busy
                : sat >= 30 ? SEMANTIC.congested
                : SEMANTIC.jammed;
            }
          } else if (this.overlay === OverlayMode.Congestion) {
            const link = src.wayLink[mode][tile];
            if (link >= 0) {
              const cap = Math.max(1, src.linkCellCount[link] * 4);
              const load = Math.min(1, src.linkFlowPrev[link] / cap);
              colour = load < 0.25 ? SEMANTIC.free
                : load < 0.55 ? SEMANTIC.busy
                : load < 0.8 ? SEMANTIC.congested
                : SEMANTIC.jammed;
            } else colour = [0.22, 0.23, 0.25];
          } else {
            // Condition darkens a way, so decay is visible in the world and
            // not only in a panel (§6).
            const asset = src.wayAsset[mode][tile];
            if (asset >= 0) {
              const k = 0.55 + (src.assetCondition[asset] / 255) * 0.45;
              colour = [colour[0] * k, colour[1] * k, colour[2] * k];
            }
          }
          // A hub and an arm to each connected edge, all flat. The hub is
          // what makes a junction read as a junction from above, which is the
          // thing the player is actually reading the map for.
          const half = 0.20;
          const flags = wayFlags[tile];
          const tunnel = (flags & 8) !== 0;
          const bridge = (flags & 4) !== 0;

          if (!tunnel) {
            const d = dir[tile];
            if (mode === 1) {
              // Rail: a ballast bed with sleepers across it. Two marks rather
              // than one, because a railway drawn as a coloured band is a road
              // in a different colour, and at playing zoom the sleeper rhythm
              // is what actually says "railway" from above.
              const ballast: RGB = [colour[0] * 1.25, colour[1] * 1.2, colour[2] * 1.1];
              const railHead: RGB = [colour[0] * 0.55, colour[1] * 0.56, colour[2] * 0.6];
              m.flat(x + 0.5, yy, y + 0.5, 0.17, 0.17, ballast);
              for (let k = 0; k < 4; k++) {
                if ((d & (1 << k)) === 0) continue;
                const alongX = DIRDX[k] !== 0;
                m.flat(
                  x + 0.5 + DIRDX[k] * 0.25, yy, y + 0.5 + DIRDY[k] * 0.25,
                  alongX ? 0.25 : 0.17, alongX ? 0.17 : 0.25,
                  ballast,
                );
                // Two rails, set in from the ballast edge.
                for (const off of [-0.075, 0.075]) {
                  m.flat(
                    x + 0.5 + DIRDX[k] * 0.25 + (alongX ? 0 : off),
                    yy + 0.006,
                    y + 0.5 + DIRDY[k] * 0.25 + (alongX ? off : 0),
                    alongX ? 0.25 : 0.018, alongX ? 0.018 : 0.25,
                    railHead,
                  );
                }
              }
            } else {
              m.flat(x + 0.5, yy, y + 0.5, half, half, colour);
              for (let k = 0; k < 4; k++) {
                if ((d & (1 << k)) === 0) continue;
                m.flat(
                  x + 0.5 + DIRDX[k] * 0.25, yy, y + 0.5 + DIRDY[k] * 0.25,
                  DIRDX[k] !== 0 ? 0.25 : half, DIRDY[k] !== 0 ? 0.25 : half,
                  colour,
                );
              }
            }
          }

          // Earthworks and structure. art-direction.md §11: an embankment, a
          // cutting, a tunnel mouth and a viaduct are the most characterful
          // things in a transport game and should read clearly from above.
          const drop = yy - groundY;
          if (bridge && drop > 0.02) {
            // Piers rather than a solid wall, so a viaduct reads as a viaduct.
            const pierColour: RGB = [colour[0] * 0.55, colour[1] * 0.55, colour[2] * 0.55];
            m.box(x + 0.5, yy - drop / 2, y + 0.5, 0.075, drop / 2, 0.075, 0.02, pierColour);
            m.box(x + 0.5, yy - 0.012, y + 0.5, half + 0.03, 0.022, half + 0.03, 0.015,
              pierColour, [colour[0] * 0.8, colour[1] * 0.8, colour[2] * 0.8]);
          } else if ((flags & 1) !== 0 && drop > 0.01) {
            // Embankment: a batter on each side, tapering to the ground.
            const soil: RGB = [0.30, 0.27, 0.21];
            const soilTop: RGB = [0.38, 0.35, 0.28];
            m.box(x + 0.5, yy - drop / 2, y + 0.5, half + drop * 0.55, drop / 2, half + drop * 0.55,
              0.02, soil, soilTop);
          } else if ((flags & 2) !== 0 && drop < -0.01) {
            // Cutting: the spoil faces stand above the formation.
            const rockFace: RGB = [0.34, 0.32, 0.29];
            const lip = -drop;
            m.box(x + 0.5, yy + lip / 2, y + 0.5, half + lip * 0.5, lip / 2, half + lip * 0.5,
              0.02, rockFace, [0.40, 0.38, 0.34]);
            m.flat(x + 0.5, yy + 0.002, y + 0.5, half, half, colour);
          } else if (tunnel) {
            // Only the mouth is visible: a dark portal where the way enters.
            const portal: RGB = [0.10, 0.10, 0.11];
            const d = dir[tile];
            for (let k = 0; k < 4; k++) {
              if ((d & (1 << k)) === 0) continue;
              const nx = x + DIRDX[k];
              const ny = y + DIRDY[k];
              if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
              if ((wayFlags[ny * size + nx] & 8) !== 0) continue;
              m.box(x + 0.5 + DIRDX[k] * 0.35, yy + 0.10, y + 0.5 + DIRDY[k] * 0.35,
                DIRDX[k] !== 0 ? 0.08 : 0.24, 0.11, DIRDY[k] !== 0 ? 0.08 : 0.24, 0.02,
                portal, [0.22, 0.22, 0.23]);
            }
          }
        }
      }
    }
    if (m.isEmpty()) return null;
    const mesh = new ThreeMesh(m.build(), this.material);
    mesh.frustumCulled = true;
    return mesh;
  }

  /** Vegetation massing and other scatter, per chunk. */
  private buildPropChunk(src: RenderSource, cx: number, cy: number): ThreeMesh | null {
    const size = src.size;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const x1 = Math.min(size, x0 + CHUNK);
    const y1 = Math.min(size, y0 + CHUNK);
    if (this.overlay !== OverlayMode.None) return null;
    const m = new Mesh(CHUNK * CHUNK * 8);
    // One clump per four tiles of woodland, positioned by a hash so it is
    // stable across rebuilds.
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const tile = y * size + x;
        if (src.biome[tile] !== 6) continue;
        const h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x85ebca6b)) >>> 0;
        if ((h & 3) !== 0) continue;
        m.append(
          buildTreeClump(h),
          x + 0.5 + ((h >> 8) & 15) / 16,
          HEIGHT_TO_WORLD(src.height[tile]),
          y + 0.5 + ((h >> 12) & 15) / 16,
        );
      }
    }
    if (m.isEmpty()) return null;
    const mesh = new ThreeMesh(m.build(), this.material);
    mesh.frustumCulled = true;
    return mesh;
  }

  // --------------------------------------------------------------- update

  /**
   * Stream chunks around the camera.
   *
   * Chunked meshing and streaming are required from early on rather than
   * later (D6's stated cost), because a thousand-tile region is a hundred
   * thousand quads and no amount of frustum culling saves you from having
   * built them all.
   */
  private streamChunks(src: RenderSource): void {
    const t0 = performance.now();
    this.cols = Math.ceil(src.size / CHUNK);
    const c = this.camState;
    // Enough margin that a rotation does not reveal a hole. The along-axis
    // extent is the one that catches people out: at 35 degrees the view is
    // 1/sin(35) ≈ 1.75 times deeper than it is tall.
    const reachY = c.view * 0.5 / Math.sin((c.elevation * Math.PI) / 180) + CHUNK;
    const reachX = c.view * 0.5 * (this.camera.right / this.camera.top) + CHUNK;
    const reach = Math.max(reachX, reachY);
    const minCx = Math.max(0, Math.floor((c.x - reach) / CHUNK));
    const maxCx = Math.min(this.cols - 1, Math.floor((c.x + reach) / CHUNK));
    const minCy = Math.max(0, Math.floor((c.z - reach) / CHUNK));
    const maxCy = Math.min(this.cols - 1, Math.floor((c.z + reach) / CHUNK));

    // A frame stamp rather than a Set of wanted keys. Allocating a Set and a
    // hundred and fifty entries every frame is a few thousand short-lived
    // objects a second, which is enough to schedule a collection roughly every
    // twenty frames and put a sixty-millisecond stall in a seven-millisecond
    // frame. None of the individual allocations look like a problem.
    const frame = ++this.frameCounter;
    let wantedCount = 0;
    let built = 0;
    // A time budget rather than a chunk count. The first frame has to deliver
    // the whole visible region — a world that fades in over a second reads as
    // broken — while later frames must never stall, because by then the player
    // is panning and a hitch is a hitch.
    const budgetMs = this.chunks.size === 0 ? 400 : 6;
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = cy * this.cols + cx;
        wantedCount++;
        let chunk = this.chunks.get(key);
        if (!chunk) {
          if (built > 0 && performance.now() - t0 > budgetMs) continue;
          built++;
          this.stats.chunksBuilt++;
          const terrain = this.buildTerrainChunk(src, cx, cy);
          this.scene.add(terrain);
          chunk = {
            terrain,
            ways: null,
            props: null,
            overlayVersion: this.overlayVersion,
            wayVersion: -1,
            seen: frame,
          };
          this.chunks.set(key, chunk);
        }
        chunk.seen = frame;
        if (chunk.overlayVersion !== this.overlayVersion) {
          this.scene.remove(chunk.terrain);
          chunk.terrain.geometry.dispose();
          chunk.terrain = this.buildTerrainChunk(src, cx, cy);
          this.scene.add(chunk.terrain);
          chunk.overlayVersion = this.overlayVersion;
          chunk.wayVersion = -1;
          if (chunk.props) {
            this.scene.remove(chunk.props);
            chunk.props.geometry.dispose();
            chunk.props = null;
          }
          chunk.props = this.buildPropChunk(src, cx, cy);
          if (chunk.props) this.scene.add(chunk.props);
        }
        if (chunk.wayVersion !== this.wayVersion) {
          if (chunk.ways) {
            this.scene.remove(chunk.ways);
            chunk.ways.geometry.dispose();
          }
          chunk.ways = this.buildWayChunk(src, cx, cy);
          if (chunk.ways) this.scene.add(chunk.ways);
          chunk.wayVersion = this.wayVersion;
          if (!chunk.props) {
            chunk.props = this.buildPropChunk(src, cx, cy);
            if (chunk.props) this.scene.add(chunk.props);
          }
        }
      }
    }

    // Evict what has left the view, so a long pan does not accumulate the
    // whole region in memory.
    if (this.chunks.size > wantedCount + 64) {
      for (const [key, chunk] of this.chunks) {
        if (chunk.seen === frame) continue;
        this.scene.remove(chunk.terrain);
        chunk.terrain.geometry.dispose();
        if (chunk.ways) {
          this.scene.remove(chunk.ways);
          chunk.ways.geometry.dispose();
        }
        if (chunk.props) {
          this.scene.remove(chunk.props);
          chunk.props.geometry.dispose();
        }
        this.chunks.delete(key);
      }
    }
    this.stats.chunks = this.chunks.size;
    this.stats.buildMs = performance.now() - t0;
  }

  private ensureSea(src: RenderSource): void {
    if (this.sea) return;
    const m = new Mesh();
    const s = src.size;
    // One quad. Water is the one large saturated field and it anchors the
    // composition, so it gets the strongest colour in the palette and no
    // detail whatsoever.
    // Only a backdrop now: inside the region the sea is part of the terrain
    // surface, so there are not two coincident planes to fight over the depth
    // buffer along every coastline.
    m.quad(-s * 2, -0.4, -s * 2, s * 3, -0.4, -s * 2, s * 3, -0.4, s * 3, -s * 2, -0.4, s * 3, LAND.oceanDeep);
    const mesh = new ThreeMesh(m.build(), this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    this.scene.add(mesh);
    this.sea = mesh;
  }

  private ensureSites(src: RenderSource): void {
    for (let s = 0; s < src.siteCount; s++) {
      const state = Math.min(2, src.sState[s] === 3 ? 2 : src.sState[s]);
      const key = s * 4 + state;
      if (this.siteMeshes.has(s) && this.siteMeshes.get(s)!.userData.key === key) continue;
      const old = this.siteMeshes.get(s);
      if (old) {
        this.scene.remove(old);
        old.geometry.dispose();
      }
      const kit = src.industryKitOf(src.sDef[s]);
      const foot = src.industryFootprintOf(src.sDef[s]);
      this.stats.sitesBuilt++;
      const built = buildIndustry(kit, state, s * 2654435761, foot);
      const mesh = new ThreeMesh(built.build(), this.material);
      const x = src.sX[s];
      const y = src.sY[s];
      mesh.position.set(x + 0.5, HEIGHT_TO_WORLD(Math.max(0, src.height[y * src.size + x])), y + 0.5);
      mesh.userData.key = key;
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      this.siteMeshes.set(s, mesh);
    }
  }

  private ensureTowns(src: RenderSource, night: boolean): void {
    for (let t = 0; t < src.townCount; t++) {
      // Rebuild in population bands, so a town visibly grows without
      // regenerating its geometry every time somebody moves in.
      const band = Math.floor(Math.sqrt(src.tPopulation[t]) / 4);
      const key = band * 4 + (night ? 1 : 0) + src.era * 64;
      const existing = this.townMeshes.get(t);
      if (existing && existing.userData.key === key) continue;
      if (existing) {
        this.scene.remove(existing);
        existing.geometry.dispose();
      }
      this.stats.townsBuilt++;
      const built = buildTownBlock(t * 40503 + 7, band + 3, src.era, night);
      const mesh = new ThreeMesh(built.build(), this.material);
      const x = src.tX[t];
      const y = src.tY[t];
      mesh.position.set(x + 0.5, HEIGHT_TO_WORLD(Math.max(0, src.height[y * src.size + x])), y + 0.5);
      mesh.scale.setScalar(1 + band * 0.16);
      mesh.userData.key = key;
      this.scene.add(mesh);
      this.townMeshes.set(t, mesh);
    }
  }

  // ------------------------------------------------------------- vehicles

  /**
   * How many screen pixels one tile occupies. The LOD switch is on this rather
   * than on the zoom number, because the same zoom on a phone and on a
   * thirty-inch monitor are different pictures.
   */
  private pixelsPerTile(): number {
    const h = this.renderer.domElement.height || 1000;
    return h / Math.max(1, this.camState.view);
  }

  private batchFor(src: RenderSource, type: number, capacity: number): VehicleBatch {
    // Far LOD is a separate authored silhouette, not a decimation (art §7), and
    // it takes over well before the vehicle is unrecognisable: at twenty-five
    // pixels a tile a lorry is about six pixels long, and the near model is
    // spending five hundred triangles on chamfers and headlamps to describe it.
    const far = this.pixelsPerTile() < 25;
    let batch = this.vehicleBatches.get(type);
    if (batch && batch.far === far && batch.mesh.instanceMatrix.count >= capacity) return batch;

    if (batch) {
      this.scene.remove(batch.mesh);
      batch.mesh.geometry.dispose();
      batch.mesh.dispose();
    }
    this.stats.batchesBuilt++;
    const built = buildVehicle({
      cls: src.vehicleClassOf(type),
      era: src.vehicleEraOf(type),
      livery: LIVERIES[1],
      far,
    });
    // Rounded up in powers of two, so a growing fleet reallocates a handful of
    // times over a whole game rather than every time somebody buys a lorry.
    let size = 512;
    while (size < capacity) size *= 2;
    const mesh = new InstancedMesh(built.build(), this.material, size);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.scene.add(mesh);
    batch = { mesh, count: 0, far };
    this.vehicleBatches.set(type, batch);
    return batch;
  }

  private tmpMatrix = new Matrix4();
  private tmpQuat = new Quaternion();
  private tmpPos = new Vector3();
  private tmpScale = new Vector3(1, 1, 1);
  private tmpColour = new Color();

  private updateVehicles(src: RenderSource, alpha: number): void {
    for (const b of this.vehicleBatches.values()) b.count = 0;

    // One pass to size the batches, so a fleet that has grown does not spend
    // the frame silently dropping everything past the old capacity.
    this.typeCounts.fill(0);
    for (let id = 0; id < src.vehicleCount; id++) {
      if (src.vAlive[id]) this.typeCounts[src.vType[id]]++;
    }

    if (this.prevX.length < src.vehicleCount) {
      const n = Math.max(1024, src.vehicleCount * 2);
      const px = new Int32Array(n);
      const py = new Int32Array(n);
      const ph = new Int32Array(n);
      px.set(this.prevX);
      py.set(this.prevY);
      ph.set(this.prevHeading);
      this.prevX = px;
      this.prevY = py;
      this.prevHeading = ph;
    }

    const c = this.camState;
    // Cull generously in tile space rather than by frustum: at twenty-five
    // thousand instances the matrix write is the cost, not the draw.
    const reach = c.view * 1.2 + 40;
    let drawn = 0;

    for (let id = 0; id < src.vehicleCount; id++) {
      if (!src.vAlive[id]) continue;
      const tx = src.vX[id] / 65536;
      const ty = src.vY[id] / 65536;
      if (Math.abs(tx - c.x) > reach || Math.abs(ty - c.z) > reach) {
        this.prevX[id] = src.vX[id];
        this.prevY[id] = src.vY[id];
        this.prevHeading[id] = src.vHeading[id];
        continue;
      }

      // Interpolate between the last two ticks. A dropped frame never affects
      // the world; it only shows the same tick twice.
      const px = this.havePrev ? this.prevX[id] / 65536 : tx;
      const py = this.havePrev ? this.prevY[id] / 65536 : ty;
      let x = px + (tx - px) * alpha;
      let y = py + (ty - py) * alpha;
      if (Math.abs(tx - px) > 4 || Math.abs(ty - py) > 4) {
        // Teleported — a rebuild moved it. Snap rather than sliding across
        // the map over one frame.
        x = tx;
        y = ty;
      }

      const batch = this.batchFor(src, src.vType[id], this.typeCounts[src.vType[id]]);
      if (batch.count >= batch.mesh.instanceMatrix.count) continue;

      const heading = src.vHeading[id];
      const prevH = this.havePrev ? this.prevHeading[id] : heading;
      let dh = heading - prevH;
      if (dh > 2048) dh -= 4096;
      if (dh < -2048) dh += 4096;
      const angle = ((prevH + dh * alpha) / 4096) * Math.PI * 2;

      const groundH = HEIGHT_TO_WORLD(
        Math.max(0, src.height[Math.min(src.size * src.size - 1, (Math.round(y) * src.size + Math.round(x)) | 0)] ?? 0),
      );
      this.tmpPos.set(x, groundH + 0.01, y);
      // Models point along +Z; heading 0 is north, which is -Z.
      this.tmpQuat.setFromAxisAngle(UP, -angle + Math.PI);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      batch.mesh.setMatrixAt(batch.count, this.tmpMatrix);

      const livery = LIVERIES[src.vCompany[id] % LIVERIES.length];
      if (this.overlay === OverlayMode.Ownership) {
        const owner = src.vCompany[id];
        const s = owner === src.player ? SEMANTIC.owned : owner === 0 ? SEMANTIC.public : SEMANTIC.rival;
        this.tmpColour.setRGB(s[0] * 2.2, s[1] * 2.2, s[2] * 2.2);
      } else if (id === this.selectedVehicle) {
        this.tmpColour.setRGB(2.4, 2.3, 2.0);
      } else {
        // The instance colour multiplies the model's own, so a livery tints
        // the painted panels and leaves iron and glass alone.
        this.tmpColour.setRGB(
          (livery.colour[0] / 0.4) * 0.85 + 0.3,
          (livery.colour[1] / 0.4) * 0.85 + 0.3,
          (livery.colour[2] / 0.4) * 0.85 + 0.3,
        );
      }
      batch.mesh.setColorAt(batch.count, this.tmpColour);
      batch.count++;
      drawn++;

      this.prevX[id] = src.vX[id];
      this.prevY[id] = src.vY[id];
      this.prevHeading[id] = src.vHeading[id];
    }

    for (const b of this.vehicleBatches.values()) {
      b.mesh.count = b.count;
      // Upload only the range actually written. The buffer is sized for the
      // whole fleet — thirty-two thousand instances is two megabytes of
      // matrices — and re-uploading all of it every frame to move six thousand
      // vehicles is what put a three-hundred-millisecond stall in the frame
      // time distribution while the median sat at seven.
      const matrix = b.mesh.instanceMatrix;
      matrix.clearUpdateRanges();
      if (b.count > 0) matrix.addUpdateRange(0, b.count * 16);
      matrix.needsUpdate = true;
      const colour = b.mesh.instanceColor;
      if (colour) {
        colour.clearUpdateRanges();
        if (b.count > 0) colour.addUpdateRange(0, b.count * 3);
        colour.needsUpdate = true;
      }
    }
    this.stats.instances = drawn;
    this.havePrev = true;
  }

  /** Call once per simulation tick, before the next frame's interpolation. */
  markTick(): void {
    // Positions were copied into prev during the last update, which is what
    // makes alpha meaningful. Nothing else to do; the hook exists so the host
    // does not have to know that.
  }

  // ---------------------------------------------------------------- frame

  render(src: RenderSource, alpha: number): void {
    this.stats.chunksBuilt = 0;
    this.stats.sitesBuilt = 0;
    this.stats.townsBuilt = 0;
    this.stats.batchesBuilt = 0;
    this.ensureSea(src);
    this.streamChunks(src);
    const tSites = performance.now();
    this.ensureSites(src);
    this.stats.sitesMs = performance.now() - tSites;
    const light = lightingForTime(src.dayFraction, src.season, this.light);
    const tTowns = performance.now();
    this.ensureTowns(src, light.night > 0.35);
    this.stats.townsMs = performance.now() - tTowns;
    // The camera stands CAMERA_DISTANCE back from its target, so that is the
    // depth the aerial perspective is measured from.
    applyLighting(this.material, light, CAMERA_DISTANCE);
    (this.scene.background as Color).setRGB(
      light.fogColour.r * 0.8,
      light.fogColour.g * 0.8,
      light.fogColour.b * 0.85,
    );
    const tVeh = performance.now();
    this.updateVehicles(src, alpha);
    this.stats.vehiclesMs = performance.now() - tVeh;
    this.updateCamera(this.camera.right / this.camera.top);
    const tDraw = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.stats.drawMs = performance.now() - tDraw;
    const info = this.renderer.info.render;
    this.stats.drawCalls = info.calls;
    this.stats.triangles = info.triangles;
  }

  // --------------------------------------------------------------- picking

  /** Tile under a screen point, by intersecting the ground plane. Height is
   *  resolved by stepping down the ray, which is cheap and exact enough. */
  pickTile(src: RenderSource, ndcX: number, ndcY: number): number {
    const origin = new Vector3(ndcX, ndcY, -1).unproject(this.camera);
    const dir = new Vector3(0, 0, -1).transformDirection(this.camera.matrixWorld).normalize();
    let t = 0;
    let last = -1;
    for (let i = 0; i < 4000; i++) {
      const p = origin.clone().addScaledVector(dir, t);
      const x = Math.floor(p.x);
      const y = Math.floor(p.z);
      if (x >= 0 && y >= 0 && x < src.size && y < src.size) {
        const h = HEIGHT_TO_WORLD(Math.max(0, src.height[y * src.size + x]));
        if (p.y <= h + 0.05) return y * src.size + x;
        last = y * src.size + x;
      }
      t += 0.5;
      if (t > 4000) break;
    }
    return last;
  }

  /** Nearest vehicle to a screen point, within a pixel radius. Cheaper and
   *  far more forgiving than raycasting twenty-five thousand instances. */
  pickVehicle(src: RenderSource, ndcX: number, ndcY: number, radiusNdc = 0.03): number {
    let best = -1;
    let bestD = radiusNdc * radiusNdc;
    const v = new Vector3();
    for (let id = 0; id < src.vehicleCount; id++) {
      if (!src.vAlive[id]) continue;
      const x = src.vX[id] / 65536;
      const y = src.vY[id] / 65536;
      if (Math.abs(x - this.camState.x) > this.camState.view || Math.abs(y - this.camState.z) > this.camState.view * 1.6) continue;
      v.set(x, HEIGHT_TO_WORLD(Math.max(0, src.height[Math.round(y) * src.size + Math.round(x)] ?? 0)) + 0.1, y);
      v.project(this.camera);
      const dx = v.x - ndcX;
      const dy = v.y - ndcY;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Screen position of a world tile, for DOM overlay labels. */
  project(src: RenderSource, tileX: number, tileY: number): { x: number; y: number } {
    const h = HEIGHT_TO_WORLD(Math.max(0, src.height[tileY * src.size + tileX] ?? 0));
    const v = new Vector3(tileX + 0.5, h, tileY + 0.5).project(this.camera);
    return { x: (v.x * 0.5 + 0.5), y: (-v.y * 0.5 + 0.5) };
  }
}

const UP = new Vector3(0, 1, 0);

/** A shared run of zeroes for geometry with no emissive surfaces. */
let ZERO_EMIT = new Float32Array(0);
function zeroEmit(n: number): Float32Array {
  if (ZERO_EMIT.length < n) ZERO_EMIT = new Float32Array(n);
  return ZERO_EMIT.subarray(0, n);
}

/**
 * How far back the camera stands from its target.
 *
 * Under an orthographic projection this changes nothing about the picture — it
 * only has to be far enough that the near plane clears the tallest thing in
 * the region. It matters because the fog is measured relative to it.
 */
const CAMERA_DISTANCE = 1200;

export { shade, WAY_COLOURS };
