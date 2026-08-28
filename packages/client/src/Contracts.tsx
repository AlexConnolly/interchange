/**
 * The contract board: what you are running, and what is on offer.
 *
 * It was one flat list holding both, and a list holding both cannot be sorted
 * for either. Work in hand and work on offer are different questions asked at
 * different moments — "how is that job doing" against "what could I take on" —
 * and the answers want different columns. So: two tabs.
 *
 * **Active** is everything you are running, and that is *two kinds of thing*.
 *
 * A **contract** is somebody else's work: a payer, a rate, and an end. A **task**
 * is a standing instruction of your own — move this cargo from here to there,
 * until told otherwise — with no payer, because both ends are yours and you are
 * moving your own goods between your own places.
 *
 * "A contract is a task, but a task is not a contract." So they share one list and
 * a chip says which, rather than a third tab: they are the same question — what is
 * my fleet doing — asked once.
 *
 * The reason tasks needed a home at all is a bug. Buying the place a contract
 * delivers to closes the contract, deliberately, and leaves the lorry running. Up
 * to now that run then existed nowhere in the interface: "my tipper is definitely
 * going between my livestock farm and the abattoir but the business doesn't seem
 * to know about the vehicle anymore." Quite. It was doing unpaid work that no
 * screen claimed.
 *
 * **Available** is what is left after filtering out everything you are already
 * on. A board that keeps offering you work you have taken is a board you stop
 * reading.
 *
 * Behind every row is a page, and it is the *same* sliding page-and-back the
 * place panel uses rather than a second idiom for the same gesture. That mattered
 * enough to be asked for by name — "that lovely sliding UI we have on the other
 * pages" — and it is also the only honest way to hold a decision: the list is for
 * choosing which one, the page is for deciding what to do about it, and a list
 * that tried to hold both would be a form.
 */

import { useState, type JSX } from 'react';
import { type World, ContractState } from '@interchange/sim';
import { content } from '@interchange/data';
import { money, Carriers, thumb } from './Markers.tsx';
import { BodyIcon, Icon } from './Icons.tsx';
import { perHour } from './Place.tsx';

const C = content();

type Tab = 'active' | 'open';

/** A row on either tab, with everything both the list and the page need. */
interface Row {
  /** A contract's board id, or -1 for a task. */
  id: number;
  /** A task's service id, or -1 for a contract. */
  service: number;
  /** Where it runs, which a task has to carry because it has no board entry. */
  from: number;
  to: number;
  cargo: number;
  /** The lorry on it, or -1. */
  vehicle: number;
  /** How far the pickup is from your yard, for ordering the offers. */
  away: number;
  /** A free lorry of the right sort, named — so the row can say "take it". */
  ready: string | null;
  /** You own the right sort at all, free or not. A different problem entirely. */
  ownsKind: boolean;
}

/**
 * Where "near" is measured from: your yard.
 *
 * Not the camera, which is where you happen to be looking, and not the middle of
 * the district, which is nowhere. A haulier's near work is near the depot the
 * lorries sleep at.
 */
function home(world: World): { x: number; z: number } {
  for (let y = 0; y < world.yards.count; y++) {
    if (world.yards.owner[y] !== world.player) continue;
    return { x: world.yards.x[y], z: world.yards.y[y] };
  }
  return { x: 0, z: 0 };
}

function gather(world: World, tab: Tab): Row[] {
  const b = world.contractBoard;
  const at = home(world);
  const rows: Row[] = [];
  for (let i = 0; i < b.count; i++) {
    const state = b.state[i];
    const offered = state === ContractState.Offered;
    const mine = state === ContractState.Running || state === ContractState.Idle;
    /*
     * The filter that gives the Available tab its point: anything you hold is not
     * on offer to you. `Idle` counts as held — you have taken it on and simply
     * have nobody on it, which is a problem to fix on the Active tab rather than a
     * job to consider taking again.
     */
    if (tab === 'open' ? !offered : !mine) continue;
    if (b.from[i] < 0 || b.to[i] < 0) continue;

    let vehicle = -1;
    if (mine) {
      for (let v = 0; v < world.vehicles.count; v++) {
        if (world.vehicles.alive[v] && world.vehicles.service[v] === b.service[i]) {
          vehicle = v;
          break;
        }
      }
    }
    /*
     * Three states, not two, and the third is what makes the list useful.
     * `driversFor` only returns vehicles with no service on them, so a suitable
     * hit means a lorry is standing in a yard able to start now. `fleetCanCarry`
     * asks the weaker question — do you own that sort at all — and the gap between
     * the two is "your tipper is out on a job", which is a different situation
     * from "you have no tipper". One is wait ten minutes; the other is buy a lorry.
     */
    let ready: string | null = null;
    let ownsKind = false;
    if (offered) {
      ownsKind = world.fleetCanCarry(b.cargo[i]);
      const free = world.driversFor(i).find((d) => d.suitable);
      if (free) ready = C.vehicles[world.vehicles.type[free.vehicle]].name;
    }
    rows.push({
      id: i,
      service: b.service[i],
      from: b.from[i],
      to: b.to[i],
      cargo: b.cargo[i],
      vehicle,
      away: Math.hypot(world.sites.x[b.from[i]] - at.x, world.sites.y[b.from[i]] - at.z),
      ready,
      ownsKind,
    });
  }

  /*
   * And the tasks, on the Active tab only. There is no such thing as an available
   * task: a task is something you set up, not something you are offered.
   */
  if (tab === 'active') {
    for (const t of world.tasks()) {
      rows.push({
        id: -1,
        service: t.service,
        from: t.from,
        to: t.to,
        cargo: t.cargo,
        vehicle: t.vehicle,
        away: Math.hypot(world.sites.x[t.from] - at.x, world.sites.y[t.from] - at.z),
        ready: null,
        ownsKind: false,
      });
    }
  }

  if (tab === 'open') {
    /*
     * The ones you can start, then the nearest. "Near" is only worth reading once
     * "possible" has been settled: an offer four tiles away needing a tanker you do
     * not own is further from being done than one across the district you have a
     * free lorry for.
     */
    rows.sort((x, y) => {
      const cx = x.ready ? 0 : x.ownsKind ? 1 : 2;
      const cy = y.ready ? 0 : y.ownsKind ? 1 : 2;
      if (cx !== cy) return cx - cy;
      return x.away - y.away;
    });
  } else {
    /*
     * Trouble first. A contract with nobody on it is work you have promised and
     * are not doing, and that belongs at the top whatever it pays. A *task* with
     * nobody on it is the same trouble one degree quieter — nobody is owed, but a
     * shop is running dry — so it sorts by the same rule.
     *
     * Then by what it pays per day, which tasks have no answer to: `contractEarned`
     * returns zero for a task's id of -1, so they fall in below the paid work.
     * Which is the right order to read them in and not an accident of the guard —
     * money in hand before goods moved.
     */
    rows.sort((x, y) => {
      const ax = x.vehicle < 0 ? 0 : 1;
      const ay = y.vehicle < 0 ? 0 : 1;
      if (ax !== ay) return ax - ay;
      return world.contractEarned(y.id).perDay - world.contractEarned(x.id).perDay;
    });
  }
  return rows;
}

/**
 * The two ends, in words. Off the *row* rather than off the board, because a task
 * has no board entry and its ends are the only place they exist.
 */
function endsOf(world: World, r: { from: number; to: number; cargo: number }): {
  from: string; to: string; cargo: number;
} {
  return {
    from: C.industries[world.sites.def[r.from]]?.name ?? 'Somewhere',
    to: C.industries[world.sites.def[r.to]]?.name ?? 'Somewhere',
    cargo: r.cargo,
  };
}

export function Contracts({
  world, onGoSite, onGoDriver, onTake, onCancel, onEndTask, onClose,
}: {
  world: World;
  onGoSite: (site: number) => void;
  onGoDriver: (vehicle: number) => void;
  onTake: (contract: number, vehicle: number) => void;
  onCancel: (contract: number) => void;
  /** Take the lorry off a task, which ends it. There is nothing to give back. */
  onEndTask: (service: number) => void;
  onClose: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('active');
  /*
   * Which row's page is open, as the row itself rather than an id.
   *
   * Because there are two kinds of row now and one number cannot say which: a
   * board id and a service id are both small integers and would silently mean
   * each other. The row already carries the discriminator and both ends, and
   * everything that changes while the page is open — the lorry, the takings, the
   * tonnage — is read live off the world underneath, so holding the row is not
   * holding stale figures.
   */
  const [open, setOpen] = useState<Row | null>(null);
  const b = world.contractBoard;

  const active = gather(world, 'active');
  const offers = gather(world, 'open');
  const rows = tab === 'active' ? active : offers;

  /*
   * The page, when one is open. Rendered instead of the list rather than over it,
   * which is the whole of what makes this a page turn rather than a dialog — and
   * the mistake worth not repeating: a panel that appeared *on top of* the list it
   * came from was the thing that got called out as landing on top again.
   */
  /*
   * A task's page. Fewer figures than a contract's, honestly: there is no rate to
   * quote and no offer to weigh up, because you set this one up yourself. What is
   * left is whether it is running and what it has shifted.
   */
  if (open && open.id < 0) {
    const e = endsOf(world, open);
    const carried = world.taskCarried(open.service);
    let onIt = -1;
    for (let v = 0; v < world.vehicles.count; v++) {
      if (world.vehicles.alive[v] && world.vehicles.service[v] === open.service) {
        onIt = v;
        break;
      }
    }
    return (
      <div className="bubble fixed">
        <div className="sheet-head">
          <button
            className="x"
            data-quiet
            onClick={() => setOpen(null)}
            aria-label="Back"
          >&lsaquo;</button>
          <div className="grow">
            <div className="sheet-title">{e.from} &rarr; {e.to}</div>
            <div className="sheet-sub">{C.cargo[e.cargo].name} &middot; your own run</div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="bubble-body slide-in">
          <div className="ledger">
            <div className="ledger-cell">
              <i>Carried</i><b>{Math.round(carried.tonnes)} t</b>
            </div>
            <div className="ledger-cell">
              <i>Per day</i><b>{carried.perDay.toFixed(1)} t</b>
            </div>
            <div className="ledger-cell">
              <i>Running</i>
              <b>{carried.days < 2 ? 'since today' : `${Math.floor(carried.days)} days`}</b>
            </div>
            {/*
              * Said plainly rather than left as a blank cell where a contract has
              * its rate. A player who has just watched a contract turn into this
              * wants to know where the money went, and the answer is that it moved
              * to the far end - the shop sells it - not that it stopped.
              */}
            <div className="ledger-cell">
              <i>Pays</i><b>at the far end</b>
            </div>
          </div>

          <div className="head">On it</div>
          {onIt >= 0 ? (
            <button className="driver" onClick={() => onGoDriver(onIt)}>
              <img
                className="veh-thumb"
                src={thumb(C.vehicles[world.vehicles.type[onIt]].id)}
                alt=""
              />
              <span className="grow">
                <span className="driver-name">
                  {C.vehicles[world.vehicles.type[onIt]].name}
                </span>
                <span className="driver-where">
                  {carried.days < 2 ? 'started today'
                    : `${Math.floor(carried.days)} days on this run`}
                </span>
              </span>
              <span className="driver-no">&rsaquo;</span>
            </button>
          ) : (
            <div className="nowt">
              <span className="nowt-head">Nobody is on this</span>
              <span className="nowt-sub">
                Nothing is moving between them until a lorry is put on it.
              </span>
            </div>
          )}
          <div className="plot-row">
            <button className="btn" onClick={() => onGoSite(open.from)}>Show me</button>
            {/* "Take the lorry off" rather than "give it back": there is nobody
                to give it to. Ending a task frees the lorry and stops the run. */}
            <button
              className="btn give"
              onClick={() => { onEndTask(open.service); setOpen(null); }}
            >Take the lorry off</button>
          </div>
        </div>
      </div>
    );
  }

  if (open && b.state[open.id] !== ContractState.Closed) {
    const e = endsOf(world, open);
    const held = b.state[open.id] === ContractState.Running
      || b.state[open.id] === ContractState.Idle;
    const earned = world.contractEarned(open.id);
    /*
     * The hourly rate, asked of the lorry that is actually on it.
     *
     * `perHour` scans the *free* lorries, which is right for an offer and wrong
     * for work in hand: the moment you assign one there are no free lorries left
     * that suit, so it returns zero and the page falls back to a rate per tonne —
     * which is the figure the whole board moved away from, printed on the one page
     * most entitled to the better one.
     */
    let onIt = -1;
    if (held) {
      for (let v = 0; v < world.vehicles.count; v++) {
        if (world.vehicles.alive[v] && world.vehicles.service[v] === b.service[open.id]) {
          onIt = v;
          break;
        }
      }
    }
    const hourly = onIt >= 0 ? world.contractPerHour(open.id, onIt) : perHour(world, open.id);
    const spare = held ? [] : world.driversFor(open.id).filter((d) => d.suitable);
    return (
      <div className="bubble fixed">
        <div className="sheet-head">
          {/* The header's title becomes the way back, exactly as it does on a
              place. One gesture for "up a level", everywhere. */}
          <button
            className="x"
            data-quiet
            onClick={() => setOpen(null)}
            aria-label="Back"
          >&lsaquo;</button>
          <div className="grow">
            <div className="sheet-title">{e.from} &rarr; {e.to}</div>
            <div className="sheet-sub">{C.cargo[e.cargo].name}</div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="bubble-body slide-in">
          {/*
            * The numbers, as a grid rather than a sentence.
            *
            * Four figures that are read together and compared with each other, so
            * they are laid out to be scanned down rather than read across. The
            * hourly rate is the one that compares two *jobs*; the per-day is the
            * one that compares this job with itself last week.
            */}
          <div className="ledger">
            <div className="ledger-cell">
              <i>Pays</i>
              <b>{hourly > 0 ? `${money(hourly)}/hr` : `${money(b.pay[open.id])}/t`}</b>
            </div>
            {held && (
              <>
                <div className="ledger-cell"><i>Earned so far</i><b>{money(earned.total)}</b></div>
                <div className="ledger-cell"><i>Per day</i><b>{money(earned.perDay)}</b></div>
                <div className="ledger-cell">
                  <i>Loads run</i>
                  <b>{b.delivered[open.id]}</b>
                </div>
              </>
            )}
            {!held && (
              <>
                <div className="ledger-cell"><i>Rate</i><b>{money(b.pay[open.id])}/t</b></div>
                <div className="ledger-cell">
                  <i>Loaded run</i>
                  <b>{Math.round(b.distance[open.id])} tiles</b>
                </div>
                {/*
                  * The dead miles, which is the fact an offer is most often
                  * *rejected* on and the one the rate cannot tell you. A good rate
                  * over twenty tiles is a bad job if the lorry runs eighteen empty
                  * to get to the pickup, and four facts fill the grid where three
                  * left a hole in it.
                  */}
                <div className="ledger-cell">
                  <i>Empty to pickup</i>
                  <b>{spare.length > 0 ? `${spare[0].deadTiles} tiles` : '—'}</b>
                </div>
              </>
            )}
          </div>

          {held ? (
            <>
              <div className="head">On it</div>
              {onIt >= 0 ? (
                <button className="driver" onClick={() => onGoDriver(onIt)}>
                  <img
                    className="veh-thumb"
                    src={thumb(C.vehicles[world.vehicles.type[onIt]].id)}
                    alt=""
                  />
                  <span className="grow">
                    <span className="driver-name">
                      {C.vehicles[world.vehicles.type[onIt]].name}
                    </span>
                    <span className="driver-where">
                      {earned.days < 2 ? 'started today'
                        : `${Math.floor(earned.days)} days on this run`}
                    </span>
                  </span>
                  <span className="driver-no">&rsaquo;</span>
                </button>
              ) : (
                <div className="nowt">
                  <span className="nowt-head">Nobody is on this</span>
                  <span className="nowt-sub">
                    You have taken the work on and no lorry is running it. It earns
                    nothing until one does.
                  </span>
                </div>
              )}
              <div className="plot-row">
                <button className="btn" onClick={() => onGoSite(open.from)}>
                  Show me
                </button>
                {/*
                  * Cancelling puts the work back on the board rather than closing
                  * it, and the button says so. "Cancel" alone reads as destroying
                  * something.
                  */}
                <button
                  className="btn give"
                  onClick={() => { onCancel(open.id); setOpen(null); }}
                >Give it back</button>
              </div>
            </>
          ) : (
            <>
              <div className="head head-row">
                <span className="grow">Assign Vehicle</span>
                {spare.length > 0 && <Carriers handling={C.cargo[e.cargo].handling} size={18} />}
              </div>
              {spare.length === 0 ? (
                <div className="nowt">
                  <span className="nowt-head">You don&rsquo;t have any available vehicles</span>
                  <span className="nowt-sub">
                    {world.fleetCanCarry(e.cargo)
                      ? 'Yours that could do it are all out on other work.'
                      : `Nothing in your fleet can carry ${C.cargo[e.cargo].name.toLowerCase()}.`}
                  </span>
                  <span className="nowt-needs">
                    <Carriers handling={C.cargo[e.cargo].handling} size={30} />
                  </span>
                </div>
              ) : spare.map((d) => (
                <button
                  key={d.vehicle}
                  className="driver"
                  onClick={() => { onTake(open.id, d.vehicle); setOpen(null); }}
                >
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
                  <span className="driver-no">assign to contract</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bubble fixed">
      <div className="sheet-head">
        <span className="sheet-icon"><Icon id="terminal" size={24} /></span>
        <div className="grow">
          <div className="sheet-title">Contracts</div>
          <div className="sheet-sub">
            {tab === 'active'
              ? active.length === 0 ? 'Nothing in hand'
                : `${active.filter((r) => r.vehicle < 0).length === 0
                  ? 'all covered' : `${active.filter((r) => r.vehicle < 0).length} with nobody on`}`
              : offers.length === 0 ? 'Nothing on offer'
                : `${offers.filter((r) => r.ready !== null).length} you could start now`}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="tabs" role="tablist">
        <button
          className={`tab ${tab === 'active' ? 'on' : ''}`}
          onClick={() => setTab('active')}
        >Active{active.length > 0 && <em>{active.length}</em>}</button>
        <button
          className={`tab ${tab === 'open' ? 'on' : ''}`}
          onClick={() => setTab('open')}
        >Available{offers.length > 0 && <em>{offers.length}</em>}</button>
      </div>
      <div className="bubble-body">
        {rows.length === 0 && (
          <div className="nowt">
            <span className="nowt-head">
              {tab === 'active' ? 'You are not running any work' : 'No work going'}
            </span>
            <span className="nowt-sub">
              {tab === 'active'
                ? 'Take work on from the Available tab, or set up a run of your own '
                  + 'from a business you own.'
                : 'Offers appear as businesses fill their yards. Give it a day.'}
            </span>
          </div>
        )}
        {rows.map((r) => {
          const e = endsOf(world, r);
          const cargo = C.cargo[e.cargo];
          const task = r.id < 0;
          const earned = world.contractEarned(r.id);
          const carried = task ? world.taskCarried(r.service) : null;
          const hourly = task ? 0 : perHour(world, r.id);
          return (
            <button
              /* Board ids and service ids overlap, so the kind is part of the key
                 or React reuses a contract's row for a task. */
              key={task ? `t${r.service}` : `c${r.id}`}
              className={`job${r.ready !== null ? ' ready' : ''}`
                + `${tab === 'open' && r.ready === null ? ' blocked' : ''}`}
              onClick={() => setOpen(r)}
            >
              <span className="job-line">
                <span className="swatch" style={{ background: cargo.colour }} />
                <span className="grow">{e.from} &rarr; {e.to}</span>
                {/*
                  * Per hour where an hour can be worked out, per tonne where it
                  * cannot. A rate per tonne is not comparable between two offers -
                  * a short run in a van and a long run in an artic can pay the
                  * same per tonne and differ fourfold in what they are worth - and
                  * comparing offers is the entire purpose of this list.
                  */}
                {/*
                  * What it pays, or - for a task - what kind of thing it is.
                  *
                  * The chip sits where the money would, which is the point: the
                  * one column that reads straight down the list answers "what is
                  * this worth to me", and for a task the honest answer is not a
                  * number but a category. Reading `task` down the column is how
                  * you tell at a glance which of your lorries are earning and
                  * which are stocking your own shelves.
                  */}
                {task
                  ? <span className="kind">task</span>
                  : hourly > 0
                    ? <span className="pay">{money(hourly)}<i>/hr</i></span>
                    : <span className="pay">{money(b.pay[r.id])}<i>/t</i></span>}
              </span>
              {tab === 'active' ? (
                <span className={`needs${r.vehicle >= 0 ? '' : ' cannot'}`}>
                  <BodyIcon handling={cargo.handling} />
                  {/* In a span of its own so it wraps as a unit - see `.needs`. */}
                  <span>
                    {r.vehicle >= 0
                      ? C.vehicles[world.vehicles.type[r.vehicle]].name
                        + (task ? '' : ` · ${b.delivered[r.id]} loads`)
                      : 'nobody on it'}
                  </span>
                  {/* The two figures the Active tab exists for - money for a
                      contract, tonnage for a task, in the same place and the same
                      shape: what it has done, and what that is a day. */}
                  {r.vehicle >= 0 && (
                    /* Its own line, always. See `.needs .figs`. */
                    <b className="figs">
                      {carried
                        ? `${Math.round(carried.tonnes)} t carried`
                          + ` · ${carried.perDay.toFixed(1)} t/day`
                        : `${money(earned.total)} so far · ${money(earned.perDay)}/day`}
                    </b>
                  )}
                </span>
              ) : (
                <span className={`needs${r.ready !== null ? ' can' : ' cannot'}`}>
                  <BodyIcon handling={cargo.handling} />
                  {r.ready !== null ? r.ready : <Carriers handling={cargo.handling} size={17} />}
                  {r.ready !== null && <b>free &mdash; take it</b>}
                  {r.ready === null && r.ownsKind && <b>yours are all out</b>}
                  {r.ready === null && !r.ownsKind && <b>none in your fleet</b>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
