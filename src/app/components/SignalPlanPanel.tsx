import { legColor } from '../../render/theme';
import {
  addPhase,
  applyPlanPreset,
  phaseMovements,
  removePhase,
  setPhaseGreen,
  toggleMovementInPhase,
  togglePedInPhase,
  type PlanPreset,
} from '../../scenarios/edit';
import { useApp } from '../store';

const PRESETS: Array<{ value: PlanPreset; label: string; title: string }> = [
  { value: 'pairs', label: 'Opposite pairs', title: 'Opposite legs go together; turns give way' },
  { value: 'protected', label: 'Protected turns', title: 'Opposite legs go together, then their far-side turns get their own phase' },
  { value: 'split', label: 'One leg at a time', title: 'Each leg gets its own phase: no conflicts, long waits' },
];

/** Phase-by-phase signal plan: green time, which movements go, which crossings walk. */
export function SignalPlanPanel() {
  const scenario = useApp((s) => s.scenario);
  const clock = useApp((s) => s.clock);
  const edit = useApp((s) => s.edit);
  if (scenario.control.type !== 'signals') return null;
  const { phases } = scenario.control;
  const legIndex = (id: string) => scenario.legs.findIndex((l) => l.id === id);
  const signalCrossings = scenario.crosswalks.filter((c) => c.type === 'signal');
  const cycle = phases.reduce((s, p) => s + p.green + 5, 0);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Signal plan</h2>
        <span className="hint">
          Cycle <span className="num">{cycle}</span>s
        </span>
      </header>

      <div className="chips">
        {PRESETS.map((p) => (
          <button key={p.value} className="chip" title={p.title} onClick={() => edit(`Signals: ${p.label.toLowerCase()}`, (d) => applyPlanPreset(d, p.value))}>
            {p.label}
          </button>
        ))}
      </div>

      {phases.map((phase, i) => {
        const moves = phaseMovements(scenario, phase);
        const active = clock?.phase === i;
        return (
          <div key={i} className={`phase ${active ? `active ${clock?.stage}` : ''}`}>
            <div className="phase-head">
              <strong>Phase {i + 1}</strong>
              <input
                type="range"
                min={5}
                max={60}
                step={5}
                value={phase.green}
                aria-label={`Phase ${i + 1} green seconds`}
                onChange={(e) => edit(`Phase ${i + 1}: ${e.target.value}s green`, (d) => setPhaseGreen(d, i, Number(e.target.value)))}
              />
              <span className="num">{phase.green}s</span>
              {phases.length > 1 && (
                <button className="link danger" onClick={() => edit(`Removed phase ${i + 1}`, (d) => removePhase(d, i))} aria-label={`Remove phase ${i + 1}`}>
                  ✕
                </button>
              )}
            </div>
            <div className="moves">
              {scenario.legs.map((from) => (
                <div key={from.id} className="move-row">
                  <span className="leg-badge small" style={{ background: legColor(legIndex(from.id)) }}>
                    {from.id}
                  </span>
                  {scenario.legs
                    .filter((to) => to.id !== from.id)
                    .map((to) => {
                      const on = moves.some((m) => m.from === from.id && m.to === to.id);
                      return (
                        <button
                          key={to.id}
                          className={`chip tiny ${on ? 'on' : ''}`}
                          aria-pressed={on}
                          title={`${from.id} → ${to.id}`}
                          onClick={() => edit(`Phase ${i + 1}: ${on ? 'stop' : 'run'} ${from.id}→${to.id}`, (d) => toggleMovementInPhase(d, i, { from: from.id, to: to.id }))}
                        >
                          →{to.id}
                        </button>
                      );
                    })}
                </div>
              ))}
              {signalCrossings.length > 0 && (
                <div className="move-row">
                  <span className="ped-icon" aria-hidden>
                    🚶
                  </span>
                  {signalCrossings.map((c) => {
                    const on = phase.pedestrians?.includes(c.leg) ?? false;
                    return (
                      <button
                        key={c.leg}
                        className={`chip tiny ${on ? 'on' : ''}`}
                        aria-pressed={on}
                        title={`Pedestrians cross leg ${c.leg}`}
                        onClick={() => edit(`Phase ${i + 1}: ${on ? 'stop' : 'walk'} crossing ${c.leg}`, (d) => togglePedInPhase(d, i, c.leg))}
                      >
                        ✕{c.leg}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <button className="btn" onClick={() => edit('Added a phase', addPhase)}>
        + Add phase
      </button>
    </section>
  );
}
