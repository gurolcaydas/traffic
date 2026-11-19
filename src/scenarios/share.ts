// Sharing a design by link: the design, compressed, travels in the URL's hash. No server sees it,
// because browsers never send the hash part of a URL.
import { t } from '../core/i18n';
import type { Scenario } from '../core/types';
import { parseScenario } from './storage';

/** The hash looks like `#design=<payload>`. */
const PARAM = 'design';

/**
 * Leading character of the payload, so the format can change later and old links still open.
 * `1` is deflate-raw over the same JSON as a design file, in base64url.
 */
const FORMAT = '1';

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The hash fragment (with its `#`) that opens this design. */
export async function shareHash(name: string, scenario: Scenario): Promise<string> {
  const json = JSON.stringify({ app: 'traffic', kind: 'design', name, scenario });
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return `#${PARAM}=${FORMAT}${toBase64Url(packed)}`;
}

/** The payload of a shared-design hash, or null if this hash isn't one. */
export function sharedPayload(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.get(PARAM);
}

/** Read a design back from a link's payload, checked like an imported file. */
export async function readShared(payload: string): Promise<{ scenario?: Scenario; name?: string; error?: string }> {
  if (payload[0] !== FORMAT) return { error: t('This link is from a newer version of the app.', 'Bu bağlantı uygulamanın daha yeni bir sürümünden.') };
  try {
    const bytes = await pipe(fromBase64Url(payload.slice(1)), new DecompressionStream('deflate-raw'));
    return parseScenario(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return { error: t('This link is damaged. Was it copied in full?', 'Bu bağlantı bozuk. Tamamı kopyalandı mı?') };
  }
}
