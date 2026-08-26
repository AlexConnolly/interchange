/**
 * The market: who wants what you are holding, and what they will give for it.
 *
 * This screen exists because the player found a hole the design had not. Owning a
 * producer left you with stock and nothing to do with it — a shunt into another
 * place of your own pays nothing, and a run to somebody else's works pays a
 * *fare* rather than a price — so a farm's output piled up in its shed and the
 * only question the game could answer about it was "which lorry".
 *
 * ## Buyers, not terms
 *
 * The first version of this was a grid: three rows reading "Cash today", "In 10
 * days", "In 30 days", each with Quarter / Half / All buttons. It was a correct
 * model of the mechanic and a horrible thing to look at — "that is a horrific
 * system" — because it asked the player to compose an abstraction out of two
 * dropdowns. Nobody thinks "I would like half of my milk on ten-day terms".
 *
 * So the same mechanic is dressed as what it would actually be: **named buyers
 * with standing offers.** A dairy wants forty tonnes and pays on the nail; a
 * wholesaler wants a hundred and pays in a month, better. You take an offer or
 * you leave it. The tonnage and the terms come *with* the offer instead of being
 * assembled from parts, which is one decision instead of three, and it reads as a
 * world with people in it rather than a settings panel.
 *
 * The buyers are invented and stable per cargo per week — see `marketBuyers` in
 * the simulation. They are not real places on the map, and that is deliberate: a
 * real place would need a lorry, and the whole point of this screen is that it is
 * the one thing you can do without one.
 */

import { type JSX } from 'react';
import { type World } from '@interchange/sim';
import { content } from '@interchange/data';
import { money } from './Markers.tsx';
import { Icon } from './Icons.tsx';

const C = content();

export function Market({
  world, onClose, onSold,
}: {
  world: World;
  onClose: () => void;
  onSold: () => void;
}): JSX.Element {
  const held = world.stockHeld();
  const pending = world.pendingSales();
  const offers = world.marketBuyers();

  return (
    <div className="bubble fixed market">
      <div className="sheet-head">
        <span className="sheet-icon"><Icon id="builders-merchant" size={24} /></span>
        <div className="grow">
          <div className="sheet-title">Market</div>
          <div className="sheet-sub">
            {offers.length === 0
              ? held.length === 0 ? 'Nothing in stock' : 'No buyers this week'
              : `${offers.length} ${offers.length === 1 ? 'buyer' : 'buyers'}`}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="bubble-body">
        {held.length === 0 && (
          <div className="why">
            Nothing to sell yet. Stock builds up at places you own — a farm fills
            its shed whether or not a lorry comes.
          </div>
        )}

        {held.length > 0 && offers.length === 0 && (
          <div className="why">
            Nobody is buying what you hold this week. Offers change every week.
          </div>
        )}

        {offers.map((o) => {
          const cargo = C.cargo[o.cargo];
          return (
            <button
              key={o.key}
              className="offer"
              onClick={() => { if (world.acceptOffer(o.key)) onSold(); }}
              title={`${o.buyer} takes ${o.tonnes}t of ${cargo.name.toLowerCase()}`}
            >
              <span className="swatch" style={{ background: cargo.colour }} />
              <span className="grow">
                <span className="offer-buyer">{o.buyer}</span>
                <span className="offer-what">
                  {o.tonnes}t of {cargo.name.toLowerCase()}
                  {' · '}
                  {o.days === 0 ? 'pays on collection' : `pays in ${o.days} days`}
                </span>
              </span>
              <span className="offer-sum">
                {money(o.pence)}
                <i>{money(o.pence / o.tonnes)}/t</i>
              </span>
            </button>
          );
        })}

        {held.length > 0 && <div className="head">In your sheds</div>}
        {held.map((h) => (
          <div className="fact" key={h.cargo}>
            <span className="swatch" style={{ background: C.cargo[h.cargo].colour }} />
            <span className="grow">
              <span className="fact-name">{C.cargo[h.cargo].name}</span>
              <span className="fact-sub">worth {money(h.value)}/t</span>
            </span>
            <span className="fact-body">{h.tonnes}t</span>
          </div>
        ))}

        {pending.length > 0 && <div className="head">Waiting to be paid</div>}
        {pending.map((s, i) => {
          const days = Math.max(0, Math.round((s.dueTick - world.tick) / 3200));
          return (
            <div className="tx" key={`${s.dueTick}-${i}`}>
              <span className="swatch" style={{ background: C.cargo[s.cargo].colour }} />
              <span className="grow">
                <span className="tx-why">
                  {s.tonnes}t of {C.cargo[s.cargo].name.toLowerCase()}
                </span>
                <span className="tx-when">
                  {days === 0 ? 'due today' : days === 1 ? 'tomorrow' : `in ${days} days`}
                </span>
              </span>
              <span className="tx-sum in">{money(s.pence)}</span>
            </div>
          );
        })}
      </div>
      <span className="bubble-arrow" />
    </div>
  );
}
