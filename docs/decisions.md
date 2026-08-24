# Decision log

Last updated 2026-08-24. This is the document that gets edited most. When something below
changes, change it here first and let the other documents follow.

Format: each decision records what was chosen, why, and — more usefully — **what it costs**, so
that when we hit the cost later we can tell whether it's a bug or a consequence we accepted.

---

## Locked

### D1 — Player role: haulier → magnate arc

Four acts, each gated behind a charter. See [`design.md`](design.md).

**Why.** It matches the original pitch ("you connect industry, you bring people") while solving
three problems at once: it's a natural tutorial, it's natural pacing, and it lets the first act
ship as a complete game rather than a demo.

**Cost.** It is effectively three or four games in one, and each act has to be balanced on its
own terms. Mitigated by act-based shipping — we never build act N+1 before act N is fun.

---

### D2 — Core verb: tile and node placement

Grid-snapped placement from a palette, not freehand drawing.

**Why.** Freehand is sublime for roads and does not survive contact with rail, sea and air.
Six transport modes need a placement model that generalises.

**Cost.** It discards the single most distinctive thing about Freeways. This is bought back
deliberately and in one place — see D3.

---

### D3 — The Junction Lab is a first-class feature

Alignments are placed on the grid, but any node where two or more meet opens into a dedicated
freehand editor, which reports real throughput, mean delay and worst-case queue.

**Why.** It's where the tactile joy lives, where mastery lives, and what players will screenshot.
It contains the Freeways DNA inside a tycoon frame rather than trying to make the whole game
freehand.

**Cost.** It's a second editor with its own UI, its own input model (including touch), and a
higher-resolution run of the traffic simulation. Not cheap. Worth it.

---

### D4 — Every vehicle is individually simulated

Real entities that path, queue, jam and can be clicked. Architected with an LOD escape hatch so
quiet routes can collapse to analytic flow.

**Why.** It's what makes isometric games feel alive, and jams that *emerge* are worth far more
than jams that are computed from a formula.

**Cost.** Performance is the whole engineering job. It also forces D5, because you cannot stream
this much state to other players.

---

### D5 — Deterministic lockstep simulation

Fixed timestep, fixed-point arithmetic, all mutation via timestamped commands. See
[`architecture.md`](architecture.md).

**Why.** It is the only way to have D4 and D9 in the same game. It also pays for saves, replays,
rival AI and the balance harness.

**Cost.** Determinism is a permanent discipline, not a one-off task. No floats in sim state, no
unordered iteration, no reading the clock, and every async result must land on a predetermined
tick. Enforced by a CI replay harness from the first commit.

**This is the only decision on this page that cannot be revisited cheaply.**

---

### D6 — One large continuous region

Roughly 1024 x 1024 tiles, procedurally generated per seed, with coast, river, mountains and
several towns.

**Why.** Big enough for a national network, small enough to stay coherent and performant, and it
avoids maintaining two rendering layers (local plus strategic map).

**Cost.** Terrain streaming and chunked meshing are required from early on, not later.

---

### D7 — Eras, 1860 to 2100, with real obsolescence

Tech unlocks on the calendar. Vehicles become obsolete and get replaced.

**Why.** It gives the arc a spine, makes standing still a losing move, and provides the romance
of watching your first steam line become a liability.

**Cost.** Multiplies asset volume across eras. This is precisely the cost that
[`art-pipeline.md`](art-pipeline.md) makes tractable — one parameterised lorry function covers
eight decades of bodywork.

---

### D8 — Low-poly 3D under an orthographic camera

Real geometry, flat shaded, on a locked palette. Not pixel-art sprites.

**Why.** Curved alignments, junctions, bridges, tunnels, elevation, day/night and weather all
become geometry and lighting problems rather than combinatorial asset problems. Sprite sheets
would need every vehicle at 8 rotations x every era, and every road curve pre-drawn.

**Cost.** Needs a real 3D asset pipeline. We have one — see D12.

---

### D9 — Day-one support: accounts, cloud saves, data-driven content, touch, shared worlds

All four, architected for from the start.

**Why.** Every one of these is expensive or impossible to retrofit. Shared worlds in particular
dictates D5.

**Cost.** Meaningful up-front work in Phase 0 and Phase 2 that doesn't visibly improve the game.
Accepted deliberately. Note that *shipping* multiplayer is deferred to Phase 5 — only the
architecture is day-one.

---

### D10 — All four pressure systems

Solvency, decay, rivals, and objectives/events.

**Why.** A sandbox without pressure is a toy. These four compose well: money constrains, decay
punishes neglect, rivals create urgency, events break routine.

**Cost.** Rivals are the expensive one. They arrive properly in Phase 4.

---

### D11 — AI generates content and builds the game. It does not run inside the simulation.

No LLM-driven citizens, companies or advisors in the sim.

**Why.** This was the single best call in the set. LLM agents in the tick loop would be
non-deterministic and unaffordable per-tick, and would have destroyed lockstep, saves, replays
and multiplayer in one stroke.

**Cost.** Rivals are ordinary planning code. They will be better for it — a bounded, tunable,
testable opponent is more fun than an unpredictable one.

---

### D12 — Adopt the `tribewars/art` modelling pipeline

Code-authored geometry through headless Blender, with a five-view render harness so the thing
that built the model can look at what it made. See [`art-pipeline.md`](art-pipeline.md).

**Why.** It already exists, it is better than the text-to-3D approach originally specced, and
models-as-programs is exactly what an eight-era vehicle roster needs.

**Cost.** Four adaptations are required, one of them structural (livery as a runtime-tinted
material slot rather than baked paint).

---

### D13 — Success target: a real product people play

Public, polished, possibly commercial.

**Cost.** Onboarding, telemetry, infrastructure, performance budgets per device tier, and a
release path all become in-scope rather than optional.

---

### D14 — Ownership and access charges are the game's spine

All fixed infrastructure has an owner and an access charge. Using someone else's costs you money;
owning it stops the cost and starts the income. Every access cost presents three live options:
**pay, buy, or bypass**. See [`design.md`](design.md) §3.

**Why.** It is the connective tissue the design was missing. It makes Act I's powerlessness
meaningful and the construction charter a genuine reward; it gives the haulier-to-magnate arc a
representation in the income statement rather than in narration; it gives rivals a way to attack
you that is fair; and it is what entangles players in shared worlds instead of merely racing
them. It is also how infrastructure economics has actually worked since turnpike trusts.

**Cost.** Three real ones.

1. **Snowball risk.** Damped by the toll curve (charge too much and traffic leaves, stranding
   your asset) and by purchase price being a multiple of recent earnings.
2. **Monopoly endgame.** Damped by regulation from era 5 — open access, charge caps, compulsory
   purchase, competition referrals.
3. **Pathfinding cost.** Every company sees a different cost graph, so routing caches are keyed
   per company rather than shared. This is a real multiplier on pathfinding work and is called
   out in [`architecture.md`](architecture.md).

Sub-questions are open — see design.md §3.10 — but the system itself is locked.

---

## Open

Nothing gets built until these close.

### O1 — The name

`Interchange` is the working title — it's both the junction and the trade. `Overland` is taken.
Other candidates: `Ironroad`, `Charter`, `The Long Haul`.

### O2 — Region flavour

A recognisable geography gives free personality: a British-ish island with a highland north and
an industrial midlands, or a Pacific coast with mountains and deep-water inlets. Or fully
fictional and generated.

**Blocks:** terrain generation parameters, the entire place-name content set, and some of the
industry mix.

### O3 — Tone

Dry and systems-forward (Workers & Resources) or warm and slightly silly (Transport Tycoon
Deluxe).

**Blocks:** all UI copy and voice, how seriously the economy presents itself, and — less
obviously — the modelling, because silly tolerates exaggeration that dry does not.

### O4 — Monetisation

Premium, free with cosmetics, or free.

**Blocks:** accounts, telemetry and how shared worlds are hosted. Note that "cosmetics" and
"livery slot" are the same feature wearing different hats, so this interacts with O5.

### O5 — How many companies share a world

Four is comfortable. Eight is a real constraint on the art direction, because every livery has to
be distinguishable from every other at 14 pixels *and* with the colour removed.

**Blocks:** livery palette budget, and part of the art direction in `art-pipeline.md`.

### O6 — Is Act I a public release or a closed playtest?

If public, accounts and telemetry move forward from Phase 2 into Phase 1, and Phase 1 gets
meaningfully bigger.

**Blocks:** the shape of Phase 1.

### O7 — Sign-off on the whole spec

Particularly D5. It's the one that can't be undone later.
