// Command Center — live chat with the bot over SSE.
import { api, chatId } from '../api.js';
import { onSSE } from '../sse.js';
import { el, mount, clear, escapeHtml, toastErr, fmtUsd } from '../ui.js';

export default {
  async mount(view) {
    const cid = await chatId();
    const log = el('div.chat-log');
    const input = el('textarea', { placeholder: 'Message WildClaude…  (Enter to send, Shift+Enter for newline)', rows: 1 });
    const sendBtn = el('button.btn.btn-accent', { text: 'Send' });

    const wrap = el('div.chat-wrap', {}, [
      log,
      el('div.chat-input-row', {}, [el('div.grow', {}, [input]), sendBtn]),
    ]);
    mount(view, wrap);

    const bubble = (cls, text, meta) => {
      const b = el('div.bubble.' + cls, { html: escapeHtml(text) });
      if (meta) b.appendChild(el('div.bubble-meta', { text: meta }));
      log.appendChild(b);
      log.scrollTop = log.scrollHeight;
      return b;
    };

    // History
    try {
      const { turns } = await api.get(`/api/chat/history?chatId=${encodeURIComponent(cid)}&limit=30`);
      (turns || []).forEach((t) => bubble(t.role === 'user' ? 'user' : 'assistant', t.content || ''));
    } catch { /* empty history ok */ }
    if (!log.children.length) bubble('progress', 'No messages yet — say hello.');

    // Live events
    let processing = false;
    const setBusy = (v) => { processing = v; sendBtn.disabled = v; sendBtn.textContent = v ? '…' : 'Send'; };
    const unsubs = [
      onSSE('processing', (d) => setBusy(!!d.processing)),
      onSSE('user_message', (d) => bubble('user', d.content || '')),
      onSSE('assistant_message', (d) => bubble('assistant', d.content || '', d.model ? `${d.model.replace('claude-', '')}${d.cost ? ' · ' + fmtUsd(d.cost) : ''}` : '')),
      onSSE('progress', (d) => bubble('progress', d.description || '…')),
      onSSE('error', (d) => bubble('error', d.content || 'Error')),
    ];

    const send = async () => {
      const msg = input.value.trim();
      if (!msg || processing) return;
      input.value = '';
      input.style.height = 'auto';
      setBusy(true);
      try {
        await api.post('/api/chat/send', { message: msg });
      } catch (e) { toastErr(e.message); setBusy(false); }
    };
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });

    return () => unsubs.forEach((u) => u());
  },
};
