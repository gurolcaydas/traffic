// What a design costs, relative to how the level started. Only additions cost money: taking
// something away is free (and earns nothing back), and retiming signals is free.
import { t } from '../core/i18n';
import type { Scenario } from '../core/types';
import { crossingOf } from '../scenarios/edit';
import type { CostItem } from './types';

export const COSTS = {
  lane: 40,
  majorRoad: 10,
  signals: 120,
  roundabout: 300,
  sideRoad: 150,
  flyover: 600,
  zebra: 20,
  signalCrossing: 60,
  ban: 5,
} as const;

export function costItems(start: Scenario, now: Scenario): CostItem[] {
  const items: CostItem[] = [];
  const startLeg = (id: string) => start.legs.find((l) => l.id === id);

  let lanes = 0;
  for (const leg of now.legs) {
    const s = startLeg(leg.id);
    if (!s) continue;
    lanes += Math.max(0, leg.lanesIn - s.lanesIn) + Math.max(0, leg.lanesOut - s.lanesOut);
  }
  if (lanes) items.push({ label: t(`${lanes} extra lane${lanes > 1 ? 's' : ''}`, `${lanes} ek şerit`), cost: lanes * COSTS.lane });

  if (now.control.type !== start.control.type) {
    if (now.control.type === 'signals') items.push({ label: t('Traffic signals', 'Trafik ışıkları'), cost: COSTS.signals });
    if (now.control.type === 'roundabout') items.push({ label: t('Roundabout', 'Dönel kavşak'), cost: COSTS.roundabout });
    if (now.control.type === 'priority' && now.control.major.length) items.push({ label: t('Priority signs', 'Öncelik levhaları'), cost: COSTS.majorRoad });
  } else if (now.control.type === 'priority' && start.control.type === 'priority' && now.control.major.length && !start.control.major.length) {
    items.push({ label: t('Priority signs', 'Öncelik levhaları'), cost: COSTS.majorRoad });
  }

  const sideRoads = now.legs.filter((l) => l.slipLane && !startLeg(l.id)?.slipLane).length;
  if (sideRoads) items.push({ label: t(`${sideRoads} side road${sideRoads > 1 ? 's' : ''}`, `${sideRoads} serbest dönüş yolu`), cost: sideRoads * COSTS.sideRoad });

  const key = ([a, b]: [string, string]) => [a, b].sort().join('-');
  const before = new Set((start.flyovers ?? []).map(key));
  const flyovers = (now.flyovers ?? []).filter((p) => !before.has(key(p))).length;
  if (flyovers) items.push({ label: t(`${flyovers} flyover${flyovers > 1 ? 's' : ''}`, `${flyovers} üst geçit`), cost: flyovers * COSTS.flyover });

  let zebras = 0;
  let signalled = 0;
  for (const leg of now.legs) {
    const was = crossingOf(start, leg.id);
    const is = crossingOf(now, leg.id);
    if (is === was || is === 'none') continue;
    if (is === 'zebra') zebras++;
    else signalled++;
  }
  if (zebras) items.push({ label: t(`${zebras} zebra crossing${zebras > 1 ? 's' : ''}`, `${zebras} çizgili yaya geçidi`), cost: zebras * COSTS.zebra });
  if (signalled) items.push({ label: t(`${signalled} signalised crossing${signalled > 1 ? 's' : ''}`, `${signalled} ışıklı yaya geçidi`), cost: signalled * COSTS.signalCrossing });

  let bans = 0;
  for (const leg of now.legs) {
    const had = new Set(startLeg(leg.id)?.banned ?? []);
    bans += (leg.banned ?? []).filter((b) => !had.has(b)).length;
  }
  if (bans) items.push({ label: t(`${bans} turn ban${bans > 1 ? 's' : ''}`, `${bans} dönüş yasağı`), cost: bans * COSTS.ban });

  return items;
}

export const totalCost = (items: CostItem[]) => items.reduce((s, i) => s + i.cost, 0);
