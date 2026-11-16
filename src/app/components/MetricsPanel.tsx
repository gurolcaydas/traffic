import { t } from '../../core/i18n';
import type { MetricsSnapshot } from '../../sim/metrics';
import { legColor } from '../../render/theme';
import { useApp } from '../store';
import { TrendChart } from './TrendChart';

export const LOS_TEXT: Record<string, () => string> = {
  A: () => t('Free flow', 'Serbest akış'),
  B: () => t('Smooth', 'Akıcı'),
  C: () => t('Steady', 'Düzenli'),
  D: () => t('Getting busy', 'Yoğunlaşıyor'),
  E: () => t('At capacity', 'Kapasite sınırında'),
  F: () => t('Jammed', 'Tıkalı'),
};

/** Metrics need this much simulated time before they mean anything. */
export const SETTLE = 30;

const fmt = (s: number) => (s < 100 ? s.toFixed(1) : Math.round(s).toString());

export function MetricsPanel({ onReset }: { onReset: () => void }) {
  const m = useApp((s) => s.metrics);
  const trend = useApp((s) => s.trend);
  const scenario = useApp((s) => s.scenario);
  const legIds = scenario.legs.map((l) => l.id);
  const maxQueue = Math.max(20, ...(m?.legs.map((l) => l.queue) ?? [0]));

  return (
    <section className="panel" id="flow">
      <header className="panel-head">
        <h2>{t("How it's flowing", 'Trafik akışı')}</h2>
        <button className="link" onClick={onReset} title={t('Start measuring again from now', 'Ölçümü şimdiden yeniden başlat')}>
          {t('Reset stats', 'İstatistikleri sıfırla')}
        </button>
      </header>

      {!m || m.window < SETTLE ? (
        <p className="hint">{t('Measuring… give it a few seconds of simulated time.', 'Ölçülüyor… birkaç saniyelik simülasyon süresi bekleyin.')}</p>
      ) : (
        <>
          <div className="los-row">
            <div className={`los los-${m.los}`} aria-label={`${t('Level of service', 'Hizmet düzeyi')} ${m.los}`}>
              {m.los}
            </div>
            <div>
              <div className="los-text">{m.gridlock ? t('Gridlock', 'Kilitlenme') : LOS_TEXT[m.los]!()}</div>
              <div className="hint">
                {t('Level of service, from average delay', 'Ortalama gecikmeye göre hizmet düzeyi')}
                {scenario.control.type === 'signals' ? t(' (signalised)', ' (ışıklı)') : ''}
              </div>
            </div>
          </div>

          {m.gridlock ? (
            <p className="alert">
              {t(
                'Gridlock: drivers are blocking each other and nobody can get through the junction.',
                'Kilitlenme: sürücüler birbirini tıkıyor ve kimse kavşaktan geçemiyor.',
              )}
            </p>
          ) : (
            m.overloaded && (
              <p className="alert">
                {t(
                  "Queues are spilling off the map. This junction can't cope with this much traffic.",
                  'Kuyruklar haritanın dışına taşıyor. Bu kavşak bu kadar trafiği kaldıramıyor.',
                )}
              </p>
            )
          )}

          <dl className="stats">
            <div>
              <dt>{t('Avg delay', 'Ort. gecikme')}</dt>
              <dd>
                <span className="num">{fmt(m.avgDelay)}</span> s
              </dd>
            </div>
            <div>
              <dt>{t('Throughput', 'Geçen araç')}</dt>
              <dd>
                <span className="num">{Math.round(m.throughputPerHour)}</span> {t('veh/h', 'araç/sa')}
              </dd>
            </div>
            {(scenario.demand.pattern || m.window >= 1800) && (
              <div title={t('Average delay in the worst 15 minutes so far: the moment a design has to survive', 'Şimdiye kadarki en kötü 15 dakikadaki ortalama gecikme: tasarımın dayanması gereken an')}>
                <dt>{t('Worst 15 min', 'En kötü 15 dk')}</dt>
                <dd>
                  <span className="num">{fmt(m.worst15Delay)}</span> s
                </dd>
              </div>
            )}
            {scenario.crosswalks.length > 0 && (
              <div>
                <dt>{t('Ped wait', 'Yaya bekleme')}</dt>
                <dd>
                  <span className="num">{fmt(m.pedAvgWait)}</span> s
                </dd>
              </div>
            )}
            {m.diverted > 0 && (
              <div title={t('Trips whose turn is banned: they had to go another way', 'Dönüşü yasak olan yolculuklar: başka yoldan gitmek zorunda kaldılar')}>
                <dt>{t('Diverted', 'Yönlendirilen')}</dt>
                <dd>
                  <span className="num">{Math.round((m.diverted / m.window) * 3600)}</span> {t('veh/h', 'araç/sa')}
                </dd>
              </div>
            )}
          </dl>
        </>
      )}

      <TrendChart samples={trend} />

      <Comparison current={m} />

      {m && (
        <table className="legs">
          <thead>
            <tr>
              <th>{t('Leg', 'Yol')}</th>
              <th>{t('Queue', 'Kuyruk')}</th>
              <th className="r">{t('Delay', 'Gecikme')}</th>
            </tr>
          </thead>
          <tbody>
            {m.legs.map((l) => (
              <tr key={l.leg}>
                <td>
                  <span className="leg-badge small" style={{ background: legColor(legIds.indexOf(l.leg)) }}>
                    {l.leg}
                  </span>
                </td>
                <td>
                  <div className="bar" title={t(`${l.queue} queued, max ${l.maxQueue}`, `${l.queue} araç kuyrukta, en çok ${l.maxQueue}`)}>
                    <div className={`bar-fill ${l.queue >= 15 ? 'bad' : ''}`} style={{ width: `${Math.min(100, (l.queue / maxQueue) * 100)}%` }} />
                    <span className="bar-label num">{l.queue}</span>
                  </div>
                </td>
                <td className="r num">{l.completed ? `${fmt(l.avgDelay)}s` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Before/after card: the design before the latest change against the design now. */
function Comparison({ current }: { current: MetricsSnapshot | null }) {
  const baseline = useApp((s) => s.baseline);
  const lastEdit = useApp((s) => s.lastEdit);
  if (!baseline || !lastEdit) return null;
  const before = baseline.metrics;
  const ready = current && current.window >= SETTLE;
  const delta = (now: number, was: number, lowerIsBetter: boolean, unit: string) => {
    const d = now - was;
    if (Math.abs(d) < 0.05 * Math.max(1, Math.abs(was))) return <span className="delta same">≈</span>;
    const better = lowerIsBetter ? d < 0 : d > 0;
    return (
      <span className={`delta ${better ? 'good' : 'bad'}`}>
        {d > 0 ? '+' : '−'}
        {fmt(Math.abs(d))}
        {unit}
      </span>
    );
  };

  return (
    <div className="compare">
      <div className="compare-head">
        <span>{t('Before → after', 'Önce → sonra')}</span>
        <span className="hint" title={t('The comparison covers the latest change', 'Karşılaştırma son değişikliği kapsar')}>
          {lastEdit}
        </span>
      </div>
      <table>
        <tbody>
          <tr>
            <th>{t('Grade', 'Not')}</th>
            <td>
              <span className={`los-chip los-${before.los}`}>{before.los}</span>
            </td>
            <td>{ready ? <span className={`los-chip los-${current.los}`}>{current.los}</span> : '…'}</td>
          </tr>
          <tr>
            <th>{t('Avg delay', 'Ort. gecikme')}</th>
            <td className="num">{fmt(before.avgDelay)}s</td>
            <td className="num">
              {ready ? (
                <>
                  {fmt(current.avgDelay)}s {delta(current.avgDelay, before.avgDelay, true, 's')}
                </>
              ) : (
                '…'
              )}
            </td>
          </tr>
          <tr>
            <th>{t('Throughput', 'Geçen araç')}</th>
            <td className="num">{Math.round(before.throughputPerHour)}</td>
            <td className="num">
              {ready ? (
                <>
                  {Math.round(current.throughputPerHour)} {delta(current.throughputPerHour, before.throughputPerHour, false, '')}
                </>
              ) : (
                '…'
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
