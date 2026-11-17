import { describe, expect, it } from 'vitest';
import { overlappingVehicles } from '../src/sim/safety';
import type { ControlSpec } from '../src/core/types';
import { SignalController, ringStopState } from '../src/sim/signals';
import { Simulation } from '../src/sim/simulation';
import { crossroad, twoPhaseSignals } from '../src/scenarios/templates';

const run = (c: SignalController, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 10); i++) c.step(0.1);
};

describe('SignalController', () => {
  it('runs green, amber, all-red, then the next phase', () => {
    const c = new SignalController(twoPhaseSignals(20));
    expect(c.clock()).toMatchObject({ phase: 0, stage: 'green' });
    run(c, 20.05);
    expect(c.clock()).toMatchObject({ phase: 0, stage: 'amber' });
    run(c, 3);
    expect(c.clock()).toMatchObject({ phase: 0, stage: 'allRed' });
    run(c, 2);
    expect(c.clock()).toMatchObject({ phase: 1, stage: 'green' });
  });

  it('extends the green that is showing when the green time is raised, instead of jumping', () => {
    const c = new SignalController(twoPhaseSignals(20));
    run(c, 15);
    c.setControl(twoPhaseSignals(40));
    expect(c.clock()).toMatchObject({ phase: 0, stage: 'green' });
    expect(c.clock()!.remaining).toBeCloseTo(25, 0);
  });

  it('ends a green at once when it is cut shorter than it has been showing', () => {
    const c = new SignalController(twoPhaseSignals(40));
    run(c, 30);
    c.setControl(twoPhaseSignals(20));
    expect(c.clock()).toMatchObject({ phase: 0, stage: 'amber' });
  });

  it('starts at phase 1 when signals are switched on', () => {
    const priority: ControlSpec = { type: 'priority', major: [] };
    const c = new SignalController(priority);
    expect(c.clock()).toBeNull();
    run(c, 100);
    c.setControl(twoPhaseSignals(20));
    expect(c.clock()).toMatchObject({ phase: 0, stage: 'green', remaining: 20 });
  });
});

describe('green time in traffic', () => {
  const throughOnly = (green: number, perLeg: number) => {
    const s = crossroad({ control: twoPhaseSignals(green) });
    s.demand.vehicles = ['1', '2', '3', '4'].map((f) => ({ from: f, to: String(((+f + 1) % 4) + 1), vehPerHour: perLeg }));
    return s;
  };

  it('a longer green carries more cars when the junction is saturated', () => {
    const served = (green: number) => {
      const sim = new Simulation(throughOnly(green, 900));
      sim.run(300);
      sim.resetMetrics();
      sim.run(1800);
      return sim.getMetrics().throughputPerHour;
    };
    const short = served(15);
    const long = served(60);
    expect(long).toBeGreaterThan(short * 1.2);
  });

  it('on wider roads, longer greens (fewer stops and starts) shorten the queues', () => {
    const queueAt = (green: number) => {
      const sim = new Simulation(crossroad({ control: twoPhaseSignals(green), vehPerHourPerLeg: 800, lanes: 2 }));
      sim.run(300);
      sim.resetMetrics();
      let total = 0;
      for (let t = 0; t < 1200; t += 10) {
        sim.run(10);
        total += sim.getMetrics().legs.reduce((a, l) => a + l.queue, 0);
      }
      return total / 120;
    };
    expect(queueAt(40)).toBeLessThan(queueAt(15) * 0.7);
  }, 30000);

  it('opposite left turners waiting in the box never lock the junction', () => {
    // One shared lane per road: each left turner waits in the box for the other side's right turner,
    // which is queued behind the other left turner. That used to stall the junction until it gridlocked.
    const sim = new Simulation(crossroad({ control: twoPhaseSignals(40), vehPerHourPerLeg: 360 }));
    sim.run(300);
    sim.resetMetrics();
    sim.run(1800);
    const m = sim.getMetrics();
    expect(m.gridlock).toBe(false);
    expect(m.throughputPerHour).toBeGreaterThan(1250);
    expect(overlappingVehicles(sim)).toEqual([]);
  }, 30000);

  it('cars that arrive on green with no queue keep their speed through the junction', () => {
    const sim = new Simulation(throughOnly(60, 200));
    const minV = new Map<number, number>();
    const seg = new Map<number, number>();
    const crossing: number[] = [];
    for (let i = 0; i < 12000; i++) {
      sim.step();
      for (const v of sim.vehicles) {
        if (v.seg === 0) minV.set(v.id, Math.min(minV.get(v.id) ?? Infinity, v.v));
        if (seg.get(v.id) === 0 && v.seg === 1 && (minV.get(v.id) ?? 0) > 8) {
          crossing.push(v.v / (sim.network.lanes[v.inLane]!.speedLimit * v.speedFactor));
        }
        seg.set(v.id, v.seg);
      }
    }
    expect(crossing.length).toBeGreaterThan(50);
    const avg = crossing.reduce((a, b) => a + b, 0) / crossing.length;
    expect(avg).toBeGreaterThan(0.9);
  });

  it('editing the green time live does not flip the lights', () => {
    const sim = new Simulation(throughOnly(30, 300));
    sim.run(10);
    const before = sim.clock!;
    const next = structuredClone(sim.scenario);
    next.control = twoPhaseSignals(45);
    sim.applyScenario(next);
    expect(sim.clock).toMatchObject({ phase: before.phase, stage: before.stage });
  });
});

describe('ring stop lights', () => {
  const clock = (phase: number, stage: 'green' | 'amber' | 'allRed', next = (phase + 1) % 2) => ({ phase, next, stage, remaining: 1 });

  it('are red while their entry has green, and clear before it gets green', () => {
    // The entry is green in phase 0.
    expect(ringStopState(clock(0, 'green'), [0])).toBe('red');
    expect(ringStopState(clock(0, 'amber'), [0])).toBe('red');
    expect(ringStopState(clock(1, 'green'), [0])).toBe('green');
    expect(ringStopState(clock(1, 'amber'), [0])).toBe('amber');
    expect(ringStopState(clock(1, 'allRed'), [0])).toBe('red');
    expect(ringStopState(null, [0])).toBe('green');
  });
});
