/// <reference lib="webworker" />
// Runs the simulation off the main thread and streams compact frames back.
import { Simulation } from '../sim/simulation';
import { PED_STRIDE, VEH_STRIDE, type Frame, type FromWorker, type ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const TICK_MS = 16;
const METRICS_MS = 400;
/** Never simulate more than this many steps per tick, so a slow machine degrades instead of freezing. */
const MAX_STEPS_PER_TICK = 40;

let sim: Simulation | null = null;
let legIndex = new Map<string, number>();
let playing = true;
let speed = 1;
let carry = 0;
let last = performance.now();
let lastMetrics = 0;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'load':
      sim = new Simulation(msg.scenario);
      legIndex = new Map(msg.scenario.legs.map((l, i) => [l.id, i]));
      carry = 0;
      sendFrame();
      sendMetrics();
      break;
    case 'apply':
      if (!sim) break;
      sim.applyScenario(msg.scenario);
      legIndex = new Map(msg.scenario.legs.map((l, i) => [l.id, i]));
      sim.resetMetrics();
      sendFrame();
      sendMetrics();
      break;
    case 'setDemand':
      sim?.setDemand(msg.demand);
      break;
    case 'play':
      playing = true;
      break;
    case 'pause':
      playing = false;
      break;
    case 'speed':
      speed = msg.speed;
      break;
    case 'resetMetrics':
      sim?.resetMetrics();
      sendMetrics();
      break;
  }
};

setInterval(() => {
  const now = performance.now();
  const wall = (now - last) / 1000;
  last = now;
  if (!sim || !playing) return;
  carry += wall * speed;
  let steps = Math.floor(carry / sim.dt);
  carry -= steps * sim.dt;
  if (steps > MAX_STEPS_PER_TICK) {
    steps = MAX_STEPS_PER_TICK;
    carry = 0;
  }
  if (steps === 0) return;
  for (let i = 0; i < steps; i++) sim.step();
  sendFrame();
  if (now - lastMetrics > METRICS_MS) {
    lastMetrics = now;
    sendMetrics();
  }
}, TICK_MS);

function sendFrame() {
  if (!sim) return;
  const vs = sim.vehicles;
  const vehIds = new Int32Array(vs.length);
  const veh = new Float32Array(vs.length * VEH_STRIDE);
  vs.forEach((v, i) => {
    const p = sim!.pose(v);
    vehIds[i] = v.id;
    const o = i * VEH_STRIDE;
    veh[o] = p.x;
    veh[o + 1] = p.y;
    veh[o + 2] = p.heading;
    veh[o + 3] = v.length;
    veh[o + 4] = legIndex.get(v.to) ?? 0;
    veh[o + 5] = v.acc;
    veh[o + 6] = sim!.network.connectors[v.connector]!.level;
  });
  const ps = sim.pedestrians;
  const pedIds = new Int32Array(ps.length);
  const peds = new Float32Array(ps.length * PED_STRIDE);
  ps.forEach((p, i) => {
    const pos = sim!.pedestrianPosition(p);
    pedIds[i] = p.id;
    peds[i * PED_STRIDE] = pos.x;
    peds[i * PED_STRIDE + 1] = pos.y;
    peds[i * PED_STRIDE + 2] = p.crossing ? 1 : 0;
  });
  const frame: Frame = { type: 'frame', time: sim.time, clock: sim.clock, vehIds, veh, pedIds, peds };
  post(frame, [vehIds.buffer, veh.buffer, pedIds.buffer, peds.buffer]);
}

function sendMetrics() {
  if (sim) post({ type: 'metrics', metrics: sim.getMetrics() });
}
