/**
 * The host loop: it owns the simulation, drives it at a fixed rate, and hands
 * the renderer a view of it.
 *
 * The one rule that matters here is the direction of the arrows. The UI issues
 * commands and never touches state; the renderer reads a snapshot and never
 * writes. The sim advances a whole number of ticks per frame and never a
 * fraction — a frame that arrives late runs two ticks, and a frame that never
 * arrives runs none. Nothing about the display rate can reach the simulation,
 * which is determinism rule 6 expressed as a loop.
 *
 * The sim runs on the main thread for now. It costs about 2 ms per tick at
 * Act I scale against a 50 ms budget, and the interface below — commands in,
 * a snapshot out — is already the interface a worker would have, so moving it
 * across is a change of transport rather than a change of design.
 */

import {
  createWorld, Cmd, cmd, SPEED_STEPS, TICKS_PER_DAY, TICKS_PER_SECOND,
  type Command, type World, type WorldConfig,
} from '@interchange/sim';
import { OverlayMode, Renderer, hex, type RenderSource } from '@interchange/render';
import { content } from '@interchange/data';

export interface EngineEvent {
  kind: string;
  text: string;
  tick: number;
}

export class Engine {
  world: World;
  renderer: Renderer | null = null;
  /** Fraction of the way from the last tick to the next, for interpolation. */
  alpha = 0;
  running = true;
  events: EngineEvent[] = [];

  private accumulator = 0;
  private lastFrame = 0;
  private raf = 0;
  private source: RenderSource | null = null;
  private listeners = new Set<() => void>();
  /** Bumped whenever something the UI displays has changed. */
  revision = 0;

  fps = 0;
  tickMs = 0;
  private frameTimes: number[] = [];

  constructor(config: Partial<WorldConfig>) {
    this.world = createWorld(config);
    this.wireWorld();
    // A handle for the console. The sim is fully inspectable from the
    // developer tools, which is worth more than any amount of logging when the
    // question is "why is that lorry sitting there".
    (globalThis as Record<string, unknown>).interchange = this;
  }

  private wireWorld(): void {
    this.world.onEvent = (kind, text) => {
      this.events.unshift({ kind, text, tick: this.world.tick });
      if (this.events.length > 60) this.events.pop();
      this.revision++;
    };
    this.world.onCharter = (company, charter) => {
      if (company !== this.world.player) return;
      const names = ['Carrier', 'Construction', 'Extraction', 'Land'];
      this.events.unshift({
        kind: 'charter',
        text: `The authority has granted you the ${names[charter]} charter.`,
        tick: this.world.tick,
      });
      this.revision++;
    };
  }

  /**
   * Take over a world built elsewhere — by a save being replayed, or by the
   * multiplayer relay handing over a late-join snapshot. The engine keeps its
   * own identity so subscribers do not have to be rewired.
   */
  adopt(world: World): void {
    this.world = world;
    this.source = null;
    this.events.length = 0;
    this.wireWorld();
    this.revision++;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /** Queue a command for the player. Always two ticks out, so that the local
   *  path and the multiplayer path are the same path (architecture.md §2). */
  issue(kind: number, a = 0, b = 0, c = 0, d = 0, data?: number[] | string): void {
    this.world.queue.push(cmd(this.world.tick + 2, this.world.player, kind, a, b, c, d, data));
    this.revision++;
  }

  issueAs(issuer: number, kind: number, a = 0, b = 0, c = 0, d = 0, data?: number[] | string): void {
    this.world.queue.push(cmd(this.world.tick + 2, issuer, kind, a, b, c, d, data));
  }

  attach(canvas: HTMLCanvasElement): void {
    this.renderer = new Renderer(canvas);
    const t = this.world.terrain;
    /*
     * Start looking at the largest town with work around it.
     *
     * This said "the largest town" and took towns[0], which is merely the
     * first one the generator placed — often a small one on the coast, so the
     * game opened on half a screen of empty sea. The player's first decision
     * is a route between somewhere that makes something and somewhere that
     * wants it, so the opening shot should have both in it: population for the
     * demand, and the industries within a cart ride for the supply.
     */
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < this.world.towns.count; i++) {
      const tx = this.world.towns.x[i];
      const ty = this.world.towns.y[i];
      let nearby = 0;
      for (let s = 0; s < this.world.sites.count; s++) {
        const dx = this.world.sites.x[s] - tx;
        const dy = this.world.sites.y[s] - ty;
        if (dx * dx + dy * dy < 60 * 60) nearby++;
      }
      const score = this.world.towns.population[i] + nearby * 220;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0) {
      this.renderer.camState.x = this.world.towns.x[best];
      this.renderer.camState.z = this.world.towns.y[best];
    } else {
      this.renderer.camState.x = t.size / 2;
      this.renderer.camState.z = t.size / 2;
    }
    this.renderer.invalidateWays();
    this.start();
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
    this.renderer = null;
  }

  setSpeed(step: number): void {
    this.world.speed = Math.max(0, Math.min(SPEED_STEPS.length - 1, step));
    this.revision++;
    this.notify();
  }

  /**
   * Build whatever field the overlay about to be shown needs.
   *
   * Computed on the switch rather than every frame: these are region-wide
   * passes and none of them changes fast enough to be worth recomputing at
   * sixty hertz. The cost is paid once, where the player has just asked a
   * question and expects a moment of thought.
   */
  private buildOverlayField(mode: OverlayMode): void {
    const src = this.buildSource();
    const w = this.world;
    const size = w.config.size;
    if (mode === OverlayMode.Catchment) {
      // Population reachable within a commute, splatted from the towns over
      // the land. A tile-space approximation of the network catchment the
      // simulation computes over the road graph — close enough to answer
      // "roughly where are the people", which is what the overlay is for.
      const field = new Float32Array(size * size);
      const reach = 42;
      for (let t = 0; t < w.towns.count; t++) {
        const tx = w.towns.x[t];
        const ty = w.towns.y[t];
        const pop = w.towns.population[t];
        for (let dy = -reach; dy <= reach; dy++) {
          const y = ty + dy;
          if (y < 0 || y >= size) continue;
          for (let dx = -reach; dx <= reach; dx++) {
            const x = tx + dx;
            if (x < 0 || x >= size) continue;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > reach) continue;
            field[y * size + x] += (pop / 1400) * (1 - d / reach);
          }
        }
      }
      src.overlayField = field;
    } else {
      src.overlayField = null;
    }

    if (mode === OverlayMode.Power || mode === OverlayMode.Water) {
      const utility = mode === OverlayMode.Power ? w.power : w.water;
      const layerMode = mode === OverlayMode.Power ? 5 : 4;
      const sat = new Float32Array(Math.max(1, utility.grids.length));
      utility.grids.forEach((g, i) => { sat[i] = g.satisfaction; });
      const gridOfTile = new Int32Array(size * size).fill(-1);
      const layer = w.layers[layerMode];
      for (let tile = 0; tile < size * size; tile++) {
        if (layer.cls[tile] === 255) continue;
        const node = w.graph.nodeAt(layerMode, tile);
        if (node >= 0) gridOfTile[tile] = utility.gridOfNode[node];
      }
      // A tile between two nodes belongs to the same grid as the link it is
      // on, so fill the gaps from the link the tile was traced into.
      for (let tile = 0; tile < size * size; tile++) {
        if (layer.cls[tile] === 255 || gridOfTile[tile] >= 0) continue;
        const link = layer.link[tile];
        if (link >= 0) gridOfTile[tile] = utility.gridOfNode[w.graph.linkFrom[link]];
      }
      src.gridSatisfaction = sat;
      src.gridOfTile = gridOfTile;
    } else {
      src.gridSatisfaction = null;
      src.gridOfTile = null;
    }
  }

  setOverlay(mode: OverlayMode): void {
    if (!this.renderer) return;
    this.buildOverlayField(mode);
    this.renderer.overlay = mode;
    this.renderer.invalidateOverlay();
    this.renderer.invalidateWays();
    this.revision++;
    this.notify();
  }

  private start(): void {
    this.lastFrame = performance.now();
    const frame = (now: number): void => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
      this.lastFrame = now;

      this.frameTimes.push(dt);
      if (this.frameTimes.length > 30) this.frameTimes.shift();
      this.fps = 1 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);

      const multiplier = SPEED_STEPS[this.world.speed];
      if (multiplier > 0 && this.running) {
        this.accumulator += dt * TICKS_PER_SECOND * multiplier;
        // A hard ceiling on catch-up. Without it, a tab that has been in the
        // background for a minute tries to run twelve hundred ticks in one
        // frame and locks the page.
        const budget = Math.min(this.accumulator, multiplier > 5 ? 64 : 12);
        const t0 = performance.now();
        let ran = 0;
        while (this.accumulator >= 1 && ran < budget) {
          this.world.step();
          this.accumulator -= 1;
          ran++;
        }
        if (ran > 0) {
          this.tickMs = (performance.now() - t0) / ran;
          this.world.project();
          this.revision++;
        }
        if (this.accumulator > 240) this.accumulator = 0;
        this.alpha = Math.min(1, this.accumulator);
      } else {
        this.alpha = 0;
      }

      if (this.renderer) {
        this.renderer.render(this.buildSource(), this.alpha);
      }
    };
    this.raf = requestAnimationFrame(frame);
    // The UI does not need sixty updates a second; four is plenty for a date
    // and a cash figure, and it keeps React out of the render loop entirely.
    setInterval(() => this.notify(), 250);
  }

  /** The view the renderer gets. Rebuilt lazily; the arrays are the sim's own,
   *  which is safe because the renderer only ever reads them. */
  buildSource(): RenderSource {
    const w = this.world;
    const c = content();
    if (!this.source) {
      this.source = {
        size: w.config.size,
        height: w.terrain.height,
        biome: w.terrain.biome,
        flags: w.terrain.flags,
        amenity: w.terrain.amenityBase,
        wayClass: w.layers.map((l) => l.cls),
        wayDir: w.layers.map((l) => l.dir),
        wayAsset: w.layers.map((l) => l.asset),
        wayLink: w.layers.map((l) => l.link),
        wayLevel: w.layers.map((l) => l.level),
        wayFlags: w.layers.map((l) => l.flags),
        assetOwner: w.assets.owner,
        assetCondition: w.assets.condition,
        linkFlowPrev: w.graph.linkFlowPrev,
        linkCellCount: w.graph.linkCellCount,
        // Through the palette's own converter, so way colours land in linear
        // space like every other colour. A local hex parser here was quietly
        // feeding sRGB values to the shader and every road came out white.
        wayColourOf: (cls) => hex(c.ways[cls]?.colour ?? '#888888'),
        vehicleCount: 0,
        vAlive: w.vehicles.alive,
        vType: w.vehicles.type,
        vCompany: w.vehicles.company,
        vX: w.vehicles.x,
        vY: w.vehicles.y,
        vHeading: w.vehicles.heading,
        vState: w.vehicles.state,
        vLoad: w.vehicles.load,
        vehicleClassOf: (t) => c.vehicles[t]?.class ?? 'lorry',
        vehicleEraOf: (t) => c.vehicles[t]?.era ?? 1,
        siteCount: 0,
        sX: w.sites.x,
        sY: w.sites.y,
        sState: w.sites.state,
        sDef: w.sites.def,
        sOwner: w.sites.owner,
        industryKitOf: (d) => c.industries[d]?.kit ?? 'works',
        industryFootprintOf: (d) => c.industries[d]?.footprint ?? 2,
        townCount: 0,
        tX: w.towns.x,
        tY: w.towns.y,
        tPopulation: w.towns.population,
        overlayField: null,
        gridSatisfaction: null,
        gridOfTile: null,
        dayFraction: 0,
        season: 0,
        era: 1,
        player: w.player,
      };
    }
    const s = this.source;
    s.vehicleCount = w.vehicles.count;
    s.siteCount = w.sites.count;
    s.townCount = w.towns.count;
    // Tick zero is a quarter past eight in the morning, not midnight. The
    // calendar does not care, but a player whose first sight of the region is
    // a dark field does, and "1 Jan 1860" starting at dawn is also just true.
    s.dayFraction = ((w.tick + TICKS_PER_DAY * 0.35) % TICKS_PER_DAY) / TICKS_PER_DAY;
    s.season = Math.floor((w.month / 12) * 4) % 4;
    s.era = w.era;
    return s;
  }
}

export { OverlayMode, Cmd };
export type { Command };
