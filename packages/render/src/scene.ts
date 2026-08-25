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
  AdditiveBlending, BackSide, Color, DirectionalLight, DoubleSide, Fog, Group,
  InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, MeshLambertMaterial,
  Object3D, OrthographicCamera, HemisphereLight, PCFSoftShadowMap, PointLight,
  Scene as ThreeScene, Vector3, WebGLRenderer,
} from 'three';
import {
  buildGround, groundHeightAt, toMesh, HEIGHT_TO_WORLD, type GroundSource,
} from './ground.ts';
import { Mesh } from './geometry.ts';
import { buildRoads, buildCatsEyes, type RoadSource } from './roads.ts';
import type { Model } from './glb.ts';
import { Precipitation } from './weather.ts';
import { LIVERY, NIGHT, SKY, SNOW, type RGB } from './palette.ts';
import {
  LOOK, aimFog, aimShade, buildComposer, makeFog, makeMotes, moodAt, stylise,
  type Composed, type Mood, type Motes,
} from './look.ts';

export { HEIGHT_TO_WORLD };

/**
 * How far a lorry will reverse before it gives up and turns round.
 *
 * Long enough to back out of a farm spur, which is what it is for; short enough
 * that a wrong heading on the open road is corrected within a lorry's length
 * rather than carried across the district.
 */
const REVERSE_LIMIT = 3.5;

/**
 * How far back the camera sits from what it is looking at.
 *
 * Named because the fog needs it too. With an orthographic camera every pixel is
 * at roughly this depth, so aerial perspective has to be graded *around* the
 * figure rather than outward from zero — see `aimFog`.
 */
const CAMERA_DISTANCE = 120;

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

/**
 * How many real lights the scene keeps.
 *
 * Eight. Three renders forward, so this number appears in every shader in the
 * scene and every fragment pays for it whether anything is near it or not —
 * which is why it is a pool handed round rather than a light per lamp.
 */
const LAMP_POOL = 8;

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
   * A stable identity per vehicle, so motion can be smoothed.
   *
   * The arrays are packed each frame and an index is therefore not an identity —
   * one vehicle finishing a job shifts every later one down a slot. Smoothing
   * keyed on the slot would then interpolate one lorry's position toward
   * another's, which is a teleport. Negative ids are ambient traffic.
   */
  vId: Int32Array;
  /**
   * 1 while a vehicle is standing at a stop rather than travelling.
   *
   * The renderer eases a vehicle's drawn position toward the simulated one,
   * which is what smooths the uneven arrival of positions from a variable number
   * of ticks a frame. At a stop that easing is wrong: a lorry loading was seen to
   * "aggressively bump the thing for a second or two", which is the drawn
   * position still chasing a target that has just jumped to the far end of the
   * link it arrived on. Standing still is a state, and it has to be said out
   * loud.
   */
  vStopped: Uint8Array;
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
  /**
   * What colour each building's windows are burning, as RGB triples.
   *
   * Black is off, and off is a real state: every house picks its own hour to
   * light up and its own hour to go to bed, and one in ten never bothers. All of
   * it is decided from the building's position and the world seed, so the same
   * village lights up the same way every time you play it — which is the whole
   * point. A village where the pattern of lit windows changed every evening
   * would read as flickering rather than as people.
   *
   * A triple rather than a brightness, because the same hash that picks the hour
   * also warms or cools the bulb a little, and no two windows in a street are
   * the same colour.
   */
  pLamp: Float32Array;
  /** 0..1 through the day, for the sun. */
  dayFraction: number;
  /** Which day it is, so the weather is the same on the same day. */
  dayNumber: number;
  /** 0..1 depth of snow. One number, and the same one the traffic obeys. */
  snow: number;
  /**
   * Scatter: trees, and anything else there are hundreds of.
   *
   * A separate layer from the buildings because the counts are two orders apart.
   * A district has a dozen businesses and a thousand trees, so they want
   * different instance capacities and different update rules — the buildings are
   * relaid whenever influence grows, the trees never move at all.
   */
  scatterCount: number;
  sx: Float32Array;
  sz: Float32Array;
  sModel: Uint8Array;
  sRot: Float32Array;
  sScale: Float32Array;
  /**
   * Street lamps, for the pool of real lights.
   *
   * Separate from the scatter that draws them because these are the strongest
   * claim on a real light in the whole district: a street lamp is the main source
   * on a road at night and has nothing near it to borrow from, where a window at
   * least sits on a building that catches the moon.
   */
  lampCount: number;
  lx: Float32Array;
  lz: Float32Array;
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
  private readonly routeMaterial: MeshBasicMaterial;
  private readonly streetGlow: MeshBasicMaterial;
  /** Everything that emits: cat's eyes and lamps. Unlit, additive, and its
   *  opacity is how far into the night we are. */
  private readonly glow: MeshBasicMaterial;
  private readonly sun: DirectionalLight;
  private readonly fill: HemisphereLight;
  /**
   * A cool directional kicker opposite the sun, casting no shadow.
   *
   * The missing half of the temperature contrast. The hemisphere lifts the
   * shadows but lifts them from directly above, so a vertical face turned away
   * from the sun got almost nothing and every silhouette lost its form on its
   * dark side. This fills that side from the opposite quarter, in a colder
   * colour than the key, which is the single change that stops the district
   * reading as one temperature.
   */
  private readonly kicker: DirectionalLight;
  private readonly fog: Fog;
  private readonly motes: Motes;
  private composed: Composed | null = null;
  private mood: Mood = moodAt(1, 0);
  /** The sun's height, 0 at the horizon and 1 overhead. Written by `placeSun`. */
  private sunHeight = 1;
  private snowDepth = 0;
  private elapsed = 0;
  private width = 1;
  private height = 1;
  /**
   * How much of the look to draw.
   *
   * `high` is the whole chain; `low` keeps the grade and the fog and drops the
   * two passes that cost real fill rate — bloom and the shaft march — along with
   * the motes; `off` renders straight to the canvas with none of it. Offered
   * because the chain is the one part of this renderer whose cost scales with
   * screen area rather than with district size, so it is the part a slower
   * machine needs to be able to decline.
   */
  vfx: 'high' | 'low' | 'off' = 'high';
  /**
   * Real lights, a few, for the things nearest the camera.
   *
   * "Why not just use actual lights?" — and for these, that is the right
   * question. The answer for the other two hundred is that three renders forward:
   * every light is compiled into the shader and costs per-fragment work on every
   * material in the scene, so the practical ceiling is somewhere around a dozen
   * and a night district has hundreds of lit windows and thirty vehicles.
   *
   * But a pool solves that, and it is the standard answer. Keep eight lights,
   * assign them each frame to whatever is closest to the camera, and let the
   * drawn beams and pools carry everything further out. Near the camera — which
   * is the only place you can see the difference — the light is real: it falls
   * off correctly, it climbs the *walls* of the building it comes from, and a
   * lorry driving past a lit cottage picks up warm light down its side. A quad
   * lying on the ground can never do any of that.
   *
   * Eight, and no shadows on them. A shadow-casting point light is six shadow
   * maps and would be the whole frame budget for one window.
   */
  private readonly lampPool: PointLight[] = [];
  private readonly precipitation: Precipitation;
  private readonly chunks = new Map<number, Chunk>();
  private readonly fleet = new Group();
  /** Batches indexed [model][livery], for bodies and for lamps. */
  private lamps: (InstancedMesh | null)[][] = [];
  private readonly places = new Group();
  private placeBatches: InstancedMesh[] = [];
  private readonly scatter = new Group();
  private scatterBatches: InstancedMesh[] = [];
  /** A route being considered, drawn over the road. */
  private routeMesh: ReturnType<typeof toMesh> | null = null;
  private routeKey = '';
  private batches: (InstancedMesh | null)[][] = [];
  private frame = 0;
  private cols = 0;

  /** Where the camera is looking, in tiles, and how much it shows. */
  camX = 0;
  camZ = 0;
  /**
   * Where it is heading, if anywhere.
   *
   * Jumping the camera to a place loses the player: the district looks much the
   * same everywhere, so a cut gives no sense of *which way* you went, and the
   * relationship between where you were and where you are now — which is the
   * whole content of "this farm supplies that dairy" — is thrown away. Gliding
   * keeps it. It costs two numbers and an ease.
   */
  private flyX = 0;
  private flyZ = 0;
  private flying = false;
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
     * Roads get their own material so they can take *less* snow, not different
     * snow.
     *
     * I had this backwards first time and it was a design decision, not a bug —
     * I reasoned that a cleared road is darker and wetter than a dry one, made
     * roads mix toward a wet grey, and got a district where the fields went
     * white and the roads went black. It is defensible and it is not what a
     * snowy lane looks like, which is snow with two dark tracks cut through it.
     * The tracks do that job on their own (see roads.ts), and they do it far
     * better, because they say where the traffic goes.
     *
     * 0.88 rather than 1 so the road keeps a hint of its own colour under the
     * snow and does not merge into the field beside it.
     */
    this.roadMaterial = litMaterial({ takes: 0.88 });

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
    /*
     * The route overlay, and it is unlit on purpose.
     *
     * A route line is interface, not scenery. Drawn with the lit material it
     * dimmed at dusk, went blue at night and — once the snow term arrived —
     * turned white in January along with the fields it was drawn on top of, so
     * the one thing on screen whose entire job is to be legible became the least
     * legible thing on it. Unlit means the two run colours are exactly the two
     * colours the palette authored, at every hour of every season.
     */
    this.routeMaterial = new MeshBasicMaterial({
      vertexColors: true,
      side: DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });

    /*
     * The street lights, on their own dimmer.
     *
     * A copy of the glow material rather than the same one, because they are the
     * one class of light that goes off while it is still dark: the village is lit
     * until midnight and then it is not, which is both true of a lot of England
     * and the single best thing that happens to this district at night.
     */
    this.streetGlow = new MeshBasicMaterial({
      vertexColors: true,
      side: DoubleSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    });

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

    /*
     * The cool kicker. No shadow, on purpose: a second shadow-casting light
     * doubles the shadow pass and draws a second set of shadows going the wrong
     * way, and its whole job is to be the light that has no direction you can
     * point at.
     */
    this.kicker = new DirectionalLight(new Color(0.55, 0.70, 0.95), 0.45);
    this.kicker.position.set(-0.6, 0.5, 0.7);
    this.scene.add(this.kicker);

    this.fog = makeFog();
    this.scene.fog = this.fog;
    this.motes = makeMotes();
    this.scene.add(this.motes.points);
    for (let i = 0; i < LAMP_POOL; i++) {
      // Distance rather than decay: a physically correct inverse-square falloff
      // at this scale puts everything either blown out or black, because a tile
      // is a symbolic unit and not a metre. A linear-ish falloff over a fixed
      // radius is the one that looks like light here.
      const light = new PointLight(new Color(1, 0.72, 0.38), 0, 4.5, 1.4);
      light.visible = false;
      this.scene.add(light);
      this.lampPool.push(light);
    }
    this.scene.add(this.fleet);
    this.scene.add(this.places);
    this.scene.add(this.scatter);
    this.precipitation = new Precipitation(this.scene);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.width = w;
    this.height = h;
    this.composed?.setSize(w, h);
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
  /**
   * Half the depth the frame spans, in world units along the view axis.
   *
   * Moving up the screen by `v` world units in the image plane means moving
   * `v / sin(elevation)` further across the ground, which is `v / tan(elevation)`
   * further from the camera. At the standard thirty-eight degrees that is about
   * 1.28 units of depth per unit of screen height — so a frame twenty-six tiles
   * wide on a wide window spans a mere eleven units front to back. Every fog
   * figure in this renderer has to be scaled to that, and the number is small
   * enough that guessing it is guaranteed to be wrong.
   */
  private halfDepth(): number {
    const aspect = Math.max(0.2, this.width / Math.max(1, this.height));
    const halfUp = this.tilesAcross / aspect / 2;
    return halfUp / Math.tan((38 * Math.PI) / 180);
  }

  private placeCamera(): void {
    const el = (38 * Math.PI) / 180;
    const az = (-32 * Math.PI) / 180;
    const d = CAMERA_DISTANCE;
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
  /**
   * Glide to a place instead of cutting to it.
   *
   * Exponential ease with a floor on the step, so it is quick when far and does
   * not crawl for ever when close — a pure exponential never arrives, and a
   * camera that is still creeping a tenth of a tile after two seconds reads as
   * a bug. Any drag or key cancels it, because the player taking hold of the
   * camera always wins.
   */
  flyTo(x: number, z: number): void {
    this.flyX = x;
    this.flyZ = z;
    this.flying = true;
  }

  /** Stop gliding. Called when the player moves the camera themselves. */
  stopFlying(): void {
    this.flying = false;
  }

  private stepFly(dt: number): void {
    if (!this.flying) return;
    const dx = this.flyX - this.camX;
    const dz = this.flyZ - this.camZ;
    const away = Math.hypot(dx, dz);
    if (away < 0.05) {
      this.camX = this.flyX;
      this.camZ = this.flyZ;
      this.flying = false;
      return;
    }
    // Six per cent of the remainder per sixtieth, with a floor of a fifth of a
    // tile a second so the last stretch is walked rather than approached.
    const k = Math.min(1, 1 - Math.pow(1 - 0.075, dt * 60));
    const step = Math.max(away * k, Math.min(away, 0.2 * dt * 60 * 0.06));
    this.camX += (dx / away) * step;
    this.camZ += (dz / away) * step;
  }

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
    /*
     * Night at about a sixth of the light of day, and this is the third go at it.
     *
     * The first was a fifth and the district went unreadably black. The second
     * over-corrected to a half, which is a blue afternoon — "it doesn't get dark
     * enough at night, no way, this doesn't feel like nighttime at all", and
     * that was right: at half brightness the fields still read as green and
     * nothing on screen was dark.
     *
     * What was wrong both times was treating readability and darkness as the
     * same dial. They are not. A moonlit landscape *is* dark; what makes it
     * legible is that the lit things — headlamps, cat's eyes, windows — are
     * bright against it, and there were not enough of those to carry the frame.
     * Now there are. So the ground can go properly dark, because the road is
     * picked out in studs and the traffic is carrying lights.
     */
    // Kept for the mood table, which is a function of exactly the two numbers
    // the light already had to work out.
    this.sunHeight = lit;
    this.sun.intensity = (2.5 + lit * 0.5) * day + 0.34 * this.night;
    this.fill.intensity = (0.62 + (1 - lit) * 0.22) * day + 0.20 * this.night;
    lerpColour(this.fill.color, SKY.zenith, NIGHT.zenith, this.night);
    lerpColour(this.fill.groundColor, SKY.ground, NIGHT.ground, this.night);
    lerpColour(this.clear, SKY.horizon, NIGHT.horizon, this.night);
    this.renderer.setClearColor(this.clear);

    // And the one number that lights every lamp and every stud in the game.
    // The lamps carry the night now, so they come up sooner and go brighter than
    // the darkness alone would suggest: by the time the ground is properly dark
    // the lights are already the brightest things on screen.
    this.glow.opacity = Math.min(1, this.night * 1.25);
    /*
     * And the street lights, which go out at midnight.
     *
     * `t` is 0.75 at midnight (the sun is at its lowest), so they burn from dusk
     * until then and the small hours are properly dark — which is when the lit
     * windows and a lorry's headlamps become the only things on screen, and the
     * best-looking half hour of the day.
     *
     * Faded over a twentieth of a day rather than switched, because a whole
     * district going dark in one frame reads as a bug however true it is.
     */
    const past = t - 0.75;
    const dimming = past < 0 ? 1 : Math.max(0, 1 - past / 0.05);
    this.streetGlow.opacity = this.glow.opacity * dimming;
    this.streetOn = dimming;
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
    this.snowDepth = snow;
    // A gentle lift, not a wash. Snow is a big reflector so the shaded side of
    // everything is brighter and bluer in winter — but overdoing it flattens the
    // contrast that was showing the relief in the first place, which at 0.35 it
    // did.
    this.fill.intensity *= 1 + snow * 0.12;
  }

  /**
   * The weather, and it moves whether anything else is happening or not.
   *
   * Drift is unbounded and deliberately so: the cloud field is periodic in the
   * sines, so it never needs wrapping and cannot seam. Coverage wanders on a
   * pair of slow sines of the *clock* rather than of real time, so the weather is
   * the same on the same day for anyone watching — one fewer thing that changes
   * when you look away and back.
   *
   * An overcast sky also flattens the sun and lifts the fill, because that is
   * what cloud does. Without it the shadows stay knife-sharp under a covered sky
   * and the cloud shadow reads as a stain on the ground rather than as weather.
   */
  private setWeather(dayFraction: number, dayNumber: number, dt: number): void {
    this.drift += dt * 0.9;
    const along = this.drift;
    CLOUD_DRIFT.value[0] = along * 0.78;
    CLOUD_DRIFT.value[1] = along * 0.41;

    const slow = dayNumber + dayFraction;
    const cover = 0.5
      + 0.34 * Math.sin(slow * 0.9 + 0.4)
      + 0.16 * Math.sin(slow * 2.7 + 2.1);
    const amount = Math.max(0.06, Math.min(1, cover));
    CLOUD_AMOUNT.value = amount;
    this.cloud = amount;

    /*
     * It only rains when it is properly overcast.
     *
     * Rain keyed straight off cloud cover would mean permanent drizzle, because
     * cover sits around a half most of the time. Thresholding at three quarters
     * makes rain an *event* — a few hours of a day, several days apart — which is
     * what makes it worth looking at when it happens.
     */
    this.rain = this.forceRain >= 0
      ? this.forceRain
      : Math.max(0, Math.min(1, (amount - 0.74) / 0.20));

    // Cloud softens the sun and raises the ambient. A covered sky with hard
    // shadows under it is the tell that weather has been painted on.
    this.sun.intensity *= 1 - amount * 0.30;
    this.fill.intensity *= 1 + amount * 0.34;
  }

  private drift = 0;
  /** How overcast it is, 0..1. Read by the client for the sky. */
  cloud = 0.5;
  /** How hard it is coming down, 0..1. Read by the client for the sound. */
  rain = 0;
  /** True when what is falling is snow. Winter turns rain into snow. */
  snowing = false;
  /**
   * Override the weather, or -1 to let it do as it likes.
   *
   * The same affordance as the clock override, for the same reason: rain is a
   * few hours of a day several days apart, so waiting for one means twenty
   * minutes of watching a field. A thing that is awkward to look at is a thing
   * that stays broken.
   */
  forceRain = -1;

  /** How far into the night, 0..1. Read by the glow pass, and by the clock. */
  night = 0;
  /** 1 while the street lights are burning, 0 after midnight. */
  streetOn = 0;
  private readonly clear = new Color();
  private readonly sunRGB: [number, number, number] = [0, 0, 0];

  /**
   * Hand the pool to whatever is nearest, and switch it off in daylight.
   *
   * Nearest *to the camera's target*, not to the camera, because the target is
   * where the player is looking. Buildings first and vehicles after, because a
   * lit window is stationary and a moving light draws the eye far more than it
   * is worth — one or two headlamps close by is atmosphere, eight is a disco.
   *
   * Sorted by a partial selection rather than a full sort: there are a couple of
   * hundred candidates and eight winners, so `sort` would be doing two hundred
   * comparisons a frame to answer a question eight passes can answer.
   */
  private placeLights(src: RenderSource): void {
    if (this.lampPool.length === 0) return;
    if (this.night < 0.02) {
      for (const l of this.lampPool) l.visible = false;
      return;
    }

    // Candidates: every building in view, then the player's vehicles.
    const cand = this.lampCandidates;
    cand.length = 0;
    for (let i = 0; i < src.placeCount; i++) {
      const dx = src.px[i] - this.camX;
      const dz = src.pz[i] - this.camZ;
      const d = dx * dx + dz * dz;
      if (d > 900) continue;
      cand.push({ x: src.px[i], z: src.pz[i], d, warm: true, sodium: false });
    }
    for (let i = 0; i < src.lampCount; i++) {
      const dx = src.lx[i] - this.camX;
      const dz = src.lz[i] - this.camZ;
      const d = dx * dx + dz * dz;
      if (d > 900) continue;
      // Weighted closer than it is, so a street lamp beats a window at the same
      // distance for a place in the pool. It is the brighter thing in life and
      // the one whose absence is most obvious.
      cand.push({ x: src.lx[i], z: src.lz[i], d: d * 0.45, warm: true, sodium: true });
    }
    for (let i = 0; i < src.vehicleCount; i++) {
      // Only yours. Ambient traffic already carries a drawn beam, and a real
      // light on every passing car is the disco.
      if (src.vId[i] < 0) continue;
      const dx = src.vx[i] - this.camX;
      const dz = src.vz[i] - this.camZ;
      const d = dx * dx + dz * dz;
      if (d > 400) continue;
      cand.push({ x: src.vx[i], z: src.vz[i], d, warm: false, sodium: false });
    }

    /*
     * Spread them out, and this is the difference between lighting and a blob.
     *
     * Taking simply the eight nearest put all eight on one village — the street
     * lamps along fifty yards of the same lane — and eight point lights summing
     * over one patch of grass is a floodlight, not a lit street. Refusing a
     * candidate within a tile and a half of one already chosen makes the pool
     * cover the *area* rather than pile onto the closest corner of it, so what
     * you see is a row of separate pools down a road.
     *
     * Greedy nearest-first with a separation test, which is one more comparison
     * per candidate and needs no clustering pass.
     */
    const APART = 1.5 * 1.5;
    let filled = 0;
    for (let k = 0; k < cand.length && filled < this.lampPool.length; k++) {
      let best = -1;
      for (let j = k; j < cand.length; j++) {
        if (best < 0 || cand[j].d < cand[best].d) best = j;
      }
      if (best < 0) break;
      const tmp = cand[k];
      cand[k] = cand[best];
      cand[best] = tmp;

      const c = cand[k];
      let crowded = false;
      for (let q = 0; q < filled; q++) {
        const l = this.lampPool[q];
        const dx = l.position.x - c.x;
        const dz = l.position.z - c.z;
        if (dx * dx + dz * dz < APART) { crowded = true; break; }
      }
      if (crowded) continue;

      const light = this.lampPool[filled];
      filled++;
      // A little above the ground: a window is at head height, and a light at
      // ground level lights the grass and not the wall behind it.
      light.position.set(c.x, groundHeightAt(src, c.x, c.z) + 0.34, c.z);
      /*
       * Dim, and dimmer than the first guess by half.
       *
       * At 2.6 over four and a half tiles a single cottage lit most of a field
       * bright yellow — which is not what a window does, and over green grass it
       * went lurid. A window throws light a few yards and then stops. Less
       * saturated too: tungsten *is* orange, but a saturated orange light on
       * green grass is the one combination that reads as a fault rather than as
       * warmth.
       */
      if (c.sodium) {
        // Low-pressure sodium, which is the most saturated orange any lamp has
        // ever been and the reason a photograph of an English town at night in
        // 1985 is unmistakable. Higher and wider than a window, because it is
        // eight metres up and pointed at the road.
        light.color.setRGB(1, 0.62, 0.24);
        // Times the same midnight switch, or the pools of light would stay on
        // the road after the lamps above them had gone out.
        light.intensity = this.night * 0.85 * this.streetOn;
        light.distance = 2.9;
        light.position.y += 0.16;
      } else if (c.warm) {
        light.color.setRGB(1, 0.82, 0.60);
        light.intensity = this.night * 0.95;
        light.distance = 2.6;
      } else {
        light.color.setRGB(1, 0.96, 0.88);
        light.intensity = this.night * 0.8;
        light.distance = 2.2;
      }
      light.visible = true;
    }
    for (let k = filled; k < this.lampPool.length; k++) {
      this.lampPool[k].visible = false;
    }
  }

  private readonly lampCandidates:
  { x: number; z: number; d: number; warm: boolean; sodium: boolean }[] = [];

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
    for (const b of [...this.placeBatches, ...this.placeLamps]) {
      if (!b) continue;
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
    /*
     * And the windows, which this used to throw away.
     *
     * `setPlaceModels` took only `model.body` and dropped `model.lamps`, so a
     * building could be painted with the reserved lamp slot all it liked and
     * nothing would ever draw it — the village stayed black at midnight while
     * the traffic on the road beside it carried lights. The fleet had this from
     * the start; the buildings did not, which is exactly the sort of asymmetry
     * that survives because both halves look correct on their own.
     */
    this.placeLamps = models.map((model) => {
      if (!model.lamps) return null;
      const mesh = new InstancedMesh(model.lamps, this.glow, capacity);
      // A lit window does not cast a shadow. It is a hole letting light out.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.places.add(mesh);
      return mesh;
    });
  }

  private placeLamps: (InstancedMesh | null)[] = [];

  /**
   * Hand the renderer the scatter models.
   *
   * Big capacity, and it is the only reason this is not just more place models:
   * seven hundred trees against sixty-four buildings. Trees cast shadows and
   * receive them, which for something drawn a thousand times is worth stating —
   * it is the whole cost of having them, and the whole reason they are worth
   * having. A tree without a shadow is a sticker.
   */
  setScatterModels(models: Model[], capacity = 700): void {
    for (const b of [...this.scatterBatches, ...this.scatterLamps]) {
      if (!b) continue;
      this.scatter.remove(b);
      b.dispose();
    }
    this.scatterBatches = models.map((model) => {
      const mesh = new InstancedMesh(model.body, litMaterial({}), capacity);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.scatter.add(mesh);
      return mesh;
    });
    /*
     * And the lamps, which this dropped — the third time this exact omission has
     * cost something.
     *
     * A street lamp's lit head and the pool it throws are both painted with the
     * reserved lamp slot, so they arrive in `model.lamps`; this took only
     * `model.body`, so the district gained lamp *posts* and no light from any of
     * them. I had already fixed the same thing on the fleet and then on the
     * buildings, and still wrote it a third time.
     *
     * The reason it keeps happening is that a model with its lamps thrown away
     * looks entirely correct in daylight, so nothing complains until it is dark.
     */
    this.scatterLamps = models.map((model) => {
      if (!model.lamps) return null;
      // Their own material, so the street lights can go out without taking the
      // windows and the headlamps with them. The only lit thing in the scatter
      // layer is the lamp post, so one material is exactly the right granularity
      // — a per-instance colour would be three hundred writes a frame to say the
      // same thing to every one of them.
      const mesh = new InstancedMesh(model.lamps, this.streetGlow, capacity);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.scatter.add(mesh);
      return mesh;
    });
  }

  private scatterLamps: (InstancedMesh | null)[] = [];

  private updateScatter(src: RenderSource): void {
    if (this.scatterBatches.length === 0) return;
    const key = `${src.scatterCount}:${this.placeRevision}`;
    if (key === this.scatterKey) return;
    this.scatterKey = key;

    const counts = new Int32Array(this.scatterBatches.length);
    for (let i = 0; i < src.scatterCount; i++) {
      const mi = src.sModel[i] % this.scatterBatches.length;
      const batch = this.scatterBatches[mi];
      if (counts[mi] >= batch.instanceMatrix.count) continue;
      const x = src.sx[i];
      const z = src.sz[i];
      this.tmp.position.set(x, groundHeightAt(src, x, z), z);
      this.tmp.rotation.set(0, src.sRot[i] * Math.PI * 2, 0);
      const k = src.sScale[i];
      this.tmp.scale.set(k, k, k);
      this.tmp.updateMatrix();
      const at = counts[mi]++;
      batch.setMatrixAt(at, this.tmp.matrix);
      this.scatterLamps[mi]?.setMatrixAt(at, this.tmp.matrix);
    }
    // Everything else in this file uses an unscaled `tmp`, so put it back or a
    // building drawn after a tree comes out tree-sized.
    this.tmp.scale.set(1, 1, 1);

    for (let mi = 0; mi < this.scatterBatches.length; mi++) {
      const batch = this.scatterBatches[mi];
      batch.count = counts[mi];
      batch.visible = counts[mi] > 0;
      batch.instanceMatrix.needsUpdate = true;
      const lamp = this.scatterLamps[mi];
      if (lamp) {
        lamp.count = counts[mi];
        lamp.visible = counts[mi] > 0;
        lamp.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private scatterKey = '';
  /*
   * Nothing here needs redoing when night falls: the lamp meshes hold the same
   * matrices as the bodies for as long as the bodies do, and how lit they are is
   * the shared glow material's opacity. One write a frame, in `placeSun`.
   */

  private updatePlaces(src: RenderSource): void {
    if (this.placeBatches.length === 0) return;
    /*
     * Laid out every frame now, and the cache that used to guard this had to go.
     *
     * It keyed on the number of buildings, which was right while a building was
     * a fixed thing — but a window that comes on at its own hour changes what has
     * to be written without changing what is in the list, and a cache cannot see
     * that. Forty buildings and a matrix compose each is nothing; the caching was
     * premature and it was about to be wrong.
     */
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
      const at = counts[mi]++;
      batch.setMatrixAt(at, this.tmp.matrix);
      const lamp = this.placeLamps[mi];
      if (lamp) {
        lamp.setMatrixAt(at, this.tmp.matrix);
        // Per-instance colour, which is how one house can be lit and the one
        // beside it dark out of the same geometry. Black multiplies the emissive
        // window and its pool of light to nothing at once, so "off" costs
        // nothing and needs no second batch.
        if (!lamp.instanceColor) {
          lamp.instanceColor = new InstancedBufferAttribute(
            new Float32Array(lamp.instanceMatrix.count * 3), 3,
          );
        }
        const c = lamp.instanceColor.array as Float32Array;
        c[at * 3] = src.pLamp[i * 3];
        c[at * 3 + 1] = src.pLamp[i * 3 + 1];
        c[at * 3 + 2] = src.pLamp[i * 3 + 2];
        lamp.instanceColor.needsUpdate = true;
      }
    }
    for (let mi = 0; mi < this.placeBatches.length; mi++) {
      const batch = this.placeBatches[mi];
      batch.count = counts[mi];
      batch.visible = counts[mi] > 0;
      batch.instanceMatrix.needsUpdate = true;
      const lamp = this.placeLamps[mi];
      if (lamp) {
        lamp.count = counts[mi];
        lamp.visible = counts[mi] > 0;
        lamp.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /**
   * The highest of the four corner heights of the tile under a point.
   *
   * For things with a flat base — buildings, mostly. A house on a slope has to
   * sit at the *high* corner or it sinks into the hill behind it, and it has a
   * plinth for exactly that reason. Anything that moves wants `groundHeightAt`
   * instead: a tile-wide constant is what made vehicles bounce.
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

  /**
   * Throw away the one piece of ground a tile is in.
   *
   * For a tractor turning over the tile it is standing on. The whole-district
   * rebuild below is the right answer for a change of season, when every field
   * in the county changes at once; it is absurdly the wrong one for a single
   * tile, and it would happen several times a second while a tractor is out.
   *
   * The streamer rebuilds whatever is missing within its own time budget, so
   * dropping a chunk is the entire mechanism — there is nothing to schedule.
   */
  dropChunkAt(x: number, z: number): void {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const key = cz * this.cols + cx;
    const chunk = this.chunks.get(key);
    if (!chunk) return;
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

  /**
   * Throw away every built chunk, so the ground is rebuilt from scratch.
   *
   * The crop is baked into the chunk's vertex colours, which is what makes the
   * ground one draw call per chunk and no per-frame work at all — and the price
   * of that is that a field changing colour cannot be a uniform. It has to be
   * rebuilt.
   *
   * That is fine because it is rare: the farming year turns a stage over about
   * eight times, so this runs eight times in sixteen hours of play. Rebuilding
   * the visible district takes a few frames and the streaming budget already
   * handles arriving chunks gracefully, because that is the case it was written
   * for.
   */
  dropChunks(): void {
    for (const chunk of this.chunks.values()) {
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
    }
    this.chunks.clear();
  }

  /** Bump to force the buildings to be laid out again — the caller does this
   *  when influence has grown and more of the district is visible. */
  placeRevision = 0;
  private placeKey = '';

  private readonly tmp = new Object3D();

  /** Drawn position and facing per vehicle id, for easing. */
  private readonly smooth = new Map<
    number, { x: number; z: number; a: number; rev: number }>();

  private updateFleet(src: RenderSource, dt: number): void {
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
      /*
       * The surface under this exact point, not the tile it is standing in.
       *
       * `groundTop` — the highest of the four corners — is one number for a whole
       * tile, so a vehicle crossing a slope climbed a step at every boundary and
       * bounced the whole way down a hill. `groundHeightAt` interpolates inside
       * the very triangle being drawn beneath the wheels, so the ride is as
       * smooth as the ground is.
       */
      const y = (lv !== 0 ? HEIGHT_TO_WORLD(lv) : groundHeightAt(src, x, z)) + 0.045;
      /*
       * Where it is drawn, eased toward where the simulation says it is.
       *
       * The simulation reprojects positions only after a batch of ticks, and the
       * client steps a variable number of them per frame, so the raw position
       * arrives in jumps of uneven size — reported, fairly, as "their horrible
       * movement is so not consistent at all". Easing the drawn position toward
       * the true one absorbs that completely and costs one lerp.
       *
       * The heading needs it more. The simulation stores a bearing as one of
       * eight octants, because ways are laid on a grid and an integer table
       * beats an atan2 in the hot loop — so a lorry going round a corner snaps
       * forty-five degrees in one frame. Interpolating the *angle* the short way
       * round turns that into a turn.
       */
      const id = src.vId[i];
      const want = Math.PI / 2 - src.vHeading[i] * Math.PI * 2;
      let seen = this.smooth.get(id);
      if (seen !== undefined && src.vStopped[i] === 1) {
        // Standing at a stop: leave it exactly where it is. No easing toward a
        // target, because the target is no longer where the lorry is.
        seen.rev = 0;
        this.tmp.position.set(seen.x, y, seen.z);
        this.tmp.rotation.set(0, seen.a, 0);
        this.tmp.updateMatrix();
        const at = this.counts[slot]++;
        batch.setMatrixAt(at, this.tmp.matrix);
        this.lamps[mi][li]?.setMatrixAt(at, this.tmp.matrix);
        continue;
      }
      if (seen === undefined || Math.abs(seen.x - x) + Math.abs(seen.z - z) > 3) {
        // New, or teleported: snap. Easing across a jump of three tiles would
        // draw a lorry sliding across a field.
        seen = { x, z, a: want, rev: 0 };
        this.smooth.set(id, seen);
      } else {
        /*
         * A softer filter, because a lag filter *is* a corner-rounder.
         *
         * At 14 the drawn position sat almost exactly on the simulated one, so
         * the vehicle pivoted at junctions along with it. At 7 it trails by a
         * fraction of a tile and cuts the corner — which is what a lorry does,
         * and which is the whole of the fix for the simulated fleet. The ambient
         * traffic gets a real Bézier because there the path is mine to shape;
         * here the path belongs to the simulation and this is the honest way to
         * smooth it without lying about where the lorry is.
         */
        const k = Math.min(1, dt * 7);
        /*
         * Reversing, when the road it is leaving on runs back the way it came.
         *
         * A farm or a dairy is on a spur, so a lorry arrives up the spur facing
         * one way and its next link is the same spur facing the other. The
         * heading therefore flips a hundred and eighty degrees at the stop, and
         * easing that "the short way round" drew a lorry *spinning on the spot
         * against the building* - which is what was reported as it aggressively
         * bumming the thing for a second or two, and what "I hate that things
         * turn on the spot" was about before that.
         *
         * A lorry does not pirouette at a farm gate. It reverses out to the
         * road. So when the direction it is actually travelling opposes the
         * direction it is facing, it keeps facing where it is and simply moves
         * backwards. At the junction the new heading is across its nose rather
         * than behind it, the test stops holding, and it swings round there -
         * which is exactly where a driver would do it.
         *
         * Capped in tiles, because reversing is a manoeuvre and not a mode: a
         * bad heading on the open road must still be corrected, and a spur long
         * enough to exceed this is one worth turning round in.
         */
        const dxTravel = x - seen.x;
        const dzTravel = z - seen.z;
        const travelled = Math.hypot(dxTravel, dzTravel);
        const backwards = travelled > 1e-4
          && (Math.cos(seen.a) * dxTravel - Math.sin(seen.a) * dzTravel) / travelled < -0.4;
        seen.x += (x - seen.x) * k;
        seen.z += (z - seen.z) * k;
        if (backwards && seen.rev < REVERSE_LIMIT) {
          // Reversing: hold the facing and let it travel backwards. The drawn
          // position is already following normally, so there is nothing else to
          // do — this is entirely a decision not to turn.
          seen.rev += travelled * k;
        } else {
          seen.rev = 0;
          // Shortest way round, or a lorry turning from west to north spins 270
          // degrees the wrong way.
          let d = want - seen.a;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          seen.a += d * Math.min(1, dt * 6);
        }
      }
      this.smooth.set(id, seen);
      this.tmp.position.set(seen.x, y, seen.z);
      /*
       * And the facing itself was ninety degrees out.
       *
       * The models are authored nose along +X. A Y-rotation of theta sends +X to
       * (cos theta, 0, -sin theta). The simulation's bearing has 0 as north, so
       * a heading of `t` turns points along (sin 2*pi*t, -cos 2*pi*t). Solving
       * the two gives theta = pi/2 - 2*pi*t. The old expression was
       * pi - 2*pi*t: exactly a quarter turn out, so every vehicle in the game
       * was drawn broadside to its direction of travel.
       */
      this.tmp.rotation.set(0, seen.a, 0);
      this.tmp.updateMatrix();
      // The same matrix into both batches: a lamp is not a separate object, it
      // is the same lorry drawn by a material that ignores the light.
      const n = this.counts[slot]++;
      batch.setMatrixAt(n, this.tmp.matrix);
      this.lamps[mi][li]?.setMatrixAt(n, this.tmp.matrix);
      /*
       * A few per cent of colour variation per vehicle, from its own id.
       *
       * Four liveries over thirty vehicles reads as a fleet of clones. A little
       * jitter — paint, dirt, age — and the same road stops looking stamped.
       * Applied to the whole instance rather than only the bodywork, which is
       * the compromise `instanceColor` forces; at six per cent nobody can see
       * that the tyres varied too.
       */
      if (!batch.instanceColor) {
        batch.instanceColor = new InstancedBufferAttribute(
          new Float32Array(batch.instanceMatrix.count * 3), 3,
        );
      }
      const jc = batch.instanceColor.array as Float32Array;
      const seed = (id * 2654435761) >>> 0;
      jc[n * 3] = 0.94 + ((seed >>> 5) & 63) / 63 * 0.12;
      jc[n * 3 + 1] = 0.94 + ((seed >>> 13) & 63) / 63 * 0.12;
      jc[n * 3 + 2] = 0.94 + ((seed >>> 21) & 63) / 63 * 0.12;
      batch.instanceColor.needsUpdate = true;
    }

    // Anything not seen this frame is gone: retired, sold, or wandered out of
    // the influence area. Without this the map grows for the life of the
    // session, and a returning ambient car would ease in from wherever it was
    // last seen.
    if (this.smooth.size > src.vehicleCount * 3 + 64) {
      const live = new Set<number>();
      for (let i = 0; i < src.vehicleCount; i++) live.add(src.vId[i]);
      for (const key of [...this.smooth.keys()]) {
        if (!live.has(key)) this.smooth.delete(key);
      }
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

  render(src: RenderSource, dt = 1 / 60): void {
    this.stepFly(dt);
    this.followGround(src);
    this.streamChunks(src);
    this.updatePlaces(src);
    this.updateScatter(src);
    this.updateFleet(src, dt);
    this.placeSun(src.dayFraction);
    this.setSeason(src.snow);
    this.setWeather(src.dayFraction, src.dayNumber, dt);
    // After the sun and the weather, because it reads `this.night`.
    this.placeLights(src);
    /*
     * A shower in winter falls as snow, which needs saying rather than assuming:
     * the two are the same weather and only the temperature differs.
     */
    this.snowing = src.snow > 0.35;
    this.precipitation.update(
      dt, this.camX, this.camY, this.camZ,
      this.snowing ? 0 : this.rain,
      this.snowing ? this.rain : 0,
    );
    this.placeCamera();

    /*
     * The look, and it is all downstream of two numbers.
     *
     * `lit` and `night` already exist because the sun needs them, and every
     * value in the mood table is a continuous function of those two — so the
     * grade, the fog, the bloom and the hue ramp cannot fall out of step with
     * the light, and none of them can jump at an hour boundary because there are
     * no hour boundaries.
     */
    this.elapsed += dt;
    this.mood = moodAt(this.sunHeight, this.night);
    LOOK.ramp.value = this.vfx === 'off' ? 0 : this.mood.ramp;
    /*
     * The wrapped fill, and the hemisphere pays for it.
     *
     * This term *adds* light — up to `wrap * wrapGain` times the albedo — so
     * switching it on without taking the same amount off the real fill simply
     * makes the district brighter, which on a pastel palette reads as washed
     * out rather than as softly lit. That is exactly what the first attempt did.
     * The hemisphere is scaled down by the same figure below, so turning this
     * dial changes the *shape* of the fill and not its quantity.
     */
    LOOK.wrap.value = this.vfx === 'off' ? 0 : 0.30 * (1 - this.night * 0.5);
    this.fill.intensity *= 1 - LOOK.wrap.value * LOOK.wrapGain.value;
    aimShade(this.camera, this.sun, this.kicker);
    // The kicker cools and dims after dark: at night the sky *is* the fill, so
    // a directional kicker as strong as the daytime one would light the wrong
    // side of every building with something that is not there.
    this.kicker.intensity = 0.45 * (1 - this.night * 0.62);
    aimFog(this.fog, CAMERA_DISTANCE, this.halfDepth(), this.mood, this.clear);
    this.scene.fog = this.vfx === 'off' ? null : this.fog;
    /*
     * Motes in the warm half of the year only.
     *
     * Pollen and dust in the air is a July thing; in January the air is doing
     * something else and the precipitation system is already drawing it. Faded
     * on the snow rather than on the month so the two hand over to each other.
     */
    this.motes.update(
      dt, this.elapsed, this.camX, this.camZ,
      this.vfx === 'high' ? (1 - this.snowDepth) * (1 - this.night * 0.8) : 0,
    );

    if (this.vfx === 'off' || !this.composed) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composed.apply(this.vfx === 'low'
      ? { ...this.mood, bloom: 0, scatter: 0 }
      : this.mood);
    this.composed.aim(this.sun, this.camera);
    this.composed.render();
  }

  /**
   * Turn the post chain on, off, or down.
   *
   * The chain is built on first use rather than at construction, so a player who
   * never turns it on never pays for the half-float multisampled target — which
   * at a large window is tens of megabytes.
   */
  setVfx(level: 'high' | 'low' | 'off'): void {
    this.vfx = level;
    if (level === 'off') return;
    if (!this.composed) {
      this.composed = buildComposer(
        this.renderer, this.scene, this.camera, this.width, this.height,
      );
    }
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
        const y = (lv !== 0
          ? HEIGHT_TO_WORLD(lv)
          : this.groundTop(src, (t % s) + 0.5, ((t / s) | 0) + 0.5)) + 0.05;
        const h = 0.19;
        m.quad(
          x + 0.5 - h, y, z + 0.5 - h, x + 0.5 + h, y, z + 0.5 - h,
          x + 0.5 + h, y, z + 0.5 + h, x + 0.5 - h, y, z + 0.5 + h, seg.colour,
        );
      }
    }
    this.routeMesh = toMesh(m, this.routeMaterial);
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

  /**
   * Drag the map, in screen pixels.
   *
   * Grab-and-pull: the tile under the pointer stays under the pointer. That is
   * the only correct answer — every map anybody has ever used works this way,
   * and the first version had the sign the other way round, so dragging pushed
   * the world away instead of pulling it along.
   *
   * The maths is worth doing properly rather than fudging, because the camera is
   * pitched and the two screen axes are not equivalent. For an orthographic
   * camera a ground displacement `v` appears on screen as `(v·R, v·U)`, where R
   * and U are the camera's right and up basis vectors. R is horizontal for a
   * camera with no roll, so it lies in the ground plane already; U does not —
   * only `sin(elevation)` of it does. Solving for `v` given the wanted screen
   * movement gives a vertical scale of `1 / sin(el)`, which at 38 degrees is
   * 1.62.
   *
   * The previous code had a hard-coded 1.6 in it with no explanation. It was
   * very nearly right, and nobody could have known why.
   */
  pan(dxPixels: number, dyPixels: number): void {
    this.flying = false;
    const w = Math.max(1, this.renderer.domElement.clientWidth);
    const perPixel = this.tilesAcross / w;
    this.camera.updateMatrixWorld();
    const m = this.camera.matrixWorld.elements;
    const rx = m[0];
    const rz = m[2];
    const ux = m[4];
    const uz = m[6];
    const ul = Math.hypot(ux, uz);
    if (ul < 1e-4) return;
    const a = dxPixels * perPixel;
    const b = (-dyPixels * perPixel) / ul;
    // The world moves by a*R + b*ground(U); the camera moves against it.
    this.camX -= a * rx + b * (ux / ul);
    this.camZ -= a * rz + b * (uz / ul);
  }

  /**
   * Nudge the camera along the screen axes, in tiles. For the keyboard.
   *
   * Screen axes rather than world axes, because a player pressing W means "up
   * the screen" and not "north" — the district is drawn at a 32-degree azimuth
   * and nobody is tracking that in their head.
   */
  nudge(right: number, up: number): void {
    this.flying = false;
    this.camera.updateMatrixWorld();
    const m = this.camera.matrixWorld.elements;
    const ux = m[4];
    const uz = m[6];
    const ul = Math.hypot(ux, uz) || 1;
    this.camX += m[0] * right + (ux / ul) * up;
    this.camZ += m[2] * right + (uz / ul) * up;
  }

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
  // Every lit material carries the hue ramp, applied at the end of this
  // function so it chains onto the snow, cloud and livery injections below
  // rather than replacing them.
  const mat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  mat.shadowSide = BackSide;
  const tint = livery ? new Color(...livery) : null;
  const snowColour = new Color(...to);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = SNOW_UNIFORM;
    shader.uniforms.uSnowTake = { value: takes };
    shader.uniforms.uSnowColour = { value: snowColour };
    shader.uniforms.uCloud = CLOUD_AMOUNT;
    shader.uniforms.uDrift = CLOUD_DRIFT;
    let vs = `attribute float snowTake;
uniform float uSnow;
uniform float uSnowTake;
uniform vec3 uSnowColour;
varying vec3 vSkyPos;
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
    /*
     * World position out to the fragment shader, instancing included.
     *
     * `transformed` is the vertex before the instance matrix is applied, so a
     * naive `modelMatrix * transformed` gives every tree in a wood the same
     * world position — and therefore the same cloud shadow, which is the one
     * mistake here that would be invisible in a still and glaring in motion.
     */
    vs = vs.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
#ifdef USE_INSTANCING
	vSkyPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
#else
	vSkyPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif`,
    );

    /*
     * Cloud shadow, in the fragment shader.
     *
     * Three sine layers at incommensurable frequencies — not a texture, because
     * a texture is a fetch and a download and this is two dozen instructions.
     * At these wavelengths (twenty to eighty tiles) it reads as broken cloud
     * rather than as a pattern, and the eye cannot find the repeat because the
     * three periods do not share one.
     *
     * It darkens rather than tinting: a cloud shadow is the sun being *absent*,
     * so the right operation is a multiply toward the ambient, and a shaded field
     * should still be a green field. Capped at a third, because full shadow on a
     * pastel palette looks like a bruise.
     */
    shader.fragmentShader = `uniform float uCloud;
uniform vec2 uDrift;
varying vec3 vSkyPos;

float cloudAt( vec2 p ) {
	float a = sin( p.x * 0.047 + p.y * 0.029 );
	float b = sin( p.x * 0.019 - p.y * 0.041 + 1.7 );
	float c = sin( ( p.x + p.y ) * 0.011 + 3.1 );
	return a * 0.46 + b * 0.34 + c * 0.20;
}
${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
	float cloud = smoothstep( 0.02, 0.62, cloudAt( vSkyPos.xz + uDrift ) );
	diffuseColor.rgb *= 1.0 - cloud * uCloud * 0.34;`,
    );

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
	// Capped at 0.9, and the cap matters more than the colour. Mixing all the
	// way to one flat white erased every fold in the ground and every crop row
	// with it: a field in January became a blank sheet, and a district of blank
	// sheets has no relief at all. Leaving a tenth of the summer colour showing
	// keeps the striping and the parcel boundaries faintly legible under the
	// snow, which is both what snow looks like and what makes the shadows read.
	vColor = mix( vColor, uSnowColour, clamp( uSnow * uSnowTake * snowTake * upness, 0.0, 0.9 ) );
	// And the faces that get no snow still get the winter.
	//
	// Snow lands on horizontal faces only, which is right and which left every
	// hedge in the district standing in a foot of snow in full July green -
	// bright, saturated, and the loudest thing in a frame that is otherwise
	// white. A hedge in January is brown-grey. So vertical faces desaturate
	// toward a dead winter brown instead of whitening: the same season, applied
	// the way each surface would actually take it.
	float winter = uSnow * ( 1.0 - upness ) * 0.62;
	float lum = dot( vColor, vec3( 0.299, 0.587, 0.114 ) );
	vColor = mix( vColor, mix( vec3( lum ), vec3( 0.34, 0.30, 0.26 ), 0.40 ), winter );`,
    );
  };
  return stylise(mat);
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
 * Weather, which is three numbers and the best value for money in the file.
 *
 * The district was correct and inert: a fixed sun, a fixed sky, and nothing
 * between the two. What was missing is not a rain system, it is *movement in the
 * light* — the thing that makes even a cloudless afternoon feel like weather
 * rather than a diagram. Cloud shadow drifting over a valley is that, and it
 * costs a varying and nine lines of arithmetic.
 *
 * `amount` is how overcast it is, which drifts over game-hours. `drift` is where
 * the clouds have got to, which moves continuously. `wind` sets the direction,
 * fixed for a district so the shadows always come from the same quarter — clouds
 * that changed direction would read as a bug in a way that a slow change in
 * coverage does not.
 */
const CLOUD_AMOUNT = { value: 0.5 };
const CLOUD_DRIFT = { value: [0, 0] as [number, number] };

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
