import { create } from 'zustand';
import { t } from '../core/i18n';
import type { Scenario } from '../core/types';
import type { MetricsSnapshot } from '../sim/metrics';
import type { TrendSample } from '../sim/simulation';
import type { SignalClock } from '../sim/signals';
import { DEFAULT_SETUP, buildScenario, defaultDemand, type Setup } from '../scenarios/setup';
import { PATTERNS } from '../scenarios/patterns';
import { levelById } from '../game/levels';
import type { LevelResult } from '../game/types';

export type Mode = { kind: 'sandbox' } | { kind: 'level'; levelId: string };

const PROGRESS_KEY = 'traffic.progress.v1';

/** Best stars per level. Kept in this browser only; private windows may not keep it. */
function loadProgress(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function saveProgress(progress: Record<string, number>) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Storage unavailable (private mode, blocked): progress just won't survive a reload.
  }
}

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Metrics captured just before an edit, to compare the new design against. */
export interface Baseline {
  label: string;
  metrics: MetricsSnapshot;
}

/** Below this much measured time a snapshot is too noisy to compare against. */
const MIN_BASELINE_WINDOW = 60;

interface AppState {
  mode: Mode;
  /** Result of the latest level submission. */
  levelResult: LevelResult | null;
  /** Best stars per level id. */
  progress: Record<string, number>;
  showLevels: boolean;
  /** On-map shape editing (sandbox only). */
  editShape: boolean;
  /** The junction being played. Everything else is derived from it. */
  scenario: Scenario;
  /** Designs the fair test can compare against: as first built, just before the latest edit, or pinned. */
  originalDesign: Scenario;
  /** The design as last saved, so leaving it unchanged since needs no warning. */
  savedDesign: Scenario | null;
  /** Something that would replace the sandbox design, waiting for the player to confirm. */
  pendingReplace: { what: string; run: () => void } | null;
  designBeforeLastEdit: Scenario | null;
  pinnedDesign: { scenario: Scenario; label: string } | null;
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
  /** Recent queue and delay samples for the live trend chart, oldest first. */
  trend: TrendSample[];
  clock: SignalClock | null;
  simTime: number;
  /** Clock time in hours while a demand pattern is active. */
  timeOfDay: number | null;
  /** A pending request to jump the clock; `n` makes repeated jumps to the same hour distinct. */
  clockJump: { hour: number; n: number } | null;
  theme: ThemeChoice;

  newJunction: (patch: Partial<Setup>) => void;
  /** Run `run` (which replaces the design) now, or first ask if the sandbox design has unsaved changes. */
  askReplace: (what: string, run: () => void) => void;
  closeReplace: () => void;
  markSaved: () => void;
  startLevel: (id: string) => void;
  playSandbox: () => void;
  /** Open a saved or imported design in the sandbox (the traffic restarts). */
  loadDesign: (scenario: Scenario) => void;
  setShowLevels: (show: boolean) => void;
  setEditShape: (on: boolean) => void;
  recordResult: (result: LevelResult) => void;
  /** Change the layout while traffic keeps running. `label` describes the change for the comparison card. */
  edit: (label: string, change: (draft: Scenario) => void) => void;
  setVehicleDemand: (from: string, to: string, vehPerHour: number) => void;
  setPedDemand: (leg: string, pedPerHour: number) => void;
  scaleDemand: (factor: number) => void;
  /** Share of vehicles that are trucks or buses. */
  setHeavyShare: (share: number) => void;
  /** Choose a time-of-day pattern (null for flat traffic). Starts its day now. */
  setPattern: (id: string | null) => void;
  setCentreLeg: (leg: string) => void;
  jumpToHour: (hour: number) => void;
  selectLeg: (leg: string | null) => void;
  pinDesign: () => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  restart: () => void;
  setTheme: (theme: ThemeChoice) => void;
}

let setup: Setup = DEFAULT_SETUP;

const initial = buildScenario(DEFAULT_SETUP, defaultDemand(DEFAULT_SETUP));

export const useApp = create<AppState>((set, get) => ({
  mode: { kind: 'sandbox' },
  levelResult: null,
  progress: loadProgress(),
  showLevels: false,
  editShape: false,
  scenario: initial,
  originalDesign: initial,
  savedDesign: null,
  pendingReplace: null,
  designBeforeLastEdit: null,
  pinnedDesign: null,
  layoutVersion: 0,
  editVersion: 0,
  selectedLeg: null,
  baseline: null,
  lastEdit: null,
  playing: true,
  speed: 2,
  metrics: null,
  trend: [],
  clock: null,
  simTime: 0,
  timeOfDay: null,
  clockJump: null,
  theme: 'system',

  startLevel: (id) => {
    const level = levelById(id);
    if (!level) return;
    const scenario = structuredClone(level.scenario);
    set({
      mode: { kind: 'level', levelId: id },
      editShape: false,
      levelResult: null,
      showLevels: false,
      scenario,
      originalDesign: scenario,
      designBeforeLastEdit: null,
      pinnedDesign: null,
      layoutVersion: get().layoutVersion + 1,
      selectedLeg: null,
      baseline: null,
      lastEdit: null,
      metrics: null,
      timeOfDay: scenario.demand.pattern?.startHour ?? null,
    });
  },
  playSandbox: () => {
    set({ mode: { kind: 'sandbox' }, levelResult: null, showLevels: false });
    get().newJunction({});
  },
  loadDesign: (loaded) => {
    const scenario = structuredClone(loaded);
    set({
      mode: { kind: 'sandbox' },
      levelResult: null,
      scenario,
      originalDesign: scenario,
      designBeforeLastEdit: null,
      pinnedDesign: null,
      layoutVersion: get().layoutVersion + 1,
      selectedLeg: null,
      baseline: null,
      lastEdit: null,
      metrics: null,
      timeOfDay: scenario.demand.pattern?.startHour ?? null,
    });
  },
  askReplace: (what, run) => {
    const s = get();
    const unsaved = s.mode.kind === 'sandbox' && s.scenario !== s.originalDesign && s.scenario !== s.savedDesign;
    if (unsaved) set({ pendingReplace: { what, run } });
    else run();
  },
  closeReplace: () => set({ pendingReplace: null }),
  markSaved: () => set({ savedDesign: get().scenario }),
  setShowLevels: (showLevels) => set({ showLevels }),
  setEditShape: (editShape) => set({ editShape }),
  recordResult: (result) => {
    const mode = get().mode;
    if (mode.kind !== 'level') return;
    const progress = { ...get().progress };
    if (result.stars > (progress[mode.levelId] ?? 0)) progress[mode.levelId] = result.stars;
    saveProgress(progress);
    set({ levelResult: result, progress });
  },
  newJunction: (patch) => {
    const shapeChanged = patch.shape !== undefined && patch.shape !== setup.shape;
    setup = { ...setup, ...patch };
    const demand = shapeChanged ? defaultDemand(setup) : get().scenario.demand;
    const scenario = buildScenario(setup, demand);
    set({
      scenario,
      originalDesign: scenario,
      designBeforeLastEdit: null,
      pinnedDesign: null,
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
    const baseline = m && m.window >= MIN_BASELINE_WINDOW ? { label: get().lastEdit ?? t('Before', 'Önce'), metrics: m } : get().baseline;
    set({
      levelResult: null,
      scenario: draft,
      designBeforeLastEdit: get().scenario,
      editVersion: get().editVersion + 1,
      baseline,
      lastEdit: label,
      metrics: null,
    });
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
  setHeavyShare: (share) => {
    const s = get().scenario;
    set({ scenario: { ...s, demand: { ...s.demand, heavyShare: share } } });
  },
  setPattern: (id) => {
    const s = get().scenario;
    const centre = s.demand.pattern?.centreLeg ?? s.legs[0]!.id;
    const pattern = id ? PATTERNS[id]!.make(centre) : undefined;
    set({ scenario: { ...s, demand: { ...s.demand, pattern } }, timeOfDay: pattern ? pattern.startHour : null });
  },
  setCentreLeg: (leg) => {
    const s = get().scenario;
    if (!s.demand.pattern) return;
    // Same day and clock, only the direction of the tide changes.
    set({ scenario: { ...s, demand: { ...s.demand, pattern: { ...s.demand.pattern, centreLeg: leg } } } });
  },
  jumpToHour: (hour) => set({ clockJump: { hour, n: (get().clockJump?.n ?? 0) + 1 }, timeOfDay: hour }),
  selectLeg: (leg) => set({ selectedLeg: leg }),
  pinDesign: () => set({ pinnedDesign: { scenario: get().scenario, label: get().lastEdit ?? t('Original layout', 'İlk tasarım') } }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  // Restart clears the traffic but keeps the design, so it also becomes the new "original".
  restart: () =>
    set({
      layoutVersion: get().layoutVersion + 1,
      metrics: null,
      baseline: null,
      lastEdit: null,
      // In a level, "original" stays the level's starting layout.
      originalDesign: get().mode.kind === 'level' ? get().originalDesign : get().scenario,
      designBeforeLastEdit: null,
    }),
  setTheme: (theme) => set({ theme }),
}));

export const currentSetup = () => setup;
