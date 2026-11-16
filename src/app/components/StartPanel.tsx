import { useState } from 'react';
import { SHAPES, type Shape } from '../../scenarios/setup';
import { useRules } from '../levelRules';
import { currentSetup, useApp } from '../store';
import { ImportDialog } from './ImportDialog';
import { Segmented } from './Segmented';

/** The first choice in the sandbox: what to start from. Each option replaces the current design. */
export function StartPanel() {
  const rules = useRules();
  const scenario = useApp((s) => s.scenario);
  const original = useApp((s) => s.originalDesign);
  const { newJunction, askReplace, loadDesign } = useApp.getState();
  const [importing, setImporting] = useState(false);
  if (rules.inLevel) return null;

  // Highlight the template only while the design still is that template.
  const fresh = scenario === original && !scenario.source;
  const shape = fresh ? currentSetup().shape : ('' as Shape);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Start</h2>
        <span className="hint">Each choice starts a new junction</span>
      </header>
      <div className="field">
        <label>Shape</label>
        <Segmented
          label="Shape"
          value={shape}
          options={(Object.keys(SHAPES) as Shape[]).map((k) => ({ value: k, label: SHAPES[k].label }))}
          onChange={(s) => askReplace(`Start over: ${SHAPES[s].label}`, () => newJunction({ shape: s }))}
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
          onChange={(driveSide) => driveSide !== scenario.driveSide && askReplace(`Start again driving on the ${driveSide}`, () => newJunction({ driveSide }))}
        />
      </div>
      <button className="btn real-junction" onClick={() => setImporting(true)}>
        🌍 Real junction from the map
      </button>
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onOpen={(s, label) => askReplace(`Open ${label}`, () => loadDesign(s))}
        />
      )}
    </section>
  );
}
