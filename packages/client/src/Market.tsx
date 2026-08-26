/**
 * The market: what you are holding, and what somebody will give you for it.
 *
 * This screen exists because the player found a hole the design had not: owning a
 * producer left you with stock and nothing to do with it. Hauling it into another
 * place of your own is a shunt and pays nothing; hauling it to somebody else's
 * works pays a *fare* rather than a price. So a farm's output piled up in its shed
 * and the only question the game could answer about it was "which lorry".
 *
 * A market answers a different question — "what is this worth, and when do you
 * want the money" — and it needs no lorry at all. Which is deliberate: a haulage
 * game should have exactly one thing you can do without a vehicle, and it should
 * pay worse than the vehicle would.
 *
 * ## Why the terms are the whole interface
 *
 * There is one axis: **patience**. Cash today at a third of the value, ten days at
 * two thirds, a month at all of it. No haggling, no market movements, no supply
 * and demand — those would each be a system to learn, and none of them would say
 * anything the three columns do not. What the player is actually deciding is
 * whether they need money *now*, which is a real decision in a business where the
 * next lorry costs six thousand pounds.
 */

import { useState, type JSX } from 'react';
import { type World } from '@interchange/sim';
import { content } from '@interchange/data';
import { money } from './Markers.tsx';
import { Icon } from './Icons.tsx';

const C = content();

/** How much of a line to sell. Coarse on purpose: this is not a spreadsheet. */
const SHARES = [
  { label: 'Quarter', of: 0.25 },
  { label: 'Half', of: 0.5 },
  { label: 'All', of: 1 },
];

export function Market({
  world, onClose, onSold,
}: {
  world: World;
  onClose: () => void;
  onSold: () => void;
}): JSX.Element {
  /** Which cargo's terms are open. One at a time: this is a decision, not a form. */
  const [open, setOpen] = useState(-1);
  const held = world.stockHeld();
  const pending = world.pendingSales();

  return (
    <div className="panel market">
      <div className="sheet-head">
        <span className="sheet-icon"><Icon id="terminal" size={24} /></span>
        <div className="grow">
          <div className="sheet-title">Market</div>
          <div className="sheet-sub">
            {held.length === 0 ? 'Nothing in stock' : `${held.length} to sell`}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="panel-body">
        {held.length === 0 && (
          <div className="why">
            Nothing to sell yet. Stock builds up at places you own — a farm fills
            its shed whether or not a lorry comes.
          </div>
        )}

        {held.map((h) => {
          const cargo = C.cargo[h.cargo];
          const offers = world.marketOffers(h.cargo);
          return (
            <div className="stock-card" key={h.cargo}>
              <button
                className="stock-head"
                onClick={() => setOpen(open === h.cargo ? -1 : h.cargo)}
              >
                <span className="swatch" style={{ background: cargo.colour }} />
                <span className="grow">
                  <span className="stock-name">{cargo.name}</span>
                  {/*
                    * What it cost to make, which is the number that turns a pile
                    * of stock into a decision. Derived from the recipe that makes
                    * it — the value of a thing's inputs *is* what it cost, in a
                    * game where inputs are the only cost.
                    */}
                  <span className="stock-sub">
                    {h.tonnes}t · worth {money(h.value)}/t
                  </span>
                </span>
                <span className="stock-total">{money(h.value * h.tonnes)}</span>
                <span className="stock-go">{open === h.cargo ? '⌄' : '›'}</span>
              </button>

              {open === h.cargo && (
                <div className="terms">
                  {offers.map((o, term) => (
                    <div className="term" key={o.days}>
                      <span className="term-when">
                        {o.days === 0 ? 'Cash today' : `In ${o.days} days`}
                      </span>
                      <span className="term-rate">{money(o.pence)}<i>/t</i></span>
                      <span className="term-buttons">
                        {SHARES.map((sh) => {
                          const tonnes = Math.max(1, Math.floor(h.tonnes * sh.of));
                          return (
                            <button
                              key={sh.label}
                              className="term-sell"
                              title={`${tonnes}t for ${money(o.pence * tonnes)}`}
                              onClick={() => {
                                if (world.sellOnMarket(h.cargo, tonnes, term)) {
                                  setOpen(-1);
                                  onSold();
                                }
                              }}
                            >{sh.label}</button>
                          );
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {pending.length > 0 && <div className="head">Waiting to be paid</div>}
        {pending.map((s, i) => {
          const days = Math.max(0, Math.round((s.dueTick - world.tick) / 3200));
          return (
            <div className="tx" key={`${s.dueTick}-${i}`}>
              <span className="swatch" style={{ background: C.cargo[s.cargo].colour }} />
              <span className="grow">
                <span className="tx-why">{s.tonnes}t of {C.cargo[s.cargo].name.toLowerCase()}</span>
                <span className="tx-when">
                  {days === 0 ? 'due today' : days === 1 ? 'tomorrow' : `in ${days} days`}
                </span>
              </span>
              <span className="tx-sum in">{money(s.pence)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
