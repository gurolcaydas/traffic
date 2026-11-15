import { legColor } from '../../render/theme';
import { useApp } from '../store';

const LOS_TEXT: Record<string, string> = {
  A: 'Free flow',
  B: 'Smooth',
  C: 'Steady',
  D: 'Getting busy',
  E: 'At capacity',
  F: 'Jammed',
};

const fmt = (s: number) => (s < 100 ? s.toFixed(1) : Math.round(s).toString());

export function MetricsPanel({ onReset }: { onReset: () => void }) {
  const m = useApp((s) => s.metrics);
  const setup = useApp((s) => s.setup);
  const legIds = m?.legs.map((l) => l.leg) ?? [];
  const maxQueue = Math.max(20, ...(m?.legs.map((l) => l.queue) ?? [0]));

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>How it's flowing</h2>
        <button className="link" onClick={onReset} title="Start measuring again from now">
          Reset stats
        </button>
      </header>

      {!m || m.window < 30 ? (
        <p className="hint">Measuring… give it a few seconds of simulated time.</p>
      ) : (
        <>
          <div className="los-row">
            <div className={`los los-${m.los}`} aria-label={`Level of service ${m.los}`}>
              {m.los}
            </div>
            <div>
              <div className="los-text">{m.gridlock ? 'Gridlock' : LOS_TEXT[m.los]}</div>
              <div className="hint">Level of service, from average delay{setup.control === 'signals' ? ' (signalised)' : ''}</div>
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
            {setup.crosswalks !== 'none' && (
              <div>
                <dt>Ped wait</dt>
                <dd>
                  <span className="num">{fmt(m.pedAvgWait)}</span> s
                </dd>
              </div>
            )}
          </dl>
        </>
      )}

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
