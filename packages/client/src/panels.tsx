/**
 * The overlay panels.
 *
 * Every one of these is a *report*, in the sense the genre demands: profit and
 * loss by route, asset and cargo, and — from the first act, when the line is
 * guaranteed to read zero — the split between operating income and rent. The
 * arc from haulier to magnate is supposed to be visible in the income
 * statement rather than in narration (design.md §3.5), which only works if the
 * statement exists before there is anything in it.
 */

import { useMemo, useState } from 'react';
import {
  CHARTER_NAMES, Cmd, ContractState, LINE_IS_INCOME, LINE_NAMES, Line,
  STATE_NAMES, StopAction, TICKS_PER_DAY, MAX_STOPS, NONE, VState,
  CHARTER_REQUIREMENTS,
  Intervention, INTERVENTION_NAMES, DOMINANCE_TILES, DOMINANCE_TRADE,
  PATIENCE_DAYS,
  AgreementState, AGREEMENT_STATE_NAMES, mustAnswer,
  TownCharacter, DRIFT_YEARS,
} from '@interchange/sim';
import { content } from '@interchange/data';
import { money, num, pct, shortMoney, signClass, tonnes, days } from './format.ts';
import type { Engine } from './engine.ts';
import type { Picked } from './WorldView.tsx';
import { availableWays, type BuildState } from './build.ts';
import { downloadSave, localStore, saveStats, saveWorld } from './saves.ts';

const C = content();

const STOP_LABEL = ['Load', 'Unload', 'Exchange', 'Load full'];
const VSTATE_LABEL = ['Idle', 'Running', 'Loading', 'Unloading', 'Broken down', 'Waiting to depart'];

// --------------------------------------------------------------- inspector

export function Inspector({
  engine, picked, activeService, onFocus,
}: {
  engine: Engine;
  picked: Picked;
  activeService: number;
  onFocus: (x: number, y: number) => void;
}): JSX.Element | null {
  const w = engine.world;
  if (picked.kind === 'none') return null;

  if (picked.kind === 'vehicle') {
    const id = picked.id;
    if (!w.vehicles.alive[id]) return null;
    const def = C.vehicles[w.vehicles.type[id]];
    const svc = w.vehicles.service[id];
    const cargo = w.vehicles.cargo[id];
    const load = w.vehicles.load[id];
    const profit = w.vehicles.revenue[id] - w.vehicles.costs[id];
    return (
      <div className="window right">
        <h2>{def.name} <span className="dim mono">#{id}</span></h2>
        <div className="body">
          <dl className="kv">
            <dt>Status</dt><dd>{VSTATE_LABEL[w.vehicles.state[id]]}</dd>
            <dt>Load</dt>
            <dd>{cargo === 255 ? <span className="dim">empty</span> : `${load}/${def.capacity}t ${C.cargo[cargo].name}`}</dd>
            <dt>Service</dt><dd>{svc === NONE ? <span className="dim">unassigned</span> : w.services.names[svc]}</dd>
            <dt>Speed</dt><dd>{def.displayKph} km/h</dd>
            <dt>Distance run</dt><dd>{num(w.vehicles.odometer[id])} tiles</dd>
            <dt>Earned</dt><dd className="pos">{money(w.vehicles.revenue[id])}</dd>
            <dt>Cost</dt><dd className="neg">{money(w.vehicles.costs[id])}</dd>
            <dt>Net</dt><dd className={signClass(profit)}>{money(profit, true)}</dd>
          </dl>
          <div className="row">
            {svc === NONE && activeService >= 0 && (
              <button className="btn tiny" onClick={() => engine.issue(Cmd.AssignVehicle, id, activeService)}>
                Assign to {w.services.names[activeService]}
              </button>
            )}
            {svc !== NONE && (
              <button className="btn tiny" onClick={() => engine.issue(Cmd.UnassignVehicle, id)}>Unassign</button>
            )}
            <div className="grow" />
            <button className="btn tiny danger" onClick={() => engine.issue(Cmd.SellVehicle, id)}>Sell</button>
          </div>
        </div>
      </div>
    );
  }

  if (picked.kind === 'site') {
    const s = picked.id;
    const def = C.industries[w.sites.def[s]];
    const state = w.sites.state[s];
    const cargoCount = C.cargo.length;
    const inputs = Object.keys(def.recipe.inputs).map((k) => C.cargoIndex.get(k) ?? -1).filter((i) => i >= 0);
    const outputs = Object.keys(def.recipe.outputs).map((k) => C.cargoIndex.get(k) ?? -1).filter((i) => i >= 0);
    return (
      <div className="window right">
        <h2>
          {def.name}
          <span className={`chip ${state === 0 ? 'pos' : state === 1 ? 'warnc' : 'neg'}`}>{STATE_NAMES[state]}</span>
        </h2>
        <div className="body">
          <dl className="kv">
            <dt>Service rate</dt><dd className={w.sites.satisfaction[s] > 55 ? 'pos' : 'warnc'}>{pct(w.sites.satisfaction[s])}</dd>
            {def.kind === 'extraction' && <><dt>Richness</dt><dd>{pct(w.sites.richness[s])}</dd></>}
            <dt>Shipped out</dt><dd>{tonnes(w.sites.shipped[s])}</dd>
            <dt>Connected</dt><dd>{w.sites.connected(s) ? 'yes' : <span className="neg">no way reaches it</span>}</dd>
            <dt>Owner</dt><dd>{w.companies.names[w.sites.owner[s]] ?? '—'}</dd>
          </dl>
          {w.era >= 3 && (def.powerNeed > 0 || def.waterNeed > 0 || def.labourNeed > 0) && (
            <>
              {/*
                design.md 2.2: a mine produces nothing until it has power,
                water and workers, and each is a different network. The binding
                one is what the player has to fix, so it is the one marked.
              */}
              <div className="ledger"><div className="head">The three networks</div></div>
              {([
                ['Power', w.sites.powered[s], def.powerNeed],
                ['Water', w.sites.watered[s], def.waterNeed],
                ['Labour', w.sites.staffed[s], def.labourNeed],
              ] as [string, number, number][]).filter(([, , need]) => need > 0).map(([label, have, need]) => (
                <div className="row" key={label}>
                  <div className="grow">
                    <div className="title">{label}</div>
                    <div className="sub">needs {need}</div>
                    <div className="meter" style={{ marginTop: 4 }}>
                      <div style={{ width: `${have}%`, background: have > 80 ? 'var(--good)' : have > 30 ? 'var(--warn)' : 'var(--bad)' }} />
                    </div>
                  </div>
                  <span className={`sub ${have > 80 ? 'pos' : have > 30 ? 'warnc' : 'neg'}`}>{pct(have)}</span>
                </div>
              ))}
            </>
          )}
          {outputs.length > 0 && (
            <>
              <div className="ledger"><div className="head">Produces — waiting for collection</div></div>
              {outputs.map((ci) => {
                const have = w.sites.stock[s * cargoCount + ci];
                const cap = w.sites.capacity[s * cargoCount + ci];
                const full = cap > 0 ? have / cap : 0;
                return (
                  <div key={ci} className="row">
                    <span className="grow title">{C.cargo[ci].name}</span>
                    <span className="sub">{have}/{cap}t</span>
                    <div className="meter" style={{ width: 54 }}>
                      <div style={{ width: `${full * 100}%`, background: full > 0.9 ? 'var(--bad)' : full > 0.6 ? 'var(--warn)' : 'var(--good)' }} />
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {inputs.length > 0 && (
            <>
              <div className="ledger"><div className="head">Wants delivered</div></div>
              {inputs.map((ci) => {
                const have = w.sites.stock[s * cargoCount + ci];
                const cap = w.sites.capacity[s * cargoCount + ci];
                const full = cap > 0 ? have / cap : 0;
                return (
                  <div key={ci} className="row">
                    <span className="grow title">{C.cargo[ci].name}</span>
                    <span className="sub">{have}/{cap}t</span>
                    <div className="meter" style={{ width: 54 }}>
                      <div style={{ width: `${full * 100}%`, background: full < 0.15 ? 'var(--bad)' : 'var(--good)' }} />
                    </div>
                  </div>
                );
              })}
            </>
          )}
          <div className="row">
            {activeService >= 0 ? (
              <>
                <button className="btn tiny" onClick={() => engine.issue(Cmd.AddStop, activeService, s, 255 << 2, StopAction.LoadFull)}>
                  + Collect here
                </button>
                <button className="btn tiny" onClick={() => engine.issue(Cmd.AddStop, activeService, s, 255 << 2, StopAction.Unload)}>
                  + Deliver here
                </button>
              </>
            ) : <span className="dim" style={{ fontSize: 11 }}>Create a service to add stops.</span>}
            <div className="grow" />
            <button className="btn tiny" onClick={() => onFocus(w.sites.x[s], w.sites.y[s])}>Centre</button>
          </div>
        </div>
      </div>
    );
  }

  if (picked.kind === 'town') {
    const t = picked.id;
    const cargoCount = C.cargo.length;
    const wants: number[] = [];
    for (let ci = 0; ci < cargoCount; ci++) if (w.towns.demand[t * cargoCount + ci] > 0) wants.push(ci);
    return (
      <div className="window right">
        <h2>{w.towns.names[t]}</h2>
        <div className="body">
          <dl className="kv">
            <dt>Population</dt><dd>{num(w.towns.population[t])}</dd>
            <dt>Well served</dt>
            <dd className={w.towns.served[t] > 60 ? 'pos' : w.towns.served[t] > 40 ? 'warnc' : 'neg'}>{pct(w.towns.served[t])}</dd>
            <dt>Trend</dt>
            <dd>{w.towns.served[t] > 60 ? 'growing' : w.towns.served[t] < 40 ? 'shrinking' : 'steady'}</dd>
            <dt>Character</dt>
            <dd>
              {TownCharacter[w.towns.character[t]]}
              {/*
                * The half-sentence that turns character from a label into a
                * thing the player can steer. There is no zoning tool; what
                * there is, is a town telling you what your network is turning
                * it into, early enough to change your mind.
                */}
              {w.towns.characterDrift[t] > DRIFT_YEARS * 20 && (
                <span className="sub"> · becoming {TownCharacter[w.towns.characterToward[t]]}</span>
              )}
            </dd>
            <dt>Passenger service</dt>
            <dd className={w.towns.transitQuality[t] > 50 ? 'pos' : w.towns.transitQuality[t] > 20 ? 'warnc' : 'neg'}>
              {w.towns.transitQuality[t] === 0 ? 'none' : pct(w.towns.transitQuality[t])}
            </dd>
          </dl>
          <div className="ledger"><div className="head">Wants delivered</div></div>
          {wants.map((ci) => {
            const have = w.towns.stock[t * cargoCount + ci];
            const want = w.towns.demand[t * cargoCount + ci];
            return (
              <div key={ci} className="row">
                <span className="grow title">{C.cargo[ci].name}</span>
                <span className="sub">{have}t held · {want}t/day</span>
              </div>
            );
          })}
          <div className="row">
            {activeService >= 0 && (
              <button className="btn tiny" onClick={() => engine.issue(Cmd.AddStop, activeService, t, (255 << 2) | 1, StopAction.Unload)}>
                + Deliver here
              </button>
            )}
            <div className="grow" />
            <button className="btn tiny" onClick={() => onFocus(w.towns.x[t], w.towns.y[t])}>Centre</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------- services

export function Services({
  engine, active, setActive, onFocus,
}: {
  engine: Engine;
  active: number;
  setActive: (n: number) => void;
  onFocus: (x: number, y: number) => void;
}): JSX.Element {
  const w = engine.world;
  const list: number[] = [];
  for (let i = 0; i < w.services.count; i++) {
    if (w.services.active[i] || w.services.stopCount[i] > 0) {
      if (w.services.company[i] === w.player) list.push(i);
    }
  }

  return (
    <div className="window left">
      <h2>
        Services
        <button className="btn tiny" onClick={() => {
          engine.issue(Cmd.CreateService, 0, 0, 0, 0, `Service ${w.services.count + 1}`);
          setActive(w.services.count);
        }}>+ New</button>
      </h2>
      <div className="body">
        {list.length === 0 && <FirstRoute engine={engine} />}
        {list.map((i) => {
          const stops = w.services.stopCount[i];
          const profit = w.services.revenue[i] - w.services.costs[i];
          return (
            <div key={i}>
              <div
                className={`row click ${i === active ? 'selected' : ''}`}
                onClick={() => setActive(i === active ? -1 : i)}
              >
                <div className="grow">
                  <div className="title">{w.services.names[i]}</div>
                  <div className="sub">
                    {w.services.vehicles[i]} vehicles · {tonnes(w.services.tonnes[i])} · <span className={signClass(profit)}>{shortMoney(profit)}</span>
                  </div>
                </div>
                <button
                  className="btn tiny danger"
                  onClick={(e) => { e.stopPropagation(); engine.issue(Cmd.DeleteService, i); }}
                >×</button>
              </div>
              {i === active && (
                <div style={{ background: 'rgba(0,0,0,0.25)' }}>
                  {stops === 0 && (
                    <div style={{ padding: '8px 10px', fontSize: 11.5, color: 'var(--ink-faint)' }}>
                      No stops yet. Click an industry or town on the map.
                    </div>
                  )}
                  {Array.from({ length: stops }, (_, k) => {
                    const si = i * MAX_STOPS + k;
                    const isTown = w.services.stopKind[si] === 1;
                    const target = w.services.stopTarget[si];
                    const name = isTown ? w.towns.names[target] : C.industries[w.sites.def[target]].name;
                    const x = isTown ? w.towns.x[target] : w.sites.x[target];
                    const y = isTown ? w.towns.y[target] : w.sites.y[target];
                    return (
                      <div className="row" key={k} style={{ paddingLeft: 18 }}>
                        <span className="dim mono" style={{ fontSize: 11 }}>{k + 1}</span>
                        <span className="grow title click" onClick={() => onFocus(x, y)}>{name}</span>
                        <span className="chip dim">{STOP_LABEL[w.services.stopAction[si]]}</span>
                        <button className="btn tiny" onClick={() => engine.issue(Cmd.RemoveStop, i, k)}>×</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- contracts

export function Contracts({ engine, onFocus }: { engine: Engine; onFocus: (x: number, y: number) => void }): JSX.Element {
  const w = engine.world;
  const offered: number[] = [];
  const mine: number[] = [];
  for (let k = 0; k < w.contracts.count; k++) {
    if (w.contracts.state[k] === ContractState.Offered) offered.push(k);
    else if (w.contracts.state[k] === ContractState.Active && w.contracts.holder[k] === w.player) mine.push(k);
  }

  const place = (k: number, dest: boolean): { name: string; x: number; y: number } => {
    const isTown = dest ? w.contracts.toIsTown[k] === 1 : w.contracts.fromIsTown[k] === 1;
    const id = dest ? w.contracts.toSite[k] : w.contracts.fromSite[k];
    return isTown
      ? { name: w.towns.names[id], x: w.towns.x[id], y: w.towns.y[id] }
      : { name: C.industries[w.sites.def[id]].name, x: w.sites.x[id], y: w.sites.y[id] };
  };

  return (
    <div className="window left">
      <h2>Contracts</h2>
      <div className="body">
        {mine.length > 0 && <div className="ledger"><div className="head">Yours</div></div>}
        {mine.map((k) => {
          const a = place(k, false);
          const b = place(k, true);
          const left = w.contracts.deadline[k] - w.tick;
          const progress = w.contracts.delivered[k] / Math.max(1, w.contracts.volume[k]);
          return (
            <div className="row" key={k}>
              <div className="grow">
                <div className="title">{C.cargo[w.contracts.cargo[k]].name} · {a.name} → {b.name}</div>
                <div className="sub">
                  {w.contracts.delivered[k]}/{w.contracts.volume[k]}t · {money(w.contracts.rate[k])}/t ·
                  <span className={left < TICKS_PER_DAY * 20 ? ' warnc' : ''}> {days(left, TICKS_PER_DAY)} left</span>
                </div>
                <div className="meter" style={{ marginTop: 4 }}>
                  <div style={{ width: `${progress * 100}%`, background: 'var(--good)' }} />
                </div>
              </div>
              <button className="btn tiny" onClick={() => onFocus(a.x, a.y)}>›</button>
            </div>
          );
        })}
        {offered.length > 0 && <div className="ledger"><div className="head">On offer</div></div>}
        {offered.length === 0 && mine.length === 0 && (
          <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
            Nothing on the board. The authority posts new work every week or so.
          </div>
        )}
        {offered.map((k) => {
          const a = place(k, false);
          const b = place(k, true);
          const bid = w.contracts.bids[k * 9 + w.player];
          const value = w.contracts.volume[k] * w.contracts.rate[k];
          return (
            <div className="row" key={k}>
              <div className="grow">
                <div className="title">{C.cargo[w.contracts.cargo[k]].name} · {a.name} → {b.name}</div>
                <div className="sub">
                  {w.contracts.volume[k]}t · {money(w.contracts.rate[k])}/t · worth {shortMoney(value)} ·
                  penalty {shortMoney(w.contracts.penalty[k])}
                </div>
              </div>
              {bid > 0
                ? <span className="chip pos">bid in</span>
                : <button className="btn tiny primary" onClick={() => engine.issue(Cmd.BidContract, k, w.contracts.rate[k])}>Bid</button>}
              <button className="btn tiny" onClick={() => onFocus(a.x, a.y)}>›</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- finance

export function Finance({ engine }: { engine: Engine }): JSX.Element {
  const w = engine.world;
  const p = w.player;
  const base = p * LINE_NAMES.length;
  const income: [number, number][] = [];
  const spend: [number, number][] = [];
  for (let l = 0; l < LINE_NAMES.length; l++) {
    const v = w.companies.ledgerYear[base + l];
    if (v === 0) continue;
    (LINE_IS_INCOME[l] ? income : spend).push([l, v]);
  }
  const totalIn = income.reduce((a, [, v]) => a + v, 0);
  const totalOut = spend.reduce((a, [, v]) => a + v, 0);
  const rent = w.companies.rentShare(p);

  return (
    <div className="window right">
      <h2>Finance <span className="dim mono">this year</span></h2>
      <div className="body">
        <div className="ledger">
          <div className="head">Income</div>
          {income.length === 0 && <div className="line dim"><span>Nothing yet</span><span>—</span></div>}
          {income.map(([l, v]) => (
            <div className="line" key={l}><span>{LINE_NAMES[l]}</span><span className="pos">{money(v)}</span></div>
          ))}
          <div className="head">Expenditure</div>
          {spend.length === 0 && <div className="line dim"><span>Nothing yet</span><span>—</span></div>}
          {spend.map(([l, v]) => (
            <div className="line" key={l}><span>{LINE_NAMES[l]}</span><span className="neg">{money(v)}</span></div>
          ))}
          <div className="line total">
            <span>Net</span>
            <span className={signClass(totalIn - totalOut)}>{money(totalIn - totalOut, true)}</span>
          </div>
        </div>
        <dl className="kv" style={{ borderTop: '1px solid var(--rule)' }}>
          <dt>Cash</dt><dd>{money(w.companies.cash[p])}</dd>
          <dt>Debt</dt><dd className={w.companies.debt[p] > 0 ? 'neg' : 'dim'}>{money(w.companies.debt[p])}</dd>
          <dt>Reliability</dt><dd>{pct(w.companies.reliability(p))}</dd>
          <dt>Contracts kept</dt><dd>{w.companies.delivered[p]} / {w.companies.delivered[p] + w.companies.missed[p]}</dd>
        </dl>
        {/*
          The arc, in one number. design.md §3.5: Act I is a hundred per cent
          haulage and Act IV might be sixty per cent rent. It reads zero for
          the whole first act, and that is the point — it is the shape of the
          ache the construction charter relieves.
        */}
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--rule)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-dim)', marginBottom: 5 }}>
            <span>Operating</span><span>Rent</span>
          </div>
          <div className="meter" style={{ height: 6 }}>
            <div style={{ width: `${rent}%`, background: 'var(--accent)', marginLeft: `${100 - rent}%` }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 5 }}>
            {rent === 0
              ? 'You own no infrastructure. Every road you use belongs to somebody else.'
              : `${rent}% of income is now rent rather than haulage.`}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- fleet

export function Fleet({ engine, onClose }: { engine: Engine; onClose: () => void }): JSX.Element {
  const w = engine.world;
  const year = w.year;
  const era = w.era;
  const [mode, setMode] = useState<string>('road');
  const available = useMemo(
    () => C.vehicles
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => v.era <= era && year < v.obsoleteYear && v.mode === mode),
    [era, year, mode],
  );
  const owned = new Map<number, number>();
  for (let i = 0; i < w.vehicles.count; i++) {
    if (w.vehicles.alive[i] && w.vehicles.company[i] === w.player) {
      owned.set(w.vehicles.type[i], (owned.get(w.vehicles.type[i]) ?? 0) + 1);
    }
  }
  const modes = [...new Set(C.vehicles.filter((v) => v.era <= era).map((v) => v.mode))];
  // Buying puts the vehicle at a site you already serve, so it does not appear
  // in the middle of a moor with no way to reach anything.
  const home = useMemo(() => {
    for (let s = 0; s < w.services.count; s++) {
      if (w.services.company[s] === w.player && w.services.stopCount[s] > 0) {
        return w.services.stopKind[s * MAX_STOPS] === 1 ? -1 : w.services.stopTarget[s * MAX_STOPS];
      }
    }
    return 0;
  }, [w.services.count]);

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ padding: '10px 14px', borderBottom: '1px solid var(--rule)', margin: 0, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>Vehicle depot — {year}</span>
          <div className="speeds">
            {modes.map((m) => (
              <button key={m} aria-pressed={m === mode} onClick={() => setMode(m)}>{m}</button>
            ))}
          </div>
          <button className="btn tiny" onClick={onClose}>Close</button>
        </h2>
        <div className="body">
          <table className="data">
            <thead>
              <tr>
                <th>Vehicle</th><th>Era</th><th className="num">Capacity</th><th className="num">Speed</th>
                <th className="num">Carries</th><th className="num">Price</th><th className="num">Per day</th>
                <th className="num">Owned</th><th />
              </tr>
            </thead>
            <tbody>
              {available.map(({ v, i }) => (
                <tr key={v.id}>
                  <td>{v.name}</td>
                  <td className="dim">{v.era}</td>
                  <td className="num">{v.capacity}{v.handling.includes('people') ? '' : 't'}</td>
                  <td className="num">{v.displayKph} km/h</td>
                  <td className="dim" style={{ fontSize: 11 }}>{v.handling.join(', ')}</td>
                  <td className="num">{money(v.cost)}</td>
                  <td className="num neg">{money(v.runningCost)}</td>
                  <td className="num">{owned.get(i) ?? 0}</td>
                  <td>
                    <button
                      className="btn tiny primary"
                      disabled={w.companies.cash[w.player] < v.cost}
                      onClick={() => engine.issue(Cmd.BuyVehicle, i, home)}
                    >Buy</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span>Cash {money(w.companies.cash[w.player])}</span>
          <span className="dim">A vehicle earns nothing until it is assigned to a service.</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ fleet list

export function FleetList({ engine, onSelect }: { engine: Engine; onSelect: (id: number) => void }): JSX.Element {
  const w = engine.world;
  const rows: number[] = [];
  for (let i = 0; i < w.vehicles.count; i++) {
    if (w.vehicles.alive[i] && w.vehicles.company[i] === w.player) rows.push(i);
  }
  const idle = rows.filter((i) => w.vehicles.service[i] === NONE).length;
  return (
    <div className="window left">
      <h2>Fleet <span className="dim mono">{rows.length}{idle > 0 ? ` · ${idle} idle` : ''}</span></h2>
      <div className="body">
        {rows.length === 0 && (
          <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
            No vehicles. Open the depot to buy your first dray.
          </div>
        )}
        {rows.map((i) => {
          const def = C.vehicles[w.vehicles.type[i]];
          const svc = w.vehicles.service[i];
          const net = w.vehicles.revenue[i] - w.vehicles.costs[i];
          return (
            <div className="row click" key={i} onClick={() => onSelect(i)}>
              <div className="grow">
                <div className="title">{def.name} <span className="dim mono">#{i}</span></div>
                <div className="sub">
                  {svc === NONE ? <span className="warnc">unassigned</span> : w.services.names[svc]}
                  {' · '}{VSTATE_LABEL[w.vehicles.state[i]].toLowerCase()}
                </div>
              </div>
              <span className={`sub ${signClass(net)}`}>{shortMoney(net)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What to do first, and why that and not something else.
 *
 * features.md says Act I is the tutorial and that was the point of the arc,
 * which is right — but there is exactly one decision in the opening that
 * separates a company that gets going from one that quietly fails, and a
 * player has no way to know it in advance.
 *
 * The opening harness measured it. Running the nearest producer-to-town pair
 * loses nine hundred pounds in twelve years; running the nearest *extraction*
 * site to a town makes eleven hundred. The difference is that a works only
 * makes anything while somebody brings it materials, and at the start of the
 * game nobody does — so it runs through its opening stock and stops. A pit
 * digs its cargo out of the ground and never stops.
 *
 * That is a genuinely interesting thing to work out, and a player who works
 * it out has learned something real about the game. But working it out costs
 * twelve years and a company, and finding out afterwards is not a lesson, it
 * is a wasted evening. So the first route names a specific pit, and says why
 * it is a pit.
 */
function FirstRoute({ engine }: { engine: Engine }): JSX.Element {
  const w = engine.world;
  const suggestion = useMemo(() => {
    let best: { site: number; town: number; d: number } | null = null;
    for (let s = 0; s < w.sites.count; s++) {
      if (!w.sites.connected(s) || !w.sites.isExtraction(s)) continue;
      const outs = C.industries[w.sites.def[s]].recipe.outputs;
      let wanted = false;
      for (const id of Object.keys(outs)) {
        const ci = C.cargoIndex.get(id);
        if (ci !== undefined && w.townDemandFor(ci) > 0) wanted = true;
      }
      if (!wanted) continue;
      for (let t = 0; t < w.towns.count; t++) {
        const d = Math.hypot(w.sites.x[s] - w.towns.x[t], w.sites.y[s] - w.towns.y[t]);
        if (d < 8 || d > 60) continue;
        if (!best || d < best.d) best = { site: s, town: t, d };
      }
    }
    return best;
  }, [w.services.count]);

  return (
    <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
      <p style={{ margin: '0 0 10px' }}>
        A service is a round of stops your vehicles run over and over. Create
        one, click an industry on the map to collect from, then click where it
        should go.
      </p>
      {suggestion && (
        <p style={{ margin: 0 }}>
          For a first route, try the{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {C.industries[w.sites.def[suggestion.site]].name.toLowerCase()}
          </strong>{' '}
          near <strong style={{ color: 'var(--ink)' }}>{w.towns.names[suggestion.town]}</strong>,
          about {Math.round(suggestion.d)} tiles apart. Start from something that
          digs its cargo out of the ground rather than a works: a works only
          makes anything while somebody brings it materials, and at the moment
          nobody does.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ charter

export function CharterPanel({ engine }: { engine: Engine }): JSX.Element {
  const w = engine.world;
  const p = w.player;
  const have = w.companies.charter[p];
  const base = p * LINE_NAMES.length;
  const revenue =
    w.companies.ledgerYear[base + Line.Haulage] +
    w.companies.ledgerYear[base + Line.ContractBonus] +
    w.companies.ledgerYear[base + Line.AccessCharged];

  const goals: { label: string; have: number; need: number }[] =
    have === 0
      ? [
          { label: 'Contracts delivered', have: w.companies.delivered[p], need: CHARTER_REQUIREMENTS.construction.contracts },
          { label: 'Revenue this year', have: revenue, need: CHARTER_REQUIREMENTS.construction.revenue },
          { label: 'What you are worth', have: w.netWorth(p), need: CHARTER_REQUIREMENTS.construction.cash },
        ]
      : have === 1
        ? [
            { label: 'Revenue this year', have: revenue, need: CHARTER_REQUIREMENTS.extraction.revenue },
            { label: 'Infrastructure owned', have: w.ownedAssets(p), need: CHARTER_REQUIREMENTS.extraction.assets },
          ]
        : [
            { label: 'Revenue this year', have: revenue, need: CHARTER_REQUIREMENTS.land.revenue },
            { label: 'Industries owned', have: w.ownedSites(p), need: CHARTER_REQUIREMENTS.land.sites },
          ];

  return (
    <div className="window right">
      <h2>Charter <span className="chip">{CHARTER_NAMES[have]}</span></h2>
      <div className="body">
        <div style={{ padding: '10px', fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
          {have === 0 && 'You own vehicles and nothing else. The roads are the authority’s and you pay to use them. Earn the construction charter and you may lay your own.'}
          {have === 1 && 'You may lay road and rail, and charge others to use it. Found industry next.'}
          {have === 2 && 'You may found industry. Power, water and workers are three separate networks and a mine needs all three.'}
          {have === 3 && 'You shape what the region is.'}
        </div>
        {/* A requirement of nothing is not a requirement. Showing "0 of 0 —
            met" reads as a condition somebody forgot to fill in. */}
        {have < 3 && goals.filter((g) => g.need > 0).map((g) => {
          const done = g.have >= g.need;
          const frac = Math.min(1, g.have / g.need);
          const fmt = g.need > 1000 ? shortMoney : num;
          return (
            <div className="row" key={g.label}>
              <div className="grow">
                <div className="title">{g.label}</div>
                <div className="sub">{fmt(g.have)} of {fmt(g.need)}</div>
                <div className="meter" style={{ marginTop: 4 }}>
                  <div style={{ width: `${frac * 100}%`, background: done ? 'var(--good)' : 'var(--accent)' }} />
                </div>
              </div>
              {done && <span className="chip pos">met</span>}
            </div>
          );
        })}
      </div>
      <RegulatorNotice engine={engine} />
    </div>
  );
}

/**
 * How the authority sees you.
 *
 * Only drawn once there is something to see, because a panel that says 'no
 * action is being taken against you' every day for forty years is furniture.
 * But once the pressure is building it must be visible and it must be
 * quantified, because the whole claim of design.md 3.7 is that regulation is
 * *earned*, and a consequence the player could not see coming is not earned,
 * it is a random event. The two shares here are the two the regulator
 * actually measures — no hidden third term.
 */
function RegulatorNotice({ engine }: { engine: Engine }): JSX.Element | null {
  const w = engine.world;
  const p = w.player;
  const level = w.regulator.level[p];
  const tiles = w.regulator.tileShare[p];
  const trade = w.regulator.tradeShare[p];
  const watched = tiles > DOMINANCE_TILES * 100 || trade > DOMINANCE_TRADE * 100;
  if (level === Intervention.None && !watched) return null;

  const pressure = Math.min(1, w.regulator.pressure[p] / (PATIENCE_DAYS * TICKS_PER_DAY));
  return (
    <div className="body" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="row">
        <div className="grow">
          <div className="title">
            The authority{' '}
            <span className={level > Intervention.Referral ? 'chip neg' : 'chip'}>
              {INTERVENTION_NAMES[level]}
            </span>
          </div>
          <div className="sub">
            You hold {tiles}% of the region&rsquo;s way and {trade}% of its carrying trade.
          </div>
          {level < Intervention.CompulsoryPurchase && (
            <>
              <div className="sub" style={{ marginTop: 4 }}>
                {watched
                  ? 'A referral is being prepared. Sell, or charge less, and it lapses.'
                  : 'No longer dominant. The case against you is being wound down.'}
              </div>
              <div className="meter" style={{ marginTop: 4 }}>
                <div style={{ width: `${pressure * 100}%`, background: 'var(--bad)' }} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


// ------------------------------------------------------------- construction

/**
 * The build palette, and the estimate.
 *
 * The estimate is the point. design.md §13: terrain is a cost, not a paint
 * tool — so the player is told what the ridge costs before they buy it, and
 * the earthworks are itemised rather than folded into one number, because
 * "£40,000, of which £31,000 is a viaduct" is a different sentence from
 * "£40,000" and leads to a different decision.
 */
/** Headings for the construction palette. MODE_NAMES is lower case because it
 *  is an identifier; this is prose. */
const MODE_LABELS = ['Road', 'Rail', 'Canal', 'Air', 'Pipeline', 'Transmission', 'Conveyor'];

export function BuildPalette({
  engine, state, onSelect, onDemolish,
}: {
  engine: Engine;
  state: BuildState;
  onSelect: (mode: number, cls: number) => void;
  onDemolish: () => void;
}): JSX.Element {
  const w = engine.world;
  const ways = availableWays(w);
  const canBuild = w.companies.charter[w.player] >= 1;
  const byMode = new Map<number, typeof ways>();
  for (const way of ways) {
    const list = byMode.get(way.mode) ?? [];
    list.push(way);
    byMode.set(way.mode, list);
  }

  return (
    <div className="window left">
      <h2>Construction</h2>
      <div className="body">
        {!canBuild && (
          <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
            You hold no construction charter. Every road in the region belongs to
            the authority and you pay to use it. Deliver enough to be taken
            seriously and they will let you lay your own.
          </div>
        )}
        {canBuild && [...byMode.entries()].map(([mode, list]) => (
          <div key={mode}>
            <div className="ledger"><div className="head">{MODE_LABELS[mode]}</div></div>
            {list.map((way) => (
              <div
                key={way.id}
                className={`row click ${state.selection?.cls === way.index ? 'selected' : ''}`}
                onClick={() => onSelect(way.mode, way.index)}
              >
                <div className="grow">
                  <div className="title">{way.name}</div>
                  <div className="sub">{money(way.cost)} per tile on the flat</div>
                </div>
              </div>
            ))}
          </div>
        ))}
        {canBuild && (
          <div className="row">
            <button className={`btn tiny ${state.demolish ? 'danger' : ''}`} onClick={onDemolish}>
              {state.demolish ? 'Demolishing — click to stop' : 'Demolish'}
            </button>
          </div>
        )}
        {state.plan && (
          <>
            <div className="ledger"><div className="head">Estimate</div></div>
            <dl className="kv">
              <dt>Length</dt><dd>{state.plan.tiles.length} tiles</dd>
              <dt>Steepest gradient</dt>
              <dd className={state.plan.ok ? '' : 'neg'}>1 in {state.plan.steepest > 0 ? Math.round(64 / state.plan.steepest) : '∞'}</dd>
              {state.plan.earthworks > 0 && (<><dt>Cut and fill</dt><dd>{state.plan.earthworks} tiles</dd></>)}
              {state.plan.bridges > 0 && (<><dt>Bridge</dt><dd className="warnc">{state.plan.bridges} tiles</dd></>)}
              {state.plan.tunnels > 0 && (<><dt>Tunnel</dt><dd className="warnc">{state.plan.tunnels} tiles</dd></>)}
              {state.plan.locks > 0 && (
                <><dt>Locks</dt>
                <dd className="warnc">
                  {state.plan.locks} {state.plan.locks > 3 ? '(a flight)' : state.plan.locks === 1 ? 'chamber' : 'chambers'}
                </dd></>
              )}
              {state.plan.reused > 0 && (<><dt>Over existing</dt><dd>{state.plan.reused} tiles</dd></>)}
              <dt>Total</dt>
              <dd className={w.companies.cash[w.player] >= state.plan.totalCost ? '' : 'neg'}>
                {money(state.plan.totalCost)}
              </dd>
            </dl>
            {!state.plan.ok && (
              <div style={{ padding: '0 10px 10px', fontSize: 11.5, color: 'var(--bad)' }}>{state.plan.problem}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Ownership. design.md §3.2's triangle, made operable: pay is the default and
 * costs nothing to choose, buy is a button with a price on it, and bypass is
 * the construction palette.
 */
/**
 * Access agreements. design.md 3.6.
 *
 * "I use your line; you use my port" — the thing that entangles two operators
 * rather than merely racing them. Offered here rather than in a separate
 * screen because it belongs beside the roads it is about: the moment you want
 * one is the moment you are looking at what somebody else's way is costing
 * you.
 *
 * Only ever a discount, and both sides sign. design.md 3.10 worried that
 * differential rates would be a griefing vector, and that is exactly right for
 * *punitive* rates — so those do not exist. The worst anybody pays is the
 * posted charge.
 */
function Agreements({ engine }: { engine: Engine }): JSX.Element | null {
  const w = engine.world;
  const me = w.player;
  const mine = w.agreements.involving(me);
  const others: number[] = [];
  for (let c = 1; c < w.companies.count; c++) {
    if (c === me || w.companies.bankrupt[c]) continue;
    if (w.agreements.find(me, c) >= 0 || w.agreements.find(c, me) >= 0) continue;
    others.push(c);
  }
  if (mine.length === 0 && others.length === 0) return null;

  return (
    <>
      <div className="ledger"><div className="head">Access agreements</div></div>
      {mine.map((id) => {
        const grantor = w.agreements.grantor[id];
        const other = grantor === me ? w.agreements.beneficiary[id] : grantor;
        const granting = grantor === me;
        const offered = w.agreements.state[id] === AgreementState.Offered;
        const mustAnswerMe = offered && mustAnswer(w.agreements, id) === me;
        return (
          <div className="row" key={id}>
            <div className="grow">
              <div className="title">
                {w.companies.names[other]}{' '}
                <span className="dim">{granting ? 'uses your ways' : 'lets you use theirs'}</span>
              </div>
              <div className="sub">
                {w.agreements.ratePct[id]}% of the usual charge
                {' · '}{AGREEMENT_STATE_NAMES[w.agreements.state[id]].toLowerCase()}
              </div>
            </div>
            {mustAnswerMe ? (
              <div style={{ display: 'flex', gap: 3 }}>
                <button className="btn tiny" onClick={() => engine.issue(Cmd.AcceptAgreement, id)}>Accept</button>
                <button className="btn tiny" onClick={() => engine.issue(Cmd.DeclineAgreement, id)}>Decline</button>
              </div>
            ) : granting && w.agreements.state[id] === AgreementState.Active ? (
              <button className="btn tiny danger" onClick={() => engine.issue(Cmd.WithdrawAgreement, id)}>End</button>
            ) : (
              <span className="dim" style={{ fontSize: 11 }}>{offered ? 'awaiting them' : ''}</span>
            )}
          </div>
        );
      })}
      {others.map((c) => (
        <div className="row" key={`offer-${c}`}>
          <div className="grow">
            <div className="title">{w.companies.names[c]}</div>
            <div className="sub">no arrangement</div>
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            <button className="btn tiny" title="Let them use your ways at half the usual charge"
              onClick={() => engine.issue(Cmd.OfferAgreement, c, 50, 1)}>Offer half</button>
            <button className="btn tiny" title="Ask to use theirs at half the usual charge"
              onClick={() => engine.issue(Cmd.OfferAgreement, c, 50, 0)}>Ask half</button>
          </div>
        </div>
      ))}
    </>
  );
}

export function Ownership({ engine, onFocus }: { engine: Engine; onFocus: (x: number, y: number) => void }): JSX.Element {
  const w = engine.world;
  const rows: number[] = [];
  for (let a = 0; a < w.assets.count; a++) {
    if (w.assets.tiles[a] <= 0) continue;
    rows.push(a);
  }
  // Yours first, then whatever is earning most from you.
  rows.sort((a, b) => {
    const mine = (x: number): number => (w.assets.owner[x] === w.player ? 0 : 1);
    return mine(a) - mine(b) || w.assets.revenuePrev[b] - w.assets.revenuePrev[a];
  });

  return (
    <div className="window left">
      <h2>Ownership <span className="dim mono">{rows.filter((a) => w.assets.owner[a] === w.player).length} yours</span></h2>
      <div className="body">
        {/* Above the asset list, not below sixty rows of it: an agreement is a
            short section and a decision, and burying it under the inventory
            means nobody finds it. */}
        <Agreements engine={engine} />
        {rows.slice(0, 60).map((a) => {
          const owner = w.assets.owner[a];
          const mine = owner === w.player;
          const price = w.assets.valuation(a, C.balance.valuationPct);
          const way = C.ways[w.assets.cls[a]];
          const canBuy = !mine && w.companies.charter[w.player] >= 1;
          return (
            <div className="row" key={a}>
              <div className="grow">
                <div className="title">
                  {way.name} <span className="dim">· {w.assets.tiles[a]} tiles</span>
                </div>
                <div className="sub">
                  <span style={{ color: mine ? 'var(--owned)' : owner === 0 ? 'var(--public)' : 'var(--rival)' }}>
                    {w.companies.names[owner] ?? 'unknown'}
                  </span>
                  {' · '}{money(w.assets.charge[a])}/tile
                  {' · '}{w.assets.passesPrev[a]} passes
                  {' · '}earned {shortMoney(w.assets.revenuePrev[a])}
                </div>
              </div>
              {mine ? (
                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                  <button className="btn tiny" onClick={() => engine.issue(Cmd.SetCharge, a, Math.max(0, w.assets.charge[a] - 2))}>−</button>
                  <button className="btn tiny" onClick={() => engine.issue(Cmd.SetCharge, a, w.assets.charge[a] + 2)}>+</button>
                </div>
              ) : (
                <button className="btn tiny" disabled={!canBuy || w.companies.cash[w.player] < price}
                  onClick={() => engine.issue(Cmd.BuyAsset, a)}>
                  Buy {shortMoney(price)}
                </button>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--ink-dim)' }}>Nothing built yet.</div>
        )}
      </div>
      <div className="legend">
        <span className="dim">
          Raise a charge and traffic leaves. That is the whole damper: revenue is charge times
          volume, and volume falls as charge rises.
        </span>
      </div>
    </div>
  );
}


// ------------------------------------------------------------------- saves

/**
 * Saves. A seed plus a command log, so the whole game is a few kilobytes of
 * text you can paste to somebody — and loading one is a replay, verified
 * against the hashes the original recorded.
 */
export function Saves({
  engine, onLoad, onClose,
}: {
  engine: Engine;
  onLoad: (key: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [entries, setEntries] = useState(() => localStore.list());
  const [message, setMessage] = useState('');
  const w = engine.world;
  const stats = saveStats(w);

  const refresh = (): void => setEntries(localStore.list());

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" style={{ width: 'min(640px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, padding: '10px 14px', borderBottom: '1px solid var(--rule)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', display: 'flex', gap: 8 }}>
          <span style={{ flex: 1 }}>Saved games</span>
          <button className="btn tiny" onClick={onClose}>Close</button>
        </h2>
        <div className="body">
          <div className="row">
            <button className="btn tiny primary" onClick={() => {
              const e = saveWorld(w, `${w.companies.names[w.player]} — ${w.year}`);
              setMessage(e ? 'Saved.' : 'Could not save: storage is full or unavailable.');
              refresh();
            }}>Save now</button>
            <button className="btn tiny" onClick={() => downloadSave(w, w.companies.names[w.player] ?? 'interchange')}>
              Download a file
            </button>
            <label className="btn tiny" style={{ cursor: 'pointer' }}>
              Load a file
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={(ev) => {
                const file = ev.target.files?.[0];
                if (!file) return;
                file.text().then((text) => {
                  localStorage.setItem('interchange.save.imported', text.replace(/^﻿/, ''));
                  onLoad('imported');
                });
              }} />
            </label>
            <div className="grow" />
            <span className="sub">{(stats.bytes / 1024).toFixed(1)} kB</span>
          </div>
          {message && <div style={{ padding: '4px 10px', fontSize: 11.5, color: 'var(--ink-dim)' }}>{message}</div>}
          {entries.length === 0 && (
            <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--ink-dim)' }}>
              Nothing saved yet. The game autosaves every game year.
            </div>
          )}
          {entries.map((e) => (
            <div className="row click" key={e.key} onClick={() => onLoad(e.key)}>
              <div className="grow">
                <div className="title">{e.name} {e.auto && <span className="chip dim">auto</span>}</div>
                <div className="sub">
                  {e.year} · {money(e.cash)} · {(e.bytes / 1024).toFixed(1)} kB ·
                  {' '}{new Date(e.savedAt).toLocaleString('en-GB')}
                </div>
              </div>
              <button className="btn tiny danger" onClick={(ev) => { ev.stopPropagation(); localStore.remove(e.key); refresh(); }}>×</button>
            </div>
          ))}
        </div>
        <div className="legend">
          <span className="dim">
            A save is the region seed and every command you have issued. Loading one replays them and
            checks the result against the hashes the original recorded.
          </span>
        </div>
      </div>
    </div>
  );
}


// -------------------------------------------------------------- objectives

/**
 * Objectives, the fourth pressure system (D10).
 *
 * Two at a time and no more. A board of nine is a checklist, and a checklist
 * is the opposite of "events break routine" — the player stops reading it and
 * works down it, which is the same as having none.
 */
export function Objectives({ engine }: { engine: Engine }): JSX.Element {
  const w = engine.world;
  const open = w.objectives.openFor(w.player);
  return (
    <div className="window right">
      <h2>From the authority</h2>
      <div className="body">
        {open.length === 0 && (
          <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
            Nothing asked of you at the moment. The authority notices what you are
            not doing and gets in touch about it.
          </div>
        )}
        {open.map((id) => {
          const frac = Math.min(1, w.objectives.progress[id] / Math.max(1, w.objectives.target[id]));
          const left = w.objectives.deadline[id] - w.tick;
          return (
            <div className="row" key={id}>
              <div className="grow">
                <div className="title" style={{ whiteSpace: 'normal' }}>{w.objectives.text[id]}</div>
                <div className="sub">
                  pays {shortMoney(w.objectives.reward[id])} ·
                  <span className={left < TICKS_PER_DAY * 60 ? ' warnc' : ''}> {days(left, TICKS_PER_DAY)} left</span>
                </div>
                <div className="meter" style={{ marginTop: 4 }}>
                  <div style={{ width: `${frac * 100}%`, background: frac >= 1 ? 'var(--good)' : 'var(--accent)' }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- industry

/**
 * Founding industry: the extraction charter's verb.
 *
 * The list shows what the ground will take, not everything that exists —
 * because "a colliery needs coal and there is none here" is a better thing to
 * find out from a greyed-out row than from a refusal after you have picked a
 * spot.
 */
export function Industries({
  engine, selected, onSelect, tile,
}: {
  engine: Engine;
  selected: number;
  onSelect: (index: number) => void;
  tile: number;
}): JSX.Element {
  const w = engine.world;
  const era = w.era;
  const available = C.industries
    .map((ind, i) => ({ ind, i }))
    .filter(({ ind }) => ind.fromEra <= era && ind.foundCost > 0);

  return (
    <div className="window left">
      <h2>Found industry <span className="dim mono">{CHARTER_NAMES[w.companies.charter[w.player]]}</span></h2>
      <div className="body">
        {w.companies.charter[w.player] < 2 && (
          <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
            You have no extraction charter. You may haul, and you may build, but
            you may not dig. Run a real business at this level and the authority
            will let you.
          </div>
        )}
        {available.map(({ ind, i }) => {
          const problem = tile >= 0 ? w.canFound(w.player, i, tile) : '';
          const affordable = w.companies.cash[w.player] >= ind.foundCost;
          return (
            <div
              key={ind.id}
              className={`row click ${selected === i ? 'selected' : ''}`}
              onClick={() => onSelect(selected === i ? -1 : i)}
              style={{ opacity: affordable ? 1 : 0.45 }}
            >
              <div className="grow">
                <div className="title">{ind.name}</div>
                <div className="sub">
                  {money(ind.foundCost)}
                  {ind.powerNeed > 0 && ` · ${ind.powerNeed} power`}
                  {ind.waterNeed > 0 && ` · ${ind.waterNeed} water`}
                  {ind.labourNeed > 0 && ` · ${ind.labourNeed} workers`}
                </div>
                {selected === i && problem && (
                  <div className="sub neg" style={{ whiteSpace: 'normal', fontFamily: 'inherit' }}>{problem}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="legend">
        <span className="dim">Pick one, then click the ground. Extraction has to sit on the right deposit.</span>
      </div>
    </div>
  );
}
