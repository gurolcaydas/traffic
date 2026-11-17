// Compares the traffic model with standard traffic-engineering results.
// Usage: npm run calibrate
import {
  GIVE_WAY_GAPS,
  gapAcceptanceCapacity,
  giveWayCapacity,
  hcmRoundaboutCapacity,
  roundaboutEntryCapacity,
  saturationFlow,
  signalDelay,
} from '../src/sim/calibration';

const f = (x: number) => x.toFixed(0).padStart(6);

console.log('\nSaturation flow, one lane (HCM base 1900 veh/h of green)');
console.log(`  simulated ${f(saturationFlow())}`);

console.log('\nSignal delay, s/veh (Webster)');
for (const q of [200, 400, 500, 600]) {
  const { simulated, webster } = signalDelay(q);
  console.log(`  ${f(q)} veh/h   simulated ${simulated.toFixed(1).padStart(6)}   Webster ${webster.toFixed(1).padStart(6)}`);
}

console.log('\nRoundabout entry capacity, veh/h (HCM 6: 1380·e^(−0.00102·vc))');
for (const vc of [0, 300, 600, 900]) {
  console.log(`  vc ${f(vc)}   simulated ${f(roundaboutEntryCapacity(vc))}   HCM ${f(hcmRoundaboutCapacity(vc))}`);
}

const { tc, tf } = GIVE_WAY_GAPS;
console.log(`\nGive-way crossing capacity, veh/h (gap acceptance, tc ${tc} s, tf ${tf} s), and delay on the major road`);
for (const q of [0, 300, 600, 900, 1200]) {
  const { capacity, majorDelay } = giveWayCapacity(q);
  console.log(`  major ${f(q)}   simulated ${f(capacity)}   theory ${f(gapAcceptanceCapacity(q, tc, tf))}   major-road delay ${majorDelay.toFixed(1)} s`);
}
