import type { ControlSpec, DriveSide, LegSpec, Scenario, VehicleDemand } from '../core/types';

export interface CrossroadOptions {
  driveSide?: DriveSide;
  /** Lanes in each direction on every leg. */
  lanes?: number;
  /** Legs at 0, 90, 180, 270 degrees by default. */
  angles?: number[];
  length?: number;
  control?: ControlSpec;
  crosswalks?: 'none' | 'zebra' | 'signal';
  /** Vehicles per hour entering on each leg, split across the other legs. */
  vehPerHourPerLeg?: number;
  pedPerHourPerCrosswalk?: number;
  seed?: number;
}

/** A plain crossroad (or T / five-way, via `angles`) with evenly split demand. */
export function crossroad(opts: CrossroadOptions = {}): Scenario {
  const angles = opts.angles ?? [0, 90, 180, 270];
  const lanes = opts.lanes ?? 1;
  const legs: LegSpec[] = angles.map((angle, i) => ({
    id: String(i + 1),
    angle,
    length: opts.length ?? 120,
    lanesIn: lanes,
    lanesOut: lanes,
  }));

  const perLeg = opts.vehPerHourPerLeg ?? 300;
  const vehicles: VehicleDemand[] = [];
  for (const from of legs) {
    const others = legs.filter((l) => l !== from);
    for (const to of others) vehicles.push({ from: from.id, to: to.id, vehPerHour: perLeg / others.length });
  }

  const cwType = opts.crosswalks ?? 'none';
  const crosswalks = cwType === 'none' ? [] : legs.map((l) => ({ leg: l.id, type: cwType }));

  return {
    version: 1,
    name: `${legs.length}-way crossroad`,
    driveSide: opts.driveSide ?? 'right',
    seed: opts.seed ?? 1,
    legs,
    crosswalks,
    control: opts.control ?? { type: 'priority', major: [] },
    demand: {
      vehicles,
      pedestrians: crosswalks.map((c) => ({ leg: c.leg, pedPerHour: opts.pedPerHourPerCrosswalk ?? 120 })),
    },
  };
}

/** Classic two-phase signal plan for a 4-way: legs 1+3 together, then 2+4, pedestrians crossing alongside. */
export function twoPhaseSignals(green = 25): ControlSpec {
  return {
    type: 'signals',
    phases: [
      { green, movements: [{ from: '1', to: '*' }, { from: '3', to: '*' }], pedestrians: ['2', '4'] },
      { green, movements: [{ from: '2', to: '*' }, { from: '4', to: '*' }], pedestrians: ['1', '3'] },
    ],
  };
}
