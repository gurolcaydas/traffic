import { useMemo } from 'react';
import { t } from '../../core/i18n';
import { legColor } from '../../render/theme';
import {
  addPhase,
  applyPlanPreset,
  phaseMovements,
  removePhase,
  setActuated,
  setPhaseGreen,
  toggleEntryInPhase,
  toggleMovementInPhase,
  togglePedInPhase,
  type PlanPreset,
} from '../../scenarios/edit';
import { applyWebsterTiming, websterTiming } from '../../scenarios/timing';
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
  // Rebuilds the network, so only when the design or traffic changes: this panel re-renders with every tick of the lights.
  const webster = useMemo(() => websterTiming(scenario), [scenario]);
  if (scenario.control.type !== 'signals' || !rules.signalPlan) return null;
  const { phases, ring, actuated } = scenario.control;
  const legIndex = (id: string) => scenario.legs.findIndex((l) => l.id === id);
  const signalCrossings = scenario.crosswalks.filter((c) => c.type === 'signal');
  const cycle = phases.reduce((s, p) => s + p.green + 5, 0);
  // On a ring, an entry that never stops means the ring lights before it never let anyone past.
  const alwaysOpen = ring ? scenario.legs.filter((l) => phases.every((p) => p.movements.some((m) => m.from === l.id))).map((l) => l.id) : [];

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{t('Signal plan', 'Sinyal planı')}</h2>
        <span className="hint">
          {t('Cycle', 'Devre')} <span className="num">{cycle}</span>s
        </span>
      </header>

      <div className="chips">
        {PRESETS.filter((p) => !ring || p.value !== 'protected').map((p) => (
          <button key={p.value} className="chip" title={p.title()} onClick={() => edit(`${t('Signals', 'Işıklar')}: ${p.label().toLocaleLowerCase()}`, (d) => applyPlanPreset(d, p.value))}>
            {p.label()}
          </button>
        ))}
      </div>

      <div className="chips">
        <button
          className="chip"
          title={t(
            `Webster's method: green in proportion to each phase's busiest approach, over the cycle that keeps delay lowest (about ${Math.round(webster?.cycle ?? 0)} s for this traffic)`,
            `Webster yöntemi: yeşil, her fazın en yoğun yoluna göre paylaştırılır; devre, gecikmeyi en aza indiren uzunlukta olur (bu trafik için yaklaşık ${Math.round(webster?.cycle ?? 0)} sn)`,
          )}
          onClick={() => edit(t('Signals timed from traffic', 'Işıklar trafiğe göre ayarlandı'), applyWebsterTiming)}
        >
          ⏱ {t('Time from traffic', 'Trafiğe göre ayarla')}
        </button>
        <button
          className={`chip ${actuated ? 'on' : ''}`}
          aria-pressed={!!actuated}
          title={t(
            'Detectors end a green early once its traffic stops coming and someone is waiting; the green times become maximums',
            'Algılayıcılar, trafiği biten ve başka yönde bekleyen varsa yeşili erken bitirir; yeşil süreleri üst sınır olur',
          )}
          onClick={() => edit(actuated ? t('Fixed-time signals', 'Sabit süreli ışıklar') : t('Signals respond to traffic', 'Işıklar trafiğe duyarlı'), (d) => setActuated(d, !actuated))}
        >
          {t('Responds to traffic', 'Trafiğe duyarlı')}
        </button>
      </div>
      {webster && webster.total >= 0.9 && (
        <p className="alert">
          {t(
            `Traffic needs ${Math.round(webster.total * 100)}% of the junction's green: no timing can keep up. Add lanes or change the layout.`,
            `Trafik, kavşağın yeşil süresinin %${Math.round(webster.total * 100)} kadarını istiyor: hiçbir ayar yetişemez. Şerit ekleyin ya da düzeni değiştirin.`,
          )}
        </p>
      )}

      {ring && alwaysOpen.length > 0 && (
        <p className="alert">
          {t(
            `Entry ${alwaysOpen.join(', ')} has green in every phase, so the ring lights before it never turn green and the ring will lock.`,
            `${alwaysOpen.join(', ')} girişi her fazda yeşil; önündeki iç ışıklar hiç yeşile dönmez ve dönel kavşak kilitlenir.`,
          )}
        </p>
      )}

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
                aria-label={actuated ? t(`Phase ${i + 1} longest green, seconds`, `Faz ${i + 1} en uzun yeşil süresi (sn)`) : t(`Phase ${i + 1} green seconds`, `Faz ${i + 1} yeşil süresi (sn)`)}
                onChange={(e) => edit(t(`Phase ${i + 1}: ${e.target.value}s green`, `Faz ${i + 1}: ${e.target.value} sn yeşil`), (d) => setPhaseGreen(d, i, Number(e.target.value)))}
              />
              <span className="num">
                {actuated ? '≤' : ''}
                {phase.green}s
              </span>
              {phases.length > 1 && (
                <button className="link danger" onClick={() => edit(t(`Removed phase ${i + 1}`, `Faz ${i + 1} kaldırıldı`), (d) => removePhase(d, i))} aria-label={t(`Remove phase ${i + 1}`, `Faz ${i + 1} kaldır`)}>
                  ✕
                </button>
              )}
            </div>
            <div className="moves">
              {ring && (
                <div className="move-row">
                  <span className="hint">{t('Entries', 'Girişler')}</span>
                  {scenario.legs.map((leg) => {
                    const on = phase.movements.some((m) => m.from === leg.id);
                    return (
                      <button
                        key={leg.id}
                        className={`chip tiny ${on ? 'on' : ''}`}
                        aria-pressed={on}
                        title={t(
                          `Traffic from leg ${leg.id} enters; the ring lights before it hold circulating traffic`,
                          `${leg.id} numaralı yoldan giriş serbest; önündeki iç ışıklar dönen trafiği durdurur`,
                        )}
                        onClick={() => edit(`${t('Phase', 'Faz')} ${i + 1}: ${on ? t(`stop entry ${leg.id}`, `${leg.id} girişini durdur`) : t(`open entry ${leg.id}`, `${leg.id} girişini aç`)}`, (d) => toggleEntryInPhase(d, i, leg.id))}
                      >
                        <span className="leg-badge small" style={{ background: legColor(legIndex(leg.id)) }}>
                          {leg.id}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {!ring && scenario.legs.map((from) => (
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
