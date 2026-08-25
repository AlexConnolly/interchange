# Art direction

What the game looks like, what it deliberately does not look like, and the tests an asset has to
pass. [`art-pipeline.md`](art-pipeline.md) is how it gets made; this is what gets made.

This document is written to be argued with. If we disagree, disagree here, before anything is
modelled.

---

## 1. The camera decides everything

An orthographic camera at a fixed elevation, rotatable in 90-degree steps. Everything below
follows from that one fact, so it gets pinned first.

**Proposed: 35 degrees elevation, orthographic, four rotation steps, zoom range 1x to 12x.**

For an orthographic camera at elevation `θ` above the horizon:

- a world-vertical length arrives on screen at `cos(θ)` of itself
- a ground length across the view arrives at very nearly `1.0`
- a ground length along the view axis arrives at `sin(θ)`

At 35 degrees that is **0.82 vertical, 1.00 across, 0.57 along**. Which gives the rule:

> Height survives. **Footprint does not.** Anything whose identity lives in its plan-view
> footprint along the view axis loses nearly half of it, and anything tall keeps almost all of
> its height and will dominate the frame more than you expect when you author it.

This is the opposite correction to the one in `tribewars/art/ART_DIRECTION.md`, which is
authored for a 58-degree camera where height arrives at roughly half and therefore has to be
authored deliberately too thin. We are lower, so our failure mode is reversed: **chimneys,
cranes, headframes, masts and gantries will read taller and more dominant than authored**, and
long low things — a rake of wagons, a barge, a low shed — will read shorter along one axis than
authored.

Two notes on porting that document:

- Its trig is mislabelled: it says `sin(58) = 0.85` where the relevant figure is `cos(58) = 0.53`,
  which is why the prose immediately says "roughly half" and the code bakes in 0.78. The
  *conclusion* is right and was arrived at by measurement.
- So copy the **method**, never the constant. Build a reference at a known proportion, render it
  through the real pipeline at the real camera, and measure the pixels. This happens once, in
  Phase 0, before anything else is modelled. Every asset in the game depends on that number.

**Open:** the elevation angle itself. 30 degrees is the classic 2:1 game-iso and flattens the
world usefully for reading long alignments; 40 degrees gives more ground and less dominance from
tall structures. 35 is a compromise and should be tested in Phase 0 with real geometry rather
than argued about now.

---

## 2. The thesis

**An operating diagram that happens to be a place.**

The game is about the legibility of systems. So the world should feel like a beautifully drafted
technical object that has weather and time of day and things moving through it — precise, matte,
unfussy, with nothing on screen that isn't telling you something.

Warmth comes from **light and life** — low sun, steam, headlights, smoke drifting, the fact that
several thousand things are moving — and never from texture noise or decorative clutter.

Colour is **earned**. The land is restrained and desaturated. Saturation is spent on the things
that carry meaning: vehicles, liveries, signals, industry accents, cargo. If you desaturate a
screenshot and it still reads, we've done it right; if it turns to mush, the land is fighting the
machines.

### The five reference points

Naming references makes agreement possible.

| Reference | What we take | What we leave |
|---|---|---|
| Transport Tycoon Deluxe | Absolute clarity at density; you always know what everything is | Its sprite constraints, and its silliness unless O3 goes that way |
| Mini Metro | Information design as art direction; state legible at a glance | Its total abstraction — we are a place, not a diagram |
| Ordnance Survey / engineering drawing | Precision, restraint, the sense of a considered document | Flatness; we have real light |
| Dorfromantik / Islanders | Low-poly restraint; how much charm flat-shaded geometry can carry | Their softness and their lack of machinery |
| Workers & Resources | Industrial seriousness, the dignity of infrastructure | The mud, the grey, the visual joylessness |

---

## 3. What this is not

Explicit exclusions, each with the reason. These are as important as the positive statement,
because "low-poly 3D" alone describes a dozen incompatible looks.

- **Not pixel art or sprites.** Settled in D8. Curved alignments and dynamic junction geometry
  make sprite sheets combinatorially impossible.
- **Not photoreal, and no PBR showcase.** No metalness-roughness realism, no normal-mapped grime,
  no rust as texture. At 1x zoom it is invisible and at 12x it is a different game.
- **Not voxel.** Blocky-by-grid reads as a building toy and cannot express a curved slip road,
  which is the one thing we most need to express.
- **Not cel-shaded with ink outlines.** This is the closest call, because `tribewars` uses a toon
  ramp successfully. But theirs is thirty units in a forest. Twenty thousand vehicles each
  carrying a black outline is not style, it is noise, and it destroys exactly the density read we
  need. **Form is described by facet shading, not by lines.**
- **Not flat-vector infographic.** No form to catch light, no warmth, and the world stops being a
  place. We rejected this in the original stack decision and should stay rejected.
- **Not cozy-pastel.** Soft rounded shapes, muted candy palette, ambient occlusion everywhere.
  It's a lovely genre and it cannot carry industrial scale or read at density.
- **Not gritty realism.** Smog, rust and brown. Era 1 and era 8 both have to be legible, and
  grime is the enemy of legibility.
- **No floating icons over the world by default.** Icons are an overlay mode you turn on, not
  the resting state. The resting state is a place.

---

## 4. Form language

- **Flat shading on chamfered forms.** Facets break against the light and hold an outline against
  a busy background. Smooth normals turn to mush at small sizes and cost more to get there.
- **Chamfers, not bevels-for-realism.** A two-degree rounding is invisible and costs the same. A
  visible cut plane is most of what separates a modelled shape from a stretched cube.
- **One grown mesh, not stacked primitives.** A pile of intersecting solids has no continuous
  surface, so every junction between parts is a hard collision. See
  [`art-pipeline.md`](art-pipeline.md).
- **Detail is geometry or it does not exist.** There is no texture budget for painted detail. If
  a thing needs to read, it reads as shape.
- **Straight for order, irregular for age.** Newly built infrastructure is crisp and bilaterally
  symmetric. Old, neglected or dying infrastructure sags, leans and loses symmetry. This is a
  *mechanic* rendered as form — see section 6.

---

## 5. Colour

### 5.1 Per object: three values and one accent

At the sizes we work at, more than three tonal steps is noise. Every object gets a dark base, a
mid, and exactly one bright accent. The accent is the thing you are meant to look at, and it is
the **only emissive surface**, so objects stay readable in fog, at dusk, and under snow where the
shading flattens.

For us the accent is usually **state**: a loaded lamp, a signal aspect, a lit cab, a livery flash.

### 5.2 The world palette

- **Land is desaturated and tonal**, driven by biome, elevation and season. It is a ground, not a
  subject.
- **Water is the one large saturated field** and it anchors the composition. Get it right early.
- **Industry carries a muted material identity** — oxide, timber, concrete, verdigris — so you can
  tell a smelter from a sawmill by colour family before you can see its shape.
- **Vehicles are the most saturated things on screen** and they are the things that move. That
  combination is what makes a busy network beautiful rather than busy.

### 5.3 Semantic colour is reserved

Congestion, warning and failure use a fixed semantic set that appears nowhere else. No industry,
livery or terrain may use those exact hues. This is why the livery palette is a constraint (O5)
rather than a free choice.

---

## 6. State must be visible in the world

This is the most game-specific requirement here and it has real modelling consequences.

**If something is wrong, the world shows it. Not only the UI.**

| System | Thriving | Struggling | Dead |
|---|---|---|---|
| Industry | Smoke, lit windows, full yard, movement | Cold stack, half-empty yard, one lamp | Weeds, sagged roof, no light |
| Station / depot | Cargo stacked, vehicles cycling | Cargo piling and not moving | Empty and dark |
| Junction | Steady flow | Queue forming, brake lights | Solid, stationary |
| Town | Growing footprint, lit, traffic | Static | Shrinking, boarded |

So **every industry needs three visual states**, not one model. That is a real cost and it should
be budgeted for from the first industry rather than retrofitted to forty of them. In practice it
is usually the same mesh with a different material set plus one or two swapped parts, which the
code-authored pipeline handles well — it is a parameter, not a new asset.

---

## 7. Silhouette and readability

The outline is the design. Colour confirms what the shape already said.

### The three tests

Every asset passes all three or it goes back.

1. **The 14-pixel test.** Render at the size it occupies at maximum zoom-out. Can you still tell
   what class of thing it is? Not which model — which *class*: lorry, train, ship, plane.
2. **The removed-colour test.** Flat black on white. Can you name it, and can you tell it from
   its neighbours? If two things need their palette to be told apart, the shapes have failed.
3. **The neighbour test.** Never judge an asset alone on a checker floor. Judge it in the
   arrangement it ships in, next to the things it ships beside. The most useful note in the
   `tribewars` repo records four beautifully detailed towers being a net loss because nobody had
   seen them next to the crude wall they stood on.

### Consequence: the far LOD is authored, not decimated

At 12 to 20 pixels a decimated mesh is a smear. The far LOD is a **separate, deliberately
designed silhouette** — a second, simpler function in the same build script — whose only job is
to say "lorry" at 14 pixels. This is a design task, not an optimisation task.

---

## 8. The scale ladder

Scale is the first thing you should be able to say. The steps must be obvious at a glance and
hold in silhouette.

```
handcart  <  dray  <  lorry  <  artic  <  wagon rake  <  train  <  barge  <  coaster  <  ship
```

If a container ship reads as "a big boat" rather than "not a boat", the ladder has a rung too
few. The scale reference used in every review render is **a person and a standard four-wheeled
wagon together**, because our range spans a handcart to a Panamax and one ruler cannot cover it.

---

## 9. Era progression: 1860 and 2100 must be the same game

Eight eras is the biggest art risk in the project. The rule:

> **Construction language changes across eras. The form language does not.**

- Era 1–2: timber, iron, rivets, exposed mechanism, tall and narrow, asymmetric wear
- Era 3–5: pressed steel, welded, enclosed, horizontal emphasis, standardised
- Era 6–8: composite, sealed, aerodynamic, seamless, quiet, symmetrical

All of them are flat-shaded chamfered forms on the same palette discipline with the same three
values and one accent. A player should be able to put an 1890 steam lorry beside a 2070
autonomous convoy and see two things from the same world, three centuries apart.

**Review artefact:** a per-cargo-class lineup render across all eight eras, generated
automatically. If the progression doesn't read as a progression in one picture, the roster is
wrong.

---

## 10. Company livery

Up to N companies share a world (O5, open). This is the one place we structurally depart from
the `tribewars` approach, which bakes faction colour into the material because it has two fixed
sides.

**Every model reserves a material slot named `livery` that the renderer tints per company at
runtime.** Which gives the rule:

> **Construction says what it is. Livery says whose it is. You must be able to tell both apart
> with the colour removed.**

That second clause is the hard one and it is why O5 matters. Colour alone cannot carry company
identity, because of colourblind players, because of fog and dusk, and because at 14 pixels a
tinted region is a few pixels. So livery is a **pattern plus a colour**: a band, a flash, a
roof-panel, a stripe — a small set of shape-level marks that survive desaturation.

Four companies is comfortable. Eight is a genuine constraint on the whole scheme and would
require the pattern set to do most of the work.

---

## 11. Terrain and the world surface

- Low-poly heightmesh, flat-shaded, with the same chamfer discipline at cliffs and cuttings.
- **Cut and fill are visible.** An embankment, a cutting, a tunnel mouth and a viaduct are the
  most characterful things in a transport game and they should be modelled with care and read
  clearly from above.
- Vegetation is **massing, not individual plants** — silhouette clusters that read as woodland at
  1x, resolving to distinct forms only in the top zoom steps.
- The grid is never drawn in the resting state. It appears while placing.

---

## 12. Motion

A transport game is mostly motion, so motion is art direction, not polish.

- **Vehicle motion is the primary animation.** Everything else is secondary and cheap.
- Movement is weighted and slightly damped — things have mass. Nothing snaps.
- **Legible cause:** a vehicle slowing must visibly slow before it stops, so a queue is readable
  as a queue rather than as a line of stationary objects.
- Ambient life is limited to what carries information: smoke rate says how hard an industry is
  working; steam and exhaust say a vehicle is loaded; lights say time and occupancy.
- No idle flourish for its own sake. At twenty thousand agents, per-object decoration is a
  performance budget and a noise budget spent at once.

---

## 13. Light, time and weather

- Day/night on the game calendar, with **a hard floor on legibility**: night is a mood, never a
  readability tax. Lit windows, headlights and emissive accents carry the night.
- Seasons change the land palette and drive tourism seasonality and snow. Snow is the dangerous
  one — it flattens tonal separation, so the accent-emissive rule is what keeps the world
  readable and must be tested under snow specifically.
- Weather is atmospheric only. It never obscures information the player needs to act on.

---

## 14. UI and world

The UI is a **DOM overlay**, deliberately separate. Two consequences for the art direction:

- The world is never dressed with UI. No floating labels, health bars or icons in the resting
  state.
- The overlay's visual language is the drafting language — hairline rules, mono for data, tabular
  figures — so the two layers read as one designed object rather than a game with a website on
  top.

Overlay *modes* — congestion heatmap, amenity field, catchment, power grid, ownership — recolour
the world wholesale rather than adding marks to it. Each mode is a different drawing of the same
place.

---

## 15. Budgets

Provisional, to be confirmed in Phase 0 against the real frame budget.

| Class | Near tris | Far tris | Notes |
|---|---|---|---|
| Vehicle | 300–700 | 40–80 | Far LOD authored separately |
| Prop / street furniture | 100–400 | 20–40 | Instanced heavily |
| Building (town) | 300–900 | 60–120 | Kit-assembled |
| Industry (whole site) | 3k–8k | 400–800 | Kit of parts, rule-placed |
| Terrain chunk | budget per chunk | — | Greedy-meshed |

Materials come from one locked palette atlas. An asset that needs a colour outside the ramp is
either wrong or the ramp is, and that is a conversation, not a local fix.

---

## 16. The checklist

An asset ships when all of these are true.

- [ ] Passes the 14-pixel test
- [ ] Passes the removed-colour test
- [ ] Passes the neighbour test, in the arrangement it ships in
- [ ] Three values and one accent; accent is the only emissive
- [ ] Reserves the `livery` slot if it is ownable
- [ ] Has an authored far LOD, not a decimated one
- [ ] Has thriving / struggling / dead states if it is an industry or a station
- [ ] Sits on the floor at zero and is scaled in metres
- [ ] Within triangle budget
- [ ] Reads under snow and at night
- [ ] Reads beside its own era neighbours and across the era lineup
