import type { Simulation, Vehicle } from './simulation';

/** Car body approximated by two circles along its axis; touching circles mean a collision. */
const BODY_RADIUS = 0.85;

/** Pairs of vehicles (on different paths) whose bodies overlap right now. Used by tests and the debug overlay. */
export function overlappingVehicles(sim: Simulation): Array<[Vehicle, Vehicle]> {
  const bodies = sim.vehicles.map((veh) => {
    const { x, y, heading } = sim.pose(veh);
    const off = veh.length / 2 - BODY_RADIUS;
    const cx = Math.cos(heading) * off;
    const cy = Math.sin(heading) * off;
    return { veh, x, y, circles: [{ x: x + cx, y: y + cy }, { x: x - cx, y: y - cy }] };
  });
  const out: Array<[Vehicle, Vehicle]> = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      // One on the bridge, one underneath.
      if (sim.network.connectors[a.veh.connector]!.level !== sim.network.connectors[b.veh.connector]!.level) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) > 12) continue;
      const touch = a.circles.some((p) => b.circles.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 2 * BODY_RADIUS));
      if (touch) out.push([a.veh, b.veh]);
    }
  }
  return out;
}

/** Pedestrians currently overlapping a vehicle body. */
export function pedestrianStrikes(sim: Simulation): number {
  let n = 0;
  for (const ped of sim.pedestrians) {
    if (!ped.crossing) continue;
    const p = sim.pedestrianPosition(ped);
    for (const veh of sim.vehicles) {
      if (sim.network.connectors[veh.connector]!.level !== 0) continue; // overhead on the bridge
      const { x, y, heading } = sim.pose(veh);
      // Project the pedestrian into the vehicle's frame.
      const dx = p.x - x;
      const dy = p.y - y;
      const along = dx * Math.cos(heading) + dy * Math.sin(heading);
      const across = -dx * Math.sin(heading) + dy * Math.cos(heading);
      if (Math.abs(along) < veh.length / 2 + 0.3 && Math.abs(across) < 1.2) n++;
    }
  }
  return n;
}
