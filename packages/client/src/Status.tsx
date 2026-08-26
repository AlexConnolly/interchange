/**
 * The readout: money on the left, the two controls on the right.
 *
 * There was a clock here — a day ring, the hour, the date — and it went through
 * three designs without ever being right: "I really need us to fix that horrible
 * daytime clock thing. It's awful. I think for now let's remove it."
 *
 * Removed rather than redesigned a fourth time, and that is the honest call. The
 * information it carried is not missing while it is gone: the *sky* says what
 * time of day it is, and says it better than a dial can — the light goes long and
 * orange, the headlamps come on, the windows light up. A gauge duplicating what
 * the picture already shows is a gauge with no job, which is probably why no
 * arrangement of it ever looked right. The date is the one thing genuinely lost,
 * and it is read a handful of times a year; it comes back when there is a place
 * for it that earns its corner.
 *
 * What stays is the pair of things you press. Speed is a control, not a readout —
 * you speed up to reach the harvest and slow down when it arrives — and the cog
 * is the way into everything else.
 */

import { type JSX } from 'react';
import { money } from './Markers.tsx';

export function Status({
  cash, speed, onSpeed, onMenu,
}: {
  cash: number;
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

      <div className="dials">
        {/*
          * How fast the day runs.
          *
          * On the HUD rather than in the pause menu because it is a thing you
          * change *while watching*, and a setting you reach for that often is not
          * a setting, it is a control. Three steps and no pause button: Escape
          * already pauses, and a fourth option duplicating it would be part of the
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
        {/*
          * And the menu the sound lives in.
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
