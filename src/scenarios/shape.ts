// Changing a junction's shape: adding, turning and removing roads. Every operation leaves the
// scenario consistent (demand, crossings, signals, flyovers and bans only refer to roads that exist).
import type { LegId, LegSpec, Scenario } from '../core/types';
import { autoSignalPlan } from './setup';

/** Roads closer than this (degrees) would overlap at the junction. */
export const MIN_GAP = 30;
export const MAX_LEGS = 6;
/** Angles snap to this many degrees while drawing. */
export const SNAP = 5;

const norm = (a: number) => ((a % 360) + 360) % 360;
const gap = (a: number, b: number) => {
  const d = Math.abs(norm(a) - norm(b));
  return d > 180 ? 360 - d : d;
};
export const snapAngle = (a: number) => norm(Math.round(a / SNAP) * SNAP);

/** Can a road point at `angle` without crowding the others (ignoring road `except`)? */
export function angleFits(s: Scenario, angle: number, except?: LegId): boolean {
  return s.legs.every((l) => l.id === except || gap(l.angle, angle) >= MIN_GAP);
}

/** The nearest angle to `wanted` that fits, searching outwards in snap steps; null if none does. */
export function nearestFit(s: Scenario, wanted: number, except?: LegId): number | null {
  const base = snapAngle(wanted);
  for (let d = 0; d <= 180; d += SNAP) {
    for (const a of d === 0 ? [base] : [base + d, base - d]) if (angleFits(s, norm(a), except)) return norm(a);
  }
  return null;
}

export function canAddLeg(s: Scenario): boolean {
  return s.legs.length < MAX_LEGS;
}

/** Add a road. New traffic to and from it starts modest: 120 veh/h in each direction, split evenly. */
export function addLeg(s: Scenario, angle: number): LegId | null {
  if (!canAddLeg(s)) return null;
  const at = nearestFit(s, angle);
  if (at === null) return null;
  const id = String(Math.max(0, ...s.legs.map((l) => Number(l.id) || 0)) + 1);
  const like = s.legs[0];
  const leg: LegSpec = { id, angle: at, length: like?.length ?? 120, lanesIn: 1, lanesOut: 1 };
  const others = s.legs.map((l) => l.id);
  s.legs.push(leg);
  for (const o of others) {
    s.demand.vehicles.push({ from: id, to: o, vehPerHour: Math.round(120 / others.length) });
    s.demand.vehicles.push({ from: o, to: id, vehPerHour: Math.round(120 / others.length) });
  }
  s.demand.pedestrians.push({ leg: id, pedPerHour: 120 });
  normalize(s, true);
  return id;
}

export function canRemoveLeg(s: Scenario): boolean {
  return s.legs.length > 2;
}

export function removeLeg(s: Scenario, id: LegId) {
  if (!canRemoveLeg(s)) return;
  s.legs = s.legs.filter((l) => l.id !== id);
  normalize(s, true);
}

/** Turn a road to point somewhere else (snapped, and kept clear of its neighbours). */
export function rotateLeg(s: Scenario, id: LegId, angle: number): boolean {
  const at = nearestFit(s, angle, id);
  const leg = s.legs.find((l) => l.id === id);
  if (at === null || !leg) return false;
  leg.angle = at;
  normalize(s, false);
  return true;
}

/**
 * Drop every reference to roads that no longer exist. When the set of roads changed, a signal
 * plan is rebuilt (its phases were written for the old roads).
 */
export function normalize(s: Scenario, roadsChanged: boolean) {
  const ids = new Set(s.legs.map((l) => l.id));
  s.demand.vehicles = s.demand.vehicles.filter((d) => ids.has(d.from) && ids.has(d.to) && d.from !== d.to);
  s.demand.pedestrians = s.demand.pedestrians.filter((p) => ids.has(p.leg));
  s.crosswalks = s.crosswalks.filter((c) => ids.has(c.leg));
  s.flyovers = (s.flyovers ?? []).filter(([a, b]) => ids.has(a) && ids.has(b));
  for (const l of s.legs) if (l.banned) l.banned = l.banned.filter((b) => ids.has(b));
  if (s.control.type === 'priority') s.control = { type: 'priority', major: s.control.major.filter((m) => ids.has(m)) };
  if (s.control.type === 'signals' && roadsChanged) {
    const green = s.control.phases[0]?.green ?? 25;
    // The automatic plan also lets each crossing walk while its road is held.
    s.control = { type: 'signals', phases: autoSignalPlan(s.legs, green) };
  }
  const pattern = s.demand.pattern;
  if (pattern?.centreLeg && !ids.has(pattern.centreLeg)) pattern.centreLeg = s.legs[0]!.id;
}
