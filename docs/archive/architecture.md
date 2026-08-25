# Architecture

Follows from D4, D5, D6, D9 and D14 in [`decisions.md`](decisions.md).

---

## 1. The decision everything hangs from

The design asks for individually simulated vehicles **and** shared worlds. That is the hardest
pair available, because the naive approach to multiplayer — one authoritative server streaming
world state to clients — is impossible here. Twenty thousand vehicles at twenty ticks a second is
tens of megabytes per second, per player.

The answer is what real-time strategy games have used since the nineties: **deterministic
lockstep**. Don't send the world. Send the handful of decisions that changed it, and let every
machine compute the identical world for itself.

```
STREAM THE WORLD                      SHARE THE COMMANDS
client A <- server -> client B        client A <-> relay <-> client B
  renders    the sim    renders         full sim          full sim

20,000 positions x 20 Hz              build_road @ tick 8140, player 2
= tens of MB/sec                      = a few hundred bytes/sec
```

**This is not a multiplayer feature. It is the single-player architecture**, which happens to make
multiplayer nearly free. That is why it has to be decided now — retrofitting determinism onto a
finished simulation is a rewrite, not a refactor.

### What it buys beyond multiplayer

- **Saves are tiny.** A save is a seed plus a command log — kilobytes. Cloud saves stop being a
  storage problem. Periodic binary snapshots keep load times fast.
- **Replays and timelapses are free.** A save *is* a replay.
- **Rival AI is just a client.** No separate code path, no cheating, no divergence between what
  the AI can do and what the player can.
- **Balance becomes measurable.** The sim runs headless at thousands of times real speed, so we
  can run ten thousand complete games overnight across a parameter sweep. See
  [`content-and-balance.md`](content-and-balance.md).
- **Bugs are reproducible.** A player sends a command log; we replay the exact failure. In a genre
  this stateful that is worth an enormous amount.

### The price: determinism rules

These are not guidelines. Any one of them broken is a desync.

1. **No floating point in simulation state.** Fixed-point `Q16.16` throughout.
2. **No `Math.random`.** A seeded PRNG (xoshiro128\*\*) whose state lives in the sim.
3. **No `Date.now`, no `performance.now`, no wall clock.** The sim has a tick number and nothing
   else.
4. **No iteration over unordered collections.** Entity iteration is by index or by an explicitly
   sorted key. `Map` and `Set` iteration order is not a contract we rely on.
5. **Every async result applies at a predetermined tick.** A path request issued at tick 8140
   returns at tick 8148 on every machine, whether that machine took two milliseconds or forty.
   **This is the most likely source of desync in the whole project**, so the sim exposes no API
   that accepts a result immediately — it cannot be done by accident.
6. **No renderer feedback into the sim.** Camera position, viewport, frame rate and device tier
   must never influence simulation state. This is why the LOD sleep/wake rules live *in* the sim
   (§5).
7. **Iteration order over spatial structures is deterministic**, including hash-grid bucket
   traversal.

Enforced by CI from the first commit: golden command logs replayed on Chrome, Firefox, Safari and
Android, with rolling state hashes compared every 256 ticks.

---

## 2. Command model

All mutation flows through commands.

```
Command = { tick, issuer, kind, payload }
applyCommand(state, command) -> void
```

- The UI never mutates state. It issues commands, which are queued to a future tick (locally
  `N+2`, in multiplayer `N + latency budget`).
- Rivals issue the same commands through the same path.
- The command log plus the seed fully determines the world.
- A junction blueprint is a small command sequence, which is why blueprint sharing is nearly
  free.

---

## 3. Threading

```
MAIN THREAD              SIM WORKER                  PATH WORKERS
React UI, DOM overlay    ECS, typed arrays           hierarchical routing
Three.js, ortho camera   fixed-point Q16.16          graph rebuilt on edit
input -> commands        seeded PRNG only            pure, no sim state
interpolates ticks       mesoscopic traffic
display rate (60 Hz)     fixed 20 Hz, never varies   async, off critical path

  main --commands--> sim        sim --request @ N--> path
  sim  --snapshot (SAB)--> main path --applied @ N+8--> sim
```

- The sim writes double-buffered structure-of-arrays snapshots into a `SharedArrayBuffer`.
- The renderer interpolates between snapshot A and B. A dropped frame never affects the world.
- The sim never waits and never reads the clock.

---

## 4. Traffic model

Full car-following microsimulation for twenty thousand vehicles is too expensive and more
precision than the game needs.

**Mesoscopic cell model.** Each lane is a chain of fixed-length cells; a vehicle occupies cells;
junctions arbitrate with deterministic priority and signal rules. This gives real queues, real
spillback, and jams that emerge rather than being computed — at a small fraction of the cost.

The Junction Lab runs the identical model at higher cell resolution, so what you tune is what you
get.

---

## 5. Level of detail

A route with stable flow and no contention for a sustained period collapses into an analytic flow
record. It wakes on contention, on a nearby network edit, or on camera proximity.

**The sleep and wake rules live in the simulation, not the renderer.** Otherwise looking at a
route would change its outcome and determinism would be gone (rule 6 above). Camera proximity is
therefore fed in as a *command*, not read directly.

Budgets, to be confirmed in Phase 0:

| Device | Active vehicles | Region |
|---|---|---|
| Desktop | 25,000 | 1024 x 1024 |
| Tablet | 6,000 | Possibly a smaller region tier |

---

## 6. Pathfinding

Hierarchical routing over the network graph, rebuilt lazily on edit. Per vehicle it is mostly
"follow a precomputed route", with local queueing handled by the cell model.

### The ownership consequence — D14

Access charges mean **route cost is money as well as time**, and access charges differ per
company. So **every company sees a different cost graph.**

- Routing caches are keyed by company, not shared.
- Invalidation triggers: network edit, ownership change, **and access-charge change**. The last
  one is new and is easy to forget — a rival dropping their toll should re-route traffic.
- This multiplies routing work by the number of companies, which is a direct argument for keeping
  the company count modest (see O5, which turns out to be a performance question as well as an
  art one).
- Mitigation: the topology graph is shared and only the edge *weights* are per company, so the
  hierarchical decomposition is computed once.

---

## 7. Save format

```
save = { seed, worldConfig, commandLog[], snapshots[] }
```

- The command log is authoritative. Snapshots are an optimisation for load time and can be
  discarded and rebuilt.
- A snapshot is a binary dump of the SoA arrays plus the PRNG state.
- Cloud saves store the log; snapshots are regenerated client-side.

---

## 8. Multiplayer

- Clients exchange commands through a relay, which orders and timestamps them. It does not
  simulate.
- A headless authoritative sim runs the same TypeScript in Node for anti-cheat and for producing
  late-join snapshots.
- Desync detection by rolling state hash every 256 ticks; on mismatch the client resyncs from a
  server snapshot and the divergence is logged for diagnosis.
- Co-operative worlds ship before competitive ones.

---

## 9. Rendering

- Three.js with the WebGPU renderer and a WebGL2 fallback, orthographic camera.
- Instanced meshes throughout — one instanced draw per vehicle type, per building kit piece.
- Terrain as chunked greedy-meshed heightfield with streaming at region scale.
- Alignments (road, rail, pipeline) are ribbon geometry generated along splines and rebuilt per
  chunk on edit.
- Materials sample a locked palette atlas; the `livery` slot is tinted per company at draw time.

---

## 10. Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript, strict | Lockstep requires client, server and tools to run identical sim code. Not a preference — a requirement. |
| Repo | pnpm workspaces | `sim`, `render`, `data`, `client`, `server`, `tools`. `sim` has zero browser dependencies so it runs headless in Node. |
| Render | Three.js, WebGPU + WebGL2 fallback | Ortho camera over real 3D. Curves, bridges, elevation, weather become geometry problems not asset problems. |
| Simulation | Hand-rolled ECS, SoA typed arrays | No library gives fixed-point determinism plus cache locality. Roughly 2,000 lines. |
| Maths | `Q16.16` fixed point | Float behaviour varies subtly across platforms. Fixed point does not. |
| UI | React + Zustand, DOM overlay | Zero React in the render loop. Also makes the touch layout tractable. |
| Content | JSON defs, Zod schemas, hot reload | The schema is the contract generated content cannot break. |
| Relay | Cloudflare Durable Objects | A Durable Object literally is a stateful room — one per world. Global and cheap, no fleet to run. |
| Accounts, saves | Supabase | Postgres, auth and storage in one; fastest credible route to D9 without a backend team. |
| Modelling | Headless Blender + Python | See [`art-pipeline.md`](art-pipeline.md). |
| Tests | Vitest, Playwright, replay harness | The replay harness is the load-bearing one. |

### Touch

A single pointer abstraction written on day one, plus a compact layout mode — not a separate
mobile build. Camera gestures map to the same commands as mouse input.

---

## 11. Testing

| Kind | Tool | What it protects |
|---|---|---|
| Unit | Vitest | Sim systems in isolation, fixed-point maths |
| **Determinism replay** | Custom, in CI | Golden command logs across four platforms. The most important test in the project. |
| Property | Vitest | Invariants: no negative cash from a valid command, no vehicle off-network, conservation of cargo |
| Headless balance | Custom | Full games at speed; see content-and-balance.md |
| E2E | Playwright | UI flows, save/load, touch |
| Performance | Custom harness | Frame time and tick time against per-device budgets, tracked over time |
