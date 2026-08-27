# Goals

Live list. Each item states what is wrong or wanted, and what "done" means, so
neither of us has to remember. Struck through when finished, with the commit.

---

## ~~1. Bare trees look horrific~~ — done

**What.** Winter trees — the ones drawn without leaves — read as a mess of pink
sticks rather than as bare trees. They are the most numerous single object in the
district, so they set the tone of the whole picture for a quarter of the year.

**Done when.** Remodelled through the Blender pipeline in `art/` — never
hand-written geometry — and a winter screenshot at two zoom levels looks like
countryside.

---

## ~~2. Tractors drive through water~~ — done

**What.** The ambient farm machinery ignores water and drives across becks and
ponds. Reported twice now.

**Done when.** No tractor path crosses a tile below sea level, proven by a
headless probe that samples every tractor position over a long run rather than by
looking at a screenshot.

---

## ~~3. Zoom should move toward the pointer~~ — done

**What.** The wheel zooms about the centre of the screen, so zooming in on
something means zoom, drag, zoom, drag. Every map in the world zooms toward the
cursor.

**Done when.** The world point under the pointer stays under the pointer as the
wheel turns — near enough that it feels anchored rather than exactly, since the
camera is orthographic and pinned to a fixed elevation.

---

## ~~4. A placed business does not draw~~ — done

**What.** Building one reports success, takes the money and puts a marker with
the right icon on the map — and no building appears. A bug in the feature just
shipped: the simulation has the site, the renderer never got the model.

**Done when.** A business built on your own land is drawn, at its footprint,
immediately, and is still there after a reload of the scene.

---

## ~~5. Power lines~~ — done

**What.** Old-school single-pole timber power lines, the American kind: one wooden
pole, a crossarm, wires strung between. Running **across** the district and
connecting to the **edges** of the map, because the grid comes from somewhere
else and goes somewhere else — the district is a place the wires pass through.

**Rules.** Same as everything else in this world: generated from the world seed,
so the same seed gives the same lines every time. They are scenery, not a
network the player operates.

**Done when.** Lines cross the district edge to edge, poles are modelled through
the Blender pipeline, the layout is identical for a given seed and different for a
different one, and they route around water and towns rather than through them.

---

## ~~6. Contracts: two tabs, and a real breakdown behind each row~~ — done

**What.** The contracts screen is one flat list and answers almost nothing. It
should be two tabs.

**Available.** What is on offer, with anything you are *already assigned to*
filtered out — a list that keeps offering you work you have taken is a list you
stop reading. Each row says what it pays. Clicking one slides through to the
detail, where you pick a lorry and press **Assign to contract**.

**Active.** What you are running, and the numbers that actually matter: what it
pays, what it has paid you so far, and what that comes to per day. Clicking one
slides through to a full breakdown, where you can also **cancel** it.

**Done when.** Both tabs work, the sliding page-and-back is the same one the
place panel uses — not a second idiom — and the per-day figure is derived from
the run rather than guessed.

---

## ~~7. The opening~~ — done

**What.** The district takes a moment to be ready — a dozen GLB files to fetch and
bake, a heightmap to mesh, influence to resolve — and that moment was spent looking
at an empty field while things popped into it.

**Done when.** Ten seconds of coming down through cloud: three of solid overcast
with "Loading game...", four of descending from far outside the playing zoom as the
cloud clears, three of the interface sliding in from the edges it lives on. No
input until it ends. `?intro=0` skips it, which is what makes the game
photographable.

---

## ~~8. An advisor, as an inbox~~ — done

**What.** A tutorial that arrives as post rather than as a modal. A button beside
the money with a dot on it when something is unread; a toast out of the button
when a letter lands, showing who wrote and one trimmed line; a page of letters
behind it. The game can send one at any time.

**The point.** Nothing in this game is urgent, so a modal that stops the world to
explain the market is interrupting somebody who was enjoying themselves to tell
them a thing they would have found out anyway — but not explaining the planning
board means most people never find rung seven. A letter waits. It is still there
in ten minutes when you have run out of things to do.

**Who it is from.** Somebody, not the game. The first is from Tom Ashbury, who
left you the yard. A tip signed by a name is a tip you can be pleased to get; the
same words in a grey box are homework.

**Done when.** Letters fire once, on a predicate over the world, so they arrive
*because of what you did*. Verified end to end and unit-tested.

---

## ~~9. Saving, and a main menu~~ — done

**What.** A main menu — New game, Load game, Settings, Exit — and saving from the
cog. Saves list out of localStorage, auto-named from where you were in the game.
Autosave every game-month into its own slot. The intro plays on load as well as on
new.

**The format is a state dump, not a replay.** There was already a save system and
it did not work: it saves a *command log* and reloads by replaying it, which
depends on every player action going through the command queue, and none of them
do — `buyLand`, `placeSite`, `layTrackAt`, `acceptContract`, `cancelContract`,
`sellOnMarket`, `buyPlace` and `foundYard` have zero pushes between them. A replay
would rebuild the district as generated with the player having done nothing.

**Generic, walked rather than named.** A hand-written serialiser is a list of what
somebody remembered, and the failure is silent: a field added to a table next month
loads a world subtly unlike the one saved. So it walks the tables, and `stateHash`
plus a round-trip test is what makes that trustworthy.

---

## Standing rules, for anything on this list

- **Nothing whose visibility matters may be animated through opacity.** Third time
  this bit: the build tray sat invisible for half a second after opening, and the
  contract page rendered its header with a completely blank body under it while the
  DOM was correct. A CSS animation advances on *frames*, and the frame clock here
  belongs to a WebGL scene that can drop to a few a second. Entrances have no fill
  mode, exits keep `both`, and entrances slide rather than fade.

- **Models come from the pipeline.** `art/` and Blender, never hand-written
  geometry.
- **Audio comes from real clips.** Never synthesised on the fly.
- **Measure, do not reason.** A screenshot has misled this project repeatedly:
  software GL at three frames a second cannot accumulate a particle plume, and a
  mid-animation frame looks like a bug. Probe it.
- **Balance anchor.** A second van at about 8 real minutes on seed 1985, checked
  with `packages/tools/src/probe.ts` after anything that touches the economy.
