import type { LegSpec } from '../../core/types';
import { legColor } from '../../render/theme';
import { crossingOf, setCrossing, toggleBanned, toggleMajor, type CrossingChoice } from '../../scenarios/edit';
import { canRemoveLeg, removeLeg } from '../../scenarios/shape';
import { useRules } from '../levelRules';
import { useApp } from '../store';
import { Segmented } from './Segmented';

/** Edit one leg: its lanes, crossing, slip lane and which turns are allowed from it. */
export function LegInspector() {
  const scenario = useApp((s) => s.scenario);
  const legId = useApp((s) => s.selectedLeg);
  const edit = useApp((s) => s.edit);
  const selectLeg = useApp((s) => s.selectLeg);
  const rules = useRules();
  const index = scenario.legs.findIndex((l) => l.id === legId);
  const leg = scenario.legs[index];
  if (!leg) return null;

  const others = scenario.legs.filter((l) => l.id !== leg.id);
  const banned = new Set(leg.banned ?? []);
  const isMajor = scenario.control.type === 'priority' && scenario.control.major.includes(leg.id);
  const update = (label: string, change: (l: LegSpec) => void) =>
    edit(`Leg ${leg.id}: ${label}`, (d) => change(d.legs.find((l) => l.id === leg.id)!));

  return (
    <section className="panel inspector">
      <header className="panel-head">
        <h2>
          <span className="leg-badge small" style={{ background: legColor(index) }}>
            {leg.id}
          </span>{' '}
          Leg {leg.id}
        </h2>
        <button className="link" onClick={() => selectLeg(null)}>
          Done
        </button>
      </header>

      <div className="two-col">
        <div className="field">
          <label>Lanes in</label>
          <Segmented
            label="Lanes in"
            value={leg.lanesIn}
            options={[0, 1, 2, 3].map((n) => ({ value: n, label: String(n), disabled: !rules.lanes || n > rules.maxLanes(leg.id) }))}
            onChange={(n) => update(`${n} lanes in`, (l) => (l.lanesIn = n))}
          />
        </div>
        <div className="field">
          <label>Lanes out</label>
          <Segmented
            label="Lanes out"
            value={leg.lanesOut}
            options={[0, 1, 2, 3].map((n) => ({ value: n, label: String(n), disabled: !rules.lanes || n > rules.maxLanes(leg.id) }))}
            onChange={(n) => update(`${n} lanes out`, (l) => (l.lanesOut = n))}
          />
        </div>
      </div>

      {rules.crossings && (
      <div className="field">
        <label>Pedestrian crossing</label>
        <Segmented<CrossingChoice>
          label="Crossing"
          value={crossingOf(scenario, leg.id)}
          options={[
            { value: 'none', label: 'None', disabled: rules.crossingRequired(leg.id), title: rules.crossingRequired(leg.id) ? 'This crossing must stay' : undefined },
            { value: 'zebra', label: 'Zebra' },
            { value: 'signal', label: 'Signalised' },
          ]}
          onChange={(c) => edit(`Leg ${leg.id}: ${c === 'none' ? 'no crossing' : `${c} crossing`}`, (d) => setCrossing(d, leg.id, c))}
        />
      </div>
      )}

      {rules.bans && (
      <div className="field">
        <label>Allowed turns from this leg</label>
        <div className="chips">
          {others.map((to) => {
            const ok = !banned.has(to.id);
            return (
              <button
                key={to.id}
                className={`chip ${ok ? 'on' : 'off'}`}
                aria-pressed={ok}
                title={ok ? `Ban turning into ${to.id}` : `Allow turning into ${to.id}`}
                onClick={() => edit(`Leg ${leg.id}: ${ok ? 'ban' : 'allow'} turn to ${to.id}`, (d) => toggleBanned(d, leg.id, to.id))}
              >
                → {to.id}
              </button>
            );
          })}
        </div>
      </div>
      )}

      <div className="field toggles">
        {!rules.sideRoadBlocked(leg.id) && (
        <label className="toggle">
          <input type="checkbox" checked={!!leg.slipLane} onChange={(e) => update(e.target.checked ? 'side road built' : 'side road removed', (l) => (l.slipLane = e.target.checked))} />
          Side road: turn into the next road without entering the junction
        </label>
        )}
        {!rules.inLevel && canRemoveLeg(scenario) && (
          <button
            className="link danger"
            onClick={() => {
              selectLeg(null);
              edit(`Removed road ${leg.id}`, (d) => removeLeg(d, leg.id));
            }}
          >
            Remove this road
          </button>
        )}
        {scenario.control.type === 'priority' && rules.controls.includes('major') && (
          <label className="toggle">
            <input type="checkbox" checked={isMajor} onChange={() => edit(`Leg ${leg.id}: ${isMajor ? 'minor' : 'major'} road`, (d) => toggleMajor(d, leg.id))} />
            Part of the major road (has priority)
          </label>
        )}
      </div>
    </section>
  );
}
