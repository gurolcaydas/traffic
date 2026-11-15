/** Intelligent Driver Model parameters (Treiber et al.). */
export interface IdmParams {
  /** Max acceleration, m/s² */
  a: number;
  /** Comfortable deceleration, m/s² */
  b: number;
  /** Desired time headway, s */
  T: number;
  /** Jam distance, m */
  s0: number;
}

export const DEFAULT_IDM: IdmParams = { a: 1.5, b: 2.0, T: 1.2, s0: 2.0 };
export const MAX_DECEL = 8;

/**
 * IDM acceleration.
 * @param v own speed
 * @param v0 desired speed
 * @param gap bumper-to-bumper distance to the obstacle ahead (Infinity for free road)
 * @param dv own speed minus leader speed
 */
export function idm(p: IdmParams, v: number, v0: number, gap: number, dv: number): number {
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  if (!Number.isFinite(gap)) return p.a * free;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
  const g = Math.max(gap, 0.01);
  return Math.max(-MAX_DECEL, p.a * (free - (sStar / g) ** 2));
}

/** Time to cover distance d starting at v, accelerating at a, capped at vmax. */
export function timeToTravel(d: number, v: number, a: number, vmax: number): number {
  if (d <= 0) return 0;
  const vm = Math.max(vmax, 0.1);
  if (v >= vm) return d / Math.max(v, 0.1);
  const t1 = (vm - v) / a;
  const d1 = v * t1 + 0.5 * a * t1 * t1;
  if (d <= d1) return (-v + Math.sqrt(v * v + 2 * a * d)) / a;
  return t1 + (d - d1) / vm;
}

/** Distance needed to stop from speed v at deceleration b. */
export const stoppingDistance = (v: number, b: number) => (v * v) / (2 * b);
