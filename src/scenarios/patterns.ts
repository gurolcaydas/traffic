// Time-of-day traffic patterns. The demand table is read as peak-hour traffic; a pattern scales it
// through the day and can make it tidal (towards the centre in the morning, away in the evening).
import { t } from '../core/i18n';
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
    get label() {
      return t('Commuter day', 'İşe gidiş-dönüş günü');
    },
    get description() {
      return t('Morning and evening rush hours, quieter midday. Mornings head into town, evenings out.', 'Sabah ve akşam yoğun saatleri, öğlen daha sakin. Sabahları şehre doğru, akşamları dışarı.');
    },
    tidal: true,
    get centreLabel() {
      return t('City centre is along leg', 'Şehir merkezi şu yol yönünde');
    },
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
    get label() {
      return t('School run', 'Okul saati');
    },
    get description() {
      return t('Two short, sharp peaks at drop-off and pick-up.', 'Okula bırakma ve alma saatlerinde iki kısa, keskin zirve.');
    },
    tidal: true,
    get centreLabel() {
      return t('School is along leg', 'Okul şu yol yönünde');
    },
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
    get label() {
      return t('Evening event', 'Akşam etkinliği');
    },
    get description() {
      return t('Quiet, then a crowd arrives for a match or concert, then everyone leaves at once.', 'Önce sakin, sonra bir maç ya da konser için kalabalık gelir, ardından herkes aynı anda ayrılır.');
    },
    tidal: true,
    get centreLabel() {
      return t('Venue is along leg', 'Etkinlik alanı şu yol yönünde');
    },
    make: (centreLeg) => ({
      id: 'event',
      startHour: 17,
      endHour: 24,
      points: [[17, 0.3], [18.5, 0.5], [19.2, 1], [19.75, 1], [20.25, 0.25], [21.9, 0.25], [22.2, 1], [22.8, 1], [23.4, 0.3], [24, 0.2]],
      tide: [[17, 1], [20.25, 1], [21.8, 0], [22, -1], [24, -1]],
      centreLeg,
    }),
  },
  peakHour: {
    get label() {
      return t('Peak hour', 'Zirve saat');
    },
    get description() {
      return t(
        'One busy hour, with a sharper 15-minute surge inside it, as real traffic counts show (a peak hour factor of about 0.9).',
        'Tek bir yoğun saat ve içinde, gerçek sayımlarda görüldüğü gibi, daha keskin 15 dakikalık bir dalga (zirve saat katsayısı yaklaşık 0,9).',
      );
    },
    tidal: false,
    make: () => ({
      id: 'peakHour',
      startHour: 7,
      endHour: 10,
      points: [[7, 0.5], [7.5, 0.8], [7.85, 0.95], [8.05, 1.12], [8.3, 1.12], [8.5, 0.95], [8.85, 0.8], [9.4, 0.55], [10, 0.5]],
    }),
  },
  weekend: {
    get label() {
      return t('Weekend', 'Hafta sonu');
    },
    get description() {
      return t('A slow build to a long, gentle midday hump. No direction.', 'Öğlene doğru yavaşça yükselen uzun, yumuşak bir tepe. Yön yok.');
    },
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

/**
 * Peak hour factor of a pattern (HCM): traffic in its busiest hour divided by four times the traffic in
 * the busiest 15 minutes within it. 1 is perfectly even; 0.85 to 0.95 is typical of a city junction.
 */
export function peakHourFactor(pattern: DemandPattern): number {
  const integral = (from: number, to: number) => {
    let sum = 0;
    for (let h = from; h < to - 1e-9; h += 1 / 120) sum += interpolate(pattern.points, h + 1 / 240) / 120;
    return sum;
  };
  const start = busiestWindow(pattern, 1, 1 / 60);
  let peak15 = 0;
  for (let q = start; q + 0.25 <= start + 1 + 1e-9; q += 1 / 60) peak15 = Math.max(peak15, integral(q, q + 0.25));
  return integral(start, start + 1) / (4 * peak15);
}

/** The start hour of the busiest `hours`-long window of the day. */
export function busiestWindow(pattern: DemandPattern, hours: number, step = 0.25): number {
  let best = pattern.startHour;
  let bestSum = -Infinity;
  for (let start = pattern.startHour; start + hours <= pattern.endHour + 1e-9; start += step) {
    let sum = 0;
    for (let h = start; h < start + hours; h += step) sum += interpolate(pattern.points, h);
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
