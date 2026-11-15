import { describe, expect, it } from 'vitest';
import type { Scenario } from '../src/core/types';
import { PATTERNS, busiestWindow, demandFactor, interpolate } from '../src/scenarios/patterns';
import { Simulation } from '../src/sim/simulation';
import { crossroad, twoPhaseSignals } from '../src/scenarios/templates';

const withPattern = (s: Scenario, id: string, centreLeg = '1'): Scenario => ({
  ...s,
  demand: { ...s.demand, pattern: PATTERNS[id]!.make(centreLeg) },
});

describe('pattern maths', () => {
  it('interpolates between points and stays flat beyond the ends', () => {
    const pts: Array<[number, number]> = [[6, 0.2], [8, 1], [10, 0.5]];
    expect(interpolate(pts, 5)).toBe(0.2);
    expect(interpolate(pts, 7)).toBeCloseTo(0.6);
    expect(interpolate(pts, 9)).toBeCloseTo(0.75);
    expect(interpolate(pts, 12)).toBe(0.5);
  });

  it('tilts commuter traffic into the centre in the morning and out in the evening', () => {
    const p = PATTERNS.commuter!.make('1');
    expect(demandFactor(p, 8, '3', '1')).toBeGreaterThan(demandFactor(p, 8, '1', '3'));
    expect(demandFactor(p, 17.5, '1', '3')).toBeGreaterThan(demandFactor(p, 17.5, '3', '1'));
    // Trips that neither start nor end at the centre just follow the day's shape.
    expect(demandFactor(p, 8, '2', '4')).toBeCloseTo(1);
  });

  it('finds a rush hour as the busiest window of a commuter day', () => {
    const p = PATTERNS.commuter!.make('1');
    const start = busiestWindow(p, 2);
    // Whichever rush it picks, the middle of the window is at peak traffic.
    expect(interpolate(p.points, start + 1)).toBeGreaterThan(0.95);
  });
});

describe('time-of-day traffic', () => {
  it('follows the pattern: about four times the traffic at 08:00 as at 06:00', () => {
    const sim = new Simulation(withPattern(crossroad({ vehPerHourPerLeg: 600 }), 'commuter'));
    sim.arrivalLog = [];
    sim.run(3 * 3600); // 06:00 to 09:00
    const inHour = (h: number) => sim.arrivalLog!.filter(([t]) => t >= (h - 6) * 3600 && t < (h - 5.5) * 3600).length;
    const early = inHour(6);
    const peak = inHour(8);
    expect(early).toBeGreaterThan(50);
    expect(peak / early).toBeGreaterThan(2.8);
    expect(peak / early).toBeLessThan(5.5);
  });

  it('sends more morning traffic into the centre than out of it', () => {
    const sim = new Simulation(withPattern(crossroad({ vehPerHourPerLeg: 600 }), 'commuter', '1'));
    sim.arrivalLog = [];
    sim.run(3 * 3600);
    const into = sim.arrivalLog.filter(([, , to]) => to === '1').length;
    const out = sim.arrivalLog.filter(([, from]) => from === '1').length;
    expect(into / out).toBeGreaterThan(2);
  });

  it('still gives two designs exactly the same traffic', () => {
    const a = new Simulation({ ...withPattern(crossroad({ vehPerHourPerLeg: 500 }), 'school'), seed: 3 });
    const b = new Simulation({ ...withPattern(crossroad({ vehPerHourPerLeg: 500, control: twoPhaseSignals() }), 'school'), seed: 3 });
    a.arrivalLog = [];
    b.arrivalLog = [];
    a.run(2 * 3600);
    b.run(2 * 3600);
    expect(b.arrivalLog).toEqual(a.arrivalLog);
  });

  it('reports a clock, and can jump it', () => {
    const sim = new Simulation(withPattern(crossroad(), 'event'));
    expect(sim.timeOfDay).toBe(17);
    sim.run(1800);
    expect(sim.timeOfDay).toBeCloseTo(17.5);
    sim.setTimeOfDay(19.5);
    expect(sim.timeOfDay).toBeCloseTo(19.5);
    expect(new Simulation(crossroad()).timeOfDay).toBeNull();
  });

  it('measures the worst 15 minutes, which a rush hour makes much worse than the day average', () => {
    const sim = new Simulation(withPattern(crossroad({ vehPerHourPerLeg: 400 }), 'commuter'));
    sim.run(4 * 3600);
    const m = sim.getMetrics();
    expect(m.gridlock).toBe(false);
    expect(m.worst15Delay).toBeGreaterThan(m.avgDelay * 1.5);
  }, 20000);
});
