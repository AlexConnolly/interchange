/**
 * Where the camera stands, as numbers other modules can reason about.
 *
 * Split out of `scene.ts` for one reason: the ground builder needs to know which
 * way the camera faces, and `scene.ts` imports the ground builder. Two modules
 * that each need a fact about the other is a module boundary in the wrong place,
 * and the fact itself — the angle of a fixed isometric view — belongs to neither.
 *
 * It is fixed and there is no control that turns it: two gestures are the whole
 * of the camera, drag to pan and wheel to zoom, because the eight-control budget
 * has no room for a camera panel. That is a design decision rather than an
 * accident, and things are allowed to depend on it — but only *through here*, so
 * that changing it changes them too.
 */

/** Elevation above the horizon, in radians. */
export const CAMERA_ELEVATION = (38 * Math.PI) / 180;

/** Azimuth, in radians. Negative swings the view to the left. */
export const CAMERA_AZIMUTH = (-32 * Math.PI) / 180;

/**
 * How far back the orthographic camera sits from what it is looking at.
 *
 * It has to be a long way: an orthographic projection has no perspective to
 * separate near from far, so what stops the district looking like a flat pattern
 * is the *shadows* and the fog, and both need the camera outside the terrain.
 */
export const CAMERA_DISTANCE = 120;

/**
 * Which way the camera lies from what it is looking at, as a direction on the
 * ground.
 *
 * The signs are the whole point of exporting this. A corrugated surface — a
 * ploughed field, a field of barley — only needs the *near* face of each ridge
 * drawn, because the far face of every ridge is hidden behind the ridge in front
 * of it. Which face is near depends entirely on these two signs, and asking here
 * rather than hard-coding "the lower one" is the difference between geometry that
 * follows the camera and geometry that silently shows daylight through the
 * furrows the day somebody turns it.
 */
export function cameraOffset(): { x: number; z: number } {
  const flat = Math.cos(CAMERA_ELEVATION) * CAMERA_DISTANCE;
  return {
    x: Math.sin(CAMERA_AZIMUTH) * flat,
    z: -Math.cos(CAMERA_AZIMUTH) * flat,
  };
}

/**
 * For a ridge banded along an axis, is the face the camera sees the one at the
 * *lower* coordinate?
 *
 * `alongX` means the ridge runs the length of X and is therefore banded across
 * Z, so the axis that matters is Z. The answer is simply whether the camera is
 * on the low side of it.
 */
export function nearFaceIsLow(alongX: boolean): boolean {
  const o = cameraOffset();
  return (alongX ? o.z : o.x) < 0;
}
