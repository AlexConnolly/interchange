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
  AdditiveBlending, BackSide, Color, DirectionalLight, DoubleSide, Group,
  InstancedMesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, OrthographicCamera,
  HemisphereLight, PCFSoftShadowMap, Scene as ThreeScene, Vector3, WebGLRenderer,
} from 'three';
import { buildGround, toMesh, HEIGHT_TO_WORLD, type GroundSource } from './ground.ts';
import { Mesh } from './geometry.ts';
import { buildRoads, buildCatsEyes, type RoadSource } from './roads.ts';
import type { Model } from './glb.ts';
import { LIVERY, NIGHT, SKY, SNOW, type RGB } from './palette.ts';

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
  /** Vehicles: position in tiles, heading in turns, whose it is, and which
   *  model to draw — a tanker has to look like a tanker, or the yard rule that
   *  says where it can live is invisible. */
  vehicleCount: number;
  vx: Float32Array;
  vz: Float32Array;
  vHeading: Float32Array;
  vLivery: Uint8Array;
  vModel: Uint8Array;
  /**
   * Buildings. One per business, plus the village housing.
   *
   * Fed as a flat list rather than read off the world, because *which* of them
   * are visible is an influence question and influence changes: a business
   * beyond your reach is not drawn at all, and the moment your influence
   * reaches it, its buildings appear. That fade-in is the fog of war, and it is
   * the single most persuasive thing the influence area does.
   */
  placeCount: number;
  px: Float32Array;
  pz: Float32Array;
  pModel: Uint8Array;
  /** Heading in turns, so a farmyard is not axis-aligned with its neighbour. */
  pRot: Float32Array;
  /** 0..1 through the day, for the sun. */
  dayFraction: number;
  /** 0..1 depth of snow. One number, and the same one the traffic obeys. */
  snow: number;
}

interface Chunk {
  ground: ReturnType<typeof toMesh>;
  roads: ReturnType<typeof toMesh> | null;
  /** Cat's eyes. Their own mesh because they are drawn unlit — see `glow`. */
  studs: ReturnType<typeof toMesh> | null;
  seen: number;
}

export class Renderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new ThreeScene();
  private readonly camera: OrthographicCamera;
  private readonly material: MeshLambertMaterial;
  private readonly roadMaterial: MeshLambertMaterial;
  /** Everything that emits: cat's eyes and lamps. Unlit, additive, and its
   *  opacity is how far into the night we are. */
  private readonly glow: MeshBasicMaterial;
  private readonly sun: DirectionalLight;
  private readonly fill: HemisphereLight;
  private readonly chunks = new Map<number, Chunk>();
  private readonly fleet = new Group();
  /** Batches indexed [model][livery], for bodies and for lamps. */
  private lamps: (InstancedMesh | null)[][] = [];
  private readonly places = new Group();
  private placeBatches: InstancedMesh[] = [];
  /** A route being considered, drawn over the road. */
  private routeMesh: ReturnType<typeof toMesh> | null = null;
  private routeKey = '';
  private batches: (InstancedMesh | null)[][] = [];
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
    this.material = litMaterial({});
    /*
     * Roads get their own material so they can go the other way in the snow.
     *
     * A cleared road is darker and wetter than a dry one, and the whole frame's
     * contrast inverts for three months of every year: dark roads on a bright
     * ground, where the rest of the year is pale roads on green. Mixing them
     * toward white with everything else would erase the network exactly when it
     * is at its most legible.
     *
     * 0.72 rather than 1 because a road is not perfectly swept, and the verges
     * either side take full snow from `this.material` — so the ribbon reads as
     * ploughed with white banks.
     */
    this.roadMaterial = litMaterial({ takes: 0.72, to: SNOW.wet });

    /*
     * The glow pass, and it is one material shared by every emitter in the
     * scene — cat's eyes, headlamps, tail lamps — because they all want exactly
     * the same thing and all want it at exactly the same time.
     *
     * Unlit, so a lamp is not dimmed by the light it is supposed to be making.
     * Additive, so it *brightens* what is behind it rather than painting over
     * it: that is the difference between a headlamp and a white sticker.
     * `depthWrite` off, so a stud lying on a road neither z-fights with it nor
     * hides the lorry driving over it.
     *
     * And one opacity, set once a frame from how far into the night it is. That
     * single number is the entire day/night behaviour of every light in the
     * game, which is why the emitters had to be separated from the lit
     * geometry rather than given an emissive term inside it.
     */
    this.glow = new MeshBasicMaterial({
      vertexColors: true,
      side: DoubleSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    });

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
    this.scene.add(this.places);
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
    /*
     * The sun goes all the way round, and now it sets.
     *
     * Two bugs are avoided here and they are opposites. The first version swept
     * the azimuth from 0.7 to 2.3 radians and then wrapped back — a
     * ninety-two-degree jump between one frame and the next, which is what "the
     * shadows jump from one side to the other very quickly at the end of the
     * day" was. The fix was to make every term a function of `t` that returns
     * to its own start: a full-turn azimuth and a sine height. Nothing snaps,
     * at any day length.
     *
     * The second was the fix going too far. Having got a continuous cycle I
     * removed night altogether, on the reasoning that a bright casual game
     * cannot afford a screen you cannot read. That threw away the best-looking
     * thing the renderer can do. Cat's eyes and headlamps only exist after
     * dark, and nothing in a daylit frame can be brighter than the sky, so
     * nothing in a daylit frame can glow.
     *
     * So night is back, and the readability worry is answered by what night
     * *is* rather than by not having one: the light never goes below the
     * horizon, it turns cool and dim instead, and the fill never reaches zero.
     * A moonlit blue district you can play in, with the road picked out in
     * studs. Not a blackout.
     */
    const t = dayFraction;
    const azimuth = t * Math.PI * 2;
    /*
     * Sun height, and it is deliberately not centred on zero.
     *
     * `0.24 + 0.76 sin` spends about sixty per cent of the cycle above the
     * horizon and gives roughly a quarter of it to full night — a long golden
     * hour at each end, a short night. Centring it would make night and day
     * equal, and on a forty-eight-second day that is twenty-four seconds of
     * dark, which is long enough to be an interruption rather than an evening.
     */
    const h = 0.24 + 0.76 * Math.sin(azimuth);
    /*
     * The light stays above the horizon.
     *
     * `max` of two continuous functions is continuous, so this cannot
     * reintroduce the jump. What it means visually is that as the sun sets the
     * light does not vanish — it flattens out, rakes along the ground and turns
     * to moonlight, still casting a shadow. Killing the light at night instead
     * would flatten every object in the district at the exact moment the
     * shadows are longest.
     */
    const lit = Math.max(h, 0.11);
    this.night = smoothstep(0.06, -0.34, h);
    const day = 1 - this.night;

    const d = 70;
    this.sun.target.position.set(this.camX, this.camY, this.camZ);
    this.sun.position.set(
      this.camX + Math.cos(azimuth) * d * (1 - lit * 0.5),
      this.camY + lit * d,
      this.camZ + Math.sin(azimuth) * d * (1 - lit * 0.5),
    );
    const c = this.sun.shadow.camera;
    const reach = this.tilesAcross * 0.9;
    c.left = -reach;
    c.right = reach;
    c.top = reach;
    c.bottom = -reach;
    c.updateProjectionMatrix();

    // Warm when low, cooler at noon, then cool and blue once it is the moon.
    // Every term is continuous in `lit` and `night`, so none of them can
    // introduce a jump of its own.
    const warm = 1 - lit * 0.4;
    for (let k = 0; k < 3; k++) {
      const sunlit = [
        SKY.sun[0],
        SKY.sun[1] * (0.94 + warm * 0.06),
        SKY.sun[2] * (0.82 + warm * 0.18),
      ][k];
      this.sunRGB[k] = sunlit * day + NIGHT.moon[k] * this.night;
    }
    this.sun.color.setRGB(this.sunRGB[0], this.sunRGB[1], this.sunRGB[2]);

    // The sun does the describing and the fill only stops the shadows going
    // black. Getting that ratio the wrong way round is what washed the first
    // build out. At night the ratio narrows — moonlight is nearly all bounce —
    // but it does not invert.
    /*
     * Night at about half the brightness of day, and half is a measured
     * number rather than a taste.
     *
     * The first attempt put night at a fifth — 0.55 against a sun of 2.7 — and
     * the district went practically black: the fields were unreadable, the
     * hedges were silhouettes and the only thing you could see was the cat's
     * eyes. Which sounds atmospheric and is unplayable, and breaks the rule
     * this palette exists to serve: the game stays readable at every hour.
     *
     * There is no tone mapping in this renderer, on purpose, so light is
     * linear and a fifth of the light really is a fifth as bright on screen.
     * Half reads as a bright moonlit evening — you can see the crop in a field
     * and tell a hedge from its own shadow, and the lamps still dominate
     * because nothing else is near white.
     */
    this.sun.intensity = (2.5 + lit * 0.5) * day + 1.15 * this.night;
    this.fill.intensity = (0.62 + (1 - lit) * 0.22) * day + 0.78 * this.night;
    lerpColour(this.fill.color, SKY.zenith, NIGHT.zenith, this.night);
    lerpColour(this.fill.groundColor, SKY.ground, NIGHT.ground, this.night);
    lerpColour(this.clear, SKY.horizon, NIGHT.horizon, this.night);
    this.renderer.setClearColor(this.clear);

    // And the one number that lights every lamp and every stud in the game.
    this.glow.opacity = this.night;
  }

  /**
   * The season, in one write.
   *
   * Also cools and lifts the fill, because snow is an enormous reflector: the
   * shaded side of everything is brighter in winter and bluer, and getting that
   * wrong is what makes a white landscape look like a white filter.
   */
  private setSeason(snow: number): void {
    SNOW_UNIFORM.value = snow;
    this.fill.intensity *= 1 + snow * 0.35;
  }

  /** How far into the night, 0..1. Read by the glow pass. */
  private night = 0;
  private readonly clear = new Color();
  private readonly sunRGB: [number, number, number] = [0, 0, 0];

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
          roads = toMesh(roadMesh, this.roadMaterial);
          // A road receives shadow and does not cast one. A flat surface
          // casting onto itself is shadow acne and nothing else.
          roads.castShadow = false;
          this.scene.add(roads);
        }
        // Cat's eyes, built with the roads and thrown away with them, so they
        // stream in and out on exactly the same schedule.
        const studMesh = buildCatsEyes(src, x0, z0, x1, z1);
        let studs: Chunk['studs'] = null;
        if (!studMesh.isEmpty()) {
          studs = toMesh(studMesh, this.glow);
          studs.castShadow = false;
          studs.receiveShadow = false;
          this.scene.add(studs);
        }
        this.chunks.set(key, { ground, roads, studs, seen: frame });
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
      if (chunk.studs) {
        this.scene.remove(chunk.studs);
        chunk.studs.geometry.dispose();
      }
      this.chunks.delete(key);
    }
  }

  /**
   * Hand the renderer the fleet, once it has loaded.
   *
   * A batch per model per livery, which sounds like a lot of draw calls and is
   * nine times four — except that a batch with nothing in it is switched off,
   * and no district has all nine body types on the road at once. In practice it
   * settles at three or four.
   *
   * A model *per vehicle type* rather than one lorry recoloured, because the
   * body type is a game rule you can see: a yard with no tank bay cannot keep
   * the tanker, and the player has to be able to tell which of the lorries on
   * the road is the tanker. One shared silhouette would make that rule
   * invisible and it is the best rule in the design.
   *
   * Lamps are a second batch on the same matrices — see `glow`.
   */
  setFleet(models: Model[], capacity = 96): void {
    for (const row of [...this.batches, ...this.lamps]) {
      for (const b of row) {
        if (b) {
          this.fleet.remove(b);
          b.dispose();
        }
      }
    }
    this.batches = models.map((model) => LIVERY.map((liv) => {
      const mesh = new InstancedMesh(model.body, liveryMaterial(liv.body), capacity);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.fleet.add(mesh);
      return mesh;
    }));
    this.lamps = models.map((model) => LIVERY.map(() => {
      if (!model.lamps) return null;
      const mesh = new InstancedMesh(model.lamps, this.glow, capacity);
      // A lamp does not cast a shadow. It is the thing making them.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.fleet.add(mesh);
      return mesh;
    }));
  }

  /** True once there is something to draw, so the caller can report a fleet
   *  that failed to load rather than wonder where the lorries went. */
  get hasFleet(): boolean {
    return this.batches.length > 0;
  }

  /**
   * Hand the renderer the buildings.
   *
   * Instanced like the fleet and for the same reason, even though a district
   * has one creamery: a village has nine cottages, and three of the twenty
   * models account for most of what is on screen. Instancing costs nothing
   * extra for the singletons.
   *
   * Buildings cast shadows and receive them. That is not a detail — a shed with
   * no shadow is a decal, and the whole reason the target frame has weight is
   * that everything standing up in it puts something dark on the ground beside
   * it.
   */
  setPlaceModels(models: Model[], capacity = 64): void {
    for (const b of this.placeBatches) {
      this.places.remove(b);
      b.dispose();
    }
    // No livery on a building. A creamery is not a company colour, and the
    // `livery` attribute the pipeline writes is left at whatever the model
    // says, which for these is nothing.
    this.placeBatches = models.map((model) => {
      // Full snow: a roof under snow is most of what says it is winter.
      const mesh = new InstancedMesh(model.body, litMaterial({}), capacity);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.places.add(mesh);
      return mesh;
    });
  }

  private updatePlaces(src: RenderSource): void {
    if (this.placeBatches.length === 0) return;
    // Rebuilt only when the list changes, which it does when influence grows or
    // a chunk streams in — not sixty times a second for a static village.
    const key = `${src.placeCount}:${this.placeRevision}`;
    if (key === this.placeKey) return;
    this.placeKey = key;

    const counts = new Int32Array(this.placeBatches.length);
    for (let i = 0; i < src.placeCount; i++) {
      const mi = src.pModel[i] % this.placeBatches.length;
      const batch = this.placeBatches[mi];
      if (counts[mi] >= batch.instanceMatrix.count) continue;
      const x = src.px[i];
      const z = src.pz[i];
      const tile = Math.min(src.size * src.size - 1,
        (Math.round(z) * src.size + Math.round(x)) | 0);
      const lv = src.level[tile];
      /*
       * Sit on the *highest* corner of the tile, not on its centre height.
       *
       * The ground mesh puts each vertex at the mean of the four tiles meeting
       * at that corner, so on any slope the visible surface is nowhere near the
       * tile's own height value — and a building placed at the tile height sank
       * into the hillside on the uphill side. Which is what it did: a farm half
       * underground.
       *
       * The highest corner rather than the mean of them, because the failure is
       * asymmetric. A building a few centimetres proud of the ground is
       * invisible at this camera; a building a few centimetres into it has its
       * doorway buried.
       */
      const y = lv !== 0 ? HEIGHT_TO_WORLD(lv) : this.groundTop(src, x, z);
      this.tmp.position.set(x, y, z);
      this.tmp.rotation.set(0, src.pRot[i] * Math.PI * 2, 0);
      this.tmp.updateMatrix();
      batch.setMatrixAt(counts[mi]++, this.tmp.matrix);
    }
    for (let mi = 0; mi < this.placeBatches.length; mi++) {
      const batch = this.placeBatches[mi];
      batch.count = counts[mi];
      batch.visible = counts[mi] > 0;
      batch.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * The highest of the four corner heights of the tile under a point, computed
   * the same way `ground.ts` computes them so the two cannot disagree.
   */
  private groundTop(src: RenderSource, x: number, z: number): number {
    const s = src.size;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    let top = -Infinity;
    for (let cz = tz; cz <= tz + 1; cz++) {
      for (let cx = tx; cx <= tx + 1; cx++) {
        let sum = 0;
        for (let dz = -1; dz <= 0; dz++) {
          for (let dx = -1; dx <= 0; dx++) {
            const qx = Math.max(0, Math.min(s - 1, cx + dx));
            const qz = Math.max(0, Math.min(s - 1, cz + dz));
            sum += src.height[qz * s + qx];
          }
        }
        const h = HEIGHT_TO_WORLD(sum / 4);
        if (h > top) top = h;
      }
    }
    return top === -Infinity ? 0 : top;
  }

  /** Bump to force the buildings to be laid out again — the caller does this
   *  when influence has grown and more of the district is visible. */
  placeRevision = 0;
  private placeKey = '';

  private readonly tmp = new Object3D();

  private updateFleet(src: RenderSource): void {
    if (this.batches.length === 0) return;
    const models = this.batches.length;
    const liveries = LIVERY.length;
    // One counter per batch, flattened. Reused between frames because
    // allocating a nine-by-four array sixty times a second is a garbage
    // generator for nothing.
    if (this.counts.length !== models * liveries) {
      this.counts = new Int32Array(models * liveries);
    }
    this.counts.fill(0);

    for (let i = 0; i < src.vehicleCount; i++) {
      const mi = src.vModel[i] % models;
      const li = src.vLivery[i] % liveries;
      const batch = this.batches[mi][li];
      if (!batch) continue;
      const slot = mi * liveries + li;
      if (this.counts[slot] >= batch.instanceMatrix.count) continue;
      const x = src.vx[i];
      const z = src.vz[i];
      const tile = Math.min(src.size * src.size - 1,
        (Math.round(z) * src.size + Math.round(x)) | 0);
      const lv = src.level[tile];
      const y = (lv !== 0 ? HEIGHT_TO_WORLD(lv) : HEIGHT_TO_WORLD(src.height[tile])) + 0.04;
      this.tmp.position.set(x, y, z);
      this.tmp.rotation.set(0, -src.vHeading[i] * Math.PI * 2 + Math.PI, 0);
      this.tmp.updateMatrix();
      // The same matrix into both batches: a lamp is not a separate object, it
      // is the same lorry drawn by a material that ignores the light.
      const n = this.counts[slot]++;
      batch.setMatrixAt(n, this.tmp.matrix);
      this.lamps[mi][li]?.setMatrixAt(n, this.tmp.matrix);
    }

    for (let mi = 0; mi < models; mi++) {
      for (let li = 0; li < liveries; li++) {
        const n = this.counts[mi * liveries + li];
        const batch = this.batches[mi][li];
        if (batch) {
          batch.count = n;
          batch.visible = n > 0;
          batch.instanceMatrix.needsUpdate = true;
        }
        const lamp = this.lamps[mi][li];
        if (lamp) {
          // Nothing to draw in daylight, and switching the batch off outright
          // is cheaper than drawing several hundred transparent quads at zero
          // opacity.
          lamp.count = n;
          lamp.visible = n > 0 && this.night > 0.01;
          lamp.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  private counts = new Int32Array(0);

  render(src: RenderSource): void {
    this.followGround(src);
    this.streamChunks(src);
    this.updatePlaces(src);
    this.updateFleet(src);
    this.placeSun(src.dayFraction);
    this.setSeason(src.snow);
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Draw a run over the road, so the player can see it before agreeing to it.
   *
   * Two segments, two colours, because a haulage job is two different journeys
   * and the difference between them is the whole cost of using the wrong lorry:
   * the **empty run** out from the yard to the pickup earns nothing, and the
   * **loaded run** from pickup to drop is the part that pays. Drawn as one line
   * they look like one journey, which hides exactly the thing the player is
   * choosing between when two yards both have a spare tanker.
   *
   * "26 tiles" cannot say that. A line through the village can.
   */
  showRoute(segments: { tiles: number[]; colour: RGB }[], src: RenderSource): void {
    const key = segments.map((s2) => `${s2.tiles.length}:${s2.tiles[0] ?? -1}`).join('|');
    if (key === this.routeKey) return;
    this.routeKey = key;
    if (this.routeMesh) {
      this.scene.remove(this.routeMesh);
      this.routeMesh.geometry.dispose();
      this.routeMesh = null;
    }
    let total = 0;
    for (const seg of segments) total += seg.tiles.length;
    if (total === 0) return;

    const m = new Mesh(total * 6);
    const s = src.size;
    for (const seg of segments) {
      for (const t of seg.tiles) {
        const x = t % s;
        const z = (t / s) | 0;
        const lv = src.level[t];
        const y = (lv !== 0 ? HEIGHT_TO_WORLD(lv) : HEIGHT_TO_WORLD(src.height[t])) + 0.045;
        const h = 0.19;
        m.quad(
          x + 0.5 - h, y, z + 0.5 - h, x + 0.5 + h, y, z + 0.5 - h,
          x + 0.5 + h, y, z + 0.5 + h, x + 0.5 - h, y, z + 0.5 + h, seg.colour,
        );
      }
    }
    this.routeMesh = toMesh(m, this.material);
    this.routeMesh.castShadow = false;
    this.routeMesh.receiveShadow = false;
    this.scene.add(this.routeMesh);
  }

  /**
   * Where a place on the ground lands on the screen.
   *
   * Contract pins are DOM, not geometry, and deliberately: a pin is UI — it
   * wants crisp text, a pointer cursor and a click handler, and all three are
   * free in HTML and a project in WebGL. The renderer's only job is to say where
   * to put it.
   *
   * Returns null when the point is behind the camera or off the frame, so the
   * caller can simply not render that pin rather than clamping it to an edge —
   * a pin pinned to the edge of the screen points at nothing.
   */
  project(x: number, groundHeight: number, z: number): { x: number; y: number } | null {
    this.tmpVec.set(x, HEIGHT_TO_WORLD(Math.max(0, groundHeight)), z);
    this.tmpVec.project(this.camera);
    if (this.tmpVec.z < -1 || this.tmpVec.z > 1) return null;
    if (this.tmpVec.x < -1.1 || this.tmpVec.x > 1.1) return null;
    if (this.tmpVec.y < -1.1 || this.tmpVec.y > 1.1) return null;
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return {
      x: (this.tmpVec.x * 0.5 + 0.5) * w,
      y: (-this.tmpVec.y * 0.5 + 0.5) * h,
    };
  }

  private readonly tmpVec = new Vector3();

  /** Which tile the pointer is over, by intersecting the ground plane. */
  pick(screenX: number, screenY: number, src: RenderSource): number {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const ndcX = (screenX / w) * 2 - 1;
    const ndcY = -((screenY / h) * 2 - 1);
    // Unproject onto the plane the camera is aimed at. Orthographic, so no ray
    // divergence to worry about — one unproject and one plane intersection.
    this.tmpVec.set(ndcX, ndcY, -1).unproject(this.camera);
    const dir = this.camera.getWorldDirection(this.tmpDir);
    if (Math.abs(dir.y) < 1e-6) return -1;
    const t = (this.camY - this.tmpVec.y) / dir.y;
    const wx = this.tmpVec.x + dir.x * t;
    const wz = this.tmpVec.z + dir.z * t;
    const tx = Math.floor(wx);
    const tz = Math.floor(wz);
    if (tx < 0 || tz < 0 || tx >= src.size || tz >= src.size) return -1;
    return tz * src.size + tx;
  }

  private readonly tmpDir = new Vector3();

  get stats(): { chunks: number; calls: number; triangles: number } {
    const info = this.renderer.info.render;
    return { chunks: this.chunks.size, calls: info.calls, triangles: info.triangles };
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

/**
 * Smooth 0..1 between two edges, in either direction.
 *
 * `b` below `a` is intended and used: nightness rises as the sun's height
 * falls. A ramp that only went upwards would need the caller to negate its
 * input, which is the sort of small inversion that ends up applied twice.
 */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lerpColour(into: Color, from: RGB, to: RGB, k: number): void {
  into.setRGB(
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
    from[2] + (to[2] - from[2]) * k,
  );
}

/**
 * A lit material with the two shader terms this game adds to Lambert.
 *
 * **Snow**, on upward faces only. `objectNormal.y` rather than a world normal
 * because nothing in this scene is rotated about anything but Y, so object-up
 * *is* world-up — and it is available before three has transformed anything.
 * Doing it in the shader rather than baking it into vertex colours is what
 * makes the season continuous: snow arrives over a fortnight, and a chunk
 * rebuild a day would stutter for a number that wants to change every frame.
 *
 * The upness ramp is the whole trick. A field goes white and a hedge's flanks
 * do not, so a hedge under snow is a dark line with a white cap on it — which
 * is what makes snow read as *depth* rather than as a filter over the picture.
 * Roofs, verges, the tops of stacks and the flat of a lorry's box all get it
 * for nothing.
 *
 * **Livery**, on the vertices the pipeline marked as bodywork. Tinting the
 * whole instance instead — which is what this did first — turns the windows and
 * the tyres the company colour too, and at forty pixels that reads as a solid
 * lozenge. Which is exactly the failure the model's stepped silhouette was
 * shaped to avoid, undone at the last step.
 *
 * @param takes how much of the snow term this material accepts, and `to` what
 *   colour. Roads pass a low figure and the wet colour: they are ploughed, so
 *   they get darker in winter, not lighter.
 */
function litMaterial(
  { livery, takes = 1, to = SNOW.lit }:
  { livery?: RGB; takes?: number; to?: RGB },
): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  mat.shadowSide = BackSide;
  const tint = livery ? new Color(...livery) : null;
  const snowColour = new Color(...to);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = SNOW_UNIFORM;
    shader.uniforms.uSnowTake = { value: takes };
    shader.uniforms.uSnowColour = { value: snowColour };
    let vs = `attribute float snowTake;
uniform float uSnow;
uniform float uSnowTake;
uniform vec3 uSnowColour;
${shader.vertexShader}`;
    if (tint) {
      shader.uniforms.uLivery = { value: tint };
      vs = `attribute float livery;
uniform vec3 uLivery;
${vs}`.replace(
        '#include <color_vertex>',
        `#include <color_vertex>
	vColor *= mix( vec3( 1.0 ), uLivery, livery );`,
      );
    }
    // After beginnormal_vertex, which is where `objectNormal` exists.
    shader.vertexShader = vs.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
	// abs, and it is not a shortcut. geometry.ts emits its triangles wound
	// backwards -- see the DoubleSide note in the constructor -- so every
	// surface this engine builds by hand has a normal pointing the wrong way.
	// The first version of this used objectNormal.y directly, so snow landed
	// on the roofs of the pipeline models, whose winding is correct, and on
	// nothing else: white roofs over green fields in January. Taking the
	// magnitude makes it agnostic to winding, which is the same compromise
	// the double-sided material already makes.
	float upness = smoothstep( 0.30, 0.82, abs( objectNormal.y ) );
	vColor = mix( vColor, uSnowColour, clamp( uSnow * uSnowTake * snowTake * upness, 0.0, 1.0 ) );`,
    );
  };
  return mat;
}

/**
 * How deep the snow is, shared by every material in the scene.
 *
 * One uniform object handed to all of them, so setting the season is one write
 * rather than a walk over every material a streamed chunk ever created — and it
 * cannot get out of step between the ground and the road running over it.
 */
const SNOW_UNIFORM = { value: 0 };

/**
 * The old bodywork-only tint, kept as a name.
 *
 * The pipeline reserves a `livery` material slot and `glb.ts` turns it into a
 * per-vertex mask, so the information is already in the geometry — but three's
 * standard materials have nowhere to read it from. Twelve lines of injected
 * GLSL do: multiply the vertex colour by the company colour where the mask says
 * bodywork, and leave it alone where it says tyre, glass or chrome.
 *
 * The alternative was tinting the whole instance, which is what this did
 * before, and it turns the windows and the tyres the company colour too. At
 * forty pixels that reads as a solid lozenge — which is exactly the failure
 * the model's stepped silhouette was shaped to avoid, undone at the last step.
 */
function liveryMaterial(body: RGB): MeshLambertMaterial {
  // A lorry is driven and swept, so it holds a little snow on the box roof and
  // none anywhere else.
  return litMaterial({ livery: body, takes: 0.30 });
}
