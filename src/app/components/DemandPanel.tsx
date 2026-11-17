import { t } from '../../core/i18n';
import { hasRing } from '../../core/types';
import { legColor } from '../../render/theme';
import { PATTERNS, peakHourFactor } from '../../scenarios/patterns';
import { useRules } from '../levelRules';
import { useApp } from '../store';
import { DayChart } from './DayChart';
import { Segmented } from './Segmented';

const Badge = ({ i, id }: { i: number; id: string }) => (
  <span className="leg-badge small" style={{ background: legColor(i) }}>
    {id}
  </span>
);

/** Shares of trucks and buses to choose from; 6% is the default. */
const HEAVY_SHARES = [0, 0.06, 0.15, 0.3];

/** Origin–destination table: vehicles per hour from each leg (rows) to each leg (columns). */
export function DemandPanel() {
  const scenario = useApp((s) => s.scenario);
  const setVeh = useApp((s) => s.setVehicleDemand);
  const setPed = useApp((s) => s.setPedDemand);
  const scaleDemand = useApp((s) => s.scaleDemand);
  const setHeavyShare = useApp((s) => s.setHeavyShare);
  const setPattern = useApp((s) => s.setPattern);
  const setCentreLeg = useApp((s) => s.setCentreLeg);
  const jumpToHour = useApp((s) => s.jumpToHour);
  const timeOfDay = useApp((s) => s.timeOfDay);
  const rules = useRules();
  const { legs, demand } = scenario;
  const pattern = demand.pattern;
  const preset = pattern ? PATTERNS[pattern.id] : undefined;
  const value = (from: string, to: string) => demand.vehicles.find((d) => d.from === from && d.to === to)?.vehPerHour ?? 0;
  const total = demand.vehicles.reduce((s, d) => s + d.vehPerHour, 0);
  const banned = (from: string, to: string) => legs.find((l) => l.id === from)?.banned?.includes(to) ?? false;
  // U-turns need a roundabout to go round. Without one, any U-turn trips divert elsewhere.
  const roundabout = hasRing(scenario.control);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{t('Traffic', 'Trafik')}</h2>
        <span className="hint">
          <span className="num">{total}</span> {t('veh/h', 'araç/sa')} {pattern ? t('at peak', 'zirvede') : t('total', 'toplam')}
        </span>
      </header>

      {rules.demand && (
      <div className="field">
        <label>{t('Through the day', 'Gün boyunca')}</label>
        <Segmented<string>
          label={t('Traffic pattern', 'Trafik deseni')}
          value={pattern?.id ?? 'flat'}
          options={[{ value: 'flat', label: t('Constant', 'Sabit'), title: t('The table, all day long', 'Tablodaki trafik, gün boyu') }, ...Object.entries(PATTERNS).map(([id, p]) => ({ value: id, label: p.label, title: p.description }))]}
          onChange={(id) => setPattern(id === 'flat' ? null : id)}
        />
      </div>
      )}

      {pattern && preset && (
        <>
          <p className="hint">
            {preset.description} {t('The table below is the peak-hour traffic.', 'Aşağıdaki tablo zirve saatin trafiğidir.')}{' '}
            <span title={t('Busiest hour ÷ (4 × busiest 15 minutes). 1 is even; real junctions are usually 0.85–0.95.', 'En yoğun saat ÷ (4 × en yoğun 15 dakika). 1 düzgün demektir; gerçek kavşaklarda genellikle 0,85–0,95.')}>
              {t('Peak hour factor', 'Zirve saat katsayısı')} <span className="num">{peakHourFactor(pattern).toFixed(2)}</span>.
            </span>
          </p>
          {preset.tidal && rules.demand && (
            <div className="field inline-field">
              <label>{preset.centreLabel}</label>
              <div className="chips">
                {legs.map((l, i) => (
                  <button
                    key={l.id}
                    className={`chip ${pattern.centreLeg === l.id ? 'on' : ''}`}
                    aria-pressed={pattern.centreLeg === l.id}
                    onClick={() => setCentreLeg(l.id)}
                    style={pattern.centreLeg === l.id ? undefined : { borderColor: legColor(i) }}
                  >
                    {l.id}
                  </button>
                ))}
              </div>
            </div>
          )}
          <DayChart pattern={pattern} now={timeOfDay} onJump={jumpToHour} />
        </>
      )}

      <table className="od">
        <thead>
          <tr>
            <th className="corner">{t('from \\ to', 'nereden \\ nereye')}</th>
            {legs.map((l, j) => (
              <th key={l.id}>
                <Badge i={j} id={l.id} />
              </th>
            ))}
            <th className="sum">Σ</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((from, i) => (
            <tr key={from.id}>
              <th>
                <Badge i={i} id={from.id} />
              </th>
              {legs.map((to) => {
                const uTurn = to.id === from.id;
                if (uTurn && !roundabout && value(from.id, to.id) === 0) return <td key={to.id} className="diag" title={t('U-turns need a roundabout', 'U dönüşü için dönel kavşak gerekir')} />;
                const blocked = uTurn && !roundabout;
                return (
                  <td
                    key={to.id}
                    className={blocked || banned(from.id, to.id) ? 'banned' : uTurn ? 'uturn' : ''}
                    title={
                      blocked
                        ? t('No U-turns without a roundabout: these trips divert elsewhere', 'Dönel kavşak olmadan U dönüşü yok: bu yolculuklar başka yoldan gider')
                        : banned(from.id, to.id)
                          ? t('Turn banned: these trips divert elsewhere', 'Dönüş yasak: bu yolculuklar başka yoldan gider')
                          : uTurn
                            ? t('U-turns: all the way round the roundabout and back', 'U dönüşü: dönel kavşağın etrafını dolaşıp geri dönüş')
                            : undefined
                    }
                  >
                    <input
                      type="number"
                      min={0}
                      step={10}
                      readOnly={!rules.demand || blocked}
                      aria-label={
                        uTurn
                          ? t(`Vehicles per hour making a U-turn on ${from.id}`, `${from.id} yolunda saatte U dönüşü yapan araç`)
                          : t(`Vehicles per hour from ${from.id} to ${to.id}`, `${from.id} yolundan ${to.id} yoluna saatte araç`)
                      }
                      value={value(from.id, to.id)}
                      onChange={(e) => setVeh(from.id, to.id, Math.max(0, Number(e.target.value) || 0))}
                    />
                  </td>
                );
              })}
              <td className="sum num">{legs.reduce((s, to) => s + value(from.id, to.id), 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {!rules.demand ? (
        <p className="hint">{t("The level's traffic is fixed: change the junction, not the traffic.", 'Bölümün trafiği sabittir: trafiği değil, kavşağı değiştirin.')}</p>
      ) : (
      <div className="row gap">
        <button className="btn" onClick={() => scaleDemand(0.8)}>
          −20%
        </button>
        <button className="btn" onClick={() => scaleDemand(1.25)}>
          +25%
        </button>
        <span className="hint">{t('Applies live: watch the queues react.', 'Anında uygulanır: kuyrukların tepkisini izleyin.')}</span>
      </div>
      )}

      {rules.demand && (
        <div className="field">
          <label>{t('Trucks and buses', 'Kamyon ve otobüs')}</label>
          <Segmented<number>
            label={t('Share of trucks and buses', 'Kamyon ve otobüs oranı')}
            value={HEAVY_SHARES.includes(demand.heavyShare ?? 0.06) ? (demand.heavyShare ?? 0.06) : -1}
            options={HEAVY_SHARES.map((v) => ({
              value: v,
              label: `${Math.round(v * 100)}%`,
              title: t('Heavy vehicles pull away slowly and need longer gaps', 'Ağır araçlar yavaş kalkar ve daha uzun boşluk ister'),
            }))}
            onChange={setHeavyShare}
          />
        </div>
      )}

      {scenario.crosswalks.length > 0 && (
        <div className="field">
          <label>{t('Pedestrians per hour, per crossing', 'Geçit başına saatte yaya')}</label>
          <div className="ped-grid">
            {scenario.crosswalks.map((c) => {
              const i = legs.findIndex((l) => l.id === c.leg);
              return (
                <label key={c.leg} className="ped-cell">
                  <Badge i={i} id={c.leg} />
                  <input
                    type="number"
                    min={0}
                    step={10}
                    readOnly={!rules.demand}
                    aria-label={t(`Pedestrians per hour crossing leg ${c.leg}`, `${c.leg} numaralı yolu saatte geçen yaya`)}
                    value={demand.pedestrians.find((p) => p.leg === c.leg)?.pedPerHour ?? 0}
                    onChange={(e) => setPed(c.leg, Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
