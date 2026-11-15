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
    title: 'Main street',
    brief:
      'Mill Road carries most of the town (legs 1 and 3), but the junction with two quiet side streets has no signs, so everyone gives way to the right. Main-road drivers keep stopping for the odd car from a side street, and the queues reach the bakery.',
    hint: 'Most traffic is on one road. Who should have to give way?',
    scenario: base(
      'Main street',
      cross(1),
      od([
        ['1', '3', 480], ['1', '2', 60], ['1', '4', 60],
        ['3', '1', 480], ['3', '2', 60], ['3', '4', 60],
        ['2', '1', 80], ['2', '3', 80], ['2', '4', 50],
        ['4', '1', 80], ['4', '3', 80], ['4', '2', 50],
      ]),
      { type: 'priority', major: [] },
    ),
    budget: 150,
    tools: { control: ['major', 'signals'], lanes: false, sideRoads: false, flyover: false, crossings: false, bans: true, signalPlan: true },
    stars: [60, 32, 18],
  },
  {
    id: 'room-to-turn',
    title: 'Room to turn',
    brief:
      'These lights should cope, but one lane each way means a single driver waiting to turn left holds up everyone behind. Drivers are furious. The council will pay for some widening.',
    hint: 'A second lane lets through traffic pass a waiting turner. The signal plan has presets too.',
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
    stars: [60, 35, 22],
  },
  {
    id: 'rush-hour',
    title: 'Rush hour',
    brief:
      'Quiet most of the day, but every morning the whole suburb drives into town along leg 1, and every evening back out again. Judged on the busiest three hours.',
    hint: 'At a roundabout, nobody waits for a red light that nobody is using.',
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
    title: 'School run',
    brief:
      'The primary school is on leg 2. Its zebra crossings must stay, and children must not wait long to cross. Shops line legs 1 and 3, so those roads cannot be widened.',
    hint: 'Signalised crossings give children a guaranteed turn. A side road keeps turning cars away from the crossings.',
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
    title: 'Five ways',
    brief: 'Five roads meet at odd angles and everyone gives way to the right. Locals call it "the knot". Untie it.',
    hint: 'Signals with five phases means a long wait for everyone.',
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
    title: 'Stadium night',
    brief:
      'The stadium is on leg 2. Before kick-off everyone arrives at once; after the final whistle, everyone leaves at once. The city has finally agreed to spend real money.',
    hint: 'Straight-through traffic on the other road does not need to wait for the crowd at all.',
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
