/**
 * Your fleet, and your yards. Two of the five screens in design.md §8.
 *
 * Both were plain lists in a box in the corner while the place panel became a
 * bubble with tabs and pictures, and the difference was glaring. They use the
 * same shell now — the same header, the same tab strip, the same cards — because
 * the alternative is a game that looks like two games.
 *
 * Two changes of substance came with the migration, and both are the same
 * observation from different ends.
 *
 * **The Vehicles screen listed the catalogue, not your fleet.** Nine rows, one
 * per *type*, as though you could own one of each — so a haulier with four vans
 * saw one van. It lists what you own now, one row per vehicle, with where it is.
 *
 * **And buying moved to the yard.** The catalogue screen found *a* yard that
 * could take what you bought, which quietly made "where does it live" the
 * game's decision instead of yours. A yard shows its bays: the ones with a
 * lorry in, and the empty ones. Click an empty one and you are choosing what to
 * put *there* — which is what makes a yard's capacity and its facilities mean
 * anything at all.
 */

import { useEffect, useState, type JSX } from 'react';
import {
  type World, Facility, FACILITY_NAMES, FACILITY_COST, facilitiesFor,
  Fitting, FITTING_COST, FITTING_NAMES, SNOW_STOPS,
} from '@interchange/sim';
import { content } from '@interchange/data';
import type { Renderer } from '@interchange/render';
import { money, useAnchor, thumb } from './Markers.tsx';
import { anchorAt } from './anchor.ts';
import { Icon } from './Icons.tsx';

const C = content();

/**
 * The sim's word for what a lorry is doing, as the word to print.
 *
 * One table so the three lists that show it cannot drift apart, and the ellipsis
 * on *sleeping* is doing a job: it says the state is temporary and will end on
 * its own, which is exactly the difference between a lorry parked for the night
 * and a lorry with nothing to do.
 */
const DOING: Record<string, string> = {
  idle: 'idle',
  working: 'working',
  sleeping: 'sleeping…',
  stopped: 'stopped by snow',
};

/**
 * A vehicle, as a row with its picture on it.
 *
 * The picture is a build-time render of the same glb the game draws — see
 * `art/build_thumbs.py`. "Refrigerated van · 2 t" tells you almost nothing about
 * what you are about to own; a render of the van tells you the rest of it in the
 * time it takes to glance, and costs nothing at runtime but an `img` tag.
 */
function VehicleRow({
  id, name, sub, right, warn, onClick, disabled,
}: {
  id: string;
  name: string;
  sub: string;
  right?: JSX.Element;
  warn?: string;
  onClick?: () => void;
  disabled?: boolean;
}): JSX.Element {
  const body = (
    <>
      <img className="veh-thumb" src={thumb(id)} alt="" />
      <span className="grow">
        <span className="driver-name">{name}</span>
        <span className="driver-where">{sub}</span>
        {warn !== undefined && <span className="veh-warn">{warn}</span>}
      </span>
      {right}
    </>
  );
  if (!onClick) return <div className="veh-row">{body}</div>;
  return (
    <button className="veh-row" onClick={onClick} disabled={disabled}>{body}</button>
  );
}

/**
 * Everything you own, wherever it is.
 *
 * Not anchored to anywhere on the map, because it is not about a place — so it
 * sits where a screen sits and wears the same clothes as the bubbles.
 */
export function Fleet({
  world, onOpenVehicle, onClose,
}: {
  world: World;
  onOpenVehicle: (vehicle: number) => void;
  onClose: () => void;
}): JSX.Element {
  const snow = world.snow;

  const rows: JSX.Element[] = [];
  for (let v = 0; v < world.vehicles.count; v++) {
    if (!world.vehicles.alive[v]) continue;
    if (world.vehicles.company[v] !== world.player) continue;
    const def = C.vehicles[world.vehicles.type[v]];
    const yard = world.vehicleYard[v] ?? -1;
    const winter = (world.vehicleFittings[v] & Fitting.WinterTyres) !== 0;
    rows.push(
      <VehicleRow
        key={v}
        id={def.id}
        name={def.name}
        sub={`${yard >= 0 ? world.yards.names[yard] : 'no yard'} · `
          + `${DOING[world.vehicleActivity(v)]}`}
        /*
         * Only when it is actually stopped, not all year.
         *
         * The row used to carry "No winter tyres" every day of the year with the
         * price beside it, which reads as a fault with the lorry and — with the
         * money right there — as though you were being asked to buy the lorry
         * again. It is not a fault. It is a thing the vehicle has not got, and
         * for nine months of the year it does not matter in the slightest.
         *
         * A lorry that is *standing still in the snow right now* is a different
         * matter: that is not a nag, it is the reason nothing is moving, and it
         * belongs on the row.
         */
        warn={!winter && snow >= SNOW_STOPS ? 'Stopped — no winter tyres' : undefined}
        onClick={() => onOpenVehicle(v)}
        right={<span className="veh-more">›</span>}
      />,
    );
  }

  return (
    <div className="bubble fixed">
      <div className="sheet-head">
        <span className="sheet-icon"><Icon id="yard" size={24} /></span>
        <div className="grow">
          <div className="sheet-title">Your vehicles</div>
          <div className="sheet-sub">
            {rows.length === 1 ? 'One lorry' : `${rows.length} lorries`}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="bubble-body">
        {rows.length === 0 && (
          <div className="why">Nothing on the road. Buy one at a yard.</div>
        )}
        {rows}
      </div>
    </div>
  );
}

/**
 * One vehicle, and what can be done to it.
 *
 * "When a user clicks, it shows the upgrades you can have to that vehicle in
 * another screen." Which is the right shape, and not only because the list was
 * cluttered: a fitting is a decision about *one lorry* — which of yours gets the
 * tyres this winter is the whole of that decision — and a decision about one
 * thing wants a screen about one thing. Buried in a row it reads as a line item.
 *
 * There is one fitting today. The panel is built from `FITTING_NAMES` rather
 * than around winter tyres, so the second one costs nothing to add and the
 * screen does not have to be redesigned when it arrives.
 */
export function Upgrades({
  world, vehicle, onFit, onGoToYard, onClose,
}: {
  world: World;
  vehicle: number;
  onFit: (vehicle: number, fitting: number) => void;
  onGoToYard: (yard: number) => void;
  onClose: () => void;
}): JSX.Element {
  const def = C.vehicles[world.vehicles.type[vehicle]];
  const yard = world.vehicleYard[vehicle] ?? -1;
  const fitted = world.vehicleFittings[vehicle];
  const cash = world.companies.cash[world.player];
  const snow = world.snow;

  return (
    <div className="bubble fixed">
      <div className="sheet-head">
        <img className="veh-thumb" src={thumb(def.id)} alt="" />
        <div className="grow">
          <div className="sheet-title">{def.name}</div>
          <div className="sheet-sub">
            {yard >= 0 ? world.yards.names[yard] : 'no yard'}
            {' · '}{DOING[world.vehicleActivity(vehicle)]}
          </div>
        </div>
        <button className="x" data-quiet onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="bubble-body">
        <UpgradeRows world={world} vehicle={vehicle} onFit={onFit} />
        {yard >= 0 && (
          <button className="btn ghost" onClick={() => onGoToYard(yard)}>
            Go to {world.yards.names[yard]}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The fittings themselves, without a panel around them.
 *
 * Shared because this is reached two ways — from the fleet list, where it is a
 * screen of its own, and from inside a yard, where it has to appear *in the yard
 * bubble*. Clicking a lorry in a yard and having the answer open in a different
 * box at the bottom of the screen is the panel losing track of what you were
 * looking at, and the fix is not to move the box, it is to not open a second one.
 */
function UpgradeRows({
  world, vehicle, onFit,
}: {
  world: World;
  vehicle: number;
  onFit: (vehicle: number, fitting: number) => void;
}): JSX.Element {
  const fitted = world.vehicleFittings[vehicle];
  const cash = world.companies.cash[world.player];
  const snow = world.snow;
  return (
    <>
      {FITTING_NAMES.map(([bit, name]) => {
        const has = (fitted & bit) !== 0;
        const cost = FITTING_COST[bit] ?? 0;
        const stopped = bit === Fitting.WinterTyres && !has && snow >= SNOW_STOPS;
        return (
          <div className="fit-row" key={bit}>
            <span className="grow">
              <span className="driver-name">{name}</span>
              {/*
                * What it is *for*, which the price alone never says. A fitting
                * the player cannot see the point of is a tax; one they can is a
                * decision, and the difference is this sentence.
                */}
              <span className="driver-where">
                {bit === Fitting.WinterTyres
                  ? 'Keeps working once the snow is down'
                  : 'Fitted at the yard'}
              </span>
              {stopped && <span className="veh-warn">Stopped in the snow now</span>}
            </span>
            {has
              ? <span className="have">Fitted</span>
              : (
                <button
                  className="btn"
                  disabled={cash < cost}
                  onClick={() => onFit(vehicle, bit)}
                >{money(cost)}</button>
              )}
          </div>
        );
      })}
    </>
  );
}

type YardTab = 'bays' | 'kit';

/**
 * A yard: its bays, and what it is equipped for.
 *
 * Anchored over the yard like a place bubble, because a yard *is* a place — a
 * business with no inputs and no outputs (design.md §4), so it gets the same
 * treatment as any other. Not a tidiness argument: a panel about a yard you
 * cannot find on the map is the exact complaint that made everything which names
 * a place take you to it.
 */
export function Yard({
  world, renderer, yard, onAdd, onFit, onBuy, onClose,
}: {
  world: World;
  renderer: Renderer;
  yard: number;
  onAdd: (yard: number, facility: number) => void;
  onFit: (vehicle: number, fitting: number) => void;
  onBuy: (yard: number, typeIndex: number) => void;
  onClose: () => void;
}): JSX.Element | null {
  const [tab, setTab] = useState<YardTab>('bays');
  const [filling, setFilling] = useState(false);
  /*
   * A vehicle being looked at *inside* this bubble.
   *
   * "If I click a yard, then click a vehicle, the vehicle shows at the lower
   * section rather than in the same window." Quite right, and the same idiom the
   * bay-filling view already uses: the bubble is anchored over the yard, so
   * anything you reach from it has to stay there. Opening a second box at the
   * bottom of the screen loses the thread of what you were looking at.
   */
  const [viewing, setViewing] = useState(-1);
  const anchor = useAnchor(
    world, renderer,
    yard >= 0 && yard < world.yards.count ? world.yards.tile[yard] : -1,
  );

  useEffect(() => { setTab('bays'); setFilling(false); setViewing(-1); }, [yard]);

  if (yard < 0 || yard >= world.yards.count) return null;
  const cash = world.companies.cash[world.player];
  const snow = world.snow;

  const based: number[] = [];
  for (let v = 0; v < world.vehicles.count; v++) {
    if (!world.vehicles.alive[v] || world.vehicleYard[v] !== yard) continue;
    based.push(v);
  }
  const bays = world.yards.bays[yard];
  const free = Math.max(0, bays - based.length);

  /*
   * Above the place or below it, and adrift when the place has left the frame.
   *
   * Discrete choices, so they can come from React at its own pace. Where the
   * bubble actually *is* comes from `anchorAt` and is recomputed in the frame
   * loop, so it does not lag the map by three frames while you drag.
   */
  const below = anchor !== null && anchor.y < 330;
  const adrift = anchor === null;

  return (
    <div
      className={`bubble ${below ? 'below' : ''} ${adrift ? 'adrift' : ''}`}
      style={adrift ? { left: window.innerWidth / 2, top: 90 } : undefined}
      {...(anchor === null ? {} : anchorAt(anchor.wx, anchor.wy, anchor.wz, {
        dy: below ? 20 : -26, clamp: 166,
      }))}
    >
      {viewing >= 0 ? (
        <>
          <div className="sheet-head">
            {/* Back rather than close, because there is somewhere to go back to
                and the yard is still the thing on screen behind this. */}
            <button
              className="x"
              data-quiet
              onClick={() => setViewing(-1)}
              aria-label="Back to the yard"
            >‹</button>
            <img
              className="veh-thumb"
              src={thumb(C.vehicles[world.vehicles.type[viewing]].id)}
              alt=""
            />
            <div className="grow">
              <div className="sheet-title">
                {C.vehicles[world.vehicles.type[viewing]].name}
              </div>
              <div className="sheet-sub">
                {world.yards.names[yard]}
                {' · '}{DOING[world.vehicleActivity(viewing)]}
              </div>
            </div>
            <button className="x" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="bubble-body">
            <UpgradeRows world={world} vehicle={viewing} onFit={onFit} />
          </div>
          <span className="bubble-arrow" />
        </>
      ) : (
        <>
      <div className="sheet-head">
        <span className="sheet-icon"><Icon id="yard" size={24} /></span>
        <div className="grow">
          <div className="sheet-title">{world.yards.names[yard]}</div>
          <div className="sheet-sub">{based.length} of {bays} bays</div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="tabs" role="tablist">
        <button
          className={`tab ${tab === 'bays' ? 'on' : ''}`}
          onClick={() => { setTab('bays'); setFilling(false); }}
        >Bays<em>{based.length}</em></button>
        <button
          className={`tab ${tab === 'kit' ? 'on' : ''}`}
          onClick={() => setTab('kit')}
        >Equipment</button>
      </div>

      <div className="bubble-body">
        {tab === 'bays' && !filling && (
          <>
            {based.map((v) => {
              const def = C.vehicles[world.vehicles.type[v]];
              const winter = (world.vehicleFittings[v] & Fitting.WinterTyres) !== 0;
              return (
                <VehicleRow
                  key={v}
                  id={def.id}
                  name={def.name}
                  sub={`${def.capacity} t · ${DOING[world.vehicleActivity(v)]}`}
                  // Same rule as the fleet list, and the *second* copy of it —
                  // which is why the nag was still here after being taken off
                  // the other one. A yard's bays are a list of lorries too.
                  warn={!winter && snow >= SNOW_STOPS ? 'Stopped — no winter tyres' : undefined}
                  onClick={() => setViewing(v)}
                  right={<span className="veh-more">›</span>}
                />
              );
            })}
            {/*
              * An empty bay is a *thing*, not an absence.
              *
              * Drawing the free space is what turns "buy a vehicle" from a
              * shopping trip into filling a gap in a place you own — and it is
              * the only way a player ever finds out that a yard has four bays
              * rather than an unlimited number.
              */}
            {Array.from({ length: free }, (_, i) => (
              <button key={`e${i}`} className="veh-row empty" onClick={() => setFilling(true)}>
                <span className="bay-slot">+</span>
                <span className="grow">
                  <span className="driver-name">Empty bay</span>
                  <span className="driver-where">Put something in it</span>
                </span>
              </button>
            ))}
            {free === 0 && (
              <div className="why">Every bay is full. Another yard, then.</div>
            )}
          </>
        )}

        {tab === 'bays' && filling && (
          <>
            {C.vehicles.map((v, i) => {
              const need = facilitiesFor({
                handling: v.handling as readonly string[], cls: v.class,
              });
              const missing = FACILITY_NAMES
                .filter(([bit]) => (need & bit) !== 0 && !world.yards.has(yard, bit))
                .map(([, n]) => n.toLowerCase());
              const affordable = cash >= v.cost;
              const ok = missing.length === 0 && affordable;
              return (
                <VehicleRow
                  key={v.id}
                  id={v.id}
                  name={v.name}
                  sub={`${v.capacity} t · ${purpose(v.handling as readonly string[], v.class)}`}
                  warn={ok
                    ? undefined
                    : missing.length > 0
                      ? `No ${missing.join(' or ')} here`
                      : 'Not enough in the bank'}
                  right={<span className="price">{money(v.cost)}</span>}
                  disabled={!ok}
                  onClick={() => { onBuy(yard, i); setFilling(false); }}
                />
              );
            })}
            <button className="btn block" onClick={() => setFilling(false)}>Not now</button>
          </>
        )}

        {tab === 'kit' && FACILITY_NAMES.map(([bit, name]) => {
          const have = world.yards.has(yard, bit);
          const cost = FACILITY_COST[bit] ?? 0;
          return (
            <div key={name} className={`veh-row ${have ? '' : 'dim-row'}`}>
              <span className="grow">
                <span className="driver-name">{name}</span>
                <span className="driver-where">{takes(bit)}</span>
              </span>
              {have ? <span className="have">✓</span> : (
                <>
                  <span className="price">{money(cost)}</span>
                  <button
                    className="btn tiny"
                    disabled={cash < cost}
                    onClick={() => onAdd(yard, bit)}
                  >Put in</button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <span className="bubble-arrow" />
        </>
      )}
    </div>
  );
}

/** Plain English for what a vehicle is for, from what it can carry. */
function purpose(handling: readonly string[], cls: string): string {
  if (handling.includes('liquid')) return 'Milk and fuel in bulk';
  if (handling.includes('refrigerated')) return 'Anything that has to stay cold';
  if (cls === 'tipper') return 'Aggregate, and it tips';
  if (cls === 'artic') return 'Volume, where the roads allow it';
  if (cls === 'van') return 'Small loads, anywhere';
  return 'General haulage';
}

/**
 * What having this facility lets you keep here.
 *
 * Derived from which vehicles ask for it, so the list cannot drift out of step
 * with the rule — except for the two that no vehicle *requires*, which need
 * saying in words because "no vehicle needs this" is not a reason to buy one.
 */
function takes(bit: number): string {
  if (bit === Facility.Workshop) return 'Keeps the whole fleet running';
  if (bit === Facility.Hardstanding) return 'Somewhere to stand. Every yard has one';
  const wants = C.vehicles.filter(
    (v) => (facilitiesFor({ handling: v.handling as readonly string[], cls: v.class }) & bit) !== 0,
  );
  if (wants.length === 0) return 'Nothing needs it yet';
  return wants.map((v) => v.name).join(', ');
}
