import { useEffect, useRef, useState } from 'react';
import { fetchRoads, parsePlace, searchPlaces, type Place } from '../../osm/api';
import { osmToScenario, type ImportResult } from '../../osm/convert';
import { legColor } from '../../render/theme';
import { useApp } from '../store';

type Step =
  | { kind: 'search' }
  | { kind: 'searching' }
  | { kind: 'results'; places: Place[] }
  | { kind: 'loading'; place: Place; server: number }
  | { kind: 'preview'; place: Place; result: ImportResult }
  | { kind: 'error'; message: string };

const CONTROL_TEXT = { priority: 'Priority / give way', signals: 'Traffic lights', roundabout: 'Roundabout' } as const;

/** Find a real junction on OpenStreetMap and open it in the sandbox. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const loadDesign = useApp((s) => s.loadDesign);
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
      if (!signal.aborted) setStep({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' });
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
      setStep(places.length ? { kind: 'results', places } : { kind: 'error', message: 'Nothing found. Try another name, or paste coordinates.' });
    } catch (e) {
      if (!signal.aborted) setStep({ kind: 'error', message: e instanceof Error ? e.message : 'Search failed.' });
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Import a real junction" onClick={onClose}>
      <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <h2>🌍 Real junction</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="hint">Search for a junction by name or address, or paste coordinates (41.0369, 28.9850) or an openstreetmap.org link.</p>
        <form
          className="row gap"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input className="text" aria-label="Place, address or coordinates" placeholder="e.g. Karaköy, Istanbul" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <button className="btn primary" type="submit" disabled={step.kind === 'searching' || step.kind === 'loading'}>
            Find
          </button>
        </form>

        {step.kind === 'searching' && <p className="hint">Searching…</p>}
        {step.kind === 'loading' && (
          <p className="hint">
            Reading roads around {step.place.label.split(',')[0]} from OpenStreetMap{step.server > 0 ? ` (main server busy, trying another, ${step.server + 1}/3)` : ''}…
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
                {CONTROL_TEXT[step.result.scenario.control.type]} · drives on the {step.result.scenario.driveSide} · {step.result.scenario.crosswalks.length} crossings
              </p>
              <table className="legs import-legs">
                <thead>
                  <tr>
                    <th>Road</th>
                    <th>Type</th>
                    <th className="r">In / out</th>
                  </tr>
                </thead>
                <tbody>
                  {step.result.legs.map((l, i) => (
                    <tr key={l.id}>
                      <td>
                        <span className="leg-badge small" style={{ background: legColor(i) }}>
                          {l.id}
                        </span>{' '}
                        {l.name || 'Unnamed road'}
                      </td>
                      <td className="hint">{l.highway.replace('_', ' ')}</td>
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
                    loadDesign({ ...step.result.scenario, source: { ...step.result.scenario.source!, label: step.place.label } });
                    onClose();
                  }}
                >
                  Open in the sandbox
                </button>
                <button className="link" onClick={() => setStep({ kind: 'search' })}>
                  Pick another
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="attribution">
          Map data ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap contributors
          </a>
          , ODbL. Search by Nominatim. Only what you type is sent, and only when you press Find.
        </p>
      </div>
    </div>
  );
}

/** The imported roads as spokes from the centre, as wide as their lanes. */
function Sketch({ result }: { result: ImportResult }) {
  const r = 70;
  return (
    <svg className="import-sketch" viewBox="-90 -90 180 180" role="img" aria-label="Sketch of the roads">
      {result.scenario.control.type === 'roundabout' && <circle cx={0} cy={0} r={18} className="ring" />}
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
