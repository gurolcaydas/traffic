import { useState } from 'react';
import { t } from '../../core/i18n';
import { SHAPES, type Shape } from '../../scenarios/setup';
import { useRules } from '../levelRules';
import { currentSetup, useApp } from '../store';
import { ImportDialog } from './ImportDialog';
import { Segmented } from './Segmented';

/** The first choice in the sandbox: what to start from. Each option replaces the current design. */
export function StartPanel() {
  const rules = useRules();
  const scenario = useApp((s) => s.scenario);
  const original = useApp((s) => s.originalDesign);
  const { newJunction, askReplace, loadDesign } = useApp.getState();
  const [importing, setImporting] = useState(false);
  if (rules.inLevel) return null;

  // Highlight the template only while the design still is that template.
  const fresh = scenario === original && !scenario.source;
  const shape = fresh ? currentSetup().shape : ('' as Shape);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{t('Start', 'Başlangıç')}</h2>
        <span className="hint">{t('Each choice starts a new junction', 'Her seçim yeni bir kavşak başlatır')}</span>
      </header>
      <div className="field">
        <label>{t('Shape', 'Şekil')}</label>
        <Segmented
          label={t('Shape', 'Şekil')}
          value={shape}
          options={(Object.keys(SHAPES) as Shape[]).map((k) => ({ value: k, label: SHAPES[k].label }))}
          onChange={(s) => askReplace(`${t('Start over', 'Baştan başla')}: ${SHAPES[s].label}`, () => newJunction({ shape: s }))}
        />
      </div>
      <div className="field">
        <label>{t('Traffic drives on the', 'Trafik şu taraftan akar')}</label>
        <Segmented
          label={t('Drive side', 'Sürüş yönü')}
          value={scenario.driveSide}
          options={[
            { value: 'right', label: t('Right', 'Sağ') },
            { value: 'left', label: t('Left', 'Sol') },
          ]}
          onChange={(driveSide) =>
            driveSide !== scenario.driveSide &&
            askReplace(
              driveSide === 'right' ? t('Start again driving on the right', 'Sağdan akan trafikle yeniden başla') : t('Start again driving on the left', 'Soldan akan trafikle yeniden başla'),
              () => newJunction({ driveSide }),
            )
          }
        />
      </div>
      <button className="btn real-junction" onClick={() => setImporting(true)}>
        🌍 {t('Real junction from the map', 'Haritadan gerçek kavşak')}
      </button>
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onOpen={(s, label) => askReplace(t(`Open ${label}`, `${label} aç`), () => loadDesign(s))}
        />
      )}
    </section>
  );
}
