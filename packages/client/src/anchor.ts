/**
 * HTML that is pinned to a place in the world, moved by the DOM every frame.
 *
 * "When I drag or move the camera, all the UI elements that are fixed positions
 * drag and do this horrible, like, jumping thing." They did, and the cause was
 * structural rather than a bug anywhere: the markers, the vehicle chevrons and
 * the panel bubbles all got their screen position from React state, refreshed on
 * a twenty-hertz timer, while the canvas underneath them redrew sixty times a
 * second. Three frames out of four the map had moved and the HTML had not, so
 * every marker trailed the thing it was labelling and then snapped forward.
 *
 * Any fix that keeps positions in React state is the same bug at a higher
 * frequency — sixty `setState` calls a second re-render the whole overlay tree
 * sixty times a second, which is what locked the renderer up once already.
 *
 * So positions stop going through React. An element that wants to be pinned
 * carries its world point in `data-` attributes, and one pass at the end of the
 * frame loop — the same loop that moved the camera, after it moved — projects
 * each of them and writes `left` and `top`. React still decides *which* markers
 * exist and what is written in them, which is what it is good at, and it does
 * that at whatever rate it likes. The camera and the labels on it can no longer
 * disagree, because there is no longer a moment between them.
 *
 * Reading the elements out of the DOM each frame rather than keeping a registry
 * is deliberate: there are a few dozen of them, `querySelectorAll` over one
 * subtree costs microseconds, and an element that unmounts simply stops being
 * found. A registry would need lifecycle bookkeeping to say the same thing, and
 * getting that wrong leaves a stale entry writing to a detached node for ever.
 */

/** What the projector must do: a world point in, screen pixels out. */
export type Project = (x: number, y: number, z: number)
  => { x: number; y: number } | null;

/** The attributes an anchored element carries. Spread into JSX. */
export interface AnchorProps {
  'data-ax': number;
  'data-ay': number;
  'data-az': number;
  'data-adx'?: number;
  'data-ady'?: number;
  'data-aclamp'?: number;
}

/**
 * Pin an element to a world point.
 *
 * `dx`/`dy` shift it in pixels afterwards — a vehicle chevron sits sixteen
 * pixels above its lorry. `clamp` keeps it that many pixels inside the window,
 * which is how a bubble stays readable when the place it belongs to is near the
 * edge of the frame.
 */
export function anchorAt(
  x: number, y: number, z: number,
  opts?: { dx?: number; dy?: number; clamp?: number },
): AnchorProps {
  const props: AnchorProps = { 'data-ax': x, 'data-ay': y, 'data-az': z };
  if (opts?.dx) props['data-adx'] = opts.dx;
  if (opts?.dy) props['data-ady'] = opts.dy;
  if (opts?.clamp) props['data-aclamp'] = opts.clamp;
  return props;
}

/**
 * Move every anchored element to where its world point is now.
 *
 * Call once per frame, from the frame loop, *after* the camera has been moved.
 * Before it, and everything is one frame stale again — which is the whole thing
 * this exists to prevent.
 */
export function syncAnchors(root: HTMLElement, project: Project): void {
  const els = root.querySelectorAll<HTMLElement>('[data-ax]');
  const width = window.innerWidth;
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const d = el.dataset;
    const at = project(Number(d.ax), Number(d.ay), Number(d.az));
    if (at === null) {
      /*
       * Behind the camera. Parked off screen rather than hidden with
       * `visibility`, and that is not a style preference: only elements
       * carrying `data-ax` are visited, so an element that stops being anchored
       * — a bubble whose place has left the frame, which switches to a fixed
       * position of its own — would never be visited again to have a
       * `visibility: hidden` taken back off it. Position is a property React
       * already owns and will overwrite; visibility is not.
       */
      el.style.left = '-9999px';
      el.style.top = '-9999px';
      continue;
    }
    const clamp = d.aclamp === undefined ? 0 : Number(d.aclamp);
    const x = clamp > 0
      ? Math.max(clamp, Math.min(width - clamp, at.x))
      : at.x;
    // Sub-pixel, on purpose. Rounding to whole pixels reintroduces a small
    // version of the same stutter, at one pixel instead of three frames.
    el.style.left = `${x + (d.adx === undefined ? 0 : Number(d.adx))}px`;
    el.style.top = `${at.y + (d.ady === undefined ? 0 : Number(d.ady))}px`;
  }
}
