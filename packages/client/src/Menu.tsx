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
 * **Left, not centred.** A centred column over a landscape fights the landscape
 * for the middle of the frame. Pushed to the left third, the two arrange
 * themselves: words on one side, country on the other, which is how a title
 * sequence is composed and not how a dialog is.
 *
 * **A list with hairlines, not a stack of cards.** A card says "press me, I am a
 * control". Four of them in a column say "fill this in". A rule between rows says
 * "this is a list of things", which is what a menu is, and it leaves the district
 * visible between the words instead of boxing it out.
 *
 * **No panel behind the words — a scrim.** Text over a bright field needs
 * contrast, and a card is the lazy way to get it. A soft gradient bled from the
 * bottom-left darkens the ground behind the type without drawing an edge round it,
 * so the picture runs under the words rather than stopping at them.
 *
 * **The gold marker is the only ornament.** It is the colour the dock lights up
 * with, so the eye already knows it means "this one". A hover that slides the row
 * four pixels and puts a mark in the margin is the whole of the interaction
 * design, and it is enough.
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
      {/* The marker lives in the row's own margin so the label does not move to
          make room for it — a menu whose text jumps on hover is a menu that feels
          loose. */}
      <span className="mi-mark" aria-hidden="true" />
      <span className="mi-text">
        <span className="mi-label">{label}</span>
        {sub !== undefined && <span className="mi-sub">{sub}</span>}
      </span>
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
      <div className="menu-col">
        <div className="menu-head">
          {/*
            * The one place the game's name appears. Deliberately: a wordmark on a
            * heads-up display is a wordmark you stop seeing in ten seconds, and
            * this is the only screen with the room to set it properly.
            *
            * The rule under it is doing real work — it is what makes the title and
            * the subtitle read as one object rather than two lines that happen to
            * be near each other.
            */}
          <h1>Interchange</h1>
          <span className="menu-rule" />
          <p>Haulage in an English parish &middot; 1985</p>
        </div>

        {page === 'main' && (
          <nav className="menu-list">
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
              onClick={() => setSaid('A browser tab cannot close itself — use its ×.')}
            />
          </nav>
        )}

        {page !== 'main' && (
          /*
            * A page of paper over the same view, in the same column. The district
            * carries on behind it, which is what stops the menu feeling like a
            * different application from the game.
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
    </div>
  );
}
