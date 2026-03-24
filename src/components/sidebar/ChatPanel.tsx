'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { branchContext } from '@/lib/ai';
import { apiHeaders } from '@/lib/api-headers';
import { logApiCall, updateApiLog } from '@/lib/api-logger';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export default function ChatPanel() {
  const { state } = useStore();
  const access = useFeatureAccess();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Track which scene index the context was built for
  const [contextSceneIndex, setContextSceneIndex] = useState(state.currentSceneIndex);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Clear chat when narrative changes
  const narrativeId = state.activeNarrative?.id;
  const prevNarrativeId = useRef(narrativeId);
  useEffect(() => {
    if (narrativeId !== prevNarrativeId.current) {
      setMessages([]);
      prevNarrativeId.current = narrativeId;
    }
  }, [narrativeId]);

  // Update context scene index when user navigates
  useEffect(() => {
    setContextSceneIndex(state.currentSceneIndex);
  }, [state.currentSceneIndex]);

  const buildSystemPrompt = useCallback(() => {
    if (!state.activeNarrative) return '';
    const ctx = branchContext(
      state.activeNarrative,
      state.resolvedSceneKeys,
      contextSceneIndex,
    );

    const currentSceneId = state.resolvedSceneKeys[contextSceneIndex];
    const currentScene = currentSceneId ? state.activeNarrative.scenes[currentSceneId] : null;
    const sceneLabel = currentScene
      ? `\nCURRENT SCENE: ${currentScene.id} — "${currentScene.summary}"`
      : '';

    return `You are a narrative consultant for the story "${state.activeNarrative.title}". You have deep knowledge of the story's world, characters, threads, and scene history up to the current point in the timeline.

Answer questions about the narrative, suggest story directions, analyze character dynamics, identify plot holes, or discuss themes. Be concise and specific, referencing characters and events by name. When suggesting directions, consider the existing threads and their maturity.

You are viewing the story at scene ${contextSceneIndex + 1} of ${state.resolvedSceneKeys.length}.${sceneLabel}

${ctx}`;
  }, [state.activeNarrative, state.resolvedSceneKeys, contextSceneIndex]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    const sysPrompt = buildSystemPrompt();
    const promptText = newMessages.map((m) => m.content).join('\n');
    const logId = logApiCall('ChatPanel.send', promptText.length + sysPrompt.length, promptText);
    const start = performance.now();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          messages: newMessages,
          systemPrompt: sysPrompt,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        const message = err.error || 'Chat failed';
        updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
        throw new Error(message);
      }

      const data = await res.json();
      updateApiLog(logId, { status: 'success', durationMs: Math.round(performance.now() - start), responseLength: data.content.length, responsePreview: data.content });
      setMessages([...newMessages, { role: 'assistant', content: data.content }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
      setMessages([
        ...newMessages,
        { role: 'assistant', content: `Error: ${message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, buildSystemPrompt]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (access.userApiKeys && !access.hasOpenRouterKey) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-2">
        <p className="text-xs text-text-dim">Add an API key to start chatting</p>
        <button
          onClick={() => window.dispatchEvent(new Event('open-api-keys'))}
          className="text-[11px] px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
        >
          Add API Key
        </button>
      </div>
    );
  }

  if (!state.activeNarrative) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-dim">Open a story to start</p>
      </div>
    );
  }

  const currentSceneId = state.resolvedSceneKeys[contextSceneIndex];
  const currentScene = currentSceneId ? state.activeNarrative.scenes[currentSceneId] : null;

  // Estimate token count for the full prompt (system + messages)
  const systemPrompt = buildSystemPrompt();
  const messagesText = messages.map((m) => m.content).join('');
  const estimatedChars = systemPrompt.length + messagesText.length;
  const estimatedTokens = Math.round(estimatedChars / 4);
  const tokenLabel = estimatedTokens >= 1000
    ? `~${(estimatedTokens / 1000).toFixed(0)}k tokens`
    : `~${estimatedTokens} tokens`;

  return (
    <div className="flex flex-col h-full">
      {/* Context indicator */}
      <div className="shrink-0 px-3 py-2 border-b border-border">
        <p className="text-[10px] text-text-dim leading-tight">
          Context: scene {contextSceneIndex + 1}/{state.resolvedSceneKeys.length}
          {currentScene && (
            <span className="text-text-secondary"> — {currentScene.summary.slice(0, 60)}{currentScene.summary.length > 60 ? '...' : ''}</span>
          )}
          <span className="text-text-dim ml-1">({tokenLabel})</span>
        </p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-sm text-text-secondary font-medium mb-1">Story Q&A</p>
            <p className="text-[11px] text-text-dim mb-2">Ask anything about your story so far</p>
            <div className="flex flex-wrap gap-1 justify-center max-w-55">
              {['Active threads?', 'Next scene idea', 'Character dynamics', 'Plot holes?'].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  className="text-[10px] px-2 py-1 rounded-full border border-border text-text-dim hover:text-text-secondary hover:border-white/20 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-accent/20 text-text-primary'
                  : 'bg-white/5 text-text-secondary'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white/5 rounded-lg px-3 py-2 text-xs text-text-dim">
              <span className="inline-flex gap-1">
                <span className="animate-pulse">.</span>
                <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
                <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border p-2">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            className="flex-1 bg-white/5 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-dim resize-none focus:outline-none focus:border-white/20 transition-colors"
            style={{ maxHeight: 80 }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 11L11 6L1 1V5L8 6L1 7V11Z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
