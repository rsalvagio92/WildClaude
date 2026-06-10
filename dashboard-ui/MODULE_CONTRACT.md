# Dashboard module authoring contract

Every module is a file at `dashboard-ui/js/modules/<id>.js` with a default export:

```js
export default {
  async mount(view, ctx) {
    // `view` is an empty <section> element to render into.
    // Build DOM with the ui.js helpers and mount it.
    // Return an OPTIONAL cleanup function (clear intervals, SSE unsubs).
  },
};
```

The router lazy-imports the file on navigation, calls `mount(view, ctx)`, and calls the
returned cleanup on navigate-away. A throw inside mount shows an inline error box — it never
crashes the app.

## Imports — use these, don't reinvent

From `../api.js`:
- `api.get(path)`, `api.post(path, body)`, `api.put(path, body)`, `api.patch(path, body)`, `api.del(path)` — all return parsed JSON, throw `ApiError {status, message}` on non-2xx.
- `chatId()` → async, returns the owner chat id (use for endpoints needing `?chatId=`).
- `models()` → async `{ models: [{id,alias,label,description}], default }`.
- `ticketUrl(path)` → async; returns a URL authed by a short-lived signed ticket (use for downloads/streams; never put the raw token in a URL). `getTicket()` for the bare ticket.

From `../ui.js`:
- `el(spec, attrs, children)` — builder. `el('div.card.foo', {onclick, text, html, dataset, value, disabled, placeholder, ...}, [children])`. Event handlers via `onclick`/`oninput`/`onchange`/`onkeydown` (lowercased). `text` sets textContent (safe), `html` sets innerHTML (escape first!).
- `mount(container, ...nodes)`, `clear(node)` — replace/empty children.
- `escapeHtml(s)` — ALWAYS use before `html:` with user/API data.
- `loading(msg)`, `empty(msg)`, `errbox(msg)` — state placeholders.
- `asyncView(container, loader, render, loadingMsg)` — shows spinner, awaits loader(), renders render(data, rerun); error box on throw. `render` receives `(data, rerun)` — call `rerun()` to reload. PREFER THIS for read views.
- `stat(value, key)`, `badge(text, kind)` (kind: ''|'ok'|'warn'|'err'|'accent'), `card(title, bodyNodes, headExtra)`.
- `modal({title, body, footer, onClose, wide})` → `{close, box}`.
- `confirmDialog(message, onConfirm, {danger, confirmText})`.
- `toast(msg, kind)`, `toastOk`, `toastErr`, `action(fn, {ok, refresh})` — wraps a mutation, toasts ok/err, optionally calls refresh().
- `modelSelect(currentId, attrs)` → async `<select>` built from /api/models. Use for ALL model dropdowns.
- Formatters: `fmtTime(ts)`, `fmtAgo(ts)`, `fmtBytes(b)`, `fmtUsd(n)`, `truncate(s, n)`. (Timestamps may be seconds or ms — fmt* handle both.)

From `../sse.js` (only if the module needs live events):
- `onSSE(type, fn)` → returns an unsubscribe fn. Types: `processing`, `user_message`, `assistant_message`, `progress`, `error`.

## Conventions

- Page header: start with `el('div.page-head', {}, [el('div', {}, [el('h3'...), el('p.muted'...)]), <actions>])`.
- Read views: use `asyncView`. Mutations: use `action(() => api.post(...), {ok:'Saved', refresh})`.
- Every list handles empty (`empty()`) and the loader's error is handled by asyncView.
- Confirm destructive actions with `confirmDialog`.
- Classes available: `.card .grid .grid-2 .grid-3 .grid-stat .row .grow .field .btn .btn-accent .btn-danger .btn-sm .btn-ghost .btn-row .table-wrap .badge .pill .bar .tabs .tab .kv .split .section-title .page-head .stat .pre.block`.
- Tables: `el('div.table-wrap', {}, [el('table', {}, [el('thead', {}, el('tr', {}, [el('th',{text})...])), el('tbody', {}, rows)])])`.
- Forms in modals: `el('div.field', {}, [el('label', {text}), input])`.
- NEVER hardcode model IDs — use `modelSelect()` / `models()`.
- Match the look of the two reference modules: `command.js` and `vitals.js`. Read them.

## Don't

- No external CDN libs, no build step — plain ES modules only.
- No `innerHTML` with un-escaped API data.
- Don't leak intervals/SSE subscriptions — return a cleanup fn.
