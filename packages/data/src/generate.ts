/**
 * Content generator. Emits the JSON under `content/`, which is the shipped and
 * hot-reloadable artefact; this file is how it stays consistent.
 *
 * The art pipeline's argument is that a model which is a program can be
 * parameterised across eight decades of bodywork, and the same argument
 * applies to the stat line underneath it. A roster hand-authored as sixty
 * literals drifts: era 4 gets a capacity bump era 5 never got, and nobody
 * notices until the balance sweep says era 5 rail is dead content. Written as
 * a curve with named exceptions, the progression is inspectable.
 *
 *   node packages/data/src/generate.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateBundle } from './schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'content');

const P = (pounds: number): number => Math.round(pounds * 100);
const SPEED = (tilesPerTick: number): number => Math.round(tilesPerTick * 65536);

// ------------------------------------------------------------------ cargo

interface CargoSpec {
  id: string;
  name: string;
  tier: string;
  handling: string;
  density: number;
  basePrice: number;
  colour: string;
  fromEra?: number;
  perishability?: number;
}

const cargo: CargoSpec[] = [
  // extraction — the bottom of every chain
  { id: 'coal', name: 'Coal', tier: 'extraction', handling: 'bulk', density: 80, basePrice: P(2.2), colour: '#2f3238' },
  { id: 'iron-ore', name: 'Iron ore', tier: 'extraction', handling: 'bulk', density: 95, basePrice: P(2.8), colour: '#6d4636' },
  { id: 'bauxite', name: 'Bauxite', tier: 'extraction', handling: 'bulk', density: 90, basePrice: P(3.4), colour: '#a06a3c' },
  { id: 'stone', name: 'Stone', tier: 'extraction', handling: 'bulk', density: 100, basePrice: P(1.1), colour: '#8b8880' },
  { id: 'sand', name: 'Sand', tier: 'extraction', handling: 'bulk', density: 85, basePrice: P(1.0), colour: '#cfbd90' },
  { id: 'clay', name: 'Clay', tier: 'extraction', handling: 'bulk', density: 88, basePrice: P(1.3), colour: '#9c7a63' },
  { id: 'timber', name: 'Timber', tier: 'extraction', handling: 'general', density: 40, basePrice: P(2.4), colour: '#6b5334' },
  { id: 'crude-oil', name: 'Crude oil', tier: 'extraction', handling: 'liquid', density: 70, basePrice: P(5.0), colour: '#20211f', fromEra: 3 },
  { id: 'fish', name: 'Fish', tier: 'extraction', handling: 'refrigerated', density: 45, basePrice: P(6.0), colour: '#5f8fa0', perishability: 6 },
  { id: 'grain', name: 'Grain', tier: 'extraction', handling: 'bulk', density: 55, basePrice: P(2.6), colour: '#c9a94e' },
  { id: 'livestock', name: 'Livestock', tier: 'extraction', handling: 'general', density: 30, basePrice: P(7.5), colour: '#8d6c52', perishability: 3 },
  { id: 'lithium', name: 'Lithium', tier: 'extraction', handling: 'bulk', density: 60, basePrice: P(14.0), colour: '#b9c4cc', fromEra: 6 },

  // processing
  { id: 'coke', name: 'Coke', tier: 'processing', handling: 'bulk', density: 60, basePrice: P(4.4), colour: '#4a4a4a' },
  { id: 'steel', name: 'Steel', tier: 'processing', handling: 'general', density: 98, basePrice: P(9.0), colour: '#7d8790' },
  { id: 'aluminium', name: 'Aluminium', tier: 'processing', handling: 'general', density: 45, basePrice: P(13.0), colour: '#a8b2ba', fromEra: 3 },
  { id: 'cement', name: 'Cement', tier: 'processing', handling: 'bulk', density: 92, basePrice: P(3.6), colour: '#b6b3ab' },
  { id: 'planks', name: 'Planks', tier: 'processing', handling: 'general', density: 35, basePrice: P(5.0), colour: '#b08b57' },
  { id: 'paper', name: 'Paper', tier: 'processing', handling: 'general', density: 30, basePrice: P(5.6), colour: '#ddd6c4' },
  { id: 'fuel', name: 'Refined fuel', tier: 'processing', handling: 'liquid', density: 68, basePrice: P(9.5), colour: '#c8a13a', fromEra: 3 },
  { id: 'chemicals', name: 'Chemicals', tier: 'processing', handling: 'hazardous', density: 62, basePrice: P(11.0), colour: '#7fa05a', fromEra: 3 },
  { id: 'food', name: 'Food', tier: 'processing', handling: 'refrigerated', density: 40, basePrice: P(8.0), colour: '#c76b4a', perishability: 2 },
  { id: 'textiles', name: 'Textiles', tier: 'processing', handling: 'general', density: 25, basePrice: P(9.0), colour: '#9b5f7e' },
  { id: 'glass', name: 'Glass', tier: 'processing', handling: 'general', density: 70, basePrice: P(7.0), colour: '#8fb2b8' },
  { id: 'batteries', name: 'Batteries', tier: 'processing', handling: 'general', density: 65, basePrice: P(22.0), colour: '#4f7f6a', fromEra: 7 },

  // terminal — what towns and retail actually want
  { id: 'goods', name: 'Goods', tier: 'terminal', handling: 'general', density: 35, basePrice: P(16.0), colour: '#d08a2e' },
  { id: 'electronics', name: 'Electronics', tier: 'terminal', handling: 'general', density: 20, basePrice: P(34.0), colour: '#4b8fbd', fromEra: 5 },
  { id: 'luxury', name: 'Luxury goods', tier: 'terminal', handling: 'general', density: 18, basePrice: P(52.0), colour: '#b98cc4', fromEra: 4 },
  { id: 'retail', name: 'Retail stock', tier: 'terminal', handling: 'container', density: 28, basePrice: P(20.0), colour: '#e0a04b', fromEra: 5 },

  // passenger class
  { id: 'passengers', name: 'Passengers', tier: 'passenger', handling: 'people', density: 10, basePrice: P(1.4), colour: '#e8b23a' },
  { id: 'mail', name: 'Mail', tier: 'passenger', handling: 'general', density: 15, basePrice: P(12.0), colour: '#d94f4f' },
  { id: 'tourists', name: 'Tourists', tier: 'passenger', handling: 'people', density: 10, basePrice: P(3.2), colour: '#4fbfa8' },

  // networked, not hauled
  { id: 'electricity', name: 'Electricity', tier: 'networked', handling: 'wired', density: 1, basePrice: P(0.9), colour: '#f0d24a' },
  { id: 'water', name: 'Water', tier: 'networked', handling: 'liquid', density: 100, basePrice: P(0.3), colour: '#4a9cd4' },
  { id: 'data', name: 'Data', tier: 'networked', handling: 'wired', density: 1, basePrice: P(2.0), colour: '#9a7fd4', fromEra: 6 },

  // negative — you must remove these
  { id: 'waste', name: 'Waste', tier: 'negative', handling: 'bulk', density: 50, basePrice: P(0.4), colour: '#5a5346', fromEra: 4 },
  { id: 'spoil', name: 'Spoil', tier: 'negative', handling: 'bulk', density: 95, basePrice: P(0.2), colour: '#6a6156' },
];

// --------------------------------------------------------------- vehicles

interface VSpec {
  id: string;
  name: string;
  mode: string;
  class: string;
  era: number;
  cap: number;
  /** tiles per tick */
  spd: number;
  kph: number;
  cost: number;
  run: number;
  handling: string[];
  cells?: number;
  transfer?: number;
  reliability?: number;
  obsolete?: number;
}

/**
 * Road, rail, water and air rosters. Each is a progression in the same three
 * numbers — capacity, speed, running cost — so the balance harness can see
 * whether an era is worth entering. Names and flavour vary; the curve does
 * not, except where it is broken deliberately (the artic in era 4 is a step
 * change in capacity because containerisation is supposed to feel like one).
 */
const vehicles: VSpec[] = [
  // --- road ---------------------------------------------------------------
  { id: 'dray-horse', name: 'Horse dray', mode: 'road', class: 'dray', era: 1, cap: 3, spd: 0.045, kph: 8, cost: P(160), run: P(0.28), handling: ['bulk', 'general'], transfer: 1, reliability: 96, obsolete: 1915 },
  { id: 'dray-heavy', name: 'Heavy dray', mode: 'road', class: 'dray', era: 1, cap: 5, spd: 0.04, kph: 7, cost: P(240), run: P(0.38), handling: ['bulk', 'general'], transfer: 1, reliability: 95, obsolete: 1915 },
  { id: 'wagon-tank', name: 'Tank cart', mode: 'road', class: 'tanker', era: 2, cap: 5, spd: 0.05, kph: 9, cost: P(170), run: P(0.42), handling: ['liquid'], transfer: 2, reliability: 92, obsolete: 1935 },
  { id: 'lorry-steam', name: 'Steam lorry', mode: 'road', class: 'lorry', era: 2, cap: 7, spd: 0.075, kph: 16, cost: P(620), run: P(1.3), handling: ['bulk', 'general'], transfer: 2, reliability: 78, obsolete: 1940 },
  { id: 'lorry-diesel', name: 'Diesel lorry', mode: 'road', class: 'lorry', era: 3, cap: 12, spd: 0.11, kph: 48, cost: P(1900), run: P(2.9), handling: ['bulk', 'general'], transfer: 3, reliability: 88, obsolete: 1975 },
  { id: 'tipper-diesel', name: 'Tipper', mode: 'road', class: 'tipper', era: 3, cap: 15, spd: 0.10, kph: 44, cost: P(2200), run: P(3.2), handling: ['bulk'], transfer: 5, reliability: 87, obsolete: 1985 },
  { id: 'tanker-road', name: 'Road tanker', mode: 'road', class: 'tanker', era: 3, cap: 14, spd: 0.10, kph: 46, cost: P(2600), run: P(3.6), handling: ['liquid', 'hazardous'], transfer: 4, reliability: 86, obsolete: 1990 },
  { id: 'artic-1950', name: 'Articulated lorry', mode: 'road', class: 'artic', era: 4, cap: 26, spd: 0.13, kph: 64, cost: P(4200), run: P(12.0), handling: ['bulk', 'general'], cells: 2, transfer: 5, reliability: 90, obsolete: 2000 },
  { id: 'reefer-1955', name: 'Refrigerated lorry', mode: 'road', class: 'lorry', era: 4, cap: 16, spd: 0.12, kph: 58, cost: P(3800), run: P(13.0), handling: ['refrigerated', 'general'], transfer: 4, reliability: 84, obsolete: 2005 },
  { id: 'artic-box', name: 'Box artic', mode: 'road', class: 'artic', era: 5, cap: 32, spd: 0.145, kph: 78, cost: P(6200), run: P(14.5), handling: ['general', 'container'], cells: 2, transfer: 7, reliability: 93, obsolete: 2030 },
  { id: 'van-parcel', name: 'Parcel van', mode: 'road', class: 'van', era: 6, cap: 5, spd: 0.16, kph: 84, cost: P(2400), run: P(6.5), handling: ['general'], transfer: 4, reliability: 95, obsolete: 2075 },
  { id: 'artic-modern', name: 'Modern artic', mode: 'road', class: 'artic', era: 6, cap: 38, spd: 0.16, kph: 88, cost: P(8600), run: P(16.0), handling: ['general', 'container', 'bulk'], cells: 2, transfer: 9, reliability: 96, obsolete: 2060 },
  { id: 'artic-electric', name: 'Electric artic', mode: 'road', class: 'artic', era: 7, cap: 38, spd: 0.165, kph: 90, cost: P(11000), run: P(9.0), handling: ['general', 'container', 'bulk'], cells: 2, transfer: 9, reliability: 97 },
  { id: 'convoy-auto', name: 'Autonomous convoy', mode: 'road', class: 'artic', era: 8, cap: 52, spd: 0.19, kph: 104, cost: P(16000), run: P(7.5), handling: ['general', 'container', 'bulk'], cells: 3, transfer: 12, reliability: 99 },

  // --- buses and trams ----------------------------------------------------
  { id: 'omnibus', name: 'Horse omnibus', mode: 'road', class: 'bus', era: 1, cap: 18, spd: 0.05, kph: 9, cost: P(150), run: P(0.45), handling: ['people'], transfer: 6, reliability: 94, obsolete: 1920 },
  { id: 'bus-motor', name: 'Motor bus', mode: 'road', class: 'bus', era: 3, cap: 34, spd: 0.105, kph: 44, cost: P(2600), run: P(3.3), handling: ['people'], transfer: 12, reliability: 88, obsolete: 1985 },
  { id: 'coach-express', name: 'Express coach', mode: 'road', class: 'coach', era: 4, cap: 46, spd: 0.14, kph: 72, cost: P(4800), run: P(12.5), handling: ['people'], transfer: 12, reliability: 91, obsolete: 2035 },
  { id: 'bus-modern', name: 'Low-floor bus', mode: 'road', class: 'bus', era: 6, cap: 58, spd: 0.13, kph: 62, cost: P(6400), run: P(11.0), handling: ['people'], transfer: 20, reliability: 96 },
  { id: 'tram-electric', name: 'Electric tram', mode: 'rail', class: 'tram', era: 3, cap: 60, spd: 0.115, kph: 40, cost: P(7200), run: P(3.8), handling: ['people'], cells: 2, transfer: 22, reliability: 93 },
  { id: 'lrv-modern', name: 'Light rail vehicle', mode: 'rail', class: 'tram', era: 6, cap: 110, spd: 0.16, kph: 70, cost: P(15000), run: P(16.0), handling: ['people'], cells: 3, transfer: 34, reliability: 97 },

  // --- rail ---------------------------------------------------------------
  { id: 'loco-early-steam', name: 'Early steam locomotive', mode: 'rail', class: 'loco', era: 1, cap: 26, spd: 0.085, kph: 32, cost: P(1900), run: P(2.6), handling: ['bulk', 'general'], cells: 4, transfer: 6, reliability: 72, obsolete: 1905 },
  { id: 'loco-mainline-steam', name: 'Mainline steam', mode: 'rail', class: 'loco', era: 2, cap: 52, spd: 0.13, kph: 60, cost: P(5200), run: P(5.0), handling: ['bulk', 'general'], cells: 6, transfer: 9, reliability: 80, obsolete: 1968 },
  { id: 'railcar-steam', name: 'Steam railcar', mode: 'rail', class: 'unit', era: 2, cap: 64, spd: 0.12, kph: 54, cost: P(3600), run: P(3.2), handling: ['people', 'general'], cells: 3, transfer: 24, reliability: 79, obsolete: 1955 },
  { id: 'loco-diesel', name: 'Diesel-electric', mode: 'rail', class: 'loco', era: 3, cap: 78, spd: 0.20, kph: 120, cost: P(14000), run: P(9.0), handling: ['bulk', 'general', 'liquid'], cells: 7, transfer: 12, reliability: 90, obsolete: 2005 },
  { id: 'loco-freight-heavy', name: 'Heavy freight loco', mode: 'rail', class: 'loco', era: 4, cap: 120, spd: 0.18, kph: 104, cost: P(21000), run: P(28.0), handling: ['bulk', 'general'], cells: 10, transfer: 16, reliability: 91, obsolete: 2040 },
  { id: 'dmu-commuter', name: 'Diesel multiple unit', mode: 'rail', class: 'unit', era: 4, cap: 180, spd: 0.22, kph: 130, cost: P(18000), run: P(21.0), handling: ['people'], cells: 4, transfer: 60, reliability: 93, obsolete: 2045 },
  { id: 'loco-electric', name: 'Electric locomotive', mode: 'rail', class: 'loco', era: 5, cap: 140, spd: 0.26, kph: 160, cost: P(28000), run: P(24.0), handling: ['bulk', 'general', 'container'], cells: 10, transfer: 18, reliability: 95 },
  { id: 'emu-commuter', name: 'Electric multiple unit', mode: 'rail', class: 'unit', era: 5, cap: 240, spd: 0.28, kph: 175, cost: P(26000), run: P(23.0), handling: ['people'], cells: 5, transfer: 80, reliability: 96 },
  { id: 'hs-set', name: 'High-speed set', mode: 'rail', class: 'unit', era: 6, cap: 300, spd: 0.40, kph: 300, cost: P(58000), run: P(44.0), handling: ['people'], cells: 6, transfer: 90, reliability: 97 },
  { id: 'loco-hydrogen', name: 'Hydrogen locomotive', mode: 'rail', class: 'loco', era: 7, cap: 150, spd: 0.26, kph: 160, cost: P(34000), run: P(17.0), handling: ['bulk', 'general', 'container'], cells: 10, transfer: 18, reliability: 97 },
  { id: 'maglev-freight', name: 'Maglev freight', mode: 'rail', class: 'loco', era: 8, cap: 220, spd: 0.55, kph: 420, cost: P(96000), run: P(52.0), handling: ['container', 'general'], cells: 8, transfer: 30, reliability: 99 },

  // --- water --------------------------------------------------------------
  { id: 'barge-canal', name: 'Canal barge', mode: 'water', class: 'barge', era: 1, cap: 30, spd: 0.035, kph: 6, cost: P(560), run: P(0.7), handling: ['bulk', 'general'], cells: 2, transfer: 3, reliability: 94 },
  { id: 'steamer-coastal', name: 'Coastal steamer', mode: 'water', class: 'coaster', era: 2, cap: 90, spd: 0.075, kph: 20, cost: P(6200), run: P(4.4), handling: ['bulk', 'general'], cells: 3, transfer: 8, reliability: 84, obsolete: 1965 },
  { id: 'coaster-motor', name: 'Motor coaster', mode: 'water', class: 'coaster', era: 3, cap: 160, spd: 0.09, kph: 24, cost: P(16000), run: P(20.0), handling: ['bulk', 'general', 'liquid'], cells: 4, transfer: 14, reliability: 91 },
  { id: 'bulker', name: 'Bulk carrier', mode: 'water', class: 'bulker', era: 4, cap: 420, spd: 0.10, kph: 27, cost: P(48000), run: P(38.0), handling: ['bulk'], cells: 6, transfer: 26, reliability: 93 },
  { id: 'tanker-sea', name: 'Sea tanker', mode: 'water', class: 'bulker', era: 4, cap: 400, spd: 0.10, kph: 27, cost: P(52000), run: P(40.0), handling: ['liquid', 'hazardous'], cells: 6, transfer: 26, reliability: 92 },
  { id: 'container-ship', name: 'Container ship', mode: 'water', class: 'container-ship', era: 5, cap: 620, spd: 0.125, kph: 34, cost: P(88000), run: P(52.0), handling: ['container', 'general'], cells: 8, transfer: 44, reliability: 95 },
  { id: 'ferry-ro-ro', name: 'Ro-ro ferry', mode: 'water', class: 'ferry', era: 5, cap: 320, spd: 0.13, kph: 36, cost: P(56000), run: P(46.0), handling: ['people', 'general'], cells: 5, transfer: 90, reliability: 95 },
  { id: 'container-ultra', name: 'Ultra-large container ship', mode: 'water', class: 'container-ship', era: 7, cap: 1200, spd: 0.13, kph: 36, cost: P(180000), run: P(88.0), handling: ['container'], cells: 12, transfer: 70, reliability: 97 },

  // --- air ----------------------------------------------------------------
  { id: 'air-light', name: 'Light freighter', mode: 'air', class: 'light-freight', era: 3, cap: 3, spd: 0.42, kph: 220, cost: P(12000), run: P(18.0), handling: ['general'], transfer: 3, reliability: 76, obsolete: 1980 },
  { id: 'air-jet-freight', name: 'Jet freighter', mode: 'air', class: 'airliner', era: 4, cap: 16, spd: 0.72, kph: 780, cost: P(64000), run: P(74.0), handling: ['general', 'refrigerated'], transfer: 8, reliability: 90 },
  { id: 'air-liner', name: 'Airliner', mode: 'air', class: 'airliner', era: 4, cap: 120, spd: 0.75, kph: 800, cost: P(72000), run: P(80.0), handling: ['people', 'general'], transfer: 40, reliability: 92 },
  { id: 'air-widebody', name: 'Wide-body', mode: 'air', class: 'widebody', era: 5, cap: 300, spd: 0.82, kph: 880, cost: P(150000), run: P(120.0), handling: ['people', 'general', 'container'], cells: 2, transfer: 70, reliability: 95 },
  { id: 'air-drone', name: 'Cargo drone', mode: 'air', class: 'drone', era: 8, cap: 2, spd: 0.30, kph: 140, cost: P(3200), run: P(2.4), handling: ['general'], transfer: 2, reliability: 97 },
];

// -------------------------------------------------------------- way classes

const ways = [
  { id: 'track', name: 'Dirt track', mode: 'road', era: 1, speedLimit: SPEED(0.055), lanes: 1, buildCost: P(90), upkeep: P(6), wear: 34, publicCharge: 4, maxGradient: 95, minRadius: 0, colour: '#8a7a5e' },
  { id: 'macadam', name: 'Macadam road', mode: 'road', era: 1, speedLimit: SPEED(0.085), lanes: 1, buildCost: P(260), upkeep: P(14), wear: 18, publicCharge: 7, maxGradient: 80, minRadius: 0, colour: '#9a9086' },
  { id: 'tarmac', name: 'Tarmac road', mode: 'road', era: 3, speedLimit: SPEED(0.14), lanes: 2, buildCost: P(620), upkeep: P(26), wear: 10, publicCharge: 9, maxGradient: 70, minRadius: 1, colour: '#5f6066' },
  { id: 'dual', name: 'Dual carriageway', mode: 'road', era: 4, speedLimit: SPEED(0.18), lanes: 4, buildCost: P(1500), upkeep: P(58), wear: 7, publicCharge: 12, maxGradient: 55, minRadius: 2, colour: '#54555b' },
  { id: 'motorway', name: 'Motorway', mode: 'road', era: 4, speedLimit: SPEED(0.22), lanes: 6, buildCost: P(3200), upkeep: P(110), wear: 5, publicCharge: 16, maxGradient: 45, minRadius: 3, colour: '#4a4b51' },
  { id: 'rail-light', name: 'Light railway', mode: 'rail', era: 1, speedLimit: SPEED(0.10), lanes: 1, buildCost: P(420), upkeep: P(22), wear: 14, publicCharge: 10, maxGradient: 30, minRadius: 2, colour: '#6a5f52' },
  { id: 'rail-standard', name: 'Standard gauge', mode: 'rail', era: 2, speedLimit: SPEED(0.20), lanes: 1, buildCost: P(900), upkeep: P(40), wear: 10, publicCharge: 14, maxGradient: 20, minRadius: 4, colour: '#5c5348' },
  { id: 'rail-double', name: 'Double track', mode: 'rail', era: 2, speedLimit: SPEED(0.22), lanes: 2, buildCost: P(1700), upkeep: P(74), wear: 10, publicCharge: 16, maxGradient: 20, minRadius: 4, colour: '#554d43' },
  { id: 'rail-electric', name: 'Electrified rail', mode: 'rail', era: 5, speedLimit: SPEED(0.30), lanes: 2, buildCost: P(2600), upkeep: P(96), wear: 8, publicCharge: 20, maxGradient: 18, minRadius: 5, colour: '#4e5a5e' },
  { id: 'rail-high-speed', name: 'High-speed line', mode: 'rail', era: 6, speedLimit: SPEED(0.45), lanes: 2, buildCost: P(6400), upkeep: P(200), wear: 6, publicCharge: 34, maxGradient: 12, minRadius: 9, colour: '#495a66' },
  { id: 'canal', name: 'Canal', mode: 'water', era: 1, speedLimit: SPEED(0.045), lanes: 1, buildCost: P(1100), upkeep: P(30), wear: 4, publicCharge: 8, maxGradient: 2, minRadius: 3, colour: '#3f6f8c' },
  { id: 'seaway', name: 'Sea lane', mode: 'water', era: 1, speedLimit: SPEED(0.16), lanes: 4, buildCost: 0, upkeep: 0, wear: 0, publicCharge: 0, maxGradient: 999, minRadius: 0, colour: '#2f5f80' },
  { id: 'airway', name: 'Air corridor', mode: 'air', era: 3, speedLimit: SPEED(1.0), lanes: 8, buildCost: 0, upkeep: 0, wear: 0, publicCharge: 0, maxGradient: 999, minRadius: 0, colour: '#5b7f9c' },
  { id: 'pipeline', name: 'Pipeline', mode: 'pipe', era: 4, speedLimit: SPEED(0.30), lanes: 1, buildCost: P(800), upkeep: P(26), wear: 6, publicCharge: 6, maxGradient: 120, minRadius: 0, colour: '#7d7468' },
  { id: 'transmission', name: 'Transmission line', mode: 'wire', era: 3, speedLimit: SPEED(4.0), lanes: 1, buildCost: P(520), upkeep: P(18), wear: 4, publicCharge: 3, maxGradient: 200, minRadius: 0, colour: '#8d8f96' },
  { id: 'conveyor', name: 'Conveyor', mode: 'conveyor', era: 3, speedLimit: SPEED(0.05), lanes: 1, buildCost: P(340), upkeep: P(20), wear: 20, publicCharge: 2, maxGradient: 140, minRadius: 0, colour: '#7a7060' },
];

// ------------------------------------------------------------- industries

const industries = [
  // --- extraction (deposit index matches Deposit in sim/terrain.ts) --------
  { id: 'colliery', name: 'Colliery', kind: 'extraction', deposit: 1, footprint: 3, kit: 'mine', colour: '#39343a', amenityPenalty: 26, amenityRadius: 10, foundCost: P(24000), powerNeed: 20, waterNeed: 12, labourNeed: 60, recipe: { inputs: {}, outputs: { coal: 6 }, period: 60 } },
  { id: 'ironstone-mine', name: 'Ironstone mine', kind: 'extraction', deposit: 2, footprint: 3, kit: 'mine', colour: '#5e4436', amenityPenalty: 24, amenityRadius: 9, foundCost: P(26000), powerNeed: 22, waterNeed: 14, labourNeed: 55, recipe: { inputs: {}, outputs: { 'iron-ore': 5 }, period: 60 } },
  { id: 'bauxite-pit', name: 'Bauxite pit', kind: 'extraction', deposit: 6, footprint: 3, kit: 'pit', colour: '#8f5f34', amenityPenalty: 34, amenityRadius: 13, foundCost: P(30000), powerNeed: 24, waterNeed: 30, labourNeed: 50, recipe: { inputs: {}, outputs: { bauxite: 5 }, period: 66 } },
  { id: 'quarry', name: 'Quarry', kind: 'extraction', deposit: 3, footprint: 3, kit: 'pit', colour: '#807d76', amenityPenalty: 28, amenityRadius: 11, foundCost: P(18000), powerNeed: 14, waterNeed: 8, labourNeed: 35, recipe: { inputs: {}, outputs: { stone: 8, spoil: 2 }, period: 54 } },
  { id: 'sand-pit', name: 'Sand pit', kind: 'extraction', deposit: 10, footprint: 2, kit: 'pit', colour: '#c2ac7d', amenityPenalty: 18, amenityRadius: 8, foundCost: P(12000), powerNeed: 8, waterNeed: 6, labourNeed: 22, recipe: { inputs: {}, outputs: { sand: 7 }, period: 54 } },
  { id: 'clay-pit', name: 'Clay pit', kind: 'extraction', deposit: 5, footprint: 2, kit: 'pit', colour: '#8b6b55', amenityPenalty: 16, amenityRadius: 7, foundCost: P(11000), powerNeed: 8, waterNeed: 14, labourNeed: 22, recipe: { inputs: {}, outputs: { clay: 6 }, period: 56 } },
  { id: 'forestry', name: 'Forestry', kind: 'extraction', deposit: 4, footprint: 3, kit: 'yard', colour: '#5c4a2e', amenityPenalty: 12, amenityRadius: 8, foundCost: P(9000), powerNeed: 6, waterNeed: 4, labourNeed: 26, recipe: { inputs: {}, outputs: { timber: 6 }, period: 62 } },
  { id: 'farm', name: 'Farm', kind: 'extraction', deposit: 9, footprint: 4, kit: 'farm', colour: '#a08f4e', amenityPenalty: 0, amenityRadius: 0, foundCost: P(7000), powerNeed: 4, waterNeed: 26, labourNeed: 20, recipe: { inputs: {}, outputs: { grain: 5, livestock: 2 }, period: 70 } },
  { id: 'fishery', name: 'Fishery', kind: 'extraction', deposit: 8, footprint: 2, kit: 'wharf', colour: '#4f7d8c', amenityPenalty: 4, amenityRadius: 3, foundCost: P(9000), powerNeed: 6, waterNeed: 4, labourNeed: 24, recipe: { inputs: {}, outputs: { fish: 4 }, period: 64 } },
  { id: 'oil-rig', name: 'Oil platform', kind: 'extraction', deposit: 7, footprint: 2, kit: 'rig', colour: '#3a3a34', fromEra: 3, amenityPenalty: 22, amenityRadius: 12, foundCost: P(72000), powerNeed: 40, waterNeed: 10, labourNeed: 40, recipe: { inputs: {}, outputs: { 'crude-oil': 6 }, period: 58 } },
  { id: 'lithium-works', name: 'Lithium works', kind: 'extraction', deposit: 11, footprint: 3, kit: 'pit', colour: '#8f9aa2', fromEra: 6, amenityPenalty: 30, amenityRadius: 12, foundCost: P(90000), powerNeed: 60, waterNeed: 70, labourNeed: 45, recipe: { inputs: {}, outputs: { lithium: 3 }, period: 74 } },

  // --- processing ---------------------------------------------------------
  { id: 'coking-plant', name: 'Coking plant', kind: 'processing', footprint: 3, kit: 'works', colour: '#4b4640', amenityPenalty: 30, amenityRadius: 11, foundCost: P(38000), powerNeed: 30, waterNeed: 34, labourNeed: 45, recipe: { inputs: { coal: 6 }, outputs: { coke: 4 }, period: 58 } },
  { id: 'gasworks', name: 'Gasworks', kind: 'processing', footprint: 3, kit: 'works', colour: '#59544a', amenityPenalty: 24, amenityRadius: 9, foundCost: P(30000), powerNeed: 18, waterNeed: 28, labourNeed: 34, recipe: { inputs: { coal: 5 }, outputs: { chemicals: 2, coke: 1 }, period: 62 } },
  { id: 'steelworks', name: 'Steelworks', kind: 'processing', footprint: 4, kit: 'works', colour: '#6d747c', amenityPenalty: 42, amenityRadius: 16, foundCost: P(86000), powerNeed: 70, waterNeed: 60, labourNeed: 90, recipe: { inputs: { coke: 4, 'iron-ore': 6 }, outputs: { steel: 5, spoil: 2 }, period: 64 } },
  { id: 'smelter', name: 'Aluminium smelter', kind: 'processing', footprint: 4, kit: 'works', colour: '#95a0a8', fromEra: 3, amenityPenalty: 38, amenityRadius: 15, foundCost: P(98000), powerNeed: 140, waterNeed: 70, labourNeed: 70, recipe: { inputs: { bauxite: 6 }, outputs: { aluminium: 3 }, period: 66 } },
  { id: 'cement-works', name: 'Cement works', kind: 'processing', footprint: 3, kit: 'works', colour: '#a9a69e', amenityPenalty: 34, amenityRadius: 13, foundCost: P(44000), powerNeed: 44, waterNeed: 30, labourNeed: 40, recipe: { inputs: { stone: 6, clay: 2 }, outputs: { cement: 5 }, period: 60 } },
  { id: 'sawmill', name: 'Sawmill', kind: 'processing', footprint: 3, kit: 'yard', colour: '#9c7b4c', amenityPenalty: 14, amenityRadius: 7, foundCost: P(16000), powerNeed: 20, waterNeed: 12, labourNeed: 30, recipe: { inputs: { timber: 6 }, outputs: { planks: 4 }, period: 56 } },
  { id: 'paper-mill', name: 'Paper mill', kind: 'processing', footprint: 3, kit: 'works', colour: '#c6bfab', amenityPenalty: 26, amenityRadius: 11, foundCost: P(40000), powerNeed: 40, waterNeed: 80, labourNeed: 42, recipe: { inputs: { timber: 5 }, outputs: { paper: 4 }, period: 60 } },
  { id: 'refinery', name: 'Refinery', kind: 'processing', footprint: 4, kit: 'works', colour: '#b4923a', fromEra: 3, amenityPenalty: 40, amenityRadius: 16, foundCost: P(110000), powerNeed: 80, waterNeed: 90, labourNeed: 70, recipe: { inputs: { 'crude-oil': 8 }, outputs: { fuel: 5, chemicals: 2 }, period: 60 } },
  { id: 'brickworks', name: 'Brickworks', kind: 'processing', footprint: 2, kit: 'works', colour: '#9e6146', amenityPenalty: 20, amenityRadius: 8, foundCost: P(18000), powerNeed: 18, waterNeed: 16, labourNeed: 26, recipe: { inputs: { clay: 5 }, outputs: { cement: 3 }, period: 58 } },
  { id: 'glassworks', name: 'Glassworks', kind: 'processing', footprint: 3, kit: 'works', colour: '#7fa0a6', amenityPenalty: 22, amenityRadius: 9, foundCost: P(34000), powerNeed: 40, waterNeed: 24, labourNeed: 34, recipe: { inputs: { sand: 5, coal: 2 }, outputs: { glass: 4 }, period: 58 } },
  { id: 'food-works', name: 'Food processing', kind: 'processing', footprint: 3, kit: 'works', colour: '#b3634a', amenityPenalty: 12, amenityRadius: 6, foundCost: P(28000), powerNeed: 26, waterNeed: 44, labourNeed: 48, recipe: { inputs: { grain: 4, livestock: 2, fish: 2 }, outputs: { food: 5, waste: 1 }, period: 56 } },
  { id: 'mill-textile', name: 'Textile mill', kind: 'processing', footprint: 3, kit: 'works', colour: '#8b5771', amenityPenalty: 18, amenityRadius: 8, foundCost: P(26000), powerNeed: 30, waterNeed: 50, labourNeed: 70, recipe: { inputs: { coal: 3, grain: 1 }, outputs: { textiles: 3 }, period: 62 } },
  { id: 'factory', name: 'Factory', kind: 'processing', footprint: 4, kit: 'works', colour: '#b8862e', amenityPenalty: 26, amenityRadius: 11, foundCost: P(56000), powerNeed: 60, waterNeed: 40, labourNeed: 90, recipe: { inputs: { steel: 3, chemicals: 2, planks: 1 }, outputs: { goods: 4, waste: 1 }, period: 58 } },
  { id: 'electronics-plant', name: 'Electronics plant', kind: 'processing', footprint: 3, kit: 'works', colour: '#3f7ea6', fromEra: 5, amenityPenalty: 14, amenityRadius: 7, foundCost: P(120000), powerNeed: 90, waterNeed: 60, labourNeed: 110, recipe: { inputs: { aluminium: 2, glass: 2, chemicals: 1 }, outputs: { electronics: 3, waste: 1 }, period: 58 } },
  { id: 'vehicle-plant', name: 'Vehicle plant', kind: 'processing', footprint: 4, kit: 'works', colour: '#8a7a3e', fromEra: 5, amenityPenalty: 24, amenityRadius: 11, foundCost: P(160000), powerNeed: 110, waterNeed: 70, labourNeed: 160, recipe: { inputs: { steel: 4, aluminium: 2, electronics: 1 }, outputs: { luxury: 2, goods: 3 }, period: 62 } },
  { id: 'battery-plant', name: 'Battery plant', kind: 'processing', footprint: 3, kit: 'works', colour: '#43705f', fromEra: 7, amenityPenalty: 20, amenityRadius: 10, foundCost: P(180000), powerNeed: 140, waterNeed: 90, labourNeed: 100, recipe: { inputs: { lithium: 3, chemicals: 2 }, outputs: { batteries: 3 }, period: 60 } },
  { id: 'recycling', name: 'Recycling plant', kind: 'processing', footprint: 3, kit: 'works', colour: '#5f7a52', fromEra: 7, amenityPenalty: 10, amenityRadius: 6, foundCost: P(90000), powerNeed: 70, waterNeed: 50, labourNeed: 60, recipe: { inputs: { waste: 6 }, outputs: { steel: 1, glass: 1, goods: 1 }, period: 60 } },

  // --- utility ------------------------------------------------------------
  { id: 'power-coal', name: 'Coal power station', kind: 'utility', footprint: 4, kit: 'power', colour: '#4a4740', amenityPenalty: 44, amenityRadius: 18, foundCost: P(140000), waterNeed: 120, labourNeed: 60, recipe: { inputs: { coal: 8 }, outputs: { electricity: 200 }, period: 40 } },
  { id: 'power-hydro', name: 'Hydro station', kind: 'utility', footprint: 3, kit: 'power', colour: '#4a7a94', amenityPenalty: 12, amenityRadius: 8, foundCost: P(190000), labourNeed: 30, recipe: { inputs: {}, outputs: { electricity: 120 }, period: 40 } },
  { id: 'power-gas', name: 'Gas turbine station', kind: 'utility', footprint: 3, kit: 'power', colour: '#6b6a5c', fromEra: 5, amenityPenalty: 26, amenityRadius: 12, foundCost: P(150000), waterNeed: 60, labourNeed: 40, recipe: { inputs: { fuel: 5 }, outputs: { electricity: 180 }, period: 40 } },
  { id: 'power-nuclear', name: 'Nuclear station', kind: 'utility', footprint: 5, kit: 'power', colour: '#7d8f92', fromEra: 5, amenityPenalty: 30, amenityRadius: 20, foundCost: P(420000), waterNeed: 200, labourNeed: 120, recipe: { inputs: {}, outputs: { electricity: 480 }, period: 40 } },
  { id: 'power-wind', name: 'Wind farm', kind: 'utility', footprint: 4, kit: 'wind', colour: '#c3c8cc', fromEra: 6, amenityPenalty: 8, amenityRadius: 10, foundCost: P(120000), labourNeed: 12, recipe: { inputs: {}, outputs: { electricity: 90 }, period: 40 } },
  { id: 'power-solar', name: 'Solar farm', kind: 'utility', footprint: 5, kit: 'solar', colour: '#3f4a5c', fromEra: 7, amenityPenalty: 6, amenityRadius: 6, foundCost: P(110000), labourNeed: 10, recipe: { inputs: {}, outputs: { electricity: 70 }, period: 40 } },
  { id: 'grid-storage', name: 'Grid storage', kind: 'utility', footprint: 2, kit: 'power', colour: '#4f6f6a', fromEra: 7, amenityPenalty: 4, amenityRadius: 4, foundCost: P(140000), labourNeed: 8, recipe: { inputs: { batteries: 1 }, outputs: { electricity: 60 }, period: 40 } },
  { id: 'reservoir', name: 'Reservoir', kind: 'utility', footprint: 5, kit: 'water', colour: '#3f7fa8', amenityPenalty: 0, amenityRadius: 0, foundCost: P(90000), labourNeed: 14, recipe: { inputs: {}, outputs: { water: 200 }, period: 40 } },
  { id: 'treatment-works', name: 'Water treatment', kind: 'utility', footprint: 3, kit: 'water', colour: '#5f8f9c', amenityPenalty: 10, amenityRadius: 6, foundCost: P(60000), powerNeed: 40, labourNeed: 24, recipe: { inputs: {}, outputs: { water: 140 }, period: 40 } },
  { id: 'desalination', name: 'Desalination plant', kind: 'utility', footprint: 3, kit: 'water', colour: '#6fa0b0', fromEra: 7, amenityPenalty: 14, amenityRadius: 8, foundCost: P(200000), powerNeed: 160, labourNeed: 30, recipe: { inputs: {}, outputs: { water: 220 }, period: 40 } },

  // --- terminal and tourism ----------------------------------------------
  { id: 'builders-merchant', name: "Builders' merchant", kind: 'terminal', footprint: 2, kit: 'shed', colour: '#9c9384', amenityPenalty: 6, amenityRadius: 4, foundCost: P(22000), powerNeed: 12, waterNeed: 10, labourNeed: 30, recipe: { inputs: { cement: 4, planks: 3, glass: 2 }, outputs: {}, period: 52 } },
  { id: 'warehouse', name: 'Wholesale warehouse', kind: 'terminal', footprint: 3, kit: 'shed', colour: '#a89670', amenityPenalty: 8, amenityRadius: 4, foundCost: P(26000), powerNeed: 16, waterNeed: 10, labourNeed: 44, recipe: { inputs: { goods: 3, textiles: 2, paper: 2 }, outputs: {}, period: 50 } },
  { id: 'tip', name: 'Landfill', kind: 'terminal', footprint: 3, kit: 'pit', colour: '#5d564a', fromEra: 4, amenityPenalty: 40, amenityRadius: 14, foundCost: P(30000), labourNeed: 14, recipe: { inputs: { waste: 6, spoil: 4 }, outputs: {}, period: 50 } },
  { id: 'resort', name: 'Resort', kind: 'tourism', footprint: 4, kit: 'resort', colour: '#3fa08c', fromEra: 4, amenityPenalty: 6, amenityRadius: 4, foundCost: P(120000), powerNeed: 40, waterNeed: 60, labourNeed: 90, recipe: { inputs: { food: 2, goods: 1 }, outputs: { tourists: 6 }, period: 50 } },
  { id: 'heritage-site', name: 'Heritage site', kind: 'tourism', footprint: 2, kit: 'resort', colour: '#8f8f6a', fromEra: 5, amenityPenalty: 0, amenityRadius: 0, foundCost: P(50000), powerNeed: 10, waterNeed: 14, labourNeed: 24, recipe: { inputs: {}, outputs: { tourists: 3 }, period: 56 } },
  { id: 'retail-park', name: 'Retail park', kind: 'terminal', footprint: 4, kit: 'retail', colour: '#d0913c', fromEra: 5, amenityPenalty: 14, amenityRadius: 7, foundCost: P(70000), powerNeed: 40, waterNeed: 26, labourNeed: 80, recipe: { inputs: { retail: 5, food: 2 }, outputs: {}, period: 48 } },
  { id: 'distribution-centre', name: 'Distribution centre', kind: 'terminal', footprint: 4, kit: 'shed', colour: '#a08b5e', fromEra: 6, amenityPenalty: 12, amenityRadius: 7, foundCost: P(85000), powerNeed: 44, waterNeed: 20, labourNeed: 90, recipe: { inputs: { goods: 4, electronics: 1 }, outputs: { retail: 5 }, period: 46 } },
  { id: 'remediation', name: 'Remediation works', kind: 'terminal', footprint: 3, kit: 'yard', colour: '#6f9060', fromEra: 7, amenityPenalty: 0, amenityRadius: 0, foundCost: P(160000), powerNeed: 50, waterNeed: 60, labourNeed: 40, recipe: { inputs: { spoil: 4, water: 20 }, outputs: {}, period: 54 } },
];

// -------------------------------------------------------------------- eras

const eras = [
  { n: 1, name: 'Horse and rail', from: 1860, to: 1890, blurb: 'Everything moves at a walk, and the roads belong to somebody else.' },
  { n: 2, name: 'Steam', from: 1890, to: 1920, blurb: 'Steam on the road and steam on the rails. Reliability is a wish.' },
  { n: 3, name: 'Combustion', from: 1920, to: 1950, blurb: 'Diesel, tarmac, and the first aeroplanes that can carry anything.' },
  { n: 4, name: 'Motorway', from: 1950, to: 1975, blurb: 'Grade separation, articulation, and the private car arrives to compete for your road.' },
  { n: 5, name: 'Container', from: 1975, to: 2000, blurb: 'Transfer cost collapses and every optimum you had is now wrong.' },
  { n: 6, name: 'Logistics', from: 2000, to: 2030, blurb: 'The last mile, high-speed rail, and demand that moves to the doorstep.' },
  { n: 7, name: 'Transition', from: 2030, to: 2065, blurb: 'Electric fleets, intermittent generation, and the bill for a century of spoil.' },
  { n: 8, name: 'Autonomous', from: 2065, to: 2100, blurb: 'Convoys that drive themselves, and freight that never lands.' },
];

const ERA_UNLOCKS: Record<number, string[]> = {};
for (const e of eras) ERA_UNLOCKS[e.n] = [];
for (const v of vehicles) ERA_UNLOCKS[v.era].push(v.id);
for (const w of ways) ERA_UNLOCKS[w.era].push(w.id);
for (const i of industries) ERA_UNLOCKS[(i as { fromEra?: number }).fromEra ?? 1].push(i.id);

// ----------------------------------------------------------------- balance

const balance = {
  startingCash: P(2400),
  interestBps: 620,
  creditLimitPct: 140,
  contractSlots: 6,
  contractIntervalDays: 9,
  latePenaltyPct: 40,
  reliabilityWeight: 35,
  valuationPct: 320,
  tollElasticity: 140,
  valueOfTime: 26,
  declineBelowPct: 55,
  closeBelowPct: 22,
  declineDays: 45,
  graceDays: 60,
  townGrowthPerDay: 4,
  regulatorSharePct: 58,
};

// ------------------------------------------------------------------ emit

const bundle = {
  cargo: cargo.map((c) => ({ perishability: 0, fromEra: 1, ...c })),
  vehicles: vehicles.map((v) => ({
    id: v.id,
    name: v.name,
    mode: v.mode,
    class: v.class,
    era: v.era,
    obsoleteYear: v.obsolete ?? 9999,
    capacity: v.cap,
    handling: v.handling,
    speed: SPEED(v.spd),
    displayKph: v.kph,
    cost: v.cost,
    runningCost: v.run,
    cells: v.cells ?? 1,
    transferRate: v.transfer ?? 2,
    reliability: v.reliability ?? 90,
    model: `${v.mode}-${v.class}-e${v.era}`,
  })),
  eras: eras.map((e) => ({ ...e, unlocks: ERA_UNLOCKS[e.n] })),
  // Defaults first, then the literal, so an industry that names a field wins.
  // Zod would fill these in anyway; writing them here keeps the emitted JSON
  // complete, which matters because the JSON is what a modder reads.
  industries: industries.map((i) => {
    const withDefaults: Record<string, unknown> = {
      fromEra: 1, deposit: 0, footprint: 2, foundCost: 0,
      powerNeed: 0, waterNeed: 0, labourNeed: 0,
      amenityPenalty: 0, amenityRadius: 0,
    };
    for (const [k, val] of Object.entries(i)) withDefaults[k] = val;
    const rec = i.recipe as unknown as { inputs?: Record<string, number>; outputs?: Record<string, number>; period: number };
    withDefaults.recipe = { inputs: rec.inputs ?? {}, outputs: rec.outputs ?? {}, period: rec.period };
    return withDefaults;
  }),
  ways,
  balance,
};

const checked = validateBundle(bundle);
mkdirSync(OUT, { recursive: true });
for (const [key, value] of Object.entries(checked)) {
  writeFileSync(join(OUT, `${key}.json`), JSON.stringify(value, null, 2) + '\n');
}
console.log(
  `content written: ${checked.cargo.length} cargo, ${checked.vehicles.length} vehicles, ` +
    `${checked.industries.length} industries, ${checked.ways.length} ways, ${checked.eras.length} eras`,
);
