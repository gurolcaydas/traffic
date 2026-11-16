import { useEffect, useRef, useState } from 'react';
import type { Scenario } from '../../core/types';
import { busiestWindow, formatClock } from '../../scenarios/patterns';
import {
  PEAK_HOURS,
  TEST_PLANS,
  compare,
  makePlan,
  summarize,
  type DesignSummary,
  type Difference,
  type MetricKey,
  type RunResult,
  type TestLength,
  type TestWindow,
} from '../../sim/evaluate';
import { t } from '../../core/i18n';
import { runFairTest, type FairTestRun } from '../fairTest';
import { useApp } from '../store';
import { Segmented } from './Segmented';

type ReferenceChoice = 'last' | 'original' | 'pinned';

interface Outcome {
  key: string;
  referenceLabel: string;
  plan: TestLength;
  /** What stretch of traffic each run covered, for the footnote. */
  span: string;
  reference: DesignSummary;
  candidate: DesignSummary;
  referenceRuns: RunResult[];
  candidateRuns: RunResult[];
}

/** The layout part of a scenario: two designs are the same if this matches. */
const designKey = (s: Scenario) => JSON.stringify({ ...s, demand: undefined, seed: undefined });
const fmt = (x: number) => (Math.abs(x) < 100 ? x.toFixed(1) : Math.round(x).toString());

/**
 * Compare the current design with a reference design on identical traffic, several times over.
 * Each run uses one random seed for both designs, so the difference is down to the design alone.
 */
export function FairTestPanel() {
  const scenario = useApp((s) => s.scenario);
  const original = useApp((s) => s.originalDesign);
  const beforeLast = useApp((s) => s.designBeforeLastEdit);
  const pinned = useApp((s) => s.pinnedDesign);
  const lastEdit = useApp((s) => s.lastEdit);
  const pinDesign = useApp((s) => s.pinDesign);

  const [choice, setChoice] = useState<ReferenceChoice>('last');
  const [length, setLength] = useState<TestLength>('standard');
  const [testWindow, setTestWindow] = useState<TestWindow>('peak');
  const pattern = scenario.demand.pattern;
  const [progress, setProgress] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<FairTestRun | null>(null);
  useEffect(() => () => running.current?.cancel(), []);

  const references: Record<ReferenceChoice, { scenario: Scenario; label: string } | null> = {
    last: beforeLast ? { scenario: beforeLast, label: t('Before last change', 'Son değişiklikten önce') } : null,
    original: { scenario: original, label: t('Original layout', 'İlk tasarım') },
    pinned: pinned ? { scenario: pinned.scenario, label: `${t('Pinned', 'Sabitlenen')} (${pinned.label})` } : null,
  };
  const effective: ReferenceChoice = references[choice] ? choice : beforeLast ? 'last' : 'original';
  const ref = references[effective]!;
  const sameDesign = designKey(ref.scenario) === designKey(scenario);
  // A result is about one exact pair of designs and one demand table.
  const currentKey = designKey(ref.scenario) + designKey(scenario) + JSON.stringify(scenario.demand);
  const stale = outcome !== null && outcome.key !== currentKey;

  const start = () => {
    running.current?.cancel();
    setError(null);
    setProgress(0);
    const reference = { ...ref.scenario, demand: scenario.demand }; // same traffic for both
    const plan = makePlan(length, pattern, testWindow);
    const span = plan.startHour !== undefined ? `${formatClock(plan.startHour)}–${formatClock(plan.startHour + plan.duration / 3600)}` : `${Math.round(plan.duration / 60)} ${t('min', 'dk')}`;
    const run = runFairTest(reference, scenario, plan, setProgress);
    running.current = run;
    const signalised = (s: Scenario) => s.control.type === 'signals';
    run.done
      .then(({ reference: r, candidate: c }) => {
        if (running.current !== run) return;
        setOutcome({
          key: currentKey,
          referenceLabel: ref.label,
          plan: length,
          span,
          reference: summarize(r, signalised(reference)),
          candidate: summarize(c, signalised(scenario)),
          referenceRuns: r,
          candidateRuns: c,
        });
        setProgress(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : t('The test failed to run.', 'Test çalıştırılamadı.'));
        setProgress(null);
      });
  };

  const cancel = () => {
    running.current?.cancel();
    running.current = null;
    setProgress(null);
  };

  const plan = TEST_PLANS[length];
  const peakStart = pattern ? busiestWindow(pattern, PEAK_HOURS) : 0;
  const runSpan = !pattern
    ? `${plan.minutes} ${t('min', 'dk')}`
    : testWindow === 'peak'
      ? `${formatClock(peakStart)}–${formatClock(peakStart + PEAK_HOURS)}`
      : `${formatClock(pattern.startHour)}–${formatClock(pattern.endHour)}`;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{t('Fair test', 'Adil test')}</h2>
        <button className="link" onClick={pinDesign} title={t('Remember the current design to compare against later', 'Bu tasarımı daha sonra karşılaştırmak için hatırla')}>
          {t('Pin this design', 'Bu tasarımı sabitle')}
        </button>
      </header>
      <p className="hint">
        {t('Runs both designs on ', 'İki tasarımı da ')}
        <strong>{t('exactly the same traffic', 'tamamen aynı trafikle')}</strong>
        {t(
          ", several times with different random traffic, so luck can't decide the result.",
          ', farklı rastgele trafiklerle birkaç kez çalıştırır; böylece sonucu şans belirlemez.',
        )}
      </p>

      <div className="field">
        <label>{t('Compare the current design with', 'Mevcut tasarımı şununla karşılaştır')}</label>
        <Segmented<ReferenceChoice>
          label={t('Reference design', 'Karşılaştırılan tasarım')}
          value={effective}
          options={[
            ...(beforeLast ? [{ value: 'last' as const, label: t('Before last change', 'Son değişiklikten önce'), title: lastEdit ? `${t('Undo of', 'Geri alınan')}: ${lastEdit}` : undefined }] : []),
            { value: 'original' as const, label: t('Original', 'İlk hali') },
            ...(pinned ? [{ value: 'pinned' as const, label: t('Pinned', 'Sabitlenen'), title: pinned.label }] : []),
          ]}
          onChange={setChoice}
        />
      </div>

      <div className="field">
        <label>{t('Test length', 'Test süresi')}</label>
        <Segmented<TestLength>
          label={t('Test length', 'Test süresi')}
          value={length}
          options={(Object.keys(TEST_PLANS) as TestLength[]).map((k) => ({
            value: k,
            label: TEST_PLANS[k].label,
            title: t(
              `${TEST_PLANS[k].runs} runs × ${TEST_PLANS[k].minutes} min of traffic per design`,
              `Tasarım başına ${TEST_PLANS[k].runs} deneme × ${TEST_PLANS[k].minutes} dk trafik`,
            ),
          }))}
          onChange={setLength}
        />
      </div>

      {pattern && (
        <div className="field">
          <label>{t('Which part of the day', 'Günün hangi bölümü')}</label>
          <Segmented<TestWindow>
            label={t('Test window', 'Test aralığı')}
            value={testWindow}
            options={[
              { value: 'peak', label: t(`Busiest ${PEAK_HOURS} h`, `En yoğun ${PEAK_HOURS} sa`), title: `${formatClock(peakStart)}–${formatClock(peakStart + PEAK_HOURS)}` },
              { value: 'day', label: t('Whole day', 'Tüm gün'), title: `${formatClock(pattern.startHour)}–${formatClock(pattern.endHour)}: ${t('slower', 'daha yavaş')}` },
            ]}
            onChange={setTestWindow}
          />
        </div>
      )}

      {progress === null ? (
        <div className="row gap">
          <button className="btn primary" onClick={start} disabled={sameDesign}>
            {t('Run test', 'Testi çalıştır')}
          </button>
          <span className="hint">
            {sameDesign
              ? t('Nothing to compare: change the design first.', 'Karşılaştıracak bir şey yok: önce tasarımı değiştirin.')
              : t(`${plan.runs} runs of ${runSpan}, both designs`, `İki tasarım için ${runSpan} trafikle ${plan.runs} deneme`)}
          </span>
        </div>
      ) : (
        <div className="row gap">
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <button className="link" onClick={cancel}>
            {t('Cancel', 'İptal')}
          </button>
        </div>
      )}

      {error && <p className="alert">{error}</p>}
      {outcome && <Results outcome={outcome} stale={stale} hasPeds={scenario.crosswalks.length > 0 || outcome.reference.pedWait.mean > 0} />}
    </section>
  );
}

const ROWS: Array<{ key: MetricKey; label: () => string; unit: () => string; lowerIsBetter: boolean }> = [
  { key: 'avgDelay', label: () => t('Avg delay', 'Ort. gecikme'), unit: () => 's', lowerIsBetter: true },
  { key: 'worst15Delay', label: () => t('Worst 15 min', 'En kötü 15 dk'), unit: () => 's', lowerIsBetter: true },
  { key: 'throughput', label: () => t('Throughput', 'Geçen araç'), unit: () => t('/h', '/sa'), lowerIsBetter: false },
  { key: 'worstQueue', label: () => t('Worst queue', 'En uzun kuyruk'), unit: () => '', lowerIsBetter: true },
  { key: 'pedWait', label: () => t('Ped wait', 'Yaya bekleme'), unit: () => 's', lowerIsBetter: true },
  { key: 'divertedPerHour', label: () => t('Diverted', 'Yönlendirilen'), unit: () => t('/h', '/sa'), lowerIsBetter: true },
];

function Results({ outcome, stale, hasPeds }: { outcome: Outcome; stale: boolean; hasPeds: boolean }) {
  const { reference: r, candidate: c } = outcome;
  const rows = ROWS.filter((row) => {
    if (row.key === 'pedWait') return hasPeds;
    if (row.key === 'divertedPerHour') return r.divertedPerHour.mean > 0 || c.divertedPerHour.mean > 0;
    return true;
  });
  const diffs = new Map<MetricKey, Difference>(rows.map((row) => [row.key, compare(outcome.referenceRuns, outcome.candidateRuns, row.key, row.lowerIsBetter)]));
  const delay = diffs.get('avgDelay')!;
  const headline =
    delay.verdict === 'better'
      ? t(`Your design cuts delay by ${fmt(-delay.mean)} s (±${fmt(delay.ci)}).`, `Tasarımınız gecikmeyi ${fmt(-delay.mean)} sn azaltıyor (±${fmt(delay.ci)}).`)
      : delay.verdict === 'worse'
        ? t(`Your design adds ${fmt(delay.mean)} s of delay (±${fmt(delay.ci)}).`, `Tasarımınız gecikmeyi ${fmt(delay.mean)} sn artırıyor (±${fmt(delay.ci)}).`)
        : t('No clear difference in delay: the change is within the noise.', 'Gecikmede belirgin bir fark yok: değişim rastgele dalgalanma içinde.');

  return (
    <div className={`fair-result ${stale ? 'stale' : ''}`}>
      {stale && (
        <p className="hint">
          {t('The design or traffic has changed since this test. Run it again for current results.', 'Bu testten sonra tasarım ya da trafik değişti. Güncel sonuç için yeniden çalıştırın.')}
        </p>
      )}
      <p className={`verdict ${delay.verdict}`}>{headline}</p>
      <table>
        <thead>
          <tr>
            <th />
            <th>{outcome.referenceLabel}</th>
            <th>{t('Now', 'Şimdi')}</th>
            <th>{t('Change', 'Fark')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>{t('Grade', 'Not')}</th>
            <td>
              <span className={`los-chip los-${r.los}`}>{r.los}</span>
            </td>
            <td>
              <span className={`los-chip los-${c.los}`}>{c.los}</span>
            </td>
            <td />
          </tr>
          {rows.map((row) => {
            const d = diffs.get(row.key)!;
            return (
              <tr key={row.key}>
                <th>{row.label()}</th>
                <td className="num">
                  {fmt(r[row.key].mean)}
                  {row.unit()}
                </td>
                <td className="num">
                  {fmt(c[row.key].mean)}
                  {row.unit()}
                </td>
                <td className={`num delta ${d.verdict === 'better' ? 'good' : d.verdict === 'worse' ? 'bad' : 'same'}`} title={t('Average change per run, ± its 95% confidence interval', 'Deneme başına ortalama fark, ± %95 güven aralığı')}>
                  {d.mean >= 0 ? '+' : '−'}
                  {fmt(Math.abs(d.mean))} ±{fmt(d.ci)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(r.overloadRate > 0 || c.overloadRate > 0) && (
        <p className="hint">
          {t(
            `Queues spilled off the map in ${Math.round(r.overloadRate * 100)}% of runs before, ${Math.round(c.overloadRate * 100)}% now.`,
            `Kuyruklar haritadan taştı: önce denemelerin %${Math.round(r.overloadRate * 100)}'inde, şimdi %${Math.round(c.overloadRate * 100)}'inde.`,
          )}
        </p>
      )}
      {(r.gridlockRate > 0 || c.gridlockRate > 0) && (
        <p className="hint">
          {t(
            `Gridlock in ${Math.round(r.gridlockRate * 100)}% of runs before, ${Math.round(c.gridlockRate * 100)}% now.`,
            `Kilitlenme: önce denemelerin %${Math.round(r.gridlockRate * 100)}'inde, şimdi %${Math.round(c.gridlockRate * 100)}'inde.`,
          )}
        </p>
      )}
      <p className="hint">
        {t(
          `${TEST_PLANS[outcome.plan].runs} runs of ${outcome.span} each, after a warm-up. ± is the 95% confidence interval.`,
          `Isınmanın ardından her biri ${outcome.span} süren ${TEST_PLANS[outcome.plan].runs} deneme. ± değeri %95 güven aralığıdır.`,
        )}
      </p>
    </div>
  );
}
