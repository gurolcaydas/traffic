import { DEFAULTS, type ControlSpec } from '../core/types';

export type SignalState = 'green' | 'amber' | 'red';

export interface SignalClock {
  phase: number;
  stage: 'green' | 'amber' | 'allRed';
  /** Seconds left in the current stage. */
  remaining: number;
}

/**
 * Runs a signal plan phase by phase. Unlike reading the clock off "time modulo cycle", it keeps its
 * place when the plan is edited: a longer green extends the green that is showing, instead of the
 * whole junction jumping to another phase mid-flow.
 */
export class SignalController {
  private phase = 0;
  private stage: SignalClock['stage'] = 'green';
  private elapsed = 0;

  constructor(private control: ControlSpec) {}

  /** Switch to an edited plan, keeping the current phase and how long it has been showing. */
  setControl(control: ControlSpec) {
    const wasSignals = this.control.type === 'signals';
    this.control = control;
    if (control.type !== 'signals' || control.phases.length === 0) return;
    if (!wasSignals || this.phase >= control.phases.length) {
      this.phase = 0;
      this.stage = 'green';
      this.elapsed = 0;
      return;
    }
    // A green cut shorter than it has already been showing ends now.
    if (this.stage === 'green' && this.elapsed > control.phases[this.phase]!.green) {
      this.stage = 'amber';
      this.elapsed = 0;
    }
  }

  step(dt: number) {
    if (this.control.type !== 'signals' || this.control.phases.length === 0) return;
    this.elapsed += dt;
    for (let guard = 0; guard < 16 && this.elapsed >= this.duration(); guard++) {
      this.elapsed -= this.duration();
      if (this.stage === 'green') this.stage = 'amber';
      else if (this.stage === 'amber') this.stage = 'allRed';
      else {
        this.stage = 'green';
        this.phase = (this.phase + 1) % this.control.phases.length;
      }
    }
  }

  clock(): SignalClock | null {
    if (this.control.type !== 'signals' || this.control.phases.length === 0) return null;
    return { phase: this.phase, stage: this.stage, remaining: this.duration() - this.elapsed };
  }

  private duration(): number {
    if (this.control.type !== 'signals') return Infinity;
    if (this.stage === 'green') return this.control.phases[this.phase]!.green;
    if (this.stage === 'amber') return this.control.amber ?? DEFAULTS.amber;
    return this.control.allRed ?? DEFAULTS.allRed;
  }
}

/** State of a signal group that is green in `greenPhases`. */
export function stateFor(clock: SignalClock | null, greenPhases: number[]): SignalState {
  if (!clock) return 'green';
  if (!greenPhases.includes(clock.phase)) return 'red';
  if (clock.stage === 'green') return 'green';
  if (clock.stage === 'amber') return 'amber';
  return 'red';
}

/** Signal for a movement; slip lanes and flyovers are not signalised. */
export function connectorSignal(clock: SignalClock | null, conn: { controlled: boolean; greenPhases: number[] }): SignalState {
  return conn.controlled ? stateFor(clock, conn.greenPhases) : 'green';
}
