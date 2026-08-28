/**
 * The dock: the game's controls, at the bottom, as icons.
 *
 * They were two text buttons wedged into the corner of the status bar, which
 * conflated two different things — the date and your money are things you *read*
 * and belong at the top with the rest of the readout; the yard, the fleet and the
 * parish are things you *press*. Putting them together meant the bar grew a
 * button every time the game gained a screen, and the top of the frame is the
 * worst place to put anything you press repeatedly: it is the furthest point from
 * where the hand rests.
 *
 * So: a floating bar along the bottom, icons with labels under them, the
 * screen you are on lit. Four items at most, which is well inside the
 * eight-control budget — and the budget is why this is a dock and not a menu.
 * A dock has a fixed size you can see; a menu hides how many things are in it.
 *
 * The parish appears when the parish would notice you (planning.ts), so the dock
 * grows once, and everything else about it is fixed for the whole game.
 */

import { type JSX } from 'react';
import { Icon } from './Icons.tsx';

export interface DockItem {
  key: string;
  label: string;
  icon: string;
  on: boolean;
  onClick: () => void;
  /**
   * Why this cannot be pressed yet, if it cannot.
   *
   * For a rung of the ladder that exists but is not open. The alternative —
   * hiding it until it works — was the original design and it produced exactly
   * the question it was meant to avoid: "why does my friend have a Parish tab and
   * I don't?" A control that appears from nowhere is a control the player has to
   * be *told* about by somebody else.
   *
   * So it is shown, dimmed, and it says what opens it. That is not the same as a
   * progress bar on day one — see the Parish item in App.tsx for where the line is
   * drawn.
   */
  locked?: string;
}

export function Dock({
  items, fresh = false,
}: { items: DockItem[]; fresh?: boolean }): JSX.Element {
  return (
    /*
     * `fresh` for the opening's arrival, and only for it.
     *
     * The dock slides up out of the bottom of the frame once, at the end of the
     * intro, and then never again — so the class is passed in rather than kept
     * here: the dock has no idea a game has just started and should not have to.
     */
    <div className={`dock${fresh ? ' dock-in' : ''}`}>
      {items.map((it) => (
        <button
          key={it.key}
          className={`dock-btn ${it.on ? 'on' : ''}${it.locked ? ' locked' : ''}`}
          onClick={it.onClick}
          disabled={it.locked !== undefined}
          /* The requirement in the tooltip as well as the label, because the dock
             label has room for one word and this needs a sentence. */
          title={it.locked}
        >
          <Icon id={it.icon} size={22} />
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}
