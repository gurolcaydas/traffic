# AGENTS.md

Notes for AI coding agents (and people) working on this repo. [README.md](README.md) covers what the app is and what it does. The traffic model is described in [docs/simulation.md](docs/simulation.md). This file covers how to change things without breaking them.

## Commands

```bash
npm install
npm run dev        # app at http://localhost:5173
npm test           # Vitest; the simulation and level tests take a minute or so
npm run typecheck
npm run sim        # sample junctions run headless, metrics printed
```

Run `npm run typecheck` and `npm test` before calling a change done. For UI changes, also look at the app in a browser, in both light and dark mode, in both EN and TR, and at phone width.

## Architecture in one paragraph

Everything starts from a **`Scenario`** ([src/core/types.ts](src/core/types.ts)), a plain JSON description of a junction: its legs, lanes, control, crosswalks and traffic demand.
- [src/network/](src/network/) turns a Scenario into a drivable network: lanes, connectors (turn paths), conflicts and roundabout geometry.
- [src/sim/simulation.ts](src/sim/simulation.ts) moves vehicles and pedestrians over that network at a fixed 0.1 s step.
- In the app, the simulation runs in a Web Worker ([src/app/sim.worker.ts](src/app/sim.worker.ts), messages in [src/app/protocol.ts](src/app/protocol.ts)). It streams typed-array frames to the PixiJS renderer ([src/render/](src/render/)).
- React plus a Zustand store ([src/app/store.ts](src/app/store.ts)) handle only the sidebar and controls, never per-frame drawing.
- Fair tests and level scoring run many headless simulations ([src/sim/evaluate.ts](src/sim/evaluate.ts)) over a pool of workers ([src/app/eval.worker.ts](src/app/eval.worker.ts)).

## Rules that keep things working

- **The Scenario is the single source of truth.** Player edits are plain functions that change a Scenario ([src/scenarios/edit.ts](src/scenarios/edit.ts), [shape.ts](src/scenarios/shape.ts)). The network is always rebuilt from the Scenario; never patch the network directly. `Scenario.version` is 1, and saved designs (`traffic.designs.v1` in localStorage) and exported `.traffic.json` files rely on it. If you change the format, keep old files loading.
- **Determinism matters.** The same scenario and seed must play out identically. Fair tests rely on "common random numbers": each traffic stream draws from its own seeded generator ([src/core/rng.ts](src/core/rng.ts)), and a vehicle's properties are drawn when it arrives.
  - Never use `Math.random()` or wall-clock time in `src/sim`, `src/network` or `src/scenarios`.
  - Never make a draw depend on the design, for example drawing only for vehicles that reach the map.
- **Edits apply under running traffic.** `Simulation.applyScenario` remaps live vehicles onto the new network. Any new feature that changes the network needs a remap story, and a test that edits mid-run and checks the vehicle bookkeeping: `arrived = exited + onMap + backlog + diverted + removed`.
- **Both drive sides.** `driveSide: 'left'` mirrors everything. New geometry or turn rules must work in both. Think in "near side" and "far side" turns, and derive the direction from the drive side (as `side` does in [src/network/build.ts](src/network/build.ts)). Never hard-code left or right.
- **The levels are calibrated.** [src/game/levels.ts](src/game/levels.ts) sets star thresholds against the current simulation. The tests in `tests/game.test.ts` check that each level fails as given and that the known solutions pass. If a simulation change breaks them, re-check the calibration (run every level's starting design) before you loosen a test.
- **Gridlock and overload are different things.**
  - Gridlock: nobody has entered or left the junction for 60 s while drivers could go. It fails a level.
  - Overload: queues are spilling off the map. That only shows up as delay.
  
  Don't merge the two again.

## Conventions

- **TypeScript strict** with `noUncheckedIndexedAccess`. Indexed reads use `!` where the index is known to be valid. Don't add `any`.
- **No Prettier or ESLint.** Match the surrounding code: 2-space indent, single quotes, semicolons, lines up to about 140 characters.
- **Comments** explain *why* in plain sentences, and many constants carry a one-line `/** ... */`. Keep that density. Comments and UI text use British spelling (metres, colour, centre, signalised).
- **Units** are metres, seconds and m/s inside the simulation. Demand is vehicles/hour and pedestrians/hour.
- **Tests** live in `tests/*.test.ts` (Vitest, Node environment) and name behaviour in plain English: `it('does not call waiting at a red gridlock', ...)`. Simulation tests build scenarios with `crossroad()` / `twoPhaseSignals()` from [src/scenarios/templates.ts](src/scenarios/templates.ts) and use fixed seeds.

## Translations (EN / TR)

All user-visible text goes through `t(english, turkish)` from [src/core/i18n.ts](src/core/i18n.ts), written inline where the text is used:

```ts
<h2>{t('Signal plan', 'Sinyal planı')}</h2>
```

- **Text defined once at module load** must be a getter or a function, or it gets stuck in the language it was first read in. This applies to level titles, pattern labels, shape names and test plans:

  ```ts
  get title() { return t('Main street', 'Ana cadde'); }
  ```
- **Switching language** re-renders the whole tree: `App` subscribes with `useSyncExternalStore`. Don't wrap components in `React.memo` without handling this.
- **Tests run in English**, because `window` is undefined in Node. `tests/i18n.test.ts` switches to Turkish and resets in `afterEach`.
- **Turkish glossary**, which keeps terms consistent:

  | English | Turkish |
  |---|---|
  | leg / road | yol |
  | lane | şerit |
  | junction | kavşak |
  | roundabout | dönel kavşak |
  | traffic lights | trafik ışıkları / ışıklar |
  | yield to right | sağdan gelen |
  | major road | ana yol |
  | zebra | çizgili |
  | signalised crossing | ışıklı |
  | side road | serbest dönüş yolu |
  | flyover | üst geçit |
  | phase | faz |
  | cycle | devre |
  | level | bölüm |
  | sandbox | serbest mod |
  | fair test | adil test |
  | gridlock | kilitlenme |
  | veh/h | araç/sa |
  | budget | bütçe |

## UI

- Colours are CSS custom properties in [src/app/styles.css](src/app/styles.css), with a light and a dark theme. Use the tokens; don't hard-code colours.
- Anything that replaces the current design (a template, a level, an import, a saved design) goes through the store's replace flow, which asks first if there are unsaved changes.
- localStorage keys: `traffic.lang`, `traffic.designs.v1`, `traffic.progress.v1`. Wrap storage access in `try/catch`, because it can throw in private windows.

## OpenStreetMap import

[src/osm/api.ts](src/osm/api.ts) uses Nominatim for search and Overpass for roads, with fallback servers. Be polite to these free services:
- one request per user action
- no background polling
- keep the ODbL attribution visible

Tests for the conversion ([tests/osm.test.ts](tests/osm.test.ts)) use fixture data, not the network.

## Status and roadmap

Done:
- core simulation
- sandbox with live editing
- roundabouts
- puzzle levels with costs and stars
- shape editor, templates and saved designs
- OpenStreetMap import
- English and Turkish

Ideas not started:
- **Sharing a design by link** (the planned Phase 6): a compressed scenario in the URL hash, with no server
- **Undo/redo**
- **Traffic-responsive signals** and automatic signal timing (Webster)
- **Two-lane roundabouts**
- **Trucks and buses**
- **Splitting `simulation.ts`** into lane changing, priority and pedestrians
- **Checking the zebra rule:** even 300 pedestrians/h per crossing halves an uncontrolled crossroad's flow, which may be too strict
