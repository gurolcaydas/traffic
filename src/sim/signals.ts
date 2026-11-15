import { DEFAULTS, type ControlSpec } from '../core/types';

export type SignalState = 'green' | 'amber' | 'red';

export interface SignalClock {
  phase: number;
  stage: 'green' | 'amber' | 'allRed';
  /** Seconds left in the current stage. */
  remaining: number;
}

export function signalClock(control: ControlSpec, time: number): SignalClock | null {
  if (control.type !== 'signals' || control.phases.length === 0) return null;
  const amber = control.amber ?? DEFAULTS.amber;
  const allRed = control.allRed ?? DEFAULTS.allRed;
  const cycle = control.phases.reduce((sum, p) => sum + p.green + amber + allRed, 0);
  let t = time % cycle;
  for (let i = 0; i < control.phases.length; i++) {
    const g = control.phases[i]!.green;
    if (t < g) return { phase: i, stage: 'green', remaining: g - t };
    t -= g;
    if (t < amber) return { phase: i, stage: 'amber', remaining: amber - t };
    t -= amber;
    if (t < allRed) return { phase: i, stage: 'allRed', remaining: allRed - t };
    t -= allRed;
  }
  return { phase: 0, stage: 'green', remaining: 0 };
}

/** State of a signal group that is green in `greenPhases`. */
export function stateFor(clock: SignalClock | null, greenPhases: number[]): SignalState {
  if (!clock) return 'green';
  if (!greenPhases.includes(clock.phase)) return 'red';
  if (clock.stage === 'green') return 'green';
  if (clock.stage === 'amber') return 'amber';
  return 'red';
}
