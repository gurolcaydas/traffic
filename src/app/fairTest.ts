import type { Scenario } from '../core/types';
import type { RunResult, TestPlan } from '../sim/evaluate';
import type { EvalJob, EvalResult } from './eval.worker';

export interface FairTestRun {
  /** Resolves with each design's runs, in seed order. */
  done: Promise<{ reference: RunResult[]; candidate: RunResult[] }>;
  cancel: () => void;
}

/**
 * Run both designs on every seed in the plan, spread over a small pool of workers.
 * `onProgress` gets the fraction of runs finished.
 */
export function runFairTest(reference: Scenario, candidate: Scenario, plan: TestPlan, onProgress: (fraction: number) => void): FairTestRun {
  const run = runDesigns([reference, candidate], plan, onProgress);
  return { done: run.done.then(([reference, candidate]) => ({ reference: reference!, candidate: candidate! })), cancel: run.cancel };
}

/** Run each design on every seed in the plan; resolves with one list of runs per design, in seed order. */
export function runDesigns(designs: Scenario[], plan: TestPlan, onProgress: (fraction: number) => void): { done: Promise<RunResult[][]>; cancel: () => void } {
  const jobs: EvalJob[] = [];
  for (const scenario of designs) {
    for (const seed of plan.seeds) jobs.push({ job: jobs.length, scenario, seed, warmup: plan.warmup, duration: plan.duration, startHour: plan.startHour });
  }
  const size = Math.max(1, Math.min(jobs.length, (navigator.hardwareConcurrency || 4) - 1, 6));
  const workers = Array.from({ length: size }, () => new Worker(new URL('./eval.worker.ts', import.meta.url), { type: 'module' }));
  const results: RunResult[] = new Array(jobs.length);
  let next = 0;
  let finished = 0;
  let cancelled = false;

  const done = new Promise<RunResult[][]>((resolve, reject) => {
    const feed = (w: Worker) => {
      if (next < jobs.length) w.postMessage(jobs[next++]);
    };
    for (const w of workers) {
      w.onmessage = (e: MessageEvent<EvalResult>) => {
        results[e.data.job] = e.data.result;
        finished++;
        onProgress(finished / jobs.length);
        if (finished === jobs.length) {
          workers.forEach((x) => x.terminate());
          const n = plan.seeds.length;
          resolve(designs.map((_, i) => results.slice(i * n, (i + 1) * n)));
        } else feed(w);
      };
      w.onerror = (err) => {
        workers.forEach((x) => x.terminate());
        reject(err);
      };
      feed(w);
    }
  });

  return {
    done,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      workers.forEach((w) => w.terminate());
    },
  };
}
