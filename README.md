# traffic

A game-like traffic puzzle: you get a junction with a traffic jam and fix it by adding signals,
lanes, roundabouts, bridges or crossings, while the traffic keeps moving.

**Status: Phase 1.** There's a sandbox: an animated top-view junction, a live demand table and live metrics. Changing the junction layout restarts the traffic; live structural editing comes in Phase 2.

## Commands

```bash
npm run dev       # the sandbox app at http://localhost:5173
npm run build
npm test          # unit + simulation tests
npm run typecheck
npm run sim       # play the sample scenarios headless and print metrics (npm run sim -- 30 for 30 minutes)
```

## Layout

| Path | What |
|---|---|
| `src/core/types.ts` | **Scenario format**: the JSON that describes a junction, its demand (veh/h, ped/h) and control. Everything else derives from it. |
| `src/core/geometry.ts`, `rng.ts` | Polylines with arc length, Bezier curves, intersections; seeded random generator. |
| `src/network/` | Turns a Scenario into a drivable network: lanes, connectors (turn paths), conflict stretches with right of way, crosswalks. |
| `src/sim/simulation.ts` | The engine: vehicles (IDM car-following), gap acceptance, signals, pedestrians. Fixed 0.1 s step. |
| `src/sim/metrics.ts` | Queues, delay, throughput, Level of Service A–F, gridlock flag (what the game scores on). |
| `src/sim/safety.ts` | Collision checks used by the tests. |
| `src/scenarios/templates.ts`, `setup.ts` | Parametric junctions, and the sandbox's choices (shape, lanes, control, crossings, drive side) turned into a Scenario, including an automatic signal plan. |
| `src/app/` | React UI: the sidebar panels, the store (Zustand), and `sim.worker.ts`, which runs the simulation off the main thread and streams frames back. |
| `src/render/` | PixiJS renderer: asphalt, curbs and markings drawn once, then signals, vehicles and pedestrians every frame, interpolated between simulation frames. |

## How the simulation works

- **Coordinates and units.** Metres and seconds. The origin is the junction centre, with y pointing up. `driveSide` mirrors everything, including which turn is "near" and which is "far".
- **Vehicles.** Each vehicle follows a route: approach lane → connector through the junction → exit lane. It follows the car ahead using the Intelligent Driver Model.
- **Conflicts.** For each pair of connectors, the stretch where their paths come closer than a car width is a conflict, and one side of it gives way.
  - Under signals, through traffic beats near turns, which beat far turns.
  - With priority control, major-road movements come first; remaining ties go to the vehicle on the near side.
- **Entering the junction.** Near the stop line, a driver checks the signal, the room on the exit lane, conflicting traffic and pedestrians. When cleared, it *commits*.
  - Committed vehicles act as reservations: drivers with priority still respect them, and drivers who must give way ignore anyone already told to wait.
  - Under signals, turners may pull forward and wait inside the box for a gap.
- **Pedestrians.** On a zebra, pedestrians have priority. On a signalised crossing, they walk only during their phase. Either way, they never step in front of a vehicle that can no longer stop.
- **Turn paths.** Each turn is a straight run, a circular arc, then another straight run. Right turns (left turns in left-hand traffic) follow the curb return, so they keep their lane's distance from the curb. A test checks that every path stays on the asphalt.
- **Calibration.** A single lane discharges about 1900 veh/h. Signal delays track Webster's formula, and a typical permissive junction gives LOS C at 200 veh/h per leg.
- **Determinism.** The same scenario and seed always play out identically.
