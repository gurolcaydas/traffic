import { useRef, useSyncExternalStore } from 'react';
import { getLang, subscribeLang, t } from '../core/i18n';
import { useApp } from './store';
import { DemandPanel } from './components/DemandPanel';
import { DesignsPanel } from './components/DesignsPanel';
import { FairTestPanel } from './components/FairTestPanel';
import { JunctionPanel } from './components/JunctionPanel';
import { LegInspector } from './components/LegInspector';
import { LegLabels } from './components/LegLabels';
import { LevelPanel } from './components/LevelPanel';
import { LevelSelect } from './components/LevelSelect';
import { MetricsPanel } from './components/MetricsPanel';
import { ReplaceDialog } from './components/ReplaceDialog';
import { StartPanel } from './components/StartPanel';
import { ShapeEditor } from './components/ShapeEditor';
import { SignalPlanPanel } from './components/SignalPlanPanel';
import { TopBar } from './components/TopBar';
import { useSimulation } from './useSimulation';

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const { renderer, network, resetMetrics } = useSimulation(host);
  const source = useApp((s) => s.scenario.source);
  // Every component below re-renders with the app, so the whole page follows the language.
  useSyncExternalStore(subscribeLang, getLang);

  return (
    <div className="app">
      <TopBar onFit={() => renderer?.fit()} />
      <main className="stage">
        <div className="canvas-host" ref={host} />
        <LegLabels renderer={renderer} network={network} />
        <ShapeEditor renderer={renderer} network={network} />
        <div className="legend">
          {t(
            "Click a leg to edit it · car colour = where it's going · scroll to zoom · drag to pan · double-click to fit",
            'Düzenlemek için bir yola tıklayın · araç rengi = gittiği yön · yakınlaştırmak için kaydırın · kaydırmak için sürükleyin · sığdırmak için çift tıklayın',
          )}
        </div>
        {source?.kind === 'osm' && (
          <div className="map-attribution">
            {source.label ? `${source.label.split(',').slice(0, 2).join(',')} · ` : ''}{t('Roads', 'Yollar')} ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              {t('OpenStreetMap contributors', 'OpenStreetMap katkıcıları')}
            </a>
          </div>
        )}
      </main>
      <aside className="sidebar">
        <LevelPanel />
        <StartPanel />
        <LegInspector />
        <JunctionPanel />
        <SignalPlanPanel />
        <DemandPanel />
        <MetricsPanel onReset={resetMetrics} />
        <FairTestPanel />
        <DesignsPanel />
      </aside>
      <LevelSelect />
      <ReplaceDialog />
    </div>
  );
}
