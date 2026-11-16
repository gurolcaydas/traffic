import { useEffect, useRef, useState } from 'react';
import { t } from '../../core/i18n';
import { costItems, totalCost } from '../../game/costs';
import { LEVELS } from '../../game/levels';
import { designProblems, levelPlan, scoreRuns } from '../../game/score';
import { formatClock } from '../../scenarios/patterns';
import { runDesigns } from '../fairTest';
import { useLevel } from '../levelRules';
import { useApp } from '../store';

const Stars = ({ n, size = 'md' }: { n: number; size?: 'md' | 'lg' }) => (
  <span className={`stars ${size}`} aria-label={t(`${n} of 3 stars`, `3 yıldızdan ${n}`)}>
    {[1, 2, 3].map((i) => (
      <span key={i} className={i <= n ? 'on' : ''} aria-hidden>
        ★
      </span>
    ))}
  </span>
);

export { Stars };

/** The level's brief, goal, budget and rules, and the button that has the design judged. */
export function LevelPanel() {
  const level = useLevel();
  const scenario = useApp((s) => s.scenario);
  const result = useApp((s) => s.levelResult);
  const best = useApp((s) => (level ? (s.progress[level.id] ?? 0) : 0));
  const recordResult = useApp((s) => s.recordResult);
  const startLevel = useApp((s) => s.startLevel);
  const setShowLevels = useApp((s) => s.setShowLevels);
  const [progress, setProgress] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  useEffect(() => setShowHint(false), [level?.id]);
  if (!level) return null;

  const items = costItems(level.scenario, scenario);
  const spent = totalCost(items);
  const problems = designProblems(level, scenario);
  const plan = levelPlan(level);
  const span = plan.startHour !== undefined ? `${formatClock(plan.startHour)}–${formatClock(plan.startHour + plan.duration / 3600)}` : `${plan.duration / 60} ${t('min', 'dk')}`;
  const index = LEVELS.findIndex((l) => l.id === level.id);
  const next = LEVELS[index + 1];

  const submit = () => {
    setProgress(0);
    const design = scenario;
    const run = runDesigns([design], plan, setProgress);
    cancel.current = run.cancel;
    run.done
      .then(([runs]) => {
        recordResult(scoreRuns(level, design, runs!));
        setProgress(null);
      })
      .catch(() => setProgress(null));
  };

  return (
    <section className="panel level-panel">
      <header className="panel-head">
        <h2>
          {t('Level', 'Bölüm')} {index + 1}: {level.title}
        </h2>
        <button className="link" onClick={() => setShowLevels(true)}>
          {t('All levels', 'Tüm bölümler')}
        </button>
      </header>
      <p className="brief">{level.brief}</p>

      <div className="goal">
        <div className="goal-row">
          <span>{t('Average delay', 'Ortalama gecikme')}</span>
          {level.stars.map((limit, i) => (
            <span key={i} className="goal-step">
              <Stars n={i + 1} /> ≤ <span className="num">{limit}</span>s
            </span>
          ))}
        </div>
        <ul className="rules">
          <li>{t('No gridlock in any run (traffic must keep moving).', 'Hiçbir denemede kilitlenme olmamalı (trafik akmaya devam etmeli).')}</li>
          {level.requiredCrossings?.length ? <li>{t(`Keep the crossings on legs ${level.requiredCrossings.join(', ')}.`, `${level.requiredCrossings.join(', ')} numaralı yollardaki yaya geçitleri kalmalı.`)}</li> : null}
          {level.maxPedWait !== undefined && <li>{t(`Pedestrians wait ${level.maxPedWait} s or less on average.`, `Yayalar ortalama en fazla ${level.maxPedWait} sn beklemeli.`)}</li>}
          {level.fixedLanes?.length ? <li>{t(`Legs ${level.fixedLanes.join(' and ')} can't be widened (shops).`, `${level.fixedLanes.join(' ve ')} numaralı yollar genişletilemez (dükkânlar).`)}</li> : null}
          {level.blockedCorners?.length ? <li>{t(`A building blocks the side road from leg ${level.blockedCorners.join(', ')}.`, `${level.blockedCorners.join(', ')} numaralı yoldan serbest dönüşü bir bina engelliyor.`)}</li> : null}
          <li>
            {t(
              `Judged on ${plan.seeds.length} runs of ${span} of traffic, the same for every attempt.`,
              `${span} trafiğin ${plan.seeds.length} denemesiyle değerlendirilir; her girişimde aynı trafik.`,
            )}
          </li>
        </ul>
      </div>

      <div className="budget">
        <div className="budget-head">
          <span>{t('Budget', 'Bütçe')}</span>
          <span className={`num ${spent > level.budget ? 'over' : ''}`}>
            {spent} / {level.budget}
          </span>
        </div>
        <div className="bar">
          <div className={`bar-fill ${spent > level.budget ? 'bad' : ''}`} style={{ width: `${Math.min(100, (spent / level.budget) * 100)}%` }} />
        </div>
        {items.length > 0 && (
          <ul className="cost-items">
            {items.map((i) => (
              <li key={i.label}>
                <span>{i.label}</span>
                <span className="num">{i.cost}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {progress === null ? (
        <div className="row gap">
          <button className="btn primary" onClick={submit} disabled={problems.length > 0}>
            {t('Submit design', 'Tasarımı gönder')}
          </button>
          {best > 0 && (
            <span className="hint">
              {t('Best so far', 'En iyi sonuç')} <Stars n={best} />
            </span>
          )}
        </div>
      ) : (
        <div className="row gap">
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="hint">{t('Testing…', 'Test ediliyor…')}</span>
        </div>
      )}
      {problems.length > 0 && <p className="alert">{problems.join(' ')}</p>}

      {result && (
        <div className={`level-result ${result.passed ? 'pass' : 'fail'}`}>
          <div className="result-head">
            <Stars n={result.stars} size="lg" />
            <strong>{result.passed ? (result.stars === 3 ? t('Perfect!', 'Mükemmel!') : t('Solved', 'Çözüldü')) : t('Not yet', 'Henüz değil')}</strong>
          </div>
          <dl className="result-stats">
            <div>
              <dt>{t('Avg delay', 'Ort. gecikme')}</dt>
              <dd className="num">
                {result.avgDelay.toFixed(1)}s <span className="hint">±{result.delayCi.toFixed(1)}</span>
              </dd>
            </div>
            <div>
              <dt>{t('Worst 15 min', 'En kötü 15 dk')}</dt>
              <dd className="num">{result.worst15Delay.toFixed(0)}s</dd>
            </div>
            <div>
              <dt>{t('Throughput', 'Geçen araç')}</dt>
              <dd className="num">{Math.round(result.throughput)}/{t('h', 'sa')}</dd>
            </div>
            <div>
              <dt>{t('Cost', 'Maliyet')}</dt>
              <dd className="num">{result.cost}</dd>
            </div>
          </dl>
          {result.failures.length > 0 && (
            <ul className="failures">
              {result.failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {result.overloadedRuns > 0 && (
            <p className="hint">
              {t(
                `Queues spilled off the map in ${result.overloadedRuns} of ${result.runs} runs: more traffic arrives than this junction can serve.`,
                `${result.runs} denemenin ${result.overloadedRuns} tanesinde kuyruklar haritadan taştı: gelen trafik bu kavşağın kapasitesini aşıyor.`,
              )}
            </p>
          )}
          <div className="row gap">
            {result.passed && next && (
              <button className="btn primary" onClick={() => startLevel(next.id)}>
                {t('Next', 'Sonraki')}: {next.title} →
              </button>
            )}
            {!result.passed && !showHint && (
              <button className="btn" onClick={() => setShowHint(true)}>
                {t('Hint', 'İpucu')}
              </button>
            )}
          </div>
          {showHint && <p className="hint-text">💡 {level.hint}</p>}
        </div>
      )}
    </section>
  );
}
