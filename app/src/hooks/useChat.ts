import { useState, useCallback, useRef, useEffect } from 'react';
import { streamChat, cancelTurn, type ChatUsage } from '@/api/stream';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Assistant messages stream token-by-token while streaming=true */
  streaming?: boolean;
  usage?: ChatUsage | null;
  error?: string;
}

export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'error';

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  /** Latest tool/sub-agent progress line for the in-flight turn (UI hint). */
  const [progress, setProgress] = useState<string | null>(null);

  const activeTurnId = useRef<string | null>(null);
  const activeAssistantId = useRef<string | null>(null);
  /** Guards against state updates after the component unmounts. */
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const appendToken = useCallback((msgId: string, delta: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, text: m.text + delta, streaming: true } : m,
      ),
    );
  }, []);

  const finalizeMessage = useCallback(
    (msgId: string, text: string, usage: ChatMessage['usage']) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, text, streaming: false, usage } : m,
        ),
      );
      setStatus('idle');
      setProgress(null);
      activeTurnId.current = null;
      activeAssistantId.current = null;
    },
    [],
  );

  const failMessage = useCallback((msgId: string, message: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        // Keep whatever text streamed in; surface the error alongside it.
        m.id === msgId ? { ...m, streaming: false, error: message } : m,
      ),
    );
    setStatus('error');
    setProgress(null);
    activeTurnId.current = null;
    activeAssistantId.current = null;
  }, []);

  const send = useCallback(
    async (text: string, model?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Single in-flight turn at a time.
      if (activeTurnId.current || status === 'sending' || status === 'streaming') return;

      const now = Date.now();
      const userMsg: ChatMessage = { id: `u-${now}`, role: 'user', text: trimmed };
      const assistantId = `a-${now}`;
      const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', text: '', streaming: true };
      activeAssistantId.current = assistantId;

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStatus('sending');
      setProgress(null);

      try {
        const turnId = await streamChat(
          trimmed,
          {
            onToken: (delta) => {
              if (!mounted.current) return;
              setStatus('streaming');
              appendToken(assistantId, delta);
            },
            onProgress: (_kind, description) => {
              if (!mounted.current) return;
              setProgress(description);
            },
            onDone: (finalText, usage) => {
              if (!mounted.current) return;
              finalizeMessage(assistantId, finalText, usage);
            },
            onError: (message) => {
              if (!mounted.current) return;
              failMessage(assistantId, message);
            },
          },
          model,
        );
        activeTurnId.current = turnId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Connection error';
        if (mounted.current) failMessage(assistantId, message);
      }
    },
    [status, appendToken, finalizeMessage, failMessage],
  );

  const cancel = useCallback(() => {
    if (activeTurnId.current) {
      cancelTurn(activeTurnId.current);
      activeTurnId.current = null;
    }
    // Close out the streaming assistant message, keeping any partial text.
    const assistantId = activeAssistantId.current;
    if (assistantId) {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
      );
      activeAssistantId.current = null;
    }
    setStatus('idle');
    setProgress(null);
  }, []);

  const clear = useCallback(() => {
    cancel();
    setMessages([]);
  }, [cancel]);

  return { messages, status, progress, send, cancel, clear };
}
