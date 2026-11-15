// One-lane roundabouts. Each movement is drawn as one path: an entry curve onto the ring, an arc
// round it, and an exit curve off it. Instead of discovering conflicts from how close paths come,
// the ring's rules follow from its structure: movements sharing a stretch of ring follow each other,
// and a movement joining the ring gives way to every movement already circulating past that point.
import { Polyline, add, perpLeft, scale, type Vec2 } from '../core/geometry';
import { DEFAULTS, type Scenario } from '../core/types';
import type { Connector, LegGeometry, RoundaboutGeometry } from './network';

const TAU = Math.PI * 2;
const mod = (x: number, m: number) => ((x % m) + m) % m;

/** Width of the circulating carriageway: one generous lane. */
const RING_WIDTH = 5.5;
/** Paths closer than this to the ring's centreline are alongside it (as in the plain-junction conflicts). */
const ALONGSIDE = 2.6;
/** Raised splitter island between each leg's entry and exit lanes. */
export const SPLITTER_WIDTH = 2.5;

/** Ring arc, m, that must separate one leg's entry from the next leg's exit. */
const MIN_NODE_GAP = 6;

function makeGeometry(radius: number, direction: number): RoundaboutGeometry {
  return { radius, ringWidth: RING_WIDTH, islandRadius: radius - RING_WIDTH / 2, outerRadius: radius + RING_WIDTH / 2, direction };
}

/**
 * The smallest ring (from a sensible minimum) on which every leg's entry joins well before the
 * next leg's exit leaves, so entry and exit curves never cross off the ring.
 */
export function roundaboutGeometry(scenario: Scenario): RoundaboutGeometry {
  const direction = scenario.driveSide === 'right' ? 1 : -1;
  const maxLanes = Math.max(1, ...scenario.legs.map((l) => Math.max(l.lanesIn, l.lanesOut)));
  const legs = [...scenario.legs].sort((a, b) => direction * (mod(a.angle, 360) - mod(b.angle, 360)));
  const w = (l: (typeof legs)[number]) => l.laneWidth ?? DEFAULTS.laneWidth;
  const half = (l: (typeof legs)[number]) => Math.max(l.medianWidth ?? DEFAULTS.medianWidth, SPLITTER_WIDTH) / 2;
  const crossing = new Set(scenario.crosswalks.map((c) => c.leg));
  // How far round from its leg's axis the outermost lane joins or leaves the ring. A crossing moves
  // the give-way line (and so the start of the curve) further out.
  const swing = (rb: RoundaboutGeometry, leg: (typeof legs)[number], offset: number) => {
    const s0 = entryDistance(rb) + (crossing.has(leg.id) ? DEFAULTS.crosswalkWidth + 1 : 0);
    const r = (s0 * s0 + offset * offset - rb.radius ** 2) / (2 * (rb.radius - offset));
    return Math.atan2(offset + r, s0);
  };
  for (let radius = 12 + 2.2 * maxLanes; radius < 80; radius += 1) {
    const rb = makeGeometry(radius, direction);
    const ok = legs.every((a, i) => {
      const b = legs[(i + 1) % legs.length]!;
      if (a === b) return true;
      // Going round from A to the next leg B: A's entry must come clearly before B's exit.
      const between = (mod(direction * (b.angle - a.angle), 360) * Math.PI) / 180;
      const spare = between - swing(rb, a, half(a) + (a.lanesIn - 0.5) * w(a)) - swing(rb, b, half(b) + (b.lanesOut - 0.5) * w(b));
      return spare * radius >= MIN_NODE_GAP;
    });
    if (ok) return rb;
  }
  return makeGeometry(80, direction);
}


/** Ring coordinate (arc length in the direction of travel) of the point at angle θ. */
const ringCoord = (rb: RoundaboutGeometry, theta: number) => rb.radius * mod(rb.direction * theta, TAU);

/** Distance from the centre to the give-way line: far enough out for a gentle entry curve. */
export const entryDistance = (rb: RoundaboutGeometry) => rb.outerRadius + 6;

/**
 * A circular arc that leaves the line through `p` (heading `d`) tangentially and meets the ring
 * tangentially. `n` is the lane's curb-side normal: the arc bends that way, then the ring takes over.
 * Returns the points from `p` to the ring, and the angle (round the centre) where it meets the ring.
 */
function tangentArc(rb: RoundaboutGeometry, p: Vec2, n: Vec2, circle = rb.radius): { points: Vec2[]; theta: number } {
  // Centre c = p + n·r with |c| = R + r (the arc touches the circle from outside).
  const pn = p.x * n.x + p.y * n.y;
  const r = Math.max(3, (p.x * p.x + p.y * p.y - circle ** 2) / (2 * (circle - pn)));
  const c = add(p, scale(n, r));
  const theta = Math.atan2(c.y, c.x);
  const q = scale(c, circle / Math.hypot(c.x, c.y));
  let a0 = Math.atan2(p.y - c.y, p.x - c.x);
  let a1 = Math.atan2(q.y - c.y, q.x - c.x);
  // The short way round.
  while (a1 - a0 > Math.PI) a1 -= TAU;
  while (a0 - a1 > Math.PI) a1 += TAU;
  const steps = Math.max(6, Math.ceil((Math.abs(a1 - a0) * r) / 1.0));
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    points.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return { points, theta };
}

/** Arc length along `line` to the first point within ALONGSIDE of the ring's centreline. */
function firstAlongside(rb: RoundaboutGeometry, line: Polyline): number {
  for (let i = 0; i < line.points.length; i++) {
    const p = line.points[i]!;
    if (Math.abs(Math.hypot(p.x, p.y) - rb.radius) < ALONGSIDE) return line.cumulative[i]!;
  }
  return line.length;
}

/** Entry arc + ring arc + exit arc for one movement, all tangent where they meet. */
export function ringPath(rb: RoundaboutGeometry, from: LegGeometry, inPath: Polyline, to: LegGeometry, outPath: Polyline) {
  const d = rb.direction;
  // Entry bends towards the curb side of the inbound lanes; the exit towards the curb side of the outbound ones.
  const entry = tangentArc(rb, inPath.pointAt(inPath.length), from.inNormal);
  const exitRev = tangentArc(rb, outPath.pointAt(0), scale(to.inNormal, -1));
  const exit = [...exitRev.points].reverse();
  const at = (theta: number): Vec2 => ({ x: rb.radius * Math.cos(theta), y: rb.radius * Math.sin(theta) });

  // Round the ring, always in the direction of travel.
  let sweep = mod(d * (exitRev.theta - entry.theta), TAU);
  if (sweep < 0.2) sweep += TAU; // never a zero-length lap
  const steps = Math.max(4, Math.ceil((rb.radius * sweep) / 1.2));
  const arc: Vec2[] = [];
  for (let i = 1; i < steps; i++) arc.push(at(entry.theta + (d * sweep * i) / steps));

  const path = new Polyline([...entry.points, ...arc, ...exit]);
  const entryLine = new Polyline(entry.points);
  const start = entryLine.length;
  const exitLine = new Polyline(exit);
  return {
    path,
    ring: {
      entry: ringCoord(rb, entry.theta),
      length: rb.radius * sweep,
      start,
      joinZone: start - firstAlongside(rb, entryLine),
      // Measured from the lane end back towards the ring, so subtract to get "from the ring outwards".
      leaveZone: exitLine.length - firstAlongside(rb, new Polyline([...exit].reverse())),
    },
  };
}

/**
 * The ring's rules between two movements from different entry lanes:
 * shared stretches of ring become car-following, and joining the ring where the other is already
 * circulating means giving way to it.
 */
export function ringRelations(rb: RoundaboutGeometry, a: Connector, b: Connector) {
  const C = TAU * rb.radius;
  const A = a.ring!;
  const B = b.ring!;

  // Shared stretches, measured in A's frame (0 = where A joins the ring).
  const b0 = mod(B.entry - A.entry, C);
  for (const shift of [0, -C]) {
    const lo = Math.max(0, b0 + shift);
    const hi = Math.min(A.length, b0 + shift + B.length);
    if (hi - lo < 0.5) continue;
    // A at frame x is at s = A.start + x; B at frame x is at s = B.start + (x - b0 - shift).
    const offset = B.start - A.start - b0 - shift;
    // Widen each side's stretch by the other's join and leave zones: a car merging in ahead, or one
    // peeling off ahead, is still in the way while it is alongside the ring.
    const bJoinsHere = Math.abs(lo - (b0 + shift)) < 0.5;
    const aJoinsHere = lo < 0.5;
    const bLeavesHere = Math.abs(hi - (b0 + shift + B.length)) < 0.5;
    const aLeavesHere = Math.abs(hi - A.length) < 0.5;
    // Leaving together into the same lane: the exit curve is shared too, all the way out.
    const sameExit = aLeavesHere && bLeavesHere && a.outLane === b.outLane;
    a.ringShares.push({
      other: b.idx,
      from: A.start + lo - (bJoinsHere ? B.joinZone : 0),
      to: sameExit ? a.path.length : A.start + hi + (bLeavesHere ? B.leaveZone : 0),
      offset,
    });
    b.ringShares.push({
      other: a.idx,
      from: A.start + lo + offset - (aJoinsHere ? A.joinZone : 0),
      to: sameExit ? b.path.length : A.start + hi + offset + (aLeavesHere ? A.leaveZone : 0),
      offset: -offset,
    });
  }

  // Joining where the other is already circulating: give way.
  const giveWay = (joiner: Connector, J: typeof A, other: Connector, O: typeof A) => {
    const x = mod(J.entry - O.entry, C);
    const atSameNode = x < 0.5 || C - x < 0.5;
    if (!atSameNode && (x <= 0.5 || x >= O.length - 0.5)) return;
    const sOther = O.start + (atSameNode ? 0 : x);
    // Two lanes of one leg joining at the same point: the inner lane gives way to the curb lane.
    if (atSameNode && joiner.inLane < other.inLane) return;
    // The zone starts where the joiner first comes alongside the ring's lane.
    const back = Math.max(2, J.joinZone);
    joiner.conflicts.push({ other: other.idx, s: J.start - back, sEnd: J.start + 3, sOther: sOther - back, sOtherEnd: sOther + 3, kind: 'merge', yields: true });
    other.conflicts.push({ other: joiner.idx, s: sOther - back, sEnd: sOther + 3, sOther: J.start - back, sOtherEnd: J.start + 3, kind: 'merge', yields: false });
  };
  giveWay(a, A, b, B);
  giveWay(b, B, a, A);

  // Two lanes of one leg feeding the one-lane ring: their entry curves converge, so they take turns
  // (single file), the inner lane giving way to the curb lane.
  if (a.from === b.from && a.inLane !== b.inLane) {
    const [inner, curb] = a.inLane > b.inLane ? [a, b] : [b, a];
    const I = inner.ring!;
    const K = curb.ring!;
    inner.conflicts.push({ other: curb.idx, s: 0, sEnd: I.start + 3, sOther: 0, sOtherEnd: K.start + 3, kind: 'merge', yields: true });
    curb.conflicts.push({ other: inner.idx, s: 0, sEnd: K.start + 3, sOther: 0, sOtherEnd: I.start + 3, kind: 'merge', yields: false });
  }
}

/**
 * Curb lines between neighbouring legs. Each leg's edge sweeps onto the outer circle along the same
 * kind of tangent curve the traffic follows, so curbs and paths stay parallel; then round the circle.
 */
export function roundaboutCorners(rb: RoundaboutGeometry, legs: Map<string, LegGeometry>, side: number): Vec2[][] {
  const sorted = [...legs.values()].sort((a, b) => Math.atan2(a.dir.y, a.dir.x) - Math.atan2(b.dir.y, b.dir.x));
  if (sorted.length < 2) return [];
  const R = rb.outerRadius;
  return sorted.map((a, i) => {
    const b = sorted[(i + 1) % sorted.length]!;
    // A's counter-clockwise edge and B's clockwise edge (as in the plain-junction corners).
    const na = perpLeft(a.dir);
    const nb = scale(perpLeft(b.dir), -1);
    const ea = side === 1 ? a.inEdge : a.outEdge;
    const eb = side === 1 ? b.outEdge : b.inEdge;
    // Curbs start to curve where the lanes end (the give-way line), just as the traffic does.
    const fromA = tangentArc(rb, add(scale(a.dir, a.stopLine), scale(na, ea)), na, R);
    const intoB = tangentArc(rb, add(scale(b.dir, b.stopLine), scale(nb, eb)), nb, R);
    const t0 = fromA.theta;
    let t1 = intoB.theta;
    while (t1 <= t0) t1 += TAU;
    const pts: Vec2[] = [...fromA.points];
    const n = Math.max(2, Math.ceil(((t1 - t0) * R) / 1.5));
    for (let k = 1; k < n; k++) {
      const t = t0 + ((t1 - t0) * k) / n;
      pts.push({ x: R * Math.cos(t), y: R * Math.sin(t) });
    }
    pts.push(...[...intoB.points].reverse());
    return pts;
  });
}
