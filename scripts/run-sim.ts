// Headless runner: plays scenarios for a while and prints the metrics the game will score on.
// Usage: npm run sim [-- minutes]
import { Simulation } from '../src/sim/simulation';
import { crossroad, twoPhaseSignals } from '../src/scenarios/templates';
import type { Scenario } from '../src/core/types';

const minutes = Number(process.argv[2] ?? 15);

const scenarios: Scenario[] = [
  { ...crossroad({ vehPerHourPerLeg: 300 }), name: 'Priority to the right, light (300 veh/h/leg)' },
  { ...crossroad({ vehPerHourPerLeg: 600 }), name: 'Priority to the right, heavy (600 veh/h/leg)' },
  { ...crossroad({ vehPerHourPerLeg: 600, control: { type: 'priority', major: ['1', '3'] } }), name: 'Major road 1-3, heavy' },
  { ...crossroad({ vehPerHourPerLeg: 600, control: twoPhaseSignals(25) }), name: 'Two-phase signals, heavy' },
  { ...crossroad({ vehPerHourPerLeg: 600, lanes: 2, control: twoPhaseSignals(25) }), name: 'Two-phase signals, 2 lanes, heavy' },
  { ...crossroad({ vehPerHourPerLeg: 400, crosswalks: 'zebra', pedPerHourPerCrosswalk: 300 }), name: 'Zebra crossings, 300 ped/h each' },
  { ...crossroad({ vehPerHourPerLeg: 400, crosswalks: 'signal', control: twoPhaseSignals(25) }), name: 'Signals + signalised crossings' },
  { ...crossroad({ vehPerHourPerLeg: 400, driveSide: 'left' }), name: 'Left-hand traffic, medium' },
];

for (const scenario of scenarios) {
  const sim = new Simulation(scenario);
  sim.run(120); // warm-up
  sim.resetMetrics();
  const t0 = performance.now();
  sim.run(minutes * 60);
  const ms = performance.now() - t0;
  const m = sim.getMetrics();
  console.log(`\n${scenario.name}`);
  console.log(
    `  LOS ${m.los}  delay ${m.avgDelay.toFixed(1)}s  throughput ${m.throughputPerHour.toFixed(0)} veh/h` +
      `  peds ${m.pedCrossed} (wait ${m.pedAvgWait.toFixed(1)}s)  ${m.gridlock ? 'GRIDLOCK' : ''}` +
      `  [${((minutes * 60 * 1000) / ms).toFixed(0)}× real time]`,
  );
  for (const l of m.legs) {
    console.log(`  leg ${l.leg}: queue ${l.queue} (max ${l.maxQueue}, backlog ${l.backlog})  delay ${l.avgDelay.toFixed(1)}s  done ${l.completed}`);
  }
}
