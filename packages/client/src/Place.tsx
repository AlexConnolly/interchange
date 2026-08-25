/**
 * A place, in full: what it is, what it holds, what work is going, and — once
 * it is yours — who would buy what it makes.
 *
 * This is the panel the game is played through, so it is an *overview* rather
 * than a list of whatever happened to be available. Click a farm and you learn
 * what a farm is, before you learn what it is offering. The earlier version put
 * the offer first and read, fairly, as "randomly showing the potential thingy".
 *
 * The design turn in one line: **a buyer is a place with a requirement, which
 * is a contract seen from the far end.** So before you own a place this panel
 * shows what it offers you; after you own it, the same panel shows who wants
 * what you now have. One component, both directions, no new system.
 *
 * Assigning is two steps on purpose. With more than one yard, *which* lorry
 * goes is the decision — a tanker at the far yard and a tanker at the near one
 * are not the same offer — so taking a job asks which driver, shows the yard
 * each one lives at and the empty miles to the pickup, and draws the run on the
 * map while you choose.
 */

import { useState } from 'react';
import { type World, ContractState } from '@interchange/sim';
import { content } from '@interchange/data';
import { money } from './Pins.tsx';

const C = content();

export interface PlaceActions {
  buy: (site: number) => void;
  supply: (from: number, to: number, cargo: number) => void;
  accept: (contract: number, vehicle: number) => void;
  /** Draw a run on the map, or clear it with an empty list. */
  preview: (from: number, to: number) => void;
  /** Take the camera to a place. Only ever called for one you can see. */
  goTo: (site: number) => void;
  close: () => void;
}

export function Place({
  world, site, actions,
}: {
  world: World;
  site: number;
  actions: PlaceActions;
}): JSX.Element | null {
  const [assigning, setAssigning] = useState(-1);

  if (site < 0 || site >= world.sites.count) return null;
  const def = C.industries[world.sites.def[site]];
  const mine = world.sites.owner[site] === world.player;
  const price = world.priceOf(site);
  const cash = world.companies.cash[world.player];
  const reachable = world.influence.usable(world.siteAccessTile[site] ?? -1);
  const verdict = world.canBuySite(site);
  const supplies = world.suppliersFor(site);

  const stock = (id: string): { name: string; colour: string; have: number; cargo: number } | null => {
    const ci = C.cargoIndex.get(id);
    if (ci === undefined) return null;
    return { name: C.cargo[ci].name, colour: C.cargo[ci].colour, have: world.sites.stockOf(site, ci), cargo: ci };
  };
  const makes = Object.keys(def.recipe.outputs).map(stock).filter((x) => x !== null);
  const wants = Object.keys(def.recipe.inputs).map(stock).filter((x) => x !== null);

  const board = world.contractBoard;
  const offers: number[] = [];
  for (let i = 0; i < board.count; i++) {
    if (board.state[i] === ContractState.Offered && board.from[i] === site) offers.push(i);
  }
  const buyers = mine ? world.buyersFor(site).slice(0, 4) : [];

  return (
    <div className="sheet">
      <div className="sheet-bar" style={{ background: def.colour }} />
      <div className="sheet-head">
        <div>
          <div className="sheet-title">{def.name}</div>
          <div className="sheet-sub">
            {mine ? 'Yours' : reachable ? 'For sale' : 'Beyond your reach'}
          </div>
        </div>
        <button className="x" onClick={actions.close} aria-label="Close">×</button>
      </div>

      <div className="sheet-body">
        {(makes.length > 0 || wants.length > 0) && (
          <div className="stock">
            {makes.map((m) => (
              <div key={`o${m.name}`} className="stock-row">
                <span className="swatch" style={{ background: m.colour }} />
                <span className="grow">{m.name}</span>
                <span className="num">{m.have} t</span>
              </div>
            ))}
            {wants.map((w) => (
              <div key={`i${w.name}`} className="stock-row need">
                <span className="swatch" style={{ background: w.colour }} />
                <span className="grow">wants {w.name}</span>
                <span className="num">{w.have} t</span>
              </div>
            ))}
          </div>
        )}

        {offers.length > 0 && <div className="head">Work going</div>}
        {offers.map((id) => (
          <div key={id} className="card">
            <div className="card-line">
              <span className="swatch" style={{ background: C.cargo[board.cargo[id]].colour }} />
              <strong>{C.cargo[board.cargo[id]].name}</strong>
              <span className="to">to {C.industries[world.sites.def[board.to[id]]].name.toLowerCase()}</span>
            </div>
            <div className="card-figures">
              <span><b>{money(board.pay[id])}</b> a load</span>
              <span>{board.distance[id]} tiles</span>
            </div>
            {assigning === id ? (
              <Drivers
                world={world}
                contract={id}
                onPick={(v) => { actions.accept(id, v); setAssigning(-1); actions.preview(-1, -1); }}
                onCancel={() => { setAssigning(-1); actions.preview(-1, -1); }}
              />
            ) : (
              <button
                className="btn primary block"
                onClick={() => {
                  setAssigning(id);
                  actions.preview(board.from[id], board.to[id]);
                }}
              >Assign a driver</button>
            )}
          </div>
        ))}

        {mine && (
          <>
            <div className="head">Who takes it</div>
            {buyers.length === 0 && (
              <div className="note">
                Nobody within reach is buying what this makes. That is what the
                rest of the district is for.
              </div>
            )}
            {buyers.map((b) => (
              <div key={`${b.site}-${b.cargo}`} className="card">
                <div className="card-line">
                  <span className="swatch" style={{ background: C.cargo[b.cargo].colour }} />
                  <strong>{C.industries[world.sites.def[b.site]].name}</strong>
                  <span className="to">takes {C.cargo[b.cargo].name.toLowerCase()}</span>
                </div>
                <div className="card-figures">
                  <span><b>{money(b.pay)}</b> a load</span>
                  <span>{b.distance} tiles</span>
                </div>
                <button
                  className="btn primary block"
                  onMouseEnter={() => actions.preview(site, b.site)}
                  onMouseLeave={() => actions.preview(-1, -1)}
                  onClick={() => { actions.supply(site, b.site, b.cargo); actions.preview(-1, -1); }}
                >Supply them</button>
              </div>
            ))}
          </>
        )}

        {supplies.length > 0 && (
          <>
            <div className="head">Supplied by</div>
            {supplies.map((g) => (
              <Supply
                key={g.cargo}
                world={world}
                group={g}
                onGo={actions.goTo}
                onHover={(to) => actions.preview(to, site)}
              />
            ))}
          </>
        )}

        {!mine && (
          <>
            <div className="head">Buy it</div>
            <div className="card">
              <div className="card-figures big">
                <span><b>{money(price)}</b></span>
              </div>
              <div className="sheet-sub">
                Its output becomes yours to sell, and owning it widens what you
                can see.
              </div>
              <button
                className="btn primary block"
                disabled={!verdict.ok}
                onClick={() => actions.buy(site)}
              >Buy it</button>
              {!verdict.ok && <div className="why">{verdict.reason}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Which driver goes.
 *
 * Suitable lorries first, then nearest, because that is the order a player
 * wants to read them in — and an unsuitable one still appears with its reason,
 * on the same principle as the Vehicles screen: the thing you cannot use is
 * often the thing you need to buy.
 */
function Drivers({
  world, contract, onPick, onCancel,
}: {
  world: World;
  contract: number;
  onPick: (vehicle: number) => void;
  onCancel: () => void;
}): JSX.Element {
  const list = world.driversFor(contract);
  return (
    <div className="drivers">
      {list.length === 0 && (
        <div className="why">Every lorry is out. You need another one.</div>
      )}
      {list.map((d) => (
        <button
          key={d.vehicle}
          className="driver"
          disabled={!d.suitable}
          onClick={() => onPick(d.vehicle)}
        >
          <span className="grow">
            <span className="driver-name">
              {C.vehicles[world.vehicles.type[d.vehicle]].name}
            </span>
            <span className="driver-where">
              {d.yard >= 0 ? world.yards.names[d.yard] : 'no yard'}
              {d.yard >= 0 && ` · ${d.deadTiles} tiles empty`}
            </span>
          </span>
          {!d.suitable && <span className="driver-no">wrong body</span>}
        </button>
      ))}
      <button className="btn block" onClick={onCancel}>Not now</button>
    </div>
  );
}

/**
 * One input, and who could supply it.
 *
 * Three states per candidate and they are deliberately very different to look
 * at, because the whole point of the panel is to answer "what do I have to do
 * next":
 *
 *   **Yours** — a tick. The requirement is met and there is nothing to do.
 *   **In sight** — the place, named, its distance, and clicking takes you
 *   there. Hovering draws the run it would make on the map.
 *   **Unknown** — three question marks, not a button.
 *
 * That last one is the important one. A supplier under fog must not be named:
 * the influence area exists to make the district reveal itself as you earn it,
 * and a panel that tells you "the creamery at Ashcombe" while Ashcombe is
 * invisible hands you the map for free. Saying "two somewhere out there" is
 * better than a name and better than silence — it tells you the chain
 * continues, and that finding it is the game.
 */
function Supply({
  world, group, onGo, onHover,
}: {
  world: World;
  group: {
    cargo: number; owned: boolean;
    candidates: { site: number; distance: number; visible: boolean }[];
    hidden: number;
  };
  onGo: (site: number) => void;
  onHover: (site: number) => void;
}): JSX.Element {
  const cargo = C.cargo[group.cargo];
  return (
    <div className={`card supply ${group.owned ? 'met' : ''}`}>
      <div className="card-line">
        <span className="swatch" style={{ background: cargo.colour }} />
        <strong>{cargo.name}</strong>
        {group.owned
          ? <span className="have">✓ yours</span>
          : <span className="to">needed</span>}
      </div>
      {group.candidates.map((c) => {
        const yours = world.sites.owner[c.site] === world.player;
        return (
          <button
            key={c.site}
            className={`driver ${yours ? 'mine' : ''}`}
            onClick={() => onGo(c.site)}
            onMouseEnter={() => onHover(c.site)}
            onMouseLeave={() => onHover(-1)}
          >
            <span className="grow">
              <span className="driver-name">
                {C.industries[world.sites.def[c.site]].name}
              </span>
              <span className="driver-where">
                {c.distance} tiles{yours ? ' · yours' : ''}
              </span>
            </span>
            <span className="driver-no">{yours ? '✓' : 'go'}</span>
          </button>
        );
      })}
      {group.hidden > 0 && (
        <div className="unknown">
          {group.candidates.length > 0 ? 'and ' : ''}
          <span className="qm">???</span>
          {group.hidden === 1
            ? ' one more, somewhere out of reach'
            : ` ${group.hidden} more, somewhere out of reach`}
        </div>
      )}
      {group.candidates.length === 0 && group.hidden === 0 && (
        <div className="why">Nothing in the district makes it.</div>
      )}
    </div>
  );
}
