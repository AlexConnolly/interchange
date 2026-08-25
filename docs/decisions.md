# Decisions

What is settled, what was revoked, and why. Old numbering is kept so that
references in code comments still resolve; a revoked decision is struck rather
than deleted.

---

## Locked

### D1 — The player is a haulier who becomes an infrastructure owner

Unchanged in substance and much sharper in statement. The arc is
**user, then owner, then producer**, climbed as five purchases:

```
buy trucks -> buy yards -> hire other modes -> buy infrastructure -> build it
```

Every rung is a purchase and every rung changes what the binding constraint is.
See `design.md` §1 for the table of what each one solves and what it creates.

The **yard** is the unit of expansion and that is new. Buying a second yard does
not make existing routes better; it opens work you could not reach at a price
that worked. That makes growth a decision on the map rather than a number going
up, and it was missing from every previous draft.

### D2 — The core verb is placing tile and node

Unchanged. You draw way across terrain and place stops on it. Everything else
is a consequence.

### D3 — The Junction Lab is a first-class feature

Unchanged, and after this rewrite it is more important rather than less. It is
the system that makes building a problem instead of a drawing exercise. When
almost everything else was cut, this was never a candidate.

### D4 — Every vehicle is individually simulated

Unchanged. Queues, congestion and breakdowns are only legible because there is
a specific cart in a specific place. The smaller region makes this cheaper.

### D6 — One continuous region — *amended*

One region, **one size: 256 x 256 tiles**, five settlements and four yards. The
old decision allowed up to 1024 squared and four size tiers. "Small worlds that
look beautiful" and a 32 km square are not compatible, and the tiers were a
performance hedge for a scale no longer being built.

The tile stays at 32 m. Changing it would invalidate every art decision already
made -- the one-tile ruler, the model dimensions, the triangle budgets -- for no
gain.

### ~~D7 — Eras, 1860 to 2100, with real obsolescence~~ — *revoked*

**One era: 1985 to 1995.** No progression through history at all.

Eras were the single largest source of difficulty in the project and they were
buying almost nothing. They multiplied content by eight; they produced a whole
class of bug that nothing else could (era-gated baskets collapsing a region,
flat rates against tenfold cost growth emptying every region of vehicles by
year eighty, starting capital frozen at 1860 levels so no later entrant could
buy a vehicle); and they carried a standing art-coherence risk.

What they were buying was a sense of advancement — and that job belongs to the
ladder in D1, which is what the game was always about. Milk run to corporation
is a **vertical** progression. The old draft spent its entire budget on the
horizontal one.

Vehicles still wear out and break down. Nothing becomes worthless because a
decade turned.

The mid-eighties specifically, for one non-aesthetic reason: **privatisation.**
Rung 4 needs infrastructure a private operator can plausibly buy, and 1985 is
the decade the British state was selling it — freight in 1982, ports in 1983,
buses deregulated in 1986, branch lines throughout. "Buy the line" is a real
transaction of that year and would be fiction in almost any other.

### D8 — Low-poly flat-shaded 3D under a low orthographic camera

Unchanged.

### D11 — AI generates content and builds the game; it does not run inside the simulation

Unchanged, and now much easier to hold to, because there is no longer any AI
opponent to be tempted into.

### D12 — Adopt the `tribewars/art` modelling pipeline

Unchanged and now ported. `lib.py`, `boxmodel.py`, `shots.py`, `lineup.py`
adapted, with the ruler changed from a three-unit man to a one-tile cage and
livery moved to a reserved runtime material slot.

Justified itself immediately: see `art.md` §6 for the three bugs it caught in
its first three models, each invisible in the source.

---

## Revoked

### ~~D5 — Deterministic lockstep simulation~~

Revoked with multiplayer. Nothing needs to stay in step.

The requirement forbade floats in simulation state, `Math.random`, unordered
iteration and wall-clock reads. That is a tax on every line of simulation code
written for the rest of the project, and it produced the two risks the old
register rated Critical.

The fixed-point maths that exists stays, because it works and rewriting it buys
nothing. The state hash stays, because a hash that moves when nothing should
have moved is a cheap bug detector even single-player. What goes is the
*constraint on new code*.

### ~~D9 — Day-one accounts, cloud saves, shared worlds, touch~~

Revoked. Local saves. One platform target properly served beats four
half-served, and shared worlds went with the multiplayer cut.

Data-driven content survives from this decision and was always the valuable
half of it — everything tunable is JSON, so a rebalance is not a rebuild.

### ~~D10 — All four pressure systems~~

Revoked. The four were competition, regulation, obsolescence and disruption.
Competition and regulation are cut with rivals. Disruption events are cut as
taxation-by-random-number.

Obsolescence went with the eras (D7). What survives from it is **wear**: a
vehicle degrades, breaks down, and blocks the cell it is standing in. Nothing
becomes worthless because time passed.

The pressures now are congestion, capital scarcity, perishable loads, the
terrain, amenity -- and **background traffic**, the one genuinely external
pressure left and the only one that pushes back rather than simply costing
money.

### ~~D13 — Success target: a real product people play~~

Not revoked as an ambition, revoked as a *decision*, because it decided nothing.
It was used to justify accounts, cloud saves, telemetry and shared worlds on day
one, none of which were the reason nobody could play it. The reason was that it
was not finished.

Replaced by the Phase A target in `build.md`, which is falsifiable: a new player
takes the milk run from Marchford to the creamery and, within ten real minutes,
has decided whether to buy a second van.

---

## Restored

### D14 — Ownership is the spine — *restored, with the mechanism changed*

I revoked this in the previous pass and that was half right and half wrong. The
correction matters enough to record properly.

**What the decision said.** Assets own tiles, crossing somebody's way costs
money, and buying it converts a cost into an income. Elegant, historically true,
and it makes the whole design cohere.

**Why I revoked it.** It appeared to need an ecosystem. Rent has to be paid by
somebody, so the design had rival companies; rivals need somewhere to put their
money, so asset trading; a dominant owner needs a check, so regulation; and
regulation needs remedies, so compulsory purchase and access agreements.
Roughly two thousand lines, all of it so that rent-collection would be
interesting. The old risk register flagged the snowball at High, and when the
balance harness finally measured it across ten 140-year runs, **rent was 8.76%
of income with eight of forty companies earning any at all.** Under a tenth of
the game's money for most of its complexity.

**Why that was the wrong conclusion.** The idea was never the problem. The
*payer* was. I assumed the only thing that could pay a toll was a simulated
rival company, and it is not: **it is traffic.**

A district has traffic that is not yours — farmers' vans, other hauliers,
buses, cars — and modelled as a flow on each way, with a volume and an
elasticity, it pays the toll for perhaps 250 lines. It also does the job
*better* than agents did:

- It gives the toll a real demand curve, so there is a revenue-maximising price
  that moves as the district grows. That is exactly the self-balancing mechanism
  the old §3.3 wanted, and a curve cannot go bankrupt or behave stupidly.
- It makes congestion honest. The lane through the village is busy because it is
  a village; your sixth truck is the straw, not the load.
- It needs no regulation, because there is no rival to be unfair to.

So ownership is the spine again, and rung 4 is the pivot of the game. Rivals
stay cut. What was actually wrong was the assumption that the two came together.

## Open

### O1 — The name

`Interchange` is a working title, and it fits a road-haulage game better than it
fitted the old one.

### ~~O2 — Whether canals belong in v1~~ — *closed, out*

Closed by the era decision. Canal freight was finished by 1985. It was the
strongest candidate to return under the Victorian framing and it is simply not
part of this game.

### ~~O3 — Whether Act III needs the amenity tension~~ — *closed, in*

Closed by the ladder. When the top rung is deciding where things go, siting
industry with no downside is not a decision at all — so amenity is in scope
rather than deferred, and comes off the deletion list.

It is also the right era for it. 1985 is exactly when every district in England
was having the argument about an industrial estate on the edge of a village.
