/**
 * Self-signed TLS for the dashboard.
 *
 * Browser features that need a secure context — microphone / Web Speech voice
 * input — are blocked on plain http://<lan-ip>. Serving the dashboard over
 * HTTPS (even self-signed) makes the origin secure, so voice works across the
 * LAN once the user accepts the certificate once per device.
 *
 * The cert is generated with `selfsigned` (pure JS, no native build) and cached
 * in USER_DATA_DIR. Subject-alt-names include localhost, 127.0.0.1 and every
 * non-internal IPv4 address so the same cert is valid however you reach the box.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

import { USER_DATA_DIR } from './paths.js';
import { logger } from './logger.js';

const require = createRequire(import.meta.url);

export interface TlsPair { key: string; cert: string; }

const KEY_PATH = path.join(USER_DATA_DIR, 'dashboard-tls.key');
const CERT_PATH = path.join(USER_DATA_DIR, 'dashboard-tls.crt');

/** Non-internal IPv4 addresses of this host (LAN + Tailscale, etc.). */
export function localIPv4s(): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const ni of list || []) {
      if (ni && !ni.internal && ni.family === 'IPv4') out.push(ni.address);
    }
  }
  return out;
}

/** Load the cached cert, or generate + cache a new one. Returns null on failure. */
export function getOrCreateDashboardCert(hostname?: string): TlsPair | null {
  try {
    if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
      return { key: fs.readFileSync(KEY_PATH, 'utf8'), cert: fs.readFileSync(CERT_PATH, 'utf8') };
    }
  } catch { /* regenerate below */ }

  try {
    const selfsigned = require('selfsigned') as { generate: (attrs: unknown[], opts: unknown) => { private: string; cert: string } };
    const altNames: Array<Record<string, unknown>> = [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
      ...localIPv4s().map((ip) => ({ type: 7, ip })),
    ];
    if (hostname && !['0.0.0.0', '::', 'localhost'].includes(hostname)) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) altNames.push({ type: 7, ip: hostname });
      else altNames.push({ type: 2, value: hostname });
    }
    const pems = selfsigned.generate(
      [{ name: 'commonName', value: 'WildClaude Dashboard' }],
      { days: 3650, keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames }] },
    );
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_PATH, pems.private, { mode: 0o600 });
    fs.writeFileSync(CERT_PATH, pems.cert);
    logger.info({ altNames: altNames.length }, 'Generated self-signed TLS cert for dashboard HTTPS');
    return { key: pems.private, cert: pems.cert };
  } catch (err) {
    logger.error({ err }, 'Could not generate TLS cert — dashboard will fall back to HTTP');
    return null;
  }
}
