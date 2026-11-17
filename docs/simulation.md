# How the simulation works

The engine is in [`src/sim/simulation.ts`](../src/sim/simulation.ts). It runs at a fixed 0.1 s step, in a Web Worker in the app and headless in the tests and `npm run sim`.

- **Coordinates and units.** Metres and seconds. The origin is the junction centre, with y pointing up. `driveSide` mirrors everything, including which turn is "near" and which is "far".
- **Vehicles.** Each vehicle follows a route: approach lane → connector through the junction → exit lane. It follows the car ahead using the Intelligent Driver Model.
  - *Kinds:* cars (4.5 m), trucks (10 m) and buses (12 m). Trucks and buses accelerate at about half a car's rate and keep longer gaps. The scenario's `heavyShare` sets their share (6% when not given), and a third of the heavy vehicles are buses. Truck and bus drivers know their route, so they always start in a lane that serves their turn.
  - *Drawing:* a vehicle's body runs from its front bumper's point on the route back to its rear's. On a curve it cuts inside the path, as a real vehicle's rear wheels do, rather than swinging out into the next lane.
- **Conflicts.** For each pair of connectors, the stretch where their paths come closer than a car width is a conflict, and one side of it gives way.
  - Under signals, through traffic beats near turns, which beat far turns.
  - With priority control, major-road movements come first; remaining ties go to the vehicle on the near side.
- **Entering the junction.** Near the stop line, a driver checks the signal, the room on the exit lane, conflicting traffic and pedestrians. When cleared, it *commits*.
  - *Gap acceptance:* a driver needs a gap long enough to get clear, plus a margin (0.8 s crossing, 1.2 s merging). Each driver's margin differs by up to ±0.8 s, drawn on arrival, and shrinks by up to 1 s after a minute of waiting. A truck or bus needs about a second more than a car, because it pulls away more slowly.
  - *Waiting their turn:* a driver with priority who is stopped only because someone is already crossing in front of them goes next. Drivers giving way don't slip in ahead of them, or a busy side road would starve the main road. A driver already rolling into a gap ignores this: the one waiting may be waiting for them.
  - *Merging behind:* where merging movements share a lane afterwards (round a roundabout), a driver can slot in behind a car going past once its rear has gone by, instead of waiting for it to clear the merge altogether. Once moving, they only back out if the gap has really closed.
  - Committed vehicles act as reservations: drivers with priority still respect them, and drivers who must give way ignore anyone already told to wait.
  - Under signals, turners may pull forward and wait inside the box for a gap.
- **Looking before going.** Without a light to rely on, a driver who must give way slows to about 16 km/h at the line to look, whether or not anyone is coming. That's why unsigned junctions are slow, and why priority signs help.
- **Don't block the box.** A driver won't enter the junction if a car stuck in it blocks their path. Otherwise the junction can knot itself into a gridlock that never clears.
- **Signals.**
  - *Webster timing* (`src/scenarios/timing.ts`): each phase's critical flow ratio is its busiest approach's traffic per lane over 1900 veh/h. A far-side turn across oncoming traffic counts as 1800 / (1400 − oncoming veh/h per lane) cars, three times that in a lane shared with through traffic, because everyone behind a waiting turner waits too. The cycle is (1.5 L + 5) / (1 − Y), at least 60 s when turners give way to oncoming traffic (they often only get away at the end of a green) and at most 120 s. Greens are shared in proportion to the ratios, in 5 s steps.
  - *Traffic-responsive signals* (`actuated: true`): detectors watch the last 40 m before each stop line. A green lasts at least 6 s. It ends early (gaps out) once no car will reach the line within 3 s and no pedestrian is waiting for this walk, provided someone is waiting at a red. It ends at the plan's green (maxes out) only if someone is waiting, and otherwise rests on green.
  - A controller runs the plan phase by phase: green, amber (3 s), all-red (2 s).
  - When the plan is edited it keeps its place. Lengthening a green extends the green that is showing; cutting it shorter than it has already shown ends it at once. Lights never jump mid-flow.
  - Cars arriving on green with no queue cross at about 95% of the speed limit.
  - A queue discharges at about 1870 veh/h of green per lane, so a longer green carries more cars once traffic is saturated.
- **Pedestrians.** On a zebra, pedestrians have priority. On a signalised crossing, they walk only during their phase. Either way, they never step in front of a vehicle that can no longer stop.
  - Drivers wait for pedestrians near their own path, within 3 m or reaching it within 2 s. They don't wait for someone far across the road or at the far kerb: they're past before that person gets there.
  - Before entering, a driver only checks the crossing in front of them. A crossing at the far side of the junction is dealt with on reaching it, as long as there's room to wait short of it.
  - A vehicle whose front has left the junction while its rear is still on a crossing still blocks that crossing.
- **Turn paths.** Each turn is a straight run, a circular arc, then another straight run. Right turns (left turns in left-hand traffic) follow the curb return, so they keep their lane's distance from the curb. A test checks that every path stays on the asphalt.
- **Calibration.** `tests/realism.test.ts` holds the model to standard results, and `npm run calibrate` prints the comparison:

  | Check | Reference | Simulated |
  |---|---|---|
  | Saturation flow, one lane, 6% heavy vehicles | 1900 veh/h of green (HCM base, before the heavy-vehicle factor) | about 1845 |
  | Delay at a two-phase signal | Webster's formula | within about 2 s |
  | One-lane roundabout entry, 0 / 300 / 600 veh/h going round | HCM 6: 1380, 1016, 748 | about 1330, 960, 670 |
  | Side road across a two-way main road, 600 / 1200 veh/h | gap acceptance, tc 5.5 s, tf 3.3 s: 567, 288 | about 650, 285 |

  A side road also stays within 25% of theory at lighter main-road traffic, and the main road keeps flowing (2–3 s delay) however busy the side road is.
- **Turn pockets and lane arrows.**
  - A *turn pocket* (`turnPocket` on a leg) is an extra lane beside the median that opens 40 m before the stop line and takes the far-side turns and U-turns. Its lane runs the whole length of the leg so positions line up with the lanes beside it, but before it opens it's painted-over median. Turners drive up in the lane beside it and move over once it has opened alongside them. If it's full to its mouth, they wait there and block that lane, as an overflowing pocket does in real life. There are no pockets at roundabouts.
  - *Lane arrows* (`laneTurns` on a leg) say which kinds of turn each inbound lane serves. If they leave a turn without a lane, or no longer match the number of lanes, the turns are shared out automatically.
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
  - *U-turns:* only on a roundabout, where drivers go almost all the way round and leave on the leg they came in on. They use the inside approach lane, alongside the far turn, without changing how the other turns share the lanes. Without a roundabout, U-turn trips count as diverted, like a banned turn.
  - *Capacity:* about 1650 veh/h, in line with published figures for one-lane roundabouts.
- **Roundabouts with traffic lights** (the Turkish style, as at Kızılay or Tandoğan). The control is a signal plan with `ring: true`.
  - *Lights:* each phase gives green to whole entries. A second stop line sits on the ring just before each entry, far enough back that cars held there are clear of everyone entering. A ring light is red while its entry has green, shows amber then red just before the entry gets green, and is green the rest of the time.
  - *Two ring lanes:* drivers going round the island (far-side turns and U-turns) use the inner lane, and everyone else the outer one, so left turners waiting at a ring light don't block traffic leaving at the next exit. Where the lanes cross, whoever is joining or leaving the ring gives way to traffic going round.
  - *Size:* the ring is at least 40 m in radius, so there's room to queue between the lights.
  - *Full ring:* drivers don't enter when the queue ahead on the ring reaches back to their entry; otherwise the ring can fill all the way round and lock. If an entry has green in every phase, the light before it never turns green and the ring locks, and the signal plan warns about it.
  - *Performance:* with balanced traffic and one-lane approaches it is slower than a plain roundabout or plain signals, because left turners stop at a light on the ring as well as on the approach. Its strengths are signalised pedestrian crossings and giving each entry a fair share when one road dominates.
- **Slip lanes and flyovers.**
  - A slip lane is an extra curb lane that peels off before the junction, curves around a corner island, and joins the next road as an added lane. It ignores the signals.
  - A flyover gives straight-through traffic its own lane on a bridge. Bridge traffic never conflicts with traffic or pedestrians below.
- **Live editing.** `Simulation.applyScenario` swaps in an edited layout under running traffic.
  - Vehicles keep their place: on an approach they keep their distance from the far end, inside the junction their progress through the turn, and on an exit their distance to the map edge.
  - Drivers whose turn is gone take the closest allowed exit. New trips for a banned turn are counted as *diverted*.
- **Delay.** Lost time is accumulated as it happens: below free speed, or waiting to enter the map. It's divided by the number of trips that started in the window. A queue that hasn't cleared still counts, and after an edit only trips that started under the new design count.
- **Other measures.**
  - *Level of service:* graded from average delay with the HCM thresholds, for the whole junction and for each approach.
  - *Stops:* a stop is coming to a halt. A driver must get back above 3 m/s before the next halt counts. Waiting to get onto the map counts as one.
  - *95th-percentile queue:* sampled once a second on each approach.
  - *CO₂:* from a power-based fuel model after Akçelik. Fuel is burnt idling, against rolling and air resistance, and accelerating, with separate figures for cars, trucks and buses. It's meant for comparing designs, not for an emissions inventory.
- **Gridlock and overload.** Two separate things.
  - *Gridlock* means the junction has knotted up: drivers are inside it, or waiting at a green, and yet nobody has entered or left it for 60 s. Waiting at a red doesn't count. A run that gridlocks at any point fails a level.
  - *Overload* means more traffic arrives than the junction can serve, and queues spill off the map (more than 25 vehicles waiting to enter on one leg). It isn't a failure by itself: the waiting already shows up as delay.
- **Peak hour factor.** Real traffic surges inside its busiest hour. The *Peak hour* pattern has a peak hour factor of about 0.9: the busiest hour divided by four times its busiest 15 minutes. The demand panel shows each pattern's factor.
- **Traffic through the day.** Each traffic stream proposes arrivals at its peak rate, and each proposal is kept with probability (rate now ÷ peak rate). This is Poisson thinning. The proposals never depend on the design, so fair tests still see identical traffic, and jumping the clock needs no rescheduling.
- **Determinism and fair comparisons.** The same scenario and seed always play out identically.
  - Every traffic flow (each origin–destination pair, each crossing) has its own random stream.
  - A vehicle's size and temperament are drawn when it arrives, not when it gets onto the map.
  - So two *different* designs run with the same seed see exactly the same cars at the same moments ("common random numbers"). That makes run-by-run differences a clean measure of the design.
