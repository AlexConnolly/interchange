/**
 * The render package. Everything here is presentation and none of it may write
 * to simulation state — determinism rule 6. Camera position, viewport, frame
 * rate and device tier must never influence what the sim computes, which is
 * why the LOD sleep rules live in the sim and camera proximity is fed in as a
 * command rather than read from here.
 */

export * from './palette.ts';
export * from './geometry.ts';
export * from './models.ts';
export * from './material.ts';
export * from './scene.ts';
