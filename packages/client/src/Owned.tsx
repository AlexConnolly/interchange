/**
 * What you own, and what you could own. And every contract you are running.
 *
 * Two screens, one file, because they are the same shape: a list of things,
 * where clicking one closes the list and takes you there. That last part is the
 * whole design of both. "When you click on an individual business, it's gonna
 * take you there, it's gonna close that window" — a list that only tells you a
 * thing exists is a worse map than the map.
 *
 * They replace the Yard button, which was a single hard-coded yard and does not
 * survive owning more than one of anything. Nothing on either screen is a
 * number you act on: they are indexes into the district.
 */

import { useState, type JSX } from 'react';
import { type World, ContractState } from '@interchange/sim';
import { content } from '@interchange/data';
import { money, bodyFor } from './Markers.tsx';
import { BodyIcon, Icon } from './Icons.tsx';

const C = content();

type OwnedTab = 'mine' | 'sale';

/**
 * Everything you own, and everything for sale that you could reach.
 *
 * The two tabs are the same list read at two moments in the game: early on,
 * "mine" is one yard and the interesting tab is the other one; later it is
 * twelve businesses and a shopping list would be noise. Same component, and the
 * tab counts tell you which one you are in.
 */
export function Owned({
  world, onGoSite, onGoYard, onBuild, onClose,
}: {
  world: World;
  onGoSite: (site: number) => void;
  onGoYard: (yard: number) => void;
  onBuild: () => void;
  onClose: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<OwnedTab>('mine');

  const mine: JSX.Element[] = [];
  for (let y = 0; y < world.yards.count; y++) {
    if (world.yards.owner[y] !== world.player) continue;
    let based = 0;
    for (let v = 0; v < world.vehicles.count; v++) {
      if (world.vehicles.alive[v] && world.vehicleYard[v] === y) based++;
    }
    mine.push(
      <button key={`y${y}`} className="veh-row" onClick={() => onGoYard(y)}>
        <span className="row-icon"><Icon id="yard" size={20} /></span>
        <span className="grow">
          <span className="driver-name">{world.yards.names[y]}</span>
          <span className="driver-where">
            {based} of {world.yards.bays[y]} bays
          </span>
        </span>
        <span className="driver-no">go</span>
      </button>,
    );
  }
  for (let s = 0; s < world.sites.count; s++) {
    if (world.sites.owner[s] !== world.player) continue;
    const def = C.industries[world.sites.def[s]];
    mine.push(
      <button key={`s${s}`} className="veh-row" onClick={() => onGoSite(s)}>
        <span className="row-icon" style={{ color: def.colour }}>
          <Icon id={def.id} size={20} />
        </span>
        <span className="grow">
          <span className="driver-name">{def.name}</span>
          <span className="driver-where">
            {world.isDepot(s) ? 'Distribution centre' : 'Yours'}
          </span>
        </span>
        <span className="driver-no">go</span>
      </button>,
    );
  }

  /*
   * For sale: only what is in reach, and sorted by whether you could take it.
   *
   * The refusal is the useful part of this list. A place you cannot buy because
   * you supply none of its milk is a *goal* — it tells you which farm to buy
   * first — and hiding it would leave the player with no idea why the creamery
   * is not available.
   */
  const sale: JSX.Element[] = [];
  const candidates: { site: number; ok: boolean; reason: string; price: number }[] = [];
  for (let s = 0; s < world.sites.count; s++) {
    if (world.sites.owner[s] === world.player) continue;
    const tile = world.siteAccessTile[s];
    if (tile < 0 || !world.influence.usable(tile)) continue;
    const v = world.canBuySite(s);
    candidates.push({ site: s, ok: v.ok, reason: v.reason, price: world.priceOf(s) });
  }
  candidates.sort((a, b) => (a.ok === b.ok ? a.price - b.price : (a.ok ? -1 : 1)));
  for (const cand of candidates.slice(0, 12)) {
    const def = C.industries[world.sites.def[cand.site]];
    sale.push(
      <button key={cand.site} className="veh-row" onClick={() => onGoSite(cand.site)}>
        <span className="row-icon" style={{ color: def.colour }}>
          <Icon id={def.id} size={20} />
        </span>
        <span className="grow">
          <span className="driver-name">{def.name}</span>
          <span className="driver-where">{money(cand.price)}</span>
          {!cand.ok && <span className="veh-warn">{cand.reason}</span>}
        </span>
        <span className="driver-no">go</span>
      </button>,
    );
  }

  return (
    <div className="bubble fixed">
      <div className="sheet-head">
        <span className="sheet-icon"><Icon id="builders-merchant" size={24} /></span>
        <div className="grow">
          <div className="sheet-title">Businesses</div>
          <div className="sheet-sub">
            {mine.length === 1 ? 'One place' : `${mine.length} places`}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="tabs" role="tablist">
        <button
          className={`tab ${tab === 'mine' ? 'on' : ''}`}
          onClick={() => setTab('mine')}
        >Yours<em>{mine.length}</em></button>
        <button
          className={`tab ${tab === 'sale' ? 'on' : ''}`}
          onClick={() => setTab('sale')}
          disabled={sale.length === 0}
        >For sale{sale.length > 0 && <em>{sale.length}</em>}</button>
      </div>

      <div className="bubble-body">
        {tab === 'mine' && mine}
        {tab === 'mine' && (
          <button className="veh-row empty" onClick={onBuild}>
            <span className="bay-slot">+</span>
            <span className="grow">
              <span className="driver-name">Build a distribution centre</span>
              <span className="driver-where">Somewhere to break bulk</span>
            </span>
          </button>
        )}
        {tab === 'sale' && sale}
        {tab === 'sale' && sale.length === 0 && (
          <div className="why">Nothing within reach is for sale.</div>
        )}
      </div>
    </div>
  );
}

/**
 * Every contract you are running, in one place.
 *
 * There was no way to see them: a contract lived on the place that offered it,
 * so once you had five you had to remember which five farms to click. This is
 * the answer to "there's no contracts on [the dock], I don't know why you didn't
 * put contracts on".
 *
 * Ordered running-first, because an idle contract is a problem — work you have
 * taken on and put nobody on — and a problem belongs at the top.
 */
export function Contracts({
  world, onGoSite, onGoDriver, onClose,
}: {
  world: World;
  onGoSite: (site: number) => void;
  onGoDriver: (vehicle: number) => void;
  onClose: () => void;
}): JSX.Element {
  const b = world.contractBoard;
  const rows: { id: number; running: boolean; vehicle: number }[] = [];
  for (let i = 0; i < b.count; i++) {
    if (b.state[i] !== ContractState.Running && b.state[i] !== ContractState.Idle) continue;
    let vehicle = -1;
    for (let v = 0; v < world.vehicles.count; v++) {
      if (world.vehicles.alive[v] && world.vehicles.service[v] === b.service[i]) {
        vehicle = v;
        break;
      }
    }
    rows.push({ id: i, running: vehicle >= 0, vehicle });
  }
  rows.sort((x, y) => Number(x.running) - Number(y.running));

  return (
    <div className="bubble fixed">
      <div className="sheet-head">
        <span className="sheet-icon"><Icon id="terminal" size={24} /></span>
        <div className="grow">
          <div className="sheet-title">Contracts</div>
          <div className="sheet-sub">
            {rows.length === 1 ? 'One on the go' : `${rows.length} on the go`}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="bubble-body">
        {rows.length === 0 && (
          <div className="why">
            Nothing taken on. Click a business with a blue dot over it.
          </div>
        )}
        {rows.map((r) => {
          const cargo = C.cargo[b.cargo[r.id]];
          const from = C.industries[world.sites.def[b.from[r.id]]];
          const to = C.industries[world.sites.def[b.to[r.id]]];
          return (
            <button
              key={r.id}
              className="job"
              onClick={() => (r.vehicle >= 0
                ? onGoDriver(r.vehicle)
                : onGoSite(b.from[r.id]))}
            >
              <span className="job-line">
                <span className="swatch" style={{ background: cargo.colour }} />
                <span className="grow">{from.name} → {to.name}</span>
                <span className="pay">{money(b.pay[r.id])}<i>/t</i></span>
              </span>
              <span className={`needs ${r.running ? '' : 'cannot'}`}>
                <BodyIcon handling={cargo.handling} />
                {r.running
                  ? `${C.vehicles[world.vehicles.type[r.vehicle]].name} · ${b.delivered[r.id]} loads`
                  : bodyFor(cargo.handling)}
                {!r.running && <b>nobody on it</b>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
