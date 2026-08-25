/**
 * A place, in full: what it is, what work it has going, who supplies it, and —
 * once it is yours — who would buy what it makes.
 *
 * The design turn in one line: **a buyer is a place with a requirement, which
 * is a contract seen from the far end.** So before you own a place this panel
 * shows what it offers you; after you own it, the same panel shows who wants
 * what you now have. One component, both directions, no new system.
 *
 * Two things this got wrong first time round and they were the same mistake.
 *
 * It **explained itself in prose** — "its output becomes yours to sell, and
 * owning it widens what you can see" — which is a tooltip for a mechanic the
 * player will meet in ten seconds by pressing the button. Cut. If a rule needs
 * a paragraph the rule is wrong, and if it doesn't, the paragraph is noise.
 *
 * And it **printed distances instead of drawing routes.** "26 tiles" is not an
 * answer to where a job goes. A contract is now a row in a list — where to,
 * what it pays, what body it needs — and hovering it draws the run on the map.
 * Distance is gone entirely: it was never the question, and the map answers the
 * question that was.
 */

import { useState, type JSX } from 'react';
import { type World, ContractState } from '@interchange/sim';
import { content } from '@interchange/data';
import { money, bodyFor } from './Markers.tsx';
import { Icon } from './Icons.tsx';

const C = content();

export interface PlaceActions {
  buy: (site: number) => void;
  supply: (from: number, to: number, cargo: number) => void;
  accept: (contract: number, vehicle: number) => void;
  /** Draw a job on the map: the loaded run, from pickup to drop. */
  preview: (from: number, to: number) => void;
  /** Draw a driver's whole job: empty out of the yard, then loaded. */
  previewDriver: (contract: number, vehicle: number) => void;
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
  const verdict = world.canBuySite(site);
  const supplies = world.suppliersFor(site);

  const stock = (id: string): { name: string; colour: string; have: number } | null => {
    const ci = C.cargoIndex.get(id);
    if (ci === undefined) return null;
    return {
      name: C.cargo[ci].name, colour: C.cargo[ci].colour,
      have: world.sites.stockOf(site, ci),
    };
  };
  const makes = Object.keys(def.recipe.outputs).map(stock).filter((x) => x !== null);

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
        <span className="sheet-icon" style={{ color: def.colour }}>
          <Icon id={def.id} size={26} />
        </span>
        <div className="grow">
          <div className="sheet-title">{def.name}</div>
          <div className="sheet-sub">{mine ? 'Yours' : 'For sale'}</div>
        </div>
        <button className="x" onClick={actions.close} aria-label="Close">×</button>
      </div>

      <div className="sheet-body">
        {makes.length > 0 && (
          <div className="stock">
            {makes.map((m) => (
              <div key={m.name} className="stock-row">
                <span className="swatch" style={{ background: m.colour }} />
                <span className="grow">{m.name}</span>
                <span className="num">{m.have} t</span>
              </div>
            ))}
          </div>
        )}

        {offers.length > 0 && (
          <>
            <div className="head">Work going</div>
            <div className="jobs">
              {offers.map((id) => {
                const cargo = C.cargo[board.cargo[id]];
                const to = C.industries[world.sites.def[board.to[id]]];
                if (assigning === id) {
                  return (
                    <div key={id} className="job open">
                      <span className="job-line">
                        <span className="swatch" style={{ background: cargo.colour }} />
                        <span className="grow">{cargo.name} → {to.name}</span>
                        <span className="pay">{money(board.pay[id])}</span>
                      </span>
                      <Drivers
                        world={world}
                        contract={id}
                        onPick={(v) => {
                          actions.accept(id, v);
                          setAssigning(-1);
                          actions.preview(-1, -1);
                        }}
                        onHover={(v) => (v < 0
                          ? actions.preview(board.from[id], board.to[id])
                          : actions.previewDriver(id, v))}
                        onCancel={() => { setAssigning(-1); actions.preview(-1, -1); }}
                      />
                    </div>
                  );
                }
                return (
                  <button
                    key={id}
                    className="job"
                    onMouseEnter={() => actions.preview(board.from[id], board.to[id])}
                    onMouseLeave={() => actions.preview(-1, -1)}
                    onClick={() => {
                      setAssigning(id);
                      actions.preview(board.from[id], board.to[id]);
                    }}
                  >
                    <span className="job-line">
                      <span className="swatch" style={{ background: cargo.colour }} />
                      <span className="grow">{cargo.name} → {to.name}</span>
                      <span className="pay">{money(board.pay[id])}</span>
                    </span>
                    <span className="job-sub">{bodyFor(cargo.handling)}</span>
                  </button>
                );
              })}
            </div>
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

        {mine && (
          <>
            <div className="head">Who takes it</div>
            {buyers.length === 0 && (
              <div className="why">Nobody within reach is buying what this makes.</div>
            )}
            <div className="jobs">
              {buyers.map((b) => (
                <button
                  key={`${b.site}-${b.cargo}`}
                  className="job"
                  onMouseEnter={() => actions.preview(site, b.site)}
                  onMouseLeave={() => actions.preview(-1, -1)}
                  onClick={() => { actions.supply(site, b.site, b.cargo); actions.preview(-1, -1); }}
                >
                  <span className="job-line">
                    <span className="swatch" style={{ background: C.cargo[b.cargo].colour }} />
                    <span className="grow">
                      {C.cargo[b.cargo].name} → {C.industries[world.sites.def[b.site]].name}
                    </span>
                    <span className="pay">{money(b.pay)}</span>
                  </span>
                  <span className="job-sub">{bodyFor(C.cargo[b.cargo].handling)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {!mine && (
          <>
            <div className="head">Buy it</div>
            <div className="card">
              <div className="card-figures big">
                <span><b>{money(world.priceOf(site))}</b></span>
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
 * often the thing you need to buy next.
 *
 * Hovering a driver draws **their whole job** in two colours: the empty run out
 * of their yard, which earns nothing, and the loaded run, which pays. That is
 * the entire reason this step exists — with two yards the choice between two
 * spare tankers is a choice about unpaid miles, and a single-colour line hides
 * exactly that.
 */
function Drivers({
  world, contract, onPick, onHover, onCancel,
}: {
  world: World;
  contract: number;
  onPick: (vehicle: number) => void;
  onHover: (vehicle: number) => void;
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
          onMouseEnter={() => onHover(d.vehicle)}
          onMouseLeave={() => onHover(-1)}
          onClick={() => onPick(d.vehicle)}
        >
          <span className="grow">
            <span className="driver-name">
              {C.vehicles[world.vehicles.type[d.vehicle]].name}
            </span>
            <span className="driver-where">
              {d.yard >= 0 ? world.yards.names[d.yard] : 'no yard'}
              {d.yard >= 0 && ` · ${d.deadTiles} empty`}
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
 *   **In sight** — the place, named, and clicking takes you there. Hovering
 *   draws the run it would make.
 *   **Unknown** — three question marks, not a button.
 *
 * That last one is the important one. A supplier under fog must not be named:
 * the influence area exists to make the district reveal itself as you earn it,
 * and a panel that says "the creamery at Ashcombe" while Ashcombe is invisible
 * hands you the map for free.
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
        const def = C.industries[world.sites.def[c.site]];
        return (
          <button
            key={c.site}
            className={`driver ${yours ? 'mine' : ''}`}
            onClick={() => onGo(c.site)}
            onMouseEnter={() => onHover(c.site)}
            onMouseLeave={() => onHover(-1)}
          >
            <span className="supply-icon" style={{ color: def.colour }}>
              <Icon id={def.id} size={17} />
            </span>
            <span className="grow">
              <span className="driver-name">{def.name}</span>
            </span>
            <span className="driver-no">{yours ? '✓' : 'go'}</span>
          </button>
        );
      })}
      {group.hidden > 0 && (
        <div className="unknown">
          <span className="qm">???</span>
          {group.hidden === 1
            ? 'somewhere out of reach'
            : `${group.hidden}, somewhere out of reach`}
        </div>
      )}
      {group.candidates.length === 0 && group.hidden === 0 && (
        <div className="why">Nothing in the district makes it.</div>
      )}
    </div>
  );
}
