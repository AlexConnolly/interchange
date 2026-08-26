/**
 * The market: three tabs, because there are three questions.
 *
 * It exists because the player found a hole the design had not. Owning a producer
 * left you holding stock with nothing to do with it — a shunt into another place
 * of your own pays nothing, and a run to somebody else's works pays a *fare*
 * rather than a price — so a farm's output piled up in its shed and the only
 * question the game could answer about it was "which lorry".
 *
 * ## Why it is tabbed and grouped
 *
 * The screen went through two wrong shapes first, and both failed the same way:
 * they put everything on one list.
 *
 * The first was a grid of abstract terms — "Cash today / In 10 days / In 30 days"
 * crossed with "Quarter / Half / All" — which asked the player to compose an
 * abstraction out of two dropdowns. Nobody thinks "I would like half of my milk on
 * ten-day terms".
 *
 * The second replaced that with named buyers, which is the right *unit*, and then
 * printed every one of them in a flat list mixed in with stock levels and pending
 * cheques. With four cargoes and two buyers each that is eight offer lines among
 * a dozen other rows, and the thing you came to find — how much is my milk worth —
 * is somewhere in the middle of it.
 *
 * So: **Sell** groups by cargo and leads with the price *range*, which is the
 * question ("what is milk fetching") before the decision ("which of these two
 * buyers"). **Pending** is money owed. **History** is what you sold and got. Three
 * questions, three tabs, and none of them is answered by scrolling past the other
 * two.
 */

import { useState, type JSX } from 'react';
import { type World, MoneyKind } from '@interchange/sim';
import { content } from '@interchange/data';
import { money } from './Markers.tsx';
import { Icon } from './Icons.tsx';

const C = content();

type Tab = 'sell' | 'pending' | 'history';

export function Market({
  world, onClose, onSold,
}: {
  world: World;
  onClose: () => void;
  onSold: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('sell');
  /** Which cargo's buyers are open, or -1 for the grouped list. */
  const [open, setOpen] = useState(-1);

  const held = world.stockHeld();
  const offers = world.marketBuyers();
  const pending = world.pendingSales();
  const history = world.moneyAt(-1, 40).filter((r) => r.kind === MoneyKind.Market);

  /** Offers for one cargo, and the range they span. */
  const forCargo = (cargo: number) => offers.filter((o) => o.cargo === cargo);

  const openCargo = open >= 0 ? forCargo(open) : [];

  return (
    <div className="bubble fixed market">
      <div className="sheet-head">
        {open >= 0 ? (
          <button className="x" data-quiet onClick={() => setOpen(-1)} aria-label="Back">‹</button>
        ) : (
          <span className="sheet-icon"><Icon id="builders-merchant" size={24} /></span>
        )}
        <div className="grow">
          <div className="sheet-title">
            {open >= 0 ? C.cargo[open].name : 'Market'}
          </div>
          <div className="sheet-sub">
            {open >= 0
              ? `${openCargo.length} ${openCargo.length === 1 ? 'buyer' : 'buyers'}`
              : 'Sell from stock, no lorry needed'}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>

      {open < 0 && (
        <div className="tabs" role="tablist">
          <button
            className={`tab ${tab === 'sell' ? 'on' : ''}`}
            onClick={() => setTab('sell')}
          >Sell{held.length > 0 && <em>{held.length}</em>}</button>
          <button
            className={`tab ${tab === 'pending' ? 'on' : ''}`}
            onClick={() => setTab('pending')}
            disabled={pending.length === 0}
          >Pending{pending.length > 0 && <em>{pending.length}</em>}</button>
          <button
            className={`tab ${tab === 'history' ? 'on' : ''}`}
            onClick={() => setTab('history')}
            disabled={history.length === 0}
          >History</button>
        </div>
      )}

      <div className={`bubble-body${open >= 0 ? ' slide-in' : ''}`}>
        {/* ---- one cargo's buyers ------------------------------------- */}
        {open >= 0 && openCargo.length === 0 && (
          <div className="why">Nobody is buying it this week.</div>
        )}
        {open >= 0 && openCargo.map((o) => (
          <button
            key={o.key}
            className="offer"
            onClick={() => {
              if (world.acceptOffer(o.key)) { setOpen(-1); onSold(); }
            }}
          >
            <span className="grow">
              <span className="offer-buyer">{o.buyer}</span>
              <span className="offer-what">
                {o.tonnes}t · {o.days === 0 ? 'pays on collection' : `pays in ${o.days} days`}
              </span>
            </span>
            <span className="offer-sum">
              {money(o.pence)}
              <i>{money(o.pence / o.tonnes)}/t</i>
            </span>
          </button>
        ))}

        {/* ---- sell: grouped by cargo, leading with the range --------- */}
        {open < 0 && tab === 'sell' && held.length === 0 && (
          <div className="why">
            Nothing to sell yet. Stock builds up at places you own — a farm fills
            its shed whether or not a lorry comes.
          </div>
        )}
        {open < 0 && tab === 'sell' && held.map((h) => {
          const mine = forCargo(h.cargo);
          const rates = mine.map((o) => o.pence / o.tonnes);
          const low = Math.min(...rates);
          const high = Math.max(...rates);
          return (
            <button
              key={h.cargo}
              className="stock-head"
              disabled={mine.length === 0}
              onClick={() => setOpen(h.cargo)}
            >
              <span className="swatch" style={{ background: C.cargo[h.cargo].colour }} />
              <span className="grow">
                <span className="stock-name">{C.cargo[h.cargo].name}</span>
                <span className="stock-sub">
                  {h.tonnes}t in your sheds
                  {/*
                    * The range, which is the question this screen is opened with.
                    * One figure when both buyers happen to pay the same, because
                    * "between £287 and £287" is a worse sentence than "£287".
                    */}
                  {mine.length > 0 && (low === high
                    ? ` · ${money(low)}/t`
                    : ` · ${money(low)}–${money(high)}/t`)}
                </span>
              </span>
              {mine.length === 0
                ? <span className="stock-none">no buyers</span>
                : <span className="stock-go">›</span>}
            </button>
          );
        })}

        {/* ---- pending ------------------------------------------------ */}
        {open < 0 && tab === 'pending' && pending.map((s, i) => {
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

        {/* ---- history ------------------------------------------------ */}
        {open < 0 && tab === 'history' && history.map((r, i) => (
          <div className="tx" key={`${r.tick}-${i}`}>
            <span className="swatch" style={{ background: C.cargo[r.cargo].colour }} />
            <span className="grow">
              <span className="tx-why">
                {Math.round(r.tonnes)}t of {C.cargo[r.cargo].name.toLowerCase()}
              </span>
              <span className="tx-when">{world.stampOf(r.tick)}</span>
            </span>
            <span className="tx-sum in">{money(r.pence)}</span>
          </div>
        ))}
      </div>
      <span className="bubble-arrow" />
    </div>
  );
}
