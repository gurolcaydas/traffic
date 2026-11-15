import { useEffect, useRef, useState } from 'react';
import { buildNetwork } from '../network/build';
import { Renderer } from '../render/Renderer';
import { DARK, LIGHT } from '../render/theme';
import type { Network } from '../network/network';
import type { FromWorker, ToWorker } from './protocol';
import { currentScenario, useApp } from './store';

/** Resolves the theme choice against the OS setting and keeps <html data-theme> in sync. */
export function useResolvedTheme(): 'light' | 'dark' {
  const choice = useApp((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  return resolved;
}

/**
 * Owns the simulation worker and the canvas renderer, and keeps both in step with the store.
 * Returns the renderer and the current network so overlays can position themselves.
 */
export function useSimulation(host: React.RefObject<HTMLDivElement | null>) {
  const theme = useResolvedTheme();
  const worker = useRef<Worker | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [network, setNetwork] = useState<Network | null>(null);
  const layoutVersion = useApp((s) => s.layoutVersion);
  const demand = useApp((s) => s.demand);
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);

  const send = (msg: ToWorker) => worker.current?.postMessage(msg);

  useEffect(() => {
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    let lastClockUpdate = 0;
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.type === 'metrics') {
        useApp.setState({ metrics: msg.metrics });
      } else {
        rendererRef.current?.pushFrame(msg);
        const now = performance.now();
        if (now - lastClockUpdate > 200) {
          lastClockUpdate = now;
          useApp.setState({ clock: msg.clock, simTime: msg.time });
        }
      }
    };
    return () => w.terminate();
  }, []);

  useEffect(() => {
    if (!host.current) return;
    const r = new Renderer(host.current, theme === 'dark' ? DARK : LIGHT);
    rendererRef.current = r;
    setRenderer(r);
    return () => {
      r.destroy();
      rendererRef.current = null;
    };
    // The renderer is created once; theme changes are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  useEffect(() => {
    renderer?.setTheme(theme === 'dark' ? DARK : LIGHT);
  }, [renderer, theme]);

  // Layout changed: rebuild the network and restart the simulation.
  useEffect(() => {
    const scenario = currentScenario(useApp.getState());
    const net = buildNetwork(scenario);
    setNetwork(net);
    renderer?.setNetwork(net);
    send({ type: 'load', scenario });
  }, [layoutVersion, renderer]);

  // Demand changed: apply it live, without restarting.
  useEffect(() => {
    send({ type: 'setDemand', demand: currentScenario(useApp.getState()).demand });
  }, [demand]);

  useEffect(() => send({ type: playing ? 'play' : 'pause' }), [playing]);
  useEffect(() => send({ type: 'speed', speed }), [speed]);

  return { renderer, network, resetMetrics: () => send({ type: 'resetMetrics' }) };
}
