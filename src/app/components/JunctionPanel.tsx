import {
  controlChoice,
  crossingOf,
  flyoverCandidates,
  hasFlyover,
  setAllCrossings,
  setAllLanes,
  setCrossing,
  setControl,
  sideRoadCandidates,
  toggleFlyover,
  toggleSideRoad,
  type CrossingChoice,
} from '../../scenarios/edit';
import { useRef } from 'react';
import { t } from '../../core/i18n';
import type { Scenario } from '../../core/types';
import { useRules } from '../levelRules';
import { useApp } from '../store';
import { Segmented } from './Segmented';

const CONTROL_LABEL = {
  right: () => t('yield to right', 'sağdan gelene yol ver'),
  major: () => t('major road', 'ana yol'),
  signals: () => t('signals', 'trafik ışıkları'),
  roundabout: () => t('roundabout', 'dönel kavşak'),
} as const;

export function JunctionPanel() {
  const scenario = useApp((s) => s.scenario);
  const edit = useApp((s) => s.edit);
  const rules = useRules();
  const editShape = useApp((s) => s.editShape);
  const setEditShape = useApp((s) => s.setEditShape);

  // Values shown for "all legs" controls: the shared value, or nothing if legs differ.
  const lanes = scenario.legs.every((l) => l.lanesIn === scenario.legs[0]!.lanesIn) ? scenario.legs[0]!.lanesIn : -1;
  const crossing = scenario.legs.every((l) => crossingOf(scenario, l.id) === crossingOf(scenario, scenario.legs[0]!.id))
    ? crossingOf(scenario, scenario.legs[0]!.id)
    : ('mixed' as const);
  const flyovers = flyoverCandidates(scenario);
  const sideRoads = sideRoadCandidates(scenario);
  const turnGlyph = scenario.driveSide === 'right' ? '↱' : '↰';

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{t('Junction', 'Kavşak')}</h2>
        <span className="hint">{t('Changes apply while traffic runs', 'Değişiklikler trafik akarken uygulanır')}</span>
      </header>

      {!rules.inLevel && (
        <div className="row gap shape-toggle">
          <button className={`btn ${editShape ? 'primary' : ''}`} aria-pressed={editShape} onClick={() => setEditShape(!editShape)}>
            ✎ {editShape ? t('Done editing shape', 'Şekil düzenlemeyi bitir') : t('Edit shape', 'Şekli düzenle')}
          </button>
          {editShape && (
            <span className="hint">
              {t(
                'Drag a ⟲ handle to turn a road, + to add one, × to remove one, − and + to change its lanes (up to 4 each way). Click 🚶 on a road to add, change or remove its crossing.',
                'Yolu döndürmek için ⟲ tutamacını sürükleyin; + yol ekler, × yolu kaldırır, − ve + şerit sayısını değiştirir (her yönde en çok 4). Yaya geçidi eklemek, değiştirmek ya da kaldırmak için yoldaki 🚶 simgesine tıklayın.',
              )}
            </span>
          )}
        </div>
      )}

      <QuickSwitches />

      <div className="field">
        <label>{t('Control', 'Kavşak kontrolü')}</label>
        <Segmented
          label={t('Control', 'Kavşak kontrolü')}
          value={controlChoice(scenario)}
          options={[
            { value: 'right' as const, label: t('Yield to right', 'Sağdan gelen'), title: t('No signs: give way to traffic from the right', 'Levha yok: sağdan gelene yol verilir') },
            { value: 'major' as const, label: t('Major road', 'Ana yol'), title: t('The straightest road has priority', 'En düz yolun önceliği vardır') },
            { value: 'signals' as const, label: t('Signals', 'Işıklar') },
            { value: 'roundabout' as const, label: t('Roundabout', 'Dönel kavşak'), title: t('Entering traffic gives way to traffic already on the ring', 'Giren araçlar, kavşağın içindekilere yol verir') },
          ].filter((o) => rules.controls.includes(o.value))}
          onChange={(choice) => edit(`${t('Control', 'Kontrol')}: ${CONTROL_LABEL[choice]()}`, (d) => setControl(d, choice))}
        />
      </div>

      {!rules.inLevel && (
      <div className="field">
        <label>{t('Lanes each way, all legs', 'Her yönde şerit, tüm yollar')}</label>
        <Segmented
          label={t('Lanes', 'Şeritler')}
          value={lanes}
          options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
          onChange={(n) => edit(t(`${n} lane${n > 1 ? 's' : ''} on every leg`, `Tüm yollarda ${n} şerit`), (d) => setAllLanes(d, n))}
        />
      </div>
      )}

      {!rules.inLevel && (
      <div className="field">
        <label>{t('Pedestrian crossings, all legs', 'Yaya geçitleri, tüm yollar')}</label>
        <Segmented<CrossingChoice | 'mixed'>
          label={t('Crossings', 'Yaya geçitleri')}
          value={crossing}
          options={[
            { value: 'none', label: t('None', 'Yok') },
            { value: 'zebra', label: t('Zebra', 'Çizgili') },
            { value: 'signal', label: t('Signalised', 'Işıklı') },
          ]}
          onChange={(c) => c !== 'mixed' && edit(c === 'none' ? t('No crossings', 'Yaya geçidi yok') : c === 'zebra' ? t('Zebra crossings', 'Çizgili yaya geçitleri') : t('Signalised crossings', 'Işıklı yaya geçitleri'), (d) => setAllCrossings(d, c))}
        />
      </div>
      )}

      {rules.sideRoads && (
      <div className="field">
        <label>{t('Side roads (turn into the next road without entering the junction)', 'Serbest dönüş yolları (kavşağa girmeden yandaki yola dönüş)')}</label>
        <div className="chips">
          {sideRoads.map(({ from, to }) => {
            const on = !!scenario.legs.find((l) => l.id === from)?.slipLane;
            const blocked = rules.sideRoadBlocked(from);
            return (
              <button
                key={from}
                className={`chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                disabled={blocked && !on}
                title={blocked ? t('A building is in the way', 'Yolda bir bina var') : t(`Side road from ${from} into ${to}`, `${from} yolundan ${to} yoluna serbest dönüş`)}
                onClick={() => edit(on ? t(`Removed side road ${from}→${to}`, `Serbest dönüş ${from}→${to} kaldırıldı`) : t(`Built side road ${from}→${to}`, `Serbest dönüş ${from}→${to} yapıldı`), (d) => toggleSideRoad(d, from))}
              >
                {from} {turnGlyph} {to}
              </button>
            );
          })}
        </div>
      </div>
      )}

      {rules.flyover && flyovers.length > 0 && (
        <div className="field">
          <label>{t('Flyover (straight-through traffic on a bridge)', 'Üst geçit (düz giden trafik köprüden geçer)')}</label>
          <div className="chips">
            {flyovers.map((pair) => {
              const on = hasFlyover(scenario, pair);
              return (
                <button
                  key={pair.join()}
                  className={`chip ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  onClick={() => edit(on ? t(`Removed flyover ${pair[0]}–${pair[1]}`, `Üst geçit ${pair[0]}–${pair[1]} kaldırıldı`) : t(`Built flyover ${pair[0]}–${pair[1]}`, `Üst geçit ${pair[0]}–${pair[1]} yapıldı`), (d) => toggleFlyover(d, pair))}
                >
                  {pair[0]} ⇄ {pair[1]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="hint tip">{t('Click a leg on the map to change its lanes, crossing or allowed turns.', 'Şeritlerini, yaya geçidini ya da izinli dönüşlerini değiştirmek için haritada bir yola tıklayın.')}</p>

    </section>
  );
}

/**
 * Two on/off switches for the things people most often try first: pedestrians and traffic lights.
 * Switching off remembers what was there, so switching back on restores it.
 */
function QuickSwitches() {
  const scenario = useApp((s) => s.scenario);
  const edit = useApp((s) => s.edit);
  const rules = useRules();
  const lastCrossings = useRef<Scenario['crosswalks']>([]);
  const lastControl = useRef<Exclude<ReturnType<typeof controlChoice>, 'signals'>>('major');

  const walkers = scenario.crosswalks.length > 0;
  const lights = scenario.control.type === 'signals';
  const otherControls = rules.controls.filter((c) => c !== 'signals');
  const canLights = rules.controls.includes('signals') && otherControls.length > 0;
  if (rules.inLevel && !canLights) return null;

  const togglePeople = () => {
    if (walkers) {
      lastCrossings.current = scenario.crosswalks;
      edit(t('Pedestrians off', 'Yayalar kapalı'), (d) => setAllCrossings(d, 'none'));
      return;
    }
    // Bring back the crossings that were there, or a full set to suit the control.
    const legs = new Set(scenario.legs.map((l) => l.id));
    const before = lastCrossings.current.filter((c) => legs.has(c.leg));
    edit(t('Pedestrians on', 'Yayalar açık'), (d) => {
      if (!before.length) return setAllCrossings(d, d.control.type === 'signals' ? 'signal' : 'zebra');
      for (const c of before) setCrossing(d, c.leg, c.type);
    });
  };

  const toggleLights = () => {
    if (lights) {
      const back = otherControls.includes(lastControl.current) ? lastControl.current : otherControls[0]!;
      edit(t('Traffic lights off', 'Trafik ışıkları kapalı'), (d) => {
        setControl(d, back);
        // Crossings with lights need lights: they become zebras.
        for (const c of d.crosswalks) if (c.type === 'signal') setCrossing(d, c.leg, 'zebra');
      });
      return;
    }
    const was = controlChoice(scenario);
    if (was !== 'signals') lastControl.current = was;
    edit(t('Traffic lights on', 'Trafik ışıkları açık'), (d) => {
      setControl(d, 'signals');
      for (const c of d.crosswalks) if (c.type === 'zebra') setCrossing(d, c.leg, 'signal');
    });
  };

  return (
    <div className="quick-switches">
      {!rules.inLevel && <Switch label={t('Pedestrians', 'Yayalar')} on={walkers} onChange={togglePeople} />}
      {canLights && <Switch label={t('Traffic lights', 'Trafik ışıkları')} on={lights} onChange={toggleLights} />}
    </div>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={onChange}>
      <span className="track">
        <span className="thumb" />
      </span>
      {label}
    </button>
  );
}
