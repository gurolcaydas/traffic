import { useEffect, useRef, useState } from 'react';
import { deleteDesign, designFile, listDesigns, parseScenario, saveDesign, type SavedDesign } from '../../scenarios/storage';
import { useRules } from '../levelRules';
import { useApp } from '../store';

/** Save the sandbox design in this browser, load it back, or take it elsewhere as a file. */
export function DesignsPanel() {
  const rules = useRules();
  const scenario = useApp((s) => s.scenario);
  const savedDesign = useApp((s) => s.savedDesign);
  const { loadDesign, askReplace, markSaved } = useApp.getState();
  const [designs, setDesigns] = useState<SavedDesign[]>(() => listDesigns());
  const [name, setName] = useState('My junction');
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // A design saved from the "unsaved changes" question shows up here too.
  useEffect(() => setDesigns(listDesigns()), [savedDesign]);
  if (rules.inLevel) return null;

  const save = () => {
    const n = name.trim() || 'My junction';
    if (saveDesign(n, scenario)) {
      markSaved();
      setDesigns(listDesigns());
      setMessage({ text: `Saved “${n}”.` });
    } else setMessage({ text: "This browser won't store designs (private window?). Use Export instead.", bad: true });
  };

  const exportFile = () => {
    const n = name.trim() || 'My junction';
    const url = URL.createObjectURL(new Blob([designFile(n, scenario)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${n.replace(/[^\w-]+/g, '-').toLowerCase()}.traffic.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    try {
      const parsed = parseScenario(JSON.parse(await file.text()));
      if (!parsed.scenario) return setMessage({ text: parsed.error ?? 'Could not read that file.', bad: true });
      const n = parsed.name ?? file.name;
      askReplace(`Open “${n}”`, () => {
        loadDesign(parsed.scenario!);
        if (parsed.name) setName(parsed.name);
        setMessage({ text: `Opened “${n}”.` });
      });
    } catch {
      setMessage({ text: 'That file is not valid JSON.', bad: true });
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>My designs</h2>
        <span className="hint">Saved in this browser</span>
      </header>
      <div className="row gap">
        <input className="text" aria-label="Design name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>
      {message && <p className={message.bad ? 'alert' : 'hint'}>{message.text}</p>}
      {designs.length > 0 && (
        <ul className="design-list">
          {designs.map((d) => (
            <li key={d.id}>
              <span className="design-name">{d.name}</span>
              <span className="hint">
                {d.scenario.legs.length} roads · {new Date(d.savedAt).toLocaleDateString()}
              </span>
              <button className="link" onClick={() => askReplace(`Open “${d.name}”`, () => loadDesign(d.scenario))}>
                Open
              </button>
              <button
                className="link danger"
                aria-label={`Delete ${d.name}`}
                onClick={() => {
                  deleteDesign(d.id);
                  setDesigns(listDesigns());
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row gap">
        <button className="btn" onClick={exportFile} title="Download this design as a file">
          Export file
        </button>
        <button className="btn" onClick={() => fileInput.current?.click()} title="Open a design from a file">
          Import file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </section>
  );
}
