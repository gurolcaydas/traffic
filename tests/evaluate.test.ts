import { describe, expect, it } from 'vitest';
import { compare, runOnce, summarize } from '../src/sim/evaluate';
import { Simulation } from '../src/sim/simulation';
import { crossroad, twoPhaseSignals } from '../src/scenarios/templates';

describe('fair comparison', () => {
  it('gives two different designs exactly the same traffic for the same seed', () => {
    const a = new Simulation({ ...crossroad({ vehPerHourPerLeg: 500, crosswalks: 'zebra' }), seed: 7 });
    const b = new Simulation({ ...crossroad({ vehPerHourPerLeg: 500, lanes: 2, control: twoPhaseSignals() }), seed: 7 });
    a.arrivalLog = [];
    b.arrivalLog = [];
    a.run(900);
    b.run(900);
    expect(a.arrivalLog.length).toBeGreaterThan(400);
    expect(b.arrivalLog).toEqual(a.arrivalLog);
  });

  it('gives different traffic for different seeds', () => {
    const a = new Simulation({ ...crossroad(), seed: 1 });
    const b = new Simulation({ ...crossroad(), seed: 2 });
    a.arrivalLog = [];
    b.arrivalLog = [];
    a.run(300);
    b.run(300);
    expect(b.arrivalLog).not.toEqual(a.arrivalLog);
  });

  it('finds no difference between a design and itself', () => {
    const s = crossroad({ vehPerHourPerLeg: 400 });
    const runs = [101, 102, 103].map((seed) => runOnce(s, seed, 120, 600));
    const again = [101, 102, 103].map((seed) => runOnce(s, seed, 120, 600));
    const d = compare(runs, again, 'avgDelay', true);
    expect(d.mean).toBe(0);
    expect(d.verdict).toBe('unclear');
  });

  it('calls a real improvement better, with an interval that excludes zero', () => {
    const plain = crossroad({ vehPerHourPerLeg: 600, control: twoPhaseSignals(25) });
    const fly = crossroad({ vehPerHourPerLeg: 600, control: twoPhaseSignals(25) });
    fly.flyovers = [['1', '3'], ['2', '4']];
    const seeds = [101, 102, 103, 104];
    const ref = seeds.map((seed) => runOnce(plain, seed, 180, 900));
    const cand = seeds.map((seed) => runOnce(fly, seed, 180, 900));
    const d = compare(ref, cand, 'avgDelay', true);
    expect(d.verdict).toBe('better');
    expect(d.mean + d.ci).toBeLessThan(0);
    expect(summarize(cand, true).avgDelay.mean).toBeLessThan(summarize(ref, true).avgDelay.mean);
  });
});
