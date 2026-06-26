import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const pushNotifyMock = vi.fn();
vi.mock('./push/index.js', () => ({ pushNotify: (...a: unknown[]) => pushNotifyMock(...a) }));

import { notifyUser, setTelegramDelivery, toPushBody } from './notify.js';

beforeEach(() => {
  pushNotifyMock.mockReset();
  pushNotifyMock.mockResolvedValue({ targeted: 2, ok: 2, failed: 0, pruned: 0 });
  setTelegramDelivery(null);
});

describe('toPushBody', () => {
  it('strips HTML tags and decodes entities', () => {
    expect(toPushBody('<b>Hello</b> &amp; welcome &lt;you&gt;')).toBe('Hello & welcome <you>');
  });
  it('truncates long bodies', () => {
    const body = toPushBody('x'.repeat(500));
    expect(body.length).toBeLessThanOrEqual(200);
    expect(body.endsWith('…')).toBe(true);
  });
});

describe('notifyUser dual-delivery', () => {
  it('delivers to both Telegram and Expo in parallel', async () => {
    const tg = vi.fn(async () => {});
    setTelegramDelivery(tg);

    const res = await notifyUser('<b>Task done</b>', { category: 'scheduled', telegram: { parse_mode: 'HTML' } });

    expect(tg).toHaveBeenCalledWith('<b>Task done</b>', { parse_mode: 'HTML' });
    expect(pushNotifyMock).toHaveBeenCalledTimes(1);
    expect(pushNotifyMock.mock.calls[0][0]).toMatchObject({
      title: 'WildClaude',
      body: 'Task done', // HTML stripped for the push body
      category: 'scheduled',
    });
    expect(res.telegram).toEqual({ attempted: true, ok: true });
    expect(res.push).toMatchObject({ attempted: true, ok: true, targeted: 2 });
  });

  it('isolates channel failures: Telegram fails, push still ok', async () => {
    setTelegramDelivery(vi.fn(async () => {
      throw new Error('telegram down');
    }));

    const res = await notifyUser('hello');
    expect(res.telegram).toMatchObject({ attempted: true, ok: false, error: 'telegram down' });
    expect(res.push.ok).toBe(true);
    expect(pushNotifyMock).toHaveBeenCalledTimes(1);
  });

  it('reports push transport error without affecting Telegram', async () => {
    setTelegramDelivery(vi.fn(async () => {}));
    pushNotifyMock.mockResolvedValue({ targeted: 1, ok: 0, failed: 1, pruned: 0, error: 'Expo HTTP 500' });

    const res = await notifyUser('hi');
    expect(res.telegram.ok).toBe(true);
    expect(res.push).toMatchObject({ attempted: true, ok: false, error: 'Expo HTTP 500' });
  });

  it('skips Telegram when no backend is registered (dashboard-only mode)', async () => {
    const res = await notifyUser('hi');
    expect(res.telegram).toEqual({ attempted: false, ok: false });
    expect(res.push.attempted).toBe(true);
  });

  it('honors toPush=false (Telegram only)', async () => {
    const tg = vi.fn(async () => {});
    setTelegramDelivery(tg);
    const res = await notifyUser('only telegram', { toPush: false });
    expect(tg).toHaveBeenCalledTimes(1);
    expect(pushNotifyMock).not.toHaveBeenCalled();
    expect(res.push.attempted).toBe(false);
  });

  it('honors toTelegram=false (push only) and custom push fields', async () => {
    const tg = vi.fn(async () => {});
    setTelegramDelivery(tg);
    await notifyUser('ignored', {
      toTelegram: false,
      push: { title: 'Alert', body: 'custom body', data: { url: '/talk' }, badge: 3 },
    });
    expect(tg).not.toHaveBeenCalled();
    expect(pushNotifyMock.mock.calls[0][0]).toMatchObject({
      title: 'Alert',
      body: 'custom body',
      data: { url: '/talk' },
      badge: 3,
    });
  });
});
