// Reflection & Digest — list/generate/ack reflections, period digests.
import { api } from '../api.js';
import {
  el, mount, clear, asyncView, stat, badge, card, confirmDialog, toast,
  toastOk, toastErr, action, loading, empty, errbox, fmtTime, fmtAgo,
} from '../ui.js';

// Patterns may arrive as an array or a JSON string — normalise to array.
function parsePatterns(p) {
  if (Array.isArray(p)) return p;
  if (typeof p === 'string' && p.trim()) {
    try {
      const parsed = JSON.parse(p);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
    return [p];
  }
  return [];
}

export default {
  async mount(view) {
    const root = el('div');
    mount(view, root);

    const reflCard = el('div');
    const digestCard = el('div');
    mount(root, reflCard, el('div', { style: 'height:14px' }), digestCard);

    // ── Reflections ──────────────────────────────────────────────────
    let reloadRefl = () => {};

    const genBtn = (label, period) => {
      const btn = el('button.btn.btn-accent.btn-sm', { text: label });
      btn.addEventListener('click', async () => {
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = '⏳ Generating…';
        try {
          const { reflection } = await api.post('/api/reflections/generate', { period });
          toastOk('Reflection generated');
          if (reflection && reflection.summary) toast(reflection.summary.slice(0, 120), '');
          reloadRefl();
        } catch (e) {
          toastErr(e.message || String(e));
        } finally {
          btn.disabled = false;
          btn.textContent = orig;
        }
      });
      return btn;
    };

    const renderReflection = (r) => {
      const patterns = parsePatterns(r.patterns);
      const acked = r.acknowledged === true || r.acknowledged === 1;
      const body = [
        el('div.row', { style: 'gap:8px;align-items:center' }, [
          badge(r.period || '—', 'accent'),
          acked ? badge('acknowledged', 'ok') : badge('new', 'warn'),
          el('span.grow', {}),
          el('span.muted', { style: 'font-size:12px', text: fmtAgo(r.createdAt ?? r.created_at) }),
        ]),
        el('div', { style: 'margin-top:8px;white-space:pre-wrap', text: r.summary || '(no summary)' }),
      ];
      if (patterns.length) {
        body.push(el('div.section-title', { text: 'Patterns' }));
        body.push(el('ul', { style: 'margin:4px 0 0;padding-left:18px' }, patterns.map((p) => el('li', { text: String(p) }))));
      }
      if (!acked) {
        body.push(el('div.btn-row', { style: 'margin-top:10px' }, [
          el('button.btn.btn-sm', {
            text: 'Acknowledge',
            onclick: () => action(() => api.post(`/api/reflections/${r.id}/ack`), { ok: 'Acknowledged', refresh: reloadRefl }),
          }),
        ]));
      }
      return el('div.card', { style: 'padding:12px;margin-bottom:10px' }, body);
    };

    const reflBody = el('div');
    reloadRefl = asyncView(reflBody, () => api.get('/api/reflections?limit=20'), (d) => {
      const reflections = d.reflections || [];
      if (!reflections.length) return empty('No reflections yet — generate one above.');
      return el('div', {}, reflections.map(renderReflection));
    });

    mount(reflCard, card('Reflections', [
      el('div.btn-row', {}, [genBtn('Generate today', 'day'), genBtn('Generate this week', 'week')]),
      el('p.muted', { style: 'font-size:12px', text: 'Generation runs an LLM and may take a moment.' }),
      el('div', { style: 'height:8px' }),
      reflBody,
    ]));

    // ── Digest ───────────────────────────────────────────────────────
    const digestBody = el('div');
    const loadDigest = (period) => {
      asyncView(digestBody, () => api.get(`/api/digest?period=${encodeURIComponent(period)}`), (d) => {
        const out = [];
        const metrics = d.metrics || {};
        const metricKeys = Object.keys(metrics);
        if (metricKeys.length) {
          out.push(el('div.grid.grid-stat', {}, metricKeys.map((k) => {
            const v = metrics[k];
            const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
            return stat(typeof v === 'number' ? v.toLocaleString() : String(v ?? '—'), label);
          })));
        }
        if (d.periodStart && d.periodEnd) {
          out.push(el('p.muted', { style: 'font-size:12px;margin-top:8px', text: `${fmtTime(d.periodStart)} → ${fmtTime(d.periodEnd)}` }));
        }
        out.push(el('pre.block', { style: 'margin-top:8px', text: d.body || '(no digest body)' }));
        return el('div', {}, out);
      });
    };

    const periodBtns = el('div.btn-row', {});
    let activePeriod = 'day';
    const setPeriod = (period, btnEls) => {
      activePeriod = period;
      btnEls.forEach((b) => { b.className = 'btn btn-sm' + (b.dataset.period === period ? ' btn-accent' : ''); });
      loadDigest(period);
    };
    const btns = [['Day', 'day'], ['Week', 'week'], ['Month', 'month']].map(([label, p]) =>
      el('button.btn.btn-sm', { text: label, dataset: { period: p } }));
    btns.forEach((b) => b.addEventListener('click', () => setPeriod(b.dataset.period, btns)));
    mount(periodBtns, ...btns);

    mount(digestCard, card('Digest', [periodBtns, el('div', { style: 'height:10px' }), digestBody]));
    setPeriod('day', btns);
  },
};
