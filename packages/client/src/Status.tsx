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
 * And the hour leads it, with the date underneath. "We focus so much on the time
 * of year but wouldn't it be better to focus on the time of day" — yes, and the
 * reason is that the two are read at completely different rates. The date changes
 * every four minutes and matters a handful of times a year: it is the harvest, it
 * is the winter fuel bill. The hour changes continuously and matters *now* — it is
 * whether the lights are about to come on, whether the yard is open, whether the
 * lorry you are watching is going to be caught out in the dark. A readout should
 * lead with the figure you look at it *for*, and a week number is not it.
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
    <svg className="ring" width="34" height="34" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r={r} className="ring-track" />
      <circle
        cx="16"
        cy="16"
        r={r}
        className="ring-lit"
        strokeDasharray={`${c * lit} ${c}`}
        transform="rotate(-90 16 16)"
      />
      {/*
        * Sun or moon at the middle, whichever it is.
        *
        * There used to be a moon at night and nothing at all by day, which left
        * the ring reading as an empty gauge for two thirds of it — and an empty
        * circle with a dot going round the outside is not obviously a day. One
        * or the other, always, so the ring says what it is at a glance.
        */}
      {night > 0.45
        ? <circle cx="16" cy="16" r="4.6" className="ring-moon" />
        : <circle cx="16" cy="16" r="4.6" className="ring-sun" />}
      {/* And the marker outside the track rather than on it: a dot sitting on
          the arc reads as part of the arc, which is what made the old one look
          like a chip out of it. */}
      <g transform={`rotate(${angle} 16 16)`}>
        <circle cx={16 + r} cy="16" r="2.6" className="ring-now" />
      </g>
    </svg>
  );
}

/**
 * The hour of the day, from the fraction the renderer already runs the sun on.
 *
 * Zero is six in the morning — see `HOUR` in `evening.ts`, which is where that
 * offset is set and why: the day starts at dawn rather than at midnight so the
 * lit arc on the ring is one unbroken piece.
 */
function clockTime(fraction: number): string {
  const mins = Math.floor((((fraction % 1) + 1) % 1) * 1440 + 6 * 60) % 1440;
  const h = Math.floor(mins / 60);
  return `${h}:${String(mins % 60).padStart(2, '0')}`;
}

export function Status({
  cash, date, dayFraction, night, speed, onSpeed, onMenu,
}: {
  cash: number;
  date: string;
  dayFraction: number;
  night: number;
  speed: number;
  onSpeed: (speed: number) => void;
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

      {/*
        * The clock and the cog are two elements now, not one.
        *
        * They had been sharing a pill, and the pill was doing two unrelated jobs:
        * telling you the time, which is a readout you never touch, and opening
        * the settings, which is a button and nothing else. A readout with a
        * button welded to its right-hand end reads as neither — you cannot tell
        * by looking which parts of it do something. Separating them costs four
        * pixels of gap and makes both obvious.
        */}
      <div className="dials">
      <div className="clock">
        {/*
          * The ring leads, then the figures, then the speed.
          *
          * It read badly the other way round — "the top right section of the
          * time and the day is just really not good" — and the reason is that
          * the ring was last in a right-aligned stack, so the pill was a block
          * of text with a circle stuck on the end of it and nothing lined up
          * with anything. Reading order for a clock is the face first. The date
          * underneath is deliberately a caption rather than a second line of
          * equal weight: it changes every four minutes and matters a handful of
          * times a year, where the hour matters now.
          */}
        <DayRing fraction={dayFraction} night={night} />
        <div className="clock-text">
          <span className="clock-time">{clockTime(dayFraction)}</span>
          <span className="clock-date">{date}</span>
        </div>
        <span className="clock-rule" />
        {/*
          * How fast the day runs, next to the day.
          *
          * Here rather than in the pause menu because it is a thing you change
          * *while watching* — you speed up to get to the harvest and slow down
          * when the harvest arrives — and a setting you reach for that often is
          * not a setting, it is a control. Three steps and no pause button: Escape
          * already pauses, and a fourth option that duplicated it would be the
          * eight-control budget spent on a synonym.
          *
          * Clicking cycles rather than offering three buttons, because at this
          * size three buttons is nine millimetres of target split three ways.
          */}
        <button
          className="speed"
          onClick={() => onSpeed(speed >= 4 ? 1 : speed * 2)}
          title="Speed: click to change"
          data-quiet
        >{speed}&times;</button>
      </div>
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
