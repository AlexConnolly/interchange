# Risk register

Severity is about *consequence if it happens*, not likelihood.

---

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Determinism drifts across browsers or devices; multiplayer desyncs | **Critical** | Fixed point only in sim state; no unordered iteration; no wall clock; CI replay harness across four platforms from commit one. See architecture.md §1. |
| R2 | Async pathfinding results applied on arrival rather than at a fixed tick | **Critical** | The single most likely source of desync. Enforced structurally — the sim exposes no API that accepts a result immediately, so it cannot be done by accident. |
| R3 | Scope collapse; eighteen months in, nothing playable | **High** | Act-based shipping. Every phase ends in a complete game. Stopping after Phase 2 still leaves a product. |
| R4 | Agent count versus tablet performance | **High** | Sleeping-route LOD in the sim, per-device agent budgets, region size tiers. Proven or disproven in Phase 0, not Phase 4. |
| R5 | Per-company cost graphs make pathfinding too expensive | **High** | New with D14. Shared topology with per-company edge weights only; caches keyed by company; modest company count (O5). Explicitly tested in Phase 0 spike 3. |
| R6 | The ownership economy snowballs — first mover owns everything | **High** | Two diegetic dampers: the toll curve (traffic leaves) and valuation as a multiple of earnings. Plus regulation from era 5. Measured directly by the balance harness via toll-revenue-vs-bypass-rate. |
| R7 | Eight eras of assets drift in style; 1860 and 2100 look like different games | **Medium** | Palette in the shader not the asset; automated `era_lineup` render; construction language changes but form language does not. art-direction.md §9. |
| R8 | Livery cannot carry company identity at 14 pixels | **Medium** | Livery is pattern plus colour, not colour alone. Removed-colour test is mandatory. Keeping company count at four rather than eight materially reduces this. |
| R9 | Economy balance across four acts and eight eras | **Medium** | Headless sweep harness; everything tunable is data, so a rebalance is a JSON change. |
| R10 | Multiplayer social design — griefing, pacing, players at different acts | **Medium** | Deliberately deferred to Phase 5 so it's designed against a real game. Co-operative first. Differential toll rates (design.md §3.10) held open specifically because it is a griefing vector. |
| R11 | The Junction Lab is a second UI with its own input model, including touch | **Medium** | Scoped as a first-class feature with its own budget rather than treated as a mode of the main editor. |
| R12 | Industry visual states triple the industry art cost | **Medium** | Kit-based industries mean states are parameter changes, not new assets. Budgeted from the first industry rather than retrofitted to forty. |
| R13 | Camera elevation chosen wrongly, discovered after assets exist | **Medium** | Settled in Phase 0 spike 5 with real geometry, before anything is modelled. Everything depends on that number. |
| R14 | Hand-fixing assets instead of regenerating them | **Low** | Stated policy: regenerate, never hand-fix. It is how pipelines die. |
| R15 | Supabase or Cloudflare limits hit at scale | **Low** | Command logs are kilobytes and relays are one Durable Object per world. Headroom is large. Revisit only if D13 produces real numbers. |

---

## The two to watch

**R2** is the one that will actually happen. Determinism bugs are silent, they appear under load
and network jitter, and they surface as "multiplayer is broken" months after the cause. The
structural enforcement is worth more than any amount of care.

**R6** is new, and it is the price of the best idea in the design. The ownership spine is what
makes the game cohere, and runaway accumulation is exactly what that kind of system does if left
alone. The dampers are sound in theory; the balance harness has to prove them before Phase 4
builds rivals on top.
