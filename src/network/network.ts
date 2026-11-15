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
  /** Outer edges of the main carriageway (flyover lanes included, slip lane not). */
  inEdge: number;
  outEdge: number;
  /** If the leg has a slip lane: its outer edge, and where along the leg it peels off. */
  slipEdge: number | null;
  slipEnd: number | null;
  /** If a neighbour's slip road joins this leg: the added lane's outer edge and where it starts. */
  slipOutEdge: number | null;
  slipOutStart: number | null;
  /** The leg this leg's slip lane leads to. */
  slipTarget: LegId | null;
  length: number;
  laneWidth: number;
  medianWidth: number;
}

export type LaneRole = 'regular' | 'slip' | 'flyover';

export interface Lane {
  idx: number;
  leg: LegId;
  kind: 'in' | 'out';
  role: LaneRole;
  /** Among the regular lanes, 0 = curb (outermost). Special lanes use 0. */
  index: number;
  /** Signed distance of the lane centre from the leg centreline, along the leg's inNormal. */
  offset: number;
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
  /** 'slip' bypasses the junction, 'flyover' crosses above it. */
  kind: 'normal' | 'slip' | 'flyover';
  /** 1 = on the bridge, so it never conflicts with ground-level traffic. */
  level: 0 | 1;
  /** False for movements that ignore the signals (slip lanes, flyovers). */
  controlled: boolean;
  inLane: number;
  outLane: number;
  path: Polyline;
  speedLimit: number;
  turn: TurnKind;
  conflicts: ConflictRef[];
  /**
   * Other connectors leaving the same lane. Both start on a shared stretch before they split;
   * `until` is where the other connector has left it (arc length along the other connector).
   */
  siblings: Array<{ other: number; until: number }>;
  /** Indices into Network.crosswalks paired with where this connector crosses them. */
  crosswalkCrossings: Array<{ crosswalk: number; s: number; sCrosswalk: number }>;
  /** Signal phases in which this connector has green. Empty for non-signalised control. */
  greenPhases: number[];
  /** On a roundabout: where this movement joins and leaves the ring. */
  ring?: RingSpan;
  /**
   * Stretches of ring this movement shares with another (from different entry lanes): between `from`
   * and `to` along this connector, the other connector's position is `s + offset`. Vehicles there
   * follow each other like cars in one lane.
   */
  ringShares: Array<{ other: number; from: number; to: number; offset: number }>;
}

export interface RingSpan {
  /** Ring coordinates (arc length round the ring centreline, in the direction of travel). */
  entry: number;
  /** Arc length driven on the ring. */
  length: number;
  /** Position along the connector where the ring part begins (the entry curve's length). */
  start: number;
  /** How far before joining (along the entry curve) the car is already alongside the ring's lane. */
  joinZone: number;
  /** How far after leaving (along the exit curve) the car is still alongside the ring's lane. */
  leaveZone: number;
}

export interface RoundaboutGeometry {
  /** Radius of the circulating lane's centreline. */
  radius: number;
  ringWidth: number;
  islandRadius: number;
  outerRadius: number;
  /** +1 counter-clockwise (right-hand traffic), -1 clockwise. */
  direction: number;
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
  /** Curb returns between neighbouring legs, as polylines from one leg's edge round to the next. */
  corners: Vec2[][];
  roundabout: RoundaboutGeometry | null;
}

export const movementKey = (from: LegId, to: LegId) => `${from}>${to}`;
