import type { CrosswalkType, LegId, Scenario } from '../core/types';
import type { Polyline, Vec2 } from '../core/geometry';

/** Near side = the side you drive on (right turn in right-hand traffic). Far side crosses oncoming traffic. */
export type TurnKind = 'through' | 'near' | 'far';

export interface LegGeometry {
  id: LegId;
  /** Unit vector from the centre outwards along the leg. */
  dir: Vec2;
  /** Unit normal pointing from the centreline towards the inbound lanes. */
  inNormal: Vec2;
  /** Distance from centre where the junction box ends. */
  boxEdge: number;
  /** Distance from centre of the stop line (where inbound lanes end and outbound lanes start). */
  stopLine: number;
  /** Distance from centre of the crosswalk centreline, if the leg has one. */
  crosswalkCenter: number | null;
  inEdge: number;
  outEdge: number;
  length: number;
  laneWidth: number;
  medianWidth: number;
}

export interface Lane {
  idx: number;
  leg: LegId;
  kind: 'in' | 'out';
  /** 0 = curb (outermost) lane. */
  index: number;
  path: Polyline;
  speedLimit: number;
  width: number;
}

export interface ConflictRef {
  /** Index of the other connector. */
  other: number;
  /** Where the shared stretch starts / ends along this connector (paths closer than a car width). */
  s: number;
  sEnd: number;
  /** Where the shared stretch starts / ends along the other connector. */
  sOther: number;
  sOtherEnd: number;
  kind: 'cross' | 'merge';
  /** True if this connector must give way to the other one. */
  yields: boolean;
}

export interface CrosswalkCrossing {
  connector: number;
  /** Arc length along the connector. */
  s: number;
  /** Arc length along the crosswalk. */
  sCrosswalk: number;
}

export interface Connector {
  idx: number;
  from: LegId;
  to: LegId;
  inLane: number;
  outLane: number;
  path: Polyline;
  speedLimit: number;
  turn: TurnKind;
  conflicts: ConflictRef[];
  /** Indices into Network.crosswalks paired with where this connector crosses them. */
  crosswalkCrossings: Array<{ crosswalk: number; s: number; sCrosswalk: number }>;
  /** Signal phases in which this connector has green. Empty for non-signalised control. */
  greenPhases: number[];
}

export interface Crosswalk {
  idx: number;
  leg: LegId;
  type: CrosswalkType;
  /** From the outbound-side kerb to the inbound-side kerb. */
  path: Polyline;
  width: number;
  crossings: CrosswalkCrossing[];
  greenPhases: number[];
}

export interface Network {
  scenario: Scenario;
  legs: Map<LegId, LegGeometry>;
  lanes: Lane[];
  connectors: Connector[];
  crosswalks: Crosswalk[];
  /** Connectors leaving each inbound lane. */
  connectorsFromLane: Map<number, number[]>;
  /** Inbound lanes allowed for each movement, keyed `${from}>${to}`. */
  movementLanes: Map<string, number[]>;
}

export const movementKey = (from: LegId, to: LegId) => `${from}>${to}`;
