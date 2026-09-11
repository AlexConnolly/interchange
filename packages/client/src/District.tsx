/**
 * What the district is short of, and what it is drowning in.
 *
 * The one question nothing in the game could answer. A player could see a works
 * of theirs was starved — `fed` has always driven the state on its panel — and
 * could not see *why*, or what to do about it, because "why" is a fact about the
 * whole district and every screen was about one place.
 *
 * ## What the numbers said the first time they were summed
 *
 * Measured on seed 1985 before this screen existed, and it is worth writing down
 * because it is the opposite of what everybody assumed: the district **starves
 * its own works of raw materials and drowns in finished goods.** Milk ran at 0.76
 * of what the creameries wanted, produce 0.47, feed 0.52, timber 0.60 — and dairy
 * was over-made fifty-six times over, meat thirty-five, beer eighteen, with
 * nothing in the district taking sawn timber at all.
 *
 * The cause is one line of content: **exactly one building has `retail: true`.**
 * The chain has somewhere to start and nowhere to end. Nobody had noticed because
 * nothing added the numbers up.
 *
 * ## Why the verdict is a sentence and not a bar
 *
 * A ratio under one has two opposite causes wanting opposite answers, and a bar
 * cannot tell them apart. Milk at 0.76 with two hundred tonnes standing at the
 * farms is not a shortage of milk — it is a shortage of *lorries*, and building
 * another dairy farm would make it worse. The same ratio with empty sheds at both
 * ends is a real shortage and wants another farm.
 *
 * So each row says which it is, in words, and `districtBalance` does that reading
 * in the simulation rather than here — a panel should not be the only thing that
 * knows what the numbers mean.
 */

import { type JSX } from 'react';
import type { World } from '@interchange/sim';
import { content } from '@interchange/data';
import { Icon } from './Icons.tsx';

const C = content();

/** What a row's verdict means, and what to do about it. */
const SAYS: Record<string, { label: string; note: string; tone: string }> = {
  short: {
    label: 'short',
    note: 'Not enough of it is being made. Somewhere to make it would pay.',
    tone: 'bad',
  },
  stranded: {
    label: 'stranded',
    note: 'Enough exists. It is standing in the wrong sheds — this wants a lorry, not a works.',
    tone: 'warn',
  },
  unwanted: {
    label: 'nobody wants it',
    note: 'More is made than anything takes. Somewhere to sell it is what is missing.',
    tone: 'warn',
  },
  balanced: { label: 'about right', note: '', tone: 'ok' },
};

/** Tonnes, at the precision the figure deserves. */
function t(n: number): string {
  if (n <= 0) return '—';
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

export function District({
  world, onClose,
}: {
  world: World;
  onClose: () => void;
}): JSX.Element {
  /*
   * Read fresh every render like every other panel in this game, because it is a
   * walk over a couple of dozen sites and the answer changes the moment a lorry
   * unloads. A cached one would go stale in exactly the moment the player opened
   * the screen to check.
   */
  const rows = world.districtBalance();

  /*
   * Trouble first, and within that the biggest flows first.
   *
   * The list is thirteen cargoes and most of them are usually fine; a player
   * opening this wants the two that are not, and alphabetical or content order
   * buries them. `balanced` sorts last so the screen reads as a list of problems
   * with the working district underneath it rather than as a table to scan.
   */
  const order = ['short', 'stranded', 'unwanted', 'balanced'];
  const sorted = [...rows].sort((a, b) => {
    const d = order.indexOf(a.verdict) - order.indexOf(b.verdict);
    if (d !== 0) return d;
    return (b.made + b.wantedByWorks) - (a.made + a.wantedByWorks);
  });

  const trouble = sorted.filter((r) => r.verdict !== 'balanced').length;

  return (
    <div className="bubble fixed market district">
      <div className="sheet-head">
        <span className="sheet-icon"><Icon id="creamery" size={24} /></span>
        <div className="grow">
          <div className="sheet-title">The district</div>
          <div className="sheet-sub">
            {trouble === 0
              ? 'Everything made has somewhere to go'
              : `${trouble} of ${rows.length} out of balance`}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">&times;</button>
      </div>

      <div className="dist-rows">
        {sorted.map((r) => {
          const cargo = C.cargo[r.cargo];
          const says = SAYS[r.verdict];
          const wanted = r.wantedByWorks + r.wantedByTowns;
          return (
            <div key={r.cargo} className={`dist-row ${says.tone}`}>
              <div className="dist-head">
                <span className="swatch" style={{ background: cargo.colour }} />
                <span className="grow">{cargo.name}</span>
                <span className={`dist-tag ${says.tone}`}>{says.label}</span>
              </div>
              <div className="dist-figures">
                <span><i>made</i><b>{t(r.made)}</b></span>
                <span><i>works want</i><b>{t(r.wantedByWorks)}</b></span>
                {/*
                  * The villages only when they want any. Most cargo in this
                  * district is business to business, so a column of dashes would
                  * be three quarters of the table saying nothing.
                  */}
                {r.wantedByTowns > 0 && (
                  <span><i>villages</i><b>{t(r.wantedByTowns)}</b></span>
                )}
                {/*
                  * And where it is standing, which is the half that separates a
                  * works problem from a lorry problem. Only when the *makers*
                  * hold some, because that is the whole of what this column is
                  * for — "0t at the makers" is a sentence that reads as a finding
                  * and says nothing.
                  */}
                {r.atMakers > 0 && (
                  <span className="dist-stock">
                    <i>standing</i>
                    <b>{Math.round(r.atMakers)}t at the makers</b>
                  </span>
                )}
              </div>
              {says.note !== '' && <div className="dist-note">{says.note}</div>}
              {wanted <= 0 && (
                <div className="dist-note">Nothing in the district takes it at all.</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="sheet-foot">Tonnes a day.</div>
    </div>
  );
}
