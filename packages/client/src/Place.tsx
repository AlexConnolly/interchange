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
import { type World, ContractState, MoneyKind, SiteState, STATE_NAMES } from '@interchange/sim';
import { content } from '@interchange/data';
import type { Renderer } from '@interchange/render';
import { money, Carriers, thumb, useAnchor, placeThumb } from './Markers.tsx';
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
export function perHour(world: World, contract: number): number {
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
  supply: (from: number, to: number, cargo: number, vehicle?: number) => void;
  /** Take the lorry off a standing run of yours. */
  endRun: (service: number) => void;
  accept: (contract: number, vehicle: number) => void;
  /** Draw a job on the map: the loaded run, from pickup to drop. */
  preview: (from: number, to: number) => void;
  /**
   * Draw a *contract's* loaded run.
   *
   * Apart from `preview` because a contract's far end may be a village, and a
   * town index handed to the site table names whichever business shares its
   * number. Everything else this panel previews is a run between two businesses.
   */
  previewContract: (contract: number) => void;
  /** Draw a driver's whole job: empty out of the yard, then loaded. */
  previewDriver: (contract: number, vehicle: number) => void;
  /** Shut a place of yours, or open it again. */
  pause: (site: number) => void;
  resume: (site: number) => void;
  /** Take the camera to a place. Only ever called for one you can see. */
  goTo: (site: number) => void;
  close: () => void;
}

type Tab = 'about' | 'work' | 'supply' | 'money';

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
   * The supply sub-view: which input we are arranging, and where from.
   *
   * A page of its own rather than a third level of unfolding inside a card.
   * Everything about arranging a run — which producer, which lorry — lives here,
   * the bubble's own header turns into a back chevron while it is open, and the
   * tab strip goes away because there is nothing to switch to from inside a
   * decision. That is the "sliding UI with a back button" this wanted: one thing
   * on screen, one way back.
   */
  const [arranging, setArranging] = useState<
    { cargo: number; from: number; to: number; outward: boolean } | null
  >(null);
  /*
   * Did we just come *back* from the sub-view? Only then does the main page slide
   * in from the left — opening the panel fresh should not animate as though you
   * had pressed back on something.
   */
  const [came, setCame] = useState(false);
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
  useEffect(() => {
    setTab('about');
    setAssigning(-1);
    setArranging(null);
    setCame(false);
  }, [site]);

  /*
   * The route line cannot outlive the row that asked for it.
   *
   * It is drawn on hover and cleared on un-hover, which is fine until the row
   * stops existing while the pointer is still over it — close the panel, switch
   * tab, drill into the arrange page, and `onMouseLeave` never fires because
   * there is nothing left to leave. The line then stays on the map for ever with
   * nothing on screen explaining it: "the lines between the A to B can sometimes
   * be retained so the yellow thing is there."
   *
   * A hover is a *transient* thing owned by whatever is showing, so clearing it
   * belongs in a teardown rather than in every handler that might be the last
   * one. This runs on unmount and whenever the view changes underneath it, which
   * is every way a row can vanish.
   */
  useEffect(() => () => actions.preview(-1, -1), [actions, site, tab, arranging]);

  if (site < 0 || site >= world.sites.count) return null;
  const def = C.industries[world.sites.def[site]];
  const mine = world.sites.owner[site] === world.player;
  const verdict = world.canBuySite(site);
  const supplies = world.suppliersFor(site);
  /*
   * The mirror of `supplies`: one group per thing this place makes, with the
   * buyers in reach inside it. Only for a place of yours — somebody else's
   * output is *their* business, and what they offer you is a contract.
   */
  const outputs = mine ? world.buyerGroups(site) : [];

  const board = world.contractBoard;
  /*
   * What is going on here, taken or not.
   *
   * Only the untaken offers used to be listed, so the moment you put a lorry on a
   * job it vanished from the place it came from — "why can't we show the
   * contracts of a place even if we are fulfilling it?" There is no good answer:
   * a business you are already serving is exactly the one you most want to open,
   * to see whether the lorry is keeping up with what the yard is producing.
   *
   * Two lists rather than one, because they afford different things. An offer is
   * a button that opens the driver picker; a job in hand is a statement, and
   * making it look pressable would promise something it cannot do.
   */
  const offers: number[] = [];
  const running: number[] = [];
  for (let i = 0; i < board.count; i++) {
    if (board.from[i] !== site) continue;
    const st = board.state[i];
    if (st === ContractState.Offered) offers.push(i);
    else if (st === ContractState.Running || st === ContractState.Idle) running.push(i);
  }
  /** Which lorry is on a contract, or -1. */
  const driverOf = (id: number): number => {
    for (let v = 0; v < world.vehicles.count; v++) {
      if (world.vehicles.alive[v] && world.vehicles.service[v] === board.service[id]) return v;
    }
    return -1;
  };
  const buyers = mine ? world.buyersFor(site).slice(0, 4) : [];
  const jobs = offers.length + running.length + buyers.length;

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
        {arranging ? (
          <button
            className="x"
            data-quiet
            onClick={() => { setArranging(null); setCame(true); }}
            aria-label="Back"
          >‹</button>
        ) : (
          /* The place itself, rendered, at the head of its own panel. A glyph
             said which *sort* of works this was; the render says which works. */
          <img className="sheet-thumb" src={placeThumb(def.id)} alt="" />
        )}
        <div className="grow">
          <div className="sheet-title">
            {arranging ? `Bring in ${C.cargo[arranging.cargo].name.toLowerCase()}` : def.name}
          </div>
          <div className="sheet-sub">
            {arranging ? def.name : mine ? 'Yours' : 'For sale'}
          </div>
        </div>
        <button className="x" onClick={actions.close} aria-label="Close">×</button>
      </div>

      {/*
        * The tab strip, and the counts on it are the overview.
        * "Work 2 · Supply 1" tells you what this place is for before you have
        * opened anything, which is what the old single scroll was trying to do
        * by showing all three at once.
        */}
      {arranging ? (
        <div className="bubble-body slide-in">
          <Arrange
            world={world}
            site={site}
            cargo={arranging.cargo}
            from={arranging.from}
            to={arranging.to}
            outward={arranging.outward}
            onOther={(other) => setArranging(arranging.outward
              ? { ...arranging, to: other }
              : { ...arranging, from: other })}
            onHover={(other) => (arranging.outward
              ? actions.preview(site, other)
              : actions.preview(other, site))}
            onAssign={(vehicle) => {
              actions.supply(arranging.from, arranging.to, arranging.cargo, vehicle);
              actions.preview(-1, -1);
              setArranging(null);
            }}
          />
        </div>
      ) : (
        <>
      {/*
        * In and Out, not "Work" and "Supply".
        *
        * "It's not work. If I own it, it's not work" — quite right, and the two
        * words were doing three jobs between them. What a place has going on is
        * goods arriving and goods leaving, and that is true whether you own it or
        * somebody else does: for a place of yours, In is what you have to arrange
        * and Out is what it sells; for anybody else's, In is who could supply it
        * and Out is the work they are offering. One pair of words, both readings.
        */}
      <div className="tabs" role="tablist">
        <button
          className={`tab ${tab === 'about' ? 'on' : ''}`}
          onClick={() => setTab('about')}
        >About</button>
        {/*
          * What Out counts depends on whose place it is, because Out means
          * different things: your own goods leaving, or the work somebody else is
          * offering. Gating both on the contract count left the tab dead on a
          * place of yours that had stock and no contracts — which is most of them,
          * most of the time.
          */}
        <button
          className={`tab ${tab === 'work' ? 'on' : ''}`}
          onClick={() => setTab('work')}
          disabled={mine ? outputs.length === 0 : jobs === 0}
        >
          Out
          {(mine ? outputs.length : jobs) > 0 && <em>{mine ? outputs.length : jobs}</em>}
        </button>
        <button
          className={`tab ${tab === 'supply' ? 'on' : ''}`}
          onClick={() => setTab('supply')}
          disabled={supplies.length === 0}
        >In{supplies.length > 0 && <em>{supplies.length}</em>}</button>
        {/*
          * Only for a place of yours, because it is the only place the question
          * makes sense. Somebody else's creamery has accounts and they are not
          * yours to read.
          */}
        {mine && (
          <button
            className={`tab ${tab === 'money' ? 'on' : ''}`}
            onClick={() => setTab('money')}
          >Money</button>
        )}
      </div>

      <div className={`bubble-body${came ? ' slide-back' : ''}`}>
        {/*
          * Cut off from the road, above everything, on every tab.
          *
          * Above the tabs' content rather than inside the About tab, because it is
          * not a fact about the business - it is the reason nothing on any of the
          * other tabs is happening. A player who opens In, sees a contract listed
          * and no lorry moving needs the explanation *there*, and the alternative
          * is repeating it three times.
          *
          * It says what to do rather than what is wrong. "No road access" is a
          * diagnosis; "lay a track to it" is the fix, and the fix is one tool away.
          */}
        {world.siteStranded(site) && (
          <div className="alarm">
            <span className="alarm-mark">!</span>
            <span className="grow">
              <b>No road to it.</b>
              {' Nothing is running here: no work, no deliveries, no production.'}
              {' Lay a track to the works and it starts again.'}
            </span>
          </div>
        )}
        {tab === 'about' && (
          <About world={world} site={site} mine={mine} verdict={verdict} actions={actions} />
        )}

        {/*
          * For a place of yours, Out is *your goods leaving* — one row per cargo,
          * exactly mirroring In. It used to be two lists with a heading between
          * them reading "Where it goes", which answered a question nobody had
          * asked in words nobody could parse: "what's the split between the out
          * thing with two things on it then a Where it goes section?" There is no
          * split now. Choosing a destination happens on the Arrange page, which is
          * where choosing belongs.
          *
          * For somebody else's place, Out is the work it is offering — which is
          * what a contract is, and needs no rewording.
          */}
        {tab === 'work' && mine && outputs.map((g) => (
          <Supply
            key={`out-${g.cargo}`}
            world={world}
            site={site}
            mine
            outward
            group={g}
            onGo={actions.goTo}
            onHover={(to) => actions.preview(site, to)}
            onArrange={(cargo, from, to) => {
              setCame(false);
              setArranging({ cargo, from, to, outward: true });
            }}
            onEnd={actions.endRun}
          />
        ))}

        {tab === 'work' && !mine && (
          <>
            {running.map((id) => {
              const cargo = C.cargo[board.cargo[id]];
              const toName = world.contractToName(id);
              const v = driverOf(id);
              return (
                <div
                  key={`r${id}`}
                  className="job taken"
                  onMouseEnter={() => actions.previewContract(id)}
                  onMouseLeave={() => actions.preview(-1, -1)}
                >
                  <span className="job-line">
                    <span className="swatch" style={{ background: cargo.colour }} />
                    <span className="grow">{cargo.name} → {toName}</span>
                    <span className="pay">{money(board.pay[id])}<i>/t</i></span>
                  </span>
                  <span className={`needs ${v >= 0 ? '' : 'cannot'}`}>
                    <BodyIcon handling={cargo.handling} />
                    {v >= 0
                      ? `${C.vehicles[world.vehicles.type[v]].name} · ${board.delivered[id]} loads`
                      : <Carriers handling={cargo.handling} size={17} />}
                    {v >= 0 ? <em>yours</em> : <b>nobody on it</b>}
                  </span>
                </div>
              );
            })}
            {offers.map((id) => {
              const cargo = C.cargo[board.cargo[id]];
              const toName = world.contractToName(id);
              if (assigning === id) {
                return (
                  <div key={id} className="job open">
                    <span className="job-line">
                      <span className="swatch" style={{ background: cargo.colour }} />
                      <span className="grow">{cargo.name} → {toName}</span>
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
                        ? actions.previewContract(id)
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
                  onMouseEnter={() => actions.previewContract(id)}
                  onMouseLeave={() => actions.preview(-1, -1)}
                  onClick={() => {
                    setAssigning(id);
                    actions.previewContract(id);
                  }}
                >
                  <span className="job-line">
                    <span className="swatch" style={{ background: cargo.colour }} />
                    <span className="grow">{cargo.name} → {toName}</span>
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
                    <Carriers handling={cargo.handling} size={17} />
                    {!can && <b>you have none</b>}
                  </span>
                </button>
              );
            })}

          </>
        )}

        {tab === 'money' && <Money world={world} site={site} />}

        {tab === 'supply' && supplies.map((g) => (
          <Supply
            key={g.cargo}
            world={world}
            site={site}
            mine={mine}
            group={g}
            onGo={actions.goTo}
            onHover={(to) => actions.preview(to, site)}
            onArrange={(cargo, from, to) => {
              setCame(false);
              setArranging({ cargo, from, to, outward: false });
            }}
            onEnd={actions.endRun}
          />
        ))}
      </div>
        </>
      )}
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
  const paused = world.sites.state[site] === SiteState.Paused;
  const rows = (ids: string[], want: boolean): JSX.Element[] => ids.flatMap((id) => {
    const ci = C.cargoIndex.get(id);
    if (ci === undefined) return [];
    /*
     * The rate as well as the level, and for outputs it is the more useful of
     * the two by a distance.
     *
     * Stock is what is standing in the yard right now; production is what will
     * be there tomorrow and the day after. "Is this worth buying" is a question
     * about the flow, and the panel could only answer about the level — so the
     * only way to find out was to buy it and watch. A dairy making eight tonnes
     * a day and one making two look identical the moment they have both got
     * twelve tonnes in the churns.
     */
    const perDay = want ? 0 : world.outputPerDay(site, ci);
    return [(
      <div key={`${want ? 'i' : 'o'}${id}`} className={`stock-row ${want ? 'need' : ''}`}>
        <span className="swatch" style={{ background: C.cargo[ci].colour }} />
        <span className="grow">
          {want ? `wants ${C.cargo[ci].name}` : C.cargo[ci].name}
          {perDay > 0 && <em className="rate">{perDay.toFixed(perDay < 10 ? 1 : 0)} t a day</em>}
        </span>
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
          {/*
            * And what it will cost you *every week* after that.
            *
            * Beside the purchase price rather than anywhere else, because it is
            * the half of the decision that was missing: a business was a one-off
            * payment and then free to hold for ever, so the only question the
            * panel could put was "can I afford it today". The weekly figure is
            * what makes the real question — can I keep it fed — a question at
            * all.
            */}
          <div className="plot-sub">
            {money(world.upkeepOf(site))} a week to run
          </div>
        </div>
      )}
      {mine && (
        /*
         * A place of yours, and the one lever you have over it.
         *
         * Shutting a works stops it buying stock in and stops it making
         * anything, and drops what it costs you to a standing charge. It is
         * deliberately not free: a building you have switched off is still a
         * building you own, and pausing at no cost would just be a parking space
         * for capital.
         *
         * The state has existed since the beginning — `stepSites` has always
         * skipped a stopped site — but it could only ever be reached by a works
         * failing. This is the same machinery with somebody's hand on it.
         */
        <div className="card">
          <div className="card-figures">
            <span>
              <i>Upkeep</i>
              <b>{money(world.upkeepOf(site))}</b>
            </span>
            <span>
              <i>State</i>
              <b>{paused ? 'shut' : STATE_NAMES[world.sites.state[site]]}</b>
            </span>
          </div>
          {paused
            ? (
              <>
                <div className="plot-note">
                  Shut. It is buying nothing in and making nothing, and costs the
                  standing charge above.
                </div>
                <button
                  className="btn primary block"
                  onClick={() => actions.resume(site)}
                >Open it again</button>
              </>
            )
            : (
              <>
                <div className="plot-sub">
                  Shutting it stops the intake and the output, and cuts the bill.
                </div>
                <button
                  className="btn block"
                  onClick={() => actions.pause(site)}
                >Shut it for now</button>
              </>
            )}
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
  world, contract = -1, from = -1, cargo = -1, onPick, onHover, onCancel,
}: {
  world: World;
  /** A job somebody offered you… */
  contract?: number;
  /** …or a load you are fetching for yourself, which has no paperwork. */
  from?: number;
  cargo?: number;
  onPick: (vehicle: number) => void;
  onHover: (vehicle: number) => void;
  onCancel: () => void;
}): JSX.Element {
  const list = contract >= 0
    ? world.driversFor(contract)
    : world.driversForRun(from, cargo);
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
  world, site, mine, outward = false, group, onGo, onHover, onArrange, onEnd,
}: {
  world: World;
  site: number;
  mine: boolean;
  /**
   * Is this a thing leaving, rather than a thing arriving?
   *
   * One component draws both because they are the same row with the arrow turned
   * round: a cargo, how much of it is here, and either the lorry on it or a way
   * to put one on. Two components would be two places to fix the next thing.
   */
  outward?: boolean;
  group: {
    cargo: number; owned: boolean;
    candidates: { site: number; distance: number; visible: boolean }[];
    hidden: number;
  };
  onGo: (site: number) => void;
  onHover: (site: number) => void;
  /** Both ends, because which one is fixed depends on the direction. */
  onArrange: (cargo: number, from: number, to: number) => void;
  onEnd: (service: number) => void;
}): JSX.Element {
  /*
   * One row per input, and a row is a single sentence: what it wants, how much
   * is on the shelf, and what is bringing more.
   *
   * The version before this put the whole decision on the card at once — a badge
   * saying which body the load needs, a list of every producer in reach, and a
   * driver picker unfolding underneath one of them. Three levels of choice
   * stacked in a space the width of a bubble, with a chip reading "you have
   * none" in the middle of it. "It looks dreadful", and it was, because it was
   * answering questions nobody had asked yet.
   *
   * So the row itself is a statement, and choosing happens on its own page —
   * see `SupplyPick`, which is where the drilling in and the going back live.
   */
  const cargo = C.cargo[group.cargo];
  const stock = world.sites.stockOf(site, group.cargo);
  /*
   * How much of it the place gets through in a day.
   *
   * The one number that makes an input meaningful to a haulier: it says how often
   * a lorry would have to turn up. Read off the recipe rather than measured, so
   * it is right the instant the panel opens rather than after a week of watching.
   */
  const perDay = world.intakePerDay(site, group.cargo);
  const run = !mine ? null
    : outward ? world.runOutOf(site, group.cargo)
      : world.runInto(site, group.cargo);

  if (!mine) {
    /*
     * Somebody else's place: one line, and nothing to press.
     *
     * This used to be a card containing a card — a bordered box with the cargo
     * name and the word "needed", and inside it a list of every supplier as a
     * button. "That horrible square within a square and a *needed* — that's just
     * plain wrong", and it was, for a reason worth naming: it was built as a
     * control panel for a place the player has no control over. Nothing in it
     * could be acted on, so every affordance it offered was a lie.
     *
     * What a player wants from somebody else's works is the *fact*: this is what
     * goes into it, and this is the lorry it would take. That is one line, and it
     * asks nothing.
     */
    return (
      <div className="fact">
        <span className="swatch" style={{ background: cargo.colour }} />
        <span className="grow">
          <span className="fact-name">{cargo.name}</span>
          <span className="fact-sub">
            {perDay > 0 ? `${perDay} t a day` : 'takes it in'}
          </span>
        </span>
        <Carriers handling={cargo.handling} />
      </div>
    );
  }

  /*
   * A run already going, which is a **task**: a standing instruction of yours to
   * keep moving this, with no contract behind it.
   *
   * The word is on the row because this row is where tasks are born and it never
   * used to say so. A player sets one of these up here, sees a lorry start
   * driving, and then looks for it in Contracts — where, until now, it was not,
   * because it is not a contract. "My tipper is definitely going between my
   * livestock farm and the abattoir but the business doesn't seem to know about
   * the vehicle anymore." It did know; it had no word for it. Naming it here and
   * listing it there is the whole of the fix.
   */
  if (run) {
    return (
      <div className="running-row">
        <span className="swatch" style={{ background: cargo.colour }} />
        <span className="grow">
          <span className="running-name">
            {cargo.name}
            <em>{stock} in hand</em>
          </span>
          <span className="running-sub">
            <span className="kind">task</span>
            {run.vehicle >= 0
              ? C.vehicles[world.vehicles.type[run.vehicle]].name
              : 'no lorry on it'}
          </span>
        </span>
        <button className="running-off" onClick={() => onEnd(run.service)}>Take off</button>
      </div>
    );
  }

  const nearest = group.candidates[0];
  return (
    <button
      className="supply-row"
      onClick={() => nearest && (outward
        ? onArrange(group.cargo, site, nearest.site)
        : onArrange(group.cargo, nearest.site, site))}
      disabled={!nearest}
      onMouseEnter={() => nearest && onHover(nearest.site)}
      onMouseLeave={() => onHover(-1)}
    >
      <span className="swatch" style={{ background: cargo.colour }} />
      <span className="grow">
        <span className="running-name">
          {cargo.name}
          <em>{stock} in hand</em>
        </span>
        <span className="running-sub">
          {nearest
            ? `${outward ? 'to' : 'from'} ${C.industries[world.sites.def[nearest.site]].name}`
              + `, ${nearest.distance} tiles`
            : group.hidden > 0
              ? outward ? 'the buyer is out of reach' : 'the supplier is out of reach'
              : outward ? 'nobody near takes it' : 'nothing makes it'}
        </span>
      </span>
      {nearest && <span className="supply-go">›</span>}
    </button>
  );
}

/**
 * Arranging one run: where from, and which lorry.
 *
 * Its own page, with the bubble's header turned into a back chevron, because a
 * decision with two parts does not fit in a card. And the parts are in the order
 * they matter: the supplier is *defaulted to the nearest* and stated as a line
 * you may change, while the lorry — the thing that is actually being committed
 * for the next hour — is the list you are looking at.
 *
 * The old version had this the other way round, which is what made it unusable:
 * every producer in reach was a button, each of which unfolded a driver list
 * underneath it, so the panel grew a level every time you touched it and the
 * question "which lorry" was three taps deep.
 */
function Arrange({
  world, site, cargo, from, to, outward, onOther, onHover, onAssign,
}: {
  world: World;
  site: number;
  cargo: number;
  from: number;
  to: number;
  outward: boolean;
  onOther: (site: number) => void;
  onHover: (site: number) => void;
  onAssign: (vehicle: number) => void;
}): JSX.Element {
  const [changing, setChanging] = useState(false);
  /*
   * The end you did *not* fix is the one you may change. Going out, that is the
   * buyer; coming in, the supplier. Everything else on this page is the same
   * either way, which is why there is one page and not two.
   */
  const groups = outward ? world.buyerGroups(site) : world.suppliersFor(site);
  const others = groups.find((g) => g.cargo === cargo);
  const other = outward ? to : from;
  const drivers = world.driversForRun(from, cargo);
  const def = C.industries[world.sites.def[other]];
  const spare = drivers.filter((d) => d.suitable);

  if (changing) {
    return (
      <>
        <div className="head">{outward ? 'Deliver to' : 'Collect from'}</div>
        {(others?.candidates ?? []).map((c) => (
          <button
            key={c.site}
            className={`driver ${c.site === other ? 'on' : ''}`}
            onClick={() => { onOther(c.site); setChanging(false); }}
            onMouseEnter={() => onHover(c.site)}
            onMouseLeave={() => onHover(-1)}
          >
            <span className="supply-icon" style={{ color: C.industries[world.sites.def[c.site]].colour }}>
              <Icon id={C.industries[world.sites.def[c.site]].id} size={17} />
            </span>
            <span className="grow">
              <span className="driver-name">{C.industries[world.sites.def[c.site]].name}</span>
              <span className="driver-where">{c.distance} tiles away</span>
            </span>
            {c.site === other && <span className="driver-no">✓</span>}
          </button>
        ))}
      </>
    );
  }

  return (
    <>
      {/* Where from, as a line rather than a list. Changing it is a link because
          it is the rarer of the two decisions: the nearest supplier is the right
          one nearly always, and the exceptions are worth a tap. */}
      <div className="from-line">
        <span className="supply-icon" style={{ color: def.colour }}>
          <Icon id={def.id} size={17} />
        </span>
        <span className="grow">
          <span className="running-name">{def.name}</span>
          <span className="running-sub">
            {others?.candidates.find((c) => c.site === other)?.distance ?? 0} tiles away
          </span>
        </span>
        {(others?.candidates.length ?? 0) > 1 && (
          <button className="from-change" onClick={() => setChanging(true)}>change</button>
        )}
      </div>

      {/*
        * "Assign Vehicle", and under it the vehicles that would do.
        *
        * The heading was "Put a lorry on it", which is chatty where the rest of
        * the interface is plain, and the refusal underneath was a sentence listing
        * vehicle names in prose. Both were saying in words what the game can show:
        * the pipeline renders every vehicle, so what a load takes is a row of the
        * actual lorries, and hovering names them. Same component the contract
        * cards use — "similarly to how we do with the other thing of showing the
        * renderings of them" — so the constraint looks the same everywhere it
        * appears, which is the point of having one.
        */}
      <div className="head head-row">
        <span className="grow">Assign Vehicle</span>
        {/* Only when there is a list to qualify. With nothing to show, the empty
            state below says the same thing at a readable size, and two copies of
            one constraint on one panel is one too many. */}
        {spare.length > 0 && <Carriers handling={C.cargo[cargo].handling} size={18} />}
      </div>
      {spare.length === 0 ? (
        /*
         * An empty state rather than a line of small red text.
         *
         * "If it's empty, a nice empty state UI." The distinction worth drawing is
         * between the two ways it can be empty, because they have different
         * answers: every lorry is busy, which you fix by freeing one or buying
         * one, or nothing you own can carry this at all, which you fix by buying
         * a *particular* one. So the second case shows which, in pictures.
         */
        <div className="nowt">
          <span className="nowt-head">You don&rsquo;t have any available vehicles</span>
          <span className="nowt-sub">
            {drivers.length === 0
              ? 'Every lorry is out on a job. Take one off a run, or buy another.'
              : `Nothing free can carry ${C.cargo[cargo].name.toLowerCase()}.`}
          </span>
          {/* And what would do it, in both cases: the answer to "so what do I
              buy" is the same whether you own none or own the wrong ones. No
              caption over it — three lorries under "nothing free can carry feed"
              are self-evidently the things that could, and a label saying so is a
              caption on a picture that has already made its point. */}
          <span className="nowt-needs">
            <Carriers handling={C.cargo[cargo].handling} size={30} />
          </span>
        </div>
      ) : spare.map((d) => (
        <button
          key={d.vehicle}
          className="driver"
          onClick={() => onAssign(d.vehicle)}
        >
          {/* The lorry itself, at the size the fleet list draws it. A name and a
              tonnage is a poor description of a vehicle when a picture of it is
              already sitting on disk. */}
          <img
            className="veh-thumb"
            src={thumb(C.vehicles[world.vehicles.type[d.vehicle]].id)}
            alt=""
          />
          <span className="grow">
            <span className="driver-name">
              {C.vehicles[world.vehicles.type[d.vehicle]].name}
            </span>
            <span className="driver-where">
              {d.yard >= 0 ? world.yards.names[d.yard] : 'no yard'}
              {d.yard >= 0 && ` · ${d.deadTiles} empty to the pickup`}
            </span>
          </span>
          <span className="driver-no">assign</span>
        </button>
      ))}
    </>
  );
}

/**
 * What this place has cost and earned, line by line.
 *
 * The ledger already had totals per line per company, which answers "how am I
 * doing" and cannot answer "was buying that creamery a mistake" — for that you
 * need the events, attributed to the place they happened at, with a reason
 * beside each one.
 *
 * ## On the date
 *
 * Week and month and the time of day, and no day number, which is a deliberate
 * limit rather than an oversight: `dateString` in the simulation explains why the
 * game never prints a day, and a transaction list is not a good enough reason to
 * break a rule that holds everywhere else. Week plus clock orders the rows finely
 * enough to read a morning's work in sequence, which is what the column is for.
 */
function Money({ world, site }: { world: World; site: number }): JSX.Element {
  const rows = world.moneyAt(site, 40);
  const totals = world.moneyTotals(site);
  const net = totals.in - totals.out;

  /** What a row *was*, in words, because a number with no reason is a mystery. */
  const why = (r: { kind: number; cargo: number; tonnes: number }): string => {
    const cargo = r.cargo >= 0 ? C.cargo[r.cargo]?.name.toLowerCase() : '';
    const load = r.tonnes > 0 ? `${Math.round(r.tonnes)}t of ${cargo}` : cargo;
    switch (r.kind) {
      case MoneyKind.Bought: return 'Bought the place';
      case MoneyKind.Sold: return 'Sold the place';
      case MoneyKind.Traded: return `${load} brought in`;
      case MoneyKind.Delivered: return `${load} delivered`;
      case MoneyKind.Gate: return `${load} collected from the gate`;
      case MoneyKind.Moved: return `${load} moved to another of yours`;
      case MoneyKind.Counter: return `${load} over the counter`;
      case MoneyKind.Market: return `${load} sold on the market`;
      // The one that appears whether or not anything happened, which is the
      // point of it: a place that traded nothing all week still has a row.
      case MoneyKind.Upkeep: return 'A week of keeping it open';
      default: return 'Money';
    }
  };

  return (
    <>
      <div className="tally">
        <span className="tally-cell in">
          <i>In</i>
          {money(totals.in)}
        </span>
        <span className="tally-cell out">
          <i>Out</i>
          {money(totals.out)}
        </span>
        <span className={`tally-cell net ${net >= 0 ? 'good' : 'bad'}`}>
          <i>Net</i>
          {money(net)}
        </span>
      </div>

      {rows.length === 0 && (
        <div className="why">
          Nothing yet. Money shows up here as loads arrive and as you buy and sell.
        </div>
      )}

      {rows.map((r, i) => (
        <div className="tx" key={`${r.tick}-${i}`}>
          <span className="grow">
            <span className="tx-why">{why(r)}</span>
            <span className="tx-when">{world.stampOf(r.tick)}</span>
          </span>
          <span className={`tx-sum ${r.pence >= 0 ? 'in' : 'out'}`}>
            {r.pence >= 0 ? '+' : '−'}{money(Math.abs(r.pence))}
          </span>
        </div>
      ))}
    </>
  );
}
