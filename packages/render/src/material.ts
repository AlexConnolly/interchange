/**
 * One material for the whole world.
 *
 * Flat shading, vertex colours, a single emissive channel, and height fog —
 * and nothing else. art-direction.md §3 rules out the alternatives one at a
 * time: no PBR (invisible at 1x, a different game at 12x), no ink outlines
 * (twenty thousand outlined vehicles is noise, not style), no textures (there
 * is no texture budget; detail is geometry or it does not exist).
 *
 * The emissive channel is the interesting one. Every object gets three tonal
 * values and exactly one accent, and the accent is the *only* emissive
 * surface. That is what keeps a world readable at dusk, in fog, and under
 * snow, where the shading flattens and tonal separation stops working —
 * §13's "night is a mood, never a readability tax" is this one float.
 */

import { ShaderMaterial, Color, DoubleSide, type IUniform } from 'three';

export interface WorldLighting {
  /** Direction the key light travels, normalised, in world space. */
  sun: [number, number, number];
  sunColour: Color;
  skyColour: Color;
  groundColour: Color;
  fogColour: Color;
  fogDensity: number;
  /** 0 at noon, 1 at midnight. Drives how much the emissive accents carry. */
  night: number;
}

const VERT = /* glsl */ `
  attribute vec3 color;
  attribute float emit;

  varying vec3 vColour;
  varying vec3 vNormal;
  varying float vEmit;
  varying float vDepth;
  varying float vHeight;

  void main() {
    vColour = color;
    vEmit = emit;

    #ifdef USE_INSTANCING
      // Livery tinting happens here: the instance colour multiplies the
      // material's own, so one lorry mesh serves every company (§10).
      #ifdef USE_INSTANCING_COLOR
        vColour *= instanceColor;
      #endif
      vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    #else
      vec4 world = modelMatrix * vec4(position, 1.0);
      vNormal = normalize(mat3(modelMatrix) * normal);
    #endif

    vHeight = world.y;
    vec4 view = viewMatrix * world;
    vDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uSun;
  uniform vec3 uSunColour;
  uniform vec3 uSkyColour;
  uniform vec3 uGroundColour;
  uniform vec3 uFogColour;
  uniform float uFogDensity;
  uniform float uDepthRef;
  uniform float uNight;
  uniform float uSelected;
  uniform vec3 uSelectColour;

  varying vec3 vColour;
  varying vec3 vNormal;
  varying float vEmit;
  varying float vDepth;
  varying float vHeight;

  void main() {
    vec3 n = normalize(vNormal);

    // Key light, then a hemisphere fill. Two terms is enough: the facets do
    // the describing, and any more lighting starts competing with the palette
    // for the job of telling you what something is.
    float key = max(dot(n, -uSun), 0.0);
    float fill = n.y * 0.5 + 0.5;
    vec3 ambient = mix(uGroundColour, uSkyColour, fill);

    vec3 lit = vColour * (ambient + uSunColour * key);

    // The accent. At night it is most of what you can see, which is the point.
    lit = mix(lit, vColour, vEmit * (0.35 + 0.65 * uNight));
    lit += vColour * vEmit * uNight * 0.9;

    // Aerial perspective, measured from the focal plane rather than from the
    // camera. Under an orthographic projection the camera sits at an arbitrary
    // distance — a thousand units back, because it has to be behind
    // everything — so raw view depth is a large constant plus a small signal,
    // and fogging on it turns the entire world into one flat wash. What
    // matters is how far a thing is *beyond the middle of the view*.
    float relative = max(0.0, vDepth - uDepthRef);
    float fog = 1.0 - exp(-uFogDensity * relative * (1.0 - clamp(vHeight * 0.03, 0.0, 0.7)));
    // Capped low: weather and distance are atmosphere only and must never
    // obscure information the player needs to act on (§13).
    lit = mix(lit, uFogColour, clamp(fog, 0.0, 0.26));

    lit = mix(lit, uSelectColour, uSelected * 0.45);

    // Linear to sRGB. Three does this for its own materials and cannot do it
    // for a custom one, so it has to happen here — without it every colour in
    // the game renders about two stops darker than it was authored.
    vec3 srgb = mix(lit * 12.92, 1.055 * pow(max(lit, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
                    step(vec3(0.0031308), lit));
    gl_FragColor = vec4(srgb, 1.0);
  }
`;

export function createWorldMaterial(): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {
    uSun: { value: [0.45, -0.72, 0.53] },
    uSunColour: { value: new Color(1.0, 0.94, 0.84) },
    uSkyColour: { value: new Color(0.36, 0.40, 0.46) },
    uGroundColour: { value: new Color(0.16, 0.16, 0.17) },
    uFogColour: { value: new Color(0.66, 0.73, 0.80) },
    uFogDensity: { value: 0.0016 },
    uDepthRef: { value: 1200 },
    uNight: { value: 0 },
    uSelected: { value: 0 },
    uSelectColour: { value: new Color(0.95, 0.94, 0.88) },
  };
  const m = new ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    // Backfaces show through open geometry — a wheel arch, a shed with no far
    // wall — and culling them is a real saving at this instance count.
    side: DoubleSide,
  });
  m.defines = { USE_INSTANCING_COLOR: '' };
  return m;
}

/**
 * The day/night cycle, on the game calendar.
 *
 * `t` runs 0..1 through one day. The hard floor on legibility is that the
 * ambient term never drops below a level where a facet still reads; night is
 * carried by lit windows, headlights and emissive accents, not by making the
 * player squint.
 */
/** An empty lighting record to write into, so the day/night cycle can run
 *  every frame without allocating. */
export function makeLighting(): WorldLighting {
  return {
    sun: [0, -1, 0],
    sunColour: new Color(),
    skyColour: new Color(),
    groundColour: new Color(),
    fogColour: new Color(),
    fogDensity: 0.0022,
    night: 0,
  };
}

export function lightingForTime(t: number, season: number, into?: WorldLighting): WorldLighting {
  const angle = (t - 0.25) * Math.PI * 2;
  const elevation = Math.sin(angle);
  // Night tops out at 0.78, not 1. §13's floor on legibility is a real
  // constraint, not a preference: a world you cannot read for a third of every
  // game day is a world where a third of the player's attention is spent
  // waiting rather than deciding.
  const night = Math.max(0, Math.min(0.78, -elevation * 2.0 + 0.2));
  const dusk = Math.max(0, 1 - Math.abs(elevation) * 4);

  const sunStrength = Math.max(0.16, elevation) * 0.95;
  const warm = 1 - Math.max(0, elevation) * 0.35;

  const out = into ?? makeLighting();
  out.sunColour.setRGB(
    0.55 + 0.5 * warm,
    0.52 + 0.36 * warm - dusk * 0.10,
    0.50 + 0.22 * warm - dusk * 0.24,
  ).multiplyScalar(sunStrength);

  // Winter cools and desaturates the sky; summer warms it.
  const seasonWarm = [0.02, 0.06, 0.04, -0.04][season & 3];
  out.skyColour.setRGB(
    0.30 + 0.22 * (1 - night) + seasonWarm,
    0.34 + 0.24 * (1 - night),
    0.42 + 0.26 * (1 - night) - seasonWarm,
  ).multiplyScalar(0.30 + 0.16 * (1 - night));

  out.fogColour.setRGB(
    0.10 + 0.58 * (1 - night),
    0.13 + 0.60 * (1 - night),
    0.19 + 0.62 * (1 - night),
  );
  out.groundColour.setRGB(0.09, 0.09, 0.11).multiplyScalar(0.6 + 0.4 * (1 - night));
  out.sun[0] = Math.cos(angle * 0.5 + 0.9) * 0.6;
  out.sun[1] = -Math.max(0.25, elevation);
  out.sun[2] = Math.sin(angle * 0.5 + 0.9) * 0.6;
  out.fogDensity = 0.0022;
  out.night = night;
  return out;
}

export function applyLighting(m: ShaderMaterial, l: WorldLighting, depthRef = 1200): void {
  m.uniforms.uDepthRef.value = depthRef;
  const u = m.uniforms;
  const len = Math.hypot(l.sun[0], l.sun[1], l.sun[2]) || 1;
  // Written into the existing array rather than replacing it: this runs every
  // frame and a fresh three-element array per frame is exactly the kind of
  // small allocation that adds up to a stall.
  const sun = u.uSun.value as number[];
  sun[0] = l.sun[0] / len;
  sun[1] = l.sun[1] / len;
  sun[2] = l.sun[2] / len;
  (u.uSunColour.value as Color).copy(l.sunColour);
  (u.uSkyColour.value as Color).copy(l.skyColour);
  (u.uGroundColour.value as Color).copy(l.groundColour);
  (u.uFogColour.value as Color).copy(l.fogColour);
  u.uFogDensity.value = l.fogDensity;
  u.uNight.value = l.night;
}
