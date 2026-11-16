import { t } from '../../core/i18n';
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
import { useRules } from '../levelRules';
import { useApp } from '../store';

const PRESETS: Array<{ value: PlanPreset; label: () => string; title: () => string }> = [
  {
    value: 'pairs',
    label: () => t('Opposite pairs', 'Karşılıklı çiftler'),
    title: () => t('Opposite legs go together; turns give way', 'Karşılıklı yollar birlikte geçer; dönenler yol verir'),
  },
  {
    value: 'protected',
    label: () => t('Protected turns', 'Korumalı dönüşler'),
    title: () => t('Opposite legs go together, then their far-side turns get their own phase', 'Karşılıklı yollar birlikte geçer, ardından karşıya dönüşler kendi fazını alır'),
  },
  {
    value: 'split',
    label: () => t('One leg at a time', 'Her yol ayrı'),
    title: () => t('Each leg gets its own phase: no conflicts, long waits', 'Her yolun kendi fazı var: çakışma yok, bekleme uzun'),
  },
];

/** Phase-by-phase signal plan: green time, which movements go, which crossings walk. */
export function SignalPlanPanel() {
  const scenario = useApp((s) => s.scenario);
  const clock = useApp((s) => s.clock);
  const edit = useApp((s) => s.edit);
  const rules = useRules();
  if (scenario.control.type !== 'signals' || !rules.signalPlan) return null;
  const { phases } = scenario.control;
  const legIndex = (id: string) => scenario.legs.findIndex((l) => l.id === id);
  const signalCrossings = scenario.crosswalks.filter((c) => c.type === 'signal');
  const cycle = phases.reduce((s, p) => s + p.green + 5, 0);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{t('Signal plan', 'Sinyal planı')}</h2>
        <span className="hint">
          {t('Cycle', 'Devre')} <span className="num">{cycle}</span>s
        </span>
      </header>

      <div className="chips">
        {PRESETS.map((p) => (
          <button key={p.value} className="chip" title={p.title()} onClick={() => edit(`${t('Signals', 'Işıklar')}: ${p.label().toLocaleLowerCase()}`, (d) => applyPlanPreset(d, p.value))}>
            {p.label()}
          </button>
        ))}
      </div>

      {phases.map((phase, i) => {
        const moves = phaseMovements(scenario, phase);
        const active = clock?.phase === i;
        return (
          <div key={i} className={`phase ${active ? `active ${clock?.stage}` : ''}`}>
            <div className="phase-head">
              <strong>
                {t('Phase', 'Faz')} {i + 1}
              </strong>
              <input
                type="range"
                min={5}
                max={60}
                step={5}
                value={phase.green}
                aria-label={t(`Phase ${i + 1} green seconds`, `Faz ${i + 1} yeşil süresi (sn)`)}
                onChange={(e) => edit(t(`Phase ${i + 1}: ${e.target.value}s green`, `Faz ${i + 1}: ${e.target.value} sn yeşil`), (d) => setPhaseGreen(d, i, Number(e.target.value)))}
              />
              <span className="num">{phase.green}s</span>
              {phases.length > 1 && (
                <button className="link danger" onClick={() => edit(t(`Removed phase ${i + 1}`, `Faz ${i + 1} kaldırıldı`), (d) => removePhase(d, i))} aria-label={t(`Remove phase ${i + 1}`, `Faz ${i + 1} kaldır`)}>
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
                          onClick={() => edit(`${t('Phase', 'Faz')} ${i + 1}: ${on ? t('stop', 'durdur') : t('run', 'geçir')} ${from.id}→${to.id}`, (d) => toggleMovementInPhase(d, i, { from: from.id, to: to.id }))}
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
                        title={t(`Pedestrians cross leg ${c.leg}`, `Yayalar ${c.leg} numaralı yolu geçer`)}
                        onClick={() => edit(`${t('Phase', 'Faz')} ${i + 1}: ${on ? t(`stop crossing ${c.leg}`, `${c.leg} geçidini durdur`) : t(`walk crossing ${c.leg}`, `${c.leg} geçidinde yürü`)}`, (d) => togglePedInPhase(d, i, c.leg))}
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

      <button className="btn" onClick={() => edit(t('Added a phase', 'Faz eklendi'), addPhase)}>
        + {t('Add phase', 'Faz ekle')}
      </button>
    </section>
  );
}
