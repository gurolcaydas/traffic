import { useEffect, useRef, useState } from 'react';
import { fetchRoads, parsePlace, searchPlaces, type Place } from '../../osm/api';
import { osmToScenario, type ImportResult } from '../../osm/convert';
import { legColor } from '../../render/theme';
import { t } from '../../core/i18n';
import { hasRing, type Scenario } from '../../core/types';

type Step =
  | { kind: 'search' }
  | { kind: 'searching' }
  | { kind: 'results'; places: Place[] }
  | { kind: 'loading'; place: Place; server: number }
  | { kind: 'preview'; place: Place; result: ImportResult }
  | { kind: 'error'; message: string };

const CONTROL_TEXT = {
  priority: () => t('Priority / give way', 'Öncelik / yol ver'),
  signals: () => t('Traffic lights', 'Trafik ışıkları'),
  roundabout: () => t('Roundabout', 'Dönel kavşak'),
} as const;

const HIGHWAY_TR: Record<string, string> = {
  motorway: 'otoyol',
  trunk: 'ana arter',
  primary: 'birinci derece yol',
  secondary: 'ikinci derece yol',
  tertiary: 'üçüncü derece yol',
  unclassified: 'sınıfsız yol',
  residential: 'mahalle sokağı',
  living_street: 'yaşam sokağı',
  service: 'servis yolu',
};

/** OpenStreetMap's road type, in words. */
const highwayText = (highway: string) => {
  const base = highway.replace(/_link$/, '');
  return t(highway.replace('_', ' '), `${HIGHWAY_TR[base] ?? base.replace('_', ' ')}${base !== highway ? ' bağlantısı' : ''}`);
};

/** Find a real junction on OpenStreetMap and open it in the sandbox. */
export function ImportDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (scenario: Scenario, label: string) => void }) {
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'search' });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      abort.current?.abort();
    };
  }, [onClose]);

  const fresh = () => {
    abort.current?.abort();
    abort.current = new AbortController();
    return abort.current.signal;
  };

  const load = async (place: Place) => {
    const signal = fresh();
    setStep({ kind: 'loading', place, server: 0 });
    try {
      const elements = await fetchRoads(place, signal, (server) => setStep({ kind: 'loading', place, server }));
      const result = osmToScenario(elements, place);
      if ('error' in result) setStep({ kind: 'error', message: result.error });
      else setStep({ kind: 'preview', place, result });
    } catch (e) {
      if (!signal.aborted) setStep({ kind: 'error', message: e instanceof Error ? e.message : t('Something went wrong.', 'Bir şeyler ters gitti.') });
    }
  };

  const search = async () => {
    const direct = parsePlace(query);
    if (direct) return load(direct);
    if (query.trim().length < 3) return;
    const signal = fresh();
    setStep({ kind: 'searching' });
    try {
      const places = await searchPlaces(query.trim(), signal);
      setStep(places.length ? { kind: 'results', places } : { kind: 'error', message: t('Nothing found. Try another name, or paste coordinates.', 'Bir şey bulunamadı. Başka bir ad deneyin ya da koordinat yapıştırın.') });
    } catch (e) {
      if (!signal.aborted) setStep({ kind: 'error', message: e instanceof Error ? e.message : t('Search failed.', 'Arama başarısız oldu.') });
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('Import a real junction', 'Gerçek bir kavşak içe aktar')} onClick={onClose}>
      <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <h2>🌍 {t('Real junction', 'Gerçek kavşak')}</h2>
          <button className="link" onClick={onClose}>
            {t('Close', 'Kapat')}
          </button>
        </header>
        <p className="hint">
          {t(
            'Search for a junction by name or address, or paste coordinates (41.0369, 28.9850) or an openstreetmap.org link.',
            'Bir kavşağı adıyla ya da adresiyle arayın veya koordinat (41.0369, 28.9850) ya da bir openstreetmap.org bağlantısı yapıştırın.',
          )}
        </p>
        <form
          className="row gap"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input className="text" aria-label={t('Place, address or coordinates', 'Yer, adres ya da koordinat')} placeholder={t('e.g. Karaköy, Istanbul', 'ör. Karaköy, İstanbul')} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <button className="btn primary" type="submit" disabled={step.kind === 'searching' || step.kind === 'loading'}>
            {t('Find', 'Bul')}
          </button>
        </form>

        {step.kind === 'searching' && <p className="hint">{t('Searching…', 'Aranıyor…')}</p>}
        {step.kind === 'loading' && (
          <p className="hint">
            {t(`Reading roads around ${step.place.label.split(',')[0]} from OpenStreetMap`, `${step.place.label.split(',')[0]} çevresindeki yollar OpenStreetMap’ten okunuyor`)}
            {step.server > 0 ? t(` (main server busy, trying another, ${step.server + 1}/3)`, ` (ana sunucu meşgul, başkası deneniyor, ${step.server + 1}/3)`) : ''}…
          </p>
        )}
        {step.kind === 'error' && <p className="alert">{step.message}</p>}

        {step.kind === 'results' && (
          <ul className="place-list">
            {step.places.map((p) => (
              <li key={`${p.lat},${p.lon}`}>
                <button className="place" onClick={() => void load(p)}>
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        {step.kind === 'preview' && (
          <div className="import-preview">
            <Sketch result={step.result} />
            <div>
              <h3>{step.result.scenario.name}</h3>
              <p className="hint">
                {hasRing(step.result.scenario.control) && step.result.scenario.control.type === 'signals'
                  ? t('Roundabout with traffic lights', 'Işıklı dönel kavşak')
                  : CONTROL_TEXT[step.result.scenario.control.type]()}{' '}
                ·{' '}
                {step.result.scenario.driveSide === 'right' ? t('drives on the right', 'sağdan akış') : t('drives on the left', 'soldan akış')} · {step.result.scenario.crosswalks.length}{' '}
                {t('crossings', 'yaya geçidi')}
              </p>
              <table className="legs import-legs">
                <thead>
                  <tr>
                    <th>{t('Road', 'Yol')}</th>
                    <th>{t('Type', 'Tür')}</th>
                    <th className="r">{t('In / out', 'Giriş / çıkış')}</th>
                  </tr>
                </thead>
                <tbody>
                  {step.result.legs.map((l, i) => (
                    <tr key={l.id}>
                      <td>
                        <span className="leg-badge small" style={{ background: legColor(i) }}>
                          {l.id}
                        </span>{' '}
                        {l.name || t('Unnamed road', 'Adsız yol')}
                      </td>
                      <td className="hint">{highwayText(l.highway)}</td>
                      <td className="r num">
                        {l.lanesIn} / {l.lanesOut}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="rules">
                {step.result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <div className="row gap">
                <button
                  className="btn primary"
                  onClick={() => {
                    onClose();
                    onOpen({ ...step.result.scenario, source: { ...step.result.scenario.source!, label: step.place.label } }, step.result.scenario.name);
                  }}
                >
                  {t('Open in the sandbox', 'Serbest modda aç')}
                </button>
                <button className="link" onClick={() => setStep({ kind: 'search' })}>
                  {t('Pick another', 'Başkasını seç')}
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="attribution">
          {t('Map data', 'Harita verisi')} ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            {t('OpenStreetMap contributors', 'OpenStreetMap katkıcıları')}
          </a>
          {t(
            ', ODbL. Search by Nominatim. Only what you type is sent, and only when you press Find.',
            ', ODbL. Arama: Nominatim. Yalnızca yazdığınız gönderilir, o da yalnızca Bul’a bastığınızda.',
          )}
        </p>
      </div>
    </div>
  );
}

/** The imported roads as spokes from the centre, as wide as their lanes. */
function Sketch({ result }: { result: ImportResult }) {
  const r = 70;
  return (
    <svg className="import-sketch" viewBox="-90 -90 180 180" role="img" aria-label={t('Sketch of the roads', 'Yolların taslağı')}>
      {hasRing(result.scenario.control) && <circle cx={0} cy={0} r={18} className="ring" />}
      {result.legs.map((l, i) => {
        const a = (l.angle * Math.PI) / 180;
        const lanes = Math.max(1, l.lanesIn + l.lanesOut);
        return (
          <g key={l.id}>
            <line x1={0} y1={0} x2={r * Math.cos(a)} y2={-r * Math.sin(a)} className="road" strokeWidth={4 + lanes * 3} />
            <circle cx={(r + 10) * Math.cos(a)} cy={-(r + 10) * Math.sin(a)} r={8} fill={legColor(i)} />
            <text x={(r + 10) * Math.cos(a)} y={-(r + 10) * Math.sin(a) + 3.5} className="badge-text">
              {l.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
