import type { Graphics } from 'pixi.js';
import { add, scale, sub, type Vec2 } from '../core/geometry';
import type { LegGeometry, Network } from '../network/network';
import { stateFor, type SignalClock, type SignalState } from '../sim/signals';
import type { CanvasTheme } from './theme';

const LINE = 0.2; // painted line width, m (a touch bolder than real paint, for legibility)
const CURB = 0.25;
const DASH = 3;
const GAP = 3;

const along = (g: LegGeometry, s: number, offset: number): Vec2 => add(scale(g.dir, s), scale(g.inNormal, offset));
const flat = (pts: Vec2[]) => pts.flatMap((p) => [p.x, p.y]);

function legsByAngle(net: Network): LegGeometry[] {
  return [...net.legs.values()].sort((a, b) => Math.atan2(a.dir.y, a.dir.x) - Math.atan2(b.dir.y, b.dir.x));
}

/** Static layer: ground, asphalt, curbs and painted markings. */
export function drawNetwork(g: Graphics, net: Network, t: CanvasTheme) {
  g.clear();
  const legs = legsByAngle(net);

  // Asphalt: one strip per leg, overlapping in the middle.
  for (const leg of legs) {
    const pts = [along(leg, 0, -leg.outEdge), along(leg, leg.length, -leg.outEdge), along(leg, leg.length, leg.inEdge), along(leg, 0, leg.inEdge)];
    g.poly(flat(pts)).fill(t.asphalt);
  }

  // Corners between neighbouring legs, bounded by the rounded curb returns.
  const curbs = net.corners;
  for (const curve of curbs) g.poly(flat([{ x: 0, y: 0 }, ...curve])).fill(t.asphalt);

  // Curbs: along each leg, then the corner returns.
  for (const leg of legs) {
    for (const off of [leg.inEdge, -leg.outEdge]) {
      const p = along(leg, leg.boxEdge, off);
      const q = along(leg, leg.length, off);
      g.moveTo(p.x, p.y).lineTo(q.x, q.y);
    }
  }
  for (const c of curbs) {
    g.moveTo(c[0]!.x, c[0]!.y);
    for (const p of c.slice(1)) g.lineTo(p.x, p.y);
  }
  g.stroke({ width: CURB, color: t.curb, cap: 'round', join: 'round' });

  // Painted markings.
  const control = net.scenario.control;
  for (const leg of legs) {
    const spec = net.scenario.legs.find((l) => l.id === leg.id)!;
    const half = leg.medianWidth / 2;
    if (spec.lanesIn > 0 && spec.lanesOut > 0) {
      const offs = leg.medianWidth > 0.3 ? [half, -half] : [0];
      for (const o of offs) line(g, along(leg, leg.stopLine, o), along(leg, leg.length, o));
    }
    for (let k = 1; k < spec.lanesIn; k++) {
      const o = half + k * leg.laneWidth;
      // Solid approaching the stop line (no lane changes), dashed further back.
      line(g, along(leg, leg.stopLine, o), along(leg, leg.stopLine + 15, o));
      dashed(g, along(leg, leg.stopLine + 15, o), along(leg, leg.length, o));
    }
    for (let k = 1; k < spec.lanesOut; k++) {
      const o = -(half + k * leg.laneWidth);
      dashed(g, along(leg, leg.stopLine, o), along(leg, leg.length, o));
    }
    // Stroke now: any fill below would otherwise consume these line segments.
    g.stroke({ width: LINE, color: t.marking, cap: 'butt' });

    // Stop or give-way line across the inbound lanes.
    if (spec.lanesIn > 0) {
      const s = leg.stopLine;
      const signals = control.type === 'signals';
      const major = control.type === 'priority' && control.major.includes(leg.id);
      if (signals) {
        g.moveTo(...xy(along(leg, s, half))).lineTo(...xy(along(leg, s, leg.inEdge)));
        g.stroke({ width: 0.45, color: t.marking });
      } else if (!major) {
        giveWay(g, leg, half, leg.inEdge, t);
      }
    }
  }

  // Zebra crossings.
  for (const cw of net.crosswalks) {
    const leg = net.legs.get(cw.leg)!;
    const c = leg.crosswalkCenter!;
    for (let o = -leg.outEdge + 0.4; o < leg.inEdge - 0.2; o += 1.0) {
      const pts = [along(leg, c - cw.width / 2, o), along(leg, c + cw.width / 2, o), along(leg, c + cw.width / 2, o + 0.5), along(leg, c - cw.width / 2, o + 0.5)];
      g.poly(flat(pts)).fill(t.marking);
    }
  }
}

/** Per-frame layer: signal bars on stop lines and pedestrian lights. */
export function drawSignals(g: Graphics, net: Network, clock: SignalClock | null, t: CanvasTheme) {
  g.clear();
  if (!clock) return;
  const color = (s: SignalState) => (s === 'green' ? t.green : s === 'amber' ? t.amber : t.red);
  for (const lane of net.lanes) {
    if (lane.kind !== 'in') continue;
    const leg = net.legs.get(lane.leg)!;
    const conns = (net.connectorsFromLane.get(lane.idx) ?? []).map((c) => net.connectors[c]!);
    if (conns.length === 0) continue;
    // One segment per movement, near-side turn on the curb side.
    const order = { near: 0, through: 1, far: 2 } as const;
    conns.sort((a, b) => order[a.turn] - order[b.turn]);
    const outer = leg.medianWidth / 2 + (lanesIn(net, lane.leg) - lane.index) * leg.laneWidth;
    const w = leg.laneWidth / conns.length;
    conns.forEach((c, i) => {
      const o1 = outer - i * w - 0.25;
      const o2 = outer - (i + 1) * w + 0.25;
      const s = leg.stopLine + 0.6;
      g.moveTo(...xy(along(leg, s, o1))).lineTo(...xy(along(leg, s, o2)));
      g.stroke({ width: 0.9, color: color(stateFor(clock, c.greenPhases)), cap: 'round' });
    });
  }
  for (const cw of net.crosswalks) {
    if (cw.type !== 'signal') continue;
    const state = stateFor(clock, cw.greenPhases);
    for (const p of [cw.path.points[0]!, cw.path.points[cw.path.points.length - 1]!]) {
      g.circle(p.x, p.y, 0.55).fill(color(state === 'green' ? 'green' : 'red'));
    }
  }
}

const lanesIn = (net: Network, leg: string) => net.scenario.legs.find((l) => l.id === leg)!.lanesIn;

function giveWay(g: Graphics, leg: LegGeometry, from: number, to: number, t: CanvasTheme) {
  // A dashed line plus "shark teeth" triangles pointing at the approaching driver.
  const s = leg.stopLine;
  for (let o = from + 0.3; o < to - 0.3; o += 1.2) {
    const a = along(leg, s, o);
    const b = along(leg, s, Math.min(o + 0.8, to));
    const tip = along(leg, s + 1.1, o + 0.4);
    g.poly(flat([a, b, tip])).fill(t.marking);
  }
}

function line(g: Graphics, a: Vec2, b: Vec2) {
  g.moveTo(a.x, a.y).lineTo(b.x, b.y);
}

function dashed(g: Graphics, a: Vec2, b: Vec2) {
  const d = sub(b, a);
  const len = Math.hypot(d.x, d.y);
  const u = scale(d, 1 / len);
  for (let s = 0; s < len; s += DASH + GAP) {
    const p = add(a, scale(u, s));
    const q = add(a, scale(u, Math.min(len, s + DASH)));
    g.moveTo(p.x, p.y).lineTo(q.x, q.y);
  }
}

const xy = (p: Vec2): [number, number] => [p.x, p.y];
