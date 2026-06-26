// Voice Chat — real-time STT (Web Speech API) + ElevenLabs TTS
import { api, chatId, getToken } from '../api.js';
import { onSSE } from '../sse.js';
import { el, mount, toastErr } from '../ui.js';

const HTTPS_WARN = window.location.protocol !== 'https:' && !window.location.hostname.includes('localhost');
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export default {
  async mount(view) {
    const cid = await chatId();

    // ── Persisted playback speed ─────────────────────────────────────────
    let speed = parseFloat(localStorage.getItem('vc_speed') || '1.25') || 1.25;
    if (!SPEEDS.includes(speed)) speed = 1.25;

    // ── Layout ──────────────────────────────────────────────────────────
    const statusDot = el('span.vc-dot.idle');
    const statusText = el('span.vc-status-label', { text: 'Pronto' });
    const transcript = el('div.vc-transcript');
    const micBtn = el('button.btn.vc-mic', { html: '<span class="vc-mic-icon">🎙️</span><span>Tieni premuto per parlare</span>' });
    const stopBtn = el('button.btn.btn-ghost.vc-abort', { text: '✕ Ferma', style: 'display:none' });
    const audioEl = el('audio', { autoplay: true, style: 'display:none' });

    // Speed selector
    const speedBtn = el('button.btn.btn-ghost.vc-speed', { text: `⏩ ${speed}×`, title: 'Velocità voce' });
    speedBtn.addEventListener('click', () => {
      const i = SPEEDS.indexOf(speed);
      speed = SPEEDS[(i + 1) % SPEEDS.length];
      localStorage.setItem('vc_speed', String(speed));
      speedBtn.textContent = `⏩ ${speed}×`;
      audioEl.playbackRate = speed; // applies live if currently playing
    });

    const children = [];
    if (HTTPS_WARN) {
      children.push(el('div.banner.banner-warn', {
        html: '⚠️ <strong>HTTPS richiesto</strong> per il microfono. Apri la dashboard via <code>https://</code> (accetta il certificato self-signed una volta).',
      }));
    }
    children.push(
      el('div.vc-header', {}, [
        el('div.vc-status', {}, [statusDot, statusText]),
        el('div.vc-header-actions', {}, [speedBtn, stopBtn]),
      ]),
      transcript,
      el('div.vc-controls', {}, [micBtn]),
      audioEl,
    );

    mount(view, el('div.vc-wrap', {}, children));

    injectStyles();

    // ── State ────────────────────────────────────────────────────────────
    let recognition = null;
    let isListening = false;
    let isSpeaking = false;
    let isThinking = false;
    let currentBotBubble = null;
    let resolveCurrent = null; // resolves the in-flight playback promise
    let playToken = 0;         // bumped on each new/stopped playback to supersede older ones
    let ackTimer = null;       // fires a short spoken ack if a task runs long
    let sseUnsub = null;

    const ACK_DELAY_MS = 2500;
    const ACK_PHRASES = ['Okay, ci sto lavorando.', 'Dammi un secondo.', 'Ci penso un attimo.'];

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
    // Token-based so a newer playback (e.g. the real answer) cleanly supersedes
    // an older one (e.g. the "ci sto lavorando" ack) without audio overlap.
    async function speak(text, opts = {}) {
      const { ack = false, label = 'Rispondo… (premi il mic per interrompere)' } = opts;
      if (!text.trim()) return;
      const token = ++playToken;
      stopCurrentAudio(); // halt whatever is playing, resolve its promise
      isSpeaking = true;
      setStatus('speaking', label);
      stopBtn.textContent = '⏹ Stop voce';
      stopBtn.style.display = '';
      micBtn.disabled = false; // allow barge-in while speaking
      let safety;
      try {
        const tok = getToken();
        const res = await fetch('/api/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
          body: JSON.stringify({ text }),
        });
        if (token !== playToken) return; // superseded while fetching
        if (!res.ok) {
          if (!ack) {
            const msg = await res.json().then(j => j.error).catch(() => `HTTP ${res.status}`);
            toastErr('TTS: ' + msg);
          }
          return;
        }
        const blob = await res.blob();
        if (token !== playToken) return;
        audioEl.src = URL.createObjectURL(blob);
        audioEl.playbackRate = speed;
        await audioEl.play().catch(() => {});
        audioEl.playbackRate = speed; // some browsers reset on play()
        await new Promise(r => {
          resolveCurrent = r;
          audioEl.onended = r;
          audioEl.onerror = r;
          safety = setTimeout(r, 120_000);
        });
      } catch (err) {
        if (!ack) toastErr('TTS: ' + (err?.message || err));
      } finally {
        clearTimeout(safety);
        if (token === playToken) {
          resolveCurrent = null;
          isSpeaking = false;
          stopBtn.style.display = 'none';
          if (!isListening && !isThinking) setStatus('idle', 'Pronto');
          micBtn.disabled = false;
        }
      }
    }

    function stopCurrentAudio() {
      try { audioEl.pause(); audioEl.currentTime = 0; } catch {}
      if (resolveCurrent) { const r = resolveCurrent; resolveCurrent = null; r(); }
    }

    function stopSpeaking() {
      playToken++; // supersede any in-flight speak() so its finally is a no-op
      stopCurrentAudio();
      isSpeaking = false;
      stopBtn.style.display = 'none';
    }

    // ── STT setup ────────────────────────────────────────────────────────
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      micBtn.querySelector('span:last-child').textContent = 'Microfono non supportato (usa Chrome/Edge)';
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

        const said = statusText.textContent;
        if (!said || said === 'Ascolto…') { if (!isSpeaking) setStatus('idle', 'Pronto'); return; }

        addBubble('user', said);
        setStatus('thinking', 'Penso…');
        isThinking = true;
        micBtn.disabled = true;
        stopBtn.textContent = '✕ Ferma';
        stopBtn.style.display = '';
        currentBotBubble = addBubble('bot', '…');

        try {
          await api.post('/api/chat/send', { message: said });
          // Long-task ack: if still thinking after a beat, say something short
          // so the conversation feels responsive instead of going silent.
          clearTimeout(ackTimer);
          ackTimer = setTimeout(() => {
            if (isThinking && !isSpeaking) {
              const phrase = ACK_PHRASES[Math.floor((Date.now() / 1000) % ACK_PHRASES.length)];
              speak(phrase, { ack: true, label: 'Un momento…' });
            }
          }, ACK_DELAY_MS);
        } catch (err) {
          toastErr('Invio fallito');
          isThinking = false;
          setStatus('idle', 'Pronto');
          micBtn.disabled = false;
          stopBtn.style.display = 'none';
        }
      };

      recognition.onerror = (e) => {
        isListening = false;
        setMicState(false);
        if (e.error !== 'no-speech') toastErr('Mic: ' + e.error);
        if (!isSpeaking && !isThinking) setStatus('idle', 'Pronto');
      };
    }
    initRecognition();

    // ── SSE listeners ────────────────────────────────────────────────────
    // The bot emits ONE assistant_message with the full content (no token
    // streaming). progress events update the status line while it thinks.
    const unsubProgress = onSSE('progress', (data) => {
      if (isThinking) setStatus('thinking', data.description || 'Penso…');
    });

    const unsubAssistant = onSSE('assistant_message', async (data) => {
      if (!currentBotBubble) return;
      clearTimeout(ackTimer);
      const text = data.content || '';
      currentBotBubble.textContent = text || '(vuoto)';
      transcript.scrollTop = transcript.scrollHeight;
      currentBotBubble = null;
      isThinking = false;
      // The real answer supersedes any ack still playing (token bump in speak()).
      if (text.trim()) await speak(stripMarkdown(text));
      else { stopSpeaking(); setStatus('idle', 'Pronto'); micBtn.disabled = false; }
    });

    const unsubError = onSSE('error', (data) => {
      clearTimeout(ackTimer);
      if (currentBotBubble) currentBotBubble.textContent = '⚠️ ' + (data.content || 'Errore');
      currentBotBubble = null;
      isThinking = false;
      stopSpeaking();
      micBtn.disabled = false;
      setStatus('idle', 'Pronto');
    });

    sseUnsub = () => { unsubProgress(); unsubAssistant(); unsubError(); };

    // ── Mic button ───────────────────────────────────────────────────────
    function setMicState(active) {
      micBtn.classList.toggle('active', active);
      micBtn.querySelector('span:last-child').textContent = active ? 'Rilascia per inviare' : 'Tieni premuto per parlare';
    }

    function startListening() {
      if (isListening || micBtn.disabled) return;
      clearTimeout(ackTimer);
      if (isSpeaking) stopSpeaking(); // barge-in: interrupt the reply and listen
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

    // Stop button: stop voice if speaking, else abort the in-flight reply
    stopBtn.addEventListener('click', async () => {
      if (isSpeaking) { stopSpeaking(); setStatus('idle', 'Pronto'); return; }
      clearTimeout(ackTimer);
      await api.post('/api/chat/abort', {}).catch(() => {});
      if (recognition) try { recognition.stop(); } catch {}
      isListening = false;
      isThinking = false;
      currentBotBubble = null;
      stopBtn.style.display = 'none';
      micBtn.disabled = false;
      setStatus('idle', 'Pronto');
    });

    // Cleanup on unmount
    view._vcCleanup = () => {
      clearTimeout(ackTimer);
      if (sseUnsub) sseUnsub();
      if (recognition) try { recognition.abort(); } catch {}
      try { audioEl.pause(); } catch {}
    };
    const origUnmount = view.unmount;
    view.unmount = () => { view._vcCleanup?.(); origUnmount?.(); };
  },
};

// Strip markdown so the TTS reads clean prose, not asterisks and backticks.
function stripMarkdown(t) {
  return t
    .replace(/```[\s\S]*?```/g, ' blocco di codice ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .trim();
}

// ── Inline styles (scoped) ────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('vc-styles')) return;
  const s = document.createElement('style');
  s.id = 'vc-styles';
  s.textContent = `
    .vc-wrap { display:flex; flex-direction:column; gap:1rem; height:calc(100vh - 140px); }
    .vc-header { display:flex; align-items:center; justify-content:space-between; gap:.5rem; }
    .vc-header-actions { display:flex; align-items:center; gap:.5rem; }
    .vc-speed { font-variant-numeric:tabular-nums; }
    .vc-status { display:flex; align-items:center; gap:.5rem; font-size:.85rem; color:var(--color-muted,#888); min-width:0; }
    .vc-status-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
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
