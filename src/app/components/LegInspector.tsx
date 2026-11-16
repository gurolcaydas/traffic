import { t } from '../../core/i18n';
import type { LegSpec } from '../../core/types';
import { legColor } from '../../render/theme';
import { crossingOf, setCrossing, toggleBanned, toggleMajor, type CrossingChoice } from '../../scenarios/edit';
import { canRemoveLeg, removeLeg } from '../../scenarios/shape';
import { useRules } from '../levelRules';
import { useApp } from '../store';
import { Segmented } from './Segmented';

/** Edit one leg: its lanes, crossing, slip lane and which turns are allowed from it. */
export function LegInspector() {
  const scenario = useApp((s) => s.scenario);
  const legId = useApp((s) => s.selectedLeg);
  const edit = useApp((s) => s.edit);
  const selectLeg = useApp((s) => s.selectLeg);
  const rules = useRules();
  const index = scenario.legs.findIndex((l) => l.id === legId);
  const leg = scenario.legs[index];
  if (!leg) return null;

  const others = scenario.legs.filter((l) => l.id !== leg.id);
  const banned = new Set(leg.banned ?? []);
  const isMajor = scenario.control.type === 'priority' && scenario.control.major.includes(leg.id);
  const update = (label: string, change: (l: LegSpec) => void) =>
    edit(`${t('Leg', 'Yol')} ${leg.id}: ${label}`, (d) => change(d.legs.find((l) => l.id === leg.id)!));

  return (
    <section className="panel inspector">
      <header className="panel-head">
        <h2>
          <span className="leg-badge small" style={{ background: legColor(index) }}>
            {leg.id}
          </span>{' '}
          {t('Leg', 'Yol')} {leg.id}
        </h2>
        <button className="link" onClick={() => selectLeg(null)}>
          {t('Done', 'Tamam')}
        </button>
      </header>

      <div className="two-col">
        <div className="field">
          <label>{t('Lanes in', 'Giriş şeridi')}</label>
          <Segmented
            label={t('Lanes in', 'Giriş şeridi')}
            value={leg.lanesIn}
            options={[0, 1, 2, 3, 4].map((n) => ({ value: n, label: String(n), disabled: !rules.lanes || n > rules.maxLanes(leg.id) }))}
            onChange={(n) => update(t(`${n} lanes in`, `${n} giriş şeridi`), (l) => (l.lanesIn = n))}
          />
        </div>
        <div className="field">
          <label>{t('Lanes out', 'Çıkış şeridi')}</label>
          <Segmented
            label={t('Lanes out', 'Çıkış şeridi')}
            value={leg.lanesOut}
            options={[0, 1, 2, 3, 4].map((n) => ({ value: n, label: String(n), disabled: !rules.lanes || n > rules.maxLanes(leg.id) }))}
            onChange={(n) => update(t(`${n} lanes out`, `${n} çıkış şeridi`), (l) => (l.lanesOut = n))}
          />
        </div>
      </div>

      {rules.crossings && (
      <div className="field">
        <label>{t('Pedestrian crossing', 'Yaya geçidi')}</label>
        <Segmented<CrossingChoice>
          label={t('Crossing', 'Yaya geçidi')}
          value={crossingOf(scenario, leg.id)}
          options={[
            {
              value: 'none',
              label: t('None', 'Yok'),
              disabled: rules.crossingRequired(leg.id),
              title: rules.crossingRequired(leg.id) ? t('This crossing must stay', 'Bu yaya geçidi kalmalı') : undefined,
            },
            { value: 'zebra', label: t('Zebra', 'Çizgili') },
            { value: 'signal', label: t('Signalised', 'Işıklı') },
          ]}
          onChange={(c) => edit(`${t('Leg', 'Yol')} ${leg.id}: ${c === 'none' ? t('no crossing', 'yaya geçidi yok') : c === 'zebra' ? t('zebra crossing', 'çizgili yaya geçidi') : t('signal crossing', 'ışıklı yaya geçidi')}`, (d) => setCrossing(d, leg.id, c))}
        />
      </div>
      )}

      {rules.bans && (
      <div className="field">
        <label>{t('Allowed turns from this leg', 'Bu yoldan izinli dönüşler')}</label>
        <div className="chips">
          {others.map((to) => {
            const ok = !banned.has(to.id);
            return (
              <button
                key={to.id}
                className={`chip ${ok ? 'on' : 'off'}`}
                aria-pressed={ok}
                title={ok ? t(`Ban turning into ${to.id}`, `${to.id} yoluna dönüşü yasakla`) : t(`Allow turning into ${to.id}`, `${to.id} yoluna dönüşe izin ver`)}
                onClick={() => edit(`${t('Leg', 'Yol')} ${leg.id}: ${ok ? t(`ban turn to ${to.id}`, `${to.id} dönüşü yasak`) : t(`allow turn to ${to.id}`, `${to.id} dönüşü serbest`)}`, (d) => toggleBanned(d, leg.id, to.id))}
              >
                → {to.id}
              </button>
            );
          })}
        </div>
      </div>
      )}

      <div className="field toggles">
        {!rules.sideRoadBlocked(leg.id) && (
        <label className="toggle">
          <input type="checkbox" checked={!!leg.slipLane} onChange={(e) => update(e.target.checked ? t('side road built', 'serbest dönüş yapıldı') : t('side road removed', 'serbest dönüş kaldırıldı'), (l) => (l.slipLane = e.target.checked))} />
          {t('Side road: turn into the next road without entering the junction', 'Serbest dönüş: kavşağa girmeden yandaki yola dön')}
        </label>
        )}
        {!rules.inLevel && canRemoveLeg(scenario) && (
          <button
            className="link danger"
            onClick={() => {
              selectLeg(null);
              edit(t(`Removed road ${leg.id}`, `${leg.id} numaralı yol kaldırıldı`), (d) => removeLeg(d, leg.id));
            }}
          >
            {t('Remove this road', 'Bu yolu kaldır')}
          </button>
        )}
        {scenario.control.type === 'priority' && rules.controls.includes('major') && (
          <label className="toggle">
            <input type="checkbox" checked={isMajor} onChange={() => edit(`${t('Leg', 'Yol')} ${leg.id}: ${isMajor ? t('minor road', 'tali yol') : t('major road', 'ana yol')}`, (d) => toggleMajor(d, leg.id))} />
            {t('Part of the major road (has priority)', 'Ana yolun parçası (önceliği var)')}
          </label>
        )}
      </div>
    </section>
  );
}
