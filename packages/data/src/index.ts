/**
 * Content loading. The JSON under `content/` is the shipped artefact; this
 * validates it once at start-up and hands the sim indexed lookups.
 *
 * The sim holds *indices* into these tables, never string ids — a string
 * compare per vehicle per tick is not affordable at twenty-five thousand
 * agents, and an index is also what the snapshot format wants. The tables are
 * ordered by the JSON's own order, which is stable because the generator
 * writes it, so an index means the same thing on every machine.
 */

import cargoJson from '../content/cargo.json' with { type: 'json' };
import vehiclesJson from '../content/vehicles.json' with { type: 'json' };
import erasJson from '../content/eras.json' with { type: 'json' };
import industriesJson from '../content/industries.json' with { type: 'json' };
import waysJson from '../content/ways.json' with { type: 'json' };
import balanceJson from '../content/balance.json' with { type: 'json' };

import { validateBundle, type ContentBundle, type CargoDef, type VehicleDef, type IndustryDef, type WayClass, type EraDef, type Balance } from './schema.ts';

export * from './schema.ts';

export interface Content extends ContentBundle {
  cargoIndex: Map<string, number>;
  vehicleIndex: Map<string, number>;
  industryIndex: Map<string, number>;
  wayIndex: Map<string, number>;
  /** Industry table indices that can be founded on a given deposit kind. */
  industriesByDeposit: number[][];
  /** Way table indices per mode, cheapest first. */
  waysByMode: Map<string, number[]>;
  /** Vehicle table indices per mode, in era order. */
  vehiclesByMode: Map<string, number[]>;
}

function index<T extends { id: string }>(list: T[]): Map<string, number> {
  const m = new Map<string, number>();
  list.forEach((item, i) => m.set(item.id, i));
  return m;
}

export function loadContent(raw?: unknown): Content {
  const bundle = validateBundle(
    raw ?? {
      cargo: cargoJson,
      vehicles: vehiclesJson,
      eras: erasJson,
      industries: industriesJson,
      ways: waysJson,
      balance: balanceJson,
    },
  );

  const industriesByDeposit: number[][] = [];
  bundle.industries.forEach((ind, i) => {
    if (ind.kind !== 'extraction') return;
    (industriesByDeposit[ind.deposit] ??= []).push(i);
  });

  const waysByMode = new Map<string, number[]>();
  bundle.ways.forEach((w, i) => {
    const list = waysByMode.get(w.mode) ?? [];
    list.push(i);
    waysByMode.set(w.mode, list);
  });
  for (const list of waysByMode.values()) list.sort((a, b) => bundle.ways[a].buildCost - bundle.ways[b].buildCost);

  const vehiclesByMode = new Map<string, number[]>();
  bundle.vehicles.forEach((v, i) => {
    const list = vehiclesByMode.get(v.mode) ?? [];
    list.push(i);
    vehiclesByMode.set(v.mode, list);
  });
  for (const list of vehiclesByMode.values()) list.sort((a, b) => bundle.vehicles[a].era - bundle.vehicles[b].era);

  return {
    ...bundle,
    cargoIndex: index(bundle.cargo),
    vehicleIndex: index(bundle.vehicles),
    industryIndex: index(bundle.industries),
    wayIndex: index(bundle.ways),
    industriesByDeposit,
    waysByMode,
    vehiclesByMode,
  };
}

let cached: Content | null = null;

/** The default bundle. Cached, because validation is not free and every
 *  subsystem wants it. */
export function content(): Content {
  return (cached ??= loadContent());
}

/** Swap the bundle at run time. This is what hot reload and the balance sweep
 *  both use; the sweep rewrites `balance` and reruns without a restart. */
export function setContent(c: Content): void {
  cached = c;
}

export type { CargoDef, VehicleDef, IndustryDef, WayClass, EraDef, Balance, ContentBundle };

/** The era containing a given year. Years before era 1 clamp to era 1. */
export function eraForYear(c: Content, year: number): EraDef {
  for (let i = c.eras.length - 1; i >= 0; i--) {
    if (year >= c.eras[i].from) return c.eras[i];
  }
  return c.eras[0];
}

/** Vehicles a company may buy in a given year: era has opened, and the model
 *  has not yet gone out of production. */
export function availableVehicles(c: Content, year: number, mode?: string): number[] {
  const era = eraForYear(c, year).n;
  const out: number[] = [];
  c.vehicles.forEach((v, i) => {
    if (v.era > era) return;
    if (year >= v.obsoleteYear) return;
    if (mode && v.mode !== mode) return;
    out.push(i);
  });
  return out;
}
