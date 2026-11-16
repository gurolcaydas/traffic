import { describe, expect, it } from 'vitest';
import type { Scenario } from '../src/core/types';
import { overlappingVehicles, pedestrianStrikes } from '../src/sim/safety';
import { Simulation } from '../src/sim/simulation';
import { stateFor } from '../src/sim/signals';
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
    // Zebras with a pedestrian every couple of seconds: drivers may never go.
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 300, crosswalks: 'zebra', pedPerHourPerCrosswalk: 1500 }));
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
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 600, lanes: 3, control: twoPhaseSignals(25) }));
    const prevSeg = new Map<number, number>();
    let entries = 0;
    let wrongEntries = 0;
    let collisions = 0;
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
    expect(entries).toBeGreaterThan(500);
    expect(wrongEntries).toBe(0);
    expect(collisions).toBe(0);
    expect(c.laneChanges).toBeGreaterThan(100);
    // Drivers who start in the wrong lane nearly always get across in time.
    expect(c.missedTurns).toBeLessThan(0.03 * c.arrived);
    expect(sim.getMetrics().gridlock).toBe(false);
  });

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
