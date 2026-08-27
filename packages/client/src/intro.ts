/**
 * The opening: ten seconds of coming down through the cloud.
 *
 * The district takes a moment to be ready — a dozen GLB files to fetch and bake,
 * a heightmap to mesh, influence to resolve — and until now that moment was spent
 * looking at an empty green field while things popped into it. The load is real
 * and cannot be wished away, so the answer is to *spend* it rather than hide it:
 * start above the weather, come down through it, and arrive.
 *
 * ## The shape of it
 *
 * Three acts, and the timings are the whole design.
 *
 *   **0 to 3 seconds — in the cloud.** Opaque. You are above the deck and there
 *   is nothing to see, which is exactly the point: the game has not finished
 *   loading and this is an honest picture of that rather than a spinner over a
 *   half-built world.
 *
 *   **3 to 7 seconds — breaking through.** The cloud thins and the camera comes
 *   down, from much further out than the game is ever played at to the zoom it
 *   opens on. Four seconds, because that is about as long as a descent can hold
 *   attention before it wants to be over.
 *
 *   **7 to 10 seconds — the interface arrives.** The furniture slides in from the
 *   edges it lives on: the dock up from the bottom, the readout down from the top.
 *   Nothing is interactive until this has finished, so the first thing a player
 *   can press is a thing that has already stopped moving.
 *
 * "Loading game..." is shown for the first four seconds and then goes, whether
 * loading has finished or not — because by then there is something to look at, and
 * a label over a picture is a label that has outstayed its usefulness.
 *
 * ## Why the timings are fixed rather than driven by loading
 *
 * The tempting design is to hold in the cloud until the last model arrives. It is
 * the wrong one: on a warm cache that is a hundred milliseconds, which reads as a
 * flicker and a jolt, and on a cold one it is however long the network takes and
 * the intro becomes an indefinite wait dressed as a flourish. A fixed ten seconds
 * is the same every time, which is what makes it a piece of the game rather than a
 * progress bar. Anything not ready by then simply appears during the descent,
 * behind cloud, which is the best place in the whole sequence to appear.
 */

/** How long the whole thing lasts, in seconds. Nothing takes input until it ends. */
export const INTRO_LENGTH = 10;

/** Solid cloud, then the descent, then the interface. */
const IN_CLOUD = 3;
const DESCENT_END = 7;

/** And the label, which outlives the solid cloud by a second and then goes. */
const LABEL_UNTIL = 4;

/**
 * How far out the descent starts, in tiles across the frame.
 *
 * Well beyond the zoom limit the wheel allows, and deliberately: the opening shot
 * should be a view of the district you cannot get back to, which is what makes it
 * feel like arriving somewhere rather than like the game starting at the wrong
 * setting. The clamp on the wheel is not touched — this is written straight to the
 * renderer and the player cannot steer it.
 */
export const INTRO_ACROSS = 132;

export interface Intro {
  /** 0 while in cloud, rising to 1 as the deck clears. */
  clear: number;
  /** How opaque the cloud veil over everything is, 1 down to 0. */
  veil: number;
  /** Tiles across the frame this instant. */
  across: number;
  /** Whether to say we are loading. */
  label: boolean;
  /** Whether the interface may show, and take input. */
  ui: boolean;
  /** Over. Nothing here applies any more. */
  done: boolean;
}

/** Smooth 0..1, so nothing in the sequence starts or stops abruptly. */
function ease(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Where the opening has got to, at `t` seconds in.
 *
 * A pure function of the clock, which is what makes it testable and what keeps it
 * out of the frame loop's state. The frame loop asks what the picture should look
 * like now; it does not accumulate anything of its own.
 */
export function introAt(t: number, target: number): Intro {
  if (t >= INTRO_LENGTH) {
    return { clear: 1, veil: 0, across: target, label: false, ui: true, done: true };
  }
  /*
   * The veil holds at full for the whole first act and then goes over the descent
   * — but not over all of it. It is gone by about two thirds of the way down,
   * because the last of a descent should be through clear air: cloud thinning all
   * the way to the ground would read as fog rather than as breaking out of an
   * overcast.
   */
  const through = ease((t - IN_CLOUD) / ((DESCENT_END - IN_CLOUD) * 0.62));
  /*
   * The camera moves on its own curve over the whole descent, so it is still
   * coming down after the cloud has gone. That overlap is what sells it: you break
   * out into clear air and are *still falling*, which is the moment the district
   * arrives.
   */
  const fall = ease((t - IN_CLOUD) / (DESCENT_END - IN_CLOUD));
  return {
    clear: through,
    veil: 1 - through,
    across: INTRO_ACROSS + (target - INTRO_ACROSS) * fall,
    label: t < LABEL_UNTIL,
    /*
     * The interface arrives when the descent ends, not when the whole sequence
     * does: the last three seconds are it sliding in, and it has to be on screen
     * to do that. `done` is what governs input.
     */
    ui: t >= DESCENT_END,
    done: false,
  };
}
