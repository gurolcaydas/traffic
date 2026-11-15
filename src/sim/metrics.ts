import type { LegId } from '../core/types';

export type Los = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

// HCM average control delay thresholds (seconds per vehicle).
const SIGNAL_LOS = [10, 20, 35, 55, 80];
const UNSIGNAL_LOS = [10, 15, 25, 35, 50];

export function levelOfService(avgDelay: number, signalised: boolean): Los {
  const t = signalised ? SIGNAL_LOS : UNSIGNAL_LOS;
  const grades: Los[] = ['A', 'B', 'C', 'D', 'E'];
  for (let i = 0; i < t.length; i++) if (avgDelay <= t[i]!) return grades[i]!;
  return 'F';
}

export interface LegMetrics {
  leg: LegId;
  /** Vehicles currently queued (slow on the approach, or waiting to enter the map). */
  queue: number;
  maxQueue: number;
  /** Vehicles that could not even enter the map yet. Growing = spillback. */
  backlog: number;
  completed: number;
  avgDelay: number;
}

export interface MetricsSnapshot {
  /** Seconds of simulated time the metrics cover. */
  window: number;
  completed: number;
  throughputPerHour: number;
  avgDelay: number;
  los: Los;
  pedCrossed: number;
  pedAvgWait: number;
  legs: LegMetrics[];
  gridlock: boolean;
}

interface LegAccumulator {
  completed: number;
  delay: number;
  maxQueue: number;
}

export class MetricsCollector {
  private start = 0;
  private completed = 0;
  private delay = 0;
  private pedCrossed = 0;
  private pedWait = 0;
  private legs = new Map<LegId, LegAccumulator>();

  constructor(legIds: LegId[], time = 0) {
    this.reset(legIds, time);
  }

  reset(legIds: LegId[], time: number) {
    this.start = time;
    this.completed = 0;
    this.delay = 0;
    this.pedCrossed = 0;
    this.pedWait = 0;
    this.legs = new Map(legIds.map((id) => [id, { completed: 0, delay: 0, maxQueue: 0 }]));
  }

  recordTrip(from: LegId, delay: number) {
    this.completed++;
    this.delay += delay;
    const l = this.legs.get(from);
    if (l) {
      l.completed++;
      l.delay += delay;
    }
  }

  recordCrossing(wait: number) {
    this.pedCrossed++;
    this.pedWait += wait;
  }

  observeQueue(leg: LegId, queue: number) {
    const l = this.legs.get(leg);
    if (l && queue > l.maxQueue) l.maxQueue = queue;
  }

  snapshot(
    time: number,
    signalised: boolean,
    current: Map<LegId, { queue: number; backlog: number }>,
    gridlock: boolean,
  ): MetricsSnapshot {
    const window = Math.max(time - this.start, 1e-9);
    const avgDelay = this.completed ? this.delay / this.completed : 0;
    return {
      window,
      completed: this.completed,
      throughputPerHour: (this.completed / window) * 3600,
      avgDelay,
      los: levelOfService(avgDelay, signalised),
      pedCrossed: this.pedCrossed,
      pedAvgWait: this.pedCrossed ? this.pedWait / this.pedCrossed : 0,
      legs: [...this.legs].map(([leg, a]) => ({
        leg,
        queue: current.get(leg)?.queue ?? 0,
        backlog: current.get(leg)?.backlog ?? 0,
        maxQueue: a.maxQueue,
        completed: a.completed,
        avgDelay: a.completed ? a.delay / a.completed : 0,
      })),
      gridlock,
    };
  }
}
