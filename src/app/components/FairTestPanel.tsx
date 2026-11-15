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
    last: beforeLast ? { scenario: beforeLast, label: 'Before last change' } : null,
    original: { scenario: original, label: 'Original layout' },
    pinned: pinned ? { scenario: pinned.scenario, label: `Pinned (${pinned.label})` } : null,
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
    const span = plan.startHour !== undefined ? `${formatClock(plan.startHour)}–${formatClock(plan.startHour + plan.duration / 3600)}` : `${Math.round(plan.duration / 60)} min`;
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
        setError(e instanceof Error ? e.message : 'The test failed to run.');
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
    ? `${plan.minutes} min`
    : testWindow === 'peak'
      ? `${formatClock(peakStart)}–${formatClock(peakStart + PEAK_HOURS)}`
      : `${formatClock(pattern.startHour)}–${formatClock(pattern.endHour)}`;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Fair test</h2>
        <button className="link" onClick={pinDesign} title="Remember the current design to compare against later">
          Pin this design
        </button>
      </header>
      <p className="hint">
        Runs both designs on <strong>exactly the same traffic</strong>, several times with different random traffic, so luck can't decide the result.
      </p>

      <div className="field">
        <label>Compare the current design with</label>
        <Segmented<ReferenceChoice>
          label="Reference design"
          value={effective}
          options={[
            ...(beforeLast ? [{ value: 'last' as const, label: 'Before last change', title: lastEdit ? `Undo of: ${lastEdit}` : undefined }] : []),
            { value: 'original' as const, label: 'Original' },
            ...(pinned ? [{ value: 'pinned' as const, label: 'Pinned', title: pinned.label }] : []),
          ]}
          onChange={setChoice}
        />
      </div>

      <div className="field">
        <label>Test length</label>
        <Segmented<TestLength>
          label="Test length"
          value={length}
          options={(Object.keys(TEST_PLANS) as TestLength[]).map((k) => ({
            value: k,
            label: TEST_PLANS[k].label,
            title: `${TEST_PLANS[k].runs} runs × ${TEST_PLANS[k].minutes} min of traffic per design`,
          }))}
          onChange={setLength}
        />
      </div>

      {pattern && (
        <div className="field">
          <label>Which part of the day</label>
          <Segmented<TestWindow>
            label="Test window"
            value={testWindow}
            options={[
              { value: 'peak', label: `Busiest ${PEAK_HOURS} h`, title: `${formatClock(peakStart)}–${formatClock(peakStart + PEAK_HOURS)}` },
              { value: 'day', label: 'Whole day', title: `${formatClock(pattern.startHour)}–${formatClock(pattern.endHour)}: slower` },
            ]}
            onChange={setTestWindow}
          />
        </div>
      )}

      {progress === null ? (
        <div className="row gap">
          <button className="btn primary" onClick={start} disabled={sameDesign}>
            Run test
          </button>
          <span className="hint">
            {sameDesign ? 'Nothing to compare: change the design first.' : `${plan.runs} runs of ${runSpan}, both designs`}
          </span>
        </div>
      ) : (
        <div className="row gap">
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <button className="link" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}

      {error && <p className="alert">{error}</p>}
      {outcome && <Results outcome={outcome} stale={stale} hasPeds={scenario.crosswalks.length > 0 || outcome.reference.pedWait.mean > 0} />}
    </section>
  );
}

const ROWS: Array<{ key: MetricKey; label: string; unit: string; lowerIsBetter: boolean }> = [
  { key: 'avgDelay', label: 'Avg delay', unit: 's', lowerIsBetter: true },
  { key: 'worst15Delay', label: 'Worst 15 min', unit: 's', lowerIsBetter: true },
  { key: 'throughput', label: 'Throughput', unit: '/h', lowerIsBetter: false },
  { key: 'worstQueue', label: 'Worst queue', unit: '', lowerIsBetter: true },
  { key: 'pedWait', label: 'Ped wait', unit: 's', lowerIsBetter: true },
  { key: 'divertedPerHour', label: 'Diverted', unit: '/h', lowerIsBetter: true },
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
      ? `Your design cuts delay by ${fmt(-delay.mean)} s (±${fmt(delay.ci)}).`
      : delay.verdict === 'worse'
        ? `Your design adds ${fmt(delay.mean)} s of delay (±${fmt(delay.ci)}).`
        : 'No clear difference in delay: the change is within the noise.';

  return (
    <div className={`fair-result ${stale ? 'stale' : ''}`}>
      {stale && <p className="hint">The design or traffic has changed since this test. Run it again for current results.</p>}
      <p className={`verdict ${delay.verdict}`}>{headline}</p>
      <table>
        <thead>
          <tr>
            <th />
            <th>{outcome.referenceLabel}</th>
            <th>Now</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Grade</th>
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
                <th>{row.label}</th>
                <td className="num">
                  {fmt(r[row.key].mean)}
                  {row.unit}
                </td>
                <td className="num">
                  {fmt(c[row.key].mean)}
                  {row.unit}
                </td>
                <td className={`num delta ${d.verdict === 'better' ? 'good' : d.verdict === 'worse' ? 'bad' : 'same'}`} title="Average change per run, ± its 95% confidence interval">
                  {d.mean >= 0 ? '+' : '−'}
                  {fmt(Math.abs(d.mean))} ±{fmt(d.ci)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(r.gridlockRate > 0 || c.gridlockRate > 0) && (
        <p className="hint">
          Gridlock in {Math.round(r.gridlockRate * 100)}% of runs before, {Math.round(c.gridlockRate * 100)}% now.
        </p>
      )}
      <p className="hint">
        {TEST_PLANS[outcome.plan].runs} runs of {outcome.span} each, after a warm-up. ± is the 95% confidence interval.
      </p>
    </div>
  );
}
