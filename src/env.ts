import fs from 'fs';
import path from 'path';

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
// Cache parsed .env to avoid repeated disk reads on every message
let _envCache: Record<string, string> | null = null;
let _envCacheTime = 0;
const ENV_CACHE_TTL = 60_000; // 60 seconds

function parseEnvFile(): Record<string, string> {
  const envFile = path.join(process.cwd(), '.env');
  let raw: string;
  try {
    raw = fs.readFileSync(envFile, 'utf-8');
  } catch {
    return {};
  }

  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }
  return result;
}

export function readEnvFile(keys: string[]): Record<string, string> {
  const now = Date.now();
  if (!_envCache || now - _envCacheTime > ENV_CACHE_TTL) {
    _envCache = parseEnvFile();
    _envCacheTime = now;
  }

  const result: Record<string, string> = {};
  for (const key of keys) {
    if (_envCache[key]) result[key] = _envCache[key];
  }
  return result;
}

/** Force-reload .env from disk (e.g. after writing a new secret). */
export function invalidateEnvCache(): void {
  _envCache = null;
  _envCacheTime = 0;
}
