import { useEffect, useRef, useState } from 'react';
import type { Network } from '../../network/network';
import type { Camera, Renderer } from '../../render/Renderer';
import { legColor } from '../../render/theme';
import { crossingOf, setCrossing, type CrossingChoice } from '../../scenarios/edit';
import { MIN_GAP, addLeg, canAddLeg, canRemoveLeg, nearestFit, removeLeg, rotateLeg } from '../../scenarios/shape';
import { useApp } from '../store';

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Clicking a road's crossing button steps through these. */
const NEXT_CROSSING: Record<CrossingChoice, CrossingChoice> = { none: 'zebra', zebra: 'signal', signal: 'none' };
const CROSSING_TEXT: Record<CrossingChoice, string> = { none: 'no crossing', zebra: 'zebra crossing', signal: 'crossing with lights' };

/**
 * On-map controls for changing the junction's shape: drag a road's handle to turn it, × to remove
 * it, + in a wide enough gap to add one, and 🚶 on a road to add, change or remove its crossing.
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

  // Handles sit part-way down each road, at a fixed distance on screen.
  const reach = Math.min(...[...network.legs.values()].map((g) => g.length)) * 0.62;
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
              aria-label={`Turn road ${leg.id} (now ${Math.round(angle)}°)`}
              title="Drag to turn this road"
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
              <button className="shape-remove" aria-label={`Remove road ${leg.id}`} title="Remove this road" onClick={() => edit(`Removed road ${leg.id}`, (d) => removeLeg(d, leg.id))}>
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
              aria-label={`Road ${leg.id}: ${CROSSING_TEXT[now]}. Click for ${CROSSING_TEXT[next]}`}
              title={`${CROSSING_TEXT[now]} · click for ${CROSSING_TEXT[next]}`}
              onClick={() => edit(`Road ${leg.id}: ${CROSSING_TEXT[next]}`, (d) => setCrossing(d, leg.id, next))}
            >
              🚶{now === 'signal' && <span className="mini">●</span>}
            </button>
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
              aria-label={`Add a road at ${angle}°`}
              title="Add a road here"
              onClick={() => edit(`Added a road at ${angle}°`, (d) => void addLeg(d, angle))}
            >
              +
            </button>
          );
        })}
    </div>
  );
}
