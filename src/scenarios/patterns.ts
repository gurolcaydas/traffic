// Time-of-day traffic patterns. The demand table is read as peak-hour traffic; a pattern scales it
// through the day and can make it tidal (towards the centre in the morning, away in the evening).
import type { DemandPattern, LegId } from '../core/types';

export interface PatternPreset {
  label: string;
  description: string;
  /** Whether the pattern has a direction (and so needs a "centre" leg). */
  tidal: boolean;
  centreLabel?: string;
  make: (centreLeg: LegId) => DemandPattern;
}

export const PATTERNS: Record<string, PatternPreset> = {
  commuter: {
    label: 'Commuter day',
    description: 'Morning and evening rush hours, quieter midday. Mornings head into town, evenings out.',
    tidal: true,
    centreLabel: 'City centre is along leg',
    make: (centreLeg) => ({
      id: 'commuter',
      startHour: 6,
      endHour: 20,
      points: [[6, 0.25], [7, 0.6], [7.75, 1], [8.75, 1], [9.5, 0.6], [11, 0.5], [13, 0.6], [15, 0.55], [16.5, 0.85], [17.25, 1], [18.25, 1], [19, 0.6], [20, 0.35]],
      tide: [[6, 0.8], [9.5, 0.8], [11, 0], [15.5, 0], [16.5, -0.8], [20, -0.8]],
      centreLeg,
    }),
  },
  school: {
    label: 'School run',
    description: 'Two short, sharp peaks at drop-off and pick-up.',
    tidal: true,
    centreLabel: 'School is along leg',
    make: (centreLeg) => ({
      id: 'school',
      startHour: 7,
      endHour: 17,
      points: [[7, 0.35], [7.6, 0.75], [7.9, 1], [8.25, 1], [8.6, 0.45], [12, 0.4], [14.9, 0.45], [15.2, 0.9], [15.6, 0.9], [16, 0.45], [17, 0.4]],
      tide: [[7, 0.9], [8.6, 0.9], [9, 0], [14.9, 0], [15.1, -0.9], [17, -0.9]],
      centreLeg,
    }),
  },
  event: {
    label: 'Evening event',
    description: 'Quiet, then a crowd arrives for a match or concert, then everyone leaves at once.',
    tidal: true,
    centreLabel: 'Venue is along leg',
    make: (centreLeg) => ({
      id: 'event',
      startHour: 17,
      endHour: 24,
      points: [[17, 0.3], [18.5, 0.5], [19.2, 1], [19.75, 1], [20.25, 0.25], [21.9, 0.25], [22.2, 1], [22.8, 1], [23.4, 0.3], [24, 0.2]],
      tide: [[17, 1], [20.25, 1], [21.8, 0], [22, -1], [24, -1]],
      centreLeg,
    }),
  },
  weekend: {
    label: 'Weekend',
    description: 'A slow build to a long, gentle midday hump. No direction.',
    tidal: false,
    make: () => ({
      id: 'weekend',
      startHour: 8,
      endHour: 20,
      points: [[8, 0.2], [10, 0.45], [12, 0.7], [14, 0.75], [16, 0.65], [18, 0.45], [20, 0.25]],
    }),
  },
};

/** Piecewise-linear lookup, flat beyond the ends. */
export function interpolate(points: Array<[number, number]>, x: number): number {
  if (points.length === 0) return 1;
  if (x <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const [x0, y0] = points[i - 1]!;
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1]![1];
}

/** How strongly the tide tilts traffic: at full tide, trips into the centre are ×1.5 and trips out ×0.5. */
const TIDE_STRENGTH = 0.5;

/** Multiplier on the table's rate for a trip from → to at a given hour. */
export function demandFactor(pattern: DemandPattern | undefined, hour: number, from: LegId, to: LegId): number {
  if (!pattern) return 1;
  let f = interpolate(pattern.points, hour);
  if (pattern.tide && pattern.centreLeg) {
    const tide = interpolate(pattern.tide, hour);
    if (to === pattern.centreLeg) f *= 1 + TIDE_STRENGTH * tide;
    else if (from === pattern.centreLeg) f *= 1 - TIDE_STRENGTH * tide;
  }
  return Math.max(0, f);
}

/** The largest factor the pattern can reach, for thinning arrivals. */
export function maxDemandFactor(pattern: DemandPattern | undefined): number {
  if (!pattern) return 1;
  const peak = Math.max(...pattern.points.map(([, f]) => f));
  return pattern.tide && pattern.centreLeg ? peak * (1 + TIDE_STRENGTH) : peak;
}

/** Pedestrians follow the overall shape of the day, without a tide. */
export function pedFactor(pattern: DemandPattern | undefined, hour: number): number {
  return pattern ? Math.max(0, interpolate(pattern.points, hour)) : 1;
}

/** The start hour of the busiest `hours`-long window of the day. */
export function busiestWindow(pattern: DemandPattern, hours: number): number {
  let best = pattern.startHour;
  let bestSum = -Infinity;
  for (let start = pattern.startHour; start + hours <= pattern.endHour + 1e-9; start += 0.25) {
    let sum = 0;
    for (let h = start; h < start + hours; h += 0.25) sum += interpolate(pattern.points, h);
    if (sum > bestSum) {
      bestSum = sum;
      best = start;
    }
  }
  return best;
}

export const formatClock = (hour: number) => {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
