// Voice Chat — real-time STT (Web Speech API) + ElevenLabs TTS
import { api, chatId } from '../api.js';
import { onSSE } from '../sse.js';
import { el, mount, toastErr } from '../ui.js';

const HTTPS_WARN = window.location.protocol !== 'https:' && !window.location.hostname.includes('localhost');

export default {
  async mount(view) {
    const cid = await chatId();

    // ── Layout ──────────────────────────────────────────────────────────
    const statusDot = el('span.vc-dot.idle');
    const statusText = el('span.vc-status-label', { text: 'Pronto' });
    const transcript = el('div.vc-transcript');
    const micBtn = el('button.btn.vc-mic', { html: '<span class="vc-mic-icon">🎙️</span><span>Tieni premuto per parlare</span>' });
    const abortBtn = el('button.btn.btn-ghost.vc-abort', { text: '✕ Ferma', style: 'display:none' });
    const audioEl = el('audio', { autoplay: true, style: 'display:none' });

    if (HTTPS_WARN) {
      const warn = el('div.banner.banner-warn', {
        html: '⚠️ <strong>HTTPS richiesto</strong> per il microfono su LAN. Imposta <code>DASHBOARD_HTTPS=true</code> e riavvia.',
      });
      mount(view, warn);
    }

    mount(view, el('div.vc-wrap', {}, [
      el('div.vc-header', {}, [
        el('div.vc-status', {}, [statusDot, statusText]),
        abortBtn,
      ]),
      transcript,
      el('div.vc-controls', {}, [micBtn]),
      audioEl,
    ]));

    injectStyles();

    // ── State ────────────────────────────────────────────────────────────
    let recognition = null;
    let isListening = false;
    let isSpeaking = false;
    let currentBotBubble = null;
    let fullBotText = '';
    let sseUnsub = null;

    function setStatus(dot, label) {
      statusDot.className = 'vc-dot ' + dot;
      statusText.textContent = label;
    }

    function addBubble(role, text) {
      const b = el('div.vc-bubble.vc-bubble-' + role, { text });
      transcript.appendChild(b);
      transcript.scrollTop = transcript.scrollHeight;
      return b;
    }

    // ── TTS ──────────────────────────────────────────────────────────────
    async function speak(text) {
      if (!text.trim()) return;
      isSpeaking = true;
      setStatus('speaking', 'Rispondo…');
      try {
        const res = await fetch('/api/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('wc_token') || ''}` },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) { toastErr('TTS non disponibile'); return; }
        const blob = await res.blob();
        audioEl.src = URL.createObjectURL(blob);
        await audioEl.play().catch(() => {});
        await new Promise(r => { audioEl.onended = r; audioEl.onerror = r; setTimeout(r, 30_000); });
      } catch (err) {
        toastErr('TTS: ' + (err?.message || err));
      } finally {
        isSpeaking = false;
        setStatus('idle', 'Pronto');
        micBtn.disabled = false;
      }
    }

    // ── STT setup ────────────────────────────────────────────────────────
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      micBtn.textContent = 'Microfono non supportato (usa Chrome/Edge)';
      micBtn.disabled = true;
      return;
    }

    function initRecognition() {
      recognition = new SR();
      recognition.lang = 'it-IT';
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onresult = (e) => {
        const t = Array.from(e.results).map(r => r[0].transcript).join('');
        statusText.textContent = t || 'Ascolto…';
      };

      recognition.onend = async () => {
        if (!isListening) return;
        isListening = false;
        setMicState(false);

        // Grab final transcript
        const said = statusText.textContent;
        if (!said || said === 'Ascolto…') { setStatus('idle', 'Pronto'); return; }

        addBubble('user', said);
        setStatus('thinking', 'Penso…');
        micBtn.disabled = true;
        abortBtn.style.display = '';
        fullBotText = '';
        currentBotBubble = addBubble('bot', '…');

        // Send to bot via existing chat endpoint
        try {
          await api.post('/api/chat/send', { message: said });
        } catch (err) {
          toastErr('Invio fallito');
          setStatus('idle', 'Pronto');
          micBtn.disabled = false;
          abortBtn.style.display = 'none';
        }
      };

      recognition.onerror = (e) => {
        isListening = false;
        setMicState(false);
        if (e.error !== 'no-speech') toastErr('Mic: ' + e.error);
        setStatus('idle', 'Pronto');
      };
    }
    initRecognition();

    // ── SSE listener ─────────────────────────────────────────────────────
    sseUnsub = onSSE('chunk', (data) => {
      if (!currentBotBubble) return;
      fullBotText += data.text || '';
      currentBotBubble.textContent = fullBotText;
      transcript.scrollTop = transcript.scrollHeight;
    });

    const sseUnsubDone = onSSE('done', async (data) => {
      if (!currentBotBubble) return;
      abortBtn.style.display = 'none';
      currentBotBubble = null;
      if (fullBotText.trim()) await speak(fullBotText);
      fullBotText = '';
    });

    // ── Mic button ───────────────────────────────────────────────────────
    function setMicState(active) {
      micBtn.classList.toggle('active', active);
      micBtn.querySelector('span:last-child').textContent = active ? 'Rilascia per inviare' : 'Tieni premuto per parlare';
    }

    function startListening() {
      if (isListening || isSpeaking || micBtn.disabled) return;
      isListening = true;
      setMicState(true);
      setStatus('listening', 'Ascolto…');
      try { recognition.start(); } catch { initRecognition(); recognition.start(); }
    }

    function stopListening() {
      if (!isListening) return;
      recognition.stop();
    }

    // Touch & mouse
    micBtn.addEventListener('mousedown', e => { e.preventDefault(); startListening(); });
    micBtn.addEventListener('mouseup', stopListening);
    micBtn.addEventListener('mouseleave', stopListening);
    micBtn.addEventListener('touchstart', e => { e.preventDefault(); startListening(); }, { passive: false });
    micBtn.addEventListener('touchend', e => { e.preventDefault(); stopListening(); });

    abortBtn.addEventListener('click', async () => {
      await api.post('/api/chat/abort', {}).catch(() => {});
      if (recognition) try { recognition.stop(); } catch {}
      isListening = false;
      isSpeaking = false;
      currentBotBubble = null;
      fullBotText = '';
      abortBtn.style.display = 'none';
      micBtn.disabled = false;
      setStatus('idle', 'Pronto');
    });

    // Cleanup on unmount
    view._vcCleanup = () => {
      if (sseUnsub) sseUnsub();
      if (sseUnsubDone) sseUnsubDone();
      if (recognition) try { recognition.abort(); } catch {}
    };
    const origUnmount = view.unmount;
    view.unmount = () => { view._vcCleanup?.(); origUnmount?.(); };
  },
};

// ── Inline styles (scoped) ────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('vc-styles')) return;
  const s = document.createElement('style');
  s.id = 'vc-styles';
  s.textContent = `
    .vc-wrap { display:flex; flex-direction:column; gap:1rem; height:calc(100vh - 140px); }
    .vc-header { display:flex; align-items:center; justify-content:space-between; }
    .vc-status { display:flex; align-items:center; gap:.5rem; font-size:.85rem; color:var(--color-muted,#888); }
    .vc-dot { width:10px; height:10px; border-radius:50%; background:#555; transition:background .3s; flex-shrink:0; }
    .vc-dot.idle     { background:#555; }
    .vc-dot.listening{ background:#ef4444; animation:vc-pulse 1s ease-in-out infinite; }
    .vc-dot.thinking { background:#f59e0b; animation:vc-pulse 1.2s ease-in-out infinite; }
    .vc-dot.speaking { background:#10b981; animation:vc-pulse .8s ease-in-out infinite; }
    @keyframes vc-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    .vc-transcript { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:.5rem; padding:.5rem 0; }
    .vc-bubble { max-width:80%; padding:.6rem .9rem; border-radius:1rem; font-size:.9rem; line-height:1.4; }
    .vc-bubble-user { align-self:flex-end; background:var(--color-accent,#7c3aed); color:#fff; border-bottom-right-radius:.2rem; }
    .vc-bubble-bot  { align-self:flex-start; background:var(--color-surface,#1e1e2e); border:1px solid var(--color-border,#333); border-bottom-left-radius:.2rem; }
    .vc-controls { display:flex; justify-content:center; padding:.5rem 0 1rem; }
    .vc-mic { display:flex; align-items:center; gap:.5rem; padding:.9rem 2rem; border-radius:2rem;
              background:var(--color-surface,#1e1e2e); border:2px solid var(--color-border,#333);
              font-size:1rem; cursor:pointer; user-select:none; transition:all .15s; }
    .vc-mic:hover { border-color:var(--color-accent,#7c3aed); }
    .vc-mic.active { background:rgba(239,68,68,.15); border-color:#ef4444; box-shadow:0 0 0 4px rgba(239,68,68,.2); }
    .vc-mic:disabled { opacity:.4; cursor:not-allowed; }
    .vc-mic-icon { font-size:1.4rem; }
    .banner-warn { background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.4);
                   color:#f59e0b; border-radius:.5rem; padding:.75rem 1rem; font-size:.85rem; }
  `;
  document.head.appendChild(s);
}
