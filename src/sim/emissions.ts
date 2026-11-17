// A rough fuel and CO₂ model, after Akçelik's power-based model: fuel goes on idling, on overcoming
// rolling and air resistance, and on accelerating. Good for comparing designs (stop-start traffic burns
// more), not for an inventory.
import type { VehicleKind } from './kinematics';

interface FuelParams {
  /** Idle fuel rate, mL/s. */
  idle: number;
  /** Fuel per unit of tractive energy, mL/kJ. */
  perKj: number;
  /** Mass, kg. */
  mass: number;
  /** Rolling resistance, kN, and air resistance, kN per (m/s)². */
  rolling: number;
  drag: number;
  /** CO₂ per mL of fuel, g (petrol for cars, diesel for heavy vehicles). */
  co2PerMl: number;
}

const FUEL: Record<VehicleKind, FuelParams> = {
  car: { idle: 0.375, perKj: 0.09, mass: 1400, rolling: 0.333, drag: 0.00108, co2PerMl: 2.3 },
  truck: { idle: 0.8, perKj: 0.075, mass: 11000, rolling: 1.6, drag: 0.004, co2PerMl: 2.65 },
  bus: { idle: 0.8, perKj: 0.075, mass: 13000, rolling: 1.8, drag: 0.005, co2PerMl: 2.65 },
};

/** CO₂ emitted, grams per second, by a vehicle at speed v (m/s) accelerating at a (m/s²). */
export function co2Rate(kind: VehicleKind, v: number, a: number): number {
  const f = FUEL[kind];
  const force = f.rolling + f.drag * v * v + (f.mass * a) / 1000;
  const power = Math.max(0, force * v);
  return (f.idle + f.perKj * power) * f.co2PerMl;
}
