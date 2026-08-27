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
