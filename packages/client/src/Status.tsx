/**
 * The readout: money on the left, the clock on the right.
 *
 * It was one grey bar in the top-left with the brand, the money, the date and
 * two counts crammed into it — "rather than this kinda horrible UI that we have
 * the top left, just make it a little bit nicer".
 *
 * Split, and the split is the point. Money is the thing you check constantly and
 * it is *yours*, so it sits where the eye already goes. The clock is ambient —
 * you glance at it to know what season it is and whether the lights are about to
 * come on — so it goes to the far side and carries the one thing the old bar
 * could not show at all: **where in the day you are**.
 *
 * That dial is doing real work now that a day is four minutes long and the night
 * is dark. "Is it about to get dark" is a question with consequences — a winter
 * evening is when an unfitted lorry stops — and the answer used to be somewhere
 * in the lighting.
 */

import { type JSX } from 'react';
import { money } from './Markers.tsx';

/**
 * A day, as a ring with a marker going round it.
 *
 * Twenty-four hours as a circle rather than a bar, because a day *is* a cycle
 * and a bar that jumps from the right-hand end back to the left is the same
 * discontinuity the sun had. The lit arc is daylight; the marker is now.
 */
function DayRing({ fraction, night }: { fraction: number; night: number }): JSX.Element {
  const r = 13;
  const c = 2 * Math.PI * r;
  // Daylight runs from dawn to dusk, which is the arc the sun is above the
  // horizon: see `placeSun`, where height is 0.24 + 0.76 sin.
  const lit = 0.62;
  const angle = fraction * 360 - 90;
  return (
    <svg className="ring" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r={r} className="ring-track" />
      <circle
        cx="16"
        cy="16"
        r={r}
        className="ring-lit"
        strokeDasharray={`${c * lit} ${c}`}
        transform="rotate(-90 16 16)"
      />
      <g transform={`rotate(${angle} 16 16)`}>
        <circle cx={16 + r} cy="16" r="3.4" className="ring-now" />
      </g>
      {/* A moon inside once it is properly dark. Cheaper than a legend and it
          says the same thing. */}
      {night > 0.5 && <circle cx="16" cy="16" r="3.2" className="ring-moon" />}
    </svg>
  );
}

export function Status({
  cash, date, out, idle, dayFraction, night, weather, onMenu,
}: {
  cash: number;
  date: string;
  out: number;
  idle: number;
  dayFraction: number;
  night: number;
  weather: number;
  onMenu: () => void;
}): JSX.Element {
  return (
    <>
      <div className="purse">
        {/* A bank, drawn rather than written. The one figure that never needs a
            label: nothing else in the game is in pounds. */}
        <svg className="purse-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.6 22 8v2H2V8Z" />
          <rect x="4.4" y="11" width="2.6" height="7.4" rx="0.6" />
          <rect x="10.7" y="11" width="2.6" height="7.4" rx="0.6" />
          <rect x="17" y="11" width="2.6" height="7.4" rx="0.6" />
          <rect x="2" y="19.4" width="20" height="2.4" rx="0.8" />
        </svg>
        <span className="purse-sum">{money(cash)}</span>
      </div>

      <div className="clock">
        <div className="clock-text">
          <span className="clock-date">{date}</span>
          <span className="clock-sub">
            {out} out · {idle} idle
            {weather > 0.72 ? ' · overcast' : weather < 0.22 ? ' · clear' : ''}
          </span>
        </div>
        <DayRing fraction={dayFraction} night={night} />
        {/*
          * One button, and it opens the menu the sound now lives in.
          *
          * It used to be a mute toggle, which was the right control for a game
          * with exactly one audio setting and the wrong one the moment there
          * were four. A cog next to the clock costs the same seventeen pixels
          * and does not have to grow when the next option arrives.
          *
          * `data-quiet` so pressing it does not itself click, which on the way
          * *into* the sound settings would be the one noise you did not ask for.
          */}
        <button
          className="cog"
          onClick={onMenu}
          data-quiet
          aria-label="Settings"
          title="Settings (Esc)"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Zm0 5.7a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2Z" />
            <path d="M20.3 13.6a8.6 8.6 0 0 0 0-3.2l1.9-1.4-1.9-3.3-2.2.9a8.4 8.4 0 0 0-2.8-1.6L15 2.5h-3.8l-.3 2.5a8.4 8.4 0 0 0-2.8 1.6l-2.2-.9L4 9l1.9 1.4a8.6 8.6 0 0 0 0 3.2L4 15l1.9 3.3 2.2-.9a8.4 8.4 0 0 0 2.8 1.6l.3 2.5H15l.3-2.5a8.4 8.4 0 0 0 2.8-1.6l2.2.9L22.2 15Zm-2.6 2.1-1.5.6.2 1.6-1 .4-1-1.3-1.6.3-1.6-.3-1 1.3-1-.4.2-1.6-1.5-.6-1.1-1.1.9-1.3-.6-1.5.6-1.5-.9-1.3 1.1-1.1 1.5-.6-.2-1.6 1-.4 1 1.3 1.6-.3 1.6.3 1-1.3 1 .4-.2 1.6 1.5.6 1.1 1.1-.9 1.3.6 1.5-.6 1.5.9 1.3Z" opacity="0.55" />
          </svg>
        </button>
      </div>
    </>
  );
}
