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
      const c = world.land.centres[s.parcel];
      return { ...s, c, d: Math.hypot(c.x - camX, c.y - camZ) };
    })
    .filter((s) => Math.abs(s.c.x - camX) < reach && Math.abs(s.c.y - camZ) < reach)
    .sort((a, b) => a.d - b.d)
    .slice(0, CHIPS);

  /*
   * Two things a selected field can be: for sale, or already yours.
   *
   * It could only ever be the first, because the only chips on the ground were
   * prices — so land you held was drawn blue and had nothing you could do to it.
   * Releasing a field for housing is the second thing, and it belongs here rather
   * than in the Build tray: what you are choosing is *which field*, and this is
   * the one screen in the game where the map is the list.
   */
  const mine = chosen >= 0 && world.land.owner[chosen] === world.player;
  const verdict = chosen >= 0 && !mine ? world.canBuyLand(world.player, chosen) : null;
  const release = mine ? world.canReleaseForHousing(chosen) : null;
  const gate = mine ? world.housingGate(chosen) : null;

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
  /*
   * Everything you hold as *one* region, not one per field.
   *
   * The renderer draws a border only where a tile's neighbour is outside the set,
   * so handing it every owned tile at once gives the outline of the whole holding —
   * two fields that touch become one shape with one edge round it. Handing it a
   * region per field would draw a hedgerow down the middle of your own land.
   */
  const ownedTiles = world.landOwnedTiles();
  const built: number[] = [];
  for (let p = 0; p < world.land.owner.length; p++) {
    if (world.land.housing(p)) built.push(...world.land.tiles[p]);
  }
  /*
   * And a line round the far edge of what you can reach.
   *
   * The chips stop where your standing stops, and until now there was nothing to
   * say so — a field just beyond the boundary is not marked as too far out, it
   * simply has no price on it, exactly like the water and exactly like somebody
   * else's farm. Reported from play as not realising influence was the thing in
   * the way at all.
   *
   * An outline with no wash: this is a *limit*, and the reachable ground is most of
   * what is on screen. Tinting all of it to say one thing about its border would
   * put a colour over the district to describe its edge.
   */
  const inReach = world.reachTiles();
  const plots = [
    ...(inReach.length > 0
      ? [{ tiles: inReach, edge: PLOT.reachEdge, edgeOnly: true }]
      : []),
    ...(ownedTiles.length > 0
      ? [{ tiles: ownedTiles, wash: PLOT.ownWash, edge: PLOT.ownEdge }]
      : []),
    ...(chosen >= 0
      ? [{ tiles: world.land.tiles[chosen], wash: PLOT.wash, edge: PLOT.edge }]
      : []),
    /*
     * And the fields given over to housing, in their own colour.
     *
     * Blue is "yours" and this is "yours, and settled" — a field you cannot put a
     * works on any more, because there are streets on it. Worth its own wash for
     * the same reason the parish gate got one: the shape of what you have already
     * committed is a thing you plan against.
     */
    ...(built.length > 0
      ? [{ tiles: built, wash: PLOT.builtWash, edge: PLOT.builtEdge }]
      : []),
  ];
  const plotKey = `${inReach.length}:${ownedTiles.length}:${built.length}:${chosen}`;
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
            key={s.parcel}
            className={`plot ${chosen === s.parcel ? 'on' : ''}`}
            {...anchorAt(s.c.x, height, s.c.y)}
            onClick={() => setChosen(chosen === s.parcel ? -1 : s.parcel)}
            title={`${money(s.price)} — ${world.land.acres(s.parcel)} tiles`}
          >
            {money(s.price)}
          </button>
        );
      })}

      {verdict && chosen >= 0 && (
        /*
         * The confirmation, and it is deliberately tiny. The decision was made on
         * the map; this exists to say what it costs and to be a place where the
         * player can change their mind — "you literally just click purchase or
         * back". Anything more would be a form in front of a click.
         */
        <div className="plot-buy">
          <div className="plot-title">{world.landPlaceName(chosen)}</div>
          <div className="plot-sub">
            {world.land.acres(chosen)} tiles · {money(verdict.price)}
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

      {mine && release && gate && chosen >= 0 && (
        /*
         * A field of yours, and the one thing you can do with it.
         *
         * Two separate answers on purpose, because they fail for different reasons
         * and only one of them is fixable today. Whether the ground will take a
         * street is a fact about the ground — frontage, slope, size. Whether
         * anybody will *buy* a house on it is what the parish thinks of you, and
         * that is the whole mechanic: developers will not build where the district
         * is not already doing well, so housing pays you for work you have already
         * done and cannot be rushed.
         *
         * Releasing into a parish that is not ready is allowed, and the plots then
         * sit empty until it is. That is the risk that makes the timing a decision
         * rather than a button.
         */
        <div className="plot-buy">
          <div className="plot-title">{world.landPlaceName(chosen)}</div>
          {world.land.housing(chosen) ? (
            <>
              <div className="plot-sub">
                {world.land.made[chosen]} of {world.land.plots[chosen]} plots
                {' \u00b7 '}
                {money(world.housePrice(chosen))} each
              </div>
              {world.land.made[chosen] >= world.land.plots[chosen]
                ? <div className="plot-note">Finished. The street is up.</div>
                : gate.ok
                  ? <div className="plot-note">Building, a plot a month.</div>
                  : (
                    <div className="why">
                      Nobody is buying out here yet. The parish is at
                      {` ${Math.floor(gate.here)} and wants ${gate.need}.`}
                    </div>
                  )}
              <div className="plot-row">
                <button className="btn" onClick={() => setChosen(-1)}>Back</button>
              </div>
            </>
          ) : (
            <>
              <div className="plot-sub">{world.land.acres(chosen)} tiles · yours</div>
              {release.ok
                ? (
                  <div className="plot-note">
                    {release.plots} plots at {money(world.housePrice(chosen))} each
                    {gate.ok ? '' : `, once the parish is at ${gate.need}`}
                  </div>
                )
                : <div className="why">{release.reason}</div>}
              <div className="plot-row">
                <button className="btn" onClick={() => setChosen(-1)}>Back</button>
                <button
                  className="btn go"
                  disabled={!release.ok}
                  onClick={() => {
                    if (world.releaseForHousing(chosen).ok) {
                      setChosen(-1);
                      onBought();
                    }
                  }}
                >Release for housing</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
