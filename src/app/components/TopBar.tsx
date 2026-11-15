import { useApp, type ThemeChoice } from '../store';
import { Segmented } from './Segmented';

const SPEEDS = [1, 2, 4, 8, 16];

const clockText = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export function TopBar({ onFit }: { onFit: () => void }) {
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const simTime = useApp((s) => s.simTime);
  const clock = useApp((s) => s.clock);
  const theme = useApp((s) => s.theme);
  const { setPlaying, setSpeed, restart, setTheme } = useApp.getState();

  return (
    <header className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 2v20M2 12h20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4.5" fill="var(--accent)" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span>Traffic</span>
        <span className="tag">Sandbox</span>
      </div>

      <div className="controls">
        <button className="btn primary" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <Segmented label="Speed" value={speed} options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} onChange={setSpeed} />
        <button className="btn" onClick={restart} title="Clear the junction and start again">
          ↺ Restart
        </button>
        <button className="btn" onClick={onFit} title="Fit the junction in view (or double-click the map)">
          ⤢ Fit
        </button>
        <span className="clock num" title="Simulated time">
          {clockText(simTime)}
          {clock && (
            <span className="phase">
              {' · '}phase {clock.phase + 1} {clock.stage === 'green' ? 'green' : clock.stage === 'amber' ? 'amber' : 'all-red'}
            </span>
          )}
        </span>
      </div>

      <Segmented<ThemeChoice>
        label="Theme"
        value={theme}
        options={[
          { value: 'system', label: 'Auto' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        onChange={setTheme}
      />
    </header>
  );
}
