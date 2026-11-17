// Saving designs: a list kept in this browser, and JSON files to take a design elsewhere.
import { t } from '../core/i18n';
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
  if (!s || typeof s !== 'object') return { error: t('Not a traffic design.', 'Bu bir trafik tasarımı değil.') };
  if (s.version !== 1) return { error: t('Unknown design version.', 'Bilinmeyen tasarım sürümü.') };
  if (s.driveSide !== 'right' && s.driveSide !== 'left') return { error: t('Missing drive side.', 'Sürüş yönü eksik.') };
  if (!Array.isArray(s.legs) || s.legs.length < 2 || s.legs.length > MAX_LEGS) return { error: t(`A design needs 2 to ${MAX_LEGS} roads.`, `Bir tasarımda 2 ile ${MAX_LEGS} arası yol olmalı.`) };
  for (const l of s.legs) {
    if (!l || typeof l.id !== 'string' || typeof l.angle !== 'number' || !Number.isFinite(l.angle)) return { error: t('A road is missing its id or angle.', 'Bir yolun numarası ya da açısı eksik.') };
    if (![l.lanesIn, l.lanesOut].every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_LANES)) return { error: t(`Road ${l.id} has an invalid number of lanes.`, `${l.id} numaralı yolun şerit sayısı geçersiz.`) };
    if (typeof l.length !== 'number' || l.length < 40 || l.length > 400) return { error: t(`Road ${l.id} has an invalid length.`, `${l.id} numaralı yolun uzunluğu geçersiz.`) };
    const turns = ['near', 'through', 'far'];
    if (l.laneTurns !== undefined && !(Array.isArray(l.laneTurns) && l.laneTurns.every((k) => Array.isArray(k) && k.every((x) => turns.includes(x))))) {
      return { error: t(`Road ${l.id} has invalid lane arrows.`, `${l.id} numaralı yolun şerit okları geçersiz.`) };
    }
  }
  if (new Set(s.legs.map((l) => l.id)).size !== s.legs.length) return { error: t('Two roads share an id.', 'İki yol aynı numarayı taşıyor.') };
  if (!s.control || !['priority', 'signals', 'roundabout'].includes(s.control.type)) return { error: t('Unknown junction control.', 'Bilinmeyen kavşak kontrolü.') };
  if (!s.demand || !Array.isArray(s.demand.vehicles) || !Array.isArray(s.demand.pedestrians)) return { error: t('Missing traffic.', 'Trafik bilgisi eksik.') };
  if (!s.demand.vehicles.every((d) => d && d.vehPerHour >= 0 && d.vehPerHour <= 5000)) return { error: t('Traffic numbers out of range.', 'Trafik değerleri aralık dışında.') };
  const heavy = s.demand.heavyShare;
  if (heavy !== undefined && !(typeof heavy === 'number' && heavy >= 0 && heavy <= 1)) return { error: t('Share of trucks and buses out of range.', 'Kamyon ve otobüs oranı aralık dışında.') };
  if (!Array.isArray(s.crosswalks)) return { error: t('Missing crossings.', 'Yaya geçidi bilgisi eksik.') };
  return { scenario: { seed: 1, name: name ?? 'Imported design', ...s } as Scenario, name };
}
