export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const fromAngleDeg = (deg: number): Vec2 => {
  const r = (deg * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
};
/** Rotate 90° counter-clockwise (left of the direction, in y-up coordinates). */
export const perpLeft = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

/** A polyline with cumulative arc length, so positions can be looked up by distance. */
export class Polyline {
  readonly points: Vec2[];
  readonly cumulative: number[];
  readonly length: number;

  constructor(points: Vec2[]) {
    if (points.length < 2) throw new Error('Polyline needs at least 2 points');
    this.points = points;
    this.cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      this.cumulative.push(this.cumulative[i - 1]! + dist(points[i - 1]!, points[i]!));
    }
    this.length = this.cumulative[this.cumulative.length - 1]!;
  }

  private segmentAt(s: number): number {
    // Binary search for the segment containing arc length s.
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid]! <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  pointAt(s: number): Vec2 {
    const c = Math.max(0, Math.min(this.length, s));
    const i = this.segmentAt(c);
    const a = this.points[i]!;
    const b = this.points[i + 1]!;
    const segLen = this.cumulative[i + 1]! - this.cumulative[i]!;
    const t = segLen === 0 ? 0 : (c - this.cumulative[i]!) / segLen;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  /** Unit tangent at arc length s. */
  directionAt(s: number): Vec2 {
    const c = Math.max(0, Math.min(this.length, s));
    const i = this.segmentAt(c);
    const d = sub(this.points[i + 1]!, this.points[i]!);
    const l = len(d);
    return l === 0 ? { x: 1, y: 0 } : scale(d, 1 / l);
  }

  /** Smallest turning radius along the line, estimated from consecutive segments. */
  minRadius(): number {
    let r = Infinity;
    for (let i = 1; i < this.points.length - 1; i++) {
      const a = this.points[i - 1]!;
      const b = this.points[i]!;
      const c = this.points[i + 1]!;
      const ab = dist(a, b);
      const bc = dist(b, c);
      const ac = dist(a, c);
      const area2 = Math.abs(cross(sub(b, a), sub(c, a)));
      if (area2 < 1e-9) continue;
      r = Math.min(r, (ab * bc * ac) / (2 * area2));
    }
    return r;
  }
}

export function cubicBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, samples: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
  }
  return out;
}

/** Intersection of segments ab and cd, as fractions along each, or null. */
export function segmentIntersection(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
): { t: number; u: number } | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const ac = sub(c, a);
  const t = cross(ac, s) / denom;
  const u = cross(ac, r) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/** All crossings between two polylines, as arc lengths along each. */
export function polylineIntersections(p: Polyline, q: Polyline): Array<{ sp: number; sq: number }> {
  const hits: Array<{ sp: number; sq: number }> = [];
  for (let i = 0; i < p.points.length - 1; i++) {
    const a = p.points[i]!;
    const b = p.points[i + 1]!;
    for (let j = 0; j < q.points.length - 1; j++) {
      const c = q.points[j]!;
      const d = q.points[j + 1]!;
      const hit = segmentIntersection(a, b, c, d);
      if (!hit) continue;
      const sp = p.cumulative[i]! + hit.t * (p.cumulative[i + 1]! - p.cumulative[i]!);
      const sq = q.cumulative[j]! + hit.u * (q.cumulative[j + 1]! - q.cumulative[j]!);
      // Adjacent segments can report the same crossing twice.
      if (hits.some((h) => Math.abs(h.sp - sp) < 0.5 && Math.abs(h.sq - sq) < 0.5)) continue;
      hits.push({ sp, sq });
    }
  }
  return hits;
}
