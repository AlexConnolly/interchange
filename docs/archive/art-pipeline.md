# Art pipeline

How assets get made. [`art-direction.md`](art-direction.md) is what gets made and is the document
to argue with; this one is mechanism.

Follows from D8 and D12 in [`decisions.md`](decisions.md).

---

## 1. Source

Ported from `C:\Users\AlexConnolly\tribewars\art`. That folder already solves this problem, and
solves it better than the text-to-3D approach originally specced. It should be lifted more or
less intact.

The approach is **code-authored geometry**: models are Python programs run through headless
Blender and exported as glTF. Not primitives stacked and merged — a single mesh *grown*, in the
standard game-art way, with faces selected by where they point and where they sit. The build
scripts read as "take the face on the outside and pull a limb out of it" rather than as a list of
coordinates.

That matters more here than it did there. A model that is a program is diffable, reviewable and
above all **parameterised** — and this game needs the same lorry across eight decades of
bodywork, in a dozen liveries, at three levels of detail. Authoring that by hand is a career.
Authoring it as a function with arguments is an afternoon.

---

## 2. The loop, and why it closes

```
SHAPE SCRIPT  ->  BLENDER      ->  GLB + REPORT   ->  FIVE RENDERS   ->  AGENT LOOKS
python,           headless,        tris vs budget     front side top     at game scale,
one grown mesh    no GUI,          floor check,       three-quarter,     beside a ruler
reviewable text   hard shading     height             and silhouette
      ^                                                                        |
      +--------------  the picture is wrong, so the script changes  -----------+
```

Step four renders the **exported** file, never the Blender scene. Blender is Z-up and glTF is
Y-up, so the axis bug only exists after export — a scene render would show a perfectly good model
right up until it reached the game.

The header of `tribewars/art/shots.py` puts the case better than I can:

> nearly every bad model in this repo was bad in a way that is invisible in Python and obvious in
> a picture. Heights authored into Y instead of Z. A rotation sign inverted so a tent's canvas
> splayed outwards into a trough.

The loop closes because the thing that built the model can see what it made. That is the entire
reason this pipeline works where a validator alone would not.

---

## 3. What transfers unchanged

| From | What it does | Why it matters here |
|---|---|---|
| `lib.py` | Vocabulary layer — chamfered `box`, `wedge`, `cyl`, `plate`, `ring`, plus `part`/`attach`/`merge_into` | Makes build scripts read as shape descriptions, and enforces in one place the two things easy to get wrong and expensive to notice late: hard shading everywhere, and part origins sitting on the joint they rotate about |
| `boxmodel.py` | `Form` — one grown mesh; select faces by normal and position, then extrude, inset, loop-cut, bevel, taper, bend, mirror | The reason silhouettes flow instead of being a stack of collisions |
| `shots.py` | Five-view render of the exported glb at game scale beside a scale reference | The loop above |
| `lineup.py` | The whole library at shipping size in one picture | A prop wrong alone is arguable; wrong beside seventeen others it is obvious |
| `assembly.py` | Props placed at their real world coordinates and shot from the play camera | Its header records four beautifully detailed towers being a net loss because nobody had seen them next to the crude wall they stood on. That is the most useful note in the folder |
| `export.py` / `summarise` | Triangle count vs budget, floor check, height report | Automated budget enforcement |
| `watch.mjs` | Rebuild on save; `.glb` stays the shipped artefact | Save-time conversion, so Blender never runs in production |

Also transferring: **sizes are read from the game's own source tables**, so review renders show
what ships rather than what somebody intended. `lineup.py` has been broken twice by that table
moving, and now looks in both places and fails loudly. Keep that behaviour.

---

## 4. What has to change

### 4.1 Recompute the foreshortening constant — Phase 0, before anything is modelled

`ART_DIRECTION.md` §1b is the most valuable paragraph in that repo, and its correction runs the
*opposite* way for us. See [`art-direction.md`](art-direction.md) §1 for the full working. In
short: their 58-degree camera compresses height to roughly half, so they author too thin and bake
0.78 into the corner tower. Our lower orthographic camera keeps most of height and eats
**footprint along the view axis** instead.

Copy the method, never the constant. Build a reference at a known proportion, render it through
the real pipeline at the real camera, measure the pixels. Once, in Phase 0. Every asset depends
on that number.

### 4.2 Livery as a runtime material slot — structural

Tribe Wars bakes faction colour into the material, correctly, because it has two fixed sides. We
have up to N companies in one world all running the same lorry.

Every model reserves a material slot named `livery` that the renderer tints per company at draw
time. `repaint()` in `lib.py` already does per-face material assignment on a grown mesh, which is
exactly the mechanism needed — it just needs a reserved slot name and a convention for which
faces belong to it.

### 4.3 The far LOD is authored, not decimated

Tribe Wars designs for a 40-pixel unit. Zoomed out over a region, ours are 12 to 20 pixels.
Decimation is a smear at that size. The far LOD is a **second, simpler function in the same build
script** whose only job is to say "lorry" at 14 pixels. A design task, not an optimisation task.

### 4.4 Industries are kits, not models

A mine is not one asset. It is a headframe, spoil heaps, conveyors and sheds placed by rule so
that no two mines look identical and all of them look related. Same box-modelling library driving
a placement function rather than a single build.

This also carries the three visual states from art-direction §6 — thriving, struggling, dead are
usually the same kit with a different material set and one or two swapped parts, which is a
parameter rather than a new asset.

---

## 5. Layout

```
art/
  ART_DIRECTION.md      -> superseded by docs/art-direction.md; keep a pointer
  lib.py                 vocabulary + export + budget report
  boxmodel.py            Form: one grown mesh
  build_vehicles.py      parameterised by era and class
  build_industry.py      kits and placement rules
  build_props.py         street furniture, vegetation, scatter
  build_terrain_kit.py   cuttings, embankments, tunnel mouths, bridge parts
  shots.py               five-view review render
  lineup.py              whole-library comparative render
  era_lineup.py          NEW: one cargo class across all eight eras
  assembly.py            junction and station scenes at the play camera
  watch.mjs              rebuild on save
  src/                   hand-authored .blend files, if any
```

`era_lineup.py` is the one genuinely new script. Per art-direction §9, if the eight-era
progression doesn't read as a progression in a single picture, the roster is wrong — and that
needs to be checkable automatically rather than by assembling screenshots.

---

## 6. Budgets and enforcement

Budgets live in [`art-direction.md`](art-direction.md) §15. Enforcement is `summarise()` with a
per-class budget, extended with the checklist from art-direction §16.

An asset that fails is **regenerated, not hand-fixed**. The moment hand-fixing starts,
consistency drifts and the pipeline dies — which is the whole reason to have a pipeline.

---

## 7. Open

- Whether hand-authored `.blend` files are permitted at all, or whether everything must be code.
  `watch.mjs` supports both. My view: allow them for one-off hero assets, forbid them for
  anything parameterised across eras, and never for anything ownable.
- Whether vegetation is code-authored or generated by a separate scatter system.
- Sound is out of scope for this document but `tribewars/art/build_sound.py` suggests there is
  prior art worth looking at when we get there.
