# Art

Direction and pipeline in one document, because they are one problem.

This is the longest document in the set, and deliberately. "Small worlds that
look beautiful" is a primary goal rather than a finish, and a small district can
afford far more care per square metre than a continent.

Two cuts moved their whole budget here. The region went from 1024² to 256², and
the game went from eight eras to **one**. That second one matters more than any
technique in this document: forty-four vehicles across eight decades of bodywork
becomes nine vehicles in one, three building languages become one, and every
asset can be made properly rather than adequately.

---

## 1. The thesis

**An operating diagram that happens to be a place.**

The game is about the legibility of a system, so the world should read like a
beautifully drafted technical object that has weather, low sun and several
hundred things moving through it. Precise, matte, unfussy, nothing on screen
that is not telling you something.

Warmth comes from **light and life** — low sun, steam, smoke drifting, lit
windows at dusk, the fact that things are moving. Never from texture noise or
decorative clutter.

Colour is **earned**. The land is restrained and desaturated; saturation is
spent on what carries meaning — vehicles, liveries, cargo, signs. Desaturate a
screenshot and it should still read. If it turns to mush, the land is fighting
the machines.

### The subject

An English district in the mid-1980s. A market town, three villages, a hamlet.
Hedgerows and field boundaries. A river with a floodplain. An A-road spine and
a network of lanes too narrow for what is now driving down them. A creamery, a
quarry, a sawmill, a freight terminal on the main line.

That is a specific place and specificity is the point. "Generic transport
region" produced buildings that were boxes, because nobody could say what a
building in it looked like. A 1985 English creamery is a thing you can describe:
corrugated cladding, a tanker bay, a flat roof with plant on it, a weighbridge.

### References

| Reference | Take | Leave |
|---|---|---|
| Transport Tycoon Deluxe | Absolute clarity at density | Sprite constraints, silliness |
| Mini Metro | Information design as art direction | Total abstraction — we are a place |
| Ordnance Survey drawing | Precision, restraint, a considered document | Flatness; we have real light |
| Dorfromantik / Islanders | How much charm flat-shaded geometry carries | Softness, absence of machinery |
| Workers & Resources | The dignity of infrastructure | The mud and the joylessness |

---

## 2. The camera

A low orthographic three-quarter view. The elevation is settled once, measured
off a real render through the real pipeline, and everything depends on it: a low
camera keeps most of an object's height and eats its footprint along the view
axis, so models authored against the wrong number are wrong in a way no amount
of later fixing helps.

Orthographic because a transport network is a thing you read, and perspective
makes the far end of a line a different size from the near end.

---

## 3. Form language

- **Flat shading on chamfered forms.** Facets break against the light and hold
  an outline against a busy background. Smooth normals are mush at this size.
- **Chamfers, not bevels-for-realism.** A two-degree rounding is invisible and
  costs the same; a visible cut plane is most of what separates a modelled
  shape from a stretched cube.
- **One grown mesh, not stacked primitives.** A pile of intersecting solids has
  no continuous surface, so every junction between parts is a hard collision.
  This is the whole reason for the Blender pipeline in section 6.
- **Detail is geometry or it does not exist.** No texture budget for painted
  detail.
- **Straight for order, irregular for age.** New infrastructure is crisp and
  symmetric; neglected infrastructure sags and loses symmetry. That is a
  mechanic rendered as form.

---

## 4. Colour

**Per object:** three tonal values and one accent. A base, a lit top face, a
shadowed side, and one saturated mark. More than that and the object stops
reading at size.

**The world:** the land is a ground, not a subject — desaturated and tonal.
Water is the one large saturated field and it anchors the composition.

**Semantic colour is reserved.** A small set of hues mean specific things —
yours, the council's, congested, derelict — and nothing else may use them. The
palette is checked automatically for perceptual distance and for dichromatic
confusion; a clash is a build failure, not a discussion.

---

## 5. What the world must show without a panel

State belongs in the world. If the player has to open a window to learn it, it
is not in the game, it is in the paperwork.

| State | How it reads |
|---|---|
| A way is derelict | It darkens, sags and loses its edge |
| A junction is jammed | Vehicles visibly queue; the jam is the information |
| A works is starved | Its yard empties, then it stops |
| A village is growing | Buildings appear along the street; the street lengthens |
| A vehicle is worn out | It breaks down, and it blocks the cell it stands in |
| Whose road this is | Surface and lining quality; a single overlay for the rest |
| A village has lost its quiet | Hedges thin, verges scuff, the field boundaries go. Amenity is read in the *land*, not in a number |

---

## 6. The pipeline

**Code-authored geometry: Python programs run through headless Blender,
exported as glTF.** Ported from `tribewars/art`, which already solved this.

Not primitives stacked and merged — a single mesh *grown*, with faces selected
by where they point and where they sit. Build scripts read as "take the face on
the outside and pull a limb out of it" rather than as a list of coordinates.

A model that is a program is diffable, reviewable, and above all
**parameterised** — the same cab with five different bodies on it, in a dozen
liveries, at two levels of detail. Nine vehicles is really three cabs and five
bodies, which is the whole argument for authoring shapes as functions.

### The loop, and why it closes

```
SHAPE SCRIPT  ->  BLENDER    ->  GLB + REPORT  ->  RENDERS      ->  LOOK AT IT
python,           headless      tris vs budget   front side top
one grown mesh                  floor check      three-quarter
                                height report    silhouette
      ^                                                              |
      +----------  the picture is wrong, so the script changes  ------+
```

Step four renders the **exported** file, never the Blender scene. Blender is
Z-up and glTF is Y-up, so the axis bug only exists after export.

The loop closes because the thing that built the model can see what it made.
That is the entire reason this works where a validator alone would not, and it
is not a theoretical claim. The first three models built through it were each
broken in a way that was invisible in the source and obvious in one render:

- `faces(normal='up')` matched all six faces of a cube, because `'up'` was not
  in the direction table and an unknown name silently disabled the filter. The
  house exported as a flat sheet two hundredths of a tile thick.
- Every vehicle floated half a metre off the road, because the wheel helper
  narrowed the underside of the body and called that wheels. The export
  report's floor check caught it; nothing in the code said it.
- The far LODs were spending two thirds of their triangles on sub-pixel wheels.

An unknown face direction is now an error rather than a silent match. That fix
is worth more than the model that prompted it.

### The scripts

| | |
|---|---|
| `lib.py` | Vocabulary: chamfered `box`, `wedge`, `cyl`, `ring`, `plate`, plus `part` / `attach` / `merge_into` and the export/budget report |
| `boxmodel.py` | `Form` — one grown mesh; select faces by normal and position, then extrude, inset, loop-cut, bevel, taper, bend, mirror |
| `shots.py` | Five-view review render of the exported glb, at game scale, beside a one-tile cage |
| `lineup.py` | The whole library at shipping size in one picture |
| `build_town.py` | The building kit |
| `build_vehicles.py` | Vehicles, parameterised by era |
| `build_industry.py` | Industry kits (see below) |
| `build_terrain_kit.py` | Cuttings, embankments, tunnel mouths, bridge parts |

### The ruler is a tile

Tribe Wars measured everything against a three-unit man. This game has no
figures in it, so the reference is the tile — one world unit, thirty-two metres
— drawn as a wireframe cage in every review render.

The useful question about a model is never "how tall is it" but "what fraction
of a tile does it cover". A house that covers a tile is a house the size of a
city block.

### Livery is a runtime slot

Every model reserves a material named `livery`. Faces painted with it are
tinted by the renderer at draw time; wheels, glass and chassis keep the colours
they were authored with. A company's colour is its paint, not its tyres.

Matched by material *name*, not index — a glTF material index depends on the
order the exporter happened to write the slots in, which is not a contract.

Livery must be **pattern plus colour**, never colour alone: at fourteen pixels
two mid-tone colours are the same colour. The removed-colour test is mandatory —
render the fleet greyscale, and if you cannot tell the companies apart, the
livery is decoration rather than identity.

### The far LOD is authored, not decimated

Vehicles are twelve to twenty pixels long at playing zoom. Decimating a
detailed lorry at that size is a smear. The far LOD is a **second, simpler
function in the same build script** whose only job is to say "lorry" at
fourteen pixels. A design task, not an optimisation task.

### One era, and what it changes

There is no era progression to keep coherent, which removes the risk the old
register rated Medium and replaces it with a much easier problem: **one
language, applied consistently.**

The 1985 language, written down so it can be checked:

| | |
|---|---|
| Buildings | Brick and render for housing; corrugated steel and profiled cladding for anything industrial; flat roofs with visible plant |
| Way | Tarmac with a worn crown, white lining, hedgerows on lanes, Armco and cats-eyes on the A-road |
| Vehicles | Flat panels, square corners, curtain-side and box bodies, visible chassis, small windows |
| Signage | Direction signs are the one place saturated colour is allowed on the land, because in 1985 they were the one place it was |
| Weathering | Everything is a bit dirty. Nothing is new except what you just built. |

The last row is the most useful. A district where everything is crisp reads as
a model railway. A district where only your new road is crisp reads as a place
somebody is changing — which is the game.

### Industries are kits, not models

A quarry is not one asset. It is a face, a crusher, conveyors, spoil heaps, a
weighbridge and a portacabin, placed by rule, so that no two quarries look
identical and all of them look related. The same box-modelling library driving a
placement function.

The creamery is the same trick: a tanker bay, a process block, silos, a chiller
and an office, dealt from one kit.

This also carries the visual states — working, starved, closed are the same kit
with a different material set and one or two swapped parts. A parameter, not
three assets.

### Settlements are dealt, not authored

You never place a building, so a settlement is a placement rule dealing from
the building kit. Two properties matter more than how it looks:

**Stable under growth.** A town's mesh is rebuilt as it grows, and if the
layout depends on how many buildings there are then adding one moves all the
others. Building *i* must land in the same place whatever the total is, so
growth only ever extends a street. Getting this wrong reads, exactly as
reported, as houses changing every day.

**Agreeing with itself.** What makes a town look like a town is not the
buildings, it is that they share a frontage and face the same way. The same
buildings at random angles is a car park.

---

## 7. Terrain

The heightfield is fractal noise put through a real erosion pass — stream-power
incision plus talus — before anything else touches it.

This is an art decision as much as a simulation one. Noise alone makes a lump:
everything rounded, ridges as humps, valleys as dents, water sitting wherever
the noise happened to sag. It reads as poured. Real ground is a random field
that has had a hundred thousand years of water and gravity applied to it, and
almost everything the eye recognises as landscape is the residue of that
process rather than the noise underneath.

Two passes recover most of it and neither is expensive. They also hand the game
its best gift: **the valleys are the natural routes, so the map argues about
where a line should go before anybody has drawn one.**

Way surfaces interpolate to meet at shared tile edges. A road drawn as one flat
quad per tile comes apart on a gradient into a string of disconnected plates.

---

## 8. Light and motion

**Light** is mood and never information. Night is a palette shift with a hard
floor on legibility — you must be able to read your own network at midnight
without turning it off. Weather tints; it never veils.

The sun runs on **real time, not game time**, on a four-minute cycle. A day is
forty-eight game-seconds at 1×, and at higher speeds a sun tied to the calendar
completes a dawn-to-dusk several times a second, which is not a day and night,
it is a fault. Nothing is read off the sun, so nothing is lost by letting it
keep its own clock — and a fixed cycle means the light looks the same at every
game speed, which is what you want from something whose whole job is to look
like light.

**Motion** is art direction, not polish. The renderer interpolates between
simulation ticks so a queue reads as a queue. A dropped frame costs a frame and
never a tick.

---

## 9. Budgets

| | Triangles |
|---|---|
| Vehicle, near | 240 |
| Vehicle, far | 60 |
| Building | 320 |
| Industry kit, whole | 1,800 |
| Terrain kit part (cutting, bridge span) | 120 |

Enforced by the export report, not by judgement. Over budget is a printed
failure with the number next to it.

---

## 10. The checklist

Before a model ships:

1. Does the export report show floor at 0.00 and height in the right band?
2. Does it read at fourteen pixels in the silhouette render?
3. Does it read in the lineup, beside everything else, on its tile?
4. Greyscale, can you still tell whose it is?
5. Is it inside budget?
6. Was it regenerated rather than hand-fixed?

Point six is policy. Hand-fixing an asset instead of fixing the script that
made it is how pipelines die.
