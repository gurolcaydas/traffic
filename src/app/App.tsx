import { useRef } from 'react';
import { DemandPanel } from './components/DemandPanel';
import { DesignsPanel } from './components/DesignsPanel';
import { FairTestPanel } from './components/FairTestPanel';
import { JunctionPanel } from './components/JunctionPanel';
import { LegInspector } from './components/LegInspector';
import { LegLabels } from './components/LegLabels';
import { LevelPanel } from './components/LevelPanel';
import { LevelSelect } from './components/LevelSelect';
import { MetricsPanel } from './components/MetricsPanel';
import { ShapeEditor } from './components/ShapeEditor';
import { SignalPlanPanel } from './components/SignalPlanPanel';
import { TopBar } from './components/TopBar';
import { useSimulation } from './useSimulation';

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const { renderer, network, resetMetrics } = useSimulation(host);

  return (
    <div className="app">
      <TopBar onFit={() => renderer?.fit()} />
      <main className="stage">
        <div className="canvas-host" ref={host} />
        <LegLabels renderer={renderer} network={network} />
        <ShapeEditor renderer={renderer} network={network} />
        <div className="legend">Click a leg to edit it · car colour = where it's going · scroll to zoom · drag to pan · double-click to fit</div>
      </main>
      <aside className="sidebar">
        <LevelPanel />
        <MetricsPanel onReset={resetMetrics} />
        <FairTestPanel />
        <LegInspector />
        <JunctionPanel />
        <SignalPlanPanel />
        <DemandPanel />
        <DesignsPanel />
      </aside>
      <LevelSelect />
    </div>
  );
}
