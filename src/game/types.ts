import type { LegId, Scenario } from '../core/types';
import type { ControlChoice } from '../scenarios/setup';

/** What the player may change in a level. Anything not listed is fixed. */
export interface LevelTools {
  /** Control types the player may switch to (the level's starting control is always allowed). */
  control: ControlChoice[];
  /** Add or remove lanes. */
  lanes: boolean;
  sideRoads: boolean;
  flyover: boolean;
  crossings: boolean;
  bans: boolean;
  /** Edit signal phases and green times. */
  signalPlan: boolean;
}

export interface Level {
  id: string;
  title: string;
  /** The situation, in the voice of whoever asked for help. */
  brief: string;
  /** Hint shown once a level has been failed or on request. */
  hint: string;
  scenario: Scenario;
  budget: number;
  tools: LevelTools;
  /** No lane may be added on these legs (buildings line the street). */
  fixedLanes?: LegId[];
  /** Corners with a building: no side road from this leg. */
  blockedCorners?: LegId[];
  /** Crossings that must stay (school, hospital, ...). */
  requiredCrossings?: LegId[];
  /** Hard limit on average pedestrian wait, seconds. */
  maxPedWait?: number;
  /** Average delay (s) needed for one, two and three stars; lower is better. */
  stars: [number, number, number];
}

export interface CostItem {
  label: string;
  cost: number;
}

export interface LevelResult {
  stars: 0 | 1 | 2 | 3;
  passed: boolean;
  /** Why the design failed, if it did. */
  failures: string[];
  avgDelay: number;
  delayCi: number;
  worst15Delay: number;
  throughput: number;
  pedWait: number;
  gridlockRuns: number;
  /** Runs that ended with queues spilling off the map. */
  overloadedRuns: number;
  runs: number;
  cost: number;
}
