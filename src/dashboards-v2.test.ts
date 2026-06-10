import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase, getDb, insertDashboardData } from './db.js';
import { normalizeSpec, resolveWidget, type Widget } from './dashboards-v2.js';

describe('dashboards-v2', () => {
  beforeEach(() => { _initTestDatabase(); });

  describe('normalizeSpec', () => {
    it('clamps widget width to 1–12 and defaults unknown types to note', () => {
      const spec = normalizeSpec({
        title: 'X',
        widgets: [
          { id: 'a', type: 'metric', title: 'M', w: 99 } as Widget,
          { id: 'b', type: 'bogus' as unknown as Widget['type'], title: 'B', w: -3 } as Widget,
        ],
      });
      expect(spec.widgets[0].w).toBe(12);   // clamped down from 99
      expect(spec.widgets[1].w).toBe(1);    // clamped up from -3
      expect(spec.widgets[1].type).toBe('note');
      expect(spec.id).toMatch(/^x-/); // slug + suffix
    });

    it('assigns ids to widgets missing one and caps the count', () => {
      const spec = normalizeSpec({ title: 'T', widgets: Array.from({ length: 40 }, () => ({ type: 'metric', title: 'm' } as Widget)) });
      expect(spec.widgets.length).toBe(30);
      expect(spec.widgets[0].id).toBeTruthy();
    });
  });

  describe('resolveWidget — local aggregations', () => {
    // Reader widget shares the id 'log' with where data is stored, so the
    // resolver's default readId (config.readWidget || widget.id) reads it.
    const mk = (source: Widget['source']): Widget => ({ id: 'log', type: 'metric', title: 'log', source, config: {} });
    const backdate = (data: object, at: number) =>
      getDb().prepare('INSERT INTO dashboard_data (dashboard_id, widget_id, data, created_at) VALUES (?,?,?,?)').run('d1', 'log', JSON.stringify(data), at);

    it('static returns its value', async () => {
      const r = await resolveWidget('d1', { id: 'w', type: 'metric', title: 'w', source: { kind: 'static', value: 42 }, config: {} });
      expect(r).toEqual({ ok: true, data: 42 });
    });

    it('sum / avg / count over logged rows', async () => {
      for (const v of [10, 20, 30]) insertDashboardData('d1', 'log', { value: v });
      expect((await resolveWidget('d1', mk({ kind: 'local', field: 'value', agg: 'sum' }))).data).toBe(60);
      expect((await resolveWidget('d1', mk({ kind: 'local', field: 'value', agg: 'avg' }))).data).toBe(20);
      expect((await resolveWidget('d1', mk({ kind: 'local', field: 'value', agg: 'count' }))).data).toBe(3);
    });

    it('last returns the most recent value for the named field', async () => {
      insertDashboardData('d1', 'log', { weight: 80 });
      insertDashboardData('d1', 'log', { weight: 82 });
      expect((await resolveWidget('d1', mk({ kind: 'local', field: 'weight', agg: 'last' }))).data).toBe(82);
    });

    it('streak counts consecutive logged days (today + yesterday)', async () => {
      const now = Math.floor(Date.now() / 1000);
      backdate({}, now - 86400);   // yesterday
      insertDashboardData('d1', 'log', {}); // today
      expect((await resolveWidget('d1', mk({ kind: 'local', agg: 'streak' }))).data).toBe(2);
    });

    it('delta compares current vs previous period', async () => {
      const now = Math.floor(Date.now() / 1000);
      backdate({ value: 100 }, now);            // current 7d window
      backdate({ value: 50 }, now - 8 * 86400); // previous 7d window
      const d = (await resolveWidget('d1', mk({ kind: 'local', field: 'value', agg: 'delta', sinceDays: 7 }))).data as { current: number; previous: number; changePct: number };
      expect(d.current).toBe(100);
      expect(d.previous).toBe(50);
      expect(Math.round(d.changePct)).toBe(100);
    });

    it('empty streak is 0 and empty delta has null changePct', async () => {
      expect((await resolveWidget('d1', mk({ kind: 'local', agg: 'streak' }))).data).toBe(0);
      const d = (await resolveWidget('d1', mk({ kind: 'local', field: 'value', agg: 'delta' }))).data as { changePct: number | null };
      expect(d.changePct).toBeNull();
    });
  });
});
