// Scenario format: the plain-JSON description of a junction, its demand and its control.
// Everything the simulation needs is derived from this; editors only ever change a Scenario.
//
// Units: metres, seconds, m/s, vehicles/hour, pedestrians/hour.
// Coordinates: origin at junction centre, x east, y north (y-up). Renderers flip y.
// Angles: degrees, 0 = east, counter-clockwise positive.

export type DriveSide = 'right' | 'left';

export type LegId = string;

export interface LegSpec {
  id: LegId;
  /** Direction from the junction centre outwards, in degrees. */
  angle: number;
  /** Length of the approach/exit road drawn and simulated, from the centre. */
  length: number;
  /** Lanes travelling towards the junction. 0 makes the leg exit-only. */
  lanesIn: number;
  /** Lanes travelling away from the junction. 0 makes the leg entry-only. */
  lanesOut: number;
  laneWidth?: number;
  /** m/s */
  speedLimit?: number;
  /** Width of the painted median between in/out lanes. */
  medianWidth?: number;
}

export type CrosswalkType = 'zebra' | 'signal';

export interface CrosswalkSpec {
  /** Crosswalk runs across this leg, just outside the junction box. */
  leg: LegId;
  type: CrosswalkType;
}

export interface Movement {
  from: LegId;
  to: LegId;
}

export interface VehicleDemand extends Movement {
  vehPerHour: number;
}

export interface PedestrianDemand {
  /** Leg whose crosswalk the pedestrians use. */
  leg: LegId;
  pedPerHour: number;
}

export interface SignalPhase {
  /** Green time in seconds. */
  green: number;
  /** Movements that get green. A movement with `to: '*'` means every movement from that leg. */
  movements: Array<{ from: LegId; to: LegId | '*' }>;
  /** Legs whose signalised crosswalks get a walk signal in this phase. */
  pedestrians?: LegId[];
}

export type ControlSpec =
  | {
      type: 'priority';
      /** Legs on the major road. Everyone else yields to them. Empty = priority to the near side. */
      major: LegId[];
    }
  | {
      type: 'signals';
      phases: SignalPhase[];
      /** Seconds of amber after each green. Default 3. */
      amber?: number;
      /** Seconds of all-red after each amber. Default 2. */
      allRed?: number;
    };

export interface Scenario {
  version: 1;
  name: string;
  driveSide: DriveSide;
  /** Seed for the random generator, so a scenario always plays out identically. */
  seed: number;
  legs: LegSpec[];
  crosswalks: CrosswalkSpec[];
  control: ControlSpec;
  demand: {
    vehicles: VehicleDemand[];
    pedestrians: PedestrianDemand[];
  };
}

export const DEFAULTS = {
  laneWidth: 3.5,
  speedLimit: 13.9, // 50 km/h
  medianWidth: 0.5,
  crosswalkWidth: 4,
  amber: 3,
  allRed: 2,
} as const;
