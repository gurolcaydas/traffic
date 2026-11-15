import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/network/build';
import { movementKey } from '../src/network/network';
import { crossroad, twoPhaseSignals } from '../src/scenarios/templates';

const find = (net: ReturnType<typeof buildNetwork>, from: string, to: string) =>
  net.connectors.filter((c) => c.from === from && c.to === to);

describe('buildNetwork: single-lane crossroad', () => {
  const net = buildNetwork(crossroad());

  it('creates one in and one out lane per leg and every non-U-turn movement', () => {
    expect(net.lanes).toHaveLength(8);
    expect(net.connectors).toHaveLength(12);
  });

  it('classifies turns for right-hand traffic', () => {
    // Leg 1 points east; arriving from it you drive west. North (leg 2) is a right turn.
    expect(find(net, '1', '2')[0]!.turn).toBe('near');
    expect(find(net, '1', '3')[0]!.turn).toBe('through');
    expect(find(net, '1', '4')[0]!.turn).toBe('far');
  });

  it('records each conflict on both connectors with opposite right of way', () => {
    for (const c of net.connectors) {
      for (const ref of c.conflicts) {
        const back = net.connectors[ref.other]!.conflicts.find((r) => r.other === c.idx)!;
        expect(back).toBeDefined();
        expect(back.yields).toBe(!ref.yields);
        expect(back.s).toBeCloseTo(ref.sOther);
        expect(ref.sEnd).toBeGreaterThanOrEqual(ref.s);
      }
    }
  });

  it('makes left turns give way to opposing through traffic', () => {
    const left = find(net, '1', '4')[0]!;
    const opposingThrough = find(net, '3', '1')[0]!;
    const ref = left.conflicts.find((r) => r.other === opposingThrough.idx);
    expect(ref?.yields).toBe(true);
  });

  it('lets the major road keep priority', () => {
    const major = buildNetwork(crossroad({ control: { type: 'priority', major: ['1', '3'] } }));
    const minorThrough = find(major, '2', '4')[0]!;
    expect(minorThrough.conflicts.every((r) => r.yields || major.connectors[r.other]!.from === '4')).toBe(true);
  });
});

describe('buildNetwork: drive side', () => {
  it('puts inbound lanes on the right for right-hand traffic and mirrors for left-hand', () => {
    const right = buildNetwork(crossroad({ driveSide: 'right' }));
    const left = buildNetwork(crossroad({ driveSide: 'left' }));
    const eastIn = (n: typeof right) => n.lanes.find((l) => l.leg === '1' && l.kind === 'in')!;
    // Westbound traffic on the east leg: right-hand drives on the north side (y > 0).
    expect(eastIn(right).path.pointAt(0).y).toBeGreaterThan(0);
    expect(eastIn(left).path.pointAt(0).y).toBeLessThan(0);
    expect(eastIn(left).path.pointAt(0).y).toBeCloseTo(-eastIn(right).path.pointAt(0).y);
  });

  it('swaps near and far turns', () => {
    const left = buildNetwork(crossroad({ driveSide: 'left' }));
    expect(find(left, '1', '2')[0]!.turn).toBe('far');
    expect(find(left, '1', '4')[0]!.turn).toBe('near');
  });
});

describe('buildNetwork: lanes and control', () => {
  it('assigns turns to lanes from the curb outwards', () => {
    const net = buildNetwork(crossroad({ lanes: 2 }));
    const laneIndex = (from: string, to: string) =>
      net.movementLanes.get(movementKey(from, to))!.map((l) => net.lanes[l]!.index);
    expect(laneIndex('1', '2')).toEqual([0]); // right turn: curb lane
    expect(laneIndex('1', '3')).toEqual([0, 1]); // through: both
    expect(laneIndex('1', '4')).toEqual([1]); // left turn: inner lane
  });

  it('maps signal phases onto connectors and crosswalks', () => {
    const net = buildNetwork(crossroad({ control: twoPhaseSignals(), crosswalks: 'signal' }));
    expect(find(net, '1', '3')[0]!.greenPhases).toEqual([0]);
    expect(find(net, '2', '4')[0]!.greenPhases).toEqual([1]);
    expect(net.crosswalks.find((c) => c.leg === '2')!.greenPhases).toEqual([0]);
  });

  it('finds where vehicle paths cross each crosswalk', () => {
    const net = buildNetwork(crossroad({ crosswalks: 'zebra' }));
    const cw = net.crosswalks.find((c) => c.leg === '1')!;
    // Everything entering from leg 1 (3 movements) and everything leaving into leg 1 (3 movements).
    expect(cw.crossings).toHaveLength(6);
  });

  it('builds T junctions and irregular 5-ways', () => {
    expect(buildNetwork(crossroad({ angles: [0, 90, 180] })).connectors).toHaveLength(6);
    expect(buildNetwork(crossroad({ angles: [0, 70, 150, 220, 290] })).connectors).toHaveLength(20);
  });
});
