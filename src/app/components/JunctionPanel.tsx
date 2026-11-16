import { SHAPES, type Shape } from '../../scenarios/setup';
import {
  controlChoice,
  crossingOf,
  flyoverCandidates,
  hasFlyover,
  setAllCrossings,
  setAllLanes,
  setCrossing,
  setControl,
  sideRoadCandidates,
  toggleFlyover,
  toggleSideRoad,
  type CrossingChoice,
} from '../../scenarios/edit';
import { useRef } from 'react';
import type { Scenario } from '../../core/types';
import { useRules } from '../levelRules';
import { currentSetup, useApp } from '../store';
import { Segmented } from './Segmented';

const CONTROL_LABEL = { right: 'yield to right', major: 'major road', signals: 'signals', roundabout: 'roundabout' } as const;

export function JunctionPanel() {
  const scenario = useApp((s) => s.scenario);
  const edit = useApp((s) => s.edit);
  const newJunction = useApp((s) => s.newJunction);
  const setup = currentSetup();
  const rules = useRules();
  const editShape = useApp((s) => s.editShape);
  const setEditShape = useApp((s) => s.setEditShape);

  // Values shown for "all legs" controls: the shared value, or nothing if legs differ.
  const lanes = scenario.legs.every((l) => l.lanesIn === scenario.legs[0]!.lanesIn) ? scenario.legs[0]!.lanesIn : -1;
  const crossing = scenario.legs.every((l) => crossingOf(scenario, l.id) === crossingOf(scenario, scenario.legs[0]!.id))
    ? crossingOf(scenario, scenario.legs[0]!.id)
    : ('mixed' as const);
  const flyovers = flyoverCandidates(scenario);
  const sideRoads = sideRoadCandidates(scenario);
  const turnGlyph = scenario.driveSide === 'right' ? '↱' : '↰';

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Junction</h2>
        <span className="hint">Changes apply while traffic runs</span>
      </header>

      {!rules.inLevel && (
        <div className="row gap shape-toggle">
          <button className={`btn ${editShape ? 'primary' : ''}`} aria-pressed={editShape} onClick={() => setEditShape(!editShape)}>
            ✎ {editShape ? 'Done editing shape' : 'Edit shape'}
          </button>
          {editShape && <span className="hint">Drag a ⟲ handle to turn a road, + to add one, × to remove one, − and + to change its lanes (up to 4 each way). Click 🚶 on a road to add, change or remove its crossing.</span>}
        </div>
      )}

      <QuickSwitches />

      <div className="field">
        <label>Control</label>
        <Segmented
          label="Control"
          value={controlChoice(scenario)}
          options={[
            { value: 'right' as const, label: 'Yield to right', title: 'No signs: give way to traffic from the right' },
            { value: 'major' as const, label: 'Major road', title: 'The straightest road has priority' },
            { value: 'signals' as const, label: 'Signals' },
            { value: 'roundabout' as const, label: 'Roundabout', title: 'Entering traffic gives way to traffic already on the ring' },
          ].filter((o) => rules.controls.includes(o.value))}
          onChange={(choice) => edit(`Control: ${CONTROL_LABEL[choice]}`, (d) => setControl(d, choice))}
        />
      </div>

      {!rules.inLevel && (
      <div className="field">
        <label>Lanes each way, all legs</label>
        <Segmented
          label="Lanes"
          value={lanes}
          options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
          onChange={(n) => edit(`${n} lane${n > 1 ? 's' : ''} on every leg`, (d) => setAllLanes(d, n))}
        />
      </div>
      )}

      {!rules.inLevel && (
      <div className="field">
        <label>Pedestrian crossings, all legs</label>
        <Segmented<CrossingChoice | 'mixed'>
          label="Crossings"
          value={crossing}
          options={[
            { value: 'none', label: 'None' },
            { value: 'zebra', label: 'Zebra' },
            { value: 'signal', label: 'Signalised' },
          ]}
          onChange={(c) => c !== 'mixed' && edit(c === 'none' ? 'No crossings' : `${c === 'zebra' ? 'Zebra' : 'Signalised'} crossings`, (d) => setAllCrossings(d, c))}
        />
      </div>
      )}

      {rules.sideRoads && (
      <div className="field">
        <label>Side roads (turn into the next road without entering the junction)</label>
        <div className="chips">
          {sideRoads.map(({ from, to }) => {
            const on = !!scenario.legs.find((l) => l.id === from)?.slipLane;
            const blocked = rules.sideRoadBlocked(from);
            return (
              <button
                key={from}
                className={`chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                disabled={blocked && !on}
                title={blocked ? 'A building is in the way' : `Side road from ${from} into ${to}`}
                onClick={() => edit(`${on ? 'Removed' : 'Built'} side road ${from}→${to}`, (d) => toggleSideRoad(d, from))}
              >
                {from} {turnGlyph} {to}
              </button>
            );
          })}
        </div>
      </div>
      )}

      {rules.flyover && flyovers.length > 0 && (
        <div className="field">
          <label>Flyover (straight-through traffic on a bridge)</label>
          <div className="chips">
            {flyovers.map((pair) => {
              const on = hasFlyover(scenario, pair);
              return (
                <button
                  key={pair.join()}
                  className={`chip ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  onClick={() => edit(`${on ? 'Removed' : 'Built'} flyover ${pair[0]}–${pair[1]}`, (d) => toggleFlyover(d, pair))}
                >
                  {pair[0]} ⇄ {pair[1]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="hint tip">Click a leg on the map to change its lanes, crossing or allowed turns.</p>

      {!rules.inLevel && (
      <details className="start-over">
        <summary>Start over with a new junction</summary>
        <div className="field">
          <label>Shape</label>
          <Segmented
            label="Shape"
            value={setup.shape}
            options={(Object.keys(SHAPES) as Shape[]).map((k) => ({ value: k, label: SHAPES[k].label }))}
            onChange={(shape) => newJunction({ shape })}
          />
        </div>
        <div className="field">
          <label>Traffic drives on the</label>
          <Segmented
            label="Drive side"
            value={scenario.driveSide}
            options={[
              { value: 'right', label: 'Right' },
              { value: 'left', label: 'Left' },
            ]}
            onChange={(driveSide) => newJunction({ driveSide })}
          />
        </div>
        <p className="hint">These restart the traffic and clear your changes.</p>
      </details>
      )}
    </section>
  );
}

/**
 * Two on/off switches for the things people most often try first: pedestrians and traffic lights.
 * Switching off remembers what was there, so switching back on restores it.
 */
function QuickSwitches() {
  const scenario = useApp((s) => s.scenario);
  const edit = useApp((s) => s.edit);
  const rules = useRules();
  const lastCrossings = useRef<Scenario['crosswalks']>([]);
  const lastControl = useRef<Exclude<ReturnType<typeof controlChoice>, 'signals'>>('major');

  const walkers = scenario.crosswalks.length > 0;
  const lights = scenario.control.type === 'signals';
  const otherControls = rules.controls.filter((c) => c !== 'signals');
  const canLights = rules.controls.includes('signals') && otherControls.length > 0;
  if (rules.inLevel && !canLights) return null;

  const togglePeople = () => {
    if (walkers) {
      lastCrossings.current = scenario.crosswalks;
      edit('Pedestrians off', (d) => setAllCrossings(d, 'none'));
      return;
    }
    // Bring back the crossings that were there, or a full set to suit the control.
    const legs = new Set(scenario.legs.map((l) => l.id));
    const before = lastCrossings.current.filter((c) => legs.has(c.leg));
    edit('Pedestrians on', (d) => {
      if (!before.length) return setAllCrossings(d, d.control.type === 'signals' ? 'signal' : 'zebra');
      for (const c of before) setCrossing(d, c.leg, c.type);
    });
  };

  const toggleLights = () => {
    if (lights) {
      const back = otherControls.includes(lastControl.current) ? lastControl.current : otherControls[0]!;
      edit('Traffic lights off', (d) => {
        setControl(d, back);
        // Crossings with lights need lights: they become zebras.
        for (const c of d.crosswalks) if (c.type === 'signal') setCrossing(d, c.leg, 'zebra');
      });
      return;
    }
    const was = controlChoice(scenario);
    if (was !== 'signals') lastControl.current = was;
    edit('Traffic lights on', (d) => {
      setControl(d, 'signals');
      for (const c of d.crosswalks) if (c.type === 'zebra') setCrossing(d, c.leg, 'signal');
    });
  };

  return (
    <div className="quick-switches">
      {!rules.inLevel && <Switch label="Pedestrians" on={walkers} onChange={togglePeople} />}
      {canLights && <Switch label="Traffic lights" on={lights} onChange={toggleLights} />}
    </div>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={onChange}>
      <span className="track">
        <span className="thumb" />
      </span>
      {label}
    </button>
  );
}
