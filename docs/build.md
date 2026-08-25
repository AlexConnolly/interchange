# Build

Architecture, phases, and what gets deleted.

---

## 1. Shape

```
packages/
  sim/      the simulation. No DOM, no three.js, no I/O.
  render/   three.js. Reads a RenderSource, draws. Knows nothing about rules.
  data/     content as JSON + Zod schemas.
  client/   React shell, input, panels.
  tools/    headless harnesses. Node, native TS stripping.
art/        Python + Blender. Exports .glb into client/public/models.
```

That separation has held and stays. The sim runs headless at hundreds of
thousands of ticks a second, which is what makes the balance harness possible,
and it is the single most valuable structural decision in the project.

## 2. What is deliberately no longer required

**Deterministic lockstep.** With no multiplayer there is nothing to keep in
step. Saves serialise state instead of replaying a command log.

This is a real relief rather than a small one. The requirement forbade floats
in simulation state, forbade `Math.random`, forbade unordered iteration, and
forbade wall-clock reads — a tax on every line written for the rest of the
project, and the source of the two risks the old register rated Critical.

Keep the fixed-point maths that already exists and works; stop treating it as a
constraint on new code. Keep the state hash, because a hash that changes when
nothing should have changed is a cheap bug detector even single-player.

## 3. The deletion list

Line counts are real. This is what "cut the fat" costs in code.

| Delete | Lines | Why |
|---|---:|---|
| `sim/rivals.ts` | 1,216 | No AI companies |
| `sim/regulation.ts` | 233 | Antitrust needs a monopolist and rivals |
| `sim/agreements.ts` | 231 | Needs two parties |
| `sim/objectives.ts` | 232 | Replaced by the three act goals |
| `sim/utilities.ts` | 251 | Power and water grids |
| `sim/weather.ts` | 303 | Events; seasons survive as a palette shift |
| `sim/seaair.ts` | 261 | Sea and air modes |
| Era gating across `world.ts`, `sites.ts`, content | ~400 | `fromEra`, `obsoleteYear`, `eraRate`, `checkEraTurn`, `eraBand`, basket gating, era-scaled capital |
| `sim/reclamation.ts` | 141 | Land reclamation |
| `sim/towncharacter.ts` | 162 | Zoning influence |
| `sim/transit.ts` | 136 | Car adoption modelling. Background traffic replaces it with something simpler |
| `sim/publicworks.ts` | 174 | The authority building its own network unprompted |
| `sim/stress.ts` | 167 | 25,000-vehicle spike harness |
| `server/` entirely | 639 | Relay, protocol, rooms, desync detection |
| `client/session.ts` + shared-world UI | ~300 | Multiplayer client |
| Contract machinery in `economy.ts` | ~200 | Bidding, deadlines, penalties |
| **Total** | **≈4,700** | |

`world.ts` is 3,288 lines and is the real problem. Removing the above should
take roughly a third out of it; the rest wants splitting along the five systems
in `design.md` rather than being left as one file that knows everything.

Content deletions: eras 4–8, twelve cargoes, thirty-odd vehicles, three modes.

**Nothing is deleted before it is written down in `cut.md`.** The point of that
document is that a cut is reversible and a forgotten idea is not.

### One piece of bookkeeping

The code carries 241 citations of the design documents in its comments, and 149
of them now point into `docs/archive/`. That is not worth a mechanical
find-and-replace: most of them are in files on the deletion list above, and the
rest sit in code Phase A rewrites anyway. Fix each as its file is touched, and
treat a comment still citing an archived document as a sign that the code around
it has not been revisited yet — which is useful information rather than debt.

## 4. What is kept and made better

| Keep | Lines | Note |
|---|---:|---|
| `sim/traffic.ts` | 644 | Individually simulated vehicles. The good bit. |
| `sim/junction.ts` | 405 | Junction capacity and layout. The best bit. |
| `sim/construction.ts` | 447 | Earthworks, bridges, tunnels. Becomes the star. |
| `sim/terrain.ts` + `erosion.ts` | 1,000 | Working, and beautiful |
| `sim/sites.ts` | 631 | Towns and industries that grow |
| `sim/network.ts` | 644 | Ownership, tiles, valuation. Simplifies. |
| `sim/tilerouter.ts`, `pathfinding.ts` | 703 | Routing |
| `render/` | 3,646 | Gains the glb loader; loses overlays |
| `sim/amenity.ts` | 217 | Back in scope. It is the counterweight to the top rung |
| `tools/balance.ts` and the sweep | ~900 | The only reason any of this was findable |

### The one new system

**Background traffic.** A flow per way, responding to price and congestion. It
is what makes a toll worth collecting without simulating rival companies, and
it is the cheapest thing in this document: an origin/destination distribution, a
volume, and an elasticity. Perhaps 250 lines against the 1,680 being deleted
from `rivals.ts` and `regulation.ts` — which existed to do the same job.

## 5. Phases

One phase per rung, and each ends with something playable. That rule is the
only defence against the failure that actually happened last time.

### Phase A — Trucks

Delete section 3. Reduce content to `content.md`. Then one thing, measured:

> A new player takes the milk run from Marchford to the creamery and, within ten
> real minutes, has decided whether to buy a second van.

That needs the opening to place you at a yard with an obvious job, the route UI
to take three clicks not eight, and the money to be legible. If this is not fun,
nothing later rescues it.

**Ends with:** rung 1 playable, and a sweep saying time-to-first-profitable-route
is minutes.

### Phase B — Yards

Yards as owned sites with catchments and bays. Three more of them on the map.
Vehicle wear and servicing, because that is what makes a yard a place rather
than a spawn point.

**Ends with:** rung 2 playable — buying the Aldbridge yard is the best decision
available and you can say why.

### Phase C — Traffic

Background flow, junction capacity, the junction editor. This is the phase that
turns the map into a problem.

**Ends with:** rung 3 playable, and the sweep showing the busiest junction
actually queues.

### Phase D — Owning

Way ownership, valuation, tolls, maintenance. The branch line: hire it, then buy
it. Other people's traffic paying you.

**Ends with:** rung 4 playable — and the sweep showing 20–40% of late income
from tolls, against the old draft's 8.76%.

### Phase E — Building and siting

Construction across terrain: gradients, earthworks, bridges. Siting industry.
Amenity as the counterweight.

**Ends with:** rung 5, and the game content-complete.

### Phase F — Beauty

Spent entirely on art, with the pipeline. The 1985 kit: buildings, the nine
vehicles with five bodies, industry kits, the terrain kit, lighting, far LODs,
the lineup passing.

A phase, not a polish pass. "Small worlds that look beautiful" does not happen
in the gaps of other work.

### Phase G — Ship

Performance, saves, settings, audio, onboarding.

## 6. Testing

Unchanged and it earned its place: vitest for the sim, headless harnesses in
`tools/` for anything that needs a hundred years to show up.

Two harnesses proved their worth and stay:

- **The balance sweep.** Measures the signals in `content.md`. It is what found
  nine dead cargoes and a rent share of 8.76%.
- **The timelapse.** Renders a whole game as one animated picture. It is what
  found the two bugs that emptied every region of vehicles by 1940 — neither of
  which any summary statistic had ever mentioned, because the sweep ran a
  hundred and forty years and averaged.

The lesson from that pair is worth stating: **a number aggregated over a run
hides anything slow, and a picture of the whole run does not.** Build the
picture early.

## 7. Risks, now that there are fewer

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | The loop is not fun even simplified, and no amount of art fixes it | **Critical** | Phase A exists only to answer this, before anything is built on top |
| R2 | Scope creeps back — a feature at a time, each individually reasonable | **Critical** | The five systems in `design.md` are a closed list. Anything else goes in `cut.md` first and waits |
| R3 | Congestion never binds, so building is decorative | **High** | Measured in the sweep. If the busiest junction never queues, the traffic system is not working |
| R4 | Growth feedback too slow to feel caused by the player | **High** | Explicit Phase A target, measured in real minutes |
| R5 | Background traffic is inert — nobody ever diverts, so the toll curve is flat and rung 4 is fake | **High** | Measured directly: diverted volume at the revenue-maximising price. This risk replaces the old R6 snowball, and it is the one thing rung 4 depends on |
| R6 | Livery unreadable at fourteen pixels | **Medium** | Pattern plus colour; greyscale test mandatory |
| R7 | Small district feels small rather than knowable | **Medium** | Five settlements, one clearly largest, four yards whose positions are the second act. Test with a player who has not seen the map |

R2 is the one to watch. Every feature in `cut.md` was added by somebody
reasonable for a reason, and that is exactly how the previous draft reached a
hundred and thirty-three of them.
