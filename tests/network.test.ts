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

describe('buildNetwork: curb clearance', () => {
  const distToPolyline = (p: { x: number; y: number }, pts: Array<{ x: number; y: number }>) => {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return best;
  };

  const insidePolygon = (p: { x: number; y: number }, poly: Array<{ x: number; y: number }>) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };

  /** On a leg's strip of road, or in one of the corner areas between legs. */
  const onAsphalt = (net: ReturnType<typeof buildNetwork>, p: { x: number; y: number }) => {
    for (const g of net.legs.values()) {
      const s = p.x * g.dir.x + p.y * g.dir.y;
      const o = p.x * g.inNormal.x + p.y * g.inNormal.y;
      if (s >= 0 && s <= g.length && o >= -g.outEdge && o <= g.inEdge) return true;
    }
    return net.corners.some((c) => insidePolygon(p, [{ x: 0, y: 0 }, ...c]));
  };

  // Half a car's width plus a little air.
  const MIN_CLEARANCE = 1.0;
  const layouts = [
    crossroad(),
    crossroad({ lanes: 2 }),
    crossroad({ lanes: 3, crosswalks: 'zebra' }),
    crossroad({ driveSide: 'left', lanes: 2 }),
    crossroad({ angles: [0, 180, 270] }),
    crossroad({ angles: [90, 210, 330], lanes: 2 }),
    crossroad({ angles: [0, 70, 145, 215, 290] }),
    crossroad({ control: { type: 'roundabout' } }),
    crossroad({ control: { type: 'roundabout' }, lanes: 2, crosswalks: 'zebra' }),
    crossroad({ control: { type: 'roundabout' }, driveSide: 'left' }),
    crossroad({ control: { type: 'roundabout' }, angles: [0, 70, 145, 215, 290] }),
    crossroad({ control: { type: 'roundabout' }, angles: [0, 180, 270] }),
  ];
  layouts.forEach((scenario, i) => {
    it(`keeps every turn path clear of the curbs (layout ${i + 1})`, () => {
      const net = buildNetwork(scenario);
      let worst = Infinity;
      for (const c of net.connectors) {
        for (const p of c.path.points) for (const corner of net.corners) worst = Math.min(worst, distToPolyline(p, corner));
      }
      expect(worst).toBeGreaterThan(MIN_CLEARANCE);
      for (const c of net.connectors) for (const p of c.path.points) expect(onAsphalt(net, p)).toBe(true);
    });
  });
});

describe('buildNetwork: editing features', () => {
  it('drops banned turns', () => {
    const s = crossroad();
    s.legs[0]!.banned = ['4'];
    const net = buildNetwork(s);
    expect(find(net, '1', '4')).toHaveLength(0);
    expect(net.movementLanes.has(movementKey('1', '4'))).toBe(false);
    expect(find(net, '1', '3')).toHaveLength(1);
  });

  it('routes the near turn through a slip lane that ignores signals and gives way', () => {
    const s = crossroad({ control: twoPhaseSignals() });
    s.legs[0]!.slipLane = true;
    const net = buildNetwork(s);
    const slip = find(net, '1', '2');
    expect(slip).toHaveLength(1);
    expect(slip[0]!.kind).toBe('slip');
    expect(slip[0]!.controlled).toBe(false);
    expect(net.lanes[slip[0]!.inLane]!.role).toBe('slip');
    expect(slip[0]!.conflicts.every((c) => c.yields)).toBe(true);
    // The regular lane no longer carries the right turn.
    expect(find(net, '1', '3')[0]!.inLane).not.toBe(slip[0]!.inLane);
  });

  it('keeps the slip path off the corner island and clear of the main curb', () => {
    for (const driveSide of ['right', 'left'] as const) {
      for (const lanes of [1, 2]) {
        const s = crossroad({ lanes, driveSide, crosswalks: 'zebra' });
        s.legs.forEach((l) => (l.slipLane = true));
        const net = buildNetwork(s);
        for (const c of net.connectors.filter((c) => c.kind === 'slip')) {
          for (const p of c.path.points) {
            for (const corner of net.corners) {
              let best = Infinity;
              for (let i = 0; i < corner.length - 1; i++) {
                const a = corner[i]!;
                const b = corner[i + 1]!;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
                best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
              }
              expect(best).toBeGreaterThan(1.0);
            }
          }
        }
      }
    }
  });

  it('puts flyover traffic on its own bridge lane with no ground conflicts', () => {
    const s = crossroad({ control: twoPhaseSignals(), crosswalks: 'zebra' });
    s.flyovers = [['1', '3']];
    const net = buildNetwork(s);
    for (const [a, b] of [['1', '3'], ['3', '1']] as const) {
      const fly = find(net, a, b);
      expect(fly).toHaveLength(1);
      expect(fly[0]!.kind).toBe('flyover');
      expect(fly[0]!.level).toBe(1);
      expect(fly[0]!.controlled).toBe(false);
      expect(fly[0]!.conflicts).toHaveLength(0);
      expect(fly[0]!.crosswalkCrossings).toHaveLength(0);
      expect(net.lanes[fly[0]!.inLane]!.role).toBe('flyover');
    }
    // Turns from the flyover legs still use the ground-level lanes.
    expect(net.lanes[find(net, '1', '4')[0]!.inLane]!.role).toBe('regular');
  });
});

describe('buildNetwork: roundabouts', () => {
  const net = buildNetwork(crossroad({ control: { type: 'roundabout' } }));

  it('sends every movement round the ring, at ring speed rather than crawling', () => {
    expect(net.roundabout).not.toBeNull();
    for (const c of net.connectors) {
      expect(c.ring).toBeDefined();
      expect(c.speedLimit).toBeGreaterThan(5.5);
    }
    // Right turn: shortest way round. Left turn: three quarters.
    const near = find(net, '1', '2')[0]!.ring!.length;
    const far = find(net, '1', '4')[0]!.ring!.length;
    expect(far).toBeGreaterThan(near * 2.5);
  });

  it('makes entering traffic give way to traffic already circulating, never the reverse', () => {
    for (const c of net.connectors) {
      for (const ref of c.conflicts) {
        // A movement only ever gives way where it joins the ring.
        if (ref.yields) expect(ref.s).toBeLessThan(c.ring!.start + 1);
      }
    }
    expect(net.connectors.some((c) => c.conflicts.some((r) => r.yields))).toBe(true);
  });

  it('lets movements from different entries follow each other round shared stretches of ring', () => {
    const through = find(net, '1', '3')[0]!;
    const fromSouth = find(net, '4', '3')[0]!;
    expect(through.ringShares.some((s) => s.other === fromSouth.idx)).toBe(true);
  });
});

describe('buildNetwork: side roads at a roundabout', () => {
  const withSideRoads = (opts: Parameters<typeof crossroad>[0]) => {
    const s = crossroad({ control: { type: 'roundabout' }, ...opts });
    for (const l of s.legs) l.slipLane = true;
    return s;
  };

  it('curve round outside the ring, leaving an island, however wide the roads', () => {
    for (const opts of [{}, { lanes: 3 }, { lanes: 4, crosswalks: 'zebra' as const }, { angles: [0, 120, 240] }, { angles: [0, 70, 145, 215, 290], lanes: 2 }]) {
      const net = buildNetwork(withSideRoads(opts));
      const slips = net.connectors.filter((c) => c.kind === 'slip');
      expect(slips.length).toBeGreaterThan(0);
      for (const c of slips) {
        const nearest = Math.min(...c.path.points.map((p) => Math.hypot(p.x, p.y)));
        expect(nearest - net.lanes[c.inLane]!.width / 2).toBeGreaterThan(net.roundabout!.outerRadius + 4);
      }
    }
  });

  it('are left out where the roads are too far apart to bend round the ring', () => {
    // A T-junction: a side road along the straight would have to cut through the ring.
    const net = buildNetwork(withSideRoads({ angles: [0, 180, 270] }));
    const slips = net.connectors.filter((c) => c.kind === 'slip');
    // Road 1 (east) to road 2 (west) runs straight across; the two right-angle corners keep theirs.
    expect(slips.map((c) => `${c.from}>${c.to}`).sort()).toEqual(['2>3', '3>1']);
    expect(net.legs.get('1')!.slipEdge).toBeNull();
    expect(net.legs.get('2')!.slipOutEdge).toBeNull();
  });
});
