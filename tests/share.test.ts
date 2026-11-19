import { describe, expect, it } from 'vitest';
import { readShared, shareHash, sharedPayload } from '../src/scenarios/share';
import { crossroad, twoPhaseSignals } from '../src/scenarios/templates';

describe('sharing a design by link', () => {
  it('round-trips a design and its name through the link', async () => {
    const s = crossroad({ lanes: 2, crosswalks: 'zebra' });
    s.control = twoPhaseSignals();
    s.legs[0]!.turnPocket = true;
    s.legs[1]!.laneTurns = [['near', 'through'], ['far']];
    s.flyovers = [['1', '3']];
    const hash = await shareHash('Çarşı kavşağı', s);
    const payload = sharedPayload(hash);
    expect(payload).toBeTruthy();
    const back = await readShared(payload!);
    expect(back.error).toBeUndefined();
    expect(back.name).toBe('Çarşı kavşağı');
    expect(back.scenario).toEqual(s);
  });

  it('keeps links short enough to paste anywhere', async () => {
    const hash = await shareHash('Big', crossroad({ lanes: 4, crosswalks: 'signal' }));
    expect(hash.length).toBeLessThan(2000);
    expect(hash).toMatch(/^#design=[A-Za-z0-9_-]+$/);
  });

  it('ignores hashes that are not shared designs', () => {
    expect(sharedPayload('')).toBeNull();
    expect(sharedPayload('#')).toBeNull();
    expect(sharedPayload('#level=3')).toBeNull();
  });

  it('explains damaged, foreign and future links instead of failing', async () => {
    const payload = sharedPayload(await shareHash('A', crossroad()))!;
    expect((await readShared(payload.slice(0, payload.length / 2))).error).toMatch(/damaged/);
    expect((await readShared('1not-a-design')).error).toMatch(/damaged/);
    expect((await readShared('9' + payload.slice(1))).error).toMatch(/newer version/);
  });
});
