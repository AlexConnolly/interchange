/**
 * A place, in full — as a bubble over the place itself, in three tabs.
 *
 * The design turn in one line: **a buyer is a place with a requirement, which
 * is a contract seen from the far end.** So before you own a place this panel
 * shows what it offers you; after you own it, the same panel shows who wants
 * what you now have. One component, both directions, no new system.
 *
 * Three things this got wrong, and they were all the same mistake — putting
 * everything on screen at once and letting the player sort it out.
 *
 * It **explained itself in prose** ("its output becomes yours to sell, and
 * owning it widens what you can see"), which is a tooltip for a mechanic the
 * player meets ten seconds later by pressing the button. Cut.
 *
 * It **printed distances instead of drawing routes.** "26 tiles" is not an
 * answer to where a job goes. Hovering a job draws the run on the map now, and
 * distance is gone entirely.
 *
 * The bubble takes the `Renderer` directly rather than a "where is this place"
 * callback threaded through the actions object. The callback version silently
 * returned null for ever: the follow loop captures `actions` on mount and only
 * re-subscribes when the site changes, so it held one particular closure for
 * the panel's whole life. Asking the renderer where a place is is exactly what
 * `Markers` does, and the panel is the same kind of object — a thing that has
 * to sit over a point in the world.
 *
 * And it was **one long scroll** — stock, then work, then suppliers, then the
 * buy panel, all at once, in a box floating in the corner with no visible
 * connection to the place it described. Now it is a bubble with an arrow
 * pointing at the business, and three tabs: what it is, what work it has, who
 * supplies it. Each tab answers one question, and the tab strip is the summary —
 * the counts on the tabs are the overview.
 */

import { useEffect, useState, type JSX } from 'react';
import { type World, ContractState } from '@interchange/sim';
import { content } from '@interchange/data';
import type { Renderer } from '@interchange/render';
import { money, bodyFor, useAnchor } from './Markers.tsx';
import { anchorAt } from './anchor.ts';
import { BodyIcon, Icon } from './Icons.tsx';

const C = content();

/**
 * What a job is worth an hour, using the best lorry you have for it.
 *
 * The *best* suitable one rather than an average, because that is the one you
 * would send. Zero when you own nothing that can do it, and the row then falls
 * back to the tonne rate — an hourly figure for a vehicle you do not have is a
 * number about a hypothesis.
 */
function perHour(world: World, contract: number): number {
  let best = 0;
  for (const d of world.driversFor(contract)) {
    if (!d.suitable) continue;
    const rate = world.contractPerHour(contract, d.vehicle);
    if (rate > best) best = rate;
  }
  return best;
}

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

type Tab = 'about' | 'work' | 'supply';

/** Half the bubble's width, for clamping it on screen. Matches the CSS. */
const HALF = 156;

export function Place({
  world, renderer, site, actions,
}: {
  world: World;
  renderer: Renderer;
  site: number;
  actions: PlaceActions;
}): JSX.Element | null {
  const [tab, setTab] = useState<Tab>('about');
  const [assigning, setAssigning] = useState(-1);
  /*
   * Follow the place.
   *
   * The camera glides when a place is opened, and the bubble has to stay on it
   * the whole way — one that snaps into position after the camera stops is worse
   * than one that never moved.
   */
  const anchor = useAnchor(world, renderer, world.siteAccessTile[site] ?? -1);

  // A new place resets to its first tab: the question "what is this" comes
  // before "what is it offering", always.
  useEffect(() => { setTab('about'); setAssigning(-1); }, [site]);

  if (site < 0 || site >= world.sites.count) return null;
  const def = C.industries[world.sites.def[site]];
  const mine = world.sites.owner[site] === world.player;
  const verdict = world.canBuySite(site);
  const supplies = world.suppliersFor(site);

  const board = world.contractBoard;
  const offers: number[] = [];
  for (let i = 0; i < board.count; i++) {
    if (board.state[i] === ContractState.Offered && board.from[i] === site) offers.push(i);
  }
  const buyers = mine ? world.buyersFor(site).slice(0, 4) : [];
  const jobs = offers.length + buyers.length;

  /*
   * Above the place, or below it if there is no room above.
   *
   * Flipping rather than clamping, because a clamped bubble's arrow points at
   * nothing — and an arrow pointing at nothing is worse than no arrow, since it
   * actively asserts a connection that is not there.
   */
  const below = anchor !== null && anchor.y < 330;
  const adrift = anchor === null;

  return (
    <div
      className={`bubble ${below ? 'below' : ''} ${adrift ? 'adrift' : ''}`}
      style={adrift ? { left: window.innerWidth / 2, top: 90 } : undefined}
      {...(anchor === null ? {} : anchorAt(anchor.wx, anchor.wy, anchor.wz, {
        dy: below ? 20 : -26, clamp: HALF + 10,
      }))}
    >
      <div className="sheet-head">
        <span className="sheet-icon" style={{ color: def.colour }}>
          <Icon id={def.id} size={24} />
        </span>
        <div className="grow">
          <div className="sheet-title">{def.name}</div>
          <div className="sheet-sub">{mine ? 'Yours' : 'For sale'}</div>
        </div>
        <button className="x" onClick={actions.close} aria-label="Close">×</button>
      </div>

      {/*
        * The tab strip, and the counts on it are the overview.
        * "Work 2 · Supply 1" tells you what this place is for before you have
        * opened anything, which is what the old single scroll was trying to do
        * by showing all three at once.
        */}
      <div className="tabs" role="tablist">
        <button
          className={`tab ${tab === 'about' ? 'on' : ''}`}
          onClick={() => setTab('about')}
        >About</button>
        <button
          className={`tab ${tab === 'work' ? 'on' : ''}`}
          onClick={() => setTab('work')}
          disabled={jobs === 0}
        >Work{jobs > 0 && <em>{jobs}</em>}</button>
        <button
          className={`tab ${tab === 'supply' ? 'on' : ''}`}
          onClick={() => setTab('supply')}
          disabled={supplies.length === 0}
        >Supply{supplies.length > 0 && <em>{supplies.length}</em>}</button>
      </div>

      <div className="bubble-body">
        {tab === 'about' && (
          <About world={world} site={site} mine={mine} verdict={verdict} actions={actions} />
        )}

        {tab === 'work' && (
          <>
            {offers.map((id) => {
              const cargo = C.cargo[board.cargo[id]];
              const to = C.industries[world.sites.def[board.to[id]]];
              if (assigning === id) {
                return (
                  <div key={id} className="job open">
                    <span className="job-line">
                      <span className="swatch" style={{ background: cargo.colour }} />
                      <span className="grow">{cargo.name} → {to.name}</span>
                      <span className="pay">{money(board.pay[id])}<i>/t</i></span>
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
              const can = world.fleetCanCarry(board.cargo[id]);
              const hourly = perHour(world, id);
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
                    {/*
                      * Per hour, not per tonne. A rate per tonne is not
                      * comparable between two offers — a short run in a van and
                      * a long run in an artic can pay the same per tonne and
                      * differ fourfold in what they are worth — and comparing
                      * them is the only thing a player wants to do with it.
                      * Falls back to the tonne rate when you own nothing that
                      * could take the job, because an hourly figure for a lorry
                      * you do not have is a number about a hypothesis.
                      */}
                    {hourly > 0
                      ? <span className="pay">{money(hourly)}<i>/hr</i></span>
                      : <span className="pay dim">{money(board.pay[id])}<i>/t</i></span>}
                  </span>
                  <span className={`needs ${can ? '' : 'cannot'}`}>
                    <BodyIcon handling={cargo.handling} />
                    {bodyFor(cargo.handling)}
                    {!can && <b>you have none</b>}
                  </span>
                </button>
              );
            })}

            {buyers.length > 0 && <div className="head">Who takes it</div>}
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
                  <span className="pay">{money(b.pay)}<i>/t</i></span>
                </span>
                <span className={`needs ${world.fleetCanCarry(b.cargo) ? '' : 'cannot'}`}>
                  <BodyIcon handling={C.cargo[b.cargo].handling} />
                  {bodyFor(C.cargo[b.cargo].handling)}
                </span>
              </button>
            ))}
          </>
        )}

        {tab === 'supply' && supplies.map((g) => (
          <Supply
            key={g.cargo}
            world={world}
            group={g}
            onGo={actions.goTo}
            onHover={(to) => actions.preview(to, site)}
          />
        ))}
      </div>
      <span className="bubble-arrow" />
    </div>
  );
}

/**
 * What this place is: what it holds, and what it costs.
 *
 * The first tab, and it answers "what am I looking at" — which is the question
 * a player has when they click something, and which the old panel answered
 * fourth, after two lists and a price.
 */
function About({
  world, site, mine, verdict, actions,
}: {
  world: World;
  site: number;
  mine: boolean;
  verdict: { ok: boolean; reason: string };
  actions: PlaceActions;
}): JSX.Element {
  const def = C.industries[world.sites.def[site]];
  const rows = (ids: string[], want: boolean): JSX.Element[] => ids.flatMap((id) => {
    const ci = C.cargoIndex.get(id);
    if (ci === undefined) return [];
    return [(
      <div key={`${want ? 'i' : 'o'}${id}`} className={`stock-row ${want ? 'need' : ''}`}>
        <span className="swatch" style={{ background: C.cargo[ci].colour }} />
        <span className="grow">{want ? `wants ${C.cargo[ci].name}` : C.cargo[ci].name}</span>
        <span className="num">{world.sites.stockOf(site, ci)} t</span>
      </div>
    )];
  });

  return (
    <>
      <div className="stock">
        {rows(Object.keys(def.recipe.outputs), false)}
        {rows(Object.keys(def.recipe.inputs), true)}
      </div>
      {!mine && (
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
      )}
    </>
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
 * at, because the whole point of this tab is to answer "what do I have to do
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
