// Edits a player can make to a running junction. Each takes a draft Scenario and changes it in place;
// the store clones before calling, so these never touch live state.
import type { CrosswalkType, LegId, Movement, Scenario, SignalPhase } from '../core/types';
import { buildNetwork } from '../network/build';
import { autoSignalPlan, type ControlChoice } from './setup';

export type CrossingChoice = 'none' | CrosswalkType;

export function controlChoice(s: Scenario): ControlChoice {
  if (s.control.type === 'signals') return 'signals';
  if (s.control.type === 'roundabout') return 'roundabout';
  return s.control.major.length ? 'major' : 'right';
}

export function setControl(s: Scenario, choice: ControlChoice, green = 25) {
  if (choice === 'right') s.control = { type: 'priority', major: [] };
  else if (choice === 'major') s.control = { type: 'priority', major: straightestPair(s) };
  else if (choice === 'roundabout') s.control = { type: 'roundabout' };
  else s.control = { type: 'signals', phases: autoSignalPlan(s.legs, green) };
}

export function setAllLanes(s: Scenario, lanes: number) {
  for (const l of s.legs) {
    l.lanesIn = lanes;
    l.lanesOut = lanes;
  }
}

export function setAllCrossings(s: Scenario, choice: CrossingChoice) {
  s.crosswalks = choice === 'none' ? [] : s.legs.map((l) => ({ leg: l.id, type: choice }));
  ensurePedDemand(s);
  syncSignalPedestrians(s);
}

export function crossingOf(s: Scenario, leg: LegId): CrossingChoice {
  return s.crosswalks.find((c) => c.leg === leg)?.type ?? 'none';
}

export function setCrossing(s: Scenario, leg: LegId, choice: CrossingChoice) {
  s.crosswalks = s.crosswalks.filter((c) => c.leg !== leg);
  if (choice !== 'none') s.crosswalks.push({ leg, type: choice });
  ensurePedDemand(s);
  syncSignalPedestrians(s);
}

export function toggleBanned(s: Scenario, from: LegId, to: LegId) {
  const leg = s.legs.find((l) => l.id === from)!;
  const banned = new Set(leg.banned ?? []);
  if (banned.has(to)) banned.delete(to);
  else banned.add(to);
  leg.banned = [...banned];
}

export function toggleMajor(s: Scenario, leg: LegId) {
  if (s.control.type !== 'priority') return;
  const major = new Set(s.control.major);
  if (major.has(leg)) major.delete(leg);
  else major.add(leg);
  s.control = { type: 'priority', major: [...major] };
}

/** Each leg's possible side road (slip lane): to its neighbour on the near side. */
export function sideRoadCandidates(s: Scenario): Array<{ from: LegId; to: LegId }> {
  if (s.legs.length < 2) return [];
  const sorted = [...s.legs].sort((a, b) => norm360(a.angle) - norm360(b.angle));
  const side = s.driveSide === 'right' ? 1 : -1;
  return sorted.map((leg, i) => ({ from: leg.id, to: sorted[(i + side + sorted.length) % sorted.length]!.id }));
}

export function toggleSideRoad(s: Scenario, from: LegId) {
  const leg = s.legs.find((l) => l.id === from)!;
  leg.slipLane = !leg.slipLane;
}

/** Pairs of roughly opposite legs that could carry a flyover. */
export function flyoverCandidates(s: Scenario): Array<[LegId, LegId]> {
  const out: Array<[LegId, LegId]> = [];
  for (let i = 0; i < s.legs.length; i++) {
    for (let j = i + 1; j < s.legs.length; j++) {
      if (Math.abs(angleDiff(s.legs[i]!.angle, s.legs[j]!.angle) - 180) < 35) out.push([s.legs[i]!.id, s.legs[j]!.id]);
    }
  }
  return out;
}

export function hasFlyover(s: Scenario, [a, b]: [LegId, LegId]) {
  return (s.flyovers ?? []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

export function toggleFlyover(s: Scenario, pair: [LegId, LegId]) {
  const rest = (s.flyovers ?? []).filter(([x, y]) => !((x === pair[0] && y === pair[1]) || (x === pair[1] && y === pair[0])));
  // A leg can carry only one flyover; drop others that share a leg.
  s.flyovers = hasFlyover(s, pair) ? rest : [...rest.filter(([x, y]) => !pair.includes(x) && !pair.includes(y)), pair];
}

// --- signal plans ---------------------------------------------------------

export type PlanPreset = 'pairs' | 'split' | 'protected';

export function applyPlanPreset(s: Scenario, preset: PlanPreset, green = 25) {
  let phases: SignalPhase[];
  if (preset === 'pairs') phases = autoSignalPlan(s.legs, green);
  else if (preset === 'split') {
    phases = s.legs.map((leg) => ({
      green,
      movements: [{ from: leg.id, to: '*' as const }],
      pedestrians: s.legs.filter((l) => l !== leg).map((l) => l.id),
    }));
  } else {
    // Opposite legs together, first straight on and near-side turns, then their far-side turns on their own.
    const net = buildNetwork(s);
    const turnOf = (from: LegId, to: LegId) => net.connectors.find((c) => c.from === from && c.to === to)?.turn;
    phases = autoSignalPlan(s.legs, green).flatMap((group) => {
      const legs = group.movements.map((m) => m.from);
      const moves = (far: boolean) =>
        legs.flatMap((from) =>
          s.legs
            .filter((to) => to.id !== from && turnOf(from, to.id) !== undefined && (turnOf(from, to.id) === 'far') === far)
            .map((to) => ({ from, to: to.id })),
        );
      const main = { green, movements: moves(false), pedestrians: group.pedestrians };
      const turns = moves(true);
      return turns.length ? [main, { green: Math.max(10, Math.round(green / 2)), movements: turns, pedestrians: [] }] : [main];
    });
  }
  s.control = { type: 'signals', phases };
  syncSignalPedestrians(s);
}

/** Every movement a phase gives green to, with '*' expanded. */
export function phaseMovements(s: Scenario, phase: SignalPhase): Movement[] {
  return phase.movements.flatMap((m) => (m.to === '*' ? s.legs.filter((l) => l.id !== m.from).map((l) => ({ from: m.from, to: l.id })) : [{ from: m.from, to: m.to }]));
}

export function toggleMovementInPhase(s: Scenario, phaseIndex: number, move: Movement) {
  if (s.control.type !== 'signals') return;
  const phase = s.control.phases[phaseIndex]!;
  const current = phaseMovements(s, phase);
  const has = current.some((m) => m.from === move.from && m.to === move.to);
  phase.movements = has ? current.filter((m) => !(m.from === move.from && m.to === move.to)) : [...current, move];
}

export function togglePedInPhase(s: Scenario, phaseIndex: number, leg: LegId) {
  if (s.control.type !== 'signals') return;
  const phase = s.control.phases[phaseIndex]!;
  const peds = new Set(phase.pedestrians ?? []);
  if (peds.has(leg)) peds.delete(leg);
  else peds.add(leg);
  phase.pedestrians = [...peds];
}

export function setPhaseGreen(s: Scenario, phaseIndex: number, green: number) {
  if (s.control.type === 'signals') s.control.phases[phaseIndex]!.green = green;
}

export function addPhase(s: Scenario) {
  if (s.control.type === 'signals') s.control.phases.push({ green: 20, movements: [], pedestrians: [] });
}

export function removePhase(s: Scenario, phaseIndex: number) {
  if (s.control.type === 'signals' && s.control.phases.length > 1) s.control.phases.splice(phaseIndex, 1);
}

/** New signalised crossings need a walk phase: give them every phase where their leg's traffic is held. */
function syncSignalPedestrians(s: Scenario) {
  if (s.control.type !== 'signals') return;
  for (const cw of s.crosswalks) {
    if (cw.type !== 'signal') continue;
    if (s.control.phases.some((p) => p.pedestrians?.includes(cw.leg))) continue;
    for (const p of s.control.phases) {
      const moving = phaseMovements(s, p).some((m) => m.from === cw.leg);
      if (!moving) p.pedestrians = [...(p.pedestrians ?? []), cw.leg];
    }
  }
}

function ensurePedDemand(s: Scenario) {
  for (const cw of s.crosswalks) {
    if (!s.demand.pedestrians.some((p) => p.leg === cw.leg)) s.demand.pedestrians.push({ leg: cw.leg, pedPerHour: 120 });
  }
}

function straightestPair(s: Scenario): LegId[] {
  let best: LegId[] = [];
  let bestErr = Infinity;
  for (const [a, b] of flyoverCandidates(s).length ? flyoverCandidates(s) : allPairs(s)) {
    const err = Math.abs(angleDiff(s.legs.find((l) => l.id === a)!.angle, s.legs.find((l) => l.id === b)!.angle) - 180);
    if (err < bestErr) {
      bestErr = err;
      best = [a, b];
    }
  }
  return best;
}

function allPairs(s: Scenario): Array<[LegId, LegId]> {
  const out: Array<[LegId, LegId]> = [];
  for (let i = 0; i < s.legs.length; i++) for (let j = i + 1; j < s.legs.length; j++) out.push([s.legs[i]!.id, s.legs[j]!.id]);
  return out;
}

const norm360 = (a: number) => ((a % 360) + 360) % 360;

const angleDiff = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};
