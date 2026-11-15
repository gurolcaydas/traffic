import { Rng } from '../core/rng';
import type { LegId, Scenario } from '../core/types';
import { buildNetwork } from '../network/build';
import { movementKey, type ConflictRef, type Connector, type Network } from '../network/network';
import { DEFAULT_IDM, MAX_DECEL, idm, stoppingDistance, timeToTravel, type IdmParams } from './kinematics';
import { MetricsCollector, type MetricsSnapshot } from './metrics';
import { signalClock, stateFor, type SignalClock } from './signals';

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
  freeFlowTime: number;
  /** Continuous time spent (nearly) stopped. */
  stoppedFor: number;
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

interface PendingVehicle {
  to: LegId;
  arrivalTime: number;
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
/** Acceleration a driver counts on when pulling out into a gap. */
const GAP_ACCEL = 2.5;
/** Acceleration assumed for approaching priority traffic (they may speed up a little). */
const PRIORITY_ACCEL = 1.0;
/** Deceleration a driver accepts to stop for a signal or a give-way line. */
const STOP_DECEL = 3.5;
/** Pedestrians closer than this (along the crosswalk) to a vehicle path block it. */
const PED_CLEARANCE = 3.0;
const GRIDLOCK_BACKLOG = 25;
const GRIDLOCK_STOPPED = 180;

export class Simulation {
  readonly network: Network;
  scenario: Scenario;
  readonly dt: number;
  time = 0;
  vehicles: Vehicle[] = [];
  pedestrians: Pedestrian[] = [];
  clock: SignalClock | null = null;

  private rng: Rng;
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

  constructor(scenario: Scenario, opts: { dt?: number } = {}) {
    this.scenario = scenario;
    this.network = buildNetwork(scenario);
    this.dt = opts.dt ?? DT_DEFAULT;
    this.rng = new Rng(scenario.seed);
    for (const leg of scenario.legs) this.backlog.set(leg.id, []);
    this.nextVehicleArrival = scenario.demand.vehicles.map((d) => this.rng.exponential(d.vehPerHour / 3600));
    this.nextPedArrival = scenario.demand.pedestrians.map((d) => this.rng.exponential(d.pedPerHour / 3600));
    this.metrics = new MetricsCollector(scenario.legs.map((l) => l.id));
    this.index();
  }

  run(seconds: number) {
    const steps = Math.round(seconds / this.dt);
    for (let i = 0; i < steps; i++) this.step();
  }

  step() {
    const dt = this.dt;
    this.clock = signalClock(this.scenario.control, this.time);
    this.arrive();
    this.spawn();
    this.index();

    const accs = this.vehicles.map((veh) => this.acceleration(veh));
    this.vehicles.forEach((veh, i) => this.integrate(veh, accs[i]!, dt));
    this.vehicles = this.vehicles.filter((veh) => !this.exited(veh));

    this.index();
    this.updatePedestrians(dt);
    this.observeQueues();
    this.time += dt;
  }

  /** Change traffic demand on the fly. Vehicles already on the map or waiting to enter are kept. */
  setDemand(demand: Scenario['demand']) {
    this.scenario = { ...this.scenario, demand };
    this.nextVehicleArrival = demand.vehicles.map((d) => this.time + this.rng.exponential(d.vehPerHour / 3600));
    this.nextPedArrival = demand.pedestrians.map((d) => this.time + this.rng.exponential(d.pedPerHour / 3600));
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
    return { arrived: this.arrivedCount, exited: this.exitedCount, onMap: this.vehicles.length, backlog };
  }

  /** World position and heading of a vehicle's centre, for rendering. */
  pose(veh: Vehicle): { x: number; y: number; heading: number } {
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

  private arrive() {
    const { vehicles, pedestrians } = this.scenario.demand;
    vehicles.forEach((d, i) => {
      while (this.nextVehicleArrival[i]! <= this.time) {
        this.backlog.get(d.from)!.push({ to: d.to, arrivalTime: this.nextVehicleArrival[i]! });
        this.arrivedCount++;
        this.nextVehicleArrival[i]! += this.rng.exponential(d.vehPerHour / 3600);
      }
    });
    pedestrians.forEach((d, i) => {
      while (this.nextPedArrival[i]! <= this.time) {
        const cw = this.network.crosswalks.findIndex((c) => c.leg === d.leg);
        if (cw >= 0) {
          const dir = this.rng.next() < 0.5 ? 1 : -1;
          const path = this.network.crosswalks[cw]!.path;
          this.pedestrians.push({
            id: this.nextId++,
            crosswalk: cw,
            dir,
            s: dir === 1 ? 0 : path.length,
            speed: this.rng.range(1.1, 1.5),
            crossing: false,
            arrivalTime: this.nextPedArrival[i]!,
          });
        }
        this.nextPedArrival[i]! += this.rng.exponential(d.pedPerHour / 3600);
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
        queue.shift(); // movement impossible on this layout; drop it
        continue;
      }
      const length = this.rng.next() < 0.06 ? 9 : 4.5;
      // Choose the allowed lane with the most room at its start.
      let best = -1;
      let bestRoom = -Infinity;
      let bestLast: Vehicle | undefined;
      for (const l of lanes) {
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
      const connector = net.connectorsFromLane.get(best)!.map((c) => net.connectors[c]!).find((c) => c.to === pending.to)!;
      const outLane = net.lanes[connector.outLane]!;
      const speedFactor = this.rng.range(0.9, 1.1);
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
        freeFlowTime: freeFlowTime(lane.path.length, lane.speedLimit, connector.path.length, connector.speedLimit, outLane.path.length),
        stoppedFor: 0,
      };
      this.vehicles.push(veh);
      this.laneVehicles[best]!.push(veh);
    }
  }

  // --- spatial index ------------------------------------------------------

  private index() {
    this.laneVehicles = this.network.lanes.map(() => []);
    this.connVehicles = this.network.connectors.map(() => []);
    for (const veh of this.vehicles) {
      if (veh.seg === 0) this.laneVehicles[veh.inLane]!.push(veh);
      else if (veh.seg === 1) this.connVehicles[veh.connector]!.push(veh);
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
      // 2. Decide whether we may enter the junction.
      const d = toConnector;
      if (d < decisionDistance(veh.v)) {
        const canStop = d > stoppingDistance(veh.v, STOP_DECEL) + 0.5;
        const permitted = this.mayEnter(veh, conn, d, canStop);
        veh.committed = permitted || (veh.committed && !canStop);
        if (!veh.committed) obstacle(d - 0.5, 0);
      } else {
        veh.committed = false;
      }
      // 3. Slow down to the connector's curve speed before reaching it.
      const vc = conn.speedLimit * veh.speedFactor;
      if (veh.v > vc && d > 0) a = Math.min(a, (vc * vc - veh.v * veh.v) / (2 * Math.max(d, 1)));
    }

    // 4. Inside (or about to enter) the junction: never drive into an occupied conflict zone or a pedestrian,
    //    and keep re-checking give-way points while there is still room to stop before them.
    if (veh.seg === 1 || (veh.seg === 0 && veh.committed)) {
      const sOnConn = -toConnector;
      for (const c of conn.conflicts) {
        const ahead = c.s - 1 - sOnConn;
        if (ahead < 0 || ahead > 40) continue;
        if (this.zoneOccupied(c)) {
          obstacle(ahead, 0);
        } else if (c.yields && ahead > stoppingDistance(veh.v, STOP_DECEL)) {
          const [arrive, clear] = this.conflictWindow(veh, conn, c, -sOnConn);
          if (this.trafficConflicts(veh, c, arrive, clear, true)) obstacle(ahead, 0);
        }
      }
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
    const signal = stateFor(this.clock, conn.greenPhases);
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
      // Never pull into the path of someone already in the junction, priority or not.
      if (this.zoneOccupied(c)) return false;
      const [arrive, clear] = this.conflictWindow(veh, conn, c, d);
      if (!c.yields) {
        // Having priority still means respecting a driver who has already committed to the gap.
        if (this.trafficConflicts(veh, c, arrive, clear, false)) return false;
        continue;
      }
      if (!this.trafficConflicts(veh, c, arrive, clear, true)) continue;
      // Under signals, a turner may pull forward and wait inside the junction just before the crossing,
      // so it can clear when the opposing flow stops at amber. One waiting vehicle per connector.
      const pullForward =
        this.clock !== null && signal === 'green' && c.kind === 'cross' && c.s >= 6 && this.connVehicles[conn.idx]!.length === 0;
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
    const otherSignal = stateFor(this.clock, other.greenPhases);
    const accel = PRIORITY_ACCEL;
    const vmax = otherIn.speedLimit;

    const zoneLength = c.sOtherEnd - c.sOther;
    /** `distance` is from x's front to the start of the shared stretch on its path. */
    const check = (x: Vehicle, distance: number): boolean => {
      if (distance < -(zoneLength + x.length)) return false; // already cleared the conflict
      if (distance < 0.5) return true; // inside the zone right now
      // Assume the other driver may speed up: the earliest they could arrive.
      const arrive = timeToTravel(distance, x.v, accel, vmax);
      const clear = timeToTravel(distance + zoneLength + x.length, x.v, accel, vmax);
      const margin = c.kind === 'merge' ? MERGE_HEADWAY : CROSS_MARGIN;
      return arrive < myClear + margin && clear + 0.5 > myArrive;
    };

    for (const x of this.connVehicles[c.other]!) {
      // A driver waiting inside the box for a gap is waiting for us, not the other way round.
      if (!yielding && x.v < QUEUED_SPEED) continue;
      if (check(x, c.sOther - x.s)) return true;
    }
    for (const x of this.laneVehicles[other.inLane]!) {
      const toLine = otherIn.path.length - x.s;
      const refused = !x.committed && toLine < decisionDistance(x.v);
      if (x.connector === c.other) {
        const distance = toLine + c.sOther;
        if (distance > PRIORITY_LOOKBACK) break;
        const held = otherSignal === 'red' && !x.committed;
        const relevant = yielding ? !held && !refused : x.committed;
        if (relevant && check(x, distance)) return true;
      }
      // Everyone queued behind a driver who is stopping at the line is stuck behind them too.
      if (refused) break;
    }
    return false;
  }

  /** A vehicle on the other connector physically occupies the conflict zone. */
  private zoneOccupied(c: ConflictRef): boolean {
    for (const x of this.connVehicles[c.other]!) {
      if (x.s > c.sOther - 0.5 && x.s - x.length < c.sOtherEnd + 0.5) return true;
    }
    // A vehicle that has just left a merging connector is still sitting on the shared stretch.
    if (c.kind === 'merge') {
      const other = this.network.connectors[c.other]!;
      for (const x of this.laneVehicles[other.outLane]!) {
        if (x.connector === c.other && x.s - x.length < 0) return true;
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
    this.metrics.recordTrip(veh.from, Math.max(0, travel - veh.freeFlowTime));
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

/**
 * Travel time with nobody else around: cruise, brake for the curve, take it, accelerate back.
 * Delay is measured against this, so slowing for a corner is not counted as congestion.
 */
function freeFlowTime(inLen: number, v: number, connLen: number, vc: number, outLen: number): number {
  const b = 2;
  const a = 1.0; // IDM's effective acceleration as it nears desired speed
  const dd = Math.min(inLen, (v * v - vc * vc) / (2 * b));
  const da = Math.min(outLen, (v * v - vc * vc) / (2 * a));
  return (inLen - dd) / v + (v - vc) / b + connLen / vc + (v - vc) / a + (outLen - da) / v;
}
