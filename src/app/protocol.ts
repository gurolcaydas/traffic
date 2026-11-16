import type { Scenario } from '../core/types';
import type { MetricsSnapshot } from '../sim/metrics';
import type { SignalClock } from '../sim/signals';
import type { TrendSample } from '../sim/simulation';

/** Floats per vehicle in a frame: x, y, heading, length, exit-leg index, acceleration, level (0 ground, 1 bridge). */
export const VEH_STRIDE = 7;
/** Floats per pedestrian in a frame: x, y, crossing (0/1). */
export const PED_STRIDE = 3;

export type ToWorker =
  | { type: 'load'; scenario: Scenario }
  /** Edited layout: swap it in without stopping the traffic, and start measuring afresh. */
  | { type: 'apply'; scenario: Scenario }
  | { type: 'setDemand'; demand: Scenario['demand'] }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; speed: number }
  | { type: 'resetMetrics' }
  /** Jump the time-of-day clock (with a demand pattern). */
  | { type: 'timeOfDay'; hour: number };

export interface Frame {
  type: 'frame';
  /** Simulated seconds. */
  time: number;
  clock: SignalClock | null;
  /** Clock time in hours when a demand pattern is active. */
  timeOfDay: number | null;
  vehIds: Int32Array;
  veh: Float32Array;
  pedIds: Int32Array;
  peds: Float32Array;
}

export type FromWorker = Frame | { type: 'metrics'; metrics: MetricsSnapshot; trend: TrendSample[] };
