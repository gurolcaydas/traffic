import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/network/build';
import { driveSideAt, osmToScenario, type ImportResult, type OsmElement } from '../src/osm/convert';
import { parseScenario } from '../src/scenarios/storage';
import { Simulation } from '../src/sim/simulation';
import manhattan from './fixtures/osm/manhattan-5th-42nd.json';

/** Builds OpenStreetMap-style elements from a sketch in metres around a base point. */
function sketch(base = { lat: 48.0, lon: 11.0 }) {
  const els: OsmElement[] = [];
  const k = Math.cos((base.lat * Math.PI) / 180);
  let nextNode = 1;
  let nextWay = 1000;
  const node = (x: number, y: number, tags?: Record<string, string>) => {
    const id = nextNode++;
    els.push({ type: 'node', id, lat: base.lat + y / 110540, lon: base.lon + x / (111320 * k), ...(tags ? { tags } : {}) });
    return id;
  };
  const way = (nodes: number[], tags: Record<string, string>) => {
    els.push({ type: 'way', id: nextWay++, nodes, tags });
  };
  /** A straight road from (x0,y0) to (x1,y1) through `via` nodes, as one way. */
  const road = (pts: Array<[number, number] | number>, tags: Record<string, string>) =>
    way(pts.map((p) => (typeof p === 'number' ? p : node(p[0], p[1]))), tags);
  return { els, node, way, road, base };
}

const ok = (r: ImportResult | { error: string }): ImportResult => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('importing from OpenStreetMap', () => {
  it('reads a real Manhattan junction: one-way avenue, two-way street, lights, crossings', () => {
    const r = ok(osmToScenario((manhattan as { elements: OsmElement[] }).elements, { lat: 40.753481, lon: -73.980879 }));
    expect(r.scenario.control.type).toBe('signals');
    expect(r.legs).toHaveLength(4);
    const fifth = r.legs.filter((l) => l.name === '5th Avenue');
    // One-way southbound: traffic only arrives from the north side, only leaves on the south side.
    expect(fifth.map((l) => [l.lanesIn, l.lanesOut]).sort()).toEqual([
      [0, 3],
      [3, 0],
    ]);
    expect(r.scenario.crosswalks).toHaveLength(4);
    expect(r.scenario.driveSide).toBe('right');
    // A point 70 m off still finds the same junction.
    const nearby = ok(osmToScenario((manhattan as { elements: OsmElement[] }).elements, { lat: 40.75307, lon: -73.98025 }));
    expect(nearby.center.lat).toBeCloseTo(r.center.lat, 5);
  });

  it('gives a main road priority over a side street at a T-junction', () => {
    const s = sketch();
    const c = s.node(0, 0);
    s.road([[-150, 0], c, [150, 0]], { highway: 'secondary', name: 'High Street', lanes: '2' });
    s.road([c, [0, -150]], { highway: 'residential', name: 'Mill Lane' });
    const r = ok(osmToScenario(s.els, { lat: 48.0, lon: 11.0 }));
    expect(r.legs.map((l) => l.angle)).toEqual([0, 180, 270]);
    expect(r.scenario.control).toEqual({ type: 'priority', major: ['1', '2'] });
    expect(r.legs.find((l) => l.name === 'Mill Lane')).toMatchObject({ lanesIn: 1, lanesOut: 1 });
  });

  it('merges the two halves of a divided road into one leg', () => {
    const s = sketch();
    const north = s.node(0, 4);
    const south = s.node(0, -4);
    // A two-way side road crosses both carriageways of a divided main road (a dual carriageway).
    s.road([[-200, 4], north, [200, 4]], { highway: 'primary', name: 'Ring Road', oneway: 'yes', lanes: '2' }); // eastbound
    s.road([[200, -4], south, [-200, -4]], { highway: 'primary', name: 'Ring Road', oneway: 'yes', lanes: '2' }); // westbound
    s.road([[0, 150], north, south, [0, -150]], { highway: 'tertiary', name: 'Church Street' });
    const r = ok(osmToScenario(s.els, { lat: 48.0, lon: 11.0 }));
    expect(r.legs).toHaveLength(4);
    const east = r.legs.find((l) => l.angle < 20 || l.angle > 340)!;
    expect(east).toMatchObject({ name: 'Ring Road', lanesIn: 2, lanesOut: 2 });
    expect(r.notes.join(' ')).toMatch(/Merged 2 pairs/);
    expect(r.notes.join(' ')).toMatch(/2 nearby crossing points as one/);
  });

  it('recognises a roundabout and the roads meeting it', () => {
    const s = sketch();
    const ring: number[] = [];
    for (let i = 0; i < 16; i++) ring.push(s.node(18 * Math.cos((i / 16) * 2 * Math.PI), 18 * Math.sin((i / 16) * 2 * Math.PI)));
    s.way([...ring, ring[0]!], { highway: 'secondary', junction: 'roundabout' });
    for (const i of [0, 4, 8, 12]) {
      const a = (i / 16) * 2 * Math.PI;
      s.road([ring[i]!, [150 * Math.cos(a), 150 * Math.sin(a)]], { highway: 'secondary' });
    }
    const r = ok(osmToScenario(s.els, { lat: 48.0, lon: 11.0 }));
    expect(r.scenario.control.type).toBe('roundabout');
    expect(r.legs.map((l) => l.angle)).toEqual([0, 90, 180, 270]);
    expect(r.legs.every((l) => l.lanesIn === 1 && l.lanesOut === 1)).toBe(true);
  });

  it('drives on the left in the UK and Japan, on the right elsewhere', () => {
    expect(driveSideAt(52.04, -0.76)).toBe('left'); // Milton Keynes
    expect(driveSideAt(35.68, 139.76)).toBe('left'); // Tokyo
    expect(driveSideAt(41.04, 28.98)).toBe('right'); // Istanbul
    expect(driveSideAt(48.86, 2.35)).toBe('right'); // Paris
  });

  it('keeps the most important roads when more than six meet', () => {
    const s = sketch();
    const c = s.node(0, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * Math.PI;
      s.road([c, [150 * Math.cos(a), 150 * Math.sin(a)]], { highway: i < 6 ? 'secondary' : 'residential' });
    }
    const r = ok(osmToScenario(s.els, { lat: 48.0, lon: 11.0 }));
    expect(r.legs).toHaveLength(6);
    expect(r.legs.every((l) => l.highway === 'secondary')).toBe(true);
  });

  it('explains when there is nothing usable', () => {
    const s = sketch();
    s.road([[-100, 0], [100, 0]], { highway: 'footway' });
    expect(osmToScenario(s.els, { lat: 48.0, lon: 11.0 })).toEqual({ error: expect.stringMatching(/No roads for cars/) });
    const t = sketch();
    t.road([[-100, 300], [100, 300]], { highway: 'residential' });
    expect(osmToScenario(t.els, { lat: 48.0, lon: 11.0 })).toEqual({ error: expect.stringMatching(/No junction within/) });
  });

  it('produces designs that pass validation and run', () => {
    const r = ok(osmToScenario((manhattan as { elements: OsmElement[] }).elements, { lat: 40.753481, lon: -73.980879 }));
    expect(parseScenario(JSON.parse(JSON.stringify(r.scenario))).error).toBeUndefined();
    expect(() => buildNetwork(r.scenario)).not.toThrow();
    const sim = new Simulation(r.scenario);
    sim.run(300);
    expect(sim.counts().exited).toBeGreaterThan(20);
  });
});

describe('reading a typed position', () => {
  it('understands coordinates and OpenStreetMap links', async () => {
    const { parsePlace } = await import('../src/osm/api');
    expect(parsePlace('41.0369, 28.9850')).toMatchObject({ lat: 41.0369, lon: 28.985 });
    expect(parsePlace('41.0369 28.9850')).toMatchObject({ lat: 41.0369, lon: 28.985 });
    expect(parsePlace('https://www.openstreetmap.org/#map=18/40.75348/-73.98088')).toMatchObject({ lat: 40.75348, lon: -73.98088 });
    expect(parsePlace('https://www.openstreetmap.org/?mlat=52.04&mlon=-0.76#map=17/52.04/-0.76')).toMatchObject({ lat: 52.04, lon: -0.76 });
    expect(parsePlace('Taksim Square')).toBeNull();
    expect(parsePlace('95, 10')).toBeNull();
  });
});
