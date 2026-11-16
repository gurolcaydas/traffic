import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/network/build';
import {
  applyPlanPreset,
  controlChoice,
  flyoverCandidates,
  hasFlyover,
  phaseMovements,
  setAllCrossings,
  setControl,
  sideRoadCandidates,
  toggleBanned,
  toggleFlyover,
  toggleMovementInPhase,
  toggleSideRoad,
} from '../src/scenarios/edit';
import { crossroad } from '../src/scenarios/templates';

describe('edit operations', () => {
  it('switches control and reports it back', () => {
    const s = crossroad();
    setControl(s, 'major');
    expect(controlChoice(s)).toBe('major');
    expect(s.control.type === 'priority' && s.control.major.length).toBe(2);
    setControl(s, 'signals');
    expect(controlChoice(s)).toBe('signals');
  });

  it('protected-turn preset gives far turns their own phases', () => {
    const s = crossroad();
    applyPlanPreset(s, 'protected');
    if (s.control.type !== 'signals') throw new Error('expected signals');
    expect(s.control.phases).toHaveLength(4);
    const net = buildNetwork(s);
    const turn = (from: string, to: string) => net.connectors.find((c) => c.from === from && c.to === to)!.turn;
    const [main, turns] = s.control.phases;
    expect(phaseMovements(s, main!).every((m) => turn(m.from, m.to) !== 'far')).toBe(true);
    expect(phaseMovements(s, turns!).every((m) => turn(m.from, m.to) === 'far')).toBe(true);
  });

  it('every movement still gets green somewhere under each preset', () => {
    for (const preset of ['pairs', 'split', 'protected'] as const) {
      const s = crossroad({ angles: [0, 70, 145, 215, 290] });
      applyPlanPreset(s, preset);
      const net = buildNetwork(s);
      expect(net.connectors.every((c) => c.greenPhases.length > 0)).toBe(true);
    }
  });

  it('gives newly added signalised crossings a walk phase', () => {
    const s = crossroad();
    setControl(s, 'signals');
    setAllCrossings(s, 'signal');
    const net = buildNetwork(s);
    expect(net.crosswalks.every((c) => c.greenPhases.length > 0)).toBe(true);
    expect(s.demand.pedestrians.length).toBe(4);
  });

  it('expands a whole-leg green into single movements when toggling one off', () => {
    const s = crossroad();
    setControl(s, 'signals');
    toggleMovementInPhase(s, 0, { from: '1', to: '4' });
    if (s.control.type !== 'signals') throw new Error('expected signals');
    const moves = phaseMovements(s, s.control.phases[0]!);
    expect(moves.some((m) => m.from === '1' && m.to === '4')).toBe(false);
    expect(moves.some((m) => m.from === '1' && m.to === '3')).toBe(true);
  });

  it('allows one flyover per leg', () => {
    const s = crossroad();
    expect(flyoverCandidates(s)).toEqual([
      ['1', '3'],
      ['2', '4'],
    ]);
    toggleFlyover(s, ['1', '3']);
    toggleFlyover(s, ['2', '4']);
    expect(hasFlyover(s, ['3', '1'])).toBe(true);
    expect(hasFlyover(s, ['2', '4'])).toBe(true);
    toggleFlyover(s, ['1', '3']);
    expect(hasFlyover(s, ['1', '3'])).toBe(false);
  });

  it('toggles a banned turn on and off', () => {
    const s = crossroad();
    toggleBanned(s, '1', '4');
    expect(s.legs[0]!.banned).toEqual(['4']);
    toggleBanned(s, '1', '4');
    expect(s.legs[0]!.banned).toEqual([]);
  });
});

describe('side roads', () => {
  it('offers one side road per corner, towards the near-side neighbour', () => {
    expect(sideRoadCandidates(crossroad())).toEqual([
      { from: '1', to: '2' },
      { from: '2', to: '3' },
      { from: '3', to: '4' },
      { from: '4', to: '1' },
    ]);
    expect(sideRoadCandidates(crossroad({ driveSide: 'left' }))[0]).toEqual({ from: '1', to: '4' });
  });

  it('matches the turn the network routes through the slip lane', () => {
    for (const driveSide of ['right', 'left'] as const) {
      const s = crossroad({ driveSide });
      for (const { from, to } of sideRoadCandidates(s)) {
        toggleSideRoad(s, from);
        const net = buildNetwork(s);
        expect(net.connectors.find((c) => c.kind === 'slip' && c.from === from)?.to).toBe(to);
        toggleSideRoad(s, from);
      }
    }
  });
});

describe('side road choices at a roundabout', () => {
  it('only offers side roads that fit outside the ring', () => {
    const t = crossroad({ angles: [0, 180, 270] });
    expect(sideRoadCandidates(t).map((c) => c.from)).toEqual(['1', '2', '3']);
    t.control = { type: 'roundabout' };
    expect(sideRoadCandidates(t).map((c) => c.from)).toEqual(['2', '3']);
  });
});
