/**
 * The canvas, and every way of pointing at it.
 *
 * One pointer abstraction, written on day one (architecture.md §10, "Touch").
 * Mouse, pen and finger all arrive as the same three events, and the camera
 * gestures map to the same commands as mouse input — this is not a separate
 * mobile build and there is no second input path to keep in sync.
 */

import { useEffect, useRef } from 'react';
import { actionFor, loadSettings, type Settings } from './settings.ts';
import { OverlayMode } from '@interchange/render';
import type { Engine } from './engine.ts';

export interface Picked {
  kind: 'vehicle' | 'site' | 'town' | 'tile' | 'none';
  id: number;
  tile: number;
}

interface Props {
  engine: Engine;
  onPick: (p: Picked) => void;
  onHover: (p: Picked | null, screen: { x: number; y: number } | null) => void;
  /** Construction drag, when a way class is selected. Returning true from
   *  `onDragStart` claims the gesture so it pans nothing. */
  onDragStart?: (tile: number) => boolean;
  onDragMove?: (tile: number) => void;
  onDragEnd?: (tile: number) => void;
}

export function WorldView({ engine, onPick, onHover, onDragStart, onDragMove, onDragEnd }: Props): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  // Held in a ref so the pointer handlers, which are installed once, always
  // see the current callbacks rather than the ones from their closure.
  const handlers = useRef({ onPick, onHover, onDragStart, onDragMove, onDragEnd });
  handlers.current = { onPick, onHover, onDragStart, onDragMove, onDragEnd };
  /*
   * Bindings in a ref, and re-read when they change.
   *
   * The key handler is installed once, so it would otherwise capture whatever
   * the settings were when the view mounted and go on obeying them after a
   * rebind. A ref costs nothing and means a rebind takes effect on the next
   * key press rather than on the next reload.
   */
  const settingsRef = useRef<Settings>(loadSettings());
  useEffect(() => {
    const reread = (): void => { settingsRef.current = loadSettings(); };
    window.addEventListener('interchange:settings', reread);
    return () => window.removeEventListener('interchange:settings', reread);
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    engine.attach(canvas);

    const resize = (): void => {
      const r = canvas.getBoundingClientRect();
      engine.renderer?.resize(Math.max(1, r.width), Math.max(1, r.height));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // --- pointer state, shared by every device ---------------------------
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let building = false;
    let moved = 0;
    let last = { x: 0, y: 0 };
    let pinchDist = 0;

    const toNdc = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
    };

    const pick = (e: PointerEvent | MouseEvent): Picked => {
      const rr = engine.renderer;
      if (!rr) return { kind: 'none', id: -1, tile: -1 };
      const src = engine.buildSource();
      const [nx, ny] = toNdc(e);
      const v = rr.pickVehicle(src, nx, ny);
      if (v >= 0) return { kind: 'vehicle', id: v, tile: -1 };
      const tile = rr.pickTile(src, nx, ny);
      if (tile < 0) return { kind: 'none', id: -1, tile: -1 };
      const w = engine.world;
      const tx = tile % w.config.size;
      const ty = (tile / w.config.size) | 0;
      // Sites and towns are picked by proximity in tile space rather than by
      // ray, because their meshes are decorative massing and the thing the
      // player is aiming at is the place, not the roof they happened to hit.
      for (let s = 0; s < w.sites.count; s++) {
        if (Math.abs(w.sites.x[s] - tx) <= 2 && Math.abs(w.sites.y[s] - ty) <= 2) {
          return { kind: 'site', id: s, tile };
        }
      }
      for (let t = 0; t < w.towns.count; t++) {
        if (Math.abs(w.towns.x[t] - tx) <= 3 && Math.abs(w.towns.y[t] - ty) <= 3) {
          return { kind: 'town', id: t, tile };
        }
      }
      return { kind: 'tile', id: tile, tile };
    };

    const onDown = (e: PointerEvent): void => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const rr = engine.renderer;
        if (rr && handlers.current.onDragStart) {
          const tile = rr.pickTile(engine.buildSource(), ...toNdc(e));
          if (tile >= 0 && handlers.current.onDragStart(tile)) {
            building = true;
            dragging = false;
            return;
          }
        }
        dragging = true;
        moved = 0;
        last = { x: e.clientX, y: e.clientY };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        dragging = false;
      }
    };

    const onMove = (e: PointerEvent): void => {
      const rr = engine.renderer;
      if (!rr) return;
      if (!pointers.has(e.pointerId)) {
        // Hover: only meaningful with a real pointer, and only when idle.
        const p = pick(e);
        handlers.current.onHover(p.kind === 'none' ? null : p, { x: e.clientX, y: e.clientY });
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (building) {
        const tile = rr.pickTile(engine.buildSource(), ...toNdc(e));
        if (tile >= 0) handlers.current.onDragMove?.(tile);
        return;
      }

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) {
          rr.camState.view = clamp(rr.camState.view * (pinchDist / d), 12, 420);
        }
        pinchDist = d;
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);

      // Screen-space drag has to be rotated into world space, and the
      // along-axis component divided by sin(elevation) — otherwise dragging
      // north feels slower than dragging east, which is the camera's
      // foreshortening leaking into the input.
      const c = rr.camState;
      const r = canvas.getBoundingClientRect();
      const scale = c.view / r.height;
      const az = (c.rotation * Math.PI) / 2 + Math.PI / 4;
      const sin = Math.sin((c.elevation * Math.PI) / 180);
      const wx = -dx * scale;
      const wz = -dy * scale / sin;
      c.x += wx * Math.cos(az - Math.PI / 2) + wz * Math.cos(az + Math.PI);
      c.z += wx * Math.sin(az - Math.PI / 2) + wz * Math.sin(az + Math.PI);
      const size = engine.world.config.size;
      c.x = clamp(c.x, -40, size + 40);
      c.z = clamp(c.z, -40, size + 40);
    };

    const onUp = (e: PointerEvent): void => {
      const wasDragging = dragging;
      if (building) {
        building = false;
        pointers.delete(e.pointerId);
        const rr = engine.renderer;
        if (rr) {
          const tile = rr.pickTile(engine.buildSource(), ...toNdc(e));
          if (tile >= 0) handlers.current.onDragEnd?.(tile);
        }
        return;
      }
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) dragging = false;
      // A drag that moved a few pixels is still a click. Anything more was a
      // pan, and panning must never select something.
      if (wasDragging && moved < 8) handlers.current.onPick(pick(e));
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rr = engine.renderer;
      if (!rr) return;
      const before = rr.pickTile(engine.buildSource(), ...toNdc(e));
      const factor = Math.exp(e.deltaY * 0.0016);
      rr.camState.view = clamp(rr.camState.view * factor, 12, 420);
      // Zoom toward the cursor: without this, zooming in on something far from
      // the centre walks it off the screen and the player has to chase it.
      if (before >= 0) {
        const size = engine.world.config.size;
        const bx = before % size;
        const bz = (before / size) | 0;
        const after = rr.pickTile(engine.buildSource(), ...toNdc(e));
        if (after >= 0) {
          rr.camState.x += bx - (after % size);
          rr.camState.z += bz - ((after / size) | 0);
        }
      }
    };

    const onKey = (e: KeyboardEvent): void => {
      const rr = engine.renderer;
      if (!rr) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      const c = rr.camState;
      /*
       * Through the binding table, not a switch on literal keys.
       *
       * The switch worked and could not be rebound, which made a Phase 1
       * feature — settings and key rebinding — impossible without rewriting
       * this. Actions are the stable thing and keys are what is bound to
       * them, so this asks what the press *means* and then does it.
       */
      const action = actionFor(settingsRef.current, e.key);
      if (action === null) return;
      switch (action) {
        case 'rotateLeft': c.rotation = (c.rotation + 3) % 4; break;
        case 'rotateRight': c.rotation = (c.rotation + 1) % 4; break;
        case 'zoomIn': c.view = clamp(c.view * 0.8, 12, 420); break;
        case 'zoomOut': c.view = clamp(c.view * 1.25, 12, 420); break;
        case 'pause': e.preventDefault(); engine.setSpeed(engine.world.speed === 0 ? 1 : 0); break;
        case 'speed1': engine.setSpeed(1); break;
        case 'speed2': engine.setSpeed(2); break;
        case 'speed3': engine.setSpeed(3); break;
        case 'speed4': engine.setSpeed(4); break;
        case 'congestion':
          engine.setOverlay(rr.overlay === OverlayMode.Congestion ? OverlayMode.None : OverlayMode.Congestion);
          break;
        case 'ownership':
          engine.setOverlay(rr.overlay === OverlayMode.Ownership ? OverlayMode.None : OverlayMode.Ownership);
          break;
        case 'cargo':
          engine.setOverlay(rr.overlay === OverlayMode.Cargo ? OverlayMode.None : OverlayMode.Cargo);
          break;
        case 'amenity':
          engine.setOverlay(rr.overlay === OverlayMode.Amenity ? OverlayMode.None : OverlayMode.Amenity);
          break;
        // Photo mode is announced rather than handled: the camera keys belong
        // to this view and the interface's visibility does not.
        case 'photo':
          window.dispatchEvent(new CustomEvent('interchange:photo'));
          break;
        default: break;
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKey);

    return () => {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      engine.detach();
    };
  }, [engine]);

  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
