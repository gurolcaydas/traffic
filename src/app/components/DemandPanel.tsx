import { legsFor } from '../../scenarios/setup';
import { legColor } from '../../render/theme';
import { useApp } from '../store';

const Badge = ({ i, id }: { i: number; id: string }) => (
  <span className="leg-badge small" style={{ background: legColor(i) }}>
    {id}
  </span>
);

/** Origin–destination table: vehicles per hour from each leg (rows) to each leg (columns). */
export function DemandPanel() {
  const setup = useApp((s) => s.setup);
  const demand = useApp((s) => s.demand);
  const setVeh = useApp((s) => s.setVehicleDemand);
  const setPed = useApp((s) => s.setPedDemand);
  const scaleDemand = useApp((s) => s.scaleDemand);
  const legs = legsFor(setup);
  const value = (from: string, to: string) => demand.vehicles.find((d) => d.from === from && d.to === to)?.vehPerHour ?? 0;
  const total = demand.vehicles.reduce((s, d) => s + d.vehPerHour, 0);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Traffic</h2>
        <span className="hint">
          <span className="num">{total}</span> veh/h total
        </span>
      </header>

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
                  <td key={to.id}>
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

      {setup.crosswalks !== 'none' && (
        <div className="field">
          <label>Pedestrians per hour, per crossing</label>
          <div className="ped-grid">
            {legs.map((l, i) => (
              <label key={l.id} className="ped-cell">
                <Badge i={i} id={l.id} />
                <input
                  type="number"
                  min={0}
                  step={10}
                  aria-label={`Pedestrians per hour crossing leg ${l.id}`}
                  value={demand.pedestrians.find((p) => p.leg === l.id)?.pedPerHour ?? 0}
                  onChange={(e) => setPed(l.id, Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
