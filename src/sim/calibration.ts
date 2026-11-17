// Checks of the traffic model against standard traffic-engineering results: saturation flow at a
// signal, Webster's signal delay, the HCM roundabout entry capacity and gap-acceptance capacity of a
// give-way approach. The tests hold the model to these, and `npm run calibrate` prints the comparison.
import type { ControlSpec, LegSpec, Scenario, VehicleDemand } from '../core/types';
import { Simulation } from './simulation';

const legs4 = (): LegSpec[] =>
  [0, 90, 180, 270].map((angle, i) => ({ id: String(i + 1), angle, length: 200, lanesIn: 1, lanesOut: 1 }));

const scenario = (vehicles: VehicleDemand[], control: ControlSpec, seed = 1): Scenario => ({
  version: 1,
  name: 'calibration',
  driveSide: 'right',
  seed,
  legs: legs4(),
  crosswalks: [],
  control,
  demand: { vehicles, pedestrians: [] },
});

/** Average over a few seeds of one measurement. */
const mean = (seeds: number[], f: (seed: number) => number) => seeds.reduce((s, seed) => s + f(seed), 0) / seeds.length;

const SEEDS = [1, 2, 3];

/** Signal plan for straight-through traffic on legs 1 and 3 against an empty cross street. */
const throughPlan = (green: number, crossGreen: number): ControlSpec => ({
  type: 'signals',
  phases: [
    { green, movements: [{ from: '1', to: '*' }, { from: '3', to: '*' }] },
    { green: crossGreen, movements: [{ from: '2', to: '*' }, { from: '4', to: '*' }] },
  ],
});

/**
 * Vehicles per hour of green that a saturated single lane discharges, measured over whole cycles:
 * vehicles served ÷ effective green, where effective green = green + amber − lost time (HCM).
 */
export function saturationFlow(seeds = SEEDS): number {
  const green = 40;
  const s = scenario([{ from: '1', to: '3', vehPerHour: 2400 }], throughPlan(green, 10));
  return mean(seeds, (seed) => {
    const sim = new Simulation({ ...s, seed });
    const cycle = green + 10 + 2 * 5;
    sim.run(cycle * 3);
    const before = sim.counts().exited;
    const cycles = 30;
    sim.run(cycle * cycles);
    const served = sim.counts().exited - before;
    // HCM: effective green is the displayed green plus amber, less start-up and clearance lost time (4 s).
    const effective = green + 3 - 4;
    return (served / (effective * cycles)) * 3600;
  });
}

/**
 * Webster's average delay at a fixed-time signal for one approach.
 * @param c cycle length (s), @param g effective green (s), @param q arrivals (veh/s), @param s saturation flow (veh/s)
 */
export function websterDelay(c: number, g: number, q: number, s: number): number {
  const lambda = g / c;
  const x = q / (lambda * s);
  if (x >= 1) return Infinity;
  return (c * (1 - lambda) ** 2) / (2 * (1 - lambda * x)) + (x * x) / (2 * q * (1 - x)) - 0.65 * Math.cbrt(c / (q * q)) * x ** (2 + 5 * lambda);
}

/** Simulated and Webster delay for straight-through traffic at a two-phase signal. */
export function signalDelay(vehPerHour: number, seeds = SEEDS, green = 30, crossGreen = 20): { simulated: number; webster: number } {
  const s = scenario(
    [
      { from: '1', to: '3', vehPerHour },
      { from: '3', to: '1', vehPerHour },
    ],
    throughPlan(green, crossGreen),
  );
  const simulated = mean(seeds, (seed) => {
    const sim = new Simulation({ ...s, seed });
    sim.run(600);
    sim.resetMetrics();
    sim.run(3600);
    return sim.getMetrics().avgDelay;
  });
  const cycle = green + crossGreen + 10;
  const sat = 1900 / 3600;
  return { simulated, webster: websterDelay(cycle, green + 3 - 4, vehPerHour / 3600, sat) };
}

/**
 * HCM 6th edition capacity of a one-lane roundabout entry facing one circulating lane, veh/h:
 * 1380 · e^(−0.00102 · circulating flow).
 */
export const hcmRoundaboutCapacity = (circulating: number) => 1380 * Math.exp(-0.00102 * circulating);

/**
 * Most an entry of a one-lane roundabout serves with this much traffic going round past it (veh/h).
 * Leg 1's entry is oversaturated; the circulating stream enters at leg 4, passes leg 1 and leaves at leg 3.
 */
export function roundaboutEntryCapacity(circulating: number, seeds = SEEDS): number {
  const vehicles: VehicleDemand[] = [{ from: '1', to: '3', vehPerHour: 2200 }];
  if (circulating > 0) vehicles.push({ from: '4', to: '3', vehPerHour: circulating });
  const s = scenario(vehicles, { type: 'roundabout' });
  return mean(seeds, (seed) => {
    const m = measure(s, seed);
    return ((m.legs.find((l) => l.leg === '1')?.completed ?? 0) / m.window) * 3600;
  });
}

/**
 * Gap-acceptance capacity of a minor movement crossing a major stream of `major` veh/h
 * (Harders / HCM): c = q·e^(−q·tc) / (1 − e^(−q·tf)), with critical headway tc and follow-up tf.
 */
export function gapAcceptanceCapacity(major: number, tc: number, tf: number): number {
  const q = major / 3600;
  if (q === 0) return 3600 / tf;
  return (3600 * q * Math.exp(-q * tc)) / (1 - Math.exp(-q * tf));
}

/** Critical headway and follow-up time (s) for crossing a major road at a give-way line, as in European practice. */
export const GIVE_WAY_GAPS = { tc: 5.5, tf: 3.3 };

/**
 * Most a give-way side road serves crossing a two-way major road: leg 2 goes straight across to leg 4
 * through `major` veh/h, split evenly between the two directions of legs 1 and 3. Also returns the
 * average delay on the major road, which should stay small however busy the side road is.
 */
export function giveWayCapacity(major: number, seeds = SEEDS): { capacity: number; majorDelay: number } {
  const vehicles: VehicleDemand[] = [{ from: '2', to: '4', vehPerHour: 2000 }];
  if (major > 0) vehicles.push({ from: '1', to: '3', vehPerHour: major / 2 }, { from: '3', to: '1', vehPerHour: major / 2 });
  const s = scenario(vehicles, { type: 'priority', major: ['1', '3'] });
  let majorDelay = 0;
  const capacity = mean(seeds, (seed) => {
    const m = measure(s, seed);
    majorDelay += (m.legs.find((l) => l.leg === '1')?.avgDelay ?? 0) / seeds.length;
    return ((m.legs.find((l) => l.leg === '2')?.completed ?? 0) / m.window) * 3600;
  });
  return { capacity, majorDelay };
}

/** Metrics over half an hour, after five minutes for the queues to build. */
function measure(s: Scenario, seed: number) {
  const sim = new Simulation({ ...s, seed });
  sim.run(300);
  sim.resetMetrics();
  sim.run(1800);
  return sim.getMetrics();
}
