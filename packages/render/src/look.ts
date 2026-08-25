/**
 * Art direction: the light rig, the air, and the post chain.
 *
 * Ported from the Tribewars renderer, which had solved a problem this one had
 * not even framed. Interchange's *direct* light has been carefully worked on —
 * a continuous sun through a full day, a hemisphere fill, real shadows — and it
 * still looked flatter than a game with a tenth of the effort, because almost
 * everything that makes a rendered scene look like a photograph happens
 * somewhere other than the direct term. Five things were missing, in order of
 * how much they matter:
 *
 *  1. **Temperature contrast.** One warm key and everything else cool. A
 *     single-temperature scene reads flat however many colours are in it, and
 *     Interchange's sun and fill were both broadly warm. There is now a cool
 *     directional fill opposite the sun, and a per-fragment hue ramp that warms
 *     faces turning toward the light and cools faces turning away.
 *  2. **Split toning.** Shadows drift cool, highlights drift warm, in the grade
 *     rather than in the lighting. The shadow end is *added*, not multiplied,
 *     because multiplying leaves black black and a shadow with no colour in it
 *     is a hole rather than a shadow.
 *  3. **Aerial perspective.** Distance fades toward the sky, so the far side of
 *     the district sits behind the near side instead of beside it.
 *  4. **Bloom.** Not to haze the frame — to make lamps, lit windows, cat's eyes
 *     and headlamps *glow*. Nothing in a daylit frame is brighter than the sky,
 *     so nothing in a daylit frame blooms, and that is the correct behaviour
 *     rather than a limitation: the effect appears exactly at dusk, on its own.
 *  5. **Focal hierarchy.** A vignette and a gentle tilt-shift, which say "toy
 *     world seen from above" more directly than any amount of modelling can.
 *
 * The one thing deliberately not ported is ambient occlusion. Tribewars keeps a
 * `GTAOPass` off by default and describes it as the expensive candidate; on a
 * district of low-poly boxes with almost no creases it would buy a dark line
 * under each hedge for a whole extra depth-and-normal pass over the scene.
 *
 * The adaptation that is not a port is the **mood table**. Tribewars is fixed at
 * a late golden afternoon and can therefore hard-code its palette. Interchange
 * runs a full day in four minutes, so every one of these values has to be a
 * function of the hour — and getting that continuous is the same problem the
 * sun's own colour had, with the same answer: interpolate, never switch.
 */

import {
  Color, Fog, PerspectiveCamera, Points, PointsMaterial, AdditiveBlending,
  BufferAttribute, BufferGeometry, DirectionalLight, Material, Matrix4,
  Scene as ThreeScene, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
  HalfFloatType, Camera,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ------------------------------------------------------------------ the mood

/** Everything about the look that changes with the hour. */
export interface Mood {
  /** Where shadows drift. Added, scaled by how dark the pixel is. */
  lift: [number, number, number];
  /** Where highlights drift. Multiplied, scaled by how bright the pixel is. */
  gain: [number, number, number];
  saturation: number;
  contrast: number;
  vignette: number;
  /** The colour distance fades toward. */
  haze: [number, number, number];
  /**
   * How much haze there is at the *back edge of the frame*, 0..1.
   *
   * Expressed this way round because it is the only version of the number that
   * can be reasoned about. A fog `far` plane is meaningless on its own here —
   * see `aimFog` — whereas "the far hedge is a sixth of the way to the colour of
   * the sky" is a statement about the picture, and small figures are correct: an
   * orthographic camera looking down at a district spans about eleven world
   * units of depth, so there is genuinely not much air to look through.
   */
  hazeAtBack: number;
  /** Sun shafts and directional warming, 0..1. */
  scatter: number;
  /** How much of the hue ramp to apply. Highest when the sun is low. */
  ramp: number;
  bloom: number;
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

/**
 * Noon. The hardest hour to make look like anything.
 *
 * A near-white key overhead unifies nothing, which is why every game's
 * screenshots are taken in the afternoon. The grade has to do the work the sun
 * is refusing to: a cool lift into the shadows, a warm gain on the highlights,
 * and a little more saturation than the palette was authored with.
 */
const NOON: Mood = {
  lift: rgb('#0e2130'),
  gain: rgb('#fff4dc'),
  saturation: 1.07,
  contrast: 1.045,
  vignette: 0.30,
  haze: rgb('#c2d6e6'),
  hazeAtBack: 0.10,
  scatter: 0.30,
  ramp: 0.35,
  bloom: 0.24,
};

/**
 * Low sun, either end of the day. The hour everything looks good in, and the
 * reason is worth stating: a coloured key and coloured air collapse every
 * material in the scene onto a narrow range of hues, and a narrow hue range
 * reads as a *photograph* rather than as a set of objects that happen to be
 * near each other.
 */
const GOLDEN: Mood = {
  lift: rgb('#231a2c'),
  gain: rgb('#ffdcaa'),
  saturation: 1.16,
  contrast: 1.07,
  vignette: 0.40,
  haze: rgb('#e8bb96'),
  hazeAtBack: 0.19,
  scatter: 1.0,
  ramp: 0.85,
  bloom: 0.42,
};

/**
 * Night. Cooler, more contrast, less saturation, and the most bloom.
 *
 * Bloom peaks here for the same reason it is invisible at noon: there is no tone
 * mapping in this renderer, so a lamp only exceeds the bloom threshold when the
 * rest of the frame has dropped well below it. Turning it up after dark is not
 * compensating for anything — it is the one hour the effect has anything to act
 * on, and the lit windows and cat's eyes are what the whole night palette is
 * built around.
 */
const NIGHT_MOOD: Mood = {
  lift: rgb('#0a1526'),
  gain: rgb('#c4d8ff'),
  saturation: 0.90,
  contrast: 1.13,
  vignette: 0.50,
  haze: rgb('#1b2c44'),
  hazeAtBack: 0.13,
  scatter: 0.0,
  ramp: 0.55,
  bloom: 0.70,
};

const mixTriple = (
  a: [number, number, number], b: [number, number, number], k: number,
): [number, number, number] => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * The mood at a given moment, from how high the sun is and how dark it is.
 *
 * `lit` is the sun's height, 0 at the horizon and 1 overhead; `night` is the
 * renderer's own darkness term. Two interpolations rather than one, because the
 * golden hour is not halfway between noon and night — it is its own thing that
 * happens while the sun is low and it is still light.
 */
export function moodAt(lit: number, night: number): Mood {
  const high = Math.max(0, Math.min(1, (lit - 0.18) / 0.62));
  const day = {
    lift: mixTriple(GOLDEN.lift, NOON.lift, high),
    gain: mixTriple(GOLDEN.gain, NOON.gain, high),
    saturation: mix(GOLDEN.saturation, NOON.saturation, high),
    contrast: mix(GOLDEN.contrast, NOON.contrast, high),
    vignette: mix(GOLDEN.vignette, NOON.vignette, high),
    haze: mixTriple(GOLDEN.haze, NOON.haze, high),
    hazeAtBack: mix(GOLDEN.hazeAtBack, NOON.hazeAtBack, high),
    scatter: mix(GOLDEN.scatter, NOON.scatter, high),
    ramp: mix(GOLDEN.ramp, NOON.ramp, high),
    bloom: mix(GOLDEN.bloom, NOON.bloom, high),
  };
  const n = Math.max(0, Math.min(1, night));
  return {
    lift: mixTriple(day.lift, NIGHT_MOOD.lift, n),
    gain: mixTriple(day.gain, NIGHT_MOOD.gain, n),
    saturation: mix(day.saturation, NIGHT_MOOD.saturation, n),
    contrast: mix(day.contrast, NIGHT_MOOD.contrast, n),
    vignette: mix(day.vignette, NIGHT_MOOD.vignette, n),
    haze: mixTriple(day.haze, NIGHT_MOOD.haze, n),
    hazeAtBack: mix(day.hazeAtBack, NIGHT_MOOD.hazeAtBack, n),
    scatter: mix(day.scatter, NIGHT_MOOD.scatter, n),
    ramp: mix(day.ramp, NIGHT_MOOD.ramp, n),
    bloom: mix(day.bloom, NIGHT_MOOD.bloom, n),
  };
}

// ------------------------------------------------- hue ramp and wrapped fill

/**
 * Two stylised shading terms bolted onto the Lambert materials.
 *
 * One set of uniforms shared by every patched material, so a single write moves
 * the whole district rather than a list of materials.
 *
 * `warm` and `cool` are *multipliers* either side of a luminance of one, not
 * colours: turning the ramp up has to shift hue without also changing exposure,
 * or every tuning session turns into a fight between the two.
 */
export const LOOK = {
  ramp: { value: 0 },
  warm: { value: new Vector3(1.10, 1.00, 0.85) },
  cool: { value: new Vector3(0.87, 0.96, 1.15) },
  /**
   * How much of the fill comes from a wrapped term rather than the directional
   * one. `(N·L * 0.5 + 0.5)` squared — Valve's half-Lambert, openly
   * non-physical, and it exists to stop the side facing away from the light
   * losing its shape. It is the renderer's version of what a photographer does
   * at noon with a silk overhead: turn one hard source into a broad soft one.
   */
  wrap: { value: 0 },
  wrapTint: { value: new Vector3(0.74, 0.83, 0.98) },
  wrapGain: { value: 0.62 },
  /**
   * Which way the two lights are, **in view space**.
   *
   * `normal` is in view space at the hook, so converting the two light
   * directions once a frame on the CPU is far cheaper than converting the normal
   * per fragment — and there are a lot more fragments than frames.
   */
  sun: { value: new Vector3(0, 1, 0) },
  fill: { value: new Vector3(0, 1, 0) },
};

const SHADE_HEAD = /* glsl */`
uniform float uRamp;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uWrap;
uniform vec3 uWrapTint;
uniform float uWrapGain;
uniform vec3 uSunView;
uniform vec3 uFillView;
`;

/*
 * Hooked in before `opaque_fragment`, which is after the lighting has been
 * accumulated and before tone mapping, colour space and fog. The more obvious
 * `dithering_fragment` is too late: it would tint the fog along with the
 * surface, and the fog is the one thing in the frame that must stay the colour
 * of the air.
 */
const SHADE_BODY = /* glsl */`
{
  if (uRamp > 0.0) {
    // Half-and-half rather than clamped at zero, so the shaded side keeps
    // shifting hue instead of flattening to one colour the moment it turns away.
    float litFace = dot(normal, uSunView) * 0.5 + 0.5;
    vec3 tint = mix(uCool, uWarm, clamp(litFace, 0.0, 1.0));
    outgoingLight *= mix(vec3(1.0), tint, uRamp);
  }
  if (uWrap > 0.0) {
    float f = clamp(dot(normal, uFillView) * 0.5 + 0.5, 0.0, 1.0);
    outgoingLight += diffuseColor.rgb * uWrapTint * (f * f) * uWrapGain * uWrap;
  }
}
`;

/**
 * Patch a material so it reads `LOOK`.
 *
 * Safe on a material that already has an `onBeforeCompile` — and it has to be,
 * because every lit material in this renderer already carries snow, cloud
 * shadow and livery injections. The existing hook still runs first.
 */
export function stylise<T extends Material>(mat: T): T {
  const m = mat as Material & {
    onBeforeCompile: Material['onBeforeCompile'];
    customProgramCacheKey?: () => string;
  };
  const already = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer): void => {
    already?.call(m, shader, renderer);
    Object.assign(shader.uniforms, {
      uRamp: LOOK.ramp, uWarm: LOOK.warm, uCool: LOOK.cool,
      uWrap: LOOK.wrap, uWrapTint: LOOK.wrapTint, uWrapGain: LOOK.wrapGain,
      uSunView: LOOK.sun, uFillView: LOOK.fill,
    });
    shader.fragmentShader = SHADE_HEAD + shader.fragmentShader.replace(
      '#include <opaque_fragment>', `${SHADE_BODY}\n#include <opaque_fragment>`,
    );
  };
  /*
   * A distinct cache key, or three shares one compiled program between patched
   * and unpatched materials and whichever compiled first wins for both. This is
   * the bug that makes half the scene silently ignore the effect.
   */
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = (): string => `${key ? key.call(m) : ''}|stylise`;
  mat.needsUpdate = true;
  return mat;
}

const shadeDir = new Vector3();
const shadeView = new Matrix4();

/** Put both light directions into view space. Once a frame, before rendering. */
export function aimShade(
  camera: Camera, sun: DirectionalLight, fill: DirectionalLight,
): void {
  camera.updateMatrixWorld();
  shadeView.copy(camera.matrixWorld).invert();
  // Towards the light, which is what a dot against the normal wants.
  shadeDir.copy(sun.position).sub(sun.target.position).normalize()
    .transformDirection(shadeView);
  LOOK.sun.value.copy(shadeDir);
  shadeDir.copy(fill.position).normalize().transformDirection(shadeView);
  LOOK.fill.value.copy(shadeDir);
}

// ------------------------------------------------------------------ the grade

/**
 * Colour grade, vignette and tilt-shift in a single pass.
 *
 * One shader because all three want to happen after bloom and before output,
 * and three separate full-screen passes to do it would be three needless blits.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new Vector2(1 / 1920, 1 / 1080) },
    uVignette: { value: 0.34 },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.05 },
    uLift: { value: new Color(0.05, 0.13, 0.19) },
    uGain: { value: new Color(1.0, 0.95, 0.86) },
    /** Max blur radius in pixels at the frame edge. */
    uTilt: { value: 1.0 },
    /** The screen y the eye is meant to rest on. */
    uFocus: { value: 0.54 },
    /** How much of the frame stays sharp. */
    uBand: { value: 0.34 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uVignette, uSaturation, uContrast, uTilt, uFocus, uBand;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;

    void main() {
      // Tilt-shift: sharp through a horizontal band, softening away from it.
      float defocus = clamp((abs(vUv.y - uFocus) - uBand) / (1.0 - uBand), 0.0, 1.0);
      float r = defocus * defocus * uTilt;
      vec3 col;
      if (r < 0.05) {
        col = texture2D(tDiffuse, vUv).rgb;
      } else {
        vec2 o = uTexel * r;
        col  = texture2D(tDiffuse, vUv).rgb * 0.25;
        col += texture2D(tDiffuse, vUv + vec2( o.x,  0.0)).rgb * 0.125;
        col += texture2D(tDiffuse, vUv + vec2(-o.x,  0.0)).rgb * 0.125;
        col += texture2D(tDiffuse, vUv + vec2( 0.0,  o.y)).rgb * 0.125;
        col += texture2D(tDiffuse, vUv + vec2( 0.0, -o.y)).rgb * 0.125;
        col += texture2D(tDiffuse, vUv + o).rgb * 0.0875;
        col += texture2D(tDiffuse, vUv - o).rgb * 0.0875;
        col += texture2D(tDiffuse, vUv + vec2( o.x, -o.y)).rgb * 0.0875;
        col += texture2D(tDiffuse, vUv + vec2(-o.x,  o.y)).rgb * 0.0875;
      }

      // Split tone. The shadow end is added, not multiplied: multiplying leaves
      // black black, and a shadow with no colour in it is just a hole.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += uLift * (1.0 - smoothstep(0.0, 0.5, luma));
      col *= mix(vec3(1.0), uGain, smoothstep(0.08, 0.7, luma));

      col = (col - 0.5) * uContrast + 0.5;
      luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // Vignette, measured on a corrected aspect so it stays circular.
      vec2 v = (vUv - 0.5) * vec2(1.0, 0.62);
      col *= 1.0 - uVignette * dot(v, v) * 2.6;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

/**
 * Directional scattering: haze that warms toward the sun, and shafts.
 *
 * Screen space, driven by things that are actually in the world. The sun's world
 * position is projected every frame, so the warm side of the air and the shafts
 * radiate from where the light really is — which means turning the camera swings
 * them the way air does rather than dragging them along with the frame. That is
 * the whole difference between atmosphere and a filter laid over the picture.
 *
 * Distance is *not* done here. The scene's own fog already does that correctly,
 * in world space; what was missing was only the directional half.
 */
const ScatterShader = {
  uniforms: {
    tDiffuse: { value: null },
    /** The real sun, projected to screen space. */
    uSun: { value: new Vector2(0.5, 0.8) },
    /** 0 when it is behind the camera. */
    uSunVisible: { value: 0 },
    uAmount: { value: 0.5 },
    uSunColor: { value: new Color(1, 0.94, 0.82) },
    uHazeColor: { value: new Color(0.85, 0.88, 0.9) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uSunVisible, uAmount;
    uniform vec3 uSunColor, uHazeColor;
    varying vec2 vUv;

    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 col = src.rgb;
      if (uAmount <= 0.0 || uSunVisible <= 0.0) {
        gl_FragColor = src;
        return;
      }

      // Warm the air toward where the sun actually is: the side of the valley
      // facing the light reads warm, the side away from it reads cold.
      float toSun = 1.0 - clamp(length((vUv - uSun) * vec2(1.0, 0.75)), 0.0, 1.0);
      col = mix(col, uHazeColor, (1.0 - toSun) * 0.05 * uAmount);
      col += uSunColor * pow(toSun, 4.0) * 0.06 * uAmount * uSunVisible;

      // Shafts, marched toward the projected sun and sourced from the bright
      // parts of the frame, so they stream off lit roofs and off the water
      // rather than being drawn on top of everything.
      vec2 delta = (uSun - vUv) * 0.10;
      vec2 uv = vUv;
      float w = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        uv += delta * 0.125;
        vec3 t = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float lum = dot(t, vec3(0.2126, 0.7152, 0.0722));
        // A high threshold, and it is the difference between shafts and a smear.
        // At 0.62 a pale field in sunlight qualified as a light source, so the
        // whole sunward half of the frame accumulated into one yellow blur. Only
        // things that are genuinely near white — a lit window, sun off water,
        // snow — should be throwing light through the air.
        acc += t * smoothstep(0.88, 1.0, lum) * w;
        w *= 0.90;
      }
      acc /= 8.0;
      col += acc * uSunColor * pow(toSun, 2.0) * 0.55 * uAmount * uSunVisible;

      gl_FragColor = vec4(col, src.a);
    }`,
};

export interface Composed {
  render(): void;
  setSize(w: number, h: number): void;
  /** Push a mood into the grade, the bloom and the scatter. Once a frame. */
  apply(mood: Mood): void;
  /** Point the scatter at the real sun. Once a frame, after the camera moves. */
  aim(sun: DirectionalLight, camera: Camera): void;
  dispose(): void;
}

/**
 * Build the post chain.
 *
 * The multisampled target is explicit and that matters more than it looks.
 * `new WebGLRenderer({ antialias: true })` only ever applied to the default
 * framebuffer, and the moment anything renders through a composer it stops going
 * there — `EffectComposer` makes its own target, and the default one has no
 * samples. So adding post-processing without this line would silently un-antialias
 * every edge in the game while the flag sat there looking correct. Four samples
 * is the sweet spot; eight is not visibly better on a low-poly scene and costs
 * real bandwidth.
 */
export function buildComposer(
  renderer: WebGLRenderer, scene: ThreeScene, camera: Camera, w: number, h: number,
): Composed {
  const half = (n: number): number => Math.max(1, Math.round(n / 2));
  const target = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));

  const scatter = new ShaderPass(ScatterShader);
  composer.addPass(scatter);

  /*
   * Tight and low, at half resolution.
   *
   * Bloom is here to make lamps and lit windows glow, not to haze the frame. The
   * whole pass is a chain of blurs and there is nothing in a blur that needs
   * full-rate pixels — a highpass plus five mip levels blurred twice each, for
   * an effect whose output is by construction too soft to show the difference.
   */
  const bloom = new UnrealBloomPass(new Vector2(half(w), half(h)), 0.4, 0.55, 0.7);
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uTexel.value.set(1 / w, 1 / h);
  composer.addPass(grade);

  composer.addPass(new OutputPass());

  const sunWorld = new Vector3();
  const projected = new Vector3();
  const forward = new Vector3();
  const toSun = new Vector3();

  return {
    render(): void {
      composer.render();
    },
    setSize(width: number, height: number): void {
      composer.setSize(width, height);
      // Half, to match how it was built. Passing the full size here on resize
      // would quietly undo that.
      bloom.setSize(half(width), half(height));
      grade.uniforms.uTexel.value.set(1 / width, 1 / height);
    },
    apply(mood: Mood): void {
      const u = grade.uniforms;
      u.uLift.value.setRGB(mood.lift[0], mood.lift[1], mood.lift[2]);
      u.uGain.value.setRGB(mood.gain[0], mood.gain[1], mood.gain[2]);
      u.uSaturation.value = mood.saturation;
      u.uContrast.value = mood.contrast;
      u.uVignette.value = mood.vignette;
      bloom.strength = mood.bloom;
      scatter.uniforms.uAmount.value = mood.scatter;
      scatter.uniforms.uHazeColor.value.setRGB(
        mood.haze[0], mood.haze[1], mood.haze[2],
      );
    },
    aim(sun: DirectionalLight, camera: Camera): void {
      sunWorld.copy(sun.position);
      projected.copy(sunWorld).project(
        camera as PerspectiveCamera,
      );
      /*
       * Behind the camera the projection folds back through infinity, and a NaN
       * here silently poisons every pixel the pass touches — a whole-screen
       * black frame from one bad divide.
       */
      const sx = (projected.x + 1) / 2;
      const sy = (projected.y + 1) / 2;
      if (Number.isFinite(sx) && Number.isFinite(sy)) {
        scatter.uniforms.uSun.value.set(sx, sy);
      }
      toSun.copy(sunWorld).sub(camera.position).normalize();
      camera.getWorldDirection(forward);
      const facing = toSun.dot(forward);
      scatter.uniforms.uSunVisible.value = Math.max(0, Math.min(1, (facing + 0.15) * 2.2));
      scatter.uniforms.uSunColor.value.copy(sun.color);
    },
    dispose(): void {
      composer.dispose();
      target.dispose();
    },
  };
}

// ----------------------------------------------------------------- the air

export interface Motes {
  points: Points;
  update(dt: number, time: number, x: number, z: number, level: number): void;
}

/**
 * Pollen and dust hanging in the light.
 *
 * The cheapest thing in the whole scene that makes the air feel occupied rather
 * than empty, and it is nearly free: four hundred points, one additive draw.
 *
 * They hold still in the world and are only recycled once they are far enough
 * behind you to be out of sight. Re-centring the whole field on the camera every
 * frame — the obvious implementation — makes the specks track the view exactly,
 * and the air then reads as dirt on the lens rather than as something the camera
 * is moving through.
 */
export function makeMotes(count = 380, spread = 46): Motes {
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = Math.random() * spread;
    pos[i * 3 + 1] = Math.random() * 7 + 0.4;
    pos[i * 3 + 2] = Math.random() * spread;
    phase[i] = Math.random() * Math.PI * 2;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  const mat = new PointsMaterial({
    color: new Color(1.0, 0.92, 0.74),
    size: 0.05,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;

  return {
    points,
    update(dt: number, time: number, x: number, z: number, level: number): void {
      mat.opacity = level * 0.5;
      points.visible = level > 0.01;
      if (!points.visible) return;
      const a = geo.attributes.position.array as Float32Array;
      const halfSpan = spread / 2;
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        a[j] += Math.sin(time * 0.35 + phase[i]) * dt * 0.5;
        a[j + 1] += Math.sin(time * 0.5 + phase[i] * 1.7) * dt * 0.22;
        a[j + 2] += Math.cos(time * 0.28 + phase[i] * 0.8) * dt * 0.42;
        // Absolute world coordinates, so panning genuinely slides past them.
        const dx = a[j] - x;
        const dz = a[j + 2] - z;
        if (dx > halfSpan) a[j] -= spread;
        else if (dx < -halfSpan) a[j] += spread;
        if (dz > halfSpan) a[j + 2] -= spread;
        else if (dz < -halfSpan) a[j + 2] += spread;
        if (a[j + 1] > 8) a[j + 1] = 0.4;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

/**
 * Aerial perspective, as linear fog rather than exponential.
 *
 * `FogExp2` is the right choice for a perspective camera and the wrong one here.
 * This camera is **orthographic**, sitting a fixed hundred and twenty units back
 * from whatever it is looking at, so every pixel in the frame is at roughly the
 * same distance from it — and an exponential fog keyed on absolute distance
 * would put the same flat wash over the near hedge and the far hill alike. That
 * is the trap: it looks like the effect is working and it is doing nothing at
 * all except reducing contrast.
 *
 * Linear fog with near and far pinned *around* the camera distance grades across
 * the depth the frame actually spans, and because the spread scales with the
 * zoom it keeps working from a fourteen-tile close-up to a seventy-tile survey.
 */
const hazeColour = new Color();

export function makeFog(): Fog {
  return new Fog(new Color(0.76, 0.84, 0.9), 100, 260);
}

export function aimFog(
  fog: Fog, camDistance: number, halfDepth: number, mood: Mood, sky: Color,
): void {
  /*
   * Distance fades toward the sky, warmed toward the haze.
   *
   * Mostly the sky, because that is what aerial perspective *is* — the far hill
   * is pale because you are looking through more air at the same sky that is
   * behind it, and a fog colour that disagrees with the sky reads as a grey
   * curtain hung across the district. The haze is the directional half: a low
   * sun puts gold in the air, and the mood table already knows how much.
   */
  fog.color.copy(sky).lerp(
    hazeColour.setRGB(mood.haze[0], mood.haze[1], mood.haze[2]), 0.45,
  );
  /*
   * Near at the front edge of the frame, far a long way past the back of it.
   *
   * The first attempt set these to the camera distance plus and minus a share of
   * the zoom, and put a flat twenty-two per cent wash over the entire picture —
   * which is precisely the trap described above, arrived at by ignoring it. The
   * whole frame sits at almost the same distance, so if `near` is anywhere
   * *inside* that range then every pixel is fogged and the effect is a haze
   * filter rather than depth.
   *
   * So `near` is pinned to the nearest ground in shot, which guarantees the
   * bottom of the frame is perfectly clear, and `far` is solved backwards from
   * how much haze the back edge is supposed to have. A gradient from nothing to
   * a sixth, across a frame — which is what aerial perspective actually looks
   * like over half a mile of English farmland, and is the difference between the
   * far hill sitting behind the near one and merely being above it.
   */
  const front = camDistance - halfDepth;
  const back = camDistance + halfDepth;
  fog.near = front;
  fog.far = front + (back - front) / Math.max(0.02, mood.hazeAtBack);
}
