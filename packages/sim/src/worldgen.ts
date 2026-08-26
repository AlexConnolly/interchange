/**
 * Populating a fresh region: companies, towns, industries, and the authority's
 * road network.
 *
 * Act I's premise is that roads exist and they are bad (roadmap.md, Phase 1),
 * so the authority lays a sparse network of dirt tracks between the towns
 * before the player has done anything. Every tile of it is owned by the
 * authority and carries an access charge, which is why the player's very first
 * income statement has a line on it they can do nothing about.
 */

import { ACCESS_SCALE, AUTHORITY, DIR_BIT, DIR_DX, DIR_DY, DIR_OPPOSITE, Mode } from './constants.ts';
import { NONE } from './network.ts';
import { generateRoads } from './roadnet.ts';
import { Crop, isWood } from './fields.ts';
import { Deposit, SEA_LEVEL, TileFlag, type Terrain } from './terrain.ts';
import { Charter } from './economy.ts';
import { SiteState } from './sites.ts';
import type { World } from './world.ts';

const LIVERY_NAMES = [
  'Regional Authority',
  'Your company',
  'Marchbank Haulage',
  'Coldwell & Sons',
  'Tyne Carrying Co.',
  'Ashfield Transport',
  'Kelso Wagon Works',
  'Brightside Carriers',
  'Northern Union',
];



export function generateWorld(w: World): void {
  const t = w.terrain;
  const c = w.content;

  // ---- companies --------------------------------------------------------
  // Company 0 is always the authority. design.md §3.1.
  w.companies.alloc(LIVERY_NAMES[0], 0, true, 0);
  /*
   * The player holds the top charter, and that is a cut mechanic showing.
   *
   * Charters were an era-progression gate — you earned the right to dig, then
   * the right to build — and eras went with `cut.md`. Leaving the player on the
   * Construction charter meant `canFound` refused a distribution centre, which
   * is a terminal and wants Land: the last rung but one of the ladder was
   * unreachable because of a rule the design had already deleted.
   *
   * Rather than special-case the depot, the honest thing is to say the gate is
   * gone. What limits building now is the influence area and the money, which is
   * what design.md says limits it.
   */
  const player = w.companies.alloc(LIVERY_NAMES[1], c.balance.startingCash, false, 1);
  // `alloc`'s fourth argument is the *livery*, not the charter — passing
  // Charter.Land there changed the player's colour and left the charter at
  // Carrier, which is a good demonstration of why this is now on its own line.
  w.companies.charter[player] = Charter.Land;
  for (let i = 2; i < Math.max(2, w.config.companyCount); i++) {
    const id = w.companies.alloc(LIVERY_NAMES[i % LIVERY_NAMES.length], c.balance.startingCash, true, i);
    // design.md §2.5: personalities are weightings, not code paths.
    w.companies.aggression[id] = 30 + w.rng.int(60);
    w.companies.horizon[id] = 25 + w.rng.int(65);
    w.companies.thrift[id] = 25 + w.rng.int(65);
  }

  // ---- towns ------------------------------------------------------------
  for (const seed of t.towns) {
    w.towns.alloc(seed.x, seed.y, t.idx(seed.x, seed.y), seed.name, seed.population, seed.character);
  }

  // ---- extraction sites -------------------------------------------------
  const era1 = (defIndex: number): boolean => c.industries[defIndex].fromEra <= 1;
  for (const d of t.deposits) {
    const options = (c.industriesByDeposit[d.kind] ?? []).filter(era1);
    if (options.length === 0) continue;
    let x = d.x;
    let y = d.y;
    // A fishery is a harbour, so it belongs on the land beside the water, not
    // on the water. Offshore extraction waits for the water network in Act IV.
    if (d.kind === Deposit.Fish) {
      const landing = nearestLand(t, x, y, 8);
      if (!landing) continue;
      x = landing[0];
      y = landing[1];
    } else if (d.kind === Deposit.Oil) {
      continue;
    }
    if (!t.isLand(x, y)) continue;
    const def = options[w.rng.int(options.length)];
    const site = w.sites.alloc(def, x, y, t.idx(x, y), AUTHORITY);
    w.sites.richness[site] = d.richness;
  }

  /*
   * ---- farms -------------------------------------------------------------
   *
   * Farms are not a mineral deposit, and treating them as one was the single
   * most damaging bug in the world generator.
   *
   * They were placed like collieries: on tiles carrying `Deposit.Farm`, which
   * the terrain only puts where the biome happens to be Farmland. On a hilly
   * seed that is nowhere, so the district came out with three quarries, a
   * forestry and four sawmills and *no dairy chain at all* — while the renderer,
   * which divides the entire map into field parcels with hedges round them,
   * drew a farming valley. The simulation and the picture disagreed about what
   * kind of place this was, and the picture was right.
   *
   * A district of fields has farms in it. So they are placed near the
   * settlements, in a ring far enough out to be countryside and near enough to
   * have a lane to them, cycling through the kinds so a valley gets a dairy, an
   * arable and a livestock farm rather than three of one.
   *
   * This has to run *before* `producedNearby` below, because that is what makes
   * a creamery eligible: the processing pass only places an industry whose input
   * the district can actually supply, so without farms first there is no
   * creamery, no mill and no abattoir either. One missing pass cost the game
   * eight of its fourteen industries.
   */
  const farmDefs: number[] = [];
  c.industries.forEach((ind, i) => {
    if (ind.fromEra > 1 || ind.kind !== 'extraction') return;
    if (ind.deposit !== Deposit.Farm) return;
    farmDefs.push(i);
  });
  if (farmDefs.length > 0) {
    let turn = 0;
    for (let townId = 0; townId < w.towns.count; townId++) {
      // A village has farms round it; a town has a few more.
      const count = 2 + (w.towns.population[townId] > 900 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const spot = findSiteSpot(t, w.towns.x[townId], w.towns.y[townId], 5, 15, w);
        if (!spot) continue;
        const def = farmDefs[turn++ % farmDefs.length];
        const site = w.sites.alloc(def, spot[0], spot[1], t.idx(spot[0], spot[1]), AUTHORITY);
        // A farm's richness is its land, and this land is all much of a muchness.
        if (site !== NONE) w.sites.richness[site] = 140 + w.rng.int(80);
      }
    }
  }

  // ---- processing and terminal sites ------------------------------------
  // Placed near towns and chosen so that whatever the region actually digs up
  // has somewhere to go. A map with four collieries and no gasworks is a map
  // where the player's only cargo is worthless.
  /** What the district can supply, right now. Recomputed between waves. */
  const supply = (): Map<number, number> => {
    const made = new Map<number, number>();
    for (let s = 0; s < w.sites.count; s++) {
      const outs = c.industries[w.sites.def[s]].recipe.outputs;
      for (const id of Object.keys(outs)) {
        const ci = c.cargoIndex.get(id);
        if (ci !== undefined) made.set(ci, (made.get(ci) ?? 0) + 1);
      }
    }
    return made;
  };

  /** Does this place consume without making anything? A shop, not a works. */
  const isShop = (def: number): boolean =>
    Object.keys(c.industries[def].recipe.outputs).length === 0
    && c.industries[def].passThrough !== true;

  /**
   * The industries whose input the district can supply, given what it has.
   *
   * Works first, shops second, and in that order for a reason beyond tidiness:
   * a works is what makes the *next* thing possible, so it has to exist before
   * anything that sells what it makes can be eligible at all. It also means the
   * first pass places exactly what it placed before this two-pass business
   * existed — which matters, because the shop takes milk and would otherwise
   * have joined the first pass's rotation and pushed something else out of it.
   * Measured: on the opening seed that substituted a second feed mill for the
   * brewery, moved the milk run from a creamery twenty-eight tiles away to one
   * thirty-six tiles away, and halved the time to a second van. Adding the shop
   * should add the shop.
   */
  const eligible = (made: Map<number, number>, shops: boolean): number[] => {
    const out: number[] = [];
    c.industries.forEach((ind, i) => {
      if (ind.fromEra > 1) return;
      if (ind.kind !== 'processing' && ind.kind !== 'terminal') return;
      if (isShop(i) !== shops) return;
      const ins = Object.keys(ind.recipe.inputs).map((k) => c.cargoIndex.get(k) ?? -1);
      if (ins.some((ci) => ci >= 0 && (made.get(ci) ?? 0) > 0)) out.push(i);
    });
    return out;
  };

  /*
   * Two waves, and the second is the one that was missing.
   *
   * Eligibility was computed once, before a single processing site existed — so
   * the only inputs the district was known to supply were the ones that come out
   * of the ground: milk, grain, livestock, aggregate, timber. Everything one step
   * further along was therefore ineligible for ever. A creamery placed in the
   * loop never made the shop that sells its dairy eligible, because the list had
   * already been drawn up.
   *
   * The effect was invisible and large. Of sixteen industries in the data, six —
   * the village shop, the filling station, the builders' merchant, the freight
   * terminal, the distribution centre and, on most seeds, the abattoir — were
   * never generated in any district on any seed. Not rare: absent. The economy
   * was a third of the size it was written to be, and it looked complete because
   * the missing places were exactly the ones you never saw.
   *
   * So the second wave asks again, having built the first. That is all it takes:
   * farms make milk, the first wave puts a creamery on it, and the second wave
   * can then put a shop on the dairy.
   */
  for (let wave = 0; wave < 2; wave++) {
    const consumers = eligible(supply(), wave === 1);
    if (consumers.length === 0) continue;
    /*
     * The second wave draws its random numbers from its own stream.
     *
     * Because otherwise adding it moves the whole district. Everything after
     * this point — the road network above all — draws from the same sequence, so
     * six extra calls to `findSiteSpot` shift every number the road builder
     * sees, and a seed that had a creamery twenty-eight tiles down the lane now
     * has one at thirty-six. Nothing was placed differently; the *roads between*
     * the same places were. It showed up as the opening job paying half again as
     * much and the second van arriving in four minutes instead of eight, on the
     * one seed the game actually opens on.
     *
     * So the wave is a side stream, seeded off the district seed and put back
     * afterwards. Adding a generation pass should not be able to reshuffle the
     * passes after it, and this is the line that makes that true.
     */
    const resume = wave === 1 ? w.rng.getState() : null;
    if (wave === 1) w.rng.seed((w.config.seed ^ 0x5eed51de) | 0);
    for (let townId = 0; townId < w.towns.count; townId++) {
      /*
       * Two or three per settlement, not one.
       *
       * With farms now in the district there is far more that a processing site
       * could usefully consume, and a district of a dozen places is what
       * design.md asks for. One per town gave eight sites for fourteen
       * industries, most of them duplicates of the same three.
       */
      const count = wave === 0
        ? 2 + (w.towns.population[townId] > 900 ? 1 : 0) + (townId % 2 === 0 ? 1 : 0)
        : 1 + (w.towns.population[townId] > 900 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const def = consumers[(townId * 3 + k + wave * 5) % consumers.length];
        /*
         * A shop stands in the village; a works stands outside it.
         *
         * The difference is what the place is *for*. A creamery is sited away
         * from the houses because it is noisy and takes lorries all day; a shop
         * with no lorries of its own is on the street the people are on, and
         * putting it eleven tiles out in a field would be the one building in
         * the district in the wrong place. Read off the data rather than the id:
         * anything that consumes and makes nothing is serving the people who
         * live there, so that is where it goes.
         */
        const spot = isShop(def)
          ? findSiteSpot(t, w.towns.x[townId], w.towns.y[townId], 2, 5, w)
          : findSiteSpot(t, w.towns.x[townId], w.towns.y[townId], 4, 11, w);
        if (!spot) continue;
        w.sites.alloc(def, spot[0], spot[1], t.idx(spot[0], spot[1]), AUTHORITY);
      }
    }
    if (resume) w.rng.setState(resume);
  }

  /*
   * ---- the first job always exists ----------------------------------------
   *
   * `balance.json` names the cargo the game opens on, and the whole economy is
   * tuned around that one run: how much it pays, how long the second vehicle
   * takes, which lorry can carry it. It is the tutorial, and it is measured in
   * real minutes of play.
   *
   * But whether the district *has* that chain was luck. Processing sites are
   * dealt from a rotation over whatever the region can supply, so roughly one
   * district in ten came out with no creamery, no buyer for milk, and an opening
   * that fell through to something else entirely — timber, say, which rides on a
   * cheap flatbed instead of a refrigerated van and puts a second vehicle four
   * minutes away against the twelve the ladder is built on. Nothing about that
   * was visible: the game simply opened easier than it was designed to.
   *
   * Chasing it by re-rolling the map was the wrong answer twice over — I moved
   * the district seed twice before admitting that "the map happens to contain the
   * tutorial" is not a property to leave to chance. If the chain is missing, the
   * buyer is placed.
   */
  {
    const openingId = c.balance.openingCargo;
    const opening = c.cargoIndex.get(openingId) ?? -1;
    const takes = (def: number): boolean =>
      Object.keys(c.industries[def].recipe.inputs).some(
        (k) => c.cargoIndex.get(k) === opening,
      );
    const makes = (def: number): boolean =>
      Object.keys(c.industries[def].recipe.outputs).some(
        (k) => c.cargoIndex.get(k) === opening,
      );
    let haveBuyer = false;
    let seller = -1;
    for (let s = 0; s < w.sites.count; s++) {
      if (takes(w.sites.def[s])) haveBuyer = true;
      if (seller < 0 && makes(w.sites.def[s])) seller = s;
    }
    if (opening >= 0 && seller >= 0 && !haveBuyer) {
      const def = c.industries.findIndex((ind, i) => ind.fromEra <= 1 && takes(i));
      if (def >= 0) {
        /*
         * By the town nearest whoever produces it, so the opening job is a drive
         * through the district rather than across it — `planOpening` scores on
         * distance and a buyer parked at the far end would be a worse first job
         * than no buyer at all.
         */
        let best = 0;
        let bestD = Infinity;
        for (let tn = 0; tn < w.towns.count; tn++) {
          const dx = w.towns.x[tn] - w.sites.x[seller];
          const dy = w.towns.y[tn] - w.sites.y[seller];
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = tn; }
        }
        const spot = findSiteSpot(t, w.towns.x[best], w.towns.y[best], 4, 13, w);
        if (spot) w.sites.alloc(def, spot[0], spot[1], t.idx(spot[0], spot[1]), AUTHORITY);
      }
    }
  }

  /*
   * ---- what is actually growing in the fields -----------------------------
   *
   * The field generator divides the whole district into parcels and then picks
   * each one's crop from its slope and a coin toss. That is why the landscape
   * read as noise: "there's loads of fields, but there's nothing in the fields
   * — they don't look like real farms". Arable and pasture alternated at random,
   * so no farm had a holding, no holding had a character, and the pattern
   * carried no information at all.
   *
   * A field belongs to a farm. So: find the nearest farm to each parcel, take
   * the crop from what that farm *does*, and vary it within the holding rather
   * than across the district. A dairy is surrounded by grass because that is
   * what cows eat; an arable farm has wheat and ploughed ground around it in
   * strips; and anything more than a long walk from any farm is not enclosed at
   * all, which is what leaves the hills open and gives the woods somewhere to
   * be.
   *
   * Done here rather than in `fields.ts` because the terrain is generated before
   * the farms are placed, and the alternative — deferring field generation until
   * after site placement — would put the roads, which read parcels for their
   * boundary preference, on the wrong side of it.
   */
  {
    const fields = w.terrain.fields;
    const size = w.config.size;
    const grass = [Crop.Pasture, Crop.PastureRich, Crop.Meadow];
    const arable = [Crop.Wheat, Crop.WheatRipe, Crop.Plough];

    // Farms, and which sort each one is. `outputs` rather than the id, so a
    // content author adding a second kind of dairy gets grass round it for free.
    const farms: { x: number; y: number; grazing: boolean }[] = [];
    for (let i = 0; i < w.sites.count; i++) {
      const ind = c.industries[w.sites.def[i]];
      if (ind.deposit !== Deposit.Farm) continue;
      const outs = Object.keys(ind.recipe.outputs);
      farms.push({
        x: w.sites.x[i],
        y: w.sites.y[i],
        grazing: outs.includes('milk') || outs.includes('livestock'),
      });
    }

    // Parcel centroids, in one pass over the map.
    const n = fields.count;
    const sumX = new Float64Array(n);
    const sumY = new Float64Array(n);
    const tally = new Int32Array(n);
    // What the field generator decided, before this pass has an opinion. Only
    // the woods are read back out of it — see below.
    const firstCrop = new Int32Array(n).fill(-1);
    for (let t = 0; t < size * size; t++) {
      const p2 = fields.parcel[t];
      if (p2 < 0 || p2 >= n) continue;
      sumX[p2] += t % size;
      sumY[p2] += (t / size) | 0;
      tally[p2]++;
      firstCrop[p2] = fields.crop[t];
    }

    /** Beyond this, nobody is farming it. Twenty tiles is a long walk with a
     *  herd, and it is what keeps the high ground open. */
    const REACH = 20;
    const cropOf = new Int32Array(n).fill(-1);
    for (let p2 = 0; p2 < n; p2++) {
      if (tally[p2] === 0) continue;
      const cx2 = sumX[p2] / tally[p2];
      const cy2 = sumY[p2] / tally[p2];
      let nearest = -1;
      let bestD = Infinity;
      for (let f = 0; f < farms.length; f++) {
        const d = Math.hypot(farms[f].x - cx2, farms[f].y - cy2);
        if (d < bestD) { bestD = d; nearest = f; }
      }
      /*
       * A wood keeps what it was given, near a farm or far from one.
       *
       * This pass decides land use from the nearest farm, and it runs *after* the
       * field generator — so whatever it does not explicitly preserve, it
       * overwrites. That is where the woodland went the first time: the generator
       * planted the steep parcels, every one of them was then either handed to a
       * farm and turned back into wheat or put out of reach and flattened to
       * rough, and the crop histogram came out with no trees in it at all. No
       * error anywhere. Both passes were doing exactly what they said.
       *
       * Slope is the argument for a wood, and this pass cannot see slope. So the
       * generator's verdict stands: a farm with a wood on the hill above it
       * simply has a wood on the hill above it, which is most English farms.
       */
      if (isWood(firstCrop[p2])) { cropOf[p2] = firstCrop[p2]; continue; }
      if (nearest < 0 || bestD > REACH) continue;
      /*
       * Variation *within* the holding, keyed off the parcel id.
       *
       * A farm whose every field is the same green is a lawn. Keying on the id
       * rather than the rng means the pattern is stable and that neighbouring
       * parcels differ, which is what gives a holding the patchwork look — and
       * the ploughed field next to the wheat is the same farm's next rotation,
       * which is why they belong together.
       */
      const list = farms[nearest].grazing ? grass : arable;
      cropOf[p2] = list[(p2 * 2654435761) % list.length];
    }

    let unenclosed = 0;
    for (let t = 0; t < size * size; t++) {
      const p2 = fields.parcel[t];
      if (p2 < 0 || p2 >= n) continue;
      if (cropOf[p2] < 0) {
        // Out of reach of any farm: take the hedges away and let it be country.
        fields.parcel[t] = -1;
        fields.crop[t] = Crop.Rough;
        unenclosed++;
        continue;
      }
      fields.crop[t] = cropOf[p2];
    }
    void unenclosed;
  }

  // ---- stock capacities --------------------------------------------------
  const cargoCount = c.cargo.length;
  for (let s = 0; s < w.sites.count; s++) {
    const ind = c.industries[w.sites.def[s]];
    // Whether it digs its output out of the ground or makes it from something
    // somebody has to bring. Cached here so the hot paths need not ask.
    w.sites.extraction[s] = ind.kind === 'extraction' ? 1 : 0;
    // Everything the region starts with was built before the game begins, and
    // is therefore already a little old in 1860 rather than brand new.
    w.sites.built[s] = 1860 - 10;
    for (const [id, amount] of Object.entries(ind.recipe.inputs)) {
      const ci = c.cargoIndex.get(id);
      if (ci !== undefined) w.sites.capacity[s * cargoCount + ci] = amount * 30;
    }
    for (const [id, amount] of Object.entries(ind.recipe.outputs)) {
      const ci = c.cargoIndex.get(id);
      if (ci === undefined) continue;
      // Output capacity is the pressure valve: a yard that fills is the signal
      // the player is not collecting, and satisfaction is measured from it.
      w.sites.capacity[s * cargoCount + ci] = amount * 40;
    }
    w.sites.cycle[s] = 1 + w.rng.int(ind.recipe.period);
    // Processing sites need a starting stock or nothing moves for a fortnight
    // while the first extraction cycles complete, which reads as a dead map.
    if (ind.kind !== 'extraction') {
      for (const [id, amount] of Object.entries(ind.recipe.inputs)) {
        const ci = c.cargoIndex.get(id);
        if (ci !== undefined) w.sites.addStock(s, ci, amount * 6);
      }
    } else {
      for (const [id, amount] of Object.entries(ind.recipe.outputs)) {
        const ci = c.cargoIndex.get(id);
        if (ci !== undefined) w.sites.addStock(s, ci, amount * 8);
      }
    }
  }

  // ---- the authority's roads --------------------------------------------
  /*
   * The roads, with a hierarchy. roadnet.ts.
   *
   * The old builder was a minimum spanning tree over the towns plus a few extra
   * edges, connected by breadth-first search to whatever road tile was nearest.
   * It produced a wandering, undifferentiated web - a spine, a lane and a farm
   * track were all the same thing - and that, rather than density, is what made
   * the district read as a spiderweb.
   */
  {
    const layer = w.layers[Mode.Road];
    const settlements: { x: number; y: number; weight: number }[] = [];
    for (let i = 0; i < w.towns.count; i++) {
      settlements.push({ x: w.towns.x[i], y: w.towns.y[i], weight: w.towns.population[i] });
    }
    const sites: { x: number; y: number; weight: number }[] = [];
    for (let i = 0; i < w.sites.count; i++) {
      sites.push({ x: w.sites.x[i], y: w.sites.y[i], weight: 1 });
    }
    const idx = (id: string): number => w.content.wayIndex.get(id) ?? 0;
    const byTier = [idx('road'), idx('lane'), idx('track')];
    generateRoads(
      {
        size: w.config.size,
        height: w.terrain.height,
        isWater: (t: number): boolean => w.terrain.height[t] <= SEA_LEVEL,
        parcel: w.terrain.fields.parcel,
        classOf: (tier: number): number => byTier[tier] ?? byTier[1],
        cls: layer.cls,
      },
      settlements, sites,
    );

    /*
     * Count the tiles, because the graph builder skips a layer that says it has
     * none.
     *
     * `tileCount` is a cached total that `layWay` used to maintain as it went.
     * Writing `cls` directly left it at zero, and `rebuildGraph` takes a zero
     * as "nothing on this layer" and skips it entirely — so three hundred and
     * twenty-one road tiles produced no graph at all. A cached count that only
     * one code path maintains is a trap, and this is the second thing in this
     * file to fall into it after the direction bits.
     */
    let laid = 0;
    for (let i = 0; i < w.config.size * w.config.size; i++) {
      if (layer.cls[i] !== 255) laid++;
    }
    layer.tileCount = laid;

    /*
     * Wire the direction bits.
     *
     * The graph traces a link by walking `dir` from tile to tile, so a layer
     * with classes but no directions has no links, no nodes, and therefore no
     * network at all — which is exactly what a probe showed: 321 road tiles and
     * zero graph nodes. The old `layWay` set these as it went; the new
     * generator decides *where* the road is and this decides what is joined to
     * what, which is a cleaner split but only if both halves happen.
     */
    for (let y = 0; y < w.config.size; y++) {
      for (let x = 0; x < w.config.size; x++) {
        const tile = y * w.config.size + x;
        if (layer.cls[tile] === 255) continue;
        let bits = 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DIR_DX[d];
          const ny = y + DIR_DY[d];
          if (nx < 0 || ny < 0 || nx >= w.config.size || ny >= w.config.size) continue;
          if (layer.cls[ny * w.config.size + nx] !== 255) bits |= DIR_BIT[d];
        }
        layer.dir[tile] = bits;
      }
    }

    /*
     * Attach every site and settlement to the road at its own tile.
     *
     * The old road builder did this as a side effect of connecting each place
     * up, and losing it was invisible until a probe showed *no site connected
     * to anything* — no access tile, no graph node, no possible delivery. The
     * whole game rests on this line, so it is now explicit rather than a
     * consequence of something else.
     *
     * `rebuild()` turns an access tile into a terminal and therefore into a
     * graph node, which is what makes a place somewhere a vehicle can stop.
     */
    for (let i = 0; i < w.sites.count; i++) {
      const tile = w.sites.y[i] * w.config.size + w.sites.x[i];
      if (layer.cls[tile] !== 255) w.siteAccessTile[i] = tile;
    }
    for (let i = 0; i < w.towns.count; i++) {
      const tile = w.towns.y[i] * w.config.size + w.towns.x[i];
      if (layer.cls[tile] !== 255) w.townAccessTile[i] = tile;
    }
  }

  w.rebuild();
  /*
   * And the land register last of all.
   *
   * Everything above can still move a field: crops are assigned from the farms
   * placed in this pass, and adjacent woods are merged into single parcels. A
   * register built before this holds tile lists for fields that no longer exist.
   */
  w.settleLand();

}

function nearestLand(t: Terrain, x: number, y: number, radius: number): [number, number] | null {
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (t.isLand(nx, ny) && (t.flags[t.idx(nx, ny)] & TileFlag.Buildable) !== 0) return [nx, ny];
      }
    }
  }
  return null;
}

/** The order a site tries its neighbours in when its own tile will not do.
 *  Fixed, so the search is deterministic and costs no random draws. */
const NUDGE_X = [1, -1, 0, 0, 1, 1, -1, -1];
const NUDGE_Y = [0, 0, 1, -1, 1, -1, 1, -1];

/** Buildable ground in an annulus around a town, avoiding anything already
 *  occupied so two industries do not land on the same tile. */
function findSiteSpot(
  t: Terrain, cx: number, cy: number, min: number, max: number, w: World,
): [number, number] | null {
  const taken = new Set<number>();
  for (let s = 0; s < w.sites.count; s++) taken.add(w.sites.tile[s]);
  for (let tries = 0; tries < 160; tries++) {
    const r = min + w.rng.int(max - min + 1);
    const a = w.rng.int(4096);
    const dx = Math.round((r * Math.cos((a / 4096) * Math.PI * 2)));
    const dy = Math.round((r * Math.sin((a / 4096) * Math.PI * 2)));
    let x = cx + dx;
    let y = cy + dy;
    if (!t.inBounds(x, y) || !t.isLand(x, y)) continue;
    // Never on an island, or the track to it can never be laid and the business
    // exists without ever being connected to anything.
    if ((t.flags[t.idx(x, y)] & TileFlag.Mainland) === 0) continue;
    /*
     * Step off the water rather than give up on the spot.
     *
     * Watercourses stopped being buildable ground, which is right — a creamery
     * standing in a beck is not a creamery. But this loop treated an unbuildable
     * tile as a dead draw and moved on, so a district with proper drainage lost
     * the industries whose annulus happened to cross a stream: seed 1985 lost its
     * creamery, its brewery and both mills, and with the creamery gone there was
     * no buyer for milk and the opening job fell through to something else
     * entirely.
     *
     * A yard beside the water is what was wanted anyway — half the mills in
     * England are on one. So a tile that fails takes the nearest neighbour that
     * passes, in a fixed order, which costs no random draws at all: important,
     * because consuming a different number of them would reshuffle every later
     * decision in the district and make this impossible to measure.
     */
    let tile = t.idx(x, y);
    if ((t.flags[tile] & TileFlag.Buildable) === 0) {
      let moved = false;
      for (let d = 0; d < 8 && !moved; d++) {
        const nx = x + NUDGE_X[d];
        const ny = y + NUDGE_Y[d];
        if (!t.inBounds(nx, ny) || !t.isLand(nx, ny)) continue;
        const nt = t.idx(nx, ny);
        if ((t.flags[nt] & (TileFlag.Buildable | TileFlag.Mainland))
          !== (TileFlag.Buildable | TileFlag.Mainland)) continue;
        x = nx;
        y = ny;
        tile = nt;
        moved = true;
      }
      if (!moved) continue;
    }
    if (taken.has(tile)) continue;
    let clear = true;
    for (const other of taken) {
      const ox = other % t.size;
      const oy = (other / t.size) | 0;
      if (Math.abs(ox - x) < 3 && Math.abs(oy - y) < 3) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    return [x, y];
  }
  return null;
}




/**
 * Lay a way along a path of tiles, creating one asset for the whole run.
 *
 * The asset is the unit of ownership (network.ts), so "one act of
 * construction, one asset" is the rule that makes buying a road mean buying
 * the road rather than buying an arbitrary chain between two junctions.
 */
export function layWay(
  w: World,
  layer: import('./network.ts').WayLayer,
  path: Int32Array | number[],
  cls: number,
  owner: number,
  charge: number,
  buildCostPerTile: number,
): number {
  const size = w.terrain.size;
  const asset = w.assets.alloc(layer.mode, cls, owner, charge, w.tick);
  let laid = 0;
  for (let i = 0; i < path.length; i++) {
    const tile = path[i];
    if (layer.cls[tile] === 255) {
      layer.cls[tile] = cls;
      layer.asset[tile] = asset;
      layer.tileCount++;
      laid++;
    } else if (w.content.ways[cls].buildCost > w.content.ways[layer.cls[tile]].buildCost) {
      // Upgrading in place keeps the existing owner: you cannot acquire a
      // rival's road by resurfacing it.
      layer.cls[tile] = cls;
    }
    if (i + 1 < path.length) {
      const a = path[i];
      const b = path[i + 1];
      const dx = (b % size) - (a % size);
      const dy = ((b / size) | 0) - ((a / size) | 0);
      let d = -1;
      for (let k = 0; k < 4; k++) if (DIR_DX[k] === dx && DIR_DY[k] === dy) d = k;
      if (d >= 0) {
        layer.dir[a] |= DIR_BIT[d];
        layer.dir[b] |= DIR_BIT[DIR_OPPOSITE[d]];
      }
    }
  }
  w.assets.tiles[asset] = laid;
  w.assets.buildCost[asset] = laid * buildCostPerTile;
  if (laid === 0) {
    // Nothing new was laid — the run was entirely over existing road. Drop the
    // empty asset back so the ownership list is not full of phantoms.
    w.assets.count--;
    return NONE;
  }
  return asset;
}

export { SiteState, SEA_LEVEL };
