/**
 * Cloud, seen from above, and only when you are high enough to be in it.
 *
 * "As you zoom out, it starts to cover the world until you can almost not see
 * it? Would look so nice? But just a little 'zoom beauty' kind of thing? So it
 * goes away if you're not at the right zoom?" — which is a precise brief, and
 * the precision is in the last clause. This is not weather and it is not a
 * layer the district has; it is what the district looks like from further away,
 * and at the zoom you actually play at it must not exist at all. A cloud over
 * the field you are working is an obstruction; the same cloud over the whole
 * valley is the reason to zoom out.
 *
 * ## It is the same cloud that casts the shadows
 *
 * The ground shader has drawn moving cloud *shadows* for a long time — a
 * three-sine field sampled at each fragment's world position, drifting with the
 * wind. That field is imported here rather than reinvented, so what you see
 * overhead is the thing darkening the field beneath it, at the same size, moving
 * at the same speed, in the same places. Had this been given its own noise the
 * two would have been quietly unrelated, and everyone would have felt that
 * without being able to say why.
 *
 * The offset between a cloud and its shadow is not corrected and should not be:
 * an orthographic camera projects a plane at height *h* to a fixed screen
 * displacement, which is exactly what a cloud a thousand feet above its own
 * shadow looks like.
 *
 * ## Why a plane
 *
 * One draw call, no sorting, no billboards to spin, and no volumetrics to
 * march. Under a fixed isometric camera a cloud deck genuinely *is* a layer —
 * there is no angle from which the flatness shows, because there is no other
 * angle. The whole effect is one quad, a handful of sines and an alpha ramp.
 */

import {
  Color, Mesh, PlaneGeometry, Scene, ShaderMaterial, Vector2,
} from 'three';

/**
 * How far up the deck sits.
 *
 * Above every hill the terrain generator can make, and well below the camera,
 * which stands at about seventy-four. The exact figure only sets how far the
 * cloud appears from its shadow, and this is about a tile and a half of screen
 * offset — enough to read as height, not enough to look detached.
 */
const HEIGHT = 24;

/**
 * How wide. Generous rather than fitted: the deck is recentred on the camera
 * every frame, and at the furthest zoom the view is seventy tiles across, so
 * this covers it several times over and never needs to be resized.
 */
const EXTENT = 260;

/**
 * The zoom band it appears over, in tiles across the screen.
 *
 * Nothing until thirty-eight, which is comfortably beyond the twenty-six the
 * game sits at, so ordinary play never sees a wisp. Full by sixty-six, a little
 * before the seventy the zoom stops at, so the last of the wheel is spent
 * looking at a covered valley rather than still fading one in.
 */
const FROM_ACROSS = 38;
const TO_ACROSS = 66;

/** The most it will ever hide. "Almost not see it", not "not see it". */
const MOST = 0.82;

export interface Clouds {
  /**
   * @param tilesAcross the current zoom, which is the only thing that decides
   *   whether there is any cloud at all
   * @param drift the ground shader's own cloud drift, so the two agree
   * @param haze the light's colour at this hour, which the cloud takes
   */
  update(
    camX: number, camZ: number, tilesAcross: number,
    drift: readonly [number, number], haze: readonly [number, number, number],
    night: number, level: number,
  ): void;
  dispose(): void;
}

export function makeClouds(scene: Scene): Clouds {
  const material = new ShaderMaterial({
    transparent: true,
    /*
     * No depth write, and it matters. The deck is drawn after the district and
     * has to blend with it; writing depth would make one cloud occlude the next
     * thing sorted behind it — including, at the edges, itself.
     */
    depthWrite: false,
    /*
     * And no fog. The scene's fog is distance haze for things standing on the
     * ground; a deck twenty-four units up is not "far away", and fogging it
     * would grey out the half of the sky furthest from the camera for no reason
     * anybody could name.
     */
    fog: false,
    uniforms: {
      uDrift: { value: new Vector2() },
      uAmount: { value: 0 },
      uLit: { value: new Color(1, 1, 1) },
      uShade: { value: new Color(0.72, 0.75, 0.80) },
    },
    vertexShader: `
varying vec2 vWorld;
void main() {
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vWorld = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`,
    fragmentShader: `
uniform vec2 uDrift;
uniform float uAmount;
uniform vec3 uLit;
uniform vec3 uShade;
varying vec2 vWorld;

// The ground shader's field, exactly. See the note at the top of this file:
// if these two ever differ, the shadows stop belonging to the clouds.
float cloudAt( vec2 p ) {
	float a = sin( p.x * 0.047 + p.y * 0.029 );
	float b = sin( p.x * 0.019 - p.y * 0.041 + 1.7 );
	float c = sin( ( p.x + p.y ) * 0.011 + 3.1 );
	return a * 0.46 + b * 0.34 + c * 0.20;
}

/*
 * And the same field again, an order of magnitude faster, which is what stops it
 * looking like what it is.
 *
 * Three sines seen face-on are three stripes. Underfoot that was never a
 * problem, because a shadow is only ever a soft darkening of a field you are
 * looking at from a distance; drawn as the thing itself it needs edges. The
 * detail is *added to the same field* rather than replacing it, so the big
 * shapes — the ones the shadows are cast from — are untouched, and only their
 * outlines break up.
 *
 * The frequencies are the whole of whether this reads as cloud. At a period of
 * forty tiles the first attempt put one detail lobe across the entire view, so
 * the deck arrived as a smear of fog with no shapes in it at all — recognisably
 * *something*, but not clouds. These have periods of about ten tiles down to
 * four and a half, so a screen at the far zoom holds a few dozen cloudlets
 * rather than a gradient.
 */
float detail( vec2 p ) {
	float a = sin( p.x * 0.62 - p.y * 0.51 + 0.7 );
	float b = sin( p.x * 0.35 + p.y * 0.71 + 2.4 );
	float c = sin( ( p.x - p.y ) * 0.89 + 5.2 );
	float d = sin( p.x * 1.41 + p.y * 1.13 + 4.0 );
	return a * 0.36 + b * 0.28 + c * 0.20 + d * 0.16;
}

void main() {
	vec2 p = vWorld + uDrift;
	/*
	 * The big field decides *how much* cloud there is here; the detail decides
	 * where the individual clouds are. Weighting matters more than it looks.
	 *
	 * Adding the detail to the base at full strength meant that wherever the base
	 * went properly negative — which is a third of it, the field being a sum of
	 * sines — no amount of detail could reach the threshold, so a third of the
	 * screen was bare sky and the boundary between the two was a smear the width
	 * of the district. Damping the base and lifting the detail keeps the same
	 * large-scale agreement with the shadows underneath while letting cloudlets
	 * form across the whole deck: thick where the shadow field is high, broken and
	 * sparse where it is low, and never a hard edge between the two.
	 */
	float base = cloudAt( p );
	float d = base * 0.52 + detail( p ) * 0.62;
	float body = smoothstep( -0.06, 0.40, d );
	if ( body <= 0.001 ) discard;

	/*
	 * A cheap sense of depth, from the field's own slope.
	 *
	 * Where the density is rising toward the light the cloud is a shoulder and
	 * catches the sun; where it falls away it is turning under. Sampling the
	 * field a short step to one side costs two more evaluations and is the whole
	 * difference between a cloud and a grey stain.
	 */
	vec2 step = vec2( 1.4, 0.9 );
	float ahead = cloudAt( p + step ) * 0.52 + detail( p + step ) * 0.62;
	float slope = clamp( ( d - ahead ) * 3.4 + 0.5, 0.0, 1.0 );
	vec3 tint = mix( uShade, uLit, slope );

	// Thin at the edges, thick in the middle. Squaring the body for alpha and
	// not for colour keeps the wisps pale rather than merely faint.
	gl_FragColor = vec4( tint, body * body * uAmount );
}
`,
  });

  const mesh = new Mesh(new PlaneGeometry(EXTENT, EXTENT), material);
  mesh.rotation.x = -Math.PI / 2;
  /*
   * Never culled, and drawn last.
   *
   * Its bounding sphere is computed from a geometry that is then moved a long
   * way every frame, and a deck that vanishes when the camera reaches the edge
   * of the district is a worse bug than the cost of always drawing one quad.
   */
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  scene.add(mesh);

  const lit = new Color();
  const shade = new Color();

  return {
    update(camX, camZ, tilesAcross, drift, haze, night, level): void {
      const zoom = (tilesAcross - FROM_ACROSS) / (TO_ACROSS - FROM_ACROSS);
      const amount = Math.max(0, Math.min(1, zoom)) * MOST * level;
      if (amount <= 0.002) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      mesh.position.set(camX, HEIGHT, camZ);
      const u = material.uniforms;
      (u.uDrift.value as Vector2).set(drift[0], drift[1]);
      u.uAmount.value = amount;
      /*
       * The cloud takes its colour from the light, via the haze the grade is
       * already using for the same hour. So a deck at dawn is pink because the
       * light is, and one at nine at night is slate, and neither needed a colour
       * of its own — which is also why the tops go dark at night rather than
       * staying a bright white lid over an unlit valley.
       */
      const day = 1 - night * 0.72;
      lit.setRGB(
        Math.min(0.94, (0.44 + haze[0] * 0.5) * day),
        Math.min(0.95, (0.45 + haze[1] * 0.5) * day),
        Math.min(0.97, (0.47 + haze[2] * 0.5) * day),
      );
      shade.setRGB(lit.r * 0.74, lit.g * 0.77, lit.b * 0.84);
      (u.uLit.value as Color).copy(lit);
      (u.uShade.value as Color).copy(shade);
    },

    dispose(): void {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
