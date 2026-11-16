// Talking to OpenStreetMap's public services: Nominatim to find a place, Overpass to read the roads.
// Both are free, shared services: we ask only when the player asks, one request at a time.
import { ROAD_FILTER, SEARCH_RADIUS, type OsmElement } from './convert';

export interface Place {
  label: string;
  lat: number;
  lon: number;
}

/** Read a position typed or pasted directly: "41.0369, 28.985" or an openstreetmap.org link. */
export function parsePlace(input: string): Place | null {
  const text = input.trim();
  const pair = text.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  const link = text.match(/map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/) ?? text.match(/mlat=(-?\d+(?:\.\d+)?).*mlon=(-?\d+(?:\.\d+)?)/);
  const m = pair ?? link;
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon };
}

/** Up to five places matching a search, from Nominatim. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(res.status === 429 ? 'The place search is busy. Wait a few seconds and try again.' : `Place search failed (${res.status}).`);
  const rows = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }));
}

/** Public Overpass servers, tried in turn: the main one is often at capacity. */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

/** The roads (and signal and crossing points) around a place. */
export async function fetchRoads(place: Place, signal?: AbortSignal, onAttempt?: (server: number) => void): Promise<OsmElement[]> {
  const r = SEARCH_RADIUS + 60;
  const query =
    `[out:json][timeout:25];` +
    `way(around:${r},${place.lat},${place.lon})[highway~"^(${ROAD_FILTER})$"];(._;>;);out body;` +
    `node(around:${r},${place.lat},${place.lon})[highway~"^(traffic_signals|crossing|stop|give_way)$"];out body;`;
  let lastError = 'Could not reach OpenStreetMap.';
  for (let i = 0; i < OVERPASS.length; i++) {
    onAttempt?.(i);
    try {
      const timeout = AbortSignal.timeout(30000);
      const res = await fetch(OVERPASS[i]!, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (res.ok) return ((await res.json()) as { elements: OsmElement[] }).elements;
      lastError = res.status === 429 || res.status >= 500 ? 'OpenStreetMap servers are busy right now. Try again in a minute.' : `OpenStreetMap request failed (${res.status}).`;
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = 'Could not reach OpenStreetMap. Check your connection, or try again in a minute.';
    }
  }
  throw new Error(lastError);
}
