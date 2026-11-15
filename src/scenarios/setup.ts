import type { ControlSpec, DriveSide, LegSpec, Scenario, SignalPhase } from '../core/types';

export type Shape = 'cross' | 't' | 'y' | 'five';
export type ControlChoice = 'right' | 'major' | 'signals';
export type CrosswalkChoice = 'none' | 'zebra' | 'signal';

/** The knobs the sandbox exposes. Everything else about the scenario is derived. */
export interface Setup {
  shape: Shape;
  lanes: 1 | 2 | 3;
  control: ControlChoice;
  /** Green seconds per signal phase. */
  green: number;
  crosswalks: CrosswalkChoice;
  driveSide: DriveSide;
}

export const SHAPES: Record<Shape, { label: string; angles: number[] }> = {
  cross: { label: 'Crossroad', angles: [0, 90, 180, 270] },
  t: { label: 'T-junction', angles: [0, 180, 270] },
  y: { label: 'Y-junction', angles: [90, 210, 330] },
  five: { label: '5-way', angles: [0, 70, 145, 215, 290] },
};

export const DEFAULT_SETUP: Setup = {
  shape: 'cross',
  lanes: 1,
  control: 'right',
  green: 25,
  crosswalks: 'none',
  driveSide: 'right',
};

export function legsFor(setup: Setup): LegSpec[] {
  return SHAPES[setup.shape].angles.map((angle, i) => ({
    id: String(i + 1),
    angle,
    length: 120,
    lanesIn: setup.lanes,
    lanesOut: setup.lanes,
  }));
}

/** Even split of `perLeg` vehicles/hour from every leg to every other leg. */
export function defaultDemand(setup: Setup, perLeg = 360): Scenario['demand'] {
  const legs = legsFor(setup);
  const vehicles = legs.flatMap((from) => {
    const others = legs.filter((l) => l !== from);
    return others.map((to) => ({ from: from.id, to: to.id, vehPerHour: Math.round(perLeg / others.length / 10) * 10 }));
  });
  const pedestrians = legs.map((l) => ({ leg: l.id, pedPerHour: 120 }));
  return { vehicles, pedestrians };
}

export function buildScenario(setup: Setup, demand: Scenario['demand'], seed = 1): Scenario {
  const legs = legsFor(setup);
  const crosswalks = setup.crosswalks === 'none' ? [] : legs.map((l) => ({ leg: l.id, type: setup.crosswalks as 'zebra' | 'signal' }));
  const ids = new Set(legs.map((l) => l.id));
  return {
    version: 1,
    name: `${SHAPES[setup.shape].label}`,
    driveSide: setup.driveSide,
    seed,
    legs,
    crosswalks,
    control: controlFor(setup, legs),
    demand: {
      vehicles: demand.vehicles.filter((d) => ids.has(d.from) && ids.has(d.to) && d.from !== d.to),
      pedestrians: crosswalks.length ? demand.pedestrians.filter((p) => ids.has(p.leg)) : [],
    },
  };
}

function controlFor(setup: Setup, legs: LegSpec[]): ControlSpec {
  if (setup.control === 'right') return { type: 'priority', major: [] };
  if (setup.control === 'major') {
    // The straightest pair of legs forms the major road.
    const [a, b] = straightestPair(legs);
    return { type: 'priority', major: [a.id, b.id] };
  }
  return { type: 'signals', phases: autoSignalPlan(legs, setup.green) };
}

/** Opposite legs share a phase; every other leg gets a phase of its own. Pedestrians cross legs that are not moving. */
export function autoSignalPlan(legs: LegSpec[], green: number): SignalPhase[] {
  const groups: LegSpec[][] = [];
  const used = new Set<string>();
  for (const leg of legs) {
    if (used.has(leg.id)) continue;
    const partner = legs.find((o) => !used.has(o.id) && o !== leg && Math.abs(angleDiff(o.angle, leg.angle) - 180) < 30);
    const group = partner ? [leg, partner] : [leg];
    group.forEach((l) => used.add(l.id));
    groups.push(group);
  }
  return groups.map((group) => ({
    green,
    movements: group.map((l) => ({ from: l.id, to: '*' as const })),
    pedestrians: legs.filter((l) => !group.includes(l)).map((l) => l.id),
  }));
}

function straightestPair(legs: LegSpec[]): [LegSpec, LegSpec] {
  let best: [LegSpec, LegSpec] = [legs[0]!, legs[1]!];
  let bestErr = Infinity;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const err = Math.abs(angleDiff(legs[i]!.angle, legs[j]!.angle) - 180);
      if (err < bestErr) {
        bestErr = err;
        best = [legs[i]!, legs[j]!];
      }
    }
  }
  return best;
}

const angleDiff = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};
