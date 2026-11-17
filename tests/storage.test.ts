import { beforeEach, describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/network/build';
import { deleteDesign, designFile, listDesigns, parseScenario, saveDesign } from '../src/scenarios/storage';
import { DEFAULT_SETUP, SHAPES, buildScenario, defaultDemand, type Shape } from '../src/scenarios/setup';
import { crossroad } from '../src/scenarios/templates';

describe('design files', () => {
  it('round-trips a design through its file format', () => {
    const s = crossroad({ lanes: 2, crosswalks: 'zebra' });
    s.flyovers = [['1', '3']];
    const parsed = parseScenario(JSON.parse(designFile('Ring road', s)));
    expect(parsed.error).toBeUndefined();
    expect(parsed.name).toBe('Ring road');
    expect(parsed.scenario).toEqual(s);
  });

  it('accepts a bare scenario too', () => {
    expect(parseScenario(JSON.parse(JSON.stringify(crossroad()))).scenario).toBeDefined();
  });

  it('rejects files that would break the junction', () => {
    const bad = (change: (s: any) => void) => {
      const s: any = structuredClone(crossroad());
      change(s);
      return parseScenario(s).error;
    };
    expect(parseScenario(null).error).toBeTruthy();
    expect(parseScenario({ hello: 'world' }).error).toBeTruthy();
    expect(bad((s) => (s.version = 2))).toMatch(/version/);
    expect(bad((s) => (s.legs = s.legs.slice(0, 1)))).toMatch(/2 to 6 roads/);
    expect(bad((s) => (s.legs[0].lanesIn = 9))).toMatch(/lanes/);
    expect(bad((s) => (s.legs[1].id = s.legs[0].id))).toMatch(/share an id/);
    expect(bad((s) => (s.control = { type: 'teleport' }))).toMatch(/control/);
    expect(bad((s) => (s.demand.vehicles[0].vehPerHour = 1e9))).toMatch(/out of range/);
  });
});

describe('saved designs', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it('saves, lists newest first, replaces by name, and deletes', () => {
    expect(listDesigns()).toEqual([]);
    expect(saveDesign('A', crossroad())).toBe(true);
    expect(saveDesign('B', crossroad({ lanes: 2 }))).toBe(true);
    expect(listDesigns().map((d) => d.name)).toEqual(['B', 'A']);
    saveDesign('A', crossroad({ lanes: 3 }));
    const list = listDesigns();
    expect(list.map((d) => d.name)).toEqual(['A', 'B']);
    expect(list[0]!.scenario.legs[0]!.lanesIn).toBe(3);
    deleteDesign(list[0]!.id);
    expect(listDesigns().map((d) => d.name)).toEqual(['B']);
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('traffic.designs.v1', '{not json');
    expect(listDesigns()).toEqual([]);
  });
});

describe('newer design features', () => {
  it('load turn pockets, lane arrows and a heavy-vehicle share, and refuse broken ones', () => {
    const s = crossroad({ lanes: 2 });
    s.legs[0]!.turnPocket = true;
    s.legs[1]!.laneTurns = [['near', 'through'], ['far']];
    s.demand.heavyShare = 0.15;
    const back = parseScenario(JSON.parse(designFile('New', s)));
    expect(back.error).toBeUndefined();
    expect(back.scenario).toEqual(s);
    expect(() => buildNetwork(back.scenario!)).not.toThrow();

    const arrows = JSON.parse(JSON.stringify(s));
    arrows.legs[1].laneTurns = ['left'];
    expect(parseScenario(arrows).error).toMatch(/lane arrows/);
    const heavy = JSON.parse(JSON.stringify(s));
    heavy.demand.heavyShare = 2;
    expect(parseScenario(heavy).error).toMatch(/trucks and buses/);
  });
});

describe('templates', () => {
  it('every shape builds a working junction', () => {
    for (const shape of Object.keys(SHAPES) as Shape[]) {
      const setup = { ...DEFAULT_SETUP, shape };
      expect(() => buildNetwork(buildScenario(setup, defaultDemand(setup)))).not.toThrow();
    }
  });
});
