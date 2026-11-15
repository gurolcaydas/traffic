import { describe, expect, it } from 'vitest';
import { COSTS, costItems, totalCost } from '../src/game/costs';
import { LEVELS, levelById } from '../src/game/levels';
import { DETOUR_SECONDS, designProblems, levelPlan, scoreRuns } from '../src/game/score';
import type { Level } from '../src/game/types';
import { runOnce, type RunResult } from '../src/sim/evaluate';
import { setAllCrossings, setControl, toggleFlyover } from '../src/scenarios/edit';
import { crossroad, twoPhaseSignals } from '../src/scenarios/templates';

describe('costs', () => {
  const start = crossroad();

  it('charges for what was added, nothing for what stayed', () => {
    expect(costItems(start, structuredClone(start))).toEqual([]);
    const s = structuredClone(start);
    s.legs[0]!.lanesIn = 2;
    s.legs[0]!.lanesOut = 2;
    setControl(s, 'roundabout');
    s.legs[1]!.slipLane = true;
    toggleFlyover(s, ['2', '4']);
    setAllCrossings(s, 'zebra');
    s.legs[2]!.banned = ['1'];
    expect(totalCost(costItems(start, s))).toBe(2 * COSTS.lane + COSTS.roundabout + COSTS.sideRoad + COSTS.flyover + 4 * COSTS.zebra + COSTS.ban);
  });

  it('makes removals and signal retiming free', () => {
    const lights = crossroad({ lanes: 2, control: twoPhaseSignals(25), crosswalks: 'zebra' });
    const s = structuredClone(lights);
    s.legs.forEach((l) => (l.lanesIn = 1));
    s.crosswalks = [];
    if (s.control.type === 'signals') s.control.phases[0]!.green = 50;
    expect(totalCost(costItems(lights, s))).toBe(0);
  });

  it('charges the difference when upgrading a zebra to a signalised crossing', () => {
    const s0 = crossroad({ crosswalks: 'zebra' });
    const s = structuredClone(s0);
    setAllCrossings(s, 'signal');
    expect(totalCost(costItems(s0, s))).toBe(4 * COSTS.signalCrossing);
  });
});

describe('scoring', () => {
  const level: Level = { ...levelById('main-street')!, stars: [60, 30, 15], budget: 100 };
  const run = (over: Partial<RunResult> = {}): RunResult => ({
    seed: 1,
    avgDelay: 20,
    throughput: 1000,
    worstQueue: 5,
    pedWait: 0,
    divertedPerHour: 0,
    worst15Delay: 30,
    gridlock: false,
    ...over,
  });

  it('maps average delay onto stars', () => {
    expect(scoreRuns(level, level.scenario, [run({ avgDelay: 70 })]).stars).toBe(0);
    expect(scoreRuns(level, level.scenario, [run({ avgDelay: 50 })]).stars).toBe(1);
    expect(scoreRuns(level, level.scenario, [run({ avgDelay: 20 })]).stars).toBe(2);
    expect(scoreRuns(level, level.scenario, [run({ avgDelay: 10 })]).stars).toBe(3);
  });

  it('fails any gridlock, however good the rest', () => {
    const r = scoreRuns(level, level.scenario, [run({ avgDelay: 5 }), run({ avgDelay: 5, gridlock: true })]);
    expect(r.passed).toBe(false);
    expect(r.stars).toBe(0);
    expect(r.failures.join(' ')).toMatch(/Gridlock in 1 of 2/);
  });

  it('counts diverted trips as a detour, so banning turns is not free', () => {
    const r = scoreRuns(level, level.scenario, [run({ avgDelay: 10, throughput: 900, divertedPerHour: 100 })]);
    expect(r.avgDelay).toBeCloseTo((10 * 900 + DETOUR_SECONDS * 100) / 1000);
  });

  it('refuses designs over budget or without required crossings', () => {
    const s = structuredClone(level.scenario);
    setControl(s, 'roundabout');
    expect(designProblems(level, s).join(' ')).toMatch(/Over budget/);
    const school = levelById('school-run')!;
    const noCrossings = structuredClone(school.scenario);
    noCrossings.crosswalks = [];
    expect(designProblems(school, noCrossings).join(' ')).toMatch(/must stay/);
  });
});

describe('levels', () => {
  it('start out valid, affordable and failing', () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    for (const level of LEVELS) {
      expect(designProblems(level, level.scenario)).toEqual([]);
      expect(level.stars[0]).toBeGreaterThan(level.stars[1]);
      expect(level.stars[1]).toBeGreaterThan(level.stars[2]);
    }
  });

  const play = (id: string, change: (s: Level['scenario']) => void) => {
    const level = levelById(id)!;
    const s = structuredClone(level.scenario);
    change(s);
    const plan = levelPlan(level);
    return scoreRuns(level, s, plan.seeds.map((seed) => runOnce(s, seed, plan.warmup, plan.duration, plan.startHour)));
  };

  it('Main street: fails as given, priority signs solve it', () => {
    expect(play('main-street', () => {}).passed).toBe(false);
    expect(play('main-street', (s) => setControl(s, 'major')).stars).toBeGreaterThanOrEqual(2);
  }, 30000);

  it('Room to turn: fails as given, widening and retiming earns three stars', () => {
    expect(play('room-to-turn', () => {}).passed).toBe(false);
    const best = play('room-to-turn', (s) => {
      for (const i of [0, 2]) {
        s.legs[i]!.lanesIn = 2;
        s.legs[i]!.lanesOut = 2;
      }
      if (s.control.type === 'signals') {
        s.control.phases[0]!.green = 32;
        s.control.phases[1]!.green = 18;
      }
    });
    expect(best.stars).toBe(3);
  }, 30000);
});
