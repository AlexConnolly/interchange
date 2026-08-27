/**
 * A marker over every business you can see.
 *
 * The old version put a pin only over places with a contract going, which made
 * the district almost entirely unclickable: everything else was a cluster of
 * roofs in a field with no indication that clicking it would do anything. "It's
 * really hard to work out whether I can click on a location" was exactly right,
 * and the fix is not a better hover state — it is that **every business carries
 * its own sign**, always, and the sign says what kind of business it is.
 *
 * The sign is an icon and never a word. See Icons.tsx for why.
 *
 * Three things a marker can tell you, and no more:
 *
 *   **What it is** — the pictogram.
 *   **Whether it is yours** — a gold ring and a warmer face.
 *   **Whether there is work going** — a small dot on the shoulder.
 *
 * Everything else is inside the panel. A marker that tried to show stock,
 * price and demand would be a spreadsheet nailed to the sky.
 *
 * These are DOM rather than geometry, deliberately: a marker wants crisp
 * artwork, a pointer cursor, a hover state and a click handler, all four free
 * in HTML and a project in WebGL. The renderer's only job is to say where on
 * screen a place has landed.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { ContractState, type World } from '@interchange/sim';
import { content } from '@interchange/data';
import type { Renderer } from '@interchange/render';
import { Icon } from './Icons.tsx';
import { anchorAt } from './anchor.ts';

const C = content();

interface Marked {
  key: string;
  site: number;
  yard: number;
  id: string;
  name: string;
  mine: boolean;
  /** No road to work from: everything here has stopped. */
  cut: boolean;
  work: boolean;
  /** Where it is in the world. The frame loop turns this into pixels. */
  x: number;
  y: number;
  z: number;
}

export function Markers({
  world, renderer, hide, onOpenSite, onOpenYard,
}: {
  world: World;
  renderer: Renderer;
  /**
   * The one place whose panel is open, which does not get a marker.
   *
   * Its bubble is already sitting on it with an arrow pointing down at it, so
   * the marker is saying a thing that is being said louder an inch above — and
   * worse, the two overlap. The sign is for places you have not looked at.
   */
  hide: number;
  onOpenSite: (site: number) => void;
  onOpenYard: (yard: number) => void;
}): JSX.Element {
  const [marks, setMarks] = useState<Marked[]>([]);

  useOverlayTick(() => {

      // Which places are offering work. Read once per frame rather than per
      // marker, because it is a scan of the board and there are five offers on
      // it at most.
      const working = new Set<number>();
      const board = world.contractBoard;
      for (let i = 0; i < board.count; i++) {
        if (board.state[i] === ContractState.Offered) working.add(board.from[i]);
      }

      const out: Marked[] = [];
      const size = world.terrain.size;
      const put = (
        key: string, site: number, yard: number, id: string, name: string,
        tile: number, mine: boolean, work: boolean, cut = false,
      ): void => {
        // The world point, not the screen point. Projecting it is the frame
        // loop's job now, which is the only way a marker and the camera under it
        // can agree — see `anchor.ts`.
        out.push({
          key, site, yard, id, name, mine, work, cut,
          x: (tile % size) + 0.5,
          y: world.terrain.height[tile],
          z: Math.floor(tile / size) + 0.5,
        });
      };

      for (let s = 0; s < world.sites.count; s++) {
        if (s === hide) continue;
        const tile = world.siteAccessTile[s];
        if (tile < 0 || !world.influence.usable(tile)) continue;
        const def = C.industries[world.sites.def[s]];
        put(`s${s}`, s, -1, def.id, def.name, tile,
            world.sites.owner[s] === world.player, working.has(s),
            world.siteStranded(s));
      }
      for (let y = 0; y < world.yards.count; y++) {
        if (world.yards.owner[y] !== world.player) continue;
        const tile = world.yards.tile[y];
        if (tile < 0) continue;
        put(`y${y}`, -1, y, 'yard', world.yards.names[y], tile, true, false);
      }
      setMarks(out);
  });

  return (
    <>
      {marks.map((m) => (
        <button
          key={m.key}
          className={`mark ${m.mine ? 'mine' : ''} ${m.work ? 'working' : ''}`}
          {...anchorAt(m.x, m.y, m.z)}
          onClick={() => (m.yard >= 0 ? onOpenYard(m.yard) : onOpenSite(m.site))}
          title={m.cut ? `${m.name} - no road, nothing is running` : m.name}
        >
          <span className="mark-face"><Icon id={m.id} /></span>
          {/*
            * Cut off, and it takes the shoulder rather than sharing it with the
            * work dot: a works with no road is not working, so the two can never
            * both be true and there is no arrangement to negotiate.
            *
            * Above the marker rather than inside it, and in the one colour
            * nothing else on the map uses, because this is the only state a
            * business can be in that the player has to *do* something about.
            */}
          {m.cut ? <span className="mark-warn">!</span> : m.work && <span className="mark-dot" />}
          <span className="mark-tail" />
        </button>
      ))}
    </>
  );
}

/**
 * Where a tile is on screen, followed every frame — but only reported when it
 * moves.
 *
 * The naive version calls `setState` with a fresh `{x, y}` sixty times a second,
 * which re-renders the panel sixty times a second whether or not anything
 * changed. That is wasteful when the camera is still, which is most of the time,
 * and it multiplies: every extra render recreates the panel's handlers and its
 * whole subtree, so a panel with nine rows of images in it does that work again
 * for a camera that has not moved a pixel.
 *
 * Comparing to the last value and bailing out costs two subtractions. Half a
 * pixel is the threshold, which is below what anybody can see and above the
 * float noise a projection produces when nothing is moving.
 *
 * Shared by the place bubble and the yard bubble because they want exactly the
 * same thing, and because the two had already drifted apart once — the yard's
 * copy was the one that misbehaved.
 */
/**
 * A bubble's anchor: where it is on screen, and where it is in the world.
 *
 * The screen figures decide the *shape* of the bubble — above the place or
 * below it, pointing at it or adrift because it has gone off frame — and those
 * are discrete choices that a twenty-hertz answer settles perfectly well. The
 * world figures are what the frame loop projects to place it, every frame, so
 * the bubble does not trail the map it is pointing at.
 */
export interface Anchored {
  x: number;
  y: number;
  wx: number;
  wy: number;
  wz: number;
}

export function useAnchor(
  world: World, renderer: Renderer, tile: number,
): Anchored | null {
  const [anchor, setAnchor] = useState<Anchored | null>(null);
  const last = useRef<Anchored | null>(null);

  useOverlayTick(() => {
      if (tile < 0) {
        if (last.current !== null) { last.current = null; setAnchor(null); }
        return;
      }
      const size = world.terrain.size;
      const wx = (tile % size) + 0.5;
      const wy = world.terrain.height[tile];
      const wz = Math.floor(tile / size) + 0.5;
      const at = renderer.project(wx, wy, wz);
      const was = last.current;
      if (at === null) {
        if (was !== null) { last.current = null; setAnchor(null); }
        return;
      }
      if (was !== null && Math.abs(was.x - at.x) < 0.5 && Math.abs(was.y - at.y) < 0.5) return;
      last.current = { x: at.x, y: at.y, wx, wy, wz };
      setAnchor(last.current);
  });

  return anchor;
}


/**
 * A small mark over each of your own vehicles.
 *
 * "It's not obvious to see which ones are vehicles on the map... it should have
 * a very small indicator above them, something to just say this is yours." Once
 * there is ambient traffic that is not a nicety: a dozen lorries on screen and
 * two of them are yours, and nothing distinguished them.
 *
 * Deliberately smaller and quieter than a place marker — a chevron, not a card.
 * A place marker is a thing you have not looked at yet and wants to be found; a
 * vehicle marker is an annotation on something you already own, and there may be
 * twenty of them. It changes colour when the lorry is on a job, which answers
 * the other half of the same complaint at no extra cost.
 *
 * Clicking it opens the vehicle, which is the only way to reach one: a lorry is
 * a few pixels of a moving object, so picking it off the canvas would be a
 * frustrating game of its own.
 */
export function Mine({
  world, renderer, onOpen,
}: {
  world: World;
  renderer: Renderer;
  onOpen: (vehicle: number) => void;
}): JSX.Element {
  const [marks, setMarks] = useState<
    { v: number; x: number; y: number; z: number; busy: boolean }[]>([]);

  useOverlayTick(() => {
      const size = world.terrain.size;
      const out: { v: number; x: number; y: number; z: number; busy: boolean }[] = [];
      for (let v = 0; v < world.vehicles.count; v++) {
        if (!world.vehicles.alive[v]) continue;
        if (world.vehicles.company[v] !== world.player) continue;
        let x = world.vehicles.x[v] / 65536;
        let z = world.vehicles.y[v] / 65536;
        /*
         * A parked lorry has no position.
         *
         * `projectVehicles` only writes x and y for vehicles on a link, so one
         * sitting in its yard between jobs is at the origin — and its marker
         * went to the corner of the district, which is to say nowhere. The same
         * fallback the stopped-vehicle badge needed, and for the same reason: a
         * lorry that is not on the road *is* at its yard.
         */
        const yard = world.vehicleYard[v] ?? -1;
        if (world.vehicles.link[v] === -1 && yard >= 0) {
          x = world.yards.x[yard] + 0.5;
          z = world.yards.y[yard] + 0.5;
        }
        const tile = Math.max(0, Math.min(size * size - 1,
          Math.round(z) * size + Math.round(x)));
        out.push({
          v, x, y: world.terrain.height[tile], z,
          busy: world.vehicles.service[v] !== -1,
        });
      }
      setMarks(out);
  });

  return (
    <>
      {marks.map((m) => (
        <button
          key={m.v}
          className={`mine-mark ${m.busy ? 'busy' : ''}`}
          {...anchorAt(m.x, m.y, m.z, { dy: -16 })}
          onClick={() => onOpen(m.v)}
          title={m.busy ? 'On a job' : 'Idle'}
        />
      ))}
    </>
  );
}


/**
 * A loop for the things drawn *over* the map, at a rate that is not the frame
 * rate.
 *
 * Four separate components — the place markers, the vehicle marks, the stopped
 * badges and the money — each ran their own `requestAnimationFrame` and each
 * called `setState` with a freshly allocated array inside it. So every frame
 * React re-rendered the whole overlay tree four times over, and adding the
 * fourth was enough to lock the renderer up entirely.
 *
 * Twenty times a second instead of sixty. These are DOM elements a few dozen
 * pixels across following a camera that eases — at 20 Hz nothing about them
 * looks different, and it is a third of the work. The WebGL scene still draws
 * every frame; it is only the HTML on top that does not need to.
 *
 * The real fix is to move these positions to direct DOM writes and stop routing
 * them through React state at all. That is a bigger change than this and this
 * buys back the frame rate today.
 */
export function useOverlayTick(fn: () => void, hz = 20): void {
  /*
   * The callback goes through a ref, and it has to.
   *
   * The caller's closure is rebuilt every render, so making it a dependency
   * would cancel and restart the loop on every render — the very churn being
   * avoided. But capturing it once is worse than it looks: the driver panel
   * follows a *moving* lorry, so it passes a closure over a tile that changes
   * every frame, and a stale closure would leave its bubble sitting where the
   * lorry was when you opened it.
   *
   * A ref updated on each render gives the loop the latest closure without the
   * loop knowing anything changed.
   */
  const latest = useRef(fn);
  latest.current = fn;

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const gap = 1000 / hz;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      if (now - last < gap) return;
      last = now;
      latest.current();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hz]);
}

/** Money, as a haulier would say it. */
export function money(pence: number): string {
  const p = Math.round(pence);
  /*
   * A million pounds is a hundred million pence, and this used to say ten
   * million.
   *
   * `100_000_00` reads as "a hundred thousand, in pence" because of where the
   * underscores fall, and that is exactly what it is — so every figure over a
   * hundred thousand pounds was divided by a hundred thousand and labelled with
   * an m. A hundred grand in the bank showed as "£1.0m". It went unnoticed for
   * as long as it did because nothing in the opening ten minutes of the game
   * comes anywhere near the threshold; it surfaced the first time anybody
   * started with a float big enough to buy a business outright, and then every
   * price in the game was overstated tenfold at once.
   */
  const MILLION = 1_000_000_00;
  if (Math.abs(p) >= MILLION) return `£${(p / MILLION).toFixed(1)}m`;
  if (Math.abs(p) >= 1_000_00) return `£${Math.round(p / 100).toLocaleString('en-GB')}`;
  return `£${(p / 100).toFixed(2)}`;
}


/**
 * Money arriving, shown where it was earned.
 *
 * "There's also nothing rewarding about making money" was true, and the reason
 * is that the cash figure in the corner changing is a *fact*, not an event —
 * you can watch it for a minute and never see the moment a load paid.
 *
 * So: a small figure rises off the lorry that just delivered, and fades. No
 * sound, deliberately. Once a fleet is running, deliveries land several a
 * second, and anything audible becomes a fruit machine — which was the specific
 * worry, and it is right. The visual version scales the other way round: at one
 * lorry each figure is a small event you notice, and at twenty they merge into a
 * drift of numbers over the district that reads as prosperity rather than as
 * noise.
 *
 * Capped at twelve on screen. Beyond that they overlap into illegibility and
 * add nothing — the point was never to itemise, it was to make earning visible.
 */
export function Earnings({
  world, renderer,
}: {
  world: World;
  renderer: Renderer;
}): JSX.Element {
  const [notes, setNotes] = useState<
    { id: number; x: number; y: number; text: string; born: number }[]>([]);
  const seq = useRef(0);
  const live = useRef<
    { id: number; wx: number; wz: number; text: string; born: number }[]>([]);

  useEffect(() => {
    let raf = 0;
    const LIFE = 1500;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();

      for (const e of world.takeEarnings()) {
        if (live.current.length >= 12) break;
        live.current.push({
          id: seq.current++, wx: e.x, wz: e.z, text: `+${money(e.pence)}`, born: now,
        });
      }
      if (live.current.length === 0) {
        if (notes.length > 0) setNotes([]);
        return;
      }
      live.current = live.current.filter((e) => now - e.born < LIFE);

      const size = world.terrain.size;
      const out: { id: number; x: number; y: number; text: string; born: number }[] = [];
      for (const e of live.current) {
        const tile = Math.min(size * size - 1,
          Math.round(e.wz) * size + Math.round(e.wx));
        const at = renderer.project(e.wx, world.terrain.height[tile], e.wz);
        if (!at) continue;
        // Rises as it ages: thirty pixels over its life, which is enough to read
        // as leaving the lorry and not enough to travel across the frame.
        const age = (now - e.born) / LIFE;
        out.push({ id: e.id, x: at.x, y: at.y - 24 - age * 30, text: e.text, born: e.born });
      }
      setNotes(out);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, renderer]);

  return (
    <>
      {notes.map((p) => (
        <div key={p.id} className="earn" style={{ left: p.x, top: p.y }}>{p.text}</div>
      ))}
    </>
  );
}

/** What a cargo needs under it, in the words the vehicle list uses. */
/** Where the pipeline writes its rendered thumbnails. */
export function thumb(vehicleId: string): string {
  return `thumbs/veh_${vehicleId.replace(/-/g, '_')}.png`;
}

/**
 * Which vehicles can carry a cargo, by name.
 *
 * Read out of the content, because the content is the only thing that knows. The
 * function this replaces returned invented words — "Box van", "Chilled box" —
 * naming body *shapes* that no vehicle in the catalogue is called. So a panel
 * would say a load wanted a box van, the player would look at a list containing a
 * Transit van, a Rigid 7.5t, an Artic box and an Artic flatbed, and none of them
 * was the thing they had just been told to find.
 *
 * A handling class is a *set* of vehicles and always was. Naming the set after one
 * imaginary member of it was the mistake.
 */
export function carriersFor(handling: string): { id: string; name: string }[] {
  return content().vehicles
    .filter((v) => (v.handling as readonly string[]).includes(handling))
    .map((v) => ({ id: v.id, name: v.name }));
}

/**
 * The vehicles that can carry a cargo, drawn.
 *
 * "Something says it wants a box van, yet there's no such thing. If it means
 * multiple types, it should say what is acceptable as images, and when you hover
 * it tells you." Which is right, and it is also the cheaper answer: the pipeline
 * already renders every vehicle, so the honest version of this constraint is the
 * actual lorries at eighteen pixels, and a tooltip naming them for anybody who
 * wants the words.
 *
 * No text at all in the normal case. A row of three silhouettes says "one of
 * these" without having to find a noun that covers all three — which is the noun
 * that did not exist.
 */
export function Carriers(
  { handling, size = 20 }: { handling: string; size?: number },
): JSX.Element {
  const list = carriersFor(handling);
  const names = list.map((v) => v.name).join(', ');
  /* The renders are 1.3 to 1, so a width and a height rather than a width and a
     guess: `size` was a prop the stylesheet quietly ignored, which meant every
     use of this came out at the one size the CSS happened to set. */
  const box = { width: `${Math.round(size * 1.3)}px`, height: `${size}px` };
  return (
    <span className="carriers" title={names}>
      {list.map((v) => (
        <img
          key={v.id}
          className="carrier"
          style={box}
          src={thumb(v.id)}
          alt={v.name}
          title={v.name}
        />
      ))}
    </span>
  );
}

/**
 * A badge over every lorry that cannot do its job.
 *
 * This is the entire user interface of the winter-tyre rule, and it is why the
 * rule is worth having. A vehicle without winter tyres stops when the snow is
 * down — and a lorry standing still in a white field with **no winter tyres**
 * over it says the whole thing in one glance. The alternative, a modifier on a
 * spreadsheet, is a tax.
 *
 * Follows the vehicle rather than sitting on the yard, because where it stopped
 * is part of the news: a lorry stranded halfway to the creamery is a different
 * problem from one that never left.
 */
export function Alerts({
  world, renderer,
}: {
  world: World;
  renderer: Renderer;
}): JSX.Element {
  type Pin = { v: number; x: number; y: number; z: number; why: string };
  const [pins, setPins] = useState<Pin[]>([]);

  /*
   * Which lorries are stuck, twenty times a second; where the badge sits, every
   * frame. This one used to run its own sixty-hertz loop calling `setState` with
   * a fresh array, which is the shape of thing that locked the renderer up once
   * — and it did not even buy smoothness, because the position it was working so
   * hard to recompute went through React anyway.
   */
  useOverlayTick(() => {
    const size = world.terrain.size;
    const out: Pin[] = [];
    for (const b of world.blockedVehicles()) {
      const tile = Math.min(size * size - 1,
        Math.round(b.z) * size + Math.round(b.x));
      out.push({
        v: b.vehicle, x: b.x, y: world.terrain.height[tile], z: b.z, why: b.reason,
      });
    }
    setPins(out);
  });

  return (
    <>
      {pins.map((p) => (
        <div key={p.v} className="alert" {...anchorAt(p.x, p.y, p.z, { dy: -26 })}>
          <span className="flake">❄</span>{p.why}
        </div>
      ))}
    </>
  );
}
