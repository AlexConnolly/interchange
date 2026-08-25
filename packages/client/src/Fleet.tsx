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
  Fitting, FITTING_COST, SNOW_STOPS,
} from '@interchange/sim';
import { content } from '@interchange/data';
import type { Renderer } from '@interchange/render';
import { money, useAnchor } from './Markers.tsx';
import { Icon } from './Icons.tsx';

const C = content();

/** Where the pipeline writes its rendered thumbnails. */
function thumb(vehicleId: string): string {
  return `thumbs/veh_${vehicleId.replace(/-/g, '_')}.png`;
}

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
  world, onGoToYard, onFit, onClose,
}: {
  world: World;
  onGoToYard: (yard: number) => void;
  onFit: (vehicle: number, fitting: number) => void;
  onClose: () => void;
}): JSX.Element {
  const snow = world.snow;
  const tyreCost = FITTING_COST[Fitting.WinterTyres] ?? 0;
  const cash = world.companies.cash[world.player];

  const rows: JSX.Element[] = [];
  for (let v = 0; v < world.vehicles.count; v++) {
    if (!world.vehicles.alive[v]) continue;
    if (world.vehicles.company[v] !== world.player) continue;
    const def = C.vehicles[world.vehicles.type[v]];
    const yard = world.vehicleYard[v] ?? -1;
    const winter = (world.vehicleFittings[v] & Fitting.WinterTyres) !== 0;
    const working = world.vehicles.service[v] !== -1;
    rows.push(
      <VehicleRow
        key={v}
        id={def.id}
        name={def.name}
        sub={`${yard >= 0 ? world.yards.names[yard] : 'no yard'} · ${working ? 'working' : 'idle'}`}
        warn={winter
          ? undefined
          : snow >= SNOW_STOPS ? 'Stopped — no winter tyres' : 'No winter tyres'}
        onClick={yard >= 0 ? () => onGoToYard(yard) : undefined}
        right={winter
          ? <span className="have">❄</span>
          : (
            <button
              className="btn tiny"
              disabled={cash < tyreCost}
              onClick={(e) => { e.stopPropagation(); onFit(v, Fitting.WinterTyres); }}
            >{money(tyreCost)}</button>
          )}
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
  const anchor = useAnchor(
    world, renderer,
    yard >= 0 && yard < world.yards.count ? world.yards.tile[yard] : -1,
  );

  useEffect(() => { setTab('bays'); setFilling(false); }, [yard]);

  if (yard < 0 || yard >= world.yards.count) return null;
  const cash = world.companies.cash[world.player];
  const snow = world.snow;
  const tyreCost = FITTING_COST[Fitting.WinterTyres] ?? 0;

  const based: number[] = [];
  for (let v = 0; v < world.vehicles.count; v++) {
    if (!world.vehicles.alive[v] || world.vehicleYard[v] !== yard) continue;
    based.push(v);
  }
  const bays = world.yards.bays[yard];
  const free = Math.max(0, bays - based.length);

  const below = anchor !== null && anchor.y < 330;
  const left = anchor === null
    ? window.innerWidth / 2
    : Math.max(166, Math.min(window.innerWidth - 166, anchor.x));
  const top = anchor === null ? 90 : anchor.y + (below ? 20 : -26);

  return (
    <div
      className={`bubble ${below ? 'below' : ''} ${anchor === null ? 'adrift' : ''}`}
      style={{ left, top }}
    >
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
                  sub={`${def.capacity} t · ${world.vehicles.service[v] !== -1 ? 'working' : 'idle'}`}
                  warn={winter
                    ? undefined
                    : snow >= SNOW_STOPS ? 'Stopped — no winter tyres' : 'No winter tyres'}
                  right={winter
                    ? <span className="have">❄</span>
                    : (
                      <button
                        className="btn tiny"
                        disabled={cash < tyreCost}
                        onClick={() => onFit(v, Fitting.WinterTyres)}
                      >{money(tyreCost)}</button>
                    )}
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
