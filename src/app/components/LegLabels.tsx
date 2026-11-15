import { useEffect, useState } from 'react';
import { add, scale } from '../../core/geometry';
import type { Network } from '../../network/network';
import type { Camera, Renderer } from '../../render/Renderer';
import { legColor } from '../../render/theme';
import { useApp } from '../store';

/** Numbered leg badges over the canvas, with the inflow and current queue for each approach. */
export function LegLabels({ renderer, network }: { renderer: Renderer | null; network: Network | null }) {
  const [cam, setCam] = useState<Camera | null>(null);
  const demand = useApp((s) => s.demand);
  const metrics = useApp((s) => s.metrics);
  useEffect(() => renderer?.onCamera(setCam), [renderer]);
  if (!cam || !network) return null;

  return (
    <div className="leg-labels" aria-hidden>
      {network.scenario.legs.map((leg, i) => {
        const g = network.legs.get(leg.id)!;
        // Just outside the road edge, part-way down the leg.
        const s = Math.min(g.length * 0.55, g.stopLine + 45);
        const p = add(scale(g.dir, s), scale(g.inNormal, g.inEdge + 7));
        const inflow = demand.vehicles.filter((d) => d.from === leg.id).reduce((sum, d) => sum + d.vehPerHour, 0);
        const queue = metrics?.legs.find((l) => l.leg === leg.id)?.queue ?? 0;
        return (
          <div key={leg.id} className="leg-label" style={{ left: cam.x + p.x * cam.scale, top: cam.y - p.y * cam.scale }}>
            <span className="leg-badge" style={{ background: legColor(i) }}>
              {leg.id}
            </span>
            <span className="leg-meta">
              <span className="num">{inflow}</span> veh/h
              {queue > 0 && (
                <>
                  {' · '}
                  <span className={queue >= 15 ? 'num queue-bad' : 'num'}>{queue}</span> queued
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
