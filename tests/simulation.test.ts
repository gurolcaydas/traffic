import { describe, expect, it } from 'vitest';
import type { ControlSpec, Scenario } from '../src/core/types';
import { overlappingVehicles, pedestrianStrikes } from '../src/sim/safety';
import { Simulation } from '../src/sim/simulation';
import { ringStopState, stateFor } from '../src/sim/signals';
import { crossroad, twoPhaseSignals } from '../src/scenarios/templates';
import { DEFAULT_SETUP, buildScenario, defaultDemand } from '../src/scenarios/setup';

/** Run a scenario, checking for collisions every half second. */
function runChecked(scenario: Scenario, seconds: number) {
  const sim = new Simulation(scenario);
  let collisions = 0;
  let strikes = 0;
  const steps = Math.round(seconds / sim.dt);
  for (let i = 0; i < steps; i++) {
    sim.step();
    if (i % 5 === 0) {
      collisions += overlappingVehicles(sim).length;
      strikes += pedestrianStrikes(sim);
    }
  }
  return { sim, collisions, strikes };
}

describe('Simulation', () => {
  it('is deterministic for a given seed', () => {
    const a = new Simulation(crossroad({ vehPerHourPerLeg: 300 }));
    const b = new Simulation(crossroad({ vehPerHourPerLeg: 300 }));
    a.run(300);
    b.run(300);
    expect(a.getMetrics()).toEqual(b.getMetrics());
    expect(a.vehicles.map((v) => [v.id, v.s])).toEqual(b.vehicles.map((v) => [v.id, v.s]));
  });

  it('plays a scenario identically after a JSON round trip', () => {
    const scenario = crossroad({ vehPerHourPerLeg: 250, crosswalks: 'zebra' });
    const a = new Simulation(scenario);
    const b = new Simulation(JSON.parse(JSON.stringify(scenario)) as Scenario);
    a.run(200);
    b.run(200);
    expect(a.getMetrics()).toEqual(b.getMetrics());
  });

  it('never loses a vehicle', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 500 }));
    sim.run(600);
    const c = sim.counts();
    expect(c.arrived).toBeGreaterThan(0);
    expect(c.arrived).toBe(c.exited + c.onMap + c.backlog + c.diverted + c.removed);
  });

  it('delivers light traffic with little delay', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 150 }));
    sim.run(120);
    sim.resetMetrics();
    sim.run(900);
    const m = sim.getMetrics();
    expect(m.throughputPerHour).toBeGreaterThan(450);
    expect(m.avgDelay).toBeLessThan(15);
    expect(['A', 'B']).toContain(m.los);
    expect(m.gridlock).toBe(false);
  });

  it('reports overload and LOS F when demand far exceeds capacity, but not gridlock while traffic still moves', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 900 }));
    sim.run(900);
    const m = sim.getMetrics();
    expect(m.los).toBe('F');
    expect(m.overloaded).toBe(true);
    expect(m.gridlock).toBe(false);
    expect(m.gridlockSeen).toBe(false);
    expect(Math.max(...m.legs.map((l) => l.backlog))).toBeGreaterThan(0);
  });

  it('reports gridlock when nobody can get through the junction', () => {
    // Zebras with a pedestrian about every second: drivers may never go.
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 300, crosswalks: 'zebra', pedPerHourPerCrosswalk: 3000 }));
    sim.run(300);
    expect(sim.getMetrics().gridlock).toBe(true);
    // A new measuring window still knows the junction is knotted right now.
    sim.resetMetrics();
    sim.run(10);
    expect(sim.getMetrics().gridlockSeen).toBe(true);
  });

  it('does not call waiting at a red gridlock', () => {
    // Only leg 2 ever gets a green: the others queue for good, but they are held, not knotted.
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 300, control: { type: 'signals', phases: [{ green: 30, movements: [{ from: '2', to: '*' }] }] } }));
    sim.run(1200);
    const m = sim.getMetrics();
    expect(m.overloaded).toBe(true);
    expect(m.gridlockSeen).toBe(false);
  });

  it('gives more capacity with two lanes and signals than one uncontrolled lane', () => {
    const base = new Simulation(crossroad({ vehPerHourPerLeg: 500 }));
    const better = new Simulation(crossroad({ vehPerHourPerLeg: 500, lanes: 2, control: twoPhaseSignals(25) }));
    for (const s of [base, better]) {
      s.run(120);
      s.resetMetrics();
      s.run(900);
    }
    expect(better.getMetrics().avgDelay).toBeLessThan(base.getMetrics().avgDelay);
  });

  it('works for left-hand traffic too', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 200, driveSide: 'left' }));
    sim.run(600);
    expect(sim.getMetrics().completed).toBeGreaterThan(80);
  });
});

describe('Safety: no vehicle drives through another', () => {
  const cases: Array<[string, Scenario]> = [
    ['priority to the right', crossroad({ vehPerHourPerLeg: 300 })],
    ['major road', crossroad({ vehPerHourPerLeg: 400, control: { type: 'priority', major: ['1', '3'] } })],
    ['signals', crossroad({ vehPerHourPerLeg: 300, control: twoPhaseSignals(25) })],
    ['signals, two lanes', crossroad({ vehPerHourPerLeg: 500, lanes: 2, control: twoPhaseSignals(25) })],
    ['left-hand traffic', crossroad({ vehPerHourPerLeg: 300, driveSide: 'left' })],
    ['T junction', crossroad({ angles: [0, 90, 180], vehPerHourPerLeg: 400 })],
    ['irregular 5-way', crossroad({ angles: [0, 70, 150, 220, 290], vehPerHourPerLeg: 200 })],
    ['3 lanes, zebras', crossroad({ lanes: 3, vehPerHourPerLeg: 600, crosswalks: 'zebra', pedPerHourPerCrosswalk: 150 })],
    [
      '5-way, left-hand, signals, 2 lanes',
      buildScenario({ ...DEFAULT_SETUP, shape: 'five', lanes: 2, control: 'signals', driveSide: 'left', crosswalks: 'signal' }, defaultDemand({ ...DEFAULT_SETUP, shape: 'five' })),
    ],
  ];
  for (const [name, scenario] of cases) {
    it(name, () => {
      const { collisions, sim } = runChecked(scenario, 600);
      expect(collisions).toBe(0);
      expect(sim.getMetrics().completed).toBeGreaterThan(0);
    });
  }
});

describe('Signals', () => {
  it('never lets a vehicle enter the junction during a conflicting green', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 400, control: twoPhaseSignals(20) }));
    const seg = new Map<number, number>();
    let violations = 0;
    let entries = 0;
    for (let i = 0; i < 6000; i++) {
      sim.step();
      for (const v of sim.vehicles) {
        if (seg.get(v.id) === 0 && v.seg === 1) {
          entries++;
          const conn = sim.network.connectors[v.connector]!;
          // Amber runners may still be crossing in all-red, but never once the other phase is green.
          if (sim.clock!.stage === 'green' && stateFor(sim.clock, conn.greenPhases) === 'red') violations++;
        }
        seg.set(v.id, v.seg);
      }
    }
    expect(entries).toBeGreaterThan(100);
    expect(violations).toBe(0);
  });
});

describe('Pedestrians', () => {
  it('cross zebra crossings without being hit, and vehicles still get through', () => {
    const { sim, strikes, collisions } = runChecked(
      crossroad({ vehPerHourPerLeg: 250, crosswalks: 'zebra', pedPerHourPerCrosswalk: 200 }),
      600,
    );
    const m = sim.getMetrics();
    expect(m.pedCrossed).toBeGreaterThan(50);
    expect(m.completed).toBeGreaterThan(50);
    expect(strikes).toBe(0);
    expect(collisions).toBe(0);
  });

  it('only start crossing a signalised crosswalk on their walk signal', () => {
    const sim = new Simulation(
      crossroad({ vehPerHourPerLeg: 250, crosswalks: 'signal', pedPerHourPerCrosswalk: 200, control: twoPhaseSignals(25) }),
    );
    const crossing = new Map<number, boolean>();
    let badStarts = 0;
    for (let i = 0; i < 6000; i++) {
      sim.step();
      for (const p of sim.pedestrians) {
        if (p.crossing && crossing.get(p.id) === false) {
          const cw = sim.network.crosswalks[p.crosswalk]!;
          if (stateFor(sim.clock, cw.greenPhases) !== 'green') badStarts++;
        }
        crossing.set(p.id, p.crossing);
      }
    }
    expect(sim.getMetrics().pedCrossed).toBeGreaterThan(50);
    expect(badStarts).toBe(0);
  });

  it('cost a roundabout little at a modest 100 pedestrians an hour per zebra', () => {
    // Drivers wait for pedestrians near their own lane, and give way at the exit crossing when they get
    // there rather than before entering; so a few pedestrians don't halve a junction's flow.
    const served = (ped: number) => {
      const { sim, strikes } = runChecked(
        crossroad({ vehPerHourPerLeg: 450, control: { type: 'roundabout' }, crosswalks: ped ? 'zebra' : 'none', pedPerHourPerCrosswalk: ped }),
        1800,
      );
      expect(strikes).toBe(0);
      return sim.counts().exited;
    };
    expect(served(100)).toBeGreaterThan(served(0) * 0.88);
  }, 60000);
});

describe('Editing features in motion', () => {
  it('slip lanes and a flyover run collision-free and carry traffic', () => {
    const s = crossroad({ vehPerHourPerLeg: 500, control: twoPhaseSignals(25), crosswalks: 'zebra', pedPerHourPerCrosswalk: 100 });
    s.legs.forEach((l) => (l.slipLane = true));
    s.flyovers = [['1', '3']];
    const { sim, collisions, strikes } = runChecked(s, 600);
    expect(collisions).toBe(0);
    expect(strikes).toBe(0);
    expect(sim.getMetrics().completed).toBeGreaterThan(200);
  });

  it('a flyover beats a plain signalised junction for heavy through traffic', () => {
    const plain = crossroad({ vehPerHourPerLeg: 600, control: twoPhaseSignals(25) });
    const fly = crossroad({ vehPerHourPerLeg: 600, control: twoPhaseSignals(25) });
    fly.flyovers = [['1', '3'], ['2', '4']];
    const delay = (s: Scenario) => {
      const sim = new Simulation(s);
      sim.run(120);
      sim.resetMetrics();
      sim.run(900);
      return sim.getMetrics().avgDelay;
    };
    expect(delay(fly)).toBeLessThan(delay(plain));
  });
});

describe('Live editing (applyScenario)', () => {
  /** A sequence of edits a player might make, applied one per minute while traffic runs. */
  const edits: Array<(s: Scenario) => void> = [
    (s) => s.legs.forEach((l) => ((l.lanesIn = 2), (l.lanesOut = 2))),
    (s) => (s.control = twoPhaseSignals(25)),
    (s) => (s.legs[0]!.slipLane = true),
    (s) => (s.crosswalks = s.legs.map((l) => ({ leg: l.id, type: 'signal' as const }))),
    (s) => (s.flyovers = [['1', '3']]),
    (s) => (s.legs[1]!.banned = ['3']),
    (s) => (s.legs[2]!.lanesIn = 1),
    (s) => (s.flyovers = []),
    (s) => (s.control = { type: 'priority', major: ['1', '3'] }),
    (s) => s.legs.forEach((l) => ((l.lanesIn = 1), (l.lanesOut = 1), (l.slipLane = false))),
  ];

  it('keeps every vehicle accounted for and keeps driving collision-free between edits', () => {
    const scenario = crossroad({ vehPerHourPerLeg: 400, pedPerHourPerCrosswalk: 100 });
    const sim = new Simulation(scenario);
    sim.run(60);
    let collisions = 0;
    for (const edit of edits) {
      const next = structuredClone(sim.scenario);
      edit(next);
      sim.applyScenario(next);
      // Geometry changes under cars mid-junction can overlap for a moment; judge from 3 s after the edit.
      for (let i = 0; i < 600; i++) {
        sim.step();
        if (i >= 30 && i % 5 === 0) collisions += overlappingVehicles(sim).length;
      }
      const c = sim.counts();
      expect(c.arrived).toBe(c.exited + c.onMap + c.backlog + c.diverted + c.removed);
    }
    expect(collisions).toBe(0);
    expect(sim.counts().exited).toBeGreaterThan(200);
  });

  it('keeps vehicles in place across an edit', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 300 }));
    sim.run(90);
    const before = new Map(sim.vehicles.filter((v) => v.seg === 0).map((v) => [v.id, sim.pose(v)]));
    expect(before.size).toBeGreaterThan(3);
    const next = structuredClone(sim.scenario);
    next.control = twoPhaseSignals(25);
    sim.applyScenario(next);
    for (const v of sim.vehicles) {
      const p = before.get(v.id);
      if (!p) continue;
      const q = sim.pose(v);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1);
    }
  });

  it('diverts demand for a banned turn instead of queueing it', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 300 }));
    sim.run(60);
    const next = structuredClone(sim.scenario);
    next.legs.forEach((l) => (l.banned = next.legs.filter((o) => o.id !== l.id).slice(-1).map((o) => o.id)));
    sim.applyScenario(next);
    sim.resetMetrics();
    sim.run(600);
    expect(sim.getMetrics().diverted).toBeGreaterThan(50);
    expect(sim.getMetrics().gridlock).toBe(false);
  });
});

describe('Lane changing', () => {
  it('drivers change lanes, and every car enters the junction from a lane that serves its turn', () => {
    // Three traffic seeds: how many drivers miss their turn varies a lot from run to run.
    let entries = 0;
    let wrongEntries = 0;
    let collisions = 0;
    let laneChanges = 0;
    let missed = 0;
    let arrived = 0;
    for (const seed of [1, 2, 3]) {
      const sim = new Simulation(crossroad({ vehPerHourPerLeg: 600, lanes: 3, control: twoPhaseSignals(25), seed }));
      const prevSeg = new Map<number, number>();
      for (let i = 0; i < 9000; i++) {
        sim.step();
        for (const v of sim.vehicles) {
          if (prevSeg.get(v.id) === 0 && v.seg === 1) {
            entries++;
            const conn = sim.network.connectors[v.connector]!;
            if (conn.to !== v.to || !sim.network.movementLanes.get(`${v.from}>${v.to}`)!.includes(conn.inLane)) wrongEntries++;
          }
          prevSeg.set(v.id, v.seg);
        }
        if (i % 5 === 0) collisions += overlappingVehicles(sim).length;
      }
      const c = sim.counts();
      laneChanges += c.laneChanges;
      missed += c.missedTurns;
      arrived += c.arrived;
      expect(sim.getMetrics().gridlock).toBe(false);
    }
    expect(entries).toBeGreaterThan(1500);
    expect(wrongEntries).toBe(0);
    expect(collisions).toBe(0);
    expect(laneChanges).toBeGreaterThan(300);
    // Drivers who start in the wrong lane nearly always get across in time.
    expect(missed).toBeLessThan(0.03 * arrived);
  }, 30000);

  it('keeps single-lane roads free of lane changes', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 400 }));
    sim.run(600);
    expect(sim.counts().laneChanges).toBe(0);
  });

  it('lets cars leave a lane blocked by waiting turners', () => {
    // Two lanes; left turners wait in the inner lane under permissive signals. Through drivers who
    // entered behind them should move to the curb lane rather than wait.
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 500, lanes: 2, control: twoPhaseSignals(25) }));
    sim.run(900);
    expect(sim.counts().laneChanges).toBeGreaterThan(30);
  });
});

describe('Live trend', () => {
  it('samples queues and lost time every 5 s, across metric resets, and marks edits', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 400 }));
    sim.run(60);
    sim.resetMetrics();
    sim.run(60);
    const before = sim.trend.length;
    expect(before).toBeGreaterThanOrEqual(23);
    const times = sim.trend.map((s) => s.time);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeCloseTo(5, 0);
    // Lost time and arrivals only ever grow; the reset in the middle doesn't touch them.
    for (let i = 1; i < sim.trend.length; i++) {
      expect(sim.trend[i]!.lost).toBeGreaterThanOrEqual(sim.trend[i - 1]!.lost);
      expect(sim.trend[i]!.arrived).toBeGreaterThanOrEqual(sim.trend[i - 1]!.arrived);
    }
    expect(sim.trend.some((s) => s.edit)).toBe(false);
    const next = structuredClone(sim.scenario);
    next.control = twoPhaseSignals(25);
    sim.applyScenario(next);
    sim.run(10);
    expect(sim.trend.filter((s) => s.edit)).toHaveLength(1);
  });

  it('shows queues growing when demand outstrips the junction', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 900 }));
    sim.run(600);
    const q = (from: number, to: number) => {
      const xs = sim.trend.filter((s) => s.time > from && s.time <= to).map((s) => s.queued);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(q(480, 600)).toBeGreaterThan(q(120, 240) + 10);
  });
});

describe('Roundabouts', () => {
  const ring = (opts: Parameters<typeof crossroad>[0] = {}) => crossroad({ ...opts, control: { type: 'roundabout' } });

  for (const [name, scenario] of [
    ['light', ring({ vehPerHourPerLeg: 250 })],
    ['heavy', ring({ vehPerHourPerLeg: 550 })],
    ['left-hand', ring({ vehPerHourPerLeg: 400, driveSide: 'left' })],
    ['two lanes in, zebras', ring({ vehPerHourPerLeg: 450, lanes: 2, crosswalks: 'zebra', pedPerHourPerCrosswalk: 100 })],
    ['5-way', ring({ vehPerHourPerLeg: 300, angles: [0, 70, 145, 215, 290] })],
  ] as const) {
    it(`runs collision-free: ${name}`, () => {
      const { sim, collisions, strikes } = runChecked(scenario, 900);
      expect(collisions).toBe(0);
      expect(strikes).toBe(0);
      expect(sim.getMetrics().completed).toBeGreaterThan(100);
    }, 20000);
  }

  /** A roundabout where every leg also sends `uTurns` vehicles/hour back the way they came. */
  const withUTurns = (uTurns: number, opts: Parameters<typeof crossroad>[0] = {}) => {
    const s = ring(opts);
    for (const leg of s.legs) s.demand.vehicles.push({ from: leg.id, to: leg.id, vehPerHour: uTurns });
    return s;
  };

  for (const [name, scenario] of [
    ['U-turns', withUTurns(80, { vehPerHourPerLeg: 400 })],
    ['U-turns, left-hand, two lanes', withUTurns(80, { vehPerHourPerLeg: 400, driveSide: 'left', lanes: 2 })],
  ] as const) {
    it(`runs collision-free with ${name}`, () => {
      const { sim, collisions, strikes } = runChecked(scenario, 900);
      expect(collisions).toBe(0);
      expect(strikes).toBe(0);
      const m = sim.getMetrics();
      expect(m.completed).toBeGreaterThan(100);
      expect(m.diverted).toBe(0);
      expect(m.gridlockSeen).toBe(false);
    }, 20000);
  }

  it('sends U-turns round the ring, and diverts them where there is no roundabout', () => {
    const s = withUTurns(200, { vehPerHourPerLeg: 200 });
    const sim = new Simulation(s);
    let leaving = 0;
    for (let i = 0; i < 120; i++) {
      sim.run(5);
      // Back out on the leg they came in on.
      leaving += sim.vehicles.filter((v) => v.from === v.to && v.seg === 2 && sim.network.lanes[v.outLane]!.leg === v.from).length;
    }
    expect(leaving).toBeGreaterThan(0);
    expect(sim.counts().diverted).toBe(0);
    const next = structuredClone(sim.scenario);
    next.control = twoPhaseSignals(25);
    sim.applyScenario(next);
    sim.run(600);
    const c = sim.counts();
    expect(c.diverted).toBeGreaterThan(0);
    expect(c.arrived).toBe(c.exited + c.onMap + c.backlog + c.diverted + c.removed);
  }, 20000);

  it('circulates counter-clockwise in right-hand traffic and clockwise in left-hand', () => {
    for (const [driveSide, sign] of [['right', 1], ['left', -1]] as const) {
      const sim = new Simulation(ring({ vehPerHourPerLeg: 300, driveSide }));
      sim.run(120);
      const onRing = sim.vehicles.filter((v) => v.seg === 1 && v.s > sim.network.connectors[v.connector]!.ring!.start + 2 && v.v > 1);
      expect(onRing.length).toBeGreaterThan(0);
      for (const v of onRing) {
        const p = sim.pose(v);
        // Angular direction round the centre: sign of position × heading.
        expect(Math.sign(p.x * Math.sin(p.heading) - p.y * Math.cos(p.heading))).toBe(sign);
      }
    }
  });

  it('beats two-phase signals at moderate traffic', () => {
    const delay = (s: Scenario) => {
      const sim = new Simulation(s);
      sim.run(300);
      sim.resetMetrics();
      sim.run(1800);
      return sim.getMetrics().avgDelay;
    };
    expect(delay(ring({ vehPerHourPerLeg: 350 }))).toBeLessThan(delay(crossroad({ vehPerHourPerLeg: 350, control: twoPhaseSignals(25) })));
  }, 20000);

  it('can be built live under running traffic, and taken away again', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 400 }));
    sim.run(120);
    for (const control of [{ type: 'roundabout' as const }, twoPhaseSignals(25), { type: 'roundabout' as const }]) {
      const next = structuredClone(sim.scenario);
      next.control = control;
      sim.applyScenario(next);
      sim.run(300);
      const c = sim.counts();
      expect(c.arrived).toBe(c.exited + c.onMap + c.backlog + c.diverted + c.removed);
    }
    expect(sim.getMetrics().gridlock).toBe(false);
  }, 20000);
});

describe('Signalised roundabouts', () => {
  const lit = (): ControlSpec => {
    const c = twoPhaseSignals(25);
    return c.type === 'signals' ? { ...c, ring: true } : c;
  };
  const litRing = (opts: Parameters<typeof crossroad>[0] = {}): Scenario => crossroad({ ...opts, control: lit() });

  for (const [name, scenario] of [
    ['one lane in', litRing({ vehPerHourPerLeg: 350 })],
    ['two lanes in, signalised crossings', litRing({ vehPerHourPerLeg: 400, lanes: 2, crosswalks: 'signal', pedPerHourPerCrosswalk: 100 })],
    ['left-hand', litRing({ vehPerHourPerLeg: 350, driveSide: 'left' })],
    ['T-junction', litRing({ vehPerHourPerLeg: 300, angles: [0, 180, 270] })],
  ] as const) {
    it(`runs collision-free without locking up: ${name}`, () => {
      const { sim, collisions, strikes } = runChecked(scenario, 900);
      expect(collisions).toBe(0);
      expect(strikes).toBe(0);
      const m = sim.getMetrics();
      expect(m.completed).toBeGreaterThan(100);
      expect(m.gridlockSeen).toBe(false);
    }, 30000);
  }

  it('sends far-side turners round the island in the inner lane, and holds them at red ring lights', () => {
    const sim = new Simulation(litRing({ vehPerHourPerLeg: 350 }));
    const net = sim.network;
    for (const c of net.connectors) expect(c.ring!.lane).toBe(c.turn === 'far' ? 1 : 0);
    expect(net.ringStops.length).toBe(4);
    let heldAtRed = 0;
    for (let i = 0; i < 120; i++) {
      sim.run(5);
      for (const v of sim.vehicles) {
        const conn = net.connectors[v.connector]!;
        if (v.seg !== 1 || v.v > 0.1) continue;
        const next = conn.ringStops.find((r) => r.s > v.s);
        if (next && next.s - v.s < 4 && ringStopState(sim.clock, net.ringStops[next.stop]!.entryPhases) === 'red') heldAtRed++;
      }
    }
    expect(heldAtRed).toBeGreaterThan(0);
  }, 20000);

  it('can be switched to and from live', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 350, control: { type: 'roundabout' } }));
    sim.run(120);
    for (const control of [lit(), { type: 'roundabout' as const }, lit()]) {
      const next = structuredClone(sim.scenario);
      next.control = control;
      sim.applyScenario(next);
      sim.run(300);
      const c = sim.counts();
      expect(c.arrived).toBe(c.exited + c.onMap + c.backlog + c.diverted + c.removed);
    }
  }, 20000);
});

describe('Drivers and vehicles', () => {
  it('mixes in trucks and buses at the scenario’s share, drawn on arrival', () => {
    const scenario = crossroad({ vehPerHourPerLeg: 400, control: twoPhaseSignals(25) });
    scenario.demand.heavyShare = 0.3;
    const sim = new Simulation(scenario);
    const kinds = new Map<number, string>();
    for (let i = 0; i < 6000; i++) {
      sim.step();
      if (i % 50 === 0) for (const v of sim.vehicles) kinds.set(v.id, v.kind);
    }
    const all = [...kinds.values()];
    const heavy = all.filter((k) => k !== 'car').length / all.length;
    expect(heavy).toBeGreaterThan(0.2);
    expect(heavy).toBeLessThan(0.4);
    expect(all.filter((k) => k === 'bus').length).toBeGreaterThan(0);
  });

  it('serves fewer vehicles per hour of green with more heavy vehicles', () => {
    const served = (heavyShare: number) => {
      const s = crossroad({ vehPerHourPerLeg: 1200, control: twoPhaseSignals(30) });
      s.demand.heavyShare = heavyShare;
      const sim = new Simulation(s);
      sim.run(300);
      sim.resetMetrics();
      sim.run(1800);
      return sim.getMetrics().throughputPerHour;
    };
    expect(served(0.3)).toBeLessThan(served(0) * 0.92);
  }, 30000);

  it('runs collision-free with many trucks and buses', () => {
    for (const control of [twoPhaseSignals(25), { type: 'roundabout' as const }, { type: 'priority' as const, major: ['1', '3'] }]) {
      const scenario = crossroad({ vehPerHourPerLeg: 350, lanes: 2, control });
      scenario.demand.heavyShare = 0.3;
      const { collisions, sim } = runChecked(scenario, 600);
      expect(collisions).toBe(0);
      expect(sim.getMetrics().gridlockSeen).toBe(false);
    }
  }, 60000);

  it('still serves a side road facing a busy main road', () => {
    // Drivers who have waited long accept smaller gaps, so nobody waits for ever. Gap-acceptance theory
    // gives this side road about 230 veh/h across 1400 veh/h of main-road traffic.
    const scenario = crossroad({ vehPerHourPerLeg: 0, control: { type: 'priority', major: ['1', '3'] } });
    scenario.demand.vehicles = [
      { from: '1', to: '3', vehPerHour: 700 },
      { from: '3', to: '1', vehPerHour: 700 },
      { from: '2', to: '4', vehPerHour: 600 },
    ];
    const sim = new Simulation(scenario);
    sim.run(300);
    sim.resetMetrics();
    sim.run(1800);
    const served = sim.getMetrics().legs.find((l) => l.leg === '2')!.completed * 2;
    expect(served).toBeGreaterThan(160);
    expect(served).toBeLessThan(320);
  }, 30000);
});

describe('Engineering metrics', () => {
  const measure = (control: ControlSpec, vehPerHourPerLeg: number) => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg, control }));
    sim.run(300);
    sim.resetMetrics();
    sim.run(1800);
    return sim.getMetrics();
  };

  it('counts stops: lights halt drivers that a roundabout lets roll through', () => {
    const lights = measure(twoPhaseSignals(25), 150);
    const ring = measure({ type: 'roundabout' }, 150);
    // At a fixed-time signal about the red share of drivers stop; at a quiet roundabout few do.
    expect(lights.stopsPerVehicle).toBeGreaterThan(0.4);
    expect(lights.stopsPerVehicle).toBeLessThan(1.2);
    expect(ring.stopsPerVehicle).toBeLessThan(0.2);
  }, 30000);

  it('estimates more CO₂ per vehicle in stop-start traffic', () => {
    const light = measure(twoPhaseSignals(25), 100);
    const busy = measure(twoPhaseSignals(25), 400);
    expect(light.co2PerVehicle).toBeGreaterThan(30);
    expect(busy.co2PerVehicle).toBeGreaterThan(light.co2PerVehicle * 1.1);
  }, 30000);

  it('reports a 95th-percentile queue no longer than the longest, with a grade per leg', () => {
    const m = measure({ type: 'priority', major: ['1', '3'] }, 300);
    for (const l of m.legs) {
      expect(l.queue95).toBeLessThanOrEqual(l.maxQueue);
      expect(['A', 'B', 'C', 'D', 'E', 'F']).toContain(l.los);
    }
    // The side roads wait for the major road, so they grade worse.
    const grade = (leg: string) => 'ABCDEF'.indexOf(m.legs.find((l) => l.leg === leg)!.los);
    expect(grade('2')).toBeGreaterThan(grade('1'));
    expect(m.queue95).toBe(Math.max(...m.legs.map((l) => l.queue95)));
  }, 30000);
});
