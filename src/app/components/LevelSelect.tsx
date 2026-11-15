import { useEffect } from 'react';
import { LEVELS } from '../../game/levels';
import { useApp } from '../store';
import { Stars } from './LevelPanel';

/** Level picker. A level unlocks once the one before it has at least one star. */
export function LevelSelect() {
  const show = useApp((s) => s.showLevels);
  const progress = useApp((s) => s.progress);
  const startLevel = useApp((s) => s.startLevel);
  const playSandbox = useApp((s) => s.playSandbox);
  const setShowLevels = useApp((s) => s.setShowLevels);
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowLevels(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, setShowLevels]);
  if (!show) return null;
  const total = LEVELS.reduce((s, l) => s + (progress[l.id] ?? 0), 0);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Choose a level" onClick={() => setShowLevels(false)}>
      <div className="level-select" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <h2>Levels</h2>
          <span className="hint">
            <span className="num">{total}</span> / {LEVELS.length * 3} ★
          </span>
        </header>
        <div className="level-grid">
          {LEVELS.map((level, i) => {
            const stars = progress[level.id] ?? 0;
            const locked = i > 0 && !(progress[LEVELS[i - 1]!.id] ?? 0);
            return (
              <button key={level.id} className={`level-card ${locked ? 'locked' : ''}`} disabled={locked} onClick={() => startLevel(level.id)}>
                <span className="level-num num">{i + 1}</span>
                <span className="level-title">{level.title}</span>
                <span className="level-brief">{locked ? 'Solve the previous level to unlock.' : level.brief}</span>
                <Stars n={stars} />
              </button>
            );
          })}
        </div>
        <div className="row gap">
          <button className="btn" onClick={playSandbox}>
            Open the sandbox instead
          </button>
          <button className="link" onClick={() => setShowLevels(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
