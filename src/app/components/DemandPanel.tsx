import { legColor } from '../../render/theme';
import { PATTERNS } from '../../scenarios/patterns';
import { useApp } from '../store';
import { DayChart } from './DayChart';
import { Segmented } from './Segmented';

const Badge = ({ i, id }: { i: number; id: string }) => (
  <span className="leg-badge small" style={{ background: legColor(i) }}>
    {id}
  </span>
);

/** Origin–destination table: vehicles per hour from each leg (rows) to each leg (columns). */
export function DemandPanel() {
  const scenario = useApp((s) => s.scenario);
  const setVeh = useApp((s) => s.setVehicleDemand);
  const setPed = useApp((s) => s.setPedDemand);
  const scaleDemand = useApp((s) => s.scaleDemand);
  const setPattern = useApp((s) => s.setPattern);
  const setCentreLeg = useApp((s) => s.setCentreLeg);
  const jumpToHour = useApp((s) => s.jumpToHour);
  const timeOfDay = useApp((s) => s.timeOfDay);
  const { legs, demand } = scenario;
  const pattern = demand.pattern;
  const preset = pattern ? PATTERNS[pattern.id] : undefined;
  const value = (from: string, to: string) => demand.vehicles.find((d) => d.from === from && d.to === to)?.vehPerHour ?? 0;
  const total = demand.vehicles.reduce((s, d) => s + d.vehPerHour, 0);
  const banned = (from: string, to: string) => legs.find((l) => l.id === from)?.banned?.includes(to) ?? false;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Traffic</h2>
        <span className="hint">
          <span className="num">{total}</span> veh/h {pattern ? 'at peak' : 'total'}
        </span>
      </header>

      <div className="field">
        <label>Through the day</label>
        <Segmented<string>
          label="Traffic pattern"
          value={pattern?.id ?? 'flat'}
          options={[{ value: 'flat', label: 'Constant', title: 'The table, all day long' }, ...Object.entries(PATTERNS).map(([id, p]) => ({ value: id, label: p.label, title: p.description }))]}
          onChange={(id) => setPattern(id === 'flat' ? null : id)}
        />
      </div>

      {pattern && preset && (
        <>
          <p className="hint">{preset.description} The table below is the peak-hour traffic.</p>
          {preset.tidal && (
            <div className="field inline-field">
              <label>{preset.centreLabel}</label>
              <div className="chips">
                {legs.map((l, i) => (
                  <button
                    key={l.id}
                    className={`chip ${pattern.centreLeg === l.id ? 'on' : ''}`}
                    aria-pressed={pattern.centreLeg === l.id}
                    onClick={() => setCentreLeg(l.id)}
                    style={pattern.centreLeg === l.id ? undefined : { borderColor: legColor(i) }}
                  >
                    {l.id}
                  </button>
                ))}
              </div>
            </div>
          )}
          <DayChart pattern={pattern} now={timeOfDay} onJump={jumpToHour} />
        </>
      )}

      <table className="od">
        <thead>
          <tr>
            <th className="corner">from \ to</th>
            {legs.map((l, j) => (
              <th key={l.id}>
                <Badge i={j} id={l.id} />
              </th>
            ))}
            <th className="sum">Σ</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((from, i) => (
            <tr key={from.id}>
              <th>
                <Badge i={i} id={from.id} />
              </th>
              {legs.map((to) =>
                to.id === from.id ? (
                  <td key={to.id} className="diag" />
                ) : (
                  <td key={to.id} className={banned(from.id, to.id) ? 'banned' : ''} title={banned(from.id, to.id) ? 'Turn banned: these trips divert elsewhere' : undefined}>
                    <input
                      type="number"
                      min={0}
                      step={10}
                      aria-label={`Vehicles per hour from ${from.id} to ${to.id}`}
                      value={value(from.id, to.id)}
                      onChange={(e) => setVeh(from.id, to.id, Math.max(0, Number(e.target.value) || 0))}
                    />
                  </td>
                ),
              )}
              <td className="sum num">{legs.reduce((s, to) => s + (to.id === from.id ? 0 : value(from.id, to.id)), 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row gap">
        <button className="btn" onClick={() => scaleDemand(0.8)}>
          −20%
        </button>
        <button className="btn" onClick={() => scaleDemand(1.25)}>
          +25%
        </button>
        <span className="hint">Applies live: watch the queues react.</span>
      </div>

      {scenario.crosswalks.length > 0 && (
        <div className="field">
          <label>Pedestrians per hour, per crossing</label>
          <div className="ped-grid">
            {scenario.crosswalks.map((c) => {
              const i = legs.findIndex((l) => l.id === c.leg);
              return (
                <label key={c.leg} className="ped-cell">
                  <Badge i={i} id={c.leg} />
                  <input
                    type="number"
                    min={0}
                    step={10}
                    aria-label={`Pedestrians per hour crossing leg ${c.leg}`}
                    value={demand.pedestrians.find((p) => p.leg === c.leg)?.pedPerHour ?? 0}
                    onChange={(e) => setPed(c.leg, Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
