// Fair, repeatable testing of a design: run it headless several times with different random
// traffic, and compare two designs run for run on exactly the same traffic.
import { t } from '../core/i18n';
import type { DemandPattern, Scenario } from '../core/types';
import { busiestWindow } from '../scenarios/patterns';
import { levelOfService, type Los } from './metrics';
import { Simulation } from './simulation';

export interface TestPlan {
  /** Random-traffic seeds; each design is run once per seed. */
  seeds: number[];
  /** Seconds simulated before measuring, so the junction fills up first. */
  warmup: number;
  /** Seconds measured. */
  duration: number;
  /** With a demand pattern: the clock time measuring starts at, in hours. */
  startHour?: number;
}

/** Which part of a patterned day a test covers. */
export type TestWindow = 'peak' | 'day';

/** Hours in the "busiest hours" window. */
export const PEAK_HOURS = 3;

export const TEST_PLANS = {
  quick: {
    get label() {
      return t('Quick', 'Hızlı');
    },
    runs: 4, minutes: 15,
  },
  standard: {
    get label() {
      return t('Standard', 'Standart');
    },
    runs: 6, minutes: 30,
  },
  thorough: {
    get label() {
      return t('Thorough', 'Kapsamlı');
    },
    runs: 10, minutes: 60,
  },
} as const;

export type TestLength = keyof typeof TEST_PLANS;

export function makePlan(length: TestLength, pattern?: DemandPattern, window: TestWindow = 'peak'): TestPlan {
  const p = TEST_PLANS[length];
  const seeds = Array.from({ length: p.runs }, (_, i) => 101 + i);
  if (!pattern) return { seeds, warmup: 300, duration: p.minutes * 60 };
  // With a pattern, the window decides how long each run is; the test length only sets how many runs.
  if (window === 'day') return { seeds, warmup: 900, duration: (pattern.endHour - pattern.startHour) * 3600, startHour: pattern.startHour };
  return { seeds, warmup: 1800, duration: PEAK_HOURS * 3600, startHour: busiestWindow(pattern, PEAK_HOURS) };
}

/** What one run measured. */
export interface RunResult {
  seed: number;
  avgDelay: number;
  throughput: number;
  /** Longest queue seen on any approach, vehicles. */
  worstQueue: number;
  pedWait: number;
  divertedPerHour: number;
  /** Average delay in the worst 15 minutes of the run. */
  worst15Delay: number;
  /** The junction knotted up at some point in the run. */
  gridlock: boolean;
  /** Queues were spilling off the map at the end of the run. */
  overloaded: boolean;
}

export function runOnce(scenario: Scenario, seed: number, warmup: number, duration: number, startHour?: number): RunResult {
  const sim = new Simulation({ ...scenario, seed });
  // Start the clock early enough that warm-up ends exactly when measuring should begin.
  if (startHour !== undefined && scenario.demand.pattern) sim.setTimeOfDay(startHour - warmup / 3600);
  sim.run(warmup);
  sim.resetMetrics();
  sim.run(duration);
  const m = sim.getMetrics();
  return {
    seed,
    avgDelay: m.avgDelay,
    throughput: m.throughputPerHour,
    worstQueue: Math.max(0, ...m.legs.map((l) => l.maxQueue)),
    pedWait: m.pedAvgWait,
    divertedPerHour: (m.diverted / m.window) * 3600,
    worst15Delay: m.worst15Delay,
    gridlock: m.gridlockSeen,
    overloaded: m.overloaded,
  };
}

export type MetricKey = 'avgDelay' | 'worst15Delay' | 'throughput' | 'worstQueue' | 'pedWait' | 'divertedPerHour';

/** Mean and the half-width of its 95% confidence interval. */
export interface Estimate {
  mean: number;
  ci: number;
}

export interface DesignSummary {
  runs: RunResult[];
  avgDelay: Estimate;
  worst15Delay: Estimate;
  throughput: Estimate;
  worstQueue: Estimate;
  pedWait: Estimate;
  divertedPerHour: Estimate;
  los: Los;
  /** Share of runs that ended in gridlock. */
  gridlockRate: number;
  /** Share of runs that ended with queues spilling off the map. */
  overloadRate: number;
}

export function summarize(runs: RunResult[], signalised: boolean): DesignSummary {
  const est = (k: MetricKey) => estimate(runs.map((r) => r[k]));
  const avgDelay = est('avgDelay');
  return {
    runs,
    avgDelay,
    worst15Delay: est('worst15Delay'),
    throughput: est('throughput'),
    worstQueue: est('worstQueue'),
    pedWait: est('pedWait'),
    divertedPerHour: est('divertedPerHour'),
    los: levelOfService(avgDelay.mean, signalised),
    gridlockRate: runs.filter((r) => r.gridlock).length / Math.max(1, runs.length),
    overloadRate: runs.filter((r) => r.overloaded).length / Math.max(1, runs.length),
  };
}

export type Verdict = 'better' | 'worse' | 'unclear';

export interface Difference extends Estimate {
  verdict: Verdict;
}

/**
 * Paired comparison of candidate against reference on one metric. Both ran on the same seeds, so
 * the run-by-run differences cancel out the luck of the traffic and leave the effect of the design.
 */
export function compare(reference: RunResult[], candidate: RunResult[], key: MetricKey, lowerIsBetter: boolean): Difference {
  const bySeed = new Map(reference.map((r) => [r.seed, r[key]]));
  const diffs = candidate.filter((c) => bySeed.has(c.seed)).map((c) => c[key] - bySeed.get(c.seed)!);
  const e = estimate(diffs);
  // A difference this small is noise whatever the statistics say.
  const negligible = Math.abs(e.mean) < 0.03 * Math.max(1, Math.abs(meanOf(reference.map((r) => r[key]))));
  let verdict: Verdict = 'unclear';
  if (!negligible && Math.abs(e.mean) > e.ci) verdict = e.mean < 0 === lowerIsBetter ? 'better' : 'worse';
  return { ...e, verdict };
}

function estimate(xs: number[]): Estimate {
  const n = xs.length;
  if (n === 0) return { mean: 0, ci: 0 };
  const mean = meanOf(xs);
  if (n === 1) return { mean, ci: Infinity };
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  return { mean, ci: tCritical(n - 1) * (sd / Math.sqrt(n)) };
}

const meanOf = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

/** Two-sided 95% Student's t critical value. */
function tCritical(df: number): number {
  const table = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131];
  return table[df - 1] ?? 1.96 + 2.5 / df;
}
