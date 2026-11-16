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
  /** Trips that could not use this junction because their turn is banned. */
  diverted: number;
  /** Average delay in the worst 15 minutes measured so far (the "peak 15 minutes"). */
  worst15Delay: number;
  legs: LegMetrics[];
  /** Traffic in the junction has stopped moving: drivers are blocking each other. */
  gridlock: boolean;
  /** Whether it gridlocked at any point since the metrics started, even if it later came free. */
  gridlockSeen: boolean;
  /** Queues are spilling off the map: more traffic arrives than the junction can serve. */
  overloaded: boolean;
}

interface LegAccumulator {
  completed: number;
  /** Vehicle-seconds lost to waiting and slowing, by trips that arrived since the metrics started. */
  lost: number;
  arrivals: number;
  maxQueue: number;
}

export class MetricsCollector {
  private start = 0;
  private completed = 0;
  private lost = 0;
  private arrivals = 0;
  private pedCrossed = 0;
  private pedWait = 0;
  private diverted = 0;
  /** Per-minute buckets of lost time and arrivals, for the worst 15 minutes. */
  private minutes: Array<{ lost: number; arrivals: number }> = [];
  private legs = new Map<LegId, LegAccumulator>();

  constructor(legIds: LegId[], time = 0) {
    this.reset(legIds, time);
  }

  reset(legIds: LegId[], time: number) {
    this.start = time;
    this.completed = 0;
    this.lost = 0;
    this.arrivals = 0;
    this.pedCrossed = 0;
    this.pedWait = 0;
    this.diverted = 0;
    this.minutes = [];
    this.legs = new Map(legIds.map((id) => [id, { completed: 0, lost: 0, arrivals: 0, maxQueue: 0 }]));
  }

  /** When the current measurement window began. Trips that arrived earlier don't count towards delay. */
  get startTime() {
    return this.start;
  }

  private minute(time: number) {
    const i = Math.max(0, Math.floor((time - this.start) / 60));
    while (this.minutes.length <= i) this.minutes.push({ lost: 0, arrivals: 0 });
    return this.minutes[i]!;
  }

  recordArrival(leg: LegId, time: number) {
    this.arrivals++;
    this.minute(time).arrivals++;
    const l = this.legs.get(leg);
    if (l) l.arrivals++;
  }

  /**
   * Delay is accumulated while it happens rather than when trips finish, so a queue that hasn't
   * cleared yet still counts. Only trips that arrived in the current window are passed in here.
   */
  addLostTime(leg: LegId, seconds: number, time: number) {
    this.lost += seconds;
    this.minute(time).lost += seconds;
    const l = this.legs.get(leg);
    if (l) l.lost += seconds;
  }

  recordTrip(from: LegId) {
    this.completed++;
    const l = this.legs.get(from);
    if (l) l.completed++;
  }

  recordDiverted() {
    this.diverted++;
  }

  /** After a layout edit: start tracking legs that are new, keep the rest. */
  ensureLegs(legIds: LegId[]) {
    for (const id of legIds) if (!this.legs.has(id)) this.legs.set(id, { completed: 0, lost: 0, arrivals: 0, maxQueue: 0 });
    for (const id of [...this.legs.keys()]) if (!legIds.includes(id)) this.legs.delete(id);
  }

  recordCrossing(wait: number) {
    this.pedCrossed++;
    this.pedWait += wait;
  }

  observeQueue(leg: LegId, queue: number) {
    const l = this.legs.get(leg);
    if (l && queue > l.maxQueue) l.maxQueue = queue;
  }

  /** Highest average delay over any `n` consecutive minutes with enough traffic to judge. */
  private worstWindow(n: number): number {
    if (this.minutes.length < n) return this.arrivals ? this.lost / this.arrivals : 0;
    let worst = 0;
    let lost = 0;
    let arrivals = 0;
    for (let i = 0; i < this.minutes.length; i++) {
      lost += this.minutes[i]!.lost;
      arrivals += this.minutes[i]!.arrivals;
      if (i >= n) {
        lost -= this.minutes[i - n]!.lost;
        arrivals -= this.minutes[i - n]!.arrivals;
      }
      if (i >= n - 1 && arrivals >= 10) worst = Math.max(worst, lost / arrivals);
    }
    return worst;
  }

  snapshot(
    time: number,
    signalised: boolean,
    current: Map<LegId, { queue: number; backlog: number }>,
    state: Pick<MetricsSnapshot, 'gridlock' | 'gridlockSeen' | 'overloaded'>,
  ): MetricsSnapshot {
    const window = Math.max(time - this.start, 1e-9);
    const avgDelay = this.arrivals ? this.lost / this.arrivals : 0;
    return {
      window,
      completed: this.completed,
      throughputPerHour: (this.completed / window) * 3600,
      avgDelay,
      los: levelOfService(avgDelay, signalised),
      pedCrossed: this.pedCrossed,
      pedAvgWait: this.pedCrossed ? this.pedWait / this.pedCrossed : 0,
      diverted: this.diverted,
      worst15Delay: this.worstWindow(15),
      legs: [...this.legs].map(([leg, a]) => ({
        leg,
        queue: current.get(leg)?.queue ?? 0,
        backlog: current.get(leg)?.backlog ?? 0,
        maxQueue: a.maxQueue,
        completed: a.completed,
        avgDelay: a.arrivals ? a.lost / a.arrivals : 0,
      })),
      ...state,
    };
  }
}
