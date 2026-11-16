import { useEffect, useState } from 'react';
import { add, scale } from '../../core/geometry';
import type { Network } from '../../network/network';
import type { Camera, Renderer } from '../../render/Renderer';
import { legColor } from '../../render/theme';
import { useApp } from '../store';

/** Numbered leg badges over the canvas, with the inflow and current queue. Click one to edit that leg. */
export function LegLabels({ renderer, network }: { renderer: Renderer | null; network: Network | null }) {
  const [cam, setCam] = useState<Camera | null>(null);
  const scenario = useApp((s) => s.scenario);
  const metrics = useApp((s) => s.metrics);
  const selected = useApp((s) => s.selectedLeg);
  const selectLeg = useApp((s) => s.selectLeg);
  const editShape = useApp((s) => s.editShape);
  useEffect(() => renderer?.onCamera(setCam), [renderer]);
  // The shape editor puts its own controls on each road.
  if (!cam || !network || editShape) return null;

  return (
    <div className="leg-labels">
      {scenario.legs.map((leg, i) => {
        const g = network.legs.get(leg.id);
        if (!g) return null;
        // Just outside the road edge, part-way down the leg.
        const s = Math.min(g.length * 0.55, g.stopLine + 45);
        const p = add(scale(g.dir, s), scale(g.inNormal, (g.slipEdge ?? g.inEdge) + 7));
        const inflow = scenario.demand.vehicles.filter((d) => d.from === leg.id).reduce((sum, d) => sum + d.vehPerHour, 0);
        const queue = metrics?.legs.find((l) => l.leg === leg.id)?.queue ?? 0;
        return (
          <button
            key={leg.id}
            className={`leg-label ${selected === leg.id ? 'selected' : ''}`}
            style={{ left: cam.x + p.x * cam.scale, top: cam.y - p.y * cam.scale }}
            onClick={() => selectLeg(selected === leg.id ? null : leg.id)}
            title={`Edit leg ${leg.id}`}
          >
            <span className="leg-badge" style={{ background: legColor(i) }}>
              {leg.id}
            </span>
            <span className="leg-meta">
              {leg.name && <span className="leg-name">{leg.name} · </span>}
              <span className="num">{inflow}</span> veh/h
              {queue > 0 && (
                <>
                  {' · '}
                  <span className={queue >= 15 ? 'num queue-bad' : 'num'}>{queue}</span> queued
                </>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
