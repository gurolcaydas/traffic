import { LANGS, getLang, setLang, t } from '../../core/i18n';
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
        <span>{t('Traffic', 'Trafik')}</span>
        <span className="tag">{mode.kind === 'level' ? t('Level', 'Bölüm') : t('Sandbox', 'Serbest mod')}</span>
        <button className="btn" onClick={() => setShowLevels(true)}>
          ★ {t('Levels', 'Bölümler')}
        </button>
      </div>

      <div className="controls">
        <button className="btn primary" onClick={() => setPlaying(!playing)} aria-label={playing ? t('Pause', 'Duraklat') : t('Play', 'Oynat')}>
          {playing ? `❚❚ ${t('Pause', 'Duraklat')}` : `▶ ${t('Play', 'Oynat')}`}
        </button>
        <Segmented label={t('Speed', 'Hız')} value={speed} options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} onChange={setSpeed} />
        <button className="btn" onClick={restart} title={t('Clear the junction and start again', 'Kavşağı boşalt ve yeniden başlat')} aria-label={t('Restart', 'Yeniden başlat')}>
          ↺<span className="btn-label"> {t('Restart', 'Yeniden başlat')}</span>
        </button>
        <button className="btn" onClick={onFit} title={t('Fit the junction in view (or double-click the map)', 'Kavşağı ekrana sığdır (ya da haritaya çift tıklayın)')} aria-label={t('Fit', 'Sığdır')}>
          ⤢<span className="btn-label"> {t('Fit', 'Sığdır')}</span>
        </button>
        <span className="clock num" title={timeOfDay !== null ? t('Time of day', 'Günün saati') : t('Simulated time', 'Simülasyon süresi')}>
          {timeOfDay !== null ? formatClock(timeOfDay) : clockText(simTime)}
          {clock && (
            <span className="phase">
              {' · '}
              {t('phase', 'faz')} {clock.phase + 1}{' '}
              {clock.stage === 'green' ? t('green', 'yeşil') : clock.stage === 'amber' ? t('amber', 'sarı') : t('all-red', 'tüm kırmızı')}
            </span>
          )}
        </span>
        {metrics && metrics.window >= SETTLE && (
          <button
            className="flow-badge"
            title={t("How it's flowing: show details", 'Trafik akışı: ayrıntıları göster')}
            onClick={() => document.getElementById('flow')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            <span className={`los los-${metrics.los}`}>{metrics.los}</span>
            {metrics.gridlock ? t('Gridlock', 'Kilitlenme') : LOS_TEXT[metrics.los]!()}
          </button>
        )}
      </div>

      <div className="topbar-end">
        <Segmented label={t('Language', 'Dil')} value={getLang()} options={LANGS} onChange={setLang} />
        <Segmented<ThemeChoice>
          label={t('Theme', 'Tema')}
          value={theme}
          options={[
            { value: 'system', label: '◐', title: t('Theme: follow the system', 'Tema: sistemi izle') },
            { value: 'light', label: '☀', title: t('Theme: light', 'Tema: açık') },
            { value: 'dark', label: '☾', title: t('Theme: dark', 'Tema: koyu') },
          ]}
          onChange={setTheme}
        />
      </div>
    </header>
  );
}
