import { useEffect, useRef, useState } from 'react';
import { t } from '../../core/i18n';
import { MAX_LANES, type LegSpec } from '../../core/types';
import type { Network } from '../../network/network';
import type { Camera, Renderer } from '../../render/Renderer';
import { legColor } from '../../render/theme';
import { crossingOf, setCrossing, type CrossingChoice } from '../../scenarios/edit';
import { MIN_GAP, addLeg, canAddLeg, canRemoveLeg, nearestFit, removeLeg, rotateLeg } from '../../scenarios/shape';
import { useApp } from '../store';

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Clicking a road's crossing button steps through these. */
const NEXT_CROSSING: Record<CrossingChoice, CrossingChoice> = { none: 'zebra', zebra: 'signal', signal: 'none' };
const CROSSING_TEXT: Record<CrossingChoice, () => string> = {
  none: () => t('no crossing', 'yaya geçidi yok'),
  zebra: () => t('zebra crossing', 'çizgili yaya geçidi'),
  signal: () => t('crossing with lights', 'ışıklı yaya geçidi'),
};

/**
 * On-map controls for changing the junction's shape: drag a road's handle to turn it, × to remove
 * it, + in a wide enough gap to add one, − and + to change a road's lanes, and 🚶 on a road to add, change or remove its crossing.
 * Every change applies live, like any other edit.
 */
export function ShapeEditor({ renderer, network }: { renderer: Renderer | null; network: Network | null }) {
  const [cam, setCam] = useState<Camera | null>(null);
  const [drag, setDrag] = useState<{ id: string; angle: number } | null>(null);
  const editing = useApp((s) => s.editShape);
  const scenario = useApp((s) => s.scenario);
  const edit = useApp((s) => s.edit);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => renderer?.onCamera(setCam), [renderer]);
  if (!editing || !cam || !network) return null;

  // Handles sit part-way down each road, pulled in when zoomed so they stay on screen.
  const box = host.current;
  const inView = box ? (Math.min(box.clientWidth, box.clientHeight) / 2 - 36) / cam.scale : Infinity;
  const reach = Math.min(Math.min(...[...network.legs.values()].map((g) => g.length)) * 0.62, inView);
  const toScreen = (angle: number, r: number) => ({ x: cam.x + Math.cos(rad(angle)) * r * cam.scale, y: cam.y - Math.sin(rad(angle)) * r * cam.scale });
  const angleAt = (clientX: number, clientY: number) => {
    const rect = host.current!.getBoundingClientRect();
    const wx = (clientX - rect.left - cam.x) / cam.scale;
    const wy = -(clientY - rect.top - cam.y) / cam.scale;
    return (Math.atan2(wy, wx) * 180) / Math.PI;
  };

  // Where a new road could go: the middle of each gap wide enough for one.
  const sorted = [...scenario.legs].sort((a, b) => a.angle - b.angle);
  const slots = canAddLeg(scenario)
    ? sorted.flatMap((a, i) => {
        const b = sorted[(i + 1) % sorted.length]!;
        const span = (((b.angle - a.angle) % 360) + 360) % 360 || 360;
        if (span < 2 * MIN_GAP) return [];
        const mid = nearestFit(scenario, a.angle + span / 2);
        return mid === null ? [] : [mid];
      })
    : [];

  return (
    <div className="shape-editor" ref={host}>
      <svg className="shape-guides" aria-hidden>
        {drag && (
          <line
            x1={cam.x}
            y1={cam.y}
            x2={toScreen(drag.angle, reach * 1.3).x}
            y2={toScreen(drag.angle, reach * 1.3).y}
            className="guide"
          />
        )}
      </svg>
      {scenario.legs.map((leg, i) => {
        const angle = drag?.id === leg.id ? drag.angle : leg.angle;
        const p = toScreen(angle, reach);
        return (
          <div key={leg.id} className="shape-handle-wrap" style={{ left: p.x, top: p.y }}>
            <button
              className="shape-handle"
              style={{ borderColor: legColor(i) }}
              aria-label={t(`Turn road ${leg.id} (now ${Math.round(angle)}°)`, `${leg.id} numaralı yolu döndür (şu an ${Math.round(angle)}°)`)}
              title={t('Drag to turn this road', 'Bu yolu döndürmek için sürükleyin')}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag({ id: leg.id, angle: leg.angle });
              }}
              onPointerMove={(e) => {
                if (drag?.id !== leg.id) return;
                const a = nearestFit(scenario, angleAt(e.clientX, e.clientY), leg.id);
                if (a !== null && a !== drag.angle) setDrag({ id: leg.id, angle: a });
              }}
              onPointerUp={() => {
                if (drag?.id === leg.id && drag.angle !== leg.angle) {
                  const target = drag.angle;
                  edit(`Turned road ${leg.id} to ${target}°`, (d) => void rotateLeg(d, leg.id, target));
                }
                setDrag(null);
              }}
              onKeyDown={(e) => {
                // Arrow keys turn the road too, for keyboard users.
                const step = e.key === 'ArrowLeft' ? 5 : e.key === 'ArrowRight' ? -5 : 0;
                if (!step) return;
                e.preventDefault();
                edit(`Turned road ${leg.id}`, (d) => void rotateLeg(d, leg.id, leg.angle + step));
              }}
            >
              ⟲<span className="num">{Math.round(angle)}°</span>
            </button>
            {canRemoveLeg(scenario) && !drag && (
              <button
                className="shape-remove"
                aria-label={t(`Remove road ${leg.id}`, `${leg.id} numaralı yolu kaldır`)}
                title={t('Remove this road', 'Bu yolu kaldır')}
                onClick={() => edit(t(`Removed road ${leg.id}`, `${leg.id} numaralı yol kaldırıldı`), (d) => removeLeg(d, leg.id))}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {!drag &&
        scenario.legs.map((leg) => {
          const g = network.legs.get(leg.id);
          if (!g) return null;
          // On the crossing itself, or where one would go.
          const at = g.crosswalkCenter ?? g.boxEdge + 3;
          const p = { x: cam.x + g.dir.x * at * cam.scale, y: cam.y - g.dir.y * at * cam.scale };
          const now = crossingOf(scenario, leg.id);
          const next = NEXT_CROSSING[now];
          return (
            <button
              key={`x${leg.id}`}
              className={`shape-crossing ${now}`}
              style={{ left: p.x, top: p.y }}
              aria-label={`${t('Road', 'Yol')} ${leg.id}: ${CROSSING_TEXT[now]()}. ${t('Click for', 'Tıklayınca')} ${CROSSING_TEXT[next]()}`}
              title={`${CROSSING_TEXT[now]()} · ${t('click for', 'tıklayınca')} ${CROSSING_TEXT[next]()}`}
              onClick={() => edit(`${t('Road', 'Yol')} ${leg.id}: ${CROSSING_TEXT[next]()}`, (d) => setCrossing(d, leg.id, next))}
            >
              🚶{now === 'signal' && <span className="mini">●</span>}
            </button>
          );
        })}
      {!drag &&
        scenario.legs.map((leg) => {
          // Between the crossing button and the turn handle, clear of the crossing.
          const g = network.legs.get(leg.id);
          const crossingAt = g ? (g.crosswalkCenter ?? g.boxEdge + 3) : 0;
          const p = toScreen(leg.angle, Math.max(reach * 0.62, crossingAt + 70 / cam.scale));
          const step = (side: 'lanesIn' | 'lanesOut', by: number) => {
            const n = leg[side] + by;
            const other = side === 'lanesIn' ? leg.lanesOut : leg.lanesIn;
            // A road keeps at least one lane, in one direction or the other.
            if (n < 0 || n > MAX_LANES || (n === 0 && other === 0)) return null;
            const text =
              side === 'lanesIn'
                ? t(`${n} lane${n === 1 ? '' : 's'} in`, `${n} giriş şeridi`)
                : t(`${n} lane${n === 1 ? '' : 's'} out`, `${n} çıkış şeridi`);
            return () => edit(`${t('Road', 'Yol')} ${leg.id}: ${text}`, (d) => void (d.legs.find((l) => l.id === leg.id)![side] = n));
          };
          return (
            <div key={`l${leg.id}`} className="shape-lanes" style={{ left: p.x, top: p.y }}>
              <LaneStepper leg={leg} side="lanesIn" label={t('In', 'Giriş')} title={t('Lanes towards the junction', 'Kavşağa doğru şeritler')} step={step} />
              <LaneStepper leg={leg} side="lanesOut" label={t('Out', 'Çıkış')} title={t('Lanes away from the junction', 'Kavşaktan çıkan şeritler')} step={step} />
            </div>
          );
        })}
      {!drag &&
        slots.map((angle) => {
          const p = toScreen(angle, reach * 0.8);
          return (
            <button
              key={angle}
              className="shape-add"
              style={{ left: p.x, top: p.y }}
              aria-label={t(`Add a road at ${angle}°`, `${angle}° açıyla yol ekle`)}
              title={t('Add a road here', 'Buraya yol ekle')}
              onClick={() => edit(t(`Added a road at ${angle}°`, `${angle}° açıyla yol eklendi`), (d) => void addLeg(d, angle))}
            >
              +
            </button>
          );
        })}
    </div>
  );
}

function LaneStepper({
  leg,
  side,
  label,
  title,
  step,
}: {
  leg: LegSpec;
  side: 'lanesIn' | 'lanesOut';
  label: string;
  title: string;
  step: (side: 'lanesIn' | 'lanesOut', by: number) => (() => void) | null;
}) {
  const less = step(side, -1);
  const more = step(side, 1);
  return (
    <div className="lane-stepper" title={title}>
      <span className="lane-label">{label}</span>
      <button aria-label={t(`Fewer lanes ${label.toLowerCase()} on road ${leg.id}`, `${leg.id} numaralı yolda daha az ${label.toLocaleLowerCase('tr')} şeridi`)} disabled={!less} onClick={less ?? undefined}>
        −
      </button>
      <span className="num">{leg[side]}</span>
      <button aria-label={t(`More lanes ${label.toLowerCase()} on road ${leg.id}`, `${leg.id} numaralı yolda daha fazla ${label.toLocaleLowerCase('tr')} şeridi`)} disabled={!more} onClick={more ?? undefined}>
        +
      </button>
    </div>
  );
}
