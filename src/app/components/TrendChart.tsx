import { useState } from 'react';
import { t } from '../../core/i18n';
import type { TrendSample } from '../../sim/simulation';
import { Segmented } from './Segmented';

const W = 320;
const H = 110;
const M = { left: 34, right: 10, top: 12, bottom: 18 };
/** Seconds of history on screen. */
const SPAN = 600;
/** Delay is averaged over this many seconds, so a single slow car doesn't spike the line. */
const DELAY_SPAN = 60;
/** The trend compares the latest this-many seconds with the same stretch before it. */
const TREND_SPAN = 120;

type Mode = 'queue' | 'delay';

interface Point {
  time: number;
  value: number | null;
  edit: boolean;
}

/** Queued vehicles, or the average delay over the last minute, at each sample. */
function series(samples: readonly TrendSample[], mode: Mode): Point[] {
  return samples.map((s, i) => {
    if (mode === 'queue') return { time: s.time, value: s.queued, edit: !!s.edit };
    let j = i;
    while (j > 0 && s.time - samples[j]!.time < DELAY_SPAN) j--;
    const back = samples[j]!;
    const arrived = s.arrived - back.arrived;
    const enough = s.time - back.time >= DELAY_SPAN - 1 && arrived >= 3;
    return { time: s.time, value: enough ? (s.lost - back.lost) / arrived : null, edit: !!s.edit };
  });
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Rising, falling or steady: the latest two minutes against the two before. Null until there's enough history. */
function direction(points: Point[], mode: Mode): 'up' | 'down' | 'flat' | null {
  const last = points[points.length - 1];
  if (!last) return null;
  const valuesIn = (from: number, to: number) => points.filter((p) => p.time > from && p.time <= to && p.value !== null).map((p) => p.value!);
  const recent = valuesIn(last.time - TREND_SPAN, last.time);
  const before = valuesIn(last.time - 2 * TREND_SPAN, last.time - TREND_SPAN);
  if (recent.length < 6 || before.length < 6) return null;
  const now = mean(recent);
  const was = mean(before);
  // Small wobbles are noise: a couple of cars, or a few seconds.
  const threshold = Math.max(mode === 'queue' ? 2 : 3, 0.15 * was);
  if (now - was > threshold) return 'up';
  if (was - now > threshold) return 'down';
  return 'flat';
}

/** A round number at or above `v`, for the top of the axis. */
function niceMax(v: number) {
  for (const step of [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (v <= step) return step;
  return Math.ceil(v / 1000) * 1000;
}

/**
 * The last ten minutes of queues or delay, live, so you can see whether a junction is clearing or
 * filling up. Dashed lines mark where the design was changed.
 */
export function TrendChart({ samples }: { samples: readonly TrendSample[] }) {
  const [mode, setMode] = useState<Mode>('queue');
  const [hover, setHover] = useState<number | null>(null);
  const all = series(samples, mode);
  const last = all[all.length - 1];
  if (!last || all.length < 2) return null;

  const end = last.time;
  const start = end - SPAN;
  const points = all.filter((p) => p.time >= start - 5);
  const yMax = niceMax(Math.max(mode === 'queue' ? 10 : 20, ...points.map((p) => p.value ?? 0)));
  const x = (time: number) => M.left + ((time - start) / SPAN) * (W - M.left - M.right);
  const y = (v: number) => M.top + (1 - v / yMax) * (H - M.top - M.bottom);
  const clampX = (time: number) => Math.max(M.left, x(time));

  // A line broken wherever there's no value yet (delay needs a minute of history).
  let path = '';
  let open = false;
  for (const p of points) {
    if (p.value === null) {
      open = false;
      continue;
    }
    path += `${open ? 'L' : 'M'}${clampX(p.time).toFixed(1)},${y(p.value).toFixed(1)}`;
    open = true;
  }
  const valued = points.filter((p) => p.value !== null);
  const area = valued.length > 1 ? `${path}L${clampX(valued[valued.length - 1]!.time).toFixed(1)},${y(0)}L${clampX(valued[0]!.time).toFixed(1)},${y(0)}Z` : '';

  const trend = direction(all, mode);
  const unit = mode === 'queue' ? t('veh', 'araç') : 's';
  const show = (v: number | null) => (v === null ? '–' : mode === 'queue' ? Math.round(v).toString() : v < 100 ? v.toFixed(1) : Math.round(v).toString());
  const ago = (time: number) => {
    const s = Math.round(end - time);
    if (s < 5) return t('now', 'şimdi');
    return s < 60 ? t(`${s} s ago`, `${s} sn önce`) : t(`${Math.floor(s / 60)} min ${s % 60} s ago`, `${Math.floor(s / 60)} dk ${s % 60} sn önce`);
  };
  const hovered = hover === null ? null : points.reduce((a, b) => (Math.abs(b.time - hover) < Math.abs(a.time - hover) ? b : a));
  const timeAt = (clientX: number, rect: DOMRect) => start + ((((clientX - rect.left) / rect.width) * W - M.left) / (W - M.left - M.right)) * SPAN;

  const what = mode === 'queue' ? t('Vehicles queued', 'Kuyruktaki araç') : t('Average delay over the last minute', 'Son dakikadaki ortalama gecikme');
  const trendText = {
    up: { icon: '↑', text: t('Getting worse', 'Kötüleşiyor'), cls: 'bad' },
    down: { icon: '↓', text: t('Improving', 'İyileşiyor'), cls: 'good' },
    flat: { icon: '→', text: t('Steady', 'Sabit'), cls: 'same' },
  };

  return (
    <div className="day-chart trend-chart">
      <div className="trend-head">
        <Segmented
          label={t('Chart shows', 'Grafik')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'queue', label: t('Queue', 'Kuyruk'), title: t('Vehicles queued on all roads', 'Tüm yollarda kuyruktaki araçlar') },
            { value: 'delay', label: t('Delay', 'Gecikme'), title: t('Average delay over the last minute', 'Son dakikadaki ortalama gecikme') },
          ]}
        />
        {trend ? (
          <span className={`trend-badge ${trendText[trend].cls}`} title={t('The last 2 minutes against the 2 before', 'Son 2 dakika, önceki 2 dakikayla karşılaştırıldı')}>
            {trendText[trend].icon} {trendText[trend].text}
          </span>
        ) : (
          <span className="hint">{t('Trend after 4 minutes…', 'Eğilim 4 dakika sonra…')}</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${what}, ${t('last 10 minutes', 'son 10 dakika')}: ${show(last.value)} ${unit}${trend ? `, ${trendText[trend].text}` : ''}`}
        onMouseMove={(e) => setHover(timeAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onMouseLeave={() => setHover(null)}
      >
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line className="grid" x1={M.left} x2={W - M.right} y1={y(f * yMax)} y2={y(f * yMax)} />
            <text className="axis" x={M.left - 4} y={y(f * yMax) + 3} textAnchor="end">
              {f * yMax}
            </text>
          </g>
        ))}
        <line className="baseline" x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} />
        {[10, 5].map((min) => (
          <text key={min} className="axis" x={x(end - min * 60)} y={H - 4} textAnchor={min === 10 ? 'start' : 'middle'}>
            −{min} {t('min', 'dk')}
          </text>
        ))}
        <text className="axis" x={x(end)} y={H - 4} textAnchor="end">
          {t('now', 'şimdi')}
        </text>
        {points
          .filter((p) => p.edit && p.time >= start)
          .map((p) => (
            <g key={p.time} className="edit-mark">
              <line x1={x(p.time)} x2={x(p.time)} y1={M.top - 6} y2={y(0)} />
              <text x={x(p.time)} y={M.top - 4} textAnchor="middle">
                ✎
              </text>
            </g>
          ))}
        {area && <path className="area" d={area} />}
        <path className="series overall" d={path} />
        {last.value !== null && <circle className="now-dot" cx={x(last.time)} cy={y(last.value)} r={3.5} />}
        {hovered && (
          <g>
            <line className="crosshair" x1={clampX(hovered.time)} x2={clampX(hovered.time)} y1={M.top} y2={y(0)} />
            {hovered.value !== null && <circle className="hover-dot" cx={clampX(hovered.time)} cy={y(hovered.value)} r={4} />}
          </g>
        )}
      </svg>
      <div className="chart-tip" aria-live="polite">
        {hovered ? (
          <>
            <strong className="num">
              {show(hovered.value)} {unit}
            </strong>{' '}
            · {ago(hovered.time)}
            {points.some((p) => p.edit && Math.abs(p.time - hovered.time) <= 5) && <> · {t('design changed here', 'tasarım burada değişti')}</>}
          </>
        ) : (
          <>
            {what}: <strong className="num">{show(last.value)}</strong> {unit}
          </>
        )}
      </div>
    </div>
  );
}
