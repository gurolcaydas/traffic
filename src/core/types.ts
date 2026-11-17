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
  /** Legs that drivers coming from this leg may not turn into. */
  banned?: LegId[];
  /** A separate near-side turning lane that bypasses the junction around a corner island. */
  slipLane?: boolean;
  /**
   * A turn pocket: a short extra lane beside the median for far-side turns (and U-turns), so drivers
   * waiting to turn across traffic do it out of the through traffic's way.
   */
  turnPocket?: boolean;
  /**
   * Painted lane arrows: which kinds of turn each inbound lane serves, curb lane first. Without it, or if
   * it leaves a turn with no lane, the turns are shared out across the lanes automatically.
   */
  laneTurns?: Array<Array<'near' | 'through' | 'far'>>;
  /** Street name, when known (e.g. from OpenStreetMap). */
  name?: string;
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

/**
 * How traffic varies through a simulated day. The demand table is the peak-hour traffic;
 * the pattern scales it hour by hour, and can tilt it towards or away from the city centre.
 */
export interface DemandPattern {
  /** Preset id, for the UI. */
  id: string;
  /** Clock time the day starts and ends, in hours (6.5 = 06:30). */
  startHour: number;
  endHour: number;
  /** Share of the table's traffic through the day, piecewise linear: [hour, factor]. */
  points: Array<[number, number]>;
  /**
   * Tidal flow, piecewise linear: +1 = everyone heading to the centre (morning commute),
   * -1 = everyone leaving it (evening), 0 = balanced.
   */
  tide?: Array<[number, number]>;
  /** The leg that leads towards the city centre (or the stadium, school, ...). */
  centreLeg?: LegId;
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
      /**
       * A signalised roundabout, as at many big Turkish junctions: the phases light each leg's entry,
       * and a second stop line on the ring just before each entry holds circulating traffic (left
       * turners going round the island) while that entry has green.
       */
      ring?: boolean;
      /**
       * Traffic-responsive (actuated) signals: each phase's green is a maximum. A green ends early once
       * no more traffic is arriving for it and someone is waiting at a red, and stays on while nobody is.
       */
      actuated?: boolean;
    }
  | {
      /** One-lane roundabout: entering traffic gives way to traffic already circulating. */
      type: 'roundabout';
    };

/** Whether traffic goes round a central island: a roundabout, signalised or not. */
export const hasRing = (control: ControlSpec) => control.type === 'roundabout' || (control.type === 'signals' && !!control.ring);

export interface Scenario {
  version: 1;
  name: string;
  driveSide: DriveSide;
  /** Seed for the random generator, so a scenario always plays out identically. */
  seed: number;
  legs: LegSpec[];
  crosswalks: CrosswalkSpec[];
  control: ControlSpec;
  /** Pairs of legs whose straight-through traffic crosses the junction on a bridge, in its own lane. */
  flyovers?: Array<[LegId, LegId]>;
  /** Where a design came from, if it was imported (map data needs attribution). */
  source?: { kind: 'osm'; lat: number; lon: number; label?: string };
  demand: {
    vehicles: VehicleDemand[];
    pedestrians: PedestrianDemand[];
    /** Time-of-day pattern. Without one, traffic is the table's, all day long. */
    pattern?: DemandPattern;
    /** Share of vehicles that are trucks or buses (0 to 1); 0.06 when not given. A third of them are buses. */
    heavyShare?: number;
  };
}

/** Most lanes a road can have each way. */
export const MAX_LANES = 4;

export const DEFAULTS = {
  laneWidth: 3.5,
  speedLimit: 13.9, // 50 km/h
  medianWidth: 0.5,
  crosswalkWidth: 4,
  amber: 3,
  allRed: 2,
} as const;
