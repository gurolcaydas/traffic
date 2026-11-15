import type { Scenario } from '../core/types';
import type { MetricsSnapshot } from '../sim/metrics';
import type { SignalClock } from '../sim/signals';

/** Floats per vehicle in a frame: x, y, heading, length, exit-leg index, acceleration. */
export const VEH_STRIDE = 6;
/** Floats per pedestrian in a frame: x, y, crossing (0/1). */
export const PED_STRIDE = 3;

export type ToWorker =
  | { type: 'load'; scenario: Scenario }
  | { type: 'setDemand'; demand: Scenario['demand'] }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; speed: number }
  | { type: 'resetMetrics' };

export interface Frame {
  type: 'frame';
  /** Simulated seconds. */
  time: number;
  clock: SignalClock | null;
  vehIds: Int32Array;
  veh: Float32Array;
  pedIds: Int32Array;
  peds: Float32Array;
}

export type FromWorker = Frame | { type: 'metrics'; metrics: MetricsSnapshot };
