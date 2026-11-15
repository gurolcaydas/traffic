// Scoring a level: the design is run several times on the level's traffic (the same traffic for
// every player and every attempt), then judged on average delay, gridlock and the level's rules.
import type { Scenario } from '../core/types';
import { makePlan, summarize, type RunResult, type TestPlan } from '../sim/evaluate';
import { crossingOf } from '../scenarios/edit';
import { costItems, totalCost } from './costs';
import type { Level, LevelResult } from './types';

/**
 * Time lost by a trip that can't use the junction because its turn is banned: it goes round the
 * block instead. Without this, banning turns would make delay vanish by sending traffic elsewhere.
 */
export const DETOUR_SECONDS = 90;

/** Every level is judged on the same four traffic seeds, over the busiest hours if it has a day pattern. */
export function levelPlan(level: Level): TestPlan {
  return makePlan('quick', level.scenario.demand.pattern, 'peak');
}

/** Rules a design must meet before it may even be tested. */
export function designProblems(level: Level, design: Scenario): string[] {
  const problems: string[] = [];
  const cost = totalCost(costItems(level.scenario, design));
  if (cost > level.budget) problems.push(`Over budget by ${cost - level.budget}.`);
  for (const leg of level.requiredCrossings ?? []) {
    if (crossingOf(design, leg) === 'none') problems.push(`The crossing on leg ${leg} must stay.`);
  }
  return problems;
}

export function scoreRuns(level: Level, design: Scenario, runs: RunResult[]): LevelResult {
  const summary = summarize(runs, design.control.type === 'signals');
  // Diverted trips count as a detour, weighted by how many there were against the trips served.
  const withDetours = (r: RunResult) => (r.avgDelay * r.throughput + DETOUR_SECONDS * r.divertedPerHour) / Math.max(1, r.throughput + r.divertedPerHour);
  const avgDelay = runs.reduce((s, r) => s + withDetours(r), 0) / Math.max(1, runs.length);
  const gridlockRuns = runs.filter((r) => r.gridlock).length;
  const failures = [...designProblems(level, design)];
  if (gridlockRuns) failures.push(`Gridlock in ${gridlockRuns} of ${runs.length} runs: queues spilled off the map.`);
  if (level.maxPedWait !== undefined && summary.pedWait.mean > level.maxPedWait) {
    failures.push(`Pedestrians waited ${Math.round(summary.pedWait.mean)} s on average; the limit is ${level.maxPedWait} s.`);
  }
  const passed = failures.length === 0 && avgDelay <= level.stars[0];
  if (failures.length === 0 && !passed) failures.push(`Average delay ${Math.round(avgDelay)} s; one star needs ${level.stars[0]} s or less.`);
  const stars = !passed ? 0 : avgDelay <= level.stars[2] ? 3 : avgDelay <= level.stars[1] ? 2 : 1;
  return {
    stars,
    passed,
    failures,
    avgDelay,
    delayCi: summary.avgDelay.ci,
    worst15Delay: summary.worst15Delay.mean,
    throughput: summary.throughput.mean,
    pedWait: summary.pedWait.mean,
    gridlockRuns,
    runs: runs.length,
    cost: totalCost(costItems(level.scenario, design)),
  };
}
