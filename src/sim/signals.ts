import { DEFAULTS, type ControlSpec } from '../core/types';

export type SignalState = 'green' | 'amber' | 'red';

export interface SignalClock {
  phase: number;
  /** The phase after this one. */
  next: number;
  stage: 'green' | 'amber' | 'allRed';
  /** Seconds left in the current stage. */
  remaining: number;
}

/** What the detectors of traffic-responsive signals see. */
export interface SignalDemand {
  /** Traffic is still arriving for this phase's green, or queued at its line. */
  arriving(phase: number): boolean;
  /** Someone (a driver or a pedestrian) is waiting at a red that another phase would serve. */
  waitingElsewhere(phase: number): boolean;
}

/** Shortest green a traffic-responsive signal shows, s. */
export const MIN_GREEN = 6;

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

  step(dt: number, demand?: SignalDemand) {
    if (this.control.type !== 'signals' || this.control.phases.length === 0) return;
    this.elapsed += dt;
    if (this.control.actuated && demand && this.stage === 'green') {
      // Gap out once traffic for this green has stopped coming; max out at the plan's green. Either way
      // only if someone else is waiting: with nobody at a red, the green rests where it is.
      if (this.elapsed < MIN_GREEN || !demand.waitingElsewhere(this.phase)) return;
      if (this.elapsed < this.control.phases[this.phase]!.green && demand.arriving(this.phase)) return;
      this.stage = 'amber';
      this.elapsed = 0;
      return;
    }
    for (let guard = 0; guard < 16 && this.elapsed >= this.duration(); guard++) {
      this.elapsed -= this.duration();
      if (this.stage === 'green') this.stage = 'amber';
      else if (this.stage === 'amber') this.stage = 'allRed';
      else {
        this.stage = 'green';
        this.phase = (this.phase + 1) % this.control.phases.length;
        if (this.control.actuated && demand) break;
      }
    }
  }

  clock(): SignalClock | null {
    if (this.control.type !== 'signals' || this.control.phases.length === 0) return null;
    return { phase: this.phase, next: (this.phase + 1) % this.control.phases.length, stage: this.stage, remaining: this.duration() - this.elapsed };
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

/**
 * A signalised roundabout's ring stop line before a leg's entry: red while that entry has green,
 * clearing (amber, then red) before it gets green, and green the rest of the time.
 */
export function ringStopState(clock: SignalClock | null, entryPhases: number[]): SignalState {
  if (!clock) return 'green';
  if (entryPhases.includes(clock.phase)) return 'red';
  if (clock.stage !== 'green' && entryPhases.includes(clock.next)) return clock.stage === 'amber' ? 'amber' : 'red';
  return 'green';
}

/** Signal for a movement; slip lanes and flyovers are not signalised. */
export function connectorSignal(clock: SignalClock | null, conn: { controlled: boolean; greenPhases: number[] }): SignalState {
  return conn.controlled ? stateFor(clock, conn.greenPhases) : 'green';
}
