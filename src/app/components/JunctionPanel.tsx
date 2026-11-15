import { SHAPES, type Shape } from '../../scenarios/setup';
import { useApp } from '../store';
import { Segmented } from './Segmented';

export function JunctionPanel() {
  const setup = useApp((s) => s.setup);
  const update = useApp((s) => s.updateSetup);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Junction</h2>
        <span className="hint">Changes restart the traffic</span>
      </header>

      <div className="field">
        <label>Shape</label>
        <Segmented
          label="Shape"
          value={setup.shape}
          options={(Object.keys(SHAPES) as Shape[]).map((k) => ({ value: k, label: SHAPES[k].label }))}
          onChange={(shape) => update({ shape })}
        />
      </div>

      <div className="field">
        <label>Lanes each way</label>
        <Segmented label="Lanes" value={setup.lanes} options={[1, 2, 3].map((n) => ({ value: n as 1 | 2 | 3, label: String(n) }))} onChange={(lanes) => update({ lanes })} />
      </div>

      <div className="field">
        <label>Control</label>
        <Segmented
          label="Control"
          value={setup.control}
          options={[
            { value: 'right', label: 'Yield to right', title: 'No signs: give way to traffic from the right' },
            { value: 'major', label: 'Major road', title: 'The straight-through road has priority' },
            { value: 'signals', label: 'Signals' },
          ]}
          onChange={(control) => update({ control })}
        />
      </div>

      {setup.control === 'signals' && (
        <div className="field">
          <label htmlFor="green">
            Green per phase <span className="num">{setup.green}s</span>
          </label>
          <input id="green" type="range" min={10} max={60} step={5} value={setup.green} onChange={(e) => update({ green: Number(e.target.value) })} />
        </div>
      )}

      <div className="field">
        <label>Pedestrian crossings</label>
        <Segmented
          label="Crossings"
          value={setup.crosswalks}
          options={[
            { value: 'none', label: 'None' },
            { value: 'zebra', label: 'Zebra' },
            { value: 'signal', label: 'Signalised' },
          ]}
          onChange={(crosswalks) => update({ crosswalks })}
        />
      </div>

      <div className="field">
        <label>Traffic drives on the</label>
        <Segmented
          label="Drive side"
          value={setup.driveSide}
          options={[
            { value: 'right', label: 'Right' },
            { value: 'left', label: 'Left' },
          ]}
          onChange={(driveSide) => update({ driveSide })}
        />
      </div>
    </section>
  );
}
