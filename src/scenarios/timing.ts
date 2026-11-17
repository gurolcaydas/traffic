// Automatic signal timing from the traffic table, by Webster's method: the cycle that minimises
// delay is (1.5 L + 5) / (1 − Y), and each phase gets green in proportion to its critical flow ratio.
import { DEFAULTS, type Scenario } from '../core/types';
import { buildNetwork } from '../network/build';
import { movementKey } from '../network/network';
import { phaseMovements } from './edit';

/** Vehicles per hour of green one lane discharges when saturated (HCM base, as the model does). */
export const SATURATION_FLOW = 1900;
/**
 * How many cars going straight on a far-side turn across oncoming traffic is worth (a left-turn
 * equivalence factor, after HCM): 1800 / (1400 − oncoming veh/h per lane), and more when the turner
 * waits in a lane that through traffic shares, since everyone behind waits with it.
 */
const farTurnEquivalent = (oncomingPerLane: number, shared: boolean) =>
  (1800 / Math.max(200, 1400 - oncomingPerLane)) * (shared ? SHARED_LANE_BLOCKING : 1);
/** Extra weight on a far turn that blocks a shared lane while it waits (checked against the simulation). */
const SHARED_LANE_BLOCKING = 3;
/** Shortest and longest cycle worth suggesting, s. */
const MIN_CYCLE = 40;
/**
 * Shortest cycle when turners give way to oncoming traffic: many of them only get away at the end of
 * each green, so short cycles starve them.
 */
const MIN_PERMISSIVE_CYCLE = 60;
const MAX_CYCLE = 120;
/** The phase sliders' range and step, s. */
const MIN_GREEN = 5;
const MAX_GREEN = 60;
const STEP = 5;

export interface WebsterTiming {
  cycle: number;
  /** Green per phase, rounded to the sliders' step. */
  greens: number[];
  /** Critical flow ratio of each phase, and their sum: above about 0.9 no timing can cope. */
  ratios: number[];
  total: number;
}

/** Webster timing for the scenario's signal plan, or null if it has no signals. */
export function websterTiming(s: Scenario): WebsterTiming | null {
  if (s.control.type !== 'signals' || s.control.phases.length === 0) return null;
  const { phases } = s.control;
  const net = buildNetwork(s);
  const lost = (s.control.amber ?? DEFAULTS.amber) + (s.control.allRed ?? DEFAULTS.allRed);

  // A movement that runs in several phases has its traffic shared between them.
  const phasesOf = new Map<string, number>();
  const served = phases.map((p) => phaseMovements(s, p));
  for (const moves of served) for (const m of moves) phasesOf.set(movementKey(m.from, m.to), (phasesOf.get(movementKey(m.from, m.to)) ?? 0) + 1);

  let permissive = false;
  const ratios = served.map((moves, p) => {
    // The busiest approach in the phase sets how long it must stay green: its flow per lane.
    let worst = 0;
    for (const from of new Set(moves.map((m) => m.from))) {
      let flow = 0;
      const lanes = new Set<number>();
      for (const m of moves.filter((x) => x.from === from)) {
        const key = movementKey(m.from, m.to);
        const veh = s.demand.vehicles.filter((d) => d.from === m.from && d.to === m.to).reduce((a, d) => a + d.vehPerHour, 0);
        const conn = net.connectors.find((c) => c.from === m.from && c.to === m.to && c.controlled);
        if (!conn) continue;
        // Turning across oncoming traffic that also has green takes longer.
        const oncoming = conn.turn === 'far' ? opposingFlow(s, net, conn.idx, p) : null;
        if (oncoming !== null && veh > 0) permissive = true;
        const laneIdx = (net.movementLanes.get(key) ?? []).filter((l) => net.lanes[l]!.role === 'regular');
        const shared = laneIdx.some((l) => (net.connectorsFromLane.get(l) ?? []).some((c) => net.connectors[c]!.turn !== 'far'));
        flow += (veh / (phasesOf.get(key) ?? 1)) * (oncoming === null ? 1 : farTurnEquivalent(oncoming, shared));
        for (const l of laneIdx) lanes.add(l);
      }
      if (lanes.size) worst = Math.max(worst, flow / (lanes.size * SATURATION_FLOW));
    }
    return worst;
  });

  const total = ratios.reduce((a, y) => a + y, 0);
  const L = lost * phases.length;
  const cycle = total >= 0.95 ? MAX_CYCLE : clamp((1.5 * L + 5) / (1 - total), permissive ? MIN_PERMISSIVE_CYCLE : MIN_CYCLE, MAX_CYCLE);
  const effective = cycle - L;
  const greens = ratios.map((y) => {
    // A phase with no traffic still gets the shortest green, so the plan keeps its shape.
    const g = total > 0 ? (effective * y) / total : effective / phases.length;
    return clamp(Math.round(g / STEP) * STEP, MIN_GREEN, MAX_GREEN);
  });
  return { cycle, greens, ratios, total };
}

/** Retime every phase by Webster's method. Movements and walk phases stay as they are. */
export function applyWebsterTiming(s: Scenario) {
  const timing = websterTiming(s);
  if (!timing || s.control.type !== 'signals') return;
  s.control.phases.forEach((p, i) => (p.green = timing.greens[i]!));
}

/**
 * Oncoming traffic per lane that a far-side turn gives way to in phase p, or null if nothing opposes it
 * there (a protected turn).
 */
function opposingFlow(s: Scenario, net: ReturnType<typeof buildNetwork>, conn: number, p: number): number | null {
  const others = net.connectors[conn]!.conflicts
    .filter((c) => c.yields && c.kind === 'cross')
    .map((c) => net.connectors[c.other]!)
    .filter((o) => o.controlled && o.greenPhases.includes(p) && o.turn === 'through');
  if (others.length === 0) return null;
  const lanes = new Set(others.map((o) => o.inLane));
  let flow = 0;
  for (const key of new Set(others.map((o) => movementKey(o.from, o.to)))) {
    flow += s.demand.vehicles.filter((d) => movementKey(d.from, d.to) === key).reduce((a, d) => a + d.vehPerHour, 0);
  }
  return flow / lanes.size;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
