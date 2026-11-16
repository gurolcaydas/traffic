# traffic

A game-like traffic puzzle: you get a junction with a traffic jam and fix it by adding signals,
lanes, roundabouts, bridges or crossings, while the traffic keeps moving.

**Status: Phase 3.** There are six puzzle levels plus the sandbox. Open **★ Levels** to play them.

- Each level gives you a jammed junction, a budget and some limits: shops that block widening, a building on a corner, crossings that must stay.
- **Submit design** runs your design four times on the level's fixed traffic and awards up to three stars for average delay. Any gridlock fails.
- Additions cost money: lanes 40, signals 120, roundabout 300, side road 150, flyover 600, crossings 20 or 60, turn bans 5, priority signs 10. Removing things and retiming lights is free.
- Banned turns count as a 90 s detour, so bans are a trade-off, not a free win.
- Best stars are saved in your browser, and each level unlocks when the previous one has a star.

**The sidebar** follows the order you work in: **Start** (shape template, drive side, or a real junction from the map), **Junction** and **Signal plan** (design), **Traffic**, then the results (**How it's flowing**, **Fair test**) and **My designs**. Anything that replaces the design asks first if it has unsaved changes, and offers to save it. The A–F badge in the top bar keeps the level of service in sight; click it for details.

**Phase 5: real junctions.** In the sandbox, **Import a real junction from the map** finds a place by name (Nominatim), coordinates or an openstreetmap.org link, reads the roads around it from OpenStreetMap (Overpass, with two fallback servers), and shows a preview before opening it:

- road names, types, lane counts and one-way streets; the two halves of a divided road become one leg
- traffic lights, roundabouts, or priority for the main road; pedestrian crossings near the junction
- the side of the road people drive on, from the location
- traffic volumes are estimated from road types, so adjust them in the Traffic table
- up to six roads (the most important ones), at most three lanes each way

Map data © OpenStreetMap contributors, ODbL. Nothing is sent until you press Find.

**Phase 4: your own junctions.** In the sandbox:

- **Edit shape** lets you drag a road's handle to turn it, press **+** to add a road in any gap wide enough, **×** to remove one, **−**/**+** to set its lanes in and out (up to 4 each way), or **🚶** on a road to step its crossing through none → zebra → with lights. Junctions have 2–6 roads, kept at least 30° apart, and every change applies under running traffic.
- **Pedestrians** and **Traffic lights** switches turn either on or off in one click, and switching back restores what was there (a zebra becomes a crossing with lights when the lights go on, and back).
- **Start over** offers six templates: crossroad, skewed, T, Y, 5-way, 6-way.
- **My designs** saves designs in your browser, and can export one to a `.traffic.json` file or import it again on another computer.

**Earlier phases (2a and up):** There's a sandbox you can edit while the traffic runs:

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

**Roundabouts (Phase 2b)** are a fourth control option, switchable live. They're one-lane roundabouts: entering traffic gives way to traffic already on the ring. Side roads and flyovers work with them too.

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
| `src/network/roundabout.ts` | Roundabout geometry (ring size, tangent entry and exit curves, flared curbs) and the ring's rules. |
| `src/game/` | Levels (`levels.ts`), what designs cost (`costs.ts`) and how they're scored (`score.ts`). |
| `src/scenarios/shape.ts`, `storage.ts` | Adding, turning and removing roads (keeping the scenario consistent), and saving, exporting and importing designs. |
| `src/osm/` | OpenStreetMap import: `api.ts` finds places and fetches roads, `convert.ts` turns the roads around a point into a Scenario. |
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
- **Looking before going.** Without a light to rely on, a driver who must give way slows to about 16 km/h at the line to look, whether or not anyone is coming. That's why unsigned junctions are slow, and why priority signs help.
- **Don't block the box.** A driver won't enter the junction if a car stuck in it blocks their path. Otherwise the junction can knot itself into a gridlock that never clears.
- **Signals.**
  - A controller runs the plan phase by phase: green, amber (3 s), all-red (2 s).
  - When the plan is edited it keeps its place. Lengthening a green extends the green that is showing; cutting it shorter than it has already shown ends it at once. Lights never jump mid-flow.
  - Cars arriving on green with no queue cross at about 95% of the speed limit.
  - A queue discharges at about 1870 veh/h of green per lane, so a longer green carries more cars once traffic is saturated.
- **Pedestrians.** On a zebra, pedestrians have priority. On a signalised crossing, they walk only during their phase. Either way, they never step in front of a vehicle that can no longer stop.
- **Turn paths.** Each turn is a straight run, a circular arc, then another straight run. Right turns (left turns in left-hand traffic) follow the curb return, so they keep their lane's distance from the curb. A test checks that every path stays on the asphalt.
- **Calibration.** A single lane discharges about 1900 veh/h. Signal delays track Webster's formula, and a typical permissive junction gives LOS C at 200 veh/h per leg.
- **Lane changing (MOBIL).** On an approach, drivers check every half second whether to move one lane over.
  - *By choice:* if the next lane would let them accelerate at least 0.3 m/s² more, after subtracting 0.3 × what the car they cut in front of would lose.
  - *By need:* about a quarter of drivers enter in whichever lane has room and must cross to a lane that serves their turn. Within 40 m of the line they accept tighter gaps, and the driver behind lets them in (zipper merge). Someone stuck for 45 s takes a turn their lane allows ("missed turn").
  - *Safety:* a change is never allowed if the changer or its new follower would have to brake harder than 4 m/s².
  - *Where:* no changes by choice in the solid-line zone before the stop line, nor in the first 30 m after entering the map.
  - *Motion:* each change slides sideways over 3 s, and the car keeps blocking its old lane until it's mostly across.
- **Roundabouts.** Each movement is one path: an entry curve, an arc round the ring, an exit curve.
  - *Geometry:* entry and exit curves are circular arcs tangent to both the lane and the ring, so traffic keeps ring speed (about 23 km/h) instead of crawling. Curbs flare along the same curves.
  - *Ring size:* the ring is the smallest one on which every entry joins well before the next leg's exit leaves.
  - *Rules from structure, not proximity:* movements that share a stretch of ring follow each other like cars in one lane. A movement joining the ring gives way to everyone already circulating past that point, from where it first comes alongside the ring.
  - *One lane:* several approach lanes enter single file, and all exits use the curb lane.
  - *Capacity:* about 1650 veh/h, in line with published figures for one-lane roundabouts.
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
