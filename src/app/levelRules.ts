import { levelById } from '../game/levels';
import type { Level } from '../game/types';
import type { ControlChoice } from '../scenarios/setup';
import { controlChoice } from '../scenarios/edit';
import { useApp } from './store';

/** The level being played, or null in the sandbox. */
export function useLevel(): Level | null {
  const mode = useApp((s) => s.mode);
  return mode.kind === 'level' ? (levelById(mode.levelId) ?? null) : null;
}

/** What the player may do. In the sandbox, everything. */
export interface Rules {
  inLevel: boolean;
  controls: ControlChoice[];
  lanes: boolean;
  sideRoads: boolean;
  flyover: boolean;
  crossings: boolean;
  bans: boolean;
  signalPlan: boolean;
  demand: boolean;
  /** Most lanes a leg may have, each way. */
  maxLanes: (leg: string) => number;
  sideRoadBlocked: (leg: string) => boolean;
  crossingRequired: (leg: string) => boolean;
}

const ALL: ControlChoice[] = ['right', 'major', 'signals', 'roundabout'];

export function rulesFor(level: Level | null): Rules {
  if (!level) {
    return {
      inLevel: false,
      controls: ALL,
      lanes: true,
      sideRoads: true,
      flyover: true,
      crossings: true,
      bans: true,
      signalPlan: true,
      demand: true,
      maxLanes: () => 3,
      sideRoadBlocked: () => false,
      crossingRequired: () => false,
    };
  }
  const t = level.tools;
  const start = controlChoice(level.scenario);
  const startLanes = (id: string) => level.scenario.legs.find((l) => l.id === id);
  return {
    inLevel: true,
    controls: ALL.filter((c) => c === start || t.control.includes(c)),
    lanes: t.lanes,
    sideRoads: t.sideRoads,
    flyover: t.flyover,
    crossings: t.crossings,
    bans: t.bans,
    signalPlan: t.signalPlan,
    demand: false,
    maxLanes: (id) => {
      const s = startLanes(id);
      if (!t.lanes || level.fixedLanes?.includes(id)) return Math.max(s?.lanesIn ?? 1, s?.lanesOut ?? 1);
      return 3;
    },
    sideRoadBlocked: (id) => !t.sideRoads || (level.blockedCorners ?? []).includes(id),
    crossingRequired: (id) => (level.requiredCrossings ?? []).includes(id),
  };
}

export function useRules(): Rules {
  return rulesFor(useLevel());
}
