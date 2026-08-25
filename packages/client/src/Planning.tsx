/**
 * The planning board. design.md §3's last rung, and the end of the ladder.
 *
 * "I move milk" → "I can influence the world to get a better road in place".
 * This is the screen where that happens, and it is the only screen in the game
 * that changes the district rather than what you own in it.
 *
 * It does not exist until you are a presence. `world.planningOpen()` gates the
 * whole thing on fleet size, because design.md is emphatic that nobody cares
 * about your approval rating until further along — and a bar filling up on day
 * one would make the opening a game about a bar rather than about a milk round.
 * So the HUD button is not there, and then one day it is.
 *
 * Two halves, and the order matters. **What they think of you** comes first,
 * because approval is the thing you cannot buy and therefore the thing to
 * understand first. **What you can ask for** comes second, and every entry in it
 * is about a road you personally drive between two places you personally own —
 * which is what keeps it a decision rather than a level editor.
 */

import { type JSX } from 'react';
import { type World, Works } from '@interchange/sim';
import { money } from './Markers.tsx';
import { Icon } from './Icons.tsx';

/** Steps for funding the parish. Three, because a slider is a spreadsheet. */
const LEVIES = [50_000, 250_000, 1_000_000];

export function Planning({
  world, onFund, onPropose, onClose,
}: {
  world: World;
  onFund: (pence: number) => void;
  onPropose: (works: number, from: number, to: number) => void;
  onClose: () => void;
}): JSX.Element {
  const approval = world.approval;
  const cash = world.companies.cash[world.player];
  const proposals = world.proposals();

  /*
   * Words, not a number, as the headline.
   *
   * "62" is a figure to optimise. "They know who you are" is a description of
   * your position in a place, which is what this rung is actually about — and
   * the bar underneath carries the precision for anyone who wants it.
   */
  const standing = approval >= 80 ? 'You are one of them'
    : approval >= 62 ? 'They think well of you'
      : approval >= 45 ? 'They know who you are'
        : approval >= 33 ? 'A haulier who passes through'
          : 'Nobody has heard of you';

  return (
    <div className="bubble fixed">
      <div className="sheet-head">
        <span className="sheet-icon"><Icon id="village-shop" size={24} /></span>
        <div className="grow">
          <div className="sheet-title">The parish</div>
          <div className="sheet-sub">{standing}</div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="bubble-body">
        <div className="approval">
          <div className="approval-bar">
            <span style={{ width: `${Math.max(2, Math.min(100, approval))}%` }} />
            {/* Where the next thing you could ask for sits, so the bar is a
                target and not just a readout. */}
            {proposals.filter((p) => !p.ok && p.approval > approval).slice(0, 1).map((p) => (
              <i key={p.works} style={{ left: `${Math.min(98, p.approval)}%` }} />
            ))}
          </div>
          <div className="approval-num">{Math.floor(approval)}</div>
        </div>

        <div className="head">Put something in</div>
        <div className="levies">
          {LEVIES.map((pence) => (
            <button
              key={pence}
              className="btn"
              disabled={cash < pence}
              onClick={() => onFund(pence)}
            >{money(pence)}</button>
          ))}
        </div>
        {/*
          * The one thing worth saying in words, because it is the rule that
          * stops the last rung being a purchase and the player cannot infer it
          * from three buttons.
          */}
        <div className="why">
          Money helps less the better they already think of you. Past about sixty
          only the work counts.
        </div>

        <div className="head">What you can ask for</div>
        {proposals.length === 0 && (
          <div className="why">Nothing worth putting to them yet.</div>
        )}
        {proposals.map((p) => (
          <button
            key={`${p.works}:${p.from}:${p.to}`}
            className="job"
            disabled={!p.ok}
            onClick={() => onPropose(p.works, p.from, p.to)}
          >
            <span className="job-line">
              <span className="grow">
                {p.works === Works.Standing ? 'Ask to be counted' : `Widen: ${p.label}`}
              </span>
              <span className="pay">{money(p.cost)}</span>
            </span>
            <span className={`needs ${p.ok ? '' : 'cannot'}`}>
              {p.works === Works.Standing
                ? 'Your name carries further'
                : 'A proper road, and faster lorries'}
              {!p.ok && <b>{p.reason}</b>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
