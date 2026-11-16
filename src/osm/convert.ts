// Turning OpenStreetMap data around a point into a playable junction. Real map data is messy:
// roads are split into many ways, a divided road appears as two one-way ways, and lane counts are
// often missing. This keeps what the simulator can use and says what it simplified.
import { t } from '../core/i18n';
import { MAX_LANES, type ControlSpec, type CrosswalkSpec, type DriveSide, type LegSpec, type Scenario, type VehicleDemand } from '../core/types';
import { autoSignalPlan } from '../scenarios/setup';
import { MAX_LEGS, MIN_GAP } from '../scenarios/shape';

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export interface ImportedLeg {
  id: string;
  name: string;
  highway: string;
  angle: number;
  lanesIn: number;
  lanesOut: number;
}

export interface ImportResult {
  scenario: Scenario;
  legs: ImportedLeg[];
  /** What was simplified or guessed, in plain words. */
  notes: string[];
  /** Where the junction actually is (may differ from the point asked for). */
  center: { lat: number; lon: number };
}

/** Roads that cars use, with a rough importance and peak-hour traffic per approach lane. */
const ROAD_CLASSES: Record<string, { rank: number; perLane: number }> = {
  motorway: { rank: 8, perLane: 900 },
  trunk: { rank: 7, perLane: 800 },
  primary: { rank: 6, perLane: 600 },
  secondary: { rank: 5, perLane: 450 },
  tertiary: { rank: 4, perLane: 350 },
  motorway_link: { rank: 4, perLane: 400 },
  trunk_link: { rank: 4, perLane: 350 },
  primary_link: { rank: 3, perLane: 300 },
  secondary_link: { rank: 3, perLane: 250 },
  tertiary_link: { rank: 3, perLane: 200 },
  unclassified: { rank: 2, perLane: 200 },
  residential: { rank: 1, perLane: 150 },
  living_street: { rank: 0, perLane: 60 },
};

export const ROAD_FILTER = Object.keys(ROAD_CLASSES).join('|');

/** How far around the point to look for the junction, m. */
export const SEARCH_RADIUS = 80;
/** Junction nodes this close together are one junction (a divided road crossing makes several). */
const CLUSTER_RADIUS = 28;
/** A road's direction is read this far out from the junction. */
const BEARING_DISTANCE = 35;

interface Pt {
  x: number;
  y: number;
}

/** A road leaving the junction: one direction of one way. */
interface Branch {
  way: OsmElement;
  angle: number;
  /** Following this branch outwards is the way's own node order. */
  outwardIsForward: boolean;
  lanesIn: number;
  lanesOut: number;
}

export function osmToScenario(elements: OsmElement[], point: { lat: number; lon: number }): ImportResult | { error: string } {
  const notes: string[] = [];
  const nodes = new Map<number, OsmElement>();
  for (const e of elements) if (e.type === 'node' && e.lat !== undefined) nodes.set(e.id, e);
  const ways = elements.filter((e) => e.type === 'way' && e.nodes && e.tags?.highway && ROAD_CLASSES[e.tags.highway]);
  if (ways.length === 0) return { error: t('No roads for cars here. Try a point right on a junction.', 'Burada araç yolu yok. Tam bir kavşağın üzerindeki bir noktayı deneyin.') };

  // Local metres around the point (fine over a few hundred metres).
  const k = Math.cos((point.lat * Math.PI) / 180);
  const local = (n: OsmElement): Pt => ({ x: (n.lon! - point.lon) * 111320 * k, y: (n.lat! - point.lat) * 110540 });
  const at = (id: number) => local(nodes.get(id)!);
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

  const ringWays = ways.filter((w) => w.tags!.junction === 'roundabout' || w.tags!.junction === 'circular');
  const roadWays = ways.filter((w) => !ringWays.includes(w));
  let center: Pt;
  let junctionNodes: Set<number>;
  let roundabout = false;

  const ring = nearestRing(ringWays, at);
  if (ring && dist(ring.center, { x: 0, y: 0 }) < SEARCH_RADIUS) {
    roundabout = true;
    center = ring.center;
    junctionNodes = ring.nodes;
    notes.push(t('Found a roundabout.', 'Dönel kavşak bulundu.'));
  } else {
    // A junction node is where three or more road branches meet.
    const degree = new Map<number, number>();
    for (const w of roadWays) {
      w.nodes!.forEach((id, i) => degree.set(id, (degree.get(id) ?? 0) + (i === 0 || i === w.nodes!.length - 1 ? 1 : 2)));
    }
    const candidates = [...degree].filter(([id, d]) => d >= 3 && nodes.has(id)).map(([id]) => id);
    const nearest = candidates.sort((a, b) => dist(at(a), { x: 0, y: 0 }) - dist(at(b), { x: 0, y: 0 }))[0];
    if (nearest === undefined || dist(at(nearest), { x: 0, y: 0 }) > SEARCH_RADIUS) {
      return { error: t('No junction within 80 m of that point. Try a point right on a junction.', 'Bu noktanın 80 m yakınında kavşak yok. Tam bir kavşağın üzerindeki bir noktayı deneyin.') };
    }
    const cluster = candidates.filter((id) => dist(at(id), at(nearest)) <= CLUSTER_RADIUS);
    junctionNodes = new Set(cluster);
    center = cluster.reduce((c, id) => ({ x: c.x + at(id).x / cluster.length, y: c.y + at(id).y / cluster.length }), { x: 0, y: 0 });
    if (cluster.length > 1) notes.push(t(`Treated ${cluster.length} nearby crossing points as one junction.`, `Yakındaki ${cluster.length} kesişme noktası tek kavşak sayıldı.`));
  }

  // Every road branch leaving the junction.
  const branches: Branch[] = [];
  for (const w of roadWays) {
    const ids = w.nodes!;
    ids.forEach((id, i) => {
      if (!junctionNodes.has(id)) return;
      for (const dir of [1, -1] as const) {
        const next = ids[i + dir];
        if (next === undefined || junctionNodes.has(next)) continue; // dead end, or a link inside the junction
        const path: Pt[] = [];
        for (let j = i; j >= 0 && j < ids.length; j += dir) if (nodes.has(ids[j]!)) path.push(at(ids[j]!));
        const far = path.find((p) => dist(p, center) >= BEARING_DISTANCE) ?? path[path.length - 1]!;
        if (dist(far, center) < 5) continue;
        const outwardIsForward = dir === 1;
        branches.push({ way: w, angle: norm((Math.atan2(far.y - center.y, far.x - center.x) * 180) / Math.PI), outwardIsForward, ...lanesOf(w, outwardIsForward) });
      }
    });
  }
  // A divided road shows up as two one-way branches side by side: merge anything closer than MIN_GAP.
  const legs = mergeBranches(branches, notes);
  const usable = legs.filter((l) => l.lanesIn + l.lanesOut > 0);
  if (usable.length < 2) return { error: t('Found fewer than two usable roads here.', 'Burada kullanılabilir ikiden az yol bulundu.') };
  let kept = usable;
  if (usable.length > MAX_LEGS) {
    kept = [...usable].sort((a, b) => b.rank - a.rank || b.lanesIn + b.lanesOut - (a.lanesIn + a.lanesOut)).slice(0, MAX_LEGS);
    notes.push(t(`Kept the ${MAX_LEGS} most important of ${usable.length} roads.`, `${usable.length} yoldan en önemli ${MAX_LEGS} tanesi alındı.`));
  }
  kept.sort((a, b) => a.angle - b.angle);

  const legSpecs: LegSpec[] = kept.map((l, i) => ({
    id: String(i + 1),
    angle: Math.round(l.angle),
    length: 120,
    lanesIn: Math.min(MAX_LANES, l.lanesIn),
    lanesOut: Math.min(MAX_LANES, l.lanesOut),
    ...(l.name ? { name: l.name } : {}),
  }));
  if (kept.some((l) => l.lanesIn > MAX_LANES || l.lanesOut > MAX_LANES)) notes.push(t('Roads with more than 4 lanes each way were narrowed to 4.', 'Her yönde 4’ten fazla şeridi olan yollar 4 şeride indirildi.'));

  // Control: a roundabout, signals at or right by the junction, priority for a clearly bigger road, or none.
  const tagged = (want: (t: Record<string, string>) => boolean) =>
    [...nodes.values()].filter((n) => n.tags && want(n.tags) && dist(local(n), center) <= 40);
  let control: ControlSpec;
  if (roundabout) control = { type: 'roundabout' };
  else if (tagged((t) => t.highway === 'traffic_signals').length > 0) {
    control = { type: 'signals', phases: autoSignalPlan(legSpecs, 25) };
    notes.push(t('Traffic lights found; their timing is a standard two-phase guess.', 'Trafik ışıkları bulundu; süreleri standart iki fazlı bir tahmindir.'));
  } else {
    const top = Math.max(...kept.map((l) => l.rank));
    const major = kept.map((l, i) => ({ l, id: legSpecs[i]!.id })).filter(({ l }) => l.rank === top);
    if (major.length === 2 && kept.some((l) => l.rank < top)) {
      control = { type: 'priority', major: major.map((m) => m.id) };
      notes.push(major[0]!.l.name ? t(`${major[0]!.l.name} has priority.`, `${major[0]!.l.name} öncelikli.`) : t('The main road has priority.', 'Ana yol öncelikli.'));
    } else control = { type: 'priority', major: [] };
  }

  // Crossings: crossing nodes near the junction, on the nearest road. Without lights, a signalised
  // crossing can't have its own phase, so it becomes a zebra.
  const crosswalks: CrosswalkSpec[] = [];
  for (const n of tagged((t) => t.highway === 'crossing' || (!!t.crossing && t.crossing !== 'no'))) {
    const t = n.tags!;
    if (t.crossing === 'unmarked' || t.crossing === 'no') continue;
    const p = local(n);
    const a = norm((Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI);
    const leg = legSpecs.reduce((best, l) => (angleGap(l.angle, a) < angleGap(best.angle, a) ? l : best));
    if (angleGap(leg.angle, a) > 25 || crosswalks.some((c) => c.leg === leg.id)) continue;
    const signalled = t.crossing === 'traffic_signals' || t['crossing:signals'] === 'yes';
    crosswalks.push({ leg: leg.id, type: signalled && control.type === 'signals' ? 'signal' : 'zebra' });
  }
  if (crosswalks.length) notes.push(t(`${crosswalks.length} pedestrian crossing${crosswalks.length > 1 ? 's' : ''}.`, `${crosswalks.length} yaya geçidi.`));

  const scenario: Scenario = {
    version: 1,
    name: kept.map((l) => l.name).filter(Boolean).slice(0, 2).join(' / ') || t('Imported junction', 'İçe aktarılan kavşak'),
    driveSide: driveSideAt(point.lat, point.lon),
    seed: 1,
    legs: legSpecs,
    crosswalks,
    control,
    demand: { vehicles: estimateDemand(kept, legSpecs), pedestrians: legSpecs.map((l) => ({ leg: l.id, pedPerHour: 120 })) },
    source: { kind: 'osm', lat: point.lat, lon: point.lon },
  };
  notes.push(t('Traffic volumes are estimated from road types: adjust them in the Traffic table.', 'Trafik hacimleri yol türlerinden tahmin edildi: Trafik tablosundan ayarlayın.'));

  const centerLatLon = { lat: point.lat + center.y / 110540, lon: point.lon + center.x / (111320 * k) };
  const imported: ImportedLeg[] = kept.map((l, i) => ({ id: legSpecs[i]!.id, name: l.name, highway: l.highway, angle: legSpecs[i]!.angle, lanesIn: legSpecs[i]!.lanesIn, lanesOut: legSpecs[i]!.lanesOut }));
  return { scenario, legs: imported, notes, center: centerLatLon };
}

/** The roundabout whose ring is closest to the point, with its centre and nodes. */
function nearestRing(rings: OsmElement[], at: (id: number) => Pt): { center: Pt; nodes: Set<number> } | null {
  if (rings.length === 0) return null;
  // Rings are often split into several ways: join ways that share nodes.
  const groups: Array<Set<number>> = [];
  for (const w of rings) {
    const ids = new Set(w.nodes!);
    const touching = groups.filter((g) => [...ids].some((id) => g.has(id)));
    const merged = new Set([...ids, ...touching.flatMap((g) => [...g])]);
    for (const g of touching) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  let best: { center: Pt; nodes: Set<number> } | null = null;
  for (const g of groups) {
    const pts = [...g].map((id) => {
      try {
        return at(id);
      } catch {
        return null;
      }
    }).filter((p): p is Pt => p !== null);
    if (pts.length < 3) continue;
    const c = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 });
    if (!best || Math.hypot(c.x, c.y) < Math.hypot(best.center.x, best.center.y)) best = { center: c, nodes: g };
  }
  return best;
}

/** Lanes towards and away from the junction for one branch of a way. */
function lanesOf(w: OsmElement, outwardIsForward: boolean): { lanesIn: number; lanesOut: number } {
  const t = w.tags!;
  const num = (v: string | undefined) => {
    const n = parseInt(v ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' ? 1 : t.oneway === '-1' ? -1 : 0;
  if (oneway !== 0) {
    const lanes = num(t.lanes) ?? 1;
    // Traffic runs in node order (oneway=yes) or against it (-1).
    const outward = (oneway === 1) === outwardIsForward;
    return outward ? { lanesIn: 0, lanesOut: lanes } : { lanesIn: lanes, lanesOut: 0 };
  }
  const total = num(t.lanes);
  const forward = num(t['lanes:forward']) ?? (total ? Math.ceil(total / 2) : 1);
  const backward = num(t['lanes:backward']) ?? (total ? Math.max(1, total - forward) : 1);
  return outwardIsForward ? { lanesIn: backward, lanesOut: forward } : { lanesIn: forward, lanesOut: backward };
}

interface MergedLeg {
  angle: number;
  lanesIn: number;
  lanesOut: number;
  rank: number;
  highway: string;
  name: string;
}

function mergeBranches(branches: Branch[], notes: string[]): MergedLeg[] {
  const sorted = [...branches].sort((a, b) => a.angle - b.angle);
  const groups: Branch[][] = [];
  for (const b of sorted) {
    const last = groups[groups.length - 1];
    if (last && angleGap(last[0]!.angle, b.angle) < MIN_GAP) last.push(b);
    else groups.push([b]);
  }
  // The list wraps round: the last group may belong with the first.
  if (groups.length > 1 && angleGap(groups[0]![0]!.angle, groups[groups.length - 1]![0]!.angle) < MIN_GAP) {
    groups[0]!.push(...groups.pop()!);
  }
  let merged = 0;
  const legs = groups.map((g) => {
    if (g.length > 1) merged++;
    const best = g.reduce((a, b) => (rankOf(b.way) > rankOf(a.way) ? b : a));
    // Circular mean of the branch directions.
    const sx = g.reduce((s, b) => s + Math.cos((b.angle * Math.PI) / 180), 0);
    const sy = g.reduce((s, b) => s + Math.sin((b.angle * Math.PI) / 180), 0);
    return {
      angle: norm((Math.atan2(sy, sx) * 180) / Math.PI),
      lanesIn: g.reduce((s, b) => s + b.lanesIn, 0),
      lanesOut: g.reduce((s, b) => s + b.lanesOut, 0),
      rank: rankOf(best.way),
      highway: best.way.tags!.highway!,
      name: g.map((b) => b.way.tags!.name ?? b.way.tags!.ref ?? '').find((n) => n) ?? '',
    };
  });
  if (merged) notes.push(t(`Merged ${merged} pair${merged > 1 ? 's' : ''} of road pieces running side by side (divided roads).`, `Yan yana uzanan ${merged} çift yol parçası birleştirildi (bölünmüş yollar).`));
  return legs;
}

/** Peak-hour traffic by road type, split across destinations in proportion to their importance. */
function estimateDemand(legs: MergedLeg[], specs: LegSpec[]): VehicleDemand[] {
  const weight = (l: MergedLeg) => (ROAD_CLASSES[l.highway]?.perLane ?? 150) * Math.max(1, Math.min(MAX_LANES, l.lanesOut));
  const out: VehicleDemand[] = [];
  legs.forEach((from, i) => {
    const lanesIn = Math.min(MAX_LANES, from.lanesIn);
    if (lanesIn === 0) return;
    const total = (ROAD_CLASSES[from.highway]?.perLane ?? 150) * (1 + 0.6 * (lanesIn - 1));
    const dests = legs.map((to, j) => ({ to, j })).filter(({ to, j }) => j !== i && Math.min(MAX_LANES, to.lanesOut) > 0);
    const sum = dests.reduce((s, d) => s + weight(d.to), 0);
    for (const { to, j } of dests) {
      out.push({ from: specs[i]!.id, to: specs[j]!.id, vehPerHour: Math.max(10, Math.round(((total * weight(to)) / sum) / 10) * 10) });
    }
  });
  return out;
}

/** Rough boxes for the main left-hand-traffic countries; everywhere else drives on the right. */
const LEFT_HAND: Array<[number, number, number, number]> = [
  [49.8, -8.7, 60.9, 1.8], // Great Britain
  [51.4, -10.7, 55.4, -5.9], // Ireland
  [24.0, 122.9, 45.6, 146.0], // Japan
  [6.5, 68.0, 35.7, 97.4], // India (roughly, with Sri Lanka, Bangladesh, Nepal)
  [-44.0, 112.0, -10.0, 154.0], // Australia
  [-47.5, 166.0, -34.0, 179.0], // New Zealand
  [-35.0, 16.0, -22.0, 33.0], // South Africa and neighbours
  [-1.6, 103.5, 1.5, 104.1], // Singapore
  [1.0, 99.5, 7.5, 119.5], // Malaysia
  [-11.0, 95.0, 6.0, 141.0], // Indonesia
  [22.1, 113.8, 22.6, 114.4], // Hong Kong
  [-5.0, 33.9, 5.0, 41.9], // Kenya
  [17.6, -78.4, 18.6, -76.1], // Jamaica
];

export function driveSideAt(lat: number, lon: number): DriveSide {
  return LEFT_HAND.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e) ? 'left' : 'right';
}

const rankOf = (w: OsmElement) => ROAD_CLASSES[w.tags!.highway!]?.rank ?? 0;
const norm = (a: number) => ((a % 360) + 360) % 360;
const angleGap = (a: number, b: number) => {
  const d = Math.abs(norm(a) - norm(b));
  return d > 180 ? 360 - d : d;
};
