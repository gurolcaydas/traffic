import { useState } from 'react';
import { t } from '../../core/i18n';
import type { DemandPattern } from '../../core/types';
import { demandFactor, formatClock, interpolate } from '../../scenarios/patterns';

const W = 320;
const H = 104;
const M = { left: 34, right: 10, top: 10, bottom: 18 };

/**
 * The shape of the day: traffic as a share of the peak-hour table, hour by hour. For tidal patterns,
 * dashed and dotted lines show trips into and out of the centre. Click anywhere to jump the clock there.
 */
export function DayChart({ pattern, now, onJump }: { pattern: DemandPattern; now: number | null; onJump: (hour: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const tidal = !!(pattern.tide && pattern.centreLeg);
  const yMax = tidal ? 1.5 : 1.1;
  const x = (h: number) => M.left + ((h - pattern.startHour) / (pattern.endHour - pattern.startHour)) * (W - M.left - M.right);
  const y = (f: number) => M.top + (1 - f / yMax) * (H - M.top - M.bottom);
  const hours: number[] = [];
  for (let h = pattern.startHour; h <= pattern.endHour + 1e-9; h += 0.25) hours.push(h);
  const centre = pattern.centreLeg ?? '';
  // A trip into the centre from any other leg, and one out of it, to draw the tide.
  const other = centre === '1' ? '2' : '1';
  const line = (f: (h: number) => number) => hours.map((h, i) => `${i ? 'L' : 'M'}${x(h).toFixed(1)},${y(f(h)).toFixed(1)}`).join('');
  const overall = (h: number) => interpolate(pattern.points, h);
  const into = (h: number) => demandFactor(pattern, h, other, centre);
  const out = (h: number) => demandFactor(pattern, h, centre, other);
  const ticks = hours.filter((h) => Number.isInteger(h) && (h - pattern.startHour) % (pattern.endHour - pattern.startHour > 8 ? 2 : 1) === 0);

  const hourAt = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    const h = pattern.startHour + ((px - M.left) / (W - M.left - M.right)) * (pattern.endHour - pattern.startHour);
    return Math.min(pattern.endHour, Math.max(pattern.startHour, Math.round(h * 4) / 4));
  };

  return (
    <div className="day-chart">
      {tidal && (
        <div className="chart-legend" aria-hidden>
          <span><i className="sw overall" />{t('All trips', 'Tüm yolculuklar')}</span>
          <span><i className="sw into" />{t(`Into leg ${centre}`, `${centre} yoluna giren`)}</span>
          <span><i className="sw out" />{t(`Out of leg ${centre}`, `${centre} yolundan çıkan`)}</span>
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t(
          `Traffic through the day, ${formatClock(pattern.startHour)} to ${formatClock(pattern.endHour)}. Click to jump the clock.`,
          `Gün boyu trafik, ${formatClock(pattern.startHour)}–${formatClock(pattern.endHour)}. Saati oraya atlatmak için tıklayın.`,
        )}
        onMouseMove={(e) => setHover(hourAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => onJump(hourAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
      >
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line className="grid" x1={M.left} x2={W - M.right} y1={y(f)} y2={y(f)} />
            <text className="axis" x={M.left - 4} y={y(f) + 3} textAnchor="end">
              {Math.round(f * 100)}%
            </text>
          </g>
        ))}
        <line className="baseline" x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} />
        {ticks.map((h) => (
          <text key={h} className="axis" x={x(h)} y={H - 4} textAnchor="middle">
            {formatClock(h).slice(0, 2)}
          </text>
        ))}
        <path className="area" d={`${line(overall)}L${x(pattern.endHour)},${y(0)}L${x(pattern.startHour)},${y(0)}Z`} />
        {tidal && <path className="series into" d={line(into)} />}
        {tidal && <path className="series out" d={line(out)} />}
        <path className="series overall" d={line(overall)} />
        {now !== null && now >= pattern.startHour && now <= pattern.endHour && (
          <g>
            <line className="now" x1={x(now)} x2={x(now)} y1={M.top - 4} y2={y(0)} />
            <circle className="now-dot" cx={x(now)} cy={y(overall(now))} r={4} />
          </g>
        )}
        {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={M.top} y2={y(0)} />}
      </svg>
      <div className="chart-tip" aria-live="polite">
        {hover !== null ? (
          <>
            <strong className="num">{formatClock(hover)}</strong> · <span className="num">{Math.round(overall(hover) * 100)}%</span> {t('of peak', 'zirve trafiği')}
            {tidal && (
              <>
                {' '}· {t(`into ${centre}`, `${centre} yoluna giren`)} <span className="num">{Math.round(into(hover) * 100)}%</span> · {t('out', 'çıkan')}{' '}
                <span className="num">{Math.round(out(hover) * 100)}%</span>
              </>
            )}
            <span className="hint"> · {t('click to jump here', 'buraya atlamak için tıklayın')}</span>
          </>
        ) : now !== null ? (
          <>
            {t('Now', 'Şimdi')} <strong className="num">{formatClock(now)}</strong> · <span className="num">{Math.round(overall(now) * 100)}%</span>{' '}
            {t('of peak traffic', 'zirve trafiği')}
          </>
        ) : null}
      </div>
    </div>
  );
}
