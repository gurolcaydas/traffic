// Fair, repeatable testing of a design: run it headless several times with different random
// traffic, and compare two designs run for run on exactly the same traffic.
import type { Scenario } from '../core/types';
import { levelOfService, type Los } from './metrics';
import { Simulation } from './simulation';

export interface TestPlan {
  /** Random-traffic seeds; each design is run once per seed. */
  seeds: number[];
  /** Seconds simulated before measuring, so the junction fills up first. */
  warmup: number;
  /** Seconds measured. */
  duration: number;
}

export const TEST_PLANS = {
  quick: { label: 'Quick', runs: 4, minutes: 15 },
  standard: { label: 'Standard', runs: 6, minutes: 30 },
  thorough: { label: 'Thorough', runs: 10, minutes: 60 },
} as const;

export type TestLength = keyof typeof TEST_PLANS;

export function makePlan(length: TestLength): TestPlan {
  const p = TEST_PLANS[length];
  return { seeds: Array.from({ length: p.runs }, (_, i) => 101 + i), warmup: 300, duration: p.minutes * 60 };
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
  gridlock: boolean;
}

export function runOnce(scenario: Scenario, seed: number, warmup: number, duration: number): RunResult {
  const sim = new Simulation({ ...scenario, seed });
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
    gridlock: m.gridlock,
  };
}

export type MetricKey = 'avgDelay' | 'throughput' | 'worstQueue' | 'pedWait' | 'divertedPerHour';

/** Mean and the half-width of its 95% confidence interval. */
export interface Estimate {
  mean: number;
  ci: number;
}

export interface DesignSummary {
  runs: RunResult[];
  avgDelay: Estimate;
  throughput: Estimate;
  worstQueue: Estimate;
  pedWait: Estimate;
  divertedPerHour: Estimate;
  los: Los;
  /** Share of runs that ended in gridlock. */
  gridlockRate: number;
}

export function summarize(runs: RunResult[], signalised: boolean): DesignSummary {
  const est = (k: MetricKey) => estimate(runs.map((r) => r[k]));
  const avgDelay = est('avgDelay');
  return {
    runs,
    avgDelay,
    throughput: est('throughput'),
    worstQueue: est('worstQueue'),
    pedWait: est('pedWait'),
    divertedPerHour: est('divertedPerHour'),
    los: levelOfService(avgDelay.mean, signalised),
    gridlockRate: runs.filter((r) => r.gridlock).length / Math.max(1, runs.length),
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
