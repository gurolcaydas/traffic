import { describe, expect, it } from 'vitest';
import type { Scenario } from '../src/core/types';
import { buildNetwork } from '../src/network/build';
import { overlappingVehicles } from '../src/sim/safety';
import { Simulation } from '../src/sim/simulation';
import { laneTurnsOf, toggleLaneTurn, toggleTurnPocket } from '../src/scenarios/edit';
import { crossroad, twoPhaseSignals } from '../src/scenarios/templates';

/** Average delay over 20 minutes, after 5 to fill up, and whether any two vehicles ever overlapped. */
function play(scenario: Scenario) {
  const sim = new Simulation(scenario);
  sim.run(300);
  sim.resetMetrics();
  let collisions = 0;
  for (let i = 0; i < 12000; i++) {
    sim.step();
    if (i % 5 === 0) collisions += overlappingVehicles(sim).length;
  }
  return { sim, delay: sim.getMetrics().avgDelay, collisions };
}

describe('Turn pockets', () => {
  it('give far-side turns their own short lane, opening before the stop line', () => {
    for (const driveSide of ['right', 'left'] as const) {
      const s = crossroad({ driveSide, control: twoPhaseSignals(25) });
      toggleTurnPocket(s, '1');
      const net = buildNetwork(s);
      const pocket = net.lanes.find((l) => l.leg === '1' && l.role === 'pocket')!;
      expect(pocket.opensAt).toBeGreaterThan(0);
      const fromPocket = (net.connectorsFromLane.get(pocket.idx) ?? []).map((c) => net.connectors[c]!);
      expect(fromPocket.map((c) => c.turn)).toEqual(['far']);
      // No other lane of the leg turns across traffic any more.
      const others = net.connectors.filter((c) => c.from === '1' && c.inLane !== pocket.idx);
      expect(others.some((c) => c.turn === 'far')).toBe(false);
    }
  });

  it('cut delay where turners waiting to cross traffic block a one-lane road, collision-free', () => {
    for (const driveSide of ['right', 'left'] as const) {
      for (const control of [twoPhaseSignals(30), { type: 'priority' as const, major: ['1', '3'] }]) {
        const plain = crossroad({ vehPerHourPerLeg: 420, control, driveSide });
        const pocketed = structuredClone(plain);
        for (const l of pocketed.legs) toggleTurnPocket(pocketed, l.id);
        const before = play(plain);
        const after = play(pocketed);
        expect(after.collisions).toBe(0);
        expect(after.sim.getMetrics().gridlockSeen).toBe(false);
        expect(after.delay).toBeLessThan(before.delay * 0.6);
      }
    }
  }, 120000);

  it('can be built and taken away under running traffic, losing nobody', () => {
    const sim = new Simulation(crossroad({ vehPerHourPerLeg: 450, lanes: 2, control: twoPhaseSignals(30) }));
    let collisions = 0;
    for (let edit = 0; edit < 2; edit++) {
      const next = structuredClone(sim.scenario);
      for (const l of next.legs) toggleTurnPocket(next, l.id);
      sim.applyScenario(next);
      for (let i = 0; i < 1500; i++) {
        sim.step();
        if (i >= 30 && i % 5 === 0) collisions += overlappingVehicles(sim).length;
      }
      const c = sim.counts();
      expect(c.arrived).toBe(c.exited + c.onMap + c.backlog + c.diverted + c.removed);
    }
    expect(collisions).toBe(0);
  }, 30000);
});

describe('Lane arrows', () => {
  it('send each turn down the lanes painted for it', () => {
    const s = crossroad({ lanes: 2, control: twoPhaseSignals(25) });
    expect(laneTurnsOf(s, '1')).toEqual([['near', 'through'], ['through', 'far']]);
    toggleLaneTurn(s, '1', 1, 'through');
    expect(s.legs[0]!.laneTurns).toEqual([['near', 'through'], ['far']]);
    expect(laneTurnsOf(s, '1')).toEqual([['near', 'through'], ['far']]);
  });

  it('fall back to sharing turns out automatically when a turn is left without a lane', () => {
    const s = crossroad({ lanes: 2, control: twoPhaseSignals(25) });
    s.legs[0]!.laneTurns = [['near'], ['through']];
    expect(laneTurnsOf(s, '1')).toEqual([['near', 'through'], ['through', 'far']]);
  });

  it('run collision-free with a dedicated lane for each turn', () => {
    const s = crossroad({ vehPerHourPerLeg: 500, lanes: 3, control: twoPhaseSignals(30) });
    for (const l of s.legs) l.laneTurns = [['near'], ['through'], ['far']];
    const { collisions, sim } = play(s);
    expect(collisions).toBe(0);
    expect(sim.counts().exited).toBeGreaterThan(700);
  }, 30000);
});
