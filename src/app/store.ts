import { create } from 'zustand';
import type { Scenario } from '../core/types';
import type { MetricsSnapshot } from '../sim/metrics';
import type { SignalClock } from '../sim/signals';
import { DEFAULT_SETUP, buildScenario, defaultDemand, type Setup } from '../scenarios/setup';

export type ThemeChoice = 'system' | 'light' | 'dark';

interface AppState {
  setup: Setup;
  demand: Scenario['demand'];
  /** Bumped whenever the junction layout changes, so the simulation restarts. */
  layoutVersion: number;
  playing: boolean;
  speed: number;
  metrics: MetricsSnapshot | null;
  clock: SignalClock | null;
  simTime: number;
  theme: ThemeChoice;

  updateSetup: (patch: Partial<Setup>) => void;
  setVehicleDemand: (from: string, to: string, vehPerHour: number) => void;
  setPedDemand: (leg: string, pedPerHour: number) => void;
  scaleDemand: (factor: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  restart: () => void;
  setTheme: (theme: ThemeChoice) => void;
}

export const useApp = create<AppState>((set, get) => ({
  setup: DEFAULT_SETUP,
  demand: defaultDemand(DEFAULT_SETUP),
  layoutVersion: 0,
  playing: true,
  speed: 2,
  metrics: null,
  clock: null,
  simTime: 0,
  theme: 'system',

  updateSetup: (patch) => {
    const prev = get().setup;
    const setup = { ...prev, ...patch };
    // A different shape has different legs, so the old demand table no longer fits.
    const demand = patch.shape && patch.shape !== prev.shape ? defaultDemand(setup) : get().demand;
    set({ setup, demand, layoutVersion: get().layoutVersion + 1, metrics: null });
  },
  setVehicleDemand: (from, to, vehPerHour) => {
    const vehicles = get().demand.vehicles.map((d) => (d.from === from && d.to === to ? { ...d, vehPerHour } : d));
    set({ demand: { ...get().demand, vehicles } });
  },
  setPedDemand: (leg, pedPerHour) => {
    const pedestrians = get().demand.pedestrians.map((p) => (p.leg === leg ? { ...p, pedPerHour } : p));
    set({ demand: { ...get().demand, pedestrians } });
  },
  scaleDemand: (factor) => {
    const d = get().demand;
    set({
      demand: {
        vehicles: d.vehicles.map((v) => ({ ...v, vehPerHour: Math.max(0, Math.round((v.vehPerHour * factor) / 10) * 10) })),
        pedestrians: d.pedestrians,
      },
    });
  },
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  restart: () => set({ layoutVersion: get().layoutVersion + 1, metrics: null }),
  setTheme: (theme) => set({ theme }),
}));

export const currentScenario = (s: Pick<AppState, 'setup' | 'demand'>) => buildScenario(s.setup, s.demand);
