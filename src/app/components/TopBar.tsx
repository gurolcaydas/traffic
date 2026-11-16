import { formatClock } from '../../scenarios/patterns';
import { useApp, type ThemeChoice } from '../store';
import { LOS_TEXT, SETTLE } from './MetricsPanel';
import { Segmented } from './Segmented';

// Close watching, normal viewing, fast-forward, and a whole day in a few minutes.
const SPEEDS = [1, 2, 4, 16, 64];

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
  const timeOfDay = useApp((s) => s.timeOfDay);
  const theme = useApp((s) => s.theme);
  const mode = useApp((s) => s.mode);
  const metrics = useApp((s) => s.metrics);
  const { setPlaying, setSpeed, restart, setTheme, setShowLevels } = useApp.getState();

  return (
    <header className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 2v20M2 12h20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4.5" fill="var(--accent)" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span>Traffic</span>
        <span className="tag">{mode.kind === 'level' ? 'Level' : 'Sandbox'}</span>
        <button className="btn" onClick={() => setShowLevels(true)}>
          ★ Levels
        </button>
      </div>

      <div className="controls">
        <button className="btn primary" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <Segmented label="Speed" value={speed} options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} onChange={setSpeed} />
        <button className="btn" onClick={restart} title="Clear the junction and start again" aria-label="Restart">
          ↺<span className="btn-label"> Restart</span>
        </button>
        <button className="btn" onClick={onFit} title="Fit the junction in view (or double-click the map)" aria-label="Fit">
          ⤢<span className="btn-label"> Fit</span>
        </button>
        <span className="clock num" title={timeOfDay !== null ? 'Time of day' : 'Simulated time'}>
          {timeOfDay !== null ? formatClock(timeOfDay) : clockText(simTime)}
          {clock && (
            <span className="phase">
              {' · '}phase {clock.phase + 1} {clock.stage === 'green' ? 'green' : clock.stage === 'amber' ? 'amber' : 'all-red'}
            </span>
          )}
        </span>
        {metrics && metrics.window >= SETTLE && (
          <button
            className="flow-badge"
            title="How it's flowing: show details"
            onClick={() => document.getElementById('flow')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            <span className={`los los-${metrics.los}`}>{metrics.los}</span>
            {metrics.gridlock ? 'Gridlock' : LOS_TEXT[metrics.los]}
          </button>
        )}
      </div>

      <Segmented<ThemeChoice>
        label="Theme"
        value={theme}
        options={[
          { value: 'system', label: '◐', title: 'Theme: follow the system' },
          { value: 'light', label: '☀', title: 'Theme: light' },
          { value: 'dark', label: '☾', title: 'Theme: dark' },
        ]}
        onChange={setTheme}
      />
    </header>
  );
}
