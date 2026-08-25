# What the spec got wrong

Written before deleting it, so the next one does not repeat it.

The short version: **the spec described a simulation and I built one. Nobody
ever wrote down that it had to be a fun, casual game, so nothing in eighteen
months of work was ever tested against that.**

---

## The evidence

Word counts across the 1,972 lines of the old spec:

| | |
|---|---|
| `fun` | **1** — in a subordinate clause about AI difficulty tuning |
| `casual`, `enjoy`, `delight`, `charming`, `satisfying`, `playful`, `cosy`, `relax` | **0 each** |
| `ownership` | 17 |
| `simulation` | 13 |
| `balance` | 11 |
| `deterministic` | 7 |

A spec is a set of instructions. That one instructed a deterministic ownership
simulation, and it got a very thorough deterministic ownership simulation.

---

## The eight mistakes

### 1. It never asked for a game

There is no section anywhere on what the player does in the first ten minutes,
no description of a session, no statement of what the pleasure is. `design.md`
§2 is "Signature mechanics". `features.md` had twenty categories and not one of
them was the first hour.

So mechanisms got specified in enormous detail and the *game* was never
designed. I then built the mechanisms, faithfully, and there was no game in
them.

### 2. The art direction produced exactly what it described, and what it described was drab

> "The land is a ground, not a subject — desaturated and tonal."
> "Colour is **earned**."
> "nothing on screen that isn't telling you something"

Followed literally, which is what I did, that is a recipe for a grey-green blob
field with no colour in it. The prose sounded sophisticated and specified mud.

Worse: 342 lines of *principles* and not one reference image, mockup, or target
frame. Principles do not produce pictures. There was nothing to compare the
screen against, so nothing ever failed.

**The art direction was followed and the result is ugly. That means the art
direction was wrong, not the implementation.**

### 3. Every phase gate was functional. Not one was visual

The six gates I passed: 5/5 spikes green, 0 replay divergences, 0 dead cargo,
0 desyncs across 10,799 hash points, 91/91 assets in budget, 0 palette clashes.

All green. It looked like a prototype the whole way, because nothing measured
that. `art-pipeline.md` had exactly the right instinct — *render the thing and
look at it, because nearly every bad model is bad in a way that is invisible in
the source and obvious in a picture* — and it was never built until this week.

### 4. Systems were ordered before look

Art was Phase 6 of 6. The thing a player judges in two seconds was scheduled
last. By the time you arrive there, the mistakes are geometric — tile size,
road width, camera distance, network density — and paint does not fix geometry.

### 5. Scale had an apology document

`scale.md` existed to explain why vehicle speeds and the calendar do not
reconcile. **A spec that needs an apology document has a wrong decision
upstream**, and the wrong decision was "one continuous region, up to 1024², 240
years".

It was also derived the wrong way round: pick a tile size, pick a world size,
then discover what a lorry looks like. It should run backwards — decide how many
pixels a lorry is, then derive the tile, then the district.

### 6. Content was generated, not authored

`generate.ts` emitted 36 cargoes, 44 vehicles and 46 industries
combinatorially. Nothing in that set was chosen. Measured over ten runs of 140
years, **nine cargoes were reachable and had never been carried once**, and the
entire industrial economy was 4% of tonnage.

"Balance by simulation, not intuition" is a good principle that got used as
licence not to make decisions.

### 7. Roads were specified as a graph, never as a thing you look at

Measured just now on a 256² district: 1,569 road tiles, which is 50 km of road
in an 8 km square. A real English district that size has more like 120 km. So
the spiderweb look is **not** density.

It is that the network has no *hierarchy* — no A-road, no lanes, no farm
tracks, just an undifferentiated web joining everything to everything — and
that it is drawn as flat six-pixel bands with a hub-and-arms motif designed to
make junctions legible from above.

"The roads aren't even real roads" is exactly right, and the spec never once
framed roads as an art problem.

### 8. Complexity was never budgeted

133 features. 20 overlay modes. 15 buttons in the construction rail. 5
transport modes. 8 eras. 36 cargoes. Nothing in the spec put a number on any of
those, so nothing was ever over.

`risks.md` rated "R3 — scope collapse; eighteen months in, nothing playable" as
High, with the mitigation *"act-based shipping; every phase ends in a complete
game"*. That was the right answer. It failed because "complete" was defined as
systems-present and never as playable-and-attractive, so every phase ended
complete and none of them ended in a game.

---

## What I got wrong independently of the spec

Worth separating, because a new spec will not fix these on its own.

- I followed the aesthetic prose instead of looking at the screen and saying
  this is drab.
- I did not render a frame and ask whether it was attractive until this week.
- I kept adding systems because the feature table listed them, past the point
  where I could see the game was not fun.
- I put 3,288 lines in one file.

---

## What the next spec must do differently

1. **Say what kind of game it is in the first sentence, and use the word fun.**
   Fun and casual are requirements, not tone. Short sessions, immediate
   feedback, no spreadsheet, forgiving, charming.

2. **Start from a target frame.** Make one picture of what the game looks like,
   first, before any code. Everything afterwards either matches it or is wrong.
   No principles without a picture.

3. **A visual gate on every phase.** A screenshot that has to be better than
   the last screenshot, judged by looking at it.

4. **Derive scale backwards from the camera.** How big is a lorry on screen →
   tile size → district size. Never the reverse.

5. **Author the content by hand.** Nine cargoes because somebody chose nine and
   can say why each one is there.

6. **Build the look first.** Terrain, roads, one lorry, beautiful — before any
   economy exists. If it is not attractive with one vehicle on one road, more
   systems will not rescue it.

7. **Roads are a first-class art problem** with a hierarchy: a spine, lanes,
   tracks. Few of them, and each one drawn properly.

8. **Put numbers on complexity in the spec** — buttons on screen, overlays,
   cargoes, vehicle types — and treat a breach as a bug rather than a feature.
