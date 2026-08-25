/**
 * The Vehicles screen and the Yard screen. design.md §6.
 *
 * Two of the five screens, and both are one column of rows. The rule they exist
 * to serve is that a refusal must be a sentence: *Marchford has no tank bay* is
 * a signpost, and a greyed-out button with no explanation is a wall.
 *
 * So every vehicle you cannot buy still appears, still shows its price, and
 * carries the reason underneath it. That is deliberately more information than a
 * filtered list would give, and it is the only place in the interface where
 * showing something unavailable is right — because the unavailable thing is the
 * next goal.
 */

import {
  type World, Facility, FACILITY_NAMES, FACILITY_COST, facilitiesFor,
  Fitting, FITTING_NAMES, FITTING_COST, SNOW_STOPS,
} from '@interchange/sim';
import { content } from '@interchange/data';
import { money } from './Markers.tsx';

const C = content();

/** Plain English for what a vehicle is for, from what it can carry. */
function purpose(handling: readonly string[], cls: string): string {
  if (handling.includes('liquid')) return 'Milk and fuel in bulk';
  if (handling.includes('refrigerated')) return 'Anything that has to stay cold';
  if (cls === 'tipper') return 'Aggregate, and it tips';
  if (cls === 'artic') return 'Volume, where the roads allow it';
  if (cls === 'van') return 'Small loads, anywhere';
  return 'General haulage';
}

export function Vehicles({
  world, onBuy, onClose,
}: {
  world: World;
  onBuy: (typeIndex: number) => void;
  onClose: () => void;
}): JSX.Element {
  const cash = world.companies.cash[world.player];

  return (
    <div className="panel wide">
      <div className="panel-head">
        <span className="panel-title">Vehicles</span>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="panel-body scroll">
        {C.vehicles.map((v, i) => {
          const { yard, reason } = world.yardFor(i);
          const affordable = cash >= v.cost;
          const ok = yard >= 0 && affordable;
          return (
            <div key={v.id} className={`row ${ok ? '' : 'dim-row'}`}>
              <div className="grow">
                <div className="title">{v.name}</div>
                <div className="sub">{purpose(v.handling as readonly string[], v.class)} · {v.capacity} t</div>
                {!ok && (
                  <div className="why">{!affordable ? 'Not enough in the bank.' : reason}</div>
                )}
              </div>
              <div className="price">{money(v.cost)}</div>
              <button className="btn tiny" disabled={!ok} onClick={() => onBuy(i)}>Buy</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Yard({
  world, yard, onAdd, onFit, onClose,
}: {
  world: World;
  yard: number;
  onAdd: (yard: number, facility: number) => void;
  onFit: (vehicle: number, fitting: number) => void;
  onClose: () => void;
}): JSX.Element | null {
  if (yard < 0 || yard >= world.yards.count) return null;
  const based = world.basedAt(yard);
  const cash = world.companies.cash[world.player];

  // Which of our vehicles live here, so the yard is a place with lorries in it
  // rather than a row of tickboxes. This is also where a lorry is *fitted*, and
  // it belongs here rather than on the Vehicles screen because that screen is a
  // shop: it lists what exists, not what you own.
  const fleet: { vehicle: number; name: string; winter: boolean }[] = [];
  for (let v = 0; v < world.vehicles.count; v++) {
    if (!world.vehicles.alive[v] || world.vehicleYard[v] !== yard) continue;
    fleet.push({
      vehicle: v,
      name: C.vehicles[world.vehicles.type[v]].name,
      winter: (world.vehicleFittings[v] & Fitting.WinterTyres) !== 0,
    });
  }
  const snow = world.snow;
  const tyreCost = FITTING_COST[Fitting.WinterTyres] ?? 0;

  return (
    <div className="panel wide">
      <div className="panel-head">
        <span className="panel-title">{world.yards.names[yard]}</span>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="panel-body">
        <dl>
          <dt>Bays</dt><dd>{based} of {world.yards.bays[yard]}</dd>
        </dl>
        {fleet.length > 0 && (
          <div className="fleet-list">
            {fleet.map((f) => (
              <div key={f.vehicle} className="row">
                <div className="grow">
                  <div className="title">{f.name}</div>
                  {/*
                    * Say it before the snow, and say it louder once the snow is
                    * down. A rule that only announces itself at the moment it
                    * bites is a trap; one that warns you in November is a
                    * decision.
                    */}
                  {!f.winter && (
                    <div className={snow >= SNOW_STOPS ? 'why stopped' : 'why'}>
                      {snow >= SNOW_STOPS
                        ? 'Stopped — no winter tyres'
                        : 'No winter tyres'}
                    </div>
                  )}
                </div>
                {f.winter ? <span className="have">❄</span> : (
                  <>
                    <div className="price">{money(tyreCost)}</div>
                    <button
                      className="btn tiny"
                      disabled={cash < tyreCost}
                      onClick={() => onFit(f.vehicle, Fitting.WinterTyres)}
                    >Fit tyres</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {FITTING_NAMES.length === 0 && null}
        <div className="head">Facilities</div>
        {FACILITY_NAMES.map(([bit, name]) => {
          const have = world.yards.has(yard, bit);
          const cost = FACILITY_COST[bit] ?? 0;
          return (
            <div key={name} className={`row ${have ? '' : 'dim-row'}`}>
              <div className="grow">
                <div className="title">{name}</div>
                <div className="sub">{takes(bit)}</div>
              </div>
              {have ? <span className="have">✓</span> : (
                <>
                  <div className="price">{money(cost)}</div>
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
    </div>
  );
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
