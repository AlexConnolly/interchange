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

import { useState, type JSX } from 'react';
import { type World } from '@interchange/sim';
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
  world, camX, camZ, tilesAcross, onBought,
}: {
  world: World;
  camX: number;
  camZ: number;
  tilesAcross: number;
  onBought: () => void;
}): JSX.Element {
  /** The block whose price the player has actually pressed, or -1. */
  const [chosen, setChosen] = useState(-1);

  const size = world.config.size;
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

  return (
    <>
      {near.map((s) => {
        const height = world.terrain.height[
          Math.min(size * size - 1, Math.floor(s.c.y) * size + Math.floor(s.c.x))
        ];
        return (
          <button
            key={s.block}
            className={`plot ${chosen === s.block ? 'on' : ''}`}
            {...anchorAt(s.c.x, height / 64 * 0.42, s.c.y)}
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
          <div className="plot-title">Four acres, near enough</div>
          <div className="plot-sub">
            {bounds.x0},{bounds.y0} to {bounds.x1},{bounds.y1}
            {' · '}
            {money(verdict.price)}
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
