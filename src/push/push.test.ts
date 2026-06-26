import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { _initTestDatabase } from '../db.js';
import {
  registerDevice,
  setDevicePrefs,
  getDevice,
  getEligibleTokens,
  listDevices,
  removeDevice,
  isValidExpoToken,
} from './devices.js';
import { pushNotify } from './expo.js';

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('../secrets.js', () => ({ getSecret: () => undefined }));

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

beforeEach(() => {
  _initTestDatabase();
});

describe('push token validation', () => {
  it('accepts valid Expo tokens', () => {
    expect(isValidExpoToken(TOKEN_A)).toBe(true);
    expect(isValidExpoToken('ExpoPushToken[xyz]')).toBe(true);
  });
  it('rejects junk', () => {
    expect(isValidExpoToken('not-a-token')).toBe(false);
    expect(isValidExpoToken('')).toBe(false);
    expect(isValidExpoToken(null)).toBe(false);
    expect(isValidExpoToken('ExponentPushToken[]')).toBe(false);
  });
});

describe('device registry', () => {
  it('registers a device and reads it back', () => {
    const d = registerDevice({ token: TOKEN_A, platform: 'ios', deviceName: 'iPhone' });
    expect(d.token).toBe(TOKEN_A);
    expect(d.platform).toBe('ios');
    expect(d.enabled).toBe(true);
    expect(d.prefs).toEqual({ enabled: true, categories: {} });
    expect(getDevice(TOKEN_A)?.deviceName).toBe('iPhone');
    expect(listDevices()).toHaveLength(1);
  });

  it('throws on an invalid token', () => {
    expect(() => registerDevice({ token: 'garbage' })).toThrow(/invalid Expo push token/);
  });

  it('is idempotent on token and preserves prefs across re-registration', () => {
    registerDevice({ token: TOKEN_A, platform: 'ios' });
    setDevicePrefs(TOKEN_A, { categories: { chat: false } });
    // Re-register without prefs — must NOT clobber the stored category opt-out.
    registerDevice({ token: TOKEN_A, platform: 'ios', deviceName: 'renamed' });
    const d = getDevice(TOKEN_A)!;
    expect(listDevices()).toHaveLength(1);
    expect(d.deviceName).toBe('renamed');
    expect(d.prefs.categories.chat).toBe(false);
  });

  it('updates prefs (master switch + categories)', () => {
    registerDevice({ token: TOKEN_A });
    const updated = setDevicePrefs(TOKEN_A, { enabled: false, categories: { agent: false } });
    expect(updated?.enabled).toBe(false);
    expect(updated?.prefs.categories.agent).toBe(false);
    // categories merge, not replace
    const merged = setDevicePrefs(TOKEN_A, { categories: { chat: false } });
    expect(merged?.prefs.categories).toEqual({ agent: false, chat: false });
  });

  it('setDevicePrefs returns null for unknown token', () => {
    expect(setDevicePrefs('ExponentPushToken[nope]', { enabled: false })).toBeNull();
  });

  it('removes a device', () => {
    registerDevice({ token: TOKEN_A });
    expect(removeDevice(TOKEN_A)).toBe(true);
    expect(getDevice(TOKEN_A)).toBeNull();
    expect(removeDevice(TOKEN_A)).toBe(false);
  });

  it('eligible tokens honor master switch and per-category opt-out', () => {
    registerDevice({ token: TOKEN_A });
    registerDevice({ token: TOKEN_B });
    setDevicePrefs(TOKEN_B, { categories: { chat: false } });

    expect(getEligibleTokens().sort()).toEqual([TOKEN_A, TOKEN_B].sort());
    // B opted out of 'chat'
    expect(getEligibleTokens('chat')).toEqual([TOKEN_A]);
    // both still get 'agent' (default-on)
    expect(getEligibleTokens('agent').sort()).toEqual([TOKEN_A, TOKEN_B].sort());

    // disabling master switch removes from all
    setDevicePrefs(TOKEN_A, { enabled: false });
    expect(getEligibleTokens('agent')).toEqual([TOKEN_B]);
  });
});

describe('expo dispatcher', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns zero result when no devices are registered', async () => {
    const res = await pushNotify({ body: 'hi' });
    expect(res).toEqual({ targeted: 0, ok: 0, failed: 0, pruned: 0 });
  });

  it('sends to eligible devices and reports ok tickets', async () => {
    registerDevice({ token: TOKEN_A });
    registerDevice({ token: TOKEN_B });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ status: 'ok', id: '1' }, { status: 'ok', id: '2' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await pushNotify({ title: 'WildClaude', body: 'ping', category: 'chat', data: { x: 1 } });
    expect(res).toMatchObject({ targeted: 2, ok: 2, failed: 0, pruned: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('exp.host');
    const sent = JSON.parse(opts.body as string);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ to: TOKEN_A, title: 'WildClaude', body: 'ping', priority: 'high' });
  });

  it('prunes tokens Expo reports as DeviceNotRegistered', async () => {
    registerDevice({ token: TOKEN_A });
    registerDevice({ token: TOKEN_B });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { status: 'ok', id: '1' },
            { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          ],
        }),
      })),
    );

    const res = await pushNotify({ body: 'hi' });
    expect(res).toMatchObject({ targeted: 2, ok: 1, failed: 1, pruned: 1 });
    // The dead token (second one sent) was removed.
    const remaining = listDevices().map((d) => d.token);
    expect(remaining).toHaveLength(1);
    expect(remaining).toContain(TOKEN_A);
  });

  it('handles transport failure without throwing', async () => {
    registerDevice({ token: TOKEN_A });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })));
    const res = await pushNotify({ body: 'hi' });
    expect(res.failed).toBe(1);
    expect(res.error).toMatch(/500/);
    // device is NOT pruned on a transport error
    expect(listDevices()).toHaveLength(1);
  });
});
