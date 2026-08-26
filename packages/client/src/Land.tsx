/**
 * Land for sale, as squares on the map with prices on them.
 *
 * The one screen in the game that is not a screen. Everything else the player
 * buys is chosen from a list — a lorry from the catalogue, a business from its own
 * panel — but land is *the map*: which square, and what is next to it, is the
 * entire decision, and a list of coordinates could not put that question. So the
 * prices go on the ground and the panel is one line of confirmation.
 *
 * ## Why it reads the world every frame
 *
 * What is for sale changes whenever a road is laid, a business is bought, or the
 * fog moves — and every one of those is something the player is doing while this is
 * open. A cached list would go stale in exactly the moments it mattered, so the
 * offer is recomputed from the world each render. A thousand blocks with a cheap
 * test each costs nothing next to a frame of the district.
 */

import { useEffect, useState, type JSX } from 'react';
import { type World } from '@interchange/sim';
import { type Renderer, PLOT } from '@interchange/render';
import { money } from './Markers.tsx';
import { anchorAt } from './anchor.ts';

/**
 * How many price chips to draw at once.
 *
 * Sixty is more than fits on a screen at any sane zoom, and the cap is there for
 * the case where it does not: a hundred and fifty little labels over a valley is
 * not a market, it is wallpaper. Nearest to the middle of the view first, so the
 * ones that survive the cap are the ones being looked at.
 */
const CHIPS = 60;

export function Land({
  world, renderer, src, camX, camZ, tilesAcross, onBought,
}: {
  world: World;
  renderer: Renderer;
  src: Parameters<Renderer['showPlots']>[1];
  camX: number;
  camZ: number;
  tilesAcross: number;
  onBought: () => void;
}): JSX.Element {
  /** The block whose price the player has actually pressed, or -1. */
  const [chosen, setChosen] = useState(-1);

  const forSale = world.landForSale();

  /*
   * Only what is in view, nearest the middle first. The map is the interface here,
   * so a chip for a block off the edge of the screen is not information, it is
   * work for the browser.
   */
  const reach = tilesAcross * 0.75;
  const near = forSale
    .map((s) => {
      const c = world.land.centre(s.block);
      return { ...s, c, d: Math.hypot(c.x - camX, c.y - camZ) };
    })
    .filter((s) => Math.abs(s.c.x - camX) < reach && Math.abs(s.c.y - camZ) < reach)
    .sort((a, b) => a.d - b.d)
    .slice(0, CHIPS);

  const verdict = chosen >= 0 ? world.canBuyLand(world.player, chosen) : null;
  const bounds = chosen >= 0 ? world.land.bounds(chosen) : null;

  /*
   * The squares on the ground: blue for what you hold, green for what you are
   * choosing. Drawn by the renderer, because they follow the terrain.
   *
   * An effect rather than a call in the render body, so the *teardown* is
   * somewhere — a highlight left behind is the same bug as a route line left on
   * the map, and that one took two goes to notice. Closing the tool unmounts this
   * component, which clears it.
   *
   * Keyed on a string rather than on the arrays, because the owned list is rebuilt
   * every render and a dependency on it would re-run this sixty times a second.
   */
  const owned = world.landOwned();
  const plots = [
    ...owned.map((b) => ({
      ...world.land.bounds(b), wash: PLOT.ownWash, edge: PLOT.ownEdge,
    })),
    ...(bounds ? [{ ...bounds, wash: PLOT.wash, edge: PLOT.edge }] : []),
  ];
  const plotKey = plots.map((r) => `${r.x0},${r.y0},${r.wash[0]}`).join('|');
  useEffect(() => {
    renderer.showPlots(plots, src);
    return () => renderer.showPlots([], src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, src, plotKey]);

  return (
    <>
      {/*
        * Somewhere to click that means "not that one".
        *
        * Behind the price chips and over everything else, so a press on open
        * country deselects — which is the gesture anybody tries first and the one
        * the panel's Back button is only a formal version of. It exists only while
        * something is selected, so it never eats a click that had somewhere else
        * to go.
        */}
      {chosen >= 0 && (
        <button
          className="plot-away"
          onClick={() => setChosen(-1)}
          aria-label="Nothing selected"
        />
      )}

      {near.map((s) => {
        /*
         * The *raw* heightmap value, because that is what the projector takes.
         *
         * This is where "the prices and positions make no sense" came from, and it
         * was a unit mismatch rather than a maths error. `renderer.project` converts
         * a heightmap sample into world height itself — every other anchored thing
         * in the game passes `terrain.height[tile]` straight in — and I passed the
         * already-converted world height, about 3.3 where the raw value was 498. So
         * every chip was projected as though its field were at sea level, which put
         * it a couple of hundred pixels below the square it belonged to.
         *
         * Sampled at the block's middle tile. Interpolating would be more precise
         * and pointless: the label sits at the centre of sixteen tiles, and a tile
         * of slope is smaller than the label.
         */
        const mid = Math.floor(s.c.y) * world.config.size + Math.floor(s.c.x);
        const height = world.terrain.height[mid];
        return (
          <button
            key={s.block}
            className={`plot ${chosen === s.block ? 'on' : ''}`}
            {...anchorAt(s.c.x, height, s.c.y)}
            onClick={() => setChosen(chosen === s.block ? -1 : s.block)}
            title={`${money(s.price)} — four tiles by four`}
          >
            {money(s.price)}
          </button>
        );
      })}

      {verdict && bounds && (
        /*
         * The confirmation, and it is deliberately tiny. The decision was made on
         * the map; this exists to say what it costs and to be a place where the
         * player can change their mind — "you literally just click purchase or
         * back". Anything more would be a form in front of a click.
         */
        <div className="plot-buy">
          <div className="plot-title">{world.landPlaceName(chosen)}</div>
          <div className="plot-sub">
            Four tiles by four · {money(verdict.price)}
          </div>
          {!verdict.ok && <div className="why">{verdict.reason}</div>}
          <div className="plot-row">
            <button className="btn" onClick={() => setChosen(-1)}>Back</button>
            <button
              className="btn go"
              disabled={!verdict.ok}
              onClick={() => {
                if (world.buyLand(chosen).ok) {
                  setChosen(-1);
                  onBought();
                }
              }}
            >Buy it</button>
          </div>
        </div>
      )}
    </>
  );
}
