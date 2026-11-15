# traffic

A game-like traffic puzzle: you get a junction with a traffic jam and fix it by adding signals,
lanes, roundabouts, bridges or crossings, while the traffic keeps moving.

**Status: Phase 2a.** There's a sandbox you can edit while the traffic runs:

- signals and the full signal plan
- lanes per leg
- turn bans
- slip lanes
- pedestrian crossings
- flyovers

A before/after card compares the design with how it was before your last change.

The **Fair test** gives a reliable verdict. It runs the current design and a reference design (before the last change, the original, or a pinned design) on *exactly the same traffic*, several times with different random traffic. It then reports each difference with a 95% confidence interval.

**Traffic through the day.** Choose a pattern:

- commuter day
- school run
- evening event
- weekend

The demand table then counts as the peak hour, and the pattern scales it hour by hour. Commuter, school and event patterns are *tidal*: they send traffic towards a chosen leg (town centre, school or venue) at one time of day and away from it at another.

The sidebar shows the day as a chart: click it to jump the clock. The metrics include the **worst 15 minutes**, and the fair test can cover the busiest 3 hours or the whole day.

Roundabouts are next (Phase 2b).

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
| `src/scenarios/patterns.ts` | Time-of-day patterns, tidal flows, and the maths to look a factor up for any hour. |
| `src/sim/evaluate.ts` | Headless test runs and paired statistics for the fair test. `src/app/eval.worker.ts` and `fairTest.ts` spread the runs over a pool of workers. |
| `src/scenarios/edit.ts` | The edits a player can make (control, lanes, crossings, bans, flyovers, signal phases and presets), as plain functions on a Scenario. |
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
- **Slip lanes and flyovers.**
  - A slip lane is an extra curb lane that peels off before the junction, curves around a corner island, and joins the next road as an added lane. It ignores the signals.
  - A flyover gives straight-through traffic its own lane on a bridge. Bridge traffic never conflicts with traffic or pedestrians below.
- **Live editing.** `Simulation.applyScenario` swaps in an edited layout under running traffic.
  - Vehicles keep their place: on an approach they keep their distance from the far end, inside the junction their progress through the turn, and on an exit their distance to the map edge.
  - Drivers whose turn is gone take the closest allowed exit. New trips for a banned turn are counted as *diverted*.
- **Delay.** Lost time is accumulated as it happens: below free speed, or waiting to enter the map. It's divided by the number of trips that started in the window. A queue that hasn't cleared still counts, and after an edit only trips that started under the new design count.
- **Traffic through the day.** Each traffic stream proposes arrivals at its peak rate, and each proposal is kept with probability (rate now ÷ peak rate). This is Poisson thinning. The proposals never depend on the design, so fair tests still see identical traffic, and jumping the clock needs no rescheduling.
- **Determinism and fair comparisons.** The same scenario and seed always play out identically.
  - Every traffic flow (each origin–destination pair, each crossing) has its own random stream.
  - A vehicle's size and temperament are drawn when it arrives, not when it gets onto the map.
  - So two *different* designs run with the same seed see exactly the same cars at the same moments ("common random numbers"). That makes run-by-run differences a clean measure of the design.
