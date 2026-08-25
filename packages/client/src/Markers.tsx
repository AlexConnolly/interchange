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

import { useEffect, useState, type JSX } from 'react';
import { ContractState, type World } from '@interchange/sim';
import { content } from '@interchange/data';
import type { Renderer } from '@interchange/render';
import { Icon } from './Icons.tsx';

const C = content();

interface Marked {
  key: string;
  site: number;
  yard: number;
  id: string;
  name: string;
  mine: boolean;
  work: boolean;
  x: number;
  y: number;
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

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);

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
        tile: number, mine: boolean, work: boolean,
      ): void => {
        const x = tile % size;
        const z = Math.floor(tile / size);
        const at = renderer.project(x + 0.5, world.terrain.height[tile], z + 0.5);
        if (!at) return;
        out.push({ key, site, yard, id, name, mine, work, x: at.x, y: at.y });
      };

      for (let s = 0; s < world.sites.count; s++) {
        if (s === hide) continue;
        const tile = world.siteAccessTile[s];
        if (tile < 0 || !world.influence.usable(tile)) continue;
        const def = C.industries[world.sites.def[s]];
        put(`s${s}`, s, -1, def.id, def.name, tile,
            world.sites.owner[s] === world.player, working.has(s));
      }
      for (let y = 0; y < world.yards.count; y++) {
        if (world.yards.owner[y] !== world.player) continue;
        const tile = world.yards.tile[y];
        if (tile < 0) continue;
        put(`y${y}`, -1, y, 'yard', world.yards.names[y], tile, true, false);
      }
      setMarks(out);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, renderer, hide]);

  return (
    <>
      {marks.map((m) => (
        <button
          key={m.key}
          className={`mark ${m.mine ? 'mine' : ''} ${m.work ? 'working' : ''}`}
          style={{ left: m.x, top: m.y }}
          onClick={() => (m.yard >= 0 ? onOpenYard(m.yard) : onOpenSite(m.site))}
          title={m.name}
        >
          <span className="mark-face"><Icon id={m.id} /></span>
          {m.work && <span className="mark-dot" />}
          <span className="mark-tail" />
        </button>
      ))}
    </>
  );
}

/** Money, as a haulier would say it. */
export function money(pence: number): string {
  const p = Math.round(pence);
  if (Math.abs(p) >= 100_000_00) return `£${(p / 100_000_00).toFixed(1)}m`;
  if (Math.abs(p) >= 1_000_00) return `£${Math.round(p / 100).toLocaleString('en-GB')}`;
  return `£${(p / 100).toFixed(2)}`;
}

/** What a cargo needs under it, in the words the vehicle list uses. */
export function bodyFor(handling: string): string {
  if (handling === 'refrigerated') return 'Chilled box';
  if (handling === 'liquid') return 'Tanker';
  if (handling === 'bulk') return 'Tipper';
  return 'Box van';
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
  const [pins, setPins] = useState<{ v: number; x: number; y: number; why: string }[]>([]);

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const size = world.terrain.size;
      const out: { v: number; x: number; y: number; why: string }[] = [];
      for (const b of world.blockedVehicles()) {
        const tile = Math.min(size * size - 1,
          Math.round(b.z) * size + Math.round(b.x));
        const at = renderer.project(b.x, world.terrain.height[tile], b.z);
        if (!at) continue;
        out.push({ v: b.vehicle, x: at.x, y: at.y - 26, why: b.reason });
      }
      setPins(out);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, renderer]);

  return (
    <>
      {pins.map((p) => (
        <div key={p.v} className="alert" style={{ left: p.x, top: p.y }}>
          <span className="flake">❄</span>{p.why}
        </div>
      ))}
    </>
  );
}
