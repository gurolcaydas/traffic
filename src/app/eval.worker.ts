/// <reference lib="webworker" />
// Runs single headless evaluation runs for the fair test, off the main thread.
import type { Scenario } from '../core/types';
import { runOnce, type RunResult } from '../sim/evaluate';

declare const self: DedicatedWorkerGlobalScope;

export interface EvalJob {
  job: number;
  scenario: Scenario;
  seed: number;
  warmup: number;
  duration: number;
}

export interface EvalResult {
  job: number;
  result: RunResult;
}

self.onmessage = (e: MessageEvent<EvalJob>) => {
  const { job, scenario, seed, warmup, duration } = e.data;
  self.postMessage({ job, result: runOnce(scenario, seed, warmup, duration) } satisfies EvalResult);
};
