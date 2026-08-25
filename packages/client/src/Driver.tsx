/**
 * One of your lorries, clicked on.
 *
 * "I have no idea if a vehicle's assigned to a contract, which kind of fucks me
 * off" — and the fix is not a badge, it is that a vehicle is a thing you can
 * *ask*. Click it and it tells you what it is carrying, where it is going, and
 * what it is earning, and you can take it off the job.
 *
 * Anchored over the lorry, like a place bubble, which means it follows a moving
 * object. That is the one thing here that is not the same as the others: a place
 * stays still, so its bubble only moves when the camera does; this one has to
 * track a vehicle crossing the district, and the shared `useAnchor` is fed the
 * vehicle's tile each frame rather than a fixed one.
 */

import { type JSX } from 'react';
import { type World, ContractState } from '@interchange/sim';
import { content } from '@interchange/data';
import type { Renderer } from '@interchange/render';
import { money, useAnchor, bodyFor } from './Markers.tsx';
import { BodyIcon } from './Icons.tsx';

const C = content();

export function Driver({
  world, renderer, vehicle, onDrop, onClose,
}: {
  world: World;
  renderer: Renderer;
  vehicle: number;
  onDrop: (vehicle: number) => void;
  onClose: () => void;
}): JSX.Element | null {
  const size = world.terrain.size;
  const alive = vehicle >= 0 && vehicle < world.vehicles.count
    && world.vehicles.alive[vehicle] === 1;
  const vx = alive ? world.vehicles.x[vehicle] / 65536 : 0;
  const vz = alive ? world.vehicles.y[vehicle] / 65536 : 0;
  const tile = alive
    ? Math.max(0, Math.min(size * size - 1,
      Math.round(vz) * size + Math.round(vx)))
    : -1;
  const anchor = useAnchor(world, renderer, tile);

  if (!alive) return null;
  const def = C.vehicles[world.vehicles.type[vehicle]];
  const svc = world.vehicles.service[vehicle];
  const yard = world.vehicleYard[vehicle] ?? -1;

  // Which contract, if any. The board holds the service id, so this is the only
  // place that has to know a contract is a service underneath.
  const board = world.contractBoard;
  let contract = -1;
  for (let i = 0; i < board.count; i++) {
    if (board.state[i] !== ContractState.Closed && board.service[i] === svc && svc >= 0) {
      contract = i;
      break;
    }
  }

  const load = world.vehicles.load[vehicle];
  const carrying = world.vehicles.cargo[vehicle];
  const revenue = world.vehicles.revenue[vehicle];

  const below = anchor !== null && anchor.y < 300;
  const left = anchor === null
    ? window.innerWidth / 2
    : Math.max(166, Math.min(window.innerWidth - 166, anchor.x));
  const top = anchor === null ? 90 : anchor.y + (below ? 26 : -32);

  return (
    <div
      className={`bubble ${below ? 'below' : ''} ${anchor === null ? 'adrift' : ''}`}
      style={{ left, top }}
    >
      <div className="sheet-head">
        <img
          className="veh-thumb"
          src={`thumbs/veh_${def.id.replace(/-/g, '_')}.png`}
          alt=""
        />
        <div className="grow">
          <div className="sheet-title">{def.name}</div>
          <div className="sheet-sub">
            {yard >= 0 ? world.yards.names[yard] : 'no yard'}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="bubble-body">
        {contract >= 0 ? (
          <>
            <div className="job open">
              <span className="job-line">
                <span
                  className="swatch"
                  style={{ background: C.cargo[board.cargo[contract]].colour }}
                />
                <span className="grow">
                  {C.cargo[board.cargo[contract]].name}
                  {' → '}
                  {C.industries[world.sites.def[board.to[contract]]].name}
                </span>
              </span>
              <span className="needs">
                <BodyIcon handling={C.cargo[board.cargo[contract]].handling} />
                {bodyFor(C.cargo[board.cargo[contract]].handling)}
              </span>
            </div>
            <div className="stock">
              <div className="stock-row">
                <span className="grow">Carrying</span>
                <span className="num">
                  {load > 0 ? `${load} t of ${C.cargo[carrying]?.name ?? '—'}` : 'empty'}
                </span>
              </div>
              <div className="stock-row">
                <span className="grow">Loads run</span>
                <span className="num">{board.delivered[contract]}</span>
              </div>
              <div className="stock-row">
                <span className="grow">Earned</span>
                <span className="num">{money(revenue)}</span>
              </div>
            </div>
            {/*
              * Taking it off the job, which is the reason this panel can be
              * opened at all: a lorry you cannot reassign is a lorry you have
              * lost. It goes back to idle and the contract goes back on the
              * board for somebody — you — to take again.
              */}
            <button className="btn block" onClick={() => onDrop(vehicle)}>
              Take it off this job
            </button>
          </>
        ) : (
          <>
            <div className="why">Idle. It is not on a job.</div>
            <div className="stock">
              <div className="stock-row">
                <span className="grow">Earned, all told</span>
                <span className="num">{money(revenue)}</span>
              </div>
            </div>
          </>
        )}
      </div>
      <span className="bubble-arrow" />
    </div>
  );
}
