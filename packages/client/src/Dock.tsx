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
}

export function Dock({ items }: { items: DockItem[] }): JSX.Element {
  return (
    <div className="dock">
      {items.map((it) => (
        <button
          key={it.key}
          className={`dock-btn ${it.on ? 'on' : ''}`}
          onClick={it.onClick}
        >
          <Icon id={it.icon} size={22} />
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}
