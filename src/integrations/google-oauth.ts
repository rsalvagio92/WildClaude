/**
 * Google OAuth refresh helper (Gmail + Calendar).
 *
 * Google access tokens expire in 1 hour. Storing only the raw access token
 * means the MCP servers break silently after an hour. This module:
 *   - Reads access + refresh tokens from secrets/env
 *   - Caches the access token in memory with its expiry
 *   - Auto-refreshes via the OAuth2 token endpoint when the cached token
 *     is within 60s of expiry
 *
 * Config:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GMAIL_ACCESS_TOKEN     (initial — gets replaced via refresh)
 *   GMAIL_REFRESH_TOKEN    (issued at first consent, long-lived)
 *   GCAL_ACCESS_TOKEN
 *   GCAL_REFRESH_TOKEN
 *
 * Backward compatible: if no refresh token is set, the old behavior
 * (use the raw access token) still works — until it expires.
 */

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';

interface CachedToken {
  accessToken: string;
  expiresAt: number; // ms epoch
}

const cache = new Map<'gmail' | 'gcal', CachedToken>();

function clientCreds(): { clientId: string; clientSecret: string } | null {
  const s = readEnvFile(['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']);
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || s.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || s.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function refreshAccessToken(refreshToken: string): Promise<CachedToken | null> {
  const creds = clientCreds();
  if (!creds) {
    logger.warn('google-oauth: GOOGLE_OAUTH_CLIENT_ID/SECRET not set, cannot refresh');
    return null;
  }
  try {
    const params = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) {
      const t = await res.text();
      logger.warn({ status: res.status, body: t.slice(0, 200) }, 'google-oauth: refresh failed');
      return null;
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 60s before expiry
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'google-oauth: exception during refresh');
    return null;
  }
}

/**
 * Get a fresh access token for either gmail or gcal. Reads:
 *   - GMAIL_ACCESS_TOKEN + GMAIL_REFRESH_TOKEN  (kind='gmail')
 *   - GCAL_ACCESS_TOKEN + GCAL_REFRESH_TOKEN    (kind='gcal')
 *
 * Returns the static access token if no refresh token is configured
 * (backward compatible with the raw-token setup).
 */
export async function getGoogleAccessToken(kind: 'gmail' | 'gcal'): Promise<string> {
  const cached = cache.get(kind);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  const accessKey = kind === 'gmail' ? 'GMAIL_ACCESS_TOKEN' : 'GCAL_ACCESS_TOKEN';
  const refreshKey = kind === 'gmail' ? 'GMAIL_REFRESH_TOKEN' : 'GCAL_REFRESH_TOKEN';
  const s = readEnvFile([accessKey, refreshKey]);
  const access = process.env[accessKey] || s[accessKey] || '';
  const refresh = process.env[refreshKey] || s[refreshKey] || '';

  if (refresh) {
    const fresh = await refreshAccessToken(refresh);
    if (fresh) {
      cache.set(kind, fresh);
      return fresh.accessToken;
    }
    // Refresh failed — fall through to whatever access token we have
    logger.warn({ kind }, 'google-oauth: refresh failed, using raw access token (may be expired)');
  }
  if (!access) {
    throw new Error(`Google ${kind} not configured. Set ${accessKey}${refresh ? '' : ` + ${refreshKey}`}.`);
  }
  return access;
}
