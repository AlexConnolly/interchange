/**
 * Contract pins, and the panel that opens off one.
 *
 * design.md §2: a place with work going shows a marker above it; click it and a
 * floating panel opens over the world with what the place is and what it offers.
 * That is the interaction, and there is no other.
 *
 * These are DOM rather than geometry, deliberately. A pin wants crisp text, a
 * pointer cursor, a hover state and a click handler — all four are free in HTML
 * and a project in WebGL — so the renderer's only job is to say where on screen
 * a place has landed (`Renderer.project`).
 *
 * The whole file is under the eight-control budget: a pin is not a control until
 * you click it, and the panel that opens has three.
 */

import { useEffect, useState } from 'react';
import { ContractState, type World } from '@interchange/sim';
import { content } from '@interchange/data';
import type { Renderer } from '@interchange/render';

const C = content();

export interface PinPosition {
  contract: number;
  site: number;
  x: number;
  y: number;
}

/** Money, as a haulier would say it. */
export function money(pence: number): string {
  const p = Math.round(pence);
  if (Math.abs(p) >= 100_000_00) return `£${(p / 100_000_00).toFixed(1)}m`;
  if (Math.abs(p) >= 1_000_00) return `£${Math.round(p / 100).toLocaleString('en-GB')}`;
  return `£${(p / 100).toFixed(2)}`;
}

/**
 * The pins.
 *
 * Recomputed every frame from the camera, which sounds expensive and is not:
 * there are at most five offers on the board at once, because five offers is a
 * decision and twenty-four is a job board.
 */
export function Pins({
  world, renderer, revision, onOpen,
}: {
  world: World;
  renderer: Renderer;
  revision: number;
  onOpen: (contract: number) => void;
}): JSX.Element {
  const [pins, setPins] = useState<PinPosition[]>([]);

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const board = world.contractBoard;
      const out: PinPosition[] = [];
      for (let i = 0; i < board.count; i++) {
        if (board.state[i] !== ContractState.Offered) continue;
        const site = board.from[i];
        if (site < 0) continue;
        const x = world.sites.x[site];
        const z = world.sites.y[site];
        const at = renderer.project(
          x + 0.5, world.terrain.height[z * world.terrain.size + x], z + 0.5,
        );
        if (!at) continue;
        out.push({ contract: i, site, x: at.x, y: at.y });
      }
      setPins(out);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, renderer]);

  void revision;

  return (
    <>
      {pins.map((p) => (
        <button
          key={p.contract}
          className="pin"
          style={{ left: p.x, top: p.y }}
          onClick={() => onOpen(p.contract)}
          title={C.industries[world.sites.def[p.site]].name}
        >
          <span className="pin-body">£</span>
          <span className="pin-tail" />
        </button>
      ))}
    </>
  );
}

/**
 * The panel. One place, what it is, and what it is offering.
 *
 * Three controls: take it, or close. The old build's inspector had eleven rows
 * of statistics and a stop editor, and it is the single clearest example of what
 * "no spreadsheet" is protecting against.
 */
export function ContractPanel({
  world, contract, onClose, onAccept,
}: {
  world: World;
  contract: number;
  onClose: () => void;
  onAccept: (contract: number) => void;
}): JSX.Element | null {
  const b = world.contractBoard;
  if (contract < 0 || contract >= b.count) return null;
  const from = b.from[contract];
  const to = b.to[contract];
  if (from < 0 || to < 0) return null;

  const fromDef = C.industries[world.sites.def[from]];
  const toDef = C.industries[world.sites.def[to]];
  const cargo = C.cargo[b.cargo[contract]];

  // A truck free to take it, which is the only precondition worth stating.
  let free = 0;
  for (let v = 0; v < world.vehicles.count; v++) {
    if (!world.vehicles.alive[v]) continue;
    if (world.vehicles.company[v] !== world.player) continue;
    if (world.vehicles.service[v] === -1) free++;
  }

  const taken = b.state[contract] !== ContractState.Offered;

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">{fromDef.name}</span>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="panel-body">
        <div className="offer">
          <div className="offer-line">
            <span className="swatch" style={{ background: cargo.colour }} />
            <strong>{cargo.name}</strong> to the {toDef.name.toLowerCase()}
          </div>
          <dl>
            <dt>Distance</dt><dd>{b.distance[contract]} tiles</dd>
            <dt>Pays</dt><dd>{money(b.pay[contract])} a load</dd>
            <dt>Needs</dt><dd>{cargo.handling === 'refrigerated' ? 'a chilled box' : cargo.handling === 'liquid' ? 'a tanker' : cargo.handling === 'bulk' ? 'a tipper' : 'a box van'}</dd>
          </dl>
        </div>
        {free === 0 && !taken && (
          <div className="note">Every truck is out. You need another one.</div>
        )}
        <div className="actions">
          <button
            className="btn primary"
            disabled={taken || free === 0}
            onClick={() => onAccept(contract)}
          >
            {taken ? 'Taken' : 'Take it'}
          </button>
        </div>
      </div>
    </div>
  );
}
