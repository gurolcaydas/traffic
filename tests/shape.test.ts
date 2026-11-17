import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/network/build';
import { overlappingVehicles } from '../src/sim/safety';
import { Simulation } from '../src/sim/simulation';
import { MAX_LEGS, MIN_GAP, addLeg, angleFits, nearestFit, removeLeg, rotateLeg } from '../src/scenarios/shape';
import { crossroad, twoPhaseSignals } from '../src/scenarios/templates';

describe('shape operations', () => {
  it('adds a road with traffic to and from it, at a free angle', () => {
    const s = crossroad({ angles: [0, 90, 180] });
    const id = addLeg(s, 268)!;
    expect(id).toBe('4');
    expect(s.legs.find((l) => l.id === id)!.angle).toBe(270);
    expect(s.demand.vehicles.filter((d) => d.from === id)).toHaveLength(3);
    expect(s.demand.vehicles.filter((d) => d.to === id)).toHaveLength(3);
    expect(() => buildNetwork(s)).not.toThrow();
  });

  it('keeps roads at least MIN_GAP apart, moving the new road to the nearest free angle', () => {
    const s = crossroad();
    const id = addLeg(s, 10)!;
    const a = s.legs.find((l) => l.id === id)!.angle;
    for (const l of s.legs) if (l.id !== id) expect(Math.min(Math.abs(l.angle - a), 360 - Math.abs(l.angle - a))).toBeGreaterThanOrEqual(MIN_GAP);
    expect(angleFits(s, 5)).toBe(false);
  });

  it('stops at the most roads a junction can take', () => {
    const s = crossroad({ angles: [0, 60, 120, 180, 240, 300] });
    expect(s.legs).toHaveLength(MAX_LEGS);
    // 30° would fit between 0° and 60°, but six roads is the limit.
    expect(nearestFit(s, 30)).toBe(30);
    expect(addLeg(s, 30)).toBeNull();
  });

  it('removing a road removes everything that referred to it', () => {
    const s = crossroad({ control: twoPhaseSignals(), crosswalks: 'signal' });
    s.flyovers = [['1', '3']];
    s.legs[1]!.banned = ['3'];
    s.legs[3]!.banned = ['1'];
    removeLeg(s, '1');
    expect(s.legs.map((l) => l.id)).toEqual(['2', '3', '4']);
    expect(s.demand.vehicles.some((d) => d.from === '1' || d.to === '1')).toBe(false);
    expect(s.crosswalks.some((c) => c.leg === '1')).toBe(false);
    expect(s.flyovers).toEqual([]);
    expect(s.legs.find((l) => l.id === '4')!.banned).toEqual([]);
    if (s.control.type !== 'signals') throw new Error('expected signals');
    expect(JSON.stringify(s.control.phases)).not.toMatch(/"1"/);
    expect(() => buildNetwork(s)).not.toThrow();
  });

  it('turns a road, snapped to 5° and clear of its neighbours', () => {
    const s = crossroad();
    expect(rotateLeg(s, '2', 107)).toBe(true);
    expect(s.legs[1]!.angle).toBe(105);
    rotateLeg(s, '2', 175);
    expect(s.legs[1]!.angle).toBe(150);
  });
});

describe('shape edits under running traffic', () => {
  it('adds, turns and removes roads live without losing a vehicle or colliding', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 350 }));
    sim.run(90);
    let collisions = 0;
    const steps: Array<(s: typeof sim.scenario) => void> = [
      (s) => void addLeg(s, 45),
      (s) => void rotateLeg(s, '2', 110),
      (s) => removeLeg(s, '3'),
      (s) => void addLeg(s, 200),
      (s) => {
        s.control = twoPhaseSignals(25);
      },
      (s) => removeLeg(s, '5'),
    ];
    for (const step of steps) {
      const next = structuredClone(sim.scenario);
      step(next);
      sim.applyScenario(next);
      for (let i = 0; i < 900; i++) {
        sim.step();
        if (i >= 30 && i % 5 === 0) collisions += overlappingVehicles(sim).length;
      }
      const c = sim.counts();
      expect(c.arrived).toBe(c.exited + c.onMap + c.backlog + c.diverted + c.removed);
    }
    expect(collisions).toBe(0);
    expect(sim.counts().exited).toBeGreaterThan(150);
  }, 30000);
});

describe('four-lane roads', () => {
  it('build, run without collisions, and save', async () => {
    const { buildScenario, defaultDemand, DEFAULT_SETUP } = await import('../src/scenarios/setup');
    const { parseScenario } = await import('../src/scenarios/storage');
    for (const control of ['signals', 'roundabout'] as const) {
      const setup = { ...DEFAULT_SETUP, lanes: 4 as const, control };
      const s = buildScenario(setup, defaultDemand(setup, 1200));
      expect(() => buildNetwork(s)).not.toThrow();
      const sim = new Simulation(s);
      for (let t = 0; t < 600; t++) {
        sim.run(1);
        expect(overlappingVehicles(sim)).toEqual([]);
      }
      // The ring itself is one lane, so wider roads only add capacity where they meet lights.
      if (control === 'signals') expect(sim.counts().exited).toBeGreaterThan(550);
      expect(parseScenario(JSON.parse(JSON.stringify(s))).error).toBeUndefined();
    }
    const five = crossroad({ angles: [0, 90, 180, 270] });
    five.legs[0]!.lanesIn = 5;
    expect(parseScenario(JSON.parse(JSON.stringify(five))).error).toMatch(/invalid number of lanes/);
  }, 20000);
});
