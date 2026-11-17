import { describe, expect, it } from 'vitest';
import {
  GIVE_WAY_GAPS,
  gapAcceptanceCapacity,
  giveWayCapacity,
  hcmRoundaboutCapacity,
  roundaboutEntryCapacity,
  saturationFlow,
  signalDelay,
} from '../src/sim/calibration';

// The model against standard traffic-engineering results (`npm run calibrate` prints the full table).
// Tolerances are wide enough for the randomness of half-hour runs, and tight enough to catch a
// change that makes a whole kind of junction behave unlike real ones.
const SEEDS = [1, 2];

/** Within `share` of the reference, either way. */
const near = (value: number, reference: number, share: number) => {
  expect(value).toBeGreaterThan(reference * (1 - share));
  expect(value).toBeLessThan(reference * (1 + share));
};

describe('Realism', () => {
  it('discharges a saturated signal queue at about 1900 veh/h of green per lane', () => {
    near(saturationFlow(SEEDS), 1900, 0.08);
  }, 30000);

  it('matches Webster delay at a fixed-time signal', () => {
    for (const q of [300, 550]) {
      const { simulated, webster } = signalDelay(q, SEEDS);
      expect(Math.abs(simulated - webster)).toBeLessThan(Math.max(3, 0.25 * webster));
    }
  }, 60000);

  it('gives a roundabout entry the HCM capacity for the traffic going round', () => {
    for (const vc of [0, 300, 600]) near(roundaboutEntryCapacity(vc, SEEDS), hcmRoundaboutCapacity(vc), 0.2);
  }, 60000);

  it('gives a side road the gap-acceptance capacity across a two-way main road', () => {
    const { tc, tf } = GIVE_WAY_GAPS;
    for (const major of [400, 1000]) near(giveWayCapacity(major, SEEDS).capacity, gapAcceptanceCapacity(major, tc, tf), 0.25);
  }, 60000);

  it('keeps the main road flowing however busy the side road is', () => {
    // Side-road drivers must not slip in front of a main-road driver who is waiting their turn.
    expect(giveWayCapacity(1000, SEEDS).majorDelay).toBeLessThan(6);
  }, 30000);
});
