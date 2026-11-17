import { t } from '../core/i18n';
import type { LegSpec, Scenario, VehicleDemand } from '../core/types';
import { PATTERNS } from '../scenarios/patterns';
import { autoSignalPlan } from '../scenarios/setup';
import type { Level } from './types';

const leg = (id: string, angle: number, lanes = 1): LegSpec => ({ id, angle, length: 120, lanesIn: lanes, lanesOut: lanes });

/** Demand from a table of [from, to, veh/h]. */
const od = (rows: Array<[string, string, number]>): VehicleDemand[] => rows.map(([from, to, vehPerHour]) => ({ from, to, vehPerHour }));

/** Even split of `perLeg` from every leg to every other. */
const even = (legs: LegSpec[], perLeg: number): VehicleDemand[] =>
  legs.flatMap((f) => legs.filter((t) => t !== f).map((t) => ({ from: f.id, to: t.id, vehPerHour: Math.round(perLeg / (legs.length - 1)) })));

const base = (name: string, legs: LegSpec[], vehicles: VehicleDemand[], control: Scenario['control'], extra: Partial<Scenario> = {}): Scenario => ({
  version: 1,
  name,
  driveSide: 'right',
  seed: 1,
  legs,
  crosswalks: [],
  control,
  demand: { vehicles, pedestrians: legs.map((l) => ({ leg: l.id, pedPerHour: 120 })) },
  ...extra,
});

const cross = (lanes = 1) => [leg('1', 0, lanes), leg('2', 90, lanes), leg('3', 180, lanes), leg('4', 270, lanes)];

export const LEVELS: Level[] = [
  {
    id: 'main-street',
    get title() {
      return t('Main street', 'Ana cadde');
    },
    get brief() {
      return t(
        'Mill Road carries most of the town (legs 1 and 3), but the junction with two quiet side streets has no signs, so everyone gives way to the right. Main-road drivers keep stopping for the odd car from a side street, and the queues reach the bakery.',
        'Değirmen Yolu kasabanın trafiğinin çoğunu taşıyor (1 ve 3 numaralı yollar), ama iki sakin yan sokakla kesiştiği kavşakta hiç levha yok; bu yüzden herkes sağdan gelene yol veriyor. Ana yoldaki sürücüler yan sokaktan gelen tek tük araç için durup duruyor ve kuyruk fırına kadar uzanıyor.',
      );
    },
    get hint() {
      return t(
        'Most traffic is on one road. Who should have to give way?',
        'Trafiğin çoğu tek bir yolda. Kim yol vermeli?',
      );
    },
    scenario: base(
      'Main street',
      cross(1),
      od([
        ['1', '3', 380], ['1', '2', 60], ['1', '4', 60],
        ['3', '1', 380], ['3', '2', 60], ['3', '4', 60],
        ['2', '1', 50], ['2', '3', 50], ['2', '4', 30],
        ['4', '1', 50], ['4', '3', 50], ['4', '2', 30],
      ]),
      { type: 'priority', major: [] },
    ),
    budget: 150,
    tools: { control: ['major', 'signals'], lanes: false, sideRoads: false, flyover: false, crossings: false, bans: true, signalPlan: true },
    stars: [60, 32, 18],
  },
  {
    id: 'room-to-turn',
    get title() {
      return t('Room to turn', 'Dönecek yer');
    },
    get brief() {
      return t(
        'These lights should cope, but one lane each way means a single driver waiting to turn left holds up everyone behind. Drivers are furious. The council will pay for some widening.',
        'Bu ışıklar trafiği kaldırmalı, ama her yönde tek şerit olunca sola dönmek için bekleyen tek bir sürücü arkasındaki herkesi tutuyor. Sürücüler çok öfkeli. Belediye biraz genişletmenin parasını ödeyecek.',
      );
    },
    get hint() {
      return t(
        'A second lane lets through traffic pass a waiting turner. The signal plan has presets too.',
        'İkinci bir şerit, düz gidenlerin dönmeyi bekleyen aracı geçmesini sağlar. Sinyal planının hazır ayarları da var.',
      );
    },
    scenario: base(
      'Room to turn',
      cross(1),
      od([
        ['1', '3', 240], ['1', '4', 140], ['1', '2', 60],
        ['3', '1', 240], ['3', '2', 140], ['3', '4', 60],
        ['2', '4', 120], ['2', '1', 40], ['2', '3', 40],
        ['4', '2', 120], ['4', '3', 40], ['4', '1', 40],
      ]),
      { type: 'signals', phases: autoSignalPlan(cross(1), 25) },
    ),
    budget: 340,
    tools: { control: [], lanes: true, sideRoads: false, flyover: false, crossings: false, bans: true, signalPlan: true },
    stars: [60, 35, 24],
  },
  {
    id: 'rush-hour',
    get title() {
      return t('Rush hour', 'Yoğun saat');
    },
    get brief() {
      return t(
        'Quiet most of the day, but every morning the whole suburb drives into town along leg 1, and every evening back out again. Judged on the busiest three hours.',
        'Günün çoğunda sakin, ama her sabah bütün banliyö 1 numaralı yoldan şehre giriyor, her akşam da geri çıkıyor. En yoğun üç saate göre değerlendirilir.',
      );
    },
    get hint() {
      return t(
        'At a roundabout, nobody waits for a red light that nobody is using.',
        'Dönel kavşakta kimse, kimsenin kullanmadığı bir kırmızı ışıkta beklemez.',
      );
    },
    scenario: {
      ...base('Rush hour', cross(1), even(cross(1), 420), { type: 'priority', major: [] }),
      demand: { vehicles: even(cross(1), 420), pedestrians: [], pattern: PATTERNS.commuter!.make('1') },
    },
    budget: 600,
    tools: { control: ['major', 'signals', 'roundabout'], lanes: true, sideRoads: true, flyover: false, crossings: false, bans: true, signalPlan: true },
    stars: [60, 40, 30],
  },
  {
    id: 'school-run',
    get title() {
      return t('School run', 'Okul saati');
    },
    get brief() {
      return t(
        'The primary school is on leg 2. Its zebra crossings must stay, and children must not wait long to cross. Shops line legs 1 and 3, so those roads cannot be widened.',
        'İlkokul 2 numaralı yolda. Çizgili yaya geçitleri kalmalı ve çocuklar karşıya geçmek için uzun beklememeli. 1 ve 3 numaralı yollar dükkânlarla çevrili, bu yüzden genişletilemez.',
      );
    },
    get hint() {
      return t(
        'Signalised crossings give children a guaranteed turn. A side road keeps turning cars away from the crossings.',
        'Işıklı yaya geçitleri çocuklara kesin bir geçiş sırası verir. Serbest dönüş yolu, dönen araçları yaya geçitlerinden uzak tutar.',
      );
    },
    scenario: {
      ...base('School run', [leg('1', 0), leg('2', 90), leg('3', 180)], even([leg('1', 0), leg('2', 90), leg('3', 180)], 280), { type: 'priority', major: ['1', '3'] }),
      crosswalks: [{ leg: '1', type: 'zebra' }, { leg: '2', type: 'zebra' }, { leg: '3', type: 'zebra' }],
      demand: {
        vehicles: even([leg('1', 0), leg('2', 90), leg('3', 180)], 280),
        pedestrians: [{ leg: '1', pedPerHour: 200 }, { leg: '2', pedPerHour: 350 }, { leg: '3', pedPerHour: 200 }],
        pattern: PATTERNS.school!.make('2'),
      },
    },
    budget: 450,
    tools: { control: ['right', 'signals', 'roundabout'], lanes: true, sideRoads: true, flyover: false, crossings: true, bans: true, signalPlan: true },
    fixedLanes: ['1', '3'],
    blockedCorners: ['3'],
    requiredCrossings: ['1', '2', '3'],
    maxPedWait: 25,
    stars: [60, 30, 18],
  },
  {
    id: 'five-ways',
    get title() {
      return t('Five ways', 'Beş yol');
    },
    get brief() {
      return t(
        'Five roads meet at odd angles and everyone gives way to the right. Locals call it "the knot". Untie it.',
        'Beş yol tuhaf açılarla buluşuyor ve herkes sağdan gelene yol veriyor. Mahalleli buraya "düğüm" diyor. Çözün onu.',
      );
    },
    get hint() {
      return t(
        'Signals with five phases means a long wait for everyone.',
        'Beş fazlı ışıklar herkes için uzun bekleme demektir.',
      );
    },
    scenario: base('Five ways', [leg('1', 0), leg('2', 70), leg('3', 145), leg('4', 215), leg('5', 290)], even([leg('1', 0), leg('2', 70), leg('3', 145), leg('4', 215), leg('5', 290)], 300), {
      type: 'priority',
      major: [],
    }),
    budget: 600,
    tools: { control: ['major', 'signals', 'roundabout'], lanes: true, sideRoads: true, flyover: false, crossings: false, bans: true, signalPlan: true },
    stars: [46, 35, 24],
  },
  {
    id: 'stadium-night',
    get title() {
      return t('Stadium night', 'Maç gecesi');
    },
    get brief() {
      return t(
        'The stadium is on leg 2. Before kick-off everyone arrives at once; after the final whistle, everyone leaves at once. The city has finally agreed to spend real money.',
        'Stadyum 2 numaralı yolda. Maç öncesi herkes aynı anda geliyor; son düdükten sonra herkes aynı anda ayrılıyor. Belediye sonunda ciddi para harcamayı kabul etti.',
      );
    },
    get hint() {
      return t(
        'Straight-through traffic on the other road does not need to wait for the crowd at all.',
        'Diğer yoldaki düz giden trafiğin kalabalığı hiç beklemesi gerekmez.',
      );
    },
    scenario: {
      ...base('Stadium night', cross(2), even(cross(2), 600), { type: 'signals', phases: autoSignalPlan(cross(2), 25) }),
      demand: { vehicles: even(cross(2), 600), pedestrians: [], pattern: PATTERNS.event!.make('2') },
    },
    budget: 1100,
    tools: { control: ['signals', 'roundabout'], lanes: true, sideRoads: true, flyover: true, crossings: false, bans: true, signalPlan: true },
    stars: [50, 25, 18],
  },
];

export const levelById = (id: string) => LEVELS.find((l) => l.id === id);
