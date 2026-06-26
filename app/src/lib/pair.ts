// Pairing payload helpers. The web dashboard encodes {url, token, name} into a
// QR code (JSON or a wildclaude:// deep link). The app decodes either form.
import type { ServerProfile } from '@/store/servers';

export interface PairPayload {
  url: string;
  token: string;
  name?: string;
  certSha256?: string;
}

// Tiny stable id from the URL (no crypto dep needed for a local key).
function idFromUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
  return 'srv_' + (h >>> 0).toString(36);
}

/** Parse a scanned QR string (JSON or wildclaude:// link) into a payload. */
export function parsePairing(raw: string): PairPayload | null {
  const s = raw.trim();
  try {
    if (s.startsWith('{')) {
      const o = JSON.parse(s);
      if (o.url && o.token) return { url: String(o.url), token: String(o.token), name: o.name, certSha256: o.certSha256 };
    }
    if (s.startsWith('wildclaude://')) {
      const u = new URL(s);
      const url = u.searchParams.get('url');
      const token = u.searchParams.get('token');
      if (url && token) return { url, token, name: u.searchParams.get('name') || undefined, certSha256: u.searchParams.get('cert') || undefined };
    }
  } catch {
    return null;
  }
  return null;
}

export function toProfile(p: PairPayload): ServerProfile {
  const url = p.url.replace(/\/+$/, '');
  return {
    id: idFromUrl(url),
    name: p.name || url.replace(/^https?:\/\//, ''),
    url,
    token: p.token,
    pinnedCertSha256: p.certSha256,
  };
}
