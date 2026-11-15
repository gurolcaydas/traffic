import {
  Polyline,
  add,
  cross,
  cubicBezier,
  dist,
  dot,
  fromAngleDeg,
  perpLeft,
  polylineIntersections,
  scale,
  type Vec2,
} from '../core/geometry';
import { DEFAULTS, type LegSpec, type Scenario } from '../core/types';
import {
  movementKey,
  type ConflictRef,
  type Connector,
  type Crosswalk,
  type Lane,
  type LegGeometry,
  type Network,
  type TurnKind,
} from './network';

/** Paths closer than this are treated as touching (two cars side by side would scrape). */
const PROXIMITY = 2.6;
const THROUGH_ANGLE = 30;
/** Comfortable lateral acceleration in turns, m/s². */
const LATERAL_ACCEL = 3.0;
/** How far the rounded curb return reaches along each road edge from the corner, m. */
const CURB_RETURN = 5;

export function buildNetwork(scenario: Scenario): Network {
  const side = scenario.driveSide === 'right' ? 1 : -1;
  const legs = buildLegGeometry(scenario, side);

  const lanes: Lane[] = [];
  const laneOf = new Map<string, number>();
  for (const spec of scenario.legs) {
    const g = legs.get(spec.id)!;
    const speed = spec.speedLimit ?? DEFAULTS.speedLimit;
    for (let k = 0; k < spec.lanesIn; k++) {
      const off = g.medianWidth / 2 + (spec.lanesIn - 1 - k + 0.5) * g.laneWidth;
      const start = along(g, g.length, off);
      const end = along(g, g.stopLine, off);
      laneOf.set(`${spec.id}/in/${k}`, lanes.length);
      lanes.push({ idx: lanes.length, leg: spec.id, kind: 'in', index: k, path: new Polyline([start, end]), speedLimit: speed, width: g.laneWidth });
    }
    for (let k = 0; k < spec.lanesOut; k++) {
      const off = -(g.medianWidth / 2 + (spec.lanesOut - 1 - k + 0.5) * g.laneWidth);
      const start = along(g, g.stopLine, off);
      const end = along(g, g.length, off);
      laneOf.set(`${spec.id}/out/${k}`, lanes.length);
      lanes.push({ idx: lanes.length, leg: spec.id, kind: 'out', index: k, path: new Polyline([start, end]), speedLimit: speed, width: g.laneWidth });
    }
  }

  const connectors: Connector[] = [];
  const movementLanes = new Map<string, number[]>();
  const connectorsFromLane = new Map<number, number[]>();

  for (const from of scenario.legs) {
    if (from.lanesIn === 0) continue;
    const gFrom = legs.get(from.id)!;
    const heading = scale(gFrom.dir, -1);
    // Destinations ordered from the near side to the far side; lane 0 (curb) serves the nearest.
    const dests = scenario.legs
      .filter((to) => to.id !== from.id && to.lanesOut > 0)
      .map((to) => ({ to, angle: turnAngle(heading, legs.get(to.id)!.dir) }))
      .sort((a, b) => side * (a.angle - b.angle));

    const n = from.lanesIn;
    const k = dests.length;
    dests.forEach(({ to, angle }, rank) => {
      const lo = Math.floor((rank * n) / k);
      const hi = Math.max(lo, Math.ceil(((rank + 1) * n) / k) - 1);
      const turn = classifyTurn(angle, side);
      const allowed: number[] = [];
      for (let l = lo; l <= hi; l++) {
        const outIndex =
          turn === 'far'
            ? clamp(to.lanesOut - 1 - (hi - l), 0, to.lanesOut - 1)
            : clamp(l - lo, 0, to.lanesOut - 1);
        const inLane = laneOf.get(`${from.id}/in/${l}`)!;
        const outLane = laneOf.get(`${to.id}/out/${outIndex}`)!;
        allowed.push(inLane);
        // A near-side turn follows the curb return, keeping its lane's distance from the curb.
        const curbGap = Math.min(
          gFrom.inEdge - laneOffset(gFrom, from.lanesIn, l),
          legs.get(to.id)!.outEdge - laneOffset(legs.get(to.id)!, to.lanesOut, outIndex),
        );
        const path = connectorPath(lanes[inLane]!.path, lanes[outLane]!.path, turn === 'near' ? CURB_RETURN + curbGap : Infinity);
        const curveSpeed = Math.sqrt(LATERAL_ACCEL * path.minRadius());
        const idx = connectors.length;
        connectors.push({
          idx,
          from: from.id,
          to: to.id,
          inLane,
          outLane,
          path,
          speedLimit: Math.min(lanes[inLane]!.speedLimit, curveSpeed),
          turn,
          conflicts: [],
          siblings: [],
          crosswalkCrossings: [],
          greenPhases: [],
        });
        const list = connectorsFromLane.get(inLane) ?? [];
        list.push(idx);
        connectorsFromLane.set(inLane, list);
      }
      movementLanes.set(movementKey(from.id, to.id), allowed);
    });
  }

  assignSignalPhases(scenario, connectors);
  findConflicts(scenario, legs, connectors, side);

  const crosswalks = buildCrosswalks(scenario, legs, connectors);

  const corners = buildCorners(legs, side);

  return { scenario, legs, lanes, connectors, crosswalks, connectorsFromLane, movementLanes, corners };
}

function buildLegGeometry(scenario: Scenario, side: number): Map<string, LegGeometry> {
  const specs = [...scenario.legs].sort((a, b) => norm360(a.angle) - norm360(b.angle));
  const halfWidth = (s: LegSpec) =>
    (s.medianWidth ?? DEFAULTS.medianWidth) / 2 + Math.max(s.lanesIn, s.lanesOut) * (s.laneWidth ?? DEFAULTS.laneWidth);
  const hasCrosswalk = new Set(scenario.crosswalks.map((c) => c.leg));

  const out = new Map<string, LegGeometry>();
  specs.forEach((spec, i) => {
    const neighbours = [specs[(i + specs.length - 1) % specs.length]!, specs[(i + 1) % specs.length]!];
    // Where this road's edge meets each neighbour's edge, measured along this leg.
    let corner = halfWidth(spec);
    for (const nb of neighbours) {
      if (nb === spec) continue;
      let gap = Math.abs(norm360(nb.angle) - norm360(spec.angle));
      if (gap > 180) gap = 360 - gap;
      const h = Math.max(halfWidth(spec), halfWidth(nb));
      corner = Math.max(corner, gap >= 179 ? h : h / Math.tan(((gap / 2) * Math.PI) / 180));
    }
    const boxEdge = corner + CURB_RETURN;
    const cw = hasCrosswalk.has(spec.id);
    const crosswalkCenter = cw ? boxEdge + DEFAULTS.crosswalkWidth / 2 : null;
    const stopLine = cw ? boxEdge + DEFAULTS.crosswalkWidth + 1 : boxEdge;
    const dir = fromAngleDeg(spec.angle);
    const laneWidth = spec.laneWidth ?? DEFAULTS.laneWidth;
    const medianWidth = spec.medianWidth ?? DEFAULTS.medianWidth;
    out.set(spec.id, {
      id: spec.id,
      dir,
      // Inbound traffic heads towards the centre (-dir) and drives on its `side`.
      inNormal: scale(perpLeft(dir), side),
      boxEdge,
      stopLine,
      crosswalkCenter,
      inEdge: medianWidth / 2 + spec.lanesIn * laneWidth,
      outEdge: medianWidth / 2 + spec.lanesOut * laneWidth,
      length: Math.max(spec.length, stopLine + 10),
      laneWidth,
      medianWidth,
    });
  });
  return out;
}

function along(g: LegGeometry, s: number, offset: number): Vec2 {
  return add(scale(g.dir, s), scale(g.inNormal, offset));
}

/** Signed turn angle in degrees; positive = counter-clockwise (left in y-up). */
function turnAngle(heading: Vec2, outDir: Vec2): number {
  return (Math.atan2(cross(heading, outDir), dot(heading, outDir)) * 180) / Math.PI;
}

function classifyTurn(angle: number, side: number): TurnKind {
  if (Math.abs(angle) < THROUGH_ANGLE) return 'through';
  // Right-hand traffic: a right turn (negative angle) stays on the near side.
  return angle * side < 0 ? 'near' : 'far';
}

/** Distance of lane `index` (0 = curb) from the leg centreline. */
const laneOffset = (g: LegGeometry, lanes: number, index: number) => g.medianWidth / 2 + (lanes - 1 - index + 0.5) * g.laneWidth;

/**
 * Path through the junction: straight on, a circular arc of at most `maxRadius`, straight out.
 * Nearly straight movements, or lanes whose lines don't meet ahead, get a smooth S-curve instead.
 */
function connectorPath(inPath: Polyline, outPath: Polyline, maxRadius: number): Polyline {
  const p0 = inPath.pointAt(inPath.length);
  const d0 = inPath.directionAt(inPath.length);
  const p3 = outPath.pointAt(0);
  const d3 = outPath.directionAt(0);
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(d0, d3))));
  const meet = rayMeet(p0, d0, p3, d3);

  if (theta < (THROUGH_ANGLE * Math.PI) / 180 || !meet) {
    const d = dist(p0, p3);
    const k = d * 0.4;
    return new Polyline(cubicBezier(p0, add(p0, scale(d0, k)), add(p3, scale(d3, -k)), p3, Math.max(8, Math.ceil(d))));
  }

  // Largest arc that fits between the two lane ends, capped by maxRadius.
  const tanHalf = Math.tan(theta / 2);
  const room = Math.min(meet.a, meet.b);
  const r = Math.min(maxRadius, room / tanHalf);
  const t = r * tanHalf;
  const t1 = add(p0, scale(d0, meet.a - t));
  const t2 = add(p3, scale(d3, -(meet.b - t)));
  const h = (4 / 3) * Math.tan(theta / 4) * r;
  const arc = cubicBezier(t1, add(t1, scale(d0, h)), add(t2, scale(d3, -h)), t2, Math.max(8, Math.ceil(r * theta)));
  const pts: Vec2[] = [];
  if (meet.a - t > 0.05) pts.push(p0);
  pts.push(...arc);
  if (meet.b - t > 0.05) pts.push(p3);
  return new Polyline(pts);
}

/** Where the ray from p along d meets the ray arriving at q along e: distances a (ahead of p) and b (before q). */
function rayMeet(p: Vec2, d: Vec2, q: Vec2, e: Vec2): { a: number; b: number } | null {
  const denom = cross(d, e);
  if (Math.abs(denom) < 1e-9) return null;
  const w = { x: q.x - p.x, y: q.y - p.y };
  const a = cross(w, e) / denom;
  const b = cross(d, w) / denom;
  if (a <= 0 || b <= 0) return null;
  return { a, b };
}

function assignSignalPhases(scenario: Scenario, connectors: Connector[]) {
  if (scenario.control.type !== 'signals') return;
  scenario.control.phases.forEach((phase, p) => {
    for (const c of connectors) {
      if (phase.movements.some((m) => m.from === c.from && (m.to === '*' || m.to === c.to))) {
        c.greenPhases.push(p);
      }
    }
  });
}

const TURN_RANK: Record<TurnKind, number> = { through: 0, near: 1, far: 2 };

/** Returns true if connector a must give way to connector b. */
function aYieldsToB(scenario: Scenario, legs: Map<string, LegGeometry>, a: Connector, b: Connector, side: number): boolean {
  const control = scenario.control;
  if (control.type === 'priority' && control.major.length > 0) {
    const aMajor = control.major.includes(a.from);
    const bMajor = control.major.includes(b.from);
    if (aMajor !== bMajor) return bMajor;
  }
  if (TURN_RANK[a.turn] !== TURN_RANK[b.turn]) return TURN_RANK[a.turn] > TURN_RANK[b.turn];
  // Same class: give way to traffic approaching from your near side.
  const heading = scale(legs.get(a.from)!.dir, -1);
  const c = cross(heading, legs.get(b.from)!.dir) * side;
  if (Math.abs(c) > 1e-6) return c < 0;
  return a.idx > b.idx;
}

function findConflicts(scenario: Scenario, legs: Map<string, LegGeometry>, connectors: Connector[], side: number) {
  for (let i = 0; i < connectors.length; i++) {
    for (let j = i + 1; j < connectors.length; j++) {
      const a = connectors[i]!;
      const b = connectors[j]!;
      if (a.inLane === b.inLane) {
        // Diverging from one lane: car-following until the paths have split apart.
        a.siblings.push({ other: j, until: closeStretch(b.path, a.path)?.[1] ?? 0 });
        b.siblings.push({ other: i, until: closeStretch(a.path, b.path)?.[1] ?? 0 });
        continue;
      }

      const merge = a.outLane === b.outLane;
      const ra = closeStretch(a.path, b.path);
      const rb = closeStretch(b.path, a.path);
      if (!ra || !rb) {
        if (!merge) continue;
      }
      const kind: 'cross' | 'merge' = merge ? 'merge' : 'cross';
      // Merging paths share everything from where they meet to the end.
      const [aStart, aEnd] = merge ? [ra?.[0] ?? a.path.length, a.path.length] : ra!;
      const [bStart, bEnd] = merge ? [rb?.[0] ?? b.path.length, b.path.length] : rb!;

      const aYields = aYieldsToB(scenario, legs, a, b, side);
      const refA: ConflictRef = { other: j, s: aStart, sEnd: aEnd, sOther: bStart, sOtherEnd: bEnd, kind, yields: aYields };
      const refB: ConflictRef = { other: i, s: bStart, sEnd: bEnd, sOther: aStart, sOtherEnd: aEnd, kind, yields: !aYields };
      a.conflicts.push(refA);
      b.conflicts.push(refB);
    }
  }
}

/** The stretch of p (as arc lengths) that runs within PROXIMITY of q, or null if they never get that close. */
function closeStretch(p: Polyline, q: Polyline): [number, number] | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < p.points.length; i++) {
    const pt = p.points[i]!;
    let best = Infinity;
    for (let j = 0; j < q.points.length - 1; j++) best = Math.min(best, distToSegment(pt, q.points[j]!, q.points[j + 1]!));
    if (best < PROXIMITY) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  // Widen by one sample on each side so the stretch covers the true boundary.
  const lo = p.cumulative[Math.max(0, first - 1)]!;
  const hi = p.cumulative[Math.min(p.points.length - 1, last + 1)]!;
  return [lo, hi];
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

function buildCrosswalks(scenario: Scenario, legs: Map<string, LegGeometry>, connectors: Connector[]): Crosswalk[] {
  return scenario.crosswalks.map((spec, idx) => {
    const g = legs.get(spec.leg)!;
    const c = g.crosswalkCenter!;
    const path = new Polyline([along(g, c, -(g.outEdge + 1)), along(g, c, g.inEdge + 1)]);
    const greenPhases: number[] = [];
    if (scenario.control.type === 'signals') {
      scenario.control.phases.forEach((ph, p) => {
        if (ph.pedestrians?.includes(spec.leg)) greenPhases.push(p);
      });
    }
    const cw: Crosswalk = { idx, leg: spec.leg, type: spec.type, path, width: DEFAULTS.crosswalkWidth, crossings: [], greenPhases };
    for (const conn of connectors) {
      const hits = polylineIntersections(conn.path, path);
      for (const h of hits) {
        cw.crossings.push({ connector: conn.idx, s: h.sp, sCrosswalk: h.sq });
        conn.crosswalkCrossings.push({ crosswalk: idx, s: h.sp, sCrosswalk: h.sq });
      }
    }
    return cw;
  });
}

/** Rounded curb returns between each pair of neighbouring legs. */
function buildCorners(legs: Map<string, LegGeometry>, side: number): Vec2[][] {
  const sorted = [...legs.values()].sort((a, b) => Math.atan2(a.dir.y, a.dir.x) - Math.atan2(b.dir.y, b.dir.x));
  if (sorted.length < 2) return [];
  return sorted.map((a, i) => {
    const b = sorted[(i + 1) % sorted.length]!;
    // A's counter-clockwise edge meets B's clockwise edge.
    const pa = add(scale(a.dir, a.boxEdge), scale(perpLeft(a.dir), side === 1 ? a.inEdge : a.outEdge));
    const pb = add(scale(b.dir, b.boxEdge), scale(perpLeft(b.dir), -(side === 1 ? b.outEdge : b.inEdge)));
    let gap = Math.atan2(b.dir.y, b.dir.x) - Math.atan2(a.dir.y, a.dir.x);
    if (gap <= 0) gap += Math.PI * 2;
    if (gap >= (175 * Math.PI) / 180) return [pa, pb]; // nearly straight or reflex: plain edge
    const c = lineIntersection(pa, a.dir, pb, b.dir) ?? scale(add(pa, pb), 0.5);
    const pts: Vec2[] = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const u = 1 - t;
      pts.push({ x: u * u * pa.x + 2 * u * t * c.x + t * t * pb.x, y: u * u * pa.y + 2 * u * t * c.y + t * t * pb.y });
    }
    return pts;
  });
}

function lineIntersection(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const denom = d.x * e.y - d.y * e.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / denom;
  return add(p, scale(d, t));
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const norm360 = (a: number) => ((a % 360) + 360) % 360;
