import type { MetricsSnapshot } from '../../sim/metrics';
import { legColor } from '../../render/theme';
import { useApp } from '../store';

export const LOS_TEXT: Record<string, string> = {
  A: 'Free flow',
  B: 'Smooth',
  C: 'Steady',
  D: 'Getting busy',
  E: 'At capacity',
  F: 'Jammed',
};

/** Metrics need this much simulated time before they mean anything. */
export const SETTLE = 30;

const fmt = (s: number) => (s < 100 ? s.toFixed(1) : Math.round(s).toString());

export function MetricsPanel({ onReset }: { onReset: () => void }) {
  const m = useApp((s) => s.metrics);
  const scenario = useApp((s) => s.scenario);
  const legIds = scenario.legs.map((l) => l.id);
  const maxQueue = Math.max(20, ...(m?.legs.map((l) => l.queue) ?? [0]));

  return (
    <section className="panel" id="flow">
      <header className="panel-head">
        <h2>How it's flowing</h2>
        <button className="link" onClick={onReset} title="Start measuring again from now">
          Reset stats
        </button>
      </header>

      {!m || m.window < SETTLE ? (
        <p className="hint">Measuring… give it a few seconds of simulated time.</p>
      ) : (
        <>
          <div className="los-row">
            <div className={`los los-${m.los}`} aria-label={`Level of service ${m.los}`}>
              {m.los}
            </div>
            <div>
              <div className="los-text">{m.gridlock ? 'Gridlock' : LOS_TEXT[m.los]}</div>
              <div className="hint">Level of service, from average delay{scenario.control.type === 'signals' ? ' (signalised)' : ''}</div>
            </div>
          </div>

          {m.gridlock && <p className="alert">Queues are spilling off the map. This junction can't cope with this traffic.</p>}

          <dl className="stats">
            <div>
              <dt>Avg delay</dt>
              <dd>
                <span className="num">{fmt(m.avgDelay)}</span> s
              </dd>
            </div>
            <div>
              <dt>Throughput</dt>
              <dd>
                <span className="num">{Math.round(m.throughputPerHour)}</span> veh/h
              </dd>
            </div>
            {(scenario.demand.pattern || m.window >= 1800) && (
              <div title="Average delay in the worst 15 minutes so far: the moment a design has to survive">
                <dt>Worst 15 min</dt>
                <dd>
                  <span className="num">{fmt(m.worst15Delay)}</span> s
                </dd>
              </div>
            )}
            {scenario.crosswalks.length > 0 && (
              <div>
                <dt>Ped wait</dt>
                <dd>
                  <span className="num">{fmt(m.pedAvgWait)}</span> s
                </dd>
              </div>
            )}
            {m.diverted > 0 && (
              <div title="Trips whose turn is banned: they had to go another way">
                <dt>Diverted</dt>
                <dd>
                  <span className="num">{Math.round((m.diverted / m.window) * 3600)}</span> veh/h
                </dd>
              </div>
            )}
          </dl>
        </>
      )}

      <Comparison current={m} />

      {m && (
        <table className="legs">
          <thead>
            <tr>
              <th>Leg</th>
              <th>Queue</th>
              <th className="r">Delay</th>
            </tr>
          </thead>
          <tbody>
            {m.legs.map((l) => (
              <tr key={l.leg}>
                <td>
                  <span className="leg-badge small" style={{ background: legColor(legIds.indexOf(l.leg)) }}>
                    {l.leg}
                  </span>
                </td>
                <td>
                  <div className="bar" title={`${l.queue} queued, max ${l.maxQueue}`}>
                    <div className={`bar-fill ${l.queue >= 15 ? 'bad' : ''}`} style={{ width: `${Math.min(100, (l.queue / maxQueue) * 100)}%` }} />
                    <span className="bar-label num">{l.queue}</span>
                  </div>
                </td>
                <td className="r num">{l.completed ? `${fmt(l.avgDelay)}s` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Before/after card: the design before the latest change against the design now. */
function Comparison({ current }: { current: MetricsSnapshot | null }) {
  const baseline = useApp((s) => s.baseline);
  const lastEdit = useApp((s) => s.lastEdit);
  if (!baseline || !lastEdit) return null;
  const before = baseline.metrics;
  const ready = current && current.window >= SETTLE;
  const delta = (now: number, was: number, lowerIsBetter: boolean, unit: string) => {
    const d = now - was;
    if (Math.abs(d) < 0.05 * Math.max(1, Math.abs(was))) return <span className="delta same">≈</span>;
    const better = lowerIsBetter ? d < 0 : d > 0;
    return (
      <span className={`delta ${better ? 'good' : 'bad'}`}>
        {d > 0 ? '+' : '−'}
        {fmt(Math.abs(d))}
        {unit}
      </span>
    );
  };

  return (
    <div className="compare">
      <div className="compare-head">
        <span>Before → after</span>
        <span className="hint" title="The comparison covers the latest change">
          {lastEdit}
        </span>
      </div>
      <table>
        <tbody>
          <tr>
            <th>Grade</th>
            <td>
              <span className={`los-chip los-${before.los}`}>{before.los}</span>
            </td>
            <td>{ready ? <span className={`los-chip los-${current.los}`}>{current.los}</span> : '…'}</td>
          </tr>
          <tr>
            <th>Avg delay</th>
            <td className="num">{fmt(before.avgDelay)}s</td>
            <td className="num">
              {ready ? (
                <>
                  {fmt(current.avgDelay)}s {delta(current.avgDelay, before.avgDelay, true, 's')}
                </>
              ) : (
                '…'
              )}
            </td>
          </tr>
          <tr>
            <th>Throughput</th>
            <td className="num">{Math.round(before.throughputPerHour)}</td>
            <td className="num">
              {ready ? (
                <>
                  {Math.round(current.throughputPerHour)} {delta(current.throughputPerHour, before.throughputPerHour, false, '')}
                </>
              ) : (
                '…'
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
