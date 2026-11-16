import { useEffect, useState } from 'react';
import { saveDesign } from '../../scenarios/storage';
import { useApp } from '../store';

/** Asks before something replaces a sandbox design that has unsaved changes. */
export function ReplaceDialog() {
  const pending = useApp((s) => s.pendingReplace);
  const scenario = useApp((s) => s.scenario);
  const { closeReplace, markSaved } = useApp.getState();
  const [name, setName] = useState('My junction');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!pending) return;
    setFailed(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeReplace();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, closeReplace]);
  if (!pending) return null;

  const go = () => {
    closeReplace();
    pending.run();
  };

  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="replace-title" onClick={closeReplace}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id="replace-title">{pending.what}?</h2>
        <p>This replaces your current junction. Your changes to it aren't saved yet and will be lost.</p>
        <div className="row gap">
          <input className="text" aria-label="Name to save it as" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <button
            className="btn primary"
            autoFocus
            onClick={() => {
              if (!saveDesign(name.trim() || 'My junction', scenario)) return setFailed(true);
              markSaved();
              go();
            }}
          >
            Save, then continue
          </button>
        </div>
        {failed && <p className="alert">This browser won't store designs (private window?). Export it from My designs instead.</p>}
        <div className="row gap confirm-actions">
          <button className="btn danger" onClick={go}>
            Continue without saving
          </button>
          <button className="link" onClick={closeReplace}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
