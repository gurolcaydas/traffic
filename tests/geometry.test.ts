import { describe, expect, it } from 'vitest';
import { Polyline, cubicBezier, polylineIntersections, segmentIntersection, v } from '../src/core/geometry';
import { Rng } from '../src/core/rng';

describe('Polyline', () => {
  const line = new Polyline([v(0, 0), v(10, 0), v(10, 10)]);

  it('measures arc length', () => {
    expect(line.length).toBeCloseTo(20);
  });

  it('looks up points and directions by distance', () => {
    expect(line.pointAt(5)).toEqual({ x: 5, y: 0 });
    expect(line.pointAt(15)).toEqual({ x: 10, y: 5 });
    expect(line.directionAt(15)).toEqual({ x: 0, y: 1 });
  });

  it('clamps out-of-range lookups', () => {
    expect(line.pointAt(-3)).toEqual({ x: 0, y: 0 });
    expect(line.pointAt(99)).toEqual({ x: 10, y: 10 });
  });

  it('estimates turning radius of a sampled arc', () => {
    const pts = Array.from({ length: 31 }, (_, i) => {
      const a = (i / 30) * (Math.PI / 2);
      return v(8 * Math.cos(a), 8 * Math.sin(a));
    });
    expect(new Polyline(pts).minRadius()).toBeCloseTo(8, 0);
  });
});

describe('intersections', () => {
  it('finds crossing segments', () => {
    const hit = segmentIntersection(v(0, 0), v(2, 2), v(0, 2), v(2, 0));
    expect(hit?.t).toBeCloseTo(0.5);
    expect(hit?.u).toBeCloseTo(0.5);
  });

  it('ignores parallel and non-touching segments', () => {
    expect(segmentIntersection(v(0, 0), v(1, 0), v(0, 1), v(1, 1))).toBeNull();
    expect(segmentIntersection(v(0, 0), v(1, 0), v(2, -1), v(2, 1))).toBeNull();
  });

  it('reports polyline crossings once, as arc lengths on both', () => {
    const a = new Polyline([v(-5, 0), v(0, 0), v(5, 0)]);
    const b = new Polyline([v(0, -5), v(0, 5)]);
    const hits = polylineIntersections(a, b);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sp).toBeCloseTo(5);
    expect(hits[0]!.sq).toBeCloseTo(5);
  });
});

describe('cubicBezier', () => {
  it('starts and ends on the end points', () => {
    const pts = cubicBezier(v(0, 0), v(1, 0), v(2, 1), v(2, 2), 10);
    expect(pts).toHaveLength(11);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[10]).toEqual({ x: 2, y: 2 });
  });
});

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('gives exponential gaps with the right mean', () => {
    const r = new Rng(7);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += r.exponential(0.5);
    expect(sum / n).toBeCloseTo(2, 1);
  });
});
