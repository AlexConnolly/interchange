/**
 * The main menu, which is the district seen from the air before you land.
 *
 * The first version of this was four grey cards centred on a gradient, and it was
 * wrong in a way worth naming: it was a *settings screen wearing a menu's
 * clothes*. It had no relationship to the game behind it, it invented a second
 * visual language for one screen, and — worst — it hid the single best thing this
 * project has, which is a low-poly English parish under broken cloud.
 *
 * So the menu does not cover the game. The world is built the moment the page
 * loads, held at altitude with the last of the overcast over it, drifting slowly;
 * the menu sits on it like a title card on an establishing shot. Pressing New game
 * releases the descent that was already paused — which is why it is instant, and
 * why the loading is spent on the screen nobody minds waiting on.
 *
 * ## The design, and the reasons
 *
 * **The name in the middle, the choices along the bottom.** It was a column down
 * the left third, on the argument that "a centred column over a landscape fights
 * the landscape for the middle of the frame". True of a *column*; not true of a
 * name. A title belongs in the middle of a title card, and pushing it into a
 * corner to make room for a list was solving the list's problem at the title's
 * expense.
 *
 * So the two are separated. The name sits centred with nothing beside it, and the
 * choices go along the bottom — which is also where the dock lives once you are
 * playing, so the first row of controls a player ever sees is in the place every
 * later row will be.
 *
 * **They are buttons now, not a list.** A vertical list of four with hairlines
 * between them reads as a menu; four across the bottom have to read as things to
 * press, so they are pills with an edge, sized like the dock's. Same shape, same
 * glass, same gold for the one under the pointer.
 *
 * **No strapline.** There was a "Haulage in an English parish · 1985" under the
 * rule, doing the job a book cover does — telling you what the thing is before you
 * open it. It is not needed here and it never was: the district is *behind the
 * words*, in summer, with lorries on it, and "Marchford, and one van" under New
 * game says the rest. A line of explanatory type over a picture that explains
 * itself is a line that only adds to the count.
 *
 * **No panel behind the words — a scrim.** Text over a bright field needs
 * contrast, and a card is the lazy way to get it. A soft pool of shade behind the
 * name and a lift from the bottom edge darken the ground under the type without
 * drawing an edge round it, so the picture runs under the words rather than
 * stopping at them.
 */

import { useState, type JSX } from 'react';
import {
  listSaves, deleteSave, ago, type SaveSlot,
} from './saves.ts';

/** The layers of the menu. `null` means the game is running. */
export type MenuPage = 'main' | 'load' | 'settings' | null;

function Item({
  label, sub, onClick, disabled,
}: {
  label: string; sub?: string; onClick: () => void; disabled?: boolean;
}): JSX.Element {
  return (
    <button className="mi" onClick={onClick} disabled={disabled}>
      <span className="mi-text">
        <span className="mi-label">{label}</span>
        {sub !== undefined && <span className="mi-sub">{sub}</span>}
      </span>
      {/*
        * The gold mark is a bar under the label rather than a tick beside it.
        *
        * Beside it was right in a vertical list, where the margin to the left of a
        * row is empty space nobody is using. In a row of pills that margin is the
        * gap between two buttons, so a mark there belongs to both of them. Under
        * the label it belongs to one, and it is the same gold the dock lights up
        * with — which the eye already reads as "this one".
        */}
      <span className="mi-mark" aria-hidden="true" />
    </button>
  );
}

/**
 * The slots, with a delete on each.
 *
 * One component, used by the menu's Load and the pause menu's Save alike —
 * they are the same list of the same things, differing only in what pressing one
 * does. Writing it twice would have been two places to get the naming wrong.
 */
export function SaveList({
  slots, onPick, onDelete, newRow,
}: {
  slots: SaveSlot[];
  onPick: (slot: SaveSlot) => void;
  onDelete: (slot: SaveSlot) => void;
  newRow?: () => void;
}): JSX.Element {
  return (
    <div className="slots">
      {newRow && (
        <button className="slot fresh" onClick={newRow}>
          <span className="slot-name">+ New save</span>
        </button>
      )}
      {slots.length === 0 && !newRow && (
        <div className="nowt">
          <span className="nowt-head">No saved games</span>
          <span className="nowt-sub">
            Start a new one, and save it from the cog when you have somewhere worth
            coming back to.
          </span>
        </div>
      )}
      {slots.map((s) => (
        <div className={`slot-row${s.auto ? ' auto' : ''}`} key={s.id}>
          <button className="slot" onClick={() => onPick(s)}>
            <span className="slot-name">
              {s.name}
              {/* The autosave says so on its face. A player must never mistake it
                  for one of their own and be surprised when it moves. */}
              {s.auto && <em>autosave</em>}
            </span>
            <span className="slot-where">{s.where}</span>
            <span className="slot-when">{ago(s.when)}</span>
          </button>
          <button
            className="slot-bin"
            onClick={() => onDelete(s)}
            aria-label={`Delete ${s.name}`}
            title="Delete this save"
          >&times;</button>
        </div>
      ))}
    </div>
  );
}

export function Menu({
  page, onPage, onNew, onLoad, settings,
}: {
  page: 'main' | 'load' | 'settings';
  onPage: (p: 'main' | 'load' | 'settings') => void;
  onNew: () => void;
  onLoad: (slot: SaveSlot) => void;
  /** The existing options panel, so there is one of it rather than two. */
  settings: JSX.Element;
}): JSX.Element {
  const [slots, setSlots] = useState<SaveSlot[]>(() => listSaves());
  const [said, setSaid] = useState('');

  return (
    /*
     * `menu` is a layout, not a surface. It has no background of its own: the
     * district is the background, and the only thing this draws is the scrim that
     * makes the type readable over it.
     */
    <div className="menu">
      {/*
        * The name, centred, with nothing else in its half of the frame.
        *
        * The rule under it used to tie the title to a strapline; with the strapline
        * gone it is doing a smaller and still real job — it gives the word a base
        * to sit on, so it reads as a mark rather than as a piece of text that
        * happens to be large.
        */}
      <div className="menu-head">
        <h1>Interchange</h1>
        <span className="menu-rule" />
      </div>

      {page === 'main' ? (
        <nav className="menu-row">
          <Item label="New game" sub="Marchford, and one van" onClick={onNew} />
          <Item
            label="Load game"
            sub={slots.length === 0 ? 'Nothing saved yet'
              : slots.length === 1 ? '1 saved game' : `${slots.length} saved games`}
            onClick={() => { setSlots(listSaves()); onPage('load'); }}
            disabled={slots.length === 0}
          />
          <Item label="Settings" sub="Sound and detail" onClick={() => onPage('settings')} />
          {/*
            * Exit, which cannot work, and says so when pressed.
            *
            * `window.close()` is refused for any tab a script did not open — a
            * platform rule, not an oversight. Greying it out would leave a player
            * wondering what they had to do first; telling them the truth costs a
            * line and respects them.
            */}
          <Item
            label="Exit"
            sub={said || 'Close the game'}
            onClick={() => setSaid('A tab cannot close itself — use its ×.')}
          />
        </nav>
      ) : (
        /*
         * A page of paper over the same view, and centred now rather than sitting
         * in a left-hand column. The district carries on behind it, which is what
         * stops the menu reading as a different application from the game.
         */
        <div className="menu-panel">
          <div className="menu-bar">
            <button className="menu-back" onClick={() => onPage('main')}>
              &lsaquo; Back
            </button>
            <span className="grow">{page === 'load' ? 'Load game' : 'Settings'}</span>
          </div>
          {page === 'load' ? (
            <SaveList
              slots={slots}
              onPick={onLoad}
              onDelete={(s) => { deleteSave(s.id); setSlots(listSaves()); }}
            />
          ) : settings}
        </div>
      )}
    </div>
  );
}
