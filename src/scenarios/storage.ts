// Saving designs: a list kept in this browser, and JSON files to take a design elsewhere.
import { MAX_LANES, type Scenario } from '../core/types';
import { MAX_LEGS } from './shape';

export interface SavedDesign {
  id: string;
  name: string;
  savedAt: string;
  scenario: Scenario;
}

const KEY = 'traffic.designs.v1';

export function listDesigns(): SavedDesign[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((d): d is SavedDesign => !!d && typeof d === 'object' && !parseScenario((d as SavedDesign).scenario).error) : [];
  } catch {
    return [];
  }
}

/** Saves under a name (replacing a design with the same name). Returns false if the browser won't store it. */
export function saveDesign(name: string, scenario: Scenario): boolean {
  const designs = listDesigns().filter((d) => d.name !== name);
  // Time plus a random suffix: two saves in the same millisecond must not share an id.
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  designs.unshift({ id, name, savedAt: new Date().toISOString(), scenario: structuredClone(scenario) });
  try {
    localStorage.setItem(KEY, JSON.stringify(designs));
    return true;
  } catch {
    return false;
  }
}

export function deleteDesign(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(listDesigns().filter((d) => d.id !== id)));
  } catch {
    // Nothing stored to delete.
  }
}

/** File contents for a design: the scenario, pretty-printed, with a marker so it can be recognised. */
export function designFile(name: string, scenario: Scenario): string {
  return JSON.stringify({ app: 'traffic', kind: 'design', name, scenario }, null, 2);
}

/**
 * Check a scenario from outside (a file, or old storage) before using it. Only the essentials are
 * checked: enough for the network builder not to fail. Returns the scenario or what's wrong.
 */
export function parseScenario(input: unknown): { scenario?: Scenario; name?: string; error?: string } {
  const obj = input as { app?: string; name?: string; scenario?: unknown } | null;
  const s = (obj && obj.app === 'traffic' ? obj.scenario : input) as Partial<Scenario> | null;
  const name = obj && obj.app === 'traffic' && typeof obj.name === 'string' ? obj.name : undefined;
  if (!s || typeof s !== 'object') return { error: 'Not a traffic design.' };
  if (s.version !== 1) return { error: 'Unknown design version.' };
  if (s.driveSide !== 'right' && s.driveSide !== 'left') return { error: 'Missing drive side.' };
  if (!Array.isArray(s.legs) || s.legs.length < 2 || s.legs.length > MAX_LEGS) return { error: `A design needs 2 to ${MAX_LEGS} roads.` };
  for (const l of s.legs) {
    if (!l || typeof l.id !== 'string' || typeof l.angle !== 'number' || !Number.isFinite(l.angle)) return { error: 'A road is missing its id or angle.' };
    if (![l.lanesIn, l.lanesOut].every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_LANES)) return { error: `Road ${l.id} has an invalid number of lanes.` };
    if (typeof l.length !== 'number' || l.length < 40 || l.length > 400) return { error: `Road ${l.id} has an invalid length.` };
  }
  if (new Set(s.legs.map((l) => l.id)).size !== s.legs.length) return { error: 'Two roads share an id.' };
  if (!s.control || !['priority', 'signals', 'roundabout'].includes(s.control.type)) return { error: 'Unknown junction control.' };
  if (!s.demand || !Array.isArray(s.demand.vehicles) || !Array.isArray(s.demand.pedestrians)) return { error: 'Missing traffic.' };
  if (!s.demand.vehicles.every((d) => d && d.vehPerHour >= 0 && d.vehPerHour <= 5000)) return { error: 'Traffic numbers out of range.' };
  if (!Array.isArray(s.crosswalks)) return { error: 'Missing crossings.' };
  return { scenario: { seed: 1, name: name ?? 'Imported design', ...s } as Scenario, name };
}
