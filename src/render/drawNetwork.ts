import type { Graphics } from 'pixi.js';
import { add, scale, sub, type Vec2 } from '../core/geometry';
import type { Connector, Lane, LegGeometry, Network, RingStop } from '../network/network';
import { connectorSignal, ringStopState, stateFor, type SignalClock, type SignalState } from '../sim/signals';
import type { CanvasTheme } from './theme';

const LINE = 0.2; // painted line width, m (a touch bolder than real paint, for legibility)
const CURB = 0.25;
const DASH = 3;
const GAP = 3;
/** How far up each flyover leg the bridge deck reaches beyond the stop line. */
const RAMP = 26;

const along = (g: LegGeometry, s: number, offset: number): Vec2 => add(scale(g.dir, s), scale(g.inNormal, offset));
const flat = (pts: Vec2[]) => pts.flatMap((p) => [p.x, p.y]);

function legsByAngle(net: Network): LegGeometry[] {
  return [...net.legs.values()].sort((a, b) => Math.atan2(a.dir.y, a.dir.x) - Math.atan2(b.dir.y, b.dir.x));
}

/** Static ground layer: asphalt, curbs, islands and painted markings. */
export function drawNetwork(g: Graphics, net: Network, t: CanvasTheme) {
  g.clear();
  const legs = legsByAngle(net);
  const slips = net.connectors.filter((c) => c.kind === 'slip');

  // Asphalt: the main strip of each leg, the slip and added lanes beside it, the corners, the slip roads.
  for (const leg of legs) {
    g.poly(flat(strip(leg, 0, leg.length, -leg.outEdge, leg.inEdge))).fill(t.asphalt);
    if (leg.slipEdge !== null) g.poly(flat(strip(leg, leg.slipEnd!, leg.length, leg.inEdge, leg.slipEdge))).fill(t.asphalt);
    if (leg.slipOutEdge !== null) g.poly(flat(strip(leg, leg.slipOutStart!, leg.length, -leg.slipOutEdge, -leg.outEdge))).fill(t.asphalt);
  }
  for (const curve of net.corners) g.poly(flat([{ x: 0, y: 0 }, ...curve])).fill(t.asphalt);
  for (const c of slips) {
    const w = net.lanes[c.inLane]!.width / 2 + 0.4;
    g.poly(flat([...offsetLine(c.path.points, w), ...offsetLine(c.path.points, -w).reverse()])).fill(t.asphalt);
  }

  // Curbs.
  for (const leg of legs) {
    const inStop = leg.slipEnd ?? leg.length;
    const outStop = leg.slipOutStart ?? leg.length;
    // At a roundabout the corner curbs take over from the give-way line inwards.
    const curbStart = net.roundabout ? leg.stopLine : leg.boxEdge;
    line(g, along(leg, curbStart, leg.inEdge), along(leg, inStop, leg.inEdge));
    line(g, along(leg, curbStart, -leg.outEdge), along(leg, outStop, -leg.outEdge));
    if (leg.slipEdge !== null) {
      line(g, along(leg, leg.slipEnd!, leg.slipEdge), along(leg, leg.length, leg.slipEdge));
      line(g, along(leg, leg.slipEnd!, leg.inEdge), along(leg, leg.slipEnd!, leg.slipEdge - leg.laneWidth)); // island nose
    }
    if (leg.slipOutEdge !== null) {
      line(g, along(leg, leg.slipOutStart!, -leg.slipOutEdge), along(leg, leg.length, -leg.slipOutEdge));
      line(g, along(leg, leg.slipOutStart!, -leg.outEdge), along(leg, leg.slipOutStart!, -(leg.slipOutEdge - leg.laneWidth)));
    }
  }
  for (const c of net.corners) polyline(g, c);
  for (const c of slips) {
    const w = net.lanes[c.inLane]!.width / 2 + 0.4;
    polyline(g, offsetLine(c.path.points, w));
    polyline(g, offsetLine(c.path.points, -w));
  }
  g.stroke({ width: CURB, color: t.curb, cap: 'round', join: 'round' });

  // Lane lines.
  for (const leg of legs) {
    const ins = laneList(net, leg.id, 'in');
    const outs = laneList(net, leg.id, 'out');
    const half = leg.medianWidth / 2;
    if (ins.length && outs.length) {
      const offs = leg.medianWidth > 0.3 ? [half, -half] : [0];
      for (const o of offs) line(g, along(leg, leg.stopLine, o), along(leg, leg.length, o));
    }
    // Between neighbouring lanes: solid near the stop line (no lane changes), dashed further back.
    // Lines next to a flyover or slip lane are solid all the way: those lanes are chosen early.
    for (const lanes of [ins, outs]) {
      for (let i = 1; i < lanes.length; i++) {
        const a = lanes[i - 1]!;
        const b = lanes[i]!;
        if (a.role === 'slip' || b.role === 'slip') continue;
        const o = (a.offset + b.offset) / 2;
        const solid = a.role !== b.role;
        if (solid) line(g, along(leg, leg.stopLine, o), along(leg, leg.length, o));
        else if (a.kind === 'in') {
          line(g, along(leg, leg.stopLine, o), along(leg, leg.stopLine + 15, o));
          dashed(g, along(leg, leg.stopLine + 15, o), along(leg, leg.length, o));
        } else dashed(g, along(leg, leg.stopLine, o), along(leg, leg.length, o));
      }
    }
    // Slip lane buffer: two solid lines.
    if (leg.slipEdge !== null) {
      for (const o of [leg.inEdge, leg.slipEdge - leg.laneWidth]) line(g, along(leg, leg.slipEnd!, o), along(leg, leg.length, o));
    }
    if (leg.slipOutEdge !== null) {
      for (const o of [-leg.outEdge, -(leg.slipOutEdge - leg.laneWidth)]) line(g, along(leg, leg.slipOutStart!, o), along(leg, leg.length, o));
    }
  }
  // Stroke now: any fill below would otherwise consume these line segments.
  g.stroke({ width: LINE, color: t.marking, cap: 'butt' });

  if (net.roundabout) drawRoundaboutIslands(g, net, t);

  // Stop or give-way lines across the regular lanes, and turn arrows.
  const control = net.scenario.control;
  for (const leg of legs) {
    const regular = laneList(net, leg.id, 'in').filter((l) => l.role === 'regular');
    if (!regular.length) continue;
    const lo = Math.min(...regular.map((l) => l.offset)) - leg.laneWidth / 2;
    const hi = Math.max(...regular.map((l) => l.offset)) + leg.laneWidth / 2;
    if (control.type === 'signals') {
      line(g, along(leg, leg.stopLine, lo), along(leg, leg.stopLine, hi));
      g.stroke({ width: 0.45, color: t.marking });
    } else if (control.type === 'roundabout' || !control.major.includes(leg.id)) {
      giveWay(g, leg, lo, hi, t);
    }
  }
  for (const lane of net.lanes) {
    if (lane.kind !== 'in') continue;
    const turns = (net.connectorsFromLane.get(lane.idx) ?? []).map((c) => net.connectors[c]!);
    if (turns.length) drawArrow(g, net, lane, turns, t);
  }

  // Zebra crossings.
  for (const cw of net.crosswalks) {
    const leg = net.legs.get(cw.leg)!;
    const c = leg.crosswalkCenter!;
    for (let o = -leg.outEdge + 0.4; o < leg.inEdge - 0.2; o += 1.0) {
      g.poly(flat(strip(leg, c - cw.width / 2, c + cw.width / 2, o, o + 0.5))).fill(t.marking);
    }
  }
}

/** Central island (with a truck apron) and the splitter islands between each leg's entry and exit. */
function drawRoundaboutIslands(g: Graphics, net: Network, t: CanvasTheme) {
  const rb = net.roundabout!;
  // Truck apron: a slightly raised ring at the island's edge, then the island itself.
  g.circle(0, 0, rb.islandRadius).fill({ color: t.curb, alpha: 0.12 }).stroke({ width: CURB, color: t.curb });
  g.circle(0, 0, rb.islandRadius - 1.4).fill(t.ground).stroke({ width: CURB, color: t.curb });

  if (rb.lanes === 2) {
    // Dashed line between the two ring lanes.
    const n = Math.round((2 * Math.PI * rb.radius) / 4);
    for (let k = 0; k < n; k++) {
      const a0 = (2 * Math.PI * k) / n;
      const a1 = a0 + (2 * Math.PI) / n / 2;
      line(g, { x: rb.radius * Math.cos(a0), y: rb.radius * Math.sin(a0) }, { x: rb.radius * Math.cos(a1), y: rb.radius * Math.sin(a1) });
    }
    g.stroke({ width: LINE, color: t.marking });
    // Stop lines across the ring before each entry.
    for (const stop of net.ringStops) {
      const [a, b] = ringStopEnds(net, stop);
      line(g, a, b);
    }
    g.stroke({ width: 0.45, color: t.marking });
  }

  for (const leg of net.legs.values()) {
    const w = leg.medianWidth / 2 - 0.25;
    if (w <= 0.2) continue;
    const s0 = rb.outerRadius + 1.2;
    const s1 = leg.stopLine + 14;
    // Rounded nose at the ring end, a point at the far end.
    const nose = Array.from({ length: 9 }, (_, k) => {
      const a = Math.PI / 2 + (Math.PI * k) / 8; // from the inbound side round to the outbound side
      return along(leg, s0 + w + w * Math.cos(a), w * Math.sin(a));
    });
    const island = [...nose, along(leg, s1 - 4, -w), along(leg, s1, 0), along(leg, s1 - 4, w)];
    g.poly(flat(island)).fill(t.ground).stroke({ width: CURB, color: t.curb, join: 'round' });
  }
}

/** Things that explain a level's limits: a building on a blocked corner, shops along legs that can't widen. */
export interface Decor {
  blockedCorners: string[];
  fixedLanes: string[];
}

export function drawDecor(g: Graphics, net: Network, decor: Decor | null, t: CanvasTheme) {
  g.clear();
  if (!decor) return;
  const block = (leg: LegGeometry, s0: number, s1: number, o0: number, o1: number) => {
    g.poly(flat(strip(leg, s0, s1, o0, o1))).fill(t.building).stroke({ width: 0.3, color: t.curb, alpha: 0.6 });
    // A ridge line along the long side reads as a roof from above.
    const mid = (o0 + o1) / 2;
    line(g, along(leg, s0 + 1, mid), along(leg, s1 - 1, mid));
    g.stroke({ width: 0.4, color: t.roof });
  };
  for (const id of decor.blockedCorners) {
    const leg = net.legs.get(id);
    if (!leg) continue;
    // On the side a side road would use: beyond the inbound lanes' curb, just up from the junction.
    const o = leg.inEdge + 3;
    block(leg, leg.stopLine + 2, leg.stopLine + 22, o, o + 14);
  }
  for (const id of decor.fixedLanes) {
    const leg = net.legs.get(id);
    if (!leg) continue;
    // Leave room for a corner building on the inbound side, if there is one.
    const inStart = decor.blockedCorners.includes(id) ? leg.stopLine + 25 : leg.stopLine + 6;
    for (let s = leg.stopLine + 6; s + 12 < leg.length - 4; s += 15) {
      if (s >= inStart) block(leg, s, s + 12, leg.inEdge + 2.5, leg.inEdge + 10);
      block(leg, s, s + 12, -(leg.outEdge + 2.5), -(leg.outEdge + 10));
    }
  }
}

/** Bridge decks for flyovers, drawn above ground-level traffic. */
export function drawBridges(g: Graphics, net: Network, t: CanvasTheme) {
  g.clear();
  const done = new Set<string>();
  for (const c of net.connectors) {
    const key = [c.from, c.to].sort().join();
    if (c.kind !== 'flyover' || done.has(key)) continue;
    done.add(key);
    const a = net.legs.get(c.from)!;
    const b = net.legs.get(c.to)!;
    const w = a.medianWidth / 2 + a.laneWidth + 0.6;
    const sa = a.stopLine + RAMP;
    const sb = b.stopLine + RAMP;
    const deck = [along(a, sa, w), along(a, sa, -w), along(b, sb, w), along(b, sb, -w)];
    g.poly(flat(deck.map((p) => add(p, { x: 0.9, y: -0.9 })))).fill({ color: 0x000000, alpha: 0.22 });
    g.poly(flat(deck)).fill(t.asphalt);
    // Parapets on both long sides, then the painted centre line and the ramp ends.
    line(g, deck[0]!, deck[3]!);
    line(g, deck[1]!, deck[2]!);
    g.stroke({ width: 0.45, color: t.curb });
    dashed(g, along(a, sa, 0), along(b, sb, 0));
    g.stroke({ width: LINE, color: t.marking });
    for (const [leg, s] of [[a, sa], [b, sb]] as const) line(g, along(leg, s, w), along(leg, s, -w));
    g.stroke({ width: 0.25, color: t.curb, alpha: 0.5 });
  }
}

/** Outline the selected leg. */
export function drawSelection(g: Graphics, net: Network, leg: string | null, accent: number) {
  g.clear();
  const l = leg ? net.legs.get(leg) : undefined;
  if (!l) return;
  const pts = strip(l, l.boxEdge, l.length, -(l.slipOutEdge ?? l.outEdge) - 0.8, (l.slipEdge ?? l.inEdge) + 0.8);
  g.poly(flat(pts)).fill({ color: accent, alpha: 0.08 }).stroke({ width: 0.5, color: accent, alpha: 0.9 });
}

/** Per-frame layer: signal bars on stop lines and pedestrian lights. */
export function drawSignals(g: Graphics, net: Network, clock: SignalClock | null, t: CanvasTheme) {
  g.clear();
  if (!clock) return;
  const color = (s: SignalState) => (s === 'green' ? t.green : s === 'amber' ? t.amber : t.red);
  for (const lane of net.lanes) {
    if (lane.kind !== 'in' || lane.role !== 'regular') continue;
    const leg = net.legs.get(lane.leg)!;
    const conns = (net.connectorsFromLane.get(lane.idx) ?? []).map((c) => net.connectors[c]!);
    if (conns.length === 0) continue;
    // One segment per movement, near-side turn on the curb side.
    const order = { near: 0, through: 1, far: 2 } as const;
    conns.sort((a, b) => order[a.turn] - order[b.turn]);
    const outer = lane.offset + leg.laneWidth / 2;
    const w = leg.laneWidth / conns.length;
    conns.forEach((c, i) => {
      const s = leg.stopLine + 0.6;
      line(g, along(leg, s, outer - i * w - 0.25), along(leg, s, outer - (i + 1) * w + 0.25));
      g.stroke({ width: 0.9, color: color(connectorSignal(clock, c)), cap: 'round' });
    });
  }
  for (const stop of net.ringStops) {
    // Just behind the ring's stop line, like the bars on the approaches.
    const back = scale(stop.heading, -0.6);
    const [a, b] = ringStopEnds(net, stop, 0.25);
    line(g, add(a, back), add(b, back));
    g.stroke({ width: 0.9, color: color(ringStopState(clock, stop.entryPhases)), cap: 'round' });
  }
  for (const cw of net.crosswalks) {
    if (cw.type !== 'signal') continue;
    const state = stateFor(clock, cw.greenPhases);
    for (const p of [cw.path.points[0]!, cw.path.points[cw.path.points.length - 1]!]) {
      g.circle(p.x, p.y, 0.55).fill(color(state === 'green' ? 'green' : 'red'));
    }
  }
}

/** Which leg (if any) a world point falls on. */
export function legAt(net: Network, p: Vec2): string | null {
  for (const g of net.legs.values()) {
    const s = p.x * g.dir.x + p.y * g.dir.y;
    const o = p.x * g.inNormal.x + p.y * g.inNormal.y;
    if (s >= g.boxEdge && s <= g.length && o >= -(g.slipOutEdge ?? g.outEdge) - 2 && o <= (g.slipEdge ?? g.inEdge) + 2) return g.id;
  }
  return null;
}

const laneList = (net: Network, leg: string, kind: 'in' | 'out'): Lane[] =>
  net.lanes.filter((l) => l.leg === leg && l.kind === kind).sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));

function strip(leg: LegGeometry, s0: number, s1: number, o0: number, o1: number): Vec2[] {
  return [along(leg, s0, o0), along(leg, s1, o0), along(leg, s1, o1), along(leg, s0, o1)];
}

/** Turn arrows painted on a lane, a few metres before its end. */
function drawArrow(g: Graphics, net: Network, lane: Lane, turns: Connector[], t: CanvasTheme) {
  const end = lane.path.pointAt(lane.path.length - 7);
  const fwd = lane.path.directionAt(lane.path.length);
  const left = { x: -fwd.y, y: fwd.x };
  const P = (a: number, b: number) => add(end, add(scale(fwd, a), scale(left, b)));
  const side = net.scenario.driveSide === 'right' ? 1 : -1;
  line(g, P(-2.2, 0), P(0.6, 0));
  for (const c of turns) {
    if (c.turn === 'through') {
      line(g, P(0.6, 0), P(1.8, 0));
      g.poly(flat([P(2.6, 0), P(1.6, 0.55), P(1.6, -0.55)])).fill(t.marking);
    } else {
      // Near turns bend towards the curb (right in right-hand traffic), far turns away from it.
      const dir = (c.turn === 'near' ? -1 : 1) * side;
      line(g, P(0.6, 0), P(1.4, dir * 0.9));
      g.poly(flat([P(1.7, dir * 1.55), P(1.75, dir * 0.6), P(0.95, dir * 1.1)])).fill(t.marking);
    }
  }
  g.stroke({ width: 0.3, color: t.marking, alpha: 0.9, cap: 'round', join: 'round' });
}

/** The ends of a ring stop line, across the circulating carriageway (inset by `inset`). */
function ringStopEnds(net: Network, stop: RingStop, inset = 0): [Vec2, Vec2] {
  const rb = net.roundabout!;
  const radial = scale(stop.point, 1 / rb.radius);
  return [scale(radial, rb.islandRadius + 0.2 + inset), scale(radial, rb.outerRadius - 0.2 - inset)];
}

function giveWay(g: Graphics, leg: LegGeometry, from: number, to: number, t: CanvasTheme) {
  // "Shark teeth" triangles pointing at the approaching driver.
  const s = leg.stopLine;
  for (let o = from + 0.3; o < to - 0.3; o += 1.2) {
    const a = along(leg, s, o);
    const b = along(leg, s, Math.min(o + 0.8, to));
    const tip = along(leg, s + 1.1, o + 0.4);
    g.poly(flat([a, b, tip])).fill(t.marking);
  }
}

/** A polyline shifted sideways (to the left of its direction) by d. */
function offsetLine(pts: Vec2[], d: number): Vec2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: p.x - (dy / l) * d, y: p.y + (dx / l) * d };
  });
}

function line(g: Graphics, a: Vec2, b: Vec2) {
  g.moveTo(a.x, a.y).lineTo(b.x, b.y);
}

function polyline(g: Graphics, pts: Vec2[]) {
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
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
