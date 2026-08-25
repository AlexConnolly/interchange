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
  cash, date, out, idle, dayFraction, night, weather, muted, onMute,
}: {
  cash: number;
  date: string;
  out: number;
  idle: number;
  dayFraction: number;
  night: number;
  weather: number;
  muted: boolean;
  onMute: () => void;
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
          * A mute button, and it is not optional politeness.
          *
          * A game that makes noise with no way to stop it is one the player
          * closes rather than mutes. `data-quiet` so pressing it does not itself
          * click — which, unmuting, would be the one click you did not ask for.
          */}
        <button
          className={`mute ${muted ? 'off' : ''}`}
          onClick={onMute}
          data-quiet
          aria-label={muted ? 'Sound off' : 'Sound on'}
          title={muted ? 'Sound off' : 'Sound on'}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 9.6h3.4L13 5v14L7.4 14.4H4Z" />
            {muted
              ? <path d="M16.2 9.1l1.3-1.3 4.2 4.2-1.3 1.3Zm5.5 0l-1.3-1.3-4.2 4.2 1.3 1.3Z" />
              : (
                <>
                  <path d="M15.6 8.6a5 5 0 0 1 0 6.8l1.3 1.3a7 7 0 0 0 0-9.4Z" />
                  <path d="M18.3 5.9a8.8 8.8 0 0 1 0 12.2l1.3 1.3a10.8 10.8 0 0 0 0-14.8Z" />
                </>
              )}
          </svg>
        </button>
      </div>
    </>
  );
}
