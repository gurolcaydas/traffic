import { streamRng, type Rng } from '../core/rng';
import type { LegId, Scenario } from '../core/types';
import { buildNetwork } from '../network/build';
import { movementKey, type ConflictRef, type Connector, type Network } from '../network/network';
import { demandFactor, maxDemandFactor, pedFactor } from '../scenarios/patterns';
import { DEFAULT_IDM, MAX_DECEL, idm, stoppingDistance, timeToTravel, type IdmParams } from './kinematics';
import { MetricsCollector, type MetricsSnapshot } from './metrics';
import { SignalController, connectorSignal, stateFor, type SignalClock } from './signals';

/** Where a vehicle is on its route: approach lane, junction connector, exit lane. */
export type Segment = 0 | 1 | 2;

export interface Vehicle {
  id: number;
  from: LegId;
  to: LegId;
  inLane: number;
  connector: number;
  outLane: number;
  seg: Segment;
  /** Arc length of the front bumper along the current segment. */
  s: number;
  v: number;
  acc: number;
  length: number;
  /** Personal desired-speed factor, so not every driver is identical. */
  speedFactor: number;
  /** True once the vehicle has been cleared to enter the junction. */
  committed: boolean;
  /** When the vehicle wanted to enter the map (it may have waited off-map in the backlog). */
  arrivalTime: number;
  /** Continuous time spent (nearly) stopped. */
  stoppedFor: number;
  /** While changing lanes: the lane being left, and progress 0..1 of the sideways move. */
  lcFrom: number | null;
  lcT: number;
  lastLaneChange: number;
  /**
   * Where along its turn this vehicle will stop and wait for a gap (pulled forward into the box),
   * or null if it is clear to go. Drivers with priority ignore it for conflicts beyond this point.
   */
  holdAt: number | null;
}

export interface Pedestrian {
  id: number;
  crosswalk: number;
  /** +1 walks along the crosswalk path, -1 walks against it. */
  dir: 1 | -1;
  /** Position along the crosswalk path. */
  s: number;
  speed: number;
  crossing: boolean;
  arrivalTime: number;
}

/** A vehicle that has arrived but not yet found room on the map. Its traits are fixed on arrival. */
interface PendingVehicle {
  to: LegId;
  arrivalTime: number;
  length: number;
  speedFactor: number;
  /** Uniform draw deciding whether this driver starts in the right lane for their turn. */
  laneDraw: number;
}

const DT_DEFAULT = 0.1;
const STOPPED_SPEED = 0.5;
const QUEUED_SPEED = 2;
/** How far ahead of the stop line drivers start deciding whether they may enter. */
const DECISION_DISTANCE = 30;
const LOOK_AHEAD = 200;
const PRIORITY_LOOKBACK = 150;
/** Extra seconds of clearance required behind a priority vehicle. */
const CROSS_MARGIN = 0.8;
const MERGE_HEADWAY = 1.2;
/**
 * Speed a driver slows to at the line when their movement must give way and no light tells them it's
 * clear: they have to look before going, whether or not anyone is coming.
 */
const CAUTION_SPEED = 4.5;
/** Margin a driver with priority keeps from someone who has already committed to cross. */
const COMMITTED_MARGIN = 0.3;
/** A car in a conflict zone only holds back drivers who would reach that zone within this many seconds. */
const OCCUPIED_HORIZON = 2.5;
/** Acceleration a driver counts on when pulling out into a gap. */
const GAP_ACCEL = 2.5;
/** Acceleration assumed for approaching priority traffic (they may speed up a little). */
const PRIORITY_ACCEL = 1.0;
/** Deceleration a driver accepts to stop for a signal or a give-way line. */
const STOP_DECEL = 3.5;
/** Pedestrians closer than this (along the crosswalk) to a vehicle path block it. */
const PED_CLEARANCE = 3.0;
// Lane changing (MOBIL: Kesting, Treiber & Helbing 2007).
/** Seconds a sideways move takes. */
const LC_DURATION = 3;
/** Steepest a vehicle angles across while changing lane (radians, about 17°). */
const MAX_LC_ANGLE = 0.3;
/** Minimum seconds between two lane changes by the same driver. */
const LC_COOLDOWN = 4;
/** Acceleration advantage, m/s², a driver needs before changing lanes by choice. */
const LC_THRESHOLD = 0.3;
/** How much a driver weighs the disadvantage to the car they cut in front of. */
const LC_POLITENESS = 0.3;
/** The new follower must never have to brake harder than this. */
const LC_SAFE_DECEL = 4;
/** No changes by choice this close to the stop line (solid lane lines). */
const NO_CHANGE_ZONE = 15;
/** No lane changes in the first stretch after entering the map, while traffic is still settling. */
const ENTRY_ZONE = 30;
/** Within this distance of the line, a driver in the wrong lane gets urgent and others let them in. */
const URGENT_ZONE = 40;
/** Share of drivers who enter in whatever lane has room and must move across for their turn. */
const WRONG_LANE_SHARE = 0.25;
/** A driver stuck in the wrong lane at the line this long gives up and takes a turn their lane allows. */
const GIVE_UP_AFTER = 45;
const GRIDLOCK_BACKLOG = 25;
const GRIDLOCK_STOPPED = 180;

export class Simulation {
  network: Network;
  scenario: Scenario;
  readonly dt: number;
  time = 0;
  vehicles: Vehicle[] = [];
  pedestrians: Pedestrian[] = [];
  clock: SignalClock | null = null;
  private signals: SignalController;

  /**
   * One random stream per traffic flow, keyed by name. Arrivals and vehicle traits come only from
   * these, and only at arrival time, so two different designs run with the same seed see exactly
   * the same traffic: the basis of fair comparisons.
   */
  private streams = new Map<string, Rng>();
  /** Clock time of day at simulation time 0, in seconds (only meaningful with a demand pattern). */
  private dayStart = 0;
  /** Optional record of every arrival, for tests: [time, from, to]. */
  arrivalLog: Array<[number, LegId, LegId]> | null = null;
  private idm: IdmParams = DEFAULT_IDM;
  private nextId = 1;
  private nextVehicleArrival: number[];
  private nextPedArrival: number[];
  private backlog = new Map<LegId, PendingVehicle[]>();
  private laneVehicles: Vehicle[][] = [];
  private connVehicles: Vehicle[][] = [];
  private metrics: MetricsCollector;
  private arrivedCount = 0;
  private exitedCount = 0;
  private divertedCount = 0;
  private removedCount = 0;
  private laneChangeCount = 0;
  private missedTurnCount = 0;
  private stepCount = 0;
  /** Vehicles still partly in the lane they are leaving, by that lane. */
  private laneGhosts: Vehicle[][] = [];
  /** Urgent mergers waiting for a gap, by the lane they want to enter. */
  private mergeRequests = new Map<number, Vehicle[]>();
  /** Regular inbound lanes of each leg, curb first. */
  private regularIn = new Map<LegId, number[]>();

  constructor(scenario: Scenario, opts: { dt?: number } = {}) {
    this.scenario = scenario;
    this.network = buildNetwork(scenario);
    this.dt = opts.dt ?? DT_DEFAULT;

    for (const leg of scenario.legs) this.backlog.set(leg.id, []);
    this.signals = new SignalController(scenario.control);
    this.dayStart = (scenario.demand.pattern?.startHour ?? 0) * 3600;
    this.nextVehicleArrival = scenario.demand.vehicles.map((d) => this.vehStream(d).exponential(this.peakVehRate(d.vehPerHour)));
    this.nextPedArrival = scenario.demand.pedestrians.map((d) => this.pedStream(d).exponential(this.peakPedRate(d.pedPerHour)));
    this.metrics = new MetricsCollector(scenario.legs.map((l) => l.id));
    this.index();
  }

  run(seconds: number) {
    const steps = Math.round(seconds / this.dt);
    for (let i = 0; i < steps; i++) this.step();
  }

  step() {
    const dt = this.dt;
    this.clock = this.signals.clock();
    this.arrive();
    this.spawn();
    this.index();
    this.changeLanes();

    const accs = this.vehicles.map((veh) => this.acceleration(veh));
    this.vehicles.forEach((veh, i) => this.integrate(veh, accs[i]!, dt));
    this.vehicles = this.vehicles.filter((veh) => !this.exited(veh));

    this.index();
    this.updatePedestrians(dt);
    this.observeQueues();
    this.accumulateDelay(dt);
    this.signals.step(dt);
    this.time += dt;
    this.stepCount++;
  }

  /** Change traffic demand on the fly. Vehicles already on the map or waiting to enter are kept. */
  setDemand(demand: Scenario['demand']) {
    const before = this.scenario.demand.pattern?.id;
    this.scenario = { ...this.scenario, demand };
    // A newly chosen pattern starts its day now; changing only its direction keeps the clock.
    if (demand.pattern && demand.pattern.id !== before) this.setTimeOfDay(demand.pattern.startHour);
    this.nextVehicleArrival = demand.vehicles.map((d) => this.time + this.vehStream(d).exponential(this.peakVehRate(d.vehPerHour)));
    this.nextPedArrival = demand.pedestrians.map((d) => this.time + this.pedStream(d).exponential(this.peakPedRate(d.pedPerHour)));
  }

  /** Clock time of day in hours, or null without a demand pattern. */
  get timeOfDay(): number | null {
    return this.scenario.demand.pattern ? this.hourAt(this.time) : null;
  }

  /** Jump the clock. Arrivals are thinned against the clock, so nothing needs rescheduling. */
  setTimeOfDay(hour: number) {
    this.dayStart = hour * 3600 - this.time;
  }

  private hourAt(t: number) {
    return (this.dayStart + t) / 3600;
  }

  /** Candidate arrivals come at the pattern's peak rate and are thinned down to the rate of the moment. */
  private peakVehRate(vehPerHour: number) {
    return (vehPerHour * maxDemandFactor(this.scenario.demand.pattern)) / 3600;
  }

  private peakPedRate(pedPerHour: number) {
    const p = this.scenario.demand.pattern;
    return (pedPerHour * (p ? Math.max(...p.points.map(([, f]) => f)) : 1)) / 3600;
  }

  resetMetrics() {
    this.metrics.reset(this.scenario.legs.map((l) => l.id), this.time);
  }

  getMetrics(): MetricsSnapshot {
    return this.metrics.snapshot(this.time, this.scenario.control.type === 'signals', this.currentQueues(), this.isGridlocked());
  }

  /** Vehicle bookkeeping since the start: every arrival is either waiting, on the map, or gone. */
  counts() {
    let backlog = 0;
    for (const q of this.backlog.values()) backlog += q.length;
    return {
      arrived: this.arrivedCount,
      exited: this.exitedCount,
      onMap: this.vehicles.length,
      backlog,
      diverted: this.divertedCount,
      removed: this.removedCount,
      laneChanges: this.laneChangeCount,
      missedTurns: this.missedTurnCount,
    };
  }

  /**
   * Swap in an edited layout without stopping the traffic. Vehicles keep their place: on an approach
   * they keep their distance from the far end, in the junction their progress along the turn, on an
   * exit their distance to the map edge. Drivers whose turn is no longer possible pick the closest
   * allowed exit; anyone who no longer fits is put back in the queue to enter.
   */
  applyScenario(next: Scenario) {
    const old = this.network;
    const net = buildNetwork(next);
    this.network = net;
    this.scenario = next;
    this.signals.setControl(next.control);
    this.clock = this.signals.clock();
    this.regularIn.clear();
    this.mergeRequests.clear();
    for (const veh of this.vehicles) {
      veh.lcFrom = null;
      veh.lcT = 1;
      veh.holdAt = null;
    }

    for (const leg of next.legs) if (!this.backlog.has(leg.id)) this.backlog.set(leg.id, []);
    for (const id of [...this.backlog.keys()]) {
      if (!next.legs.some((l) => l.id === id)) {
        this.removedCount += this.backlog.get(id)!.length;
        this.backlog.delete(id);
      }
    }
    this.metrics.ensureLegs(next.legs.map((l) => l.id));
    this.setDemand(next.demand);

    const kept: Vehicle[] = [];
    for (const veh of this.vehicles) {
      if (this.remap(veh, old, net)) kept.push(veh);
      else this.removedCount++;
    }
    this.vehicles = kept;
    this.index();
    this.resolveOverlaps();

    this.pedestrians = this.pedestrians.flatMap((ped) => {
      const oldCw = old.crosswalks[ped.crosswalk]!;
      const idx = net.crosswalks.findIndex((c) => c.leg === oldCw.leg);
      if (idx < 0) return [];
      const ratio = net.crosswalks[idx]!.path.length / oldCw.path.length;
      return [{ ...ped, crosswalk: idx, s: ped.s * ratio }];
    });
    this.index();
  }

  /** Re-attach a vehicle to the new network. Returns false if it has nowhere to go. */
  private remap(veh: Vehicle, old: Network, net: Network): boolean {
    // Destination: keep it if still possible from this leg, otherwise the closest allowed exit.
    if (!net.movementLanes.has(movementKey(veh.from, veh.to))) {
      const wanted = old.legs.get(veh.to)!.dir;
      const options = net.scenario.legs.filter((l) => net.movementLanes.has(movementKey(veh.from, l.id)));
      if (options.length === 0 || veh.seg === 2) {
        if (veh.seg !== 2) return false;
      } else {
        const best = options.reduce((a, b) => {
          const da = net.legs.get(a.id)!.dir;
          const db = net.legs.get(b.id)!.dir;
          return da.x * wanted.x + da.y * wanted.y >= db.x * wanted.x + db.y * wanted.y ? a : b;
        });
        veh.to = best.id;
      }
    }

    const oldIn = old.lanes[veh.inLane]!;
    const oldConn = old.connectors[veh.connector]!;
    const oldOut = old.lanes[veh.outLane]!;
    const lanesFor = (leg: string, kind: 'in' | 'out') => net.lanes.filter((l) => l.leg === leg && l.kind === kind);
    // Prefer the same role and position; otherwise the nearest lane by offset.
    const closest = (candidates: typeof net.lanes, like: typeof oldIn) =>
      candidates.find((l) => l.role === like.role && l.index === like.index) ??
      candidates.reduce((a, b) => (Math.abs(a.offset - like.offset) <= Math.abs(b.offset - like.offset) ? a : b));

    if (veh.seg === 2) {
      const outs = lanesFor(veh.to, 'out');
      if (outs.length === 0) return false;
      const lane = closest(outs, oldOut);
      const conn = net.connectors.find((c) => c.outLane === lane.idx) ?? net.connectors.find((c) => c.to === veh.to);
      veh.outLane = lane.idx;
      // Same distance to the far end of the road.
      veh.s = Math.max(veh.length, lane.path.length - (oldOut.path.length - veh.s));
      if (conn) {
        veh.connector = conn.idx;
        veh.inLane = conn.inLane;
      } else {
        veh.s = Math.max(veh.s, veh.length + 0.5); // no turn feeds this lane; keep the body on it
      }
      return true;
    }

    const allowed = net.movementLanes.get(movementKey(veh.from, veh.to))!.map((i) => net.lanes[i]!);
    const lane = closest(allowed, oldIn);
    const conn = (net.connectorsFromLane.get(lane.idx) ?? []).map((c) => net.connectors[c]!).find((c) => c.to === veh.to);
    if (!conn) return false;
    veh.inLane = lane.idx;
    veh.connector = conn.idx;
    veh.outLane = conn.outLane;

    if (veh.seg === 0) {
      veh.s = Math.min(veh.s, lane.path.length - 0.3);
      veh.committed = false;
    } else {
      // Same fraction of the way through the junction.
      veh.s = (veh.s / oldConn.path.length) * conn.path.length;
      veh.committed = true;
    }
    return true;
  }

  /** After a remap two vehicles can end up on top of each other; pull followers back. */
  private resolveOverlaps() {
    const gap = 1;
    const pushedOff: Vehicle[] = [];
    for (const list of [...this.laneVehicles, ...this.connVehicles]) {
      for (let i = 1; i < list.length; i++) {
        const leader = list[i - 1]!;
        const veh = list[i]!;
        const limit = leader.s - leader.length - gap;
        if (veh.s <= limit) continue;
        veh.s = limit;
        veh.v = Math.min(veh.v, leader.v);
        // No room left on an approach lane: back into the queue to enter the map.
        if (veh.seg === 0 && veh.s < veh.length) pushedOff.push(veh);
      }
    }
    if (pushedOff.length === 0) return;
    const off = new Set(pushedOff);
    this.vehicles = this.vehicles.filter((v) => !off.has(v));
    for (const veh of pushedOff) {
      this.backlog.get(veh.from)?.unshift({ to: veh.to, arrivalTime: veh.arrivalTime, length: veh.length, speedFactor: veh.speedFactor, laneDraw: 1 });
    }
  }

  /** World position and heading of a vehicle's centre, for rendering. */
  pose(veh: Vehicle): { x: number; y: number; heading: number } {
    if (veh.seg === 0 && veh.lcFrom !== null && veh.s >= veh.length / 2) {
      // Mid lane change: slide sideways from the old lane to the new one (smoothstep).
      const sc = veh.s - veh.length / 2;
      const from = this.network.lanes[veh.lcFrom]!.path.pointAt(sc);
      const to = this.network.lanes[veh.inLane]!.path.pointAt(sc);
      const d = this.network.lanes[veh.inLane]!.path.directionAt(sc);
      const t = veh.lcT;
      const k = t * t * (3 - 2 * t);
      const lateralSpeed = (6 * t * (1 - t)) / LC_DURATION;
      const hx = d.x * Math.max(veh.v, 1) + (to.x - from.x) * lateralSpeed;
      const hy = d.y * Math.max(veh.v, 1) + (to.y - from.y) * lateralSpeed;
      // Creeping sideways in a queue, a vehicle angles only slightly across, however slowly it moves:
      // a long one turned steeply would sweep into the next lane.
      const lane = Math.atan2(d.y, d.x);
      let turn = Math.atan2(hy, hx) - lane;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      const heading = lane + Math.max(-MAX_LC_ANGLE, Math.min(MAX_LC_ANGLE, turn));
      return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, heading };
    }
    const path = this.pathOf(veh);
    const sc = veh.s - veh.length / 2;
    // The centre can still be on the previous segment just after a transition.
    const p = sc >= 0 ? path.pointAt(sc) : this.prevPath(veh).pointAt(this.prevPath(veh).length + sc);
    const d = sc >= 0 ? path.directionAt(sc) : this.prevPath(veh).directionAt(this.prevPath(veh).length + sc);
    return { x: p.x, y: p.y, heading: Math.atan2(d.y, d.x) };
  }

  pedestrianPosition(ped: Pedestrian): { x: number; y: number } {
    return this.network.crosswalks[ped.crosswalk]!.path.pointAt(ped.s);
  }

  // --- demand -------------------------------------------------------------

  private stream(name: string): Rng {
    let rng = this.streams.get(name);
    if (!rng) {
      rng = streamRng(this.scenario.seed, name);
      this.streams.set(name, rng);
    }
    return rng;
  }

  private vehStream(d: { from: LegId; to: LegId }) {
    return this.stream(`veh:${d.from}>${d.to}`);
  }

  private pedStream(d: { leg: LegId }) {
    return this.stream(`ped:${d.leg}`);
  }

  private arrive() {
    const { vehicles, pedestrians, pattern } = this.scenario.demand;
    const peak = maxDemandFactor(pattern);
    vehicles.forEach((d, i) => {
      const rng = this.vehStream(d);
      while (this.nextVehicleArrival[i]! <= this.time) {
        const arrivalTime = this.nextVehicleArrival[i]!;
        this.nextVehicleArrival[i]! += rng.exponential(this.peakVehRate(d.vehPerHour));
        // Everything is drawn now, whatever happens next, so every design sees the same vehicles.
        const keep = rng.next() < demandFactor(pattern, this.hourAt(arrivalTime), d.from, d.to) / peak;
        const length = rng.next() < 0.06 ? 9 : 4.5;
        const speedFactor = rng.range(0.9, 1.1);
        const laneDraw = rng.next();
        if (!keep) continue;
        this.arrivedCount++;
        this.arrivalLog?.push([arrivalTime, d.from, d.to]);
        if (this.network.movementLanes.has(movementKey(d.from, d.to))) {
          this.backlog.get(d.from)!.push({ to: d.to, arrivalTime, length, speedFactor, laneDraw });
          this.metrics.recordArrival(d.from, arrivalTime);
        } else {
          // Banned or impossible on this layout: these drivers go another way.
          this.divertedCount++;
          this.metrics.recordDiverted();
        }
      }
    });
    const pedPeak = pattern ? Math.max(...pattern.points.map(([, f]) => f)) : 1;
    pedestrians.forEach((d, i) => {
      const rng = this.pedStream(d);
      while (this.nextPedArrival[i]! <= this.time) {
        const arrivalTime = this.nextPedArrival[i]!;
        this.nextPedArrival[i]! += rng.exponential(this.peakPedRate(d.pedPerHour));
        // Drawn whether or not this design has a crossing here, to keep the stream identical.
        const keep = rng.next() < pedFactor(pattern, this.hourAt(arrivalTime)) / pedPeak;
        const dir = rng.next() < 0.5 ? 1 : -1;
        const speed = rng.range(1.1, 1.5);
        if (!keep) continue;
        const cw = this.network.crosswalks.findIndex((c) => c.leg === d.leg);
        if (cw >= 0) {
          const path = this.network.crosswalks[cw]!.path;
          this.pedestrians.push({
            id: this.nextId++,
            crosswalk: cw,
            dir,
            s: dir === 1 ? 0 : path.length,
            speed,
            crossing: false,
            arrivalTime,
          });
        }
      }
    });
  }

  private spawn() {
    const net = this.network;
    for (const [leg, queue] of this.backlog) {
      const pending = queue[0];
      if (!pending) continue;
      const lanes = net.movementLanes.get(movementKey(leg, pending.to));
      if (!lanes || lanes.length === 0) {
        queue.shift(); // became impossible after an edit
        this.divertedCount++;
        this.metrics.recordDiverted();
        continue;
      }
      const { length, speedFactor } = pending;
      // Most drivers pick a lane that suits their turn; some just take whichever regular lane has
      // room and sort it out later. Either way, the lane with the most room at its start.
      const regular = this.regularIn.get(leg) ?? [];
      const anyLane = pending.laneDraw < WRONG_LANE_SHARE && regular.length > 1 && lanes.every((l) => regular.includes(l));
      const candidates = anyLane ? regular : lanes;
      let best = -1;
      let bestRoom = -Infinity;
      let bestLast: Vehicle | undefined;
      for (const l of candidates) {
        const list = this.laneVehicles[l]!;
        const last = list[list.length - 1];
        const room = last ? last.s - last.length : Infinity;
        if (room > bestRoom) {
          bestRoom = room;
          best = l;
          bestLast = last;
        }
      }
      if (bestRoom < length + this.idm.s0 + 1) continue; // approach is full: spillback

      queue.shift();
      const lane = net.lanes[best]!;
      const connector = this.connectorFor(best, pending.to);
      const v = bestLast && bestRoom < 40 ? bestLast.v : lane.speedLimit * speedFactor;
      const veh: Vehicle = {
        id: this.nextId++,
        from: leg,
        to: pending.to,
        inLane: best,
        connector: connector.idx,
        outLane: connector.outLane,
        seg: 0,
        s: length,
        v,
        acc: 0,
        length,
        speedFactor,
        committed: false,
        arrivalTime: pending.arrivalTime,
        stoppedFor: 0,
        lcFrom: null,
        lcT: 1,
        lastLaneChange: -Infinity,
        holdAt: null,
      };
      this.vehicles.push(veh);
      this.laneVehicles[best]!.push(veh);
    }
  }

  // --- spatial index ------------------------------------------------------

  private index() {
    this.laneVehicles = this.network.lanes.map(() => []);
    this.connVehicles = this.network.connectors.map(() => []);
    this.laneGhosts = this.network.lanes.map(() => []);
    if (this.regularIn.size === 0) {
      for (const l of this.network.lanes) {
        if (l.kind !== 'in' || l.role !== 'regular') continue;
        this.regularIn.set(l.leg, [...(this.regularIn.get(l.leg) ?? []), l.idx]);
      }
      for (const list of this.regularIn.values()) list.sort((a, b) => this.network.lanes[a]!.index - this.network.lanes[b]!.index);
    }
    for (const veh of this.vehicles) {
      if (veh.seg === 0) {
        this.laneVehicles[veh.inLane]!.push(veh);
        // Until it is mostly across, a changing car still blocks the lane it is leaving.
        if (veh.lcFrom !== null && veh.lcT < 0.7) this.laneGhosts[veh.lcFrom]!.push(veh);
      } else if (veh.seg === 1) this.connVehicles[veh.connector]!.push(veh);
      else this.laneVehicles[veh.outLane]!.push(veh);
    }
    // Leader first.
    for (const list of this.laneVehicles) list.sort((a, b) => b.s - a.s);
    for (const list of this.connVehicles) list.sort((a, b) => b.s - a.s);
  }

  private pathOf(veh: Vehicle) {
    const net = this.network;
    if (veh.seg === 0) return net.lanes[veh.inLane]!.path;
    if (veh.seg === 1) return net.connectors[veh.connector]!.path;
    return net.lanes[veh.outLane]!.path;
  }

  private prevPath(veh: Vehicle) {
    const net = this.network;
    if (veh.seg === 2) return net.connectors[veh.connector]!.path;
    return net.lanes[veh.inLane]!.path;
  }

  // --- lane changing ------------------------------------------------------

  /** The turn from `lane` to `to`, or any turn from that lane if it doesn't lead there (wrong lane). */
  private connectorFor(lane: number, to: LegId): Connector {
    const net = this.network;
    const conns = (net.connectorsFromLane.get(lane) ?? []).map((c) => net.connectors[c]!);
    return conns.find((c) => c.to === to) ?? conns[0]!;
  }

  /** True if this lane cannot take the vehicle where it is going. */
  private inWrongLane(veh: Vehicle): boolean {
    return this.network.connectors[veh.connector]!.to !== veh.to;
  }

  /**
   * Drivers on an approach consider moving one lane over, every half second.
   * In the wrong lane for their turn they must, and get more insistent near the line.
   * Otherwise they may, if the next lane is faster by enough and it is safe (MOBIL).
   */
  private changeLanes() {
    const net = this.network;
    this.mergeRequests.clear();
    for (const veh of this.vehicles) {
      if (veh.seg !== 0 || veh.committed || veh.lcFrom !== null) continue;
      if ((this.stepCount + veh.id) % 5 !== 0) continue;
      const lane = net.lanes[veh.inLane]!;
      if (lane.role !== 'regular' || veh.s < ENTRY_ZONE) continue;
      const regular = this.regularIn.get(lane.leg) ?? [];
      const pos = regular.indexOf(lane.idx);
      const toLine = lane.path.length - veh.s;
      const allowed = new Set(net.movementLanes.get(movementKey(veh.from, veh.to)) ?? []);
      const wrong = this.inWrongLane(veh);

      if (wrong) {
        // Head one lane at a time towards the nearest lane that serves the turn.
        const goals = regular.map((l, i) => ({ l, i })).filter(({ l }) => allowed.has(l));
        if (goals.length === 0) continue;
        const goal = goals.reduce((a, b) => (Math.abs(a.i - pos) <= Math.abs(b.i - pos) ? a : b));
        const target = regular[pos + Math.sign(goal.i - pos)]!;
        const urgent = toLine < URGENT_ZONE;
        if (this.time - veh.lastLaneChange > LC_COOLDOWN && this.laneChangeIsSafe(veh, target, urgent)) {
          this.doLaneChange(veh, target);
        } else if (urgent) {
          const list = this.mergeRequests.get(target) ?? [];
          list.push(veh);
          this.mergeRequests.set(target, list);
          // Stuck at the line too long: give up and take whatever this lane allows ("missed my turn").
          if (veh.stoppedFor > GIVE_UP_AFTER && toLine < 10) {
            const conn = this.network.connectors[veh.connector]!;
            veh.to = conn.to;
            veh.outLane = conn.outLane;
            this.missedTurnCount++;
          }
        }
        continue;
      }

      if (toLine < NO_CHANGE_ZONE || this.time - veh.lastLaneChange < LC_COOLDOWN) continue;
      let best: { lane: number; gain: number } | null = null;
      for (const target of [regular[pos - 1], regular[pos + 1]]) {
        if (target === undefined || !allowed.has(target)) continue;
        const gain = this.laneChangeGain(veh, target);
        if (gain > LC_THRESHOLD && (!best || gain > best.gain) && this.laneChangeIsSafe(veh, target, false)) best = { lane: target, gain };
      }
      if (best) this.doLaneChange(veh, best.lane);
    }
    if (this.laneChangeThisStep) this.index();
    this.laneChangeThisStep = false;
  }

  private laneChangeThisStep = false;

  private doLaneChange(veh: Vehicle, target: number) {
    const conn = this.connectorFor(target, veh.to);
    // Visible at once to the drivers deciding after us this tick, so two cars can't take the same gap.
    this.laneVehicles[target]!.push(veh);
    this.laneGhosts[veh.inLane]!.push(veh);
    veh.lcFrom = veh.inLane;
    veh.lcT = 0;
    veh.lastLaneChange = this.time;
    veh.inLane = target;
    veh.connector = conn.idx;
    veh.outLane = conn.outLane;
    this.laneChangeCount++;
    this.laneChangeThisStep = true;
  }

  /** The nearest vehicles ahead of and behind position s in a lane, counting cars still leaving it. */
  private neighboursAt(lane: number, s: number, self: Vehicle): { leader?: Vehicle; follower?: Vehicle } {
    let leader: Vehicle | undefined;
    let follower: Vehicle | undefined;
    for (const x of [...this.laneVehicles[lane]!, ...this.laneGhosts[lane]!]) {
      if (x === self) continue;
      if (x.s >= s) {
        if (!leader || x.s < leader.s) leader = x;
      } else if (!follower || x.s > follower.s) follower = x;
    }
    if (!leader) {
      // A car that has just crossed the line from this lane still has its tail back here.
      const laneLen = this.network.lanes[lane]!.path.length;
      for (const c of this.network.connectorsFromLane.get(lane) ?? []) {
        for (const x of this.connVehicles[c]!) {
          if (x.s - x.length > 3) continue;
          const asIfOnLane = { ...x, s: laneLen + x.s };
          if (!leader || asIfOnLane.s < leader.s) leader = asIfOnLane;
        }
      }
    }
    return { leader, follower };
  }

  private freeAccel(veh: Vehicle, leader: Vehicle | undefined, gapTo: (l: Vehicle) => number): number {
    const v0 = this.network.lanes[veh.inLane]!.speedLimit * veh.speedFactor;
    return leader ? idm(this.idm, veh.v, v0, gapTo(leader), veh.v - leader.v) : idm(this.idm, veh.v, v0, Infinity, 0);
  }

  /** MOBIL incentive: my gain from moving, minus a polite share of what my new follower loses. */
  private laneChangeGain(veh: Vehicle, target: number): number {
    const here = this.neighboursAt(veh.inLane, veh.s, veh);
    const there = this.neighboursAt(target, veh.s, veh);
    const gap = (l: Vehicle) => l.s - l.length - veh.s;
    const mine = this.freeAccel(veh, there.leader, gap) - this.freeAccel(veh, here.leader, gap);
    let theirs = 0;
    const f = there.follower;
    if (f) {
      const before = this.freeAccel(f, there.leader, (l) => l.s - l.length - f.s);
      const after = this.freeAccel(f, veh, (l) => l.s - l.length - f.s);
      theirs = Math.max(0, before - after);
    }
    return mine - LC_POLITENESS * theirs;
  }

  /** Room in front and behind, and nobody (changer or new follower) has to brake hard. Urgent mergers accept tighter gaps. */
  private laneChangeIsSafe(veh: Vehicle, target: number, urgent: boolean): boolean {
    const { leader, follower } = this.neighboursAt(target, veh.s, veh);
    const minGap = urgent ? 1 : 2;
    // The car turning out sweeps its tail across the car right behind it; leave room for that.
    const behind = this.neighboursAt(veh.inLane, veh.s, veh).follower;
    if (behind && veh.s - veh.length - behind.s < minGap) return false;
    if (leader) {
      const gap = leader.s - leader.length - veh.s;
      if (gap < minGap) return false;
      // Nor may the changer have to brake hard for its new leader (e.g. a stopped queue).
      const v0 = this.network.lanes[target]!.speedLimit * veh.speedFactor;
      if (idm(this.idm, veh.v, v0, gap, veh.v - leader.v) < -LC_SAFE_DECEL) return false;
    }
    if (follower) {
      const gap = veh.s - veh.length - follower.s;
      if (gap < minGap) return false;
      const v0 = this.network.lanes[target]!.speedLimit * follower.speedFactor;
      if (idm(this.idm, follower.v, v0, gap, follower.v - veh.v) < -LC_SAFE_DECEL) return false;
    }
    return true;
  }

  // --- driving ------------------------------------------------------------

  private acceleration(veh: Vehicle): number {
    const net = this.network;
    const conn = net.connectors[veh.connector]!;
    const inLane = net.lanes[veh.inLane]!;
    const outLane = net.lanes[veh.outLane]!;
    const p = this.idm;

    const segLimit = veh.seg === 0 ? inLane.speedLimit : veh.seg === 1 ? conn.speedLimit : outLane.speedLimit;
    const v0 = segLimit * veh.speedFactor;
    let a = idm(p, veh.v, v0, Infinity, 0);
    const obstacle = (gap: number, leaderV: number) => {
      a = Math.min(a, idm(p, veh.v, v0, gap, veh.v - leaderV));
    };

    // Distance from this vehicle's front to the start of the connector (negative once on it).
    const toConnector = veh.seg === 0 ? inLane.path.length - veh.s : veh.seg === 1 ? -veh.s : -Infinity;

    // 1. Leader on the same segment, or further along the route.
    const leader = this.leaderOf(veh);
    if (leader) obstacle(leader.gap, leader.v);

    if (veh.seg === 0) {
      // A car still sliding out of this lane is in the way until it is across.
      for (const g of this.laneGhosts[veh.inLane]!) {
        if (g !== veh && g.s > veh.s) obstacle(g.s - g.length - veh.s, g.v);
      }
      // Zipper merge: let in an urgent merger just ahead in the next lane.
      for (const m of this.mergeRequests.get(veh.inLane) ?? []) {
        // Hold back behind its rear; a car already alongside can't help and doesn't brake.
        const gap = m.s - m.length - veh.s;
        if (gap > 0 && gap < 20) obstacle(gap, 0);
      }
    }

    if (veh.seg === 0) {
      // 2. Decide whether we may enter the junction.
      const d = toConnector;
      if (d < decisionDistance(veh.v)) {
        const canStop = d > stoppingDistance(veh.v, STOP_DECEL) + 0.5;
        // A driver in the wrong lane for their turn waits at the line for a chance to move over.
        const permitted = !this.inWrongLane(veh) && this.mayEnter(veh, conn, d, canStop);
        veh.committed = permitted || (veh.committed && !canStop);
        if (!veh.committed) obstacle(d - 0.5, 0);
      } else {
        veh.committed = false;
      }
      // 3. Slow down to the connector's curve speed before reaching it, and to a looking speed if
      //    this movement must give way without a signal to rely on.
      const noLightToTrust = this.clock === null || !conn.controlled || connectorSignal(this.clock, conn) !== 'green';
      const mustLook = noLightToTrust && conn.conflicts.some((c) => c.yields);
      const vc = Math.min(conn.speedLimit, mustLook && conn.kind === 'normal' ? CAUTION_SPEED : Infinity) * veh.speedFactor;
      if (veh.v > vc && d > 0) a = Math.min(a, (vc * vc - veh.v * veh.v) / (2 * Math.max(d, 1)));
    }

    // 4. Inside (or about to enter) the junction: never drive into an occupied conflict zone or a pedestrian,
    //    and keep re-checking give-way points while there is still room to stop before them.
    if (veh.seg === 1 || (veh.seg === 0 && veh.committed)) {
      const sOnConn = -toConnector;
      let hold: number | null = null;
      for (const c of conn.conflicts) {
        const ahead = c.s - 1 - sOnConn;
        if (ahead < 0 || ahead > 40) continue;
        let stop = false;
        if (this.zoneOccupied(c)) stop = true;
        else if (c.yields && ahead > stoppingDistance(veh.v, STOP_DECEL)) {
          const [arrive, clear] = this.conflictWindow(veh, conn, c, -sOnConn);
          stop = this.trafficConflicts(veh, c, arrive, clear, true);
        }
        if (stop) {
          obstacle(ahead, 0);
          hold = Math.min(hold ?? Infinity, c.s);
        }
      }
      // Under signals, waiting there must not leave us parked across a stream we give way to (a turner
      // that pulled forward and then found a merge blocked): if we'd stand in it, wait before it instead.
      if (hold !== null && this.clock !== null) {
        for (const c of [...conn.conflicts].sort((p, q) => q.s - p.s)) {
          if (!c.yields || c.s >= hold || c.sEnd <= hold - veh.length || c.s - 1 - sOnConn < stoppingDistance(veh.v, STOP_DECEL)) continue;
          obstacle(c.s - 1 - sOnConn, 0);
          hold = c.s;
        }
      }
      veh.holdAt = hold;
      for (const x of conn.crosswalkCrossings) {
        const ahead = x.s - net.crosswalks[x.crosswalk]!.width / 2 - 1 - sOnConn;
        if (ahead < 0 || ahead > 40) continue;
        if (this.pedestriansNear(x.crosswalk, x.sCrosswalk, PED_CLEARANCE, false)) obstacle(ahead, 0);
      }
    }

    return Math.max(-MAX_DECEL, a);
  }

  /** Nearest vehicle ahead along this vehicle's own route, as bumper gap and speed. */
  private leaderOf(veh: Vehicle): { gap: number; v: number } | null {
    const net = this.network;
    const segments: Array<{ list: Vehicle[]; offset: number }> = [];
    const inLen = net.lanes[veh.inLane]!.path.length;
    const connLen = net.connectors[veh.connector]!.path.length;
    if (veh.seg === 0) {
      segments.push({ list: this.laneVehicles[veh.inLane]!, offset: 0 });
      segments.push({ list: this.connVehicles[veh.connector]!, offset: inLen });
      segments.push({ list: this.laneVehicles[veh.outLane]!, offset: inLen + connLen });
    } else if (veh.seg === 1) {
      segments.push({ list: this.connVehicles[veh.connector]!, offset: 0 });
      segments.push({ list: this.laneVehicles[veh.outLane]!, offset: connLen });
    } else {
      segments.push({ list: this.laneVehicles[veh.outLane]!, offset: 0 });
    }

    let best: { gap: number; v: number } | null = null;
    const consider = (other: Vehicle, frontAlongRoute: number) => {
      const gap = frontAlongRoute - other.length - veh.s;
      if (gap > LOOK_AHEAD) return;
      if (!best || gap < best.gap) best = { gap, v: other.v };
    };

    for (const { list, offset } of segments) {
      // Lists are leader-first; the closest vehicle ahead is the last one with a larger position.
      let found: Vehicle | undefined;
      for (const other of list) {
        if (other === veh) break;
        if (offset > 0 || other.s > veh.s) found = other;
      }
      if (found) {
        consider(found, found.s + offset);
        break;
      }
    }

    // On a roundabout: cars from other entries ahead of us on the same stretch of ring.
    if (veh.seg !== 2) {
      const base = veh.seg === 0 ? inLen : 0;
      for (const share of net.connectors[veh.connector]!.ringShares) {
        for (const x of this.connVehicles[share.other]!) {
          const front = x.s - share.offset; // x's front bumper, measured along our path
          if (front < share.from || front - x.length > share.to) continue; // not on the shared stretch
          if (base + front > veh.s) consider(x, base + front);
        }
      }
    }

    // Vehicles that took a different turn from the same lane share the first stretch of the
    // junction with us until the paths split, so they are leaders until their rear has left it.
    if (veh.seg !== 2) {
      for (const sib of net.connectors[veh.connector]!.siblings) {
        for (const x of this.connVehicles[sib.other]!) {
          if (x.s - x.length >= sib.until) continue;
          const front = veh.seg === 0 ? inLen + x.s : x.s;
          if (front > veh.s) consider(x, front);
        }
      }
    }
    return best;
  }

  /** Whether a vehicle approaching the stop line may enter the junction now. */
  private mayEnter(veh: Vehicle, conn: Connector, d: number, canStop: boolean): boolean {
    const net = this.network;
    const signal = connectorSignal(this.clock, conn);
    veh.holdAt = null;
    if (signal === 'red') return !canStop && veh.committed;
    if (signal === 'amber' && canStop) return false;

    // Don't enter if the exit lane is backed up to the junction.
    const out = this.laneVehicles[conn.outLane]!;
    const tail = out[out.length - 1];
    if (tail && tail.v < QUEUED_SPEED) {
      let room = tail.s - tail.length;
      for (const other of this.connVehicles.flat()) if (other.outLane === conn.outLane) room -= other.length + 2;
      if (room < veh.length + 2) return false;
    }

    const ordered = [...conn.conflicts].sort((a, b) => a.s - b.s);
    for (const c of ordered) {
      const [arrive, clear] = this.conflictWindow(veh, conn, c, d);
      // Never pull into the path of someone in the junction, priority or not, if we'd get there
      // while they are still in it. A car far up the road keeps going if they're moving: they'll be
      // gone by then. But if they're stuck, don't enter the box: we'd only get stuck behind them
      // and help knot the junction (box gridlock).
      if (this.zoneOccupied(c) && (arrive < OCCUPIED_HORIZON || this.zoneOccupied(c, QUEUED_SPEED))) return false;
      if (!c.yields) {
        // Having priority still means respecting a driver who has already committed to the gap.
        if (this.trafficConflicts(veh, c, arrive, clear, false)) return false;
        continue;
      }
      if (!this.trafficConflicts(veh, c, arrive, clear, true)) continue;
      // Under signals, a turner may pull forward and wait inside the junction, short of the first
      // stream it gives way to, so it can clear when the opposing flow stops at amber. That holds
      // whether this conflict is that crossing or a merge beyond it. One waiting vehicle per connector,
      // and only where it fits: its rear clear of the stop line, so the lane behind it can move.
      const waitAt = ordered.find((w) => w.yields && w.kind === 'cross' && w.s >= veh.length && w.s <= c.s);
      veh.holdAt = waitAt?.s ?? c.s;
      const pullForward = this.clock !== null && signal === 'green' && !!waitAt && this.connVehicles[conn.idx]!.length === 0;
      if (!pullForward) return false;
      break;
    }

    for (const x of conn.crosswalkCrossings) {
      const cw = net.crosswalks[x.crosswalk]!;
      // On a zebra, waiting pedestrians have right of way too.
      if (this.pedestriansNear(x.crosswalk, x.sCrosswalk, PED_CLEARANCE + 2, cw.type === 'zebra')) return false;
    }
    return true;
  }

  /** When this vehicle would reach and clear conflict c, given its distance to the start of its connector. */
  private conflictWindow(veh: Vehicle, conn: Connector, c: ConflictRef, toConnector: number): [number, number] {
    const arrive = timeToTravel(Math.max(0, toConnector + c.s), veh.v, GAP_ACCEL, conn.speedLimit);
    const clear = timeToTravel(toConnector + c.sEnd + veh.length, veh.v, GAP_ACCEL, conn.speedLimit);
    return [arrive, clear];
  }

  /**
   * Whether traffic on the other connector of conflict c would meet us there.
   * Yielding: every driver who may arrive counts, except those already told to wait at their own line.
   * Not yielding: only drivers who have committed to crossing count.
   */
  private trafficConflicts(veh: Vehicle, c: ConflictRef, myArrive: number, myClear: number, yielding: boolean): boolean {
    const net = this.network;
    const other = net.connectors[c.other]!;
    const otherIn = net.lanes[other.inLane]!;
    const otherSignal = connectorSignal(this.clock, other);
    // Giving way: assume priority traffic may speed up a little, to be safe. Having priority but
    // respecting someone who committed to a gap: they accelerate briskly through it, as real drivers do.
    const accel = yielding ? PRIORITY_ACCEL : GAP_ACCEL;

    const zoneLength = c.sOtherEnd - c.sOther;
    /**
     * `distance` is from x's front to the start of the shared stretch on its path. `vmax` is the
     * fastest x can go there: the road's limit on the approach, the curve's limit once in the junction.
     */
    const check = (x: Vehicle, distance: number, vmax: number): boolean => {
      if (distance < -(zoneLength + x.length)) return false; // already cleared the conflict
      if (distance < 0.5 && (yielding || myArrive < OCCUPIED_HORIZON)) return true; // inside the zone right now
      const arrive = timeToTravel(Math.max(0, distance), x.v, accel, vmax);
      const clear = timeToTravel(Math.max(0, distance) + zoneLength + x.length, x.v, accel, vmax);
      const margin = !yielding ? COMMITTED_MARGIN : c.kind === 'merge' ? MERGE_HEADWAY : CROSS_MARGIN;
      return arrive < myClear + margin && clear + 0.5 > myArrive;
    };

    // Someone pulled forward to wait for a gap before this conflict is not a threat to us here.
    const holdsBefore = (x: Vehicle) => !yielding && x.holdAt !== null && x.holdAt <= c.sOther + 0.01;
    for (const x of this.connVehicles[c.other]!) {
      // A driver waiting inside the box for a gap is waiting for us, not the other way round.
      if (!yielding && x.v < QUEUED_SPEED) continue;
      // Giving way, a driver stopped in the box short of the shared stretch is no threat either if they
      // are waiting there on purpose, or stuck behind someone stopped ahead of them (perhaps a turner
      // waiting on us). Waiting for them could lock the junction. If they move off, they count again.
      if (yielding && x.v < QUEUED_SPEED && c.sOther - x.s > 2 && ((x.holdAt !== null && x.holdAt <= c.sOther) || this.behindStopped(x))) continue;
      if (holdsBefore(x)) continue;
      if (check(x, c.sOther - x.s, other.speedLimit)) return true;
    }
    for (const x of this.laneVehicles[other.inLane]!) {
      // Queued behind someone stopped in the box (a turner waiting, maybe for us): neither they nor
      // anyone behind them is coming yet.
      if (yielding && x.v < QUEUED_SPEED && this.blockedInBox(x)) break;
      const toLine = otherIn.path.length - x.s;
      const refused = !x.committed && toLine < decisionDistance(x.v);
      if (x.connector === c.other) {
        const distance = toLine + c.sOther;
        if (distance > PRIORITY_LOOKBACK) break;
        const held = otherSignal === 'red' && !x.committed;
        // Entering a roundabout, cars still approaching other entries have to give way themselves.
        const ringMerge = !!other.ring && !!net.connectors[veh.connector]!.ring;
        const relevant = yielding ? !held && !refused && (!ringMerge || x.committed) : x.committed && !holdsBefore(x);
        if (relevant && check(x, distance, yielding ? otherIn.speedLimit : other.speedLimit)) return true;
      }
      // Everyone queued behind a driver who is stopping at the line is stuck behind them too.
      if (refused) break;
    }
    return false;
  }

  /** Whether a vehicle in the box is right behind a stopped vehicle that shares its path there. */
  private behindStopped(x: Vehicle): boolean {
    const conn = this.network.connectors[x.connector]!;
    for (const y of this.connVehicles[conn.idx]!) if (y !== x && y.s > x.s && y.v < QUEUED_SPEED) return true;
    for (const sib of conn.siblings) {
      for (const y of this.connVehicles[sib.other]!) if (y.s > x.s && y.v < QUEUED_SPEED && y.s - y.length < sib.until) return true;
    }
    return false;
  }

  /** Whether a vehicle still on its approach is held up by a stopped vehicle from its lane, inside the junction ahead of it. */
  private blockedInBox(x: Vehicle): boolean {
    const conn = this.network.connectors[x.connector];
    if (!conn) return false;
    for (const y of this.connVehicles[conn.idx]!) if (y.v < QUEUED_SPEED) return true;
    for (const sib of conn.siblings) {
      for (const y of this.connVehicles[sib.other]!) if (y.v < QUEUED_SPEED && y.s - y.length < sib.until) return true;
    }
    return false;
  }

  /** A vehicle on the other connector physically occupies the conflict zone (optionally: one slower than `slowerThan`). */
  private zoneOccupied(c: ConflictRef, slowerThan = Infinity): boolean {
    for (const x of this.connVehicles[c.other]!) {
      if (x.v < slowerThan && x.s > c.sOther - 0.5 && x.s - x.length < c.sOtherEnd + 0.5) return true;
    }
    // A vehicle that has just left a merging connector is still sitting on the shared stretch.
    if (c.kind === 'merge') {
      const other = this.network.connectors[c.other]!;
      for (const x of this.laneVehicles[other.outLane]!) {
        if (x.v < slowerThan && x.connector === c.other && x.s - x.length < 0) return true;
      }
    }
    return false;
  }

  private pedestriansNear(crosswalk: number, sCw: number, clearance: number, includeWaiting: boolean): boolean {
    for (const ped of this.pedestrians) {
      if (ped.crosswalk !== crosswalk) continue;
      if (!ped.crossing && !includeWaiting) continue;
      const toPoint = (sCw - ped.s) * ped.dir; // >0: still heading towards the point
      if (Math.abs(sCw - ped.s) < clearance) return true;
      if (ped.crossing && toPoint > 0 && toPoint < ped.speed * 4) return true;
      if (!ped.crossing && includeWaiting) return true;
    }
    return false;
  }

  private integrate(veh: Vehicle, acc: number, dt: number) {
    veh.acc = acc;
    if (veh.lcFrom !== null) {
      veh.lcT += dt / LC_DURATION;
      if (veh.lcT >= 1 || veh.seg !== 0) {
        veh.lcFrom = null;
        veh.lcT = 1;
      }
    }
    let v = veh.v + acc * dt;
    let ds = veh.v * dt + 0.5 * acc * dt * dt;
    if (v < 0) {
      // Stopped part-way through the step.
      ds = acc < 0 ? (veh.v * veh.v) / (-2 * acc) : 0;
      v = 0;
    }
    veh.v = v;
    veh.s += Math.max(0, ds);
    veh.stoppedFor = v < STOPPED_SPEED ? veh.stoppedFor + dt : 0;

    const net = this.network;
    if (veh.seg === 0) {
      const len = net.lanes[veh.inLane]!.path.length;
      if (veh.s > len) {
        if (veh.committed) {
          veh.s -= len;
          veh.seg = 1;
        } else {
          veh.s = len;
          veh.v = 0;
        }
      }
    }
    if (veh.seg === 1) {
      const len = net.connectors[veh.connector]!.path.length;
      if (veh.s > len) {
        veh.s -= len;
        veh.seg = 2;
      }
    }
  }

  private exited(veh: Vehicle): boolean {
    if (veh.seg !== 2) return false;
    if (veh.s - veh.length < this.network.lanes[veh.outLane]!.path.length) return false;
    const travel = this.time + this.dt - veh.arrivalTime;
    this.metrics.recordTrip(veh.from);
    this.exitedCount++;
    return true;
  }

  // --- pedestrians --------------------------------------------------------

  private updatePedestrians(dt: number) {
    const net = this.network;
    const remaining: Pedestrian[] = [];
    for (const ped of this.pedestrians) {
      const cw = net.crosswalks[ped.crosswalk]!;
      if (!ped.crossing && this.pedestrianMayStart(ped)) {
        ped.crossing = true;
        this.metrics.recordCrossing(this.time - ped.arrivalTime);
      }
      // A crossing pedestrian waits for a car that is still sitting in the band just ahead of them.
      if (ped.crossing && !this.vehicleBlocksPedestrian(ped)) ped.s += ped.dir * ped.speed * dt;
      const done = ped.dir === 1 ? ped.s >= cw.path.length : ped.s <= 0;
      if (!done) remaining.push(ped);
    }
    this.pedestrians = remaining;
  }

  private pedestrianMayStart(ped: Pedestrian): boolean {
    const net = this.network;
    const cw = net.crosswalks[ped.crosswalk]!;
    if (cw.type === 'signal' && stateFor(this.clock, cw.greenPhases) !== 'green') return false;
    // Don't step in front of a vehicle that can no longer stop.
    for (const x of cw.crossings) {
      const conn = net.connectors[x.connector]!;
      const inLen = net.lanes[conn.inLane]!.path.length;
      for (const veh of this.connVehicles[x.connector]!) {
        const dist = x.s - veh.s;
        // Clear only once the rear has left the whole crosswalk band.
        if (dist > -(veh.length + cw.width / 2 + 1) && dist < Math.max(8, veh.v * 3)) return false;
      }
      for (const veh of this.laneVehicles[conn.inLane]!) {
        if (veh.connector !== x.connector || !veh.committed) continue;
        const dist = inLen - veh.s + x.s;
        if (dist < Math.max(8, veh.v * 3)) return false;
      }
    }
    return true;
  }

  private vehicleBlocksPedestrian(ped: Pedestrian): boolean {
    const cw = this.network.crosswalks[ped.crosswalk]!;
    for (const x of cw.crossings) {
      const ahead = (x.sCrosswalk - ped.s) * ped.dir;
      if (ahead < -1.5 || ahead > 2.5) continue;
      for (const veh of this.connVehicles[x.connector]!) {
        // Any part of the body within the band around this crossing point.
        if (veh.s > x.s - cw.width / 2 - 0.5 && veh.s - veh.length < x.s + cw.width / 2 + 0.5) return true;
      }
    }
    return false;
  }

  // --- metrics ------------------------------------------------------------

  private currentQueues(): Map<LegId, { queue: number; backlog: number }> {
    const out = new Map<LegId, { queue: number; backlog: number }>();
    for (const leg of this.scenario.legs) out.set(leg.id, { queue: 0, backlog: this.backlog.get(leg.id)!.length });
    for (const veh of this.vehicles) {
      if (veh.seg === 0 && veh.v < QUEUED_SPEED) out.get(veh.from)!.queue++;
    }
    for (const q of out.values()) q.queue += q.backlog;
    return out;
  }

  /** Time lost this step, relative to driving at free speed, for trips that arrived in the window. */
  private accumulateDelay(dt: number) {
    const since = this.metrics.startTime;
    const net = this.network;
    for (const veh of this.vehicles) {
      if (veh.arrivalTime < since) continue;
      const free =
        veh.seg === 1 ? net.connectors[veh.connector]!.speedLimit : net.lanes[veh.seg === 0 ? veh.inLane : veh.outLane]!.speedLimit;
      const lost = dt * Math.max(0, 1 - veh.v / (free * veh.speedFactor));
      if (lost > 0) this.metrics.addLostTime(veh.from, lost, this.time);
    }
    // Waiting to even enter the map is all lost time.
    for (const [leg, queue] of this.backlog) {
      for (const p of queue) if (p.arrivalTime >= since) this.metrics.addLostTime(leg, dt, this.time);
    }
  }

  private observeQueues() {
    for (const [leg, q] of this.currentQueues()) this.metrics.observeQueue(leg, q.queue);
  }

  private isGridlocked(): boolean {
    for (const q of this.backlog.values()) if (q.length > GRIDLOCK_BACKLOG) return true;
    return this.vehicles.some((v) => v.seg === 1 && v.stoppedFor > GRIDLOCK_STOPPED);
  }
}

/** How far ahead of the stop line a driver at speed v starts deciding whether to enter. */
const decisionDistance = (v: number) => Math.max(DECISION_DISTANCE, stoppingDistance(v, 2) + 10);
