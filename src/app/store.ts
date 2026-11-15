import { create } from 'zustand';
import type { Scenario } from '../core/types';
import type { MetricsSnapshot } from '../sim/metrics';
import type { SignalClock } from '../sim/signals';
import { DEFAULT_SETUP, buildScenario, defaultDemand, type Setup } from '../scenarios/setup';

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Metrics captured just before an edit, to compare the new design against. */
export interface Baseline {
  label: string;
  metrics: MetricsSnapshot;
}

/** Below this much measured time a snapshot is too noisy to compare against. */
const MIN_BASELINE_WINDOW = 60;

interface AppState {
  /** The junction being played. Everything else is derived from it. */
  scenario: Scenario;
  /** Bumped for a brand-new junction: the traffic restarts. */
  layoutVersion: number;
  /** Bumped for an edit: the running simulation swaps in the new layout. */
  editVersion: number;
  selectedLeg: string | null;
  baseline: Baseline | null;
  lastEdit: string | null;
  playing: boolean;
  speed: number;
  metrics: MetricsSnapshot | null;
  clock: SignalClock | null;
  simTime: number;
  theme: ThemeChoice;

  newJunction: (patch: Partial<Setup>) => void;
  /** Change the layout while traffic keeps running. `label` describes the change for the comparison card. */
  edit: (label: string, change: (draft: Scenario) => void) => void;
  setVehicleDemand: (from: string, to: string, vehPerHour: number) => void;
  setPedDemand: (leg: string, pedPerHour: number) => void;
  scaleDemand: (factor: number) => void;
  selectLeg: (leg: string | null) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  restart: () => void;
  setTheme: (theme: ThemeChoice) => void;
}

let setup: Setup = DEFAULT_SETUP;

export const useApp = create<AppState>((set, get) => ({
  scenario: buildScenario(DEFAULT_SETUP, defaultDemand(DEFAULT_SETUP)),
  layoutVersion: 0,
  editVersion: 0,
  selectedLeg: null,
  baseline: null,
  lastEdit: null,
  playing: true,
  speed: 2,
  metrics: null,
  clock: null,
  simTime: 0,
  theme: 'system',

  newJunction: (patch) => {
    const shapeChanged = patch.shape !== undefined && patch.shape !== setup.shape;
    setup = { ...setup, ...patch };
    const demand = shapeChanged ? defaultDemand(setup) : get().scenario.demand;
    set({
      scenario: buildScenario(setup, demand),
      layoutVersion: get().layoutVersion + 1,
      selectedLeg: null,
      baseline: null,
      lastEdit: null,
      metrics: null,
    });
  },
  edit: (label, change) => {
    const draft = structuredClone(get().scenario);
    change(draft);
    const m = get().metrics;
    // Keep the older baseline if the last change hasn't run long enough to judge.
    const baseline = m && m.window >= MIN_BASELINE_WINDOW ? { label: get().lastEdit ?? 'Before', metrics: m } : get().baseline;
    set({ scenario: draft, editVersion: get().editVersion + 1, baseline, lastEdit: label, metrics: null });
  },
  setVehicleDemand: (from, to, vehPerHour) => {
    const s = get().scenario;
    const vehicles = s.demand.vehicles.some((d) => d.from === from && d.to === to)
      ? s.demand.vehicles.map((d) => (d.from === from && d.to === to ? { ...d, vehPerHour } : d))
      : [...s.demand.vehicles, { from, to, vehPerHour }];
    set({ scenario: { ...s, demand: { ...s.demand, vehicles } } });
  },
  setPedDemand: (leg, pedPerHour) => {
    const s = get().scenario;
    const pedestrians = s.demand.pedestrians.some((p) => p.leg === leg)
      ? s.demand.pedestrians.map((p) => (p.leg === leg ? { ...p, pedPerHour } : p))
      : [...s.demand.pedestrians, { leg, pedPerHour }];
    set({ scenario: { ...s, demand: { ...s.demand, pedestrians } } });
  },
  scaleDemand: (factor) => {
    const s = get().scenario;
    const vehicles = s.demand.vehicles.map((v) => ({ ...v, vehPerHour: Math.max(0, Math.round((v.vehPerHour * factor) / 10) * 10) }));
    set({ scenario: { ...s, demand: { ...s.demand, vehicles } } });
  },
  selectLeg: (leg) => set({ selectedLeg: leg }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  restart: () => set({ layoutVersion: get().layoutVersion + 1, metrics: null, baseline: null, lastEdit: null }),
  setTheme: (theme) => set({ theme }),
}));

export const currentSetup = () => setup;
