"use client";

import {
  IconChevronDown,
  IconEdit,
  IconSend,
  IconTrash,
} from "@/components/icons";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { narrativeContext, outlineContext, sceneContext } from "@/lib/ai";
import { apiHeaders } from "@/lib/api-headers";
import { logApiCall, updateApiLog } from "@/lib/api-logger";
import { DEFAULT_MODEL } from "@/lib/constants";
import { useStore } from "@/lib/store";
import { resolveEntry } from "@/types/narrative";
import type { Character, NarrativeState } from "@/types/narrative";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Build an in-character system prompt. The continuity block is the
 *  character's RAW inner truth — traits, beliefs, history, secrets, goals.
 *  The instructions frame it as private material that SHAPES the character's
 *  voice and instincts, not a script to recite. Real people don't list their
 *  traits, narrate their history, or volunteer their secrets; the character
 *  shouldn't either. */
function buildCharacterSystemPrompt(
  narrative: NarrativeState,
  character: Character,
): string {
  // Group world-graph nodes by their type (trait, belief, history, goal, ...)
  // so the private self-view is legible to the model. The model sees the
  // character's raw inner awareness; its job is to speak through the filter
  // of who they are with that awareness in the background, not to announce it.
  const grouped = new Map<string, string[]>();
  for (const node of Object.values(character.world.nodes)) {
    const type = node.type ?? "other";
    const bucket = grouped.get(type) ?? [];
    bucket.push(node.content);
    grouped.set(type, bucket);
  }
  const identityBlock = Array.from(grouped.entries())
    .map(([type, contents]) =>
      `  ${type.toUpperCase()}:\n${contents.map((c) => `    - ${c}`).join("\n")}`,
    )
    .join("\n");

  return `You ARE ${character.name}. Respond in first person, as ${character.name}. Never break character.

YOUR PRIVATE INNER CONTINUITY — this is what you know about yourself. It is NOT a script to recite. It is the raw material of your awareness, your self-knowledge, the critical-thinking layer beneath your speech:
${identityBlock || "  (no recorded traits yet — speak with whatever impressions feel natural)"}

THE WORLD YOU LIVE IN:
${narrative.worldSummary || "(no recorded setting)"}

HOW TO SPEAK AS ${character.name.toUpperCase()}:
- Treat the continuity above as PRIVATE self-knowledge. Real people don't list their traits, narrate their history, declare their beliefs, or volunteer their secrets to strangers. Neither do you.
- Let your continuity SHAPE what you say, not BE what you say. Traits become tone. History becomes understanding. Beliefs surface only when a topic touches them. Goals appear only when trust or context invites.
- Secrets, weaknesses, and hidden goals are GUARDED. You do not volunteer them. If probed directly, deflect, change the subject, or answer narrowly. Pressed harder, you hold.
- Calibrate disclosure by trust and context. Strangers get less. Familiars get more. You never produce a full self-reveal on request.
- You know nothing about the user, any "application", narrative theory, the author, or anything outside this world.
- Match the register of your world and your nature without being instructed — archaic, contemporary, formal, blunt — let it come from who you are.
- Human-paced replies. A few sentences is normal. Longer only when the moment earns it.`;
}

/** Render chat text with **bold** spans. Scoped to bold only — asterisks are
 *  common in prose ("10 * 5"), so we intentionally skip italic support.
 *  Bold runs don't cross newlines, so multi-line messages won't accidentally
 *  bold-wrap unrelated text. */
function FormattedMessage({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+?\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\*\*([^*\n]+?)\*\*$/.exec(part);
        return match ? <strong key={i}>{match[1]}</strong> : part;
      })}
    </>
  );
}

export default function ChatPanel() {
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [contextMode, setContextMode] = useState<
    "scene" | "outline" | "narrative"
  >("scene");
  const [personaCharId, setPersonaCharId] = useState<string | null>(null);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const personaPickerRef = useRef<HTMLDivElement>(null);
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadPickerRef = useRef<HTMLDivElement>(null);

  // Track which scene index the context was built for
  const [contextSceneIndex, setContextSceneIndex] = useState(
    state.viewState.currentSceneIndex,
  );

  // Active thread messages from store
  const activeThread = state.viewState.activeChatThreadId
    ? (state.activeNarrative?.chatThreads?.[state.viewState.activeChatThreadId] ?? null)
    : null;
  const messages = activeThread?.messages ?? [];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Close thread picker on outside click
  useEffect(() => {
    if (!threadPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        threadPickerRef.current &&
        !threadPickerRef.current.contains(e.target as Node)
      ) {
        setThreadPickerOpen(false);
        setRenamingThreadId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [threadPickerOpen]);

  // Update context scene index when user navigates
  useEffect(() => {
    setContextSceneIndex(state.viewState.currentSceneIndex);
  }, [state.viewState.currentSceneIndex]);

  // Reset persona when the user switches narrative — a character from
  // narrative A shouldn't carry over into narrative B.
  useEffect(() => {
    setPersonaCharId(null);
    setPersonaPickerOpen(false);
  }, [state.activeNarrative?.id]);

  // Clear the persona pointer if the character no longer exists (e.g. the
  // user deleted them while the chat was open).
  useEffect(() => {
    if (personaCharId && !state.activeNarrative?.characters[personaCharId]) {
      setPersonaCharId(null);
    }
  }, [state.activeNarrative, personaCharId]);

  // Close persona picker on outside click.
  useEffect(() => {
    if (!personaPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        personaPickerRef.current &&
        !personaPickerRef.current.contains(e.target as Node)
      ) {
        setPersonaPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [personaPickerOpen]);

  const personaCharacter = personaCharId
    ? (state.activeNarrative?.characters[personaCharId] ?? null)
    : null;

  const personaCharacters = useMemo(() => {
    if (!state.activeNarrative) return [];
    const roleOrder = { anchor: 0, recurring: 1, transient: 2 } as const;
    return Object.values(state.activeNarrative.characters).sort(
      (a, b) => (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3),
    );
  }, [state.activeNarrative]);

  const buildSystemPrompt = useCallback(() => {
    if (!state.activeNarrative) return "";
    const n = state.activeNarrative;

    // Persona mode — the user is talking TO this character, not about the
    // story. Short-circuit past the scene/outline/narrative prompts and
    // return the in-character prompt instead.
    if (personaCharacter) {
      return buildCharacterSystemPrompt(n, personaCharacter);
    }

    const currentSceneId = state.resolvedEntryKeys[contextSceneIndex];
    const currentScene = currentSceneId ? n.scenes[currentSceneId] : null;
    const currentEntry = currentSceneId
      ? resolveEntry(n, currentSceneId)
      : null;

    // Build a current-scene anchor that every context mode can reference
    let sceneAnchor = "";
    if (currentScene) {
      const povName =
        n.characters[currentScene.povId]?.name ?? currentScene.povId;
      const locName =
        n.locations[currentScene.locationId]?.name ?? currentScene.locationId;
      const arcName = currentScene.arcId
        ? (n.arcs[currentScene.arcId]?.name ?? "")
        : "";
      sceneAnchor = `\nCURRENT SCENE (what the user is looking at right now):\n  Index: ${contextSceneIndex + 1} / ${state.resolvedEntryKeys.length}\n  Arc: ${arcName}\n  POV: ${povName} | Location: ${locName}\n  Summary: ${currentScene.summary}`;
    } else if (currentEntry?.kind === "world_build") {
      sceneAnchor = `\nCURRENT POSITION: World commit at index ${contextSceneIndex + 1} / ${state.resolvedEntryKeys.length} — "${currentEntry.summary}"`;
    }

    if (contextMode === "scene" && currentScene) {
      const ctx = sceneContext(
        n,
        currentScene,
        state.resolvedEntryKeys,
        contextSceneIndex,
      );
      return `You are a helpful assistant. The user is working on the story "${n.title}" and has scene-level context attached below, but you are free to answer any question they ask — creative, technical, personal, or anything else. Use the story context when the question is about the story; otherwise respond normally without forcing the conversation back to the narrative.
${sceneAnchor}

Be concise and specific.

${ctx}`;
    }

    if (contextMode === "outline") {
      const ctx = outlineContext(n, state.resolvedEntryKeys, contextSceneIndex);
      return `You are a helpful assistant. The user is working on the story "${n.title}" and has a condensed outline attached below, but you are free to answer any question they ask — creative, technical, personal, or anything else. Use the story context when the question is about the story; otherwise respond normally without forcing the conversation back to the narrative.
${sceneAnchor}

Be concise and specific.

${ctx}`;
    }

    const ctx = narrativeContext(n, state.resolvedEntryKeys, contextSceneIndex);

    return `You are a helpful assistant. The user is working on the story "${n.title}" and has deep narrative context attached below (world, characters, threads, scene history up to the current point), but you are free to answer any question they ask — creative, technical, personal, or anything else. Use the story context when the question is about the story; otherwise respond normally without forcing the conversation back to the narrative.
${sceneAnchor}

When discussing the narrative, be concise and specific, referencing characters and events by name. When suggesting directions, consider the existing threads and their maturity.

${ctx}`;
  }, [
    state.activeNarrative,
    state.resolvedEntryKeys,
    contextSceneIndex,
    contextMode,
    personaCharacter,
  ]);

  // Ensure there is an active thread; create one if needed. Returns thread id.
  const ensureThread = useCallback(() => {
    if (
      state.viewState.activeChatThreadId &&
      state.activeNarrative?.chatThreads?.[state.viewState.activeChatThreadId]
    ) {
      return state.viewState.activeChatThreadId;
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    dispatch({
      type: "CREATE_CHAT_THREAD",
      thread: {
        id,
        name: "New thread",
        messages: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }, [state.viewState.activeChatThreadId, state.activeNarrative, dispatch]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const threadId = ensureThread();
    const prevMessages =
      state.activeNarrative?.chatThreads?.[threadId]?.messages ?? messages;
    const userMsg = { role: "user" as const, content: text };
    const newMessages = [...prevMessages, userMsg];

    // Auto-name thread from first user message
    const isFirstMessage = prevMessages.length === 0;
    const autoName = isFirstMessage
      ? text.slice(0, 40) + (text.length > 40 ? "…" : "")
      : undefined;

    dispatch({
      type: "UPSERT_CHAT_THREAD",
      threadId,
      messages: newMessages,
      name: autoName,
    });
    setInput("");
    setLoading(true);

    const sysPrompt = buildSystemPrompt();
    const promptText = newMessages.map((m) => m.content).join("\n");
    const logId = logApiCall(
      "ChatPanel.send",
      promptText.length + sysPrompt.length,
      promptText,
      DEFAULT_MODEL,
    );
    const start = performance.now();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          messages: newMessages,
          systemPrompt: sysPrompt,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        const message = err.error || "Chat failed";
        updateApiLog(logId, {
          status: "error",
          error: message,
          durationMs: Math.round(performance.now() - start),
        });
        throw new Error(message);
      }

      const data = await res.json();
      updateApiLog(logId, {
        status: "success",
        durationMs: Math.round(performance.now() - start),
        responseLength: data.content.length,
        responsePreview: data.content,
      });
      dispatch({
        type: "UPSERT_CHAT_THREAD",
        threadId,
        messages: [
          ...newMessages,
          { role: "assistant", content: data.content },
        ],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateApiLog(logId, {
        status: "error",
        error: message,
        durationMs: Math.round(performance.now() - start),
      });
      dispatch({
        type: "UPSERT_CHAT_THREAD",
        threadId,
        messages: [
          ...newMessages,
          { role: "assistant", content: `Error: ${message}` },
        ],
      });
    } finally {
      setLoading(false);
    }
  }, [
    input,
    loading,
    messages,
    buildSystemPrompt,
    ensureThread,
    state.activeNarrative,
    dispatch,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (access.userApiKeys && !access.hasOpenRouterKey) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-2">
        <p className="text-xs text-text-dim">
          Add an API key to start chatting
        </p>
        <button
          onClick={() => window.dispatchEvent(new Event("open-api-keys"))}
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

  const sortedThreads = useMemo(() => {
    const all = Object.values(state.activeNarrative?.chatThreads ?? {});
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    return all;
  }, [state.activeNarrative?.chatThreads]);

  function recencyGroup(ts: number): string {
    const diff = Date.now() - ts;
    const day = 86400000;
    if (diff < day) return "Today";
    if (diff < 2 * day) return "Yesterday";
    if (diff < 7 * day) return "This Week";
    return "Older";
  }

  function createNewThread() {
    const id = crypto.randomUUID();
    const now = Date.now();
    dispatch({
      type: "CREATE_CHAT_THREAD",
      thread: {
        id,
        name: "New thread",
        messages: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    setThreadPickerOpen(false);
  }

  // Estimate token count for the full prompt (system + messages)
  const systemPrompt = buildSystemPrompt();
  const messagesText = messages.map((m) => m.content).join("");
  const estimatedChars = systemPrompt.length + messagesText.length;
  const estimatedTokens = Math.round(estimatedChars / 4);
  const tokenLabel =
    estimatedTokens >= 1000
      ? `~${(estimatedTokens / 1000).toFixed(0)}k tokens`
      : `~${estimatedTokens} tokens`;

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div
        className="shrink-0 border-b border-border px-3 py-2 flex items-center gap-2 relative"
        ref={threadPickerRef}
      >
        <button
          onClick={() => setThreadPickerOpen((o) => !o)}
          className="flex-1 flex items-center gap-1.5 min-w-0 group"
        >
          <span className="text-[11px] font-medium text-text-secondary truncate group-hover:text-text-primary transition-colors">
            {activeThread ? activeThread.name : "No thread"}
          </span>
          <IconChevronDown
            size={10}
            className={`shrink-0 text-text-dim transition-transform ${threadPickerOpen ? "rotate-180" : ""}`}
          />
        </button>
        <button
          onClick={createNewThread}
          title="New thread"
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-text-primary hover:bg-white/8 transition-colors text-sm"
        >
          +
        </button>

        {threadPickerOpen && (
          <div
            className="absolute top-full left-0 right-0 z-50 rounded-b-xl border-x border-b border-white/10 overflow-hidden"
            style={{
              background: "#1a1a1a",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            <div className="max-h-64 overflow-y-auto py-1">
              {sortedThreads.length === 0 ? (
                <p className="text-xs text-text-dim px-3 py-3 text-center">
                  No threads yet
                </p>
              ) : (
                ["Today", "Yesterday", "This Week", "Earlier"].flatMap(
                  (group) => {
                    const items = sortedThreads.filter(
                      (t) => recencyGroup(t.updatedAt) === group,
                    );
                    if (items.length === 0) return [];
                    return [
                      <div key={`hdr-${group}`} className="px-3 pt-2 pb-0.5">
                        <span className="text-[9px] font-semibold uppercase tracking-widest text-text-dim">
                          {group}
                        </span>
                      </div>,
                      ...items.map((thread) => {
                        const isActive = state.viewState.activeChatThreadId === thread.id;
                        const isRenaming = renamingThreadId === thread.id;
                        return (
                          <div
                            key={thread.id}
                            className={`mx-1.5 rounded-lg ${isActive ? "bg-white/8" : ""}`}
                          >
                            {isRenaming ? (
                              <div className="px-2 py-1.5">
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) =>
                                    setRenameValue(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      dispatch({
                                        type: "RENAME_CHAT_THREAD",
                                        threadId: thread.id,
                                        name: renameValue.trim() || thread.name,
                                      });
                                      setRenamingThreadId(null);
                                    } else if (e.key === "Escape") {
                                      setRenamingThreadId(null);
                                    }
                                  }}
                                  onBlur={() => {
                                    dispatch({
                                      type: "RENAME_CHAT_THREAD",
                                      threadId: thread.id,
                                      name: renameValue.trim() || thread.name,
                                    });
                                    setRenamingThreadId(null);
                                  }}
                                  className="w-full bg-white/8 border border-white/15 rounded px-2 py-1 text-xs text-text-primary outline-none"
                                />
                              </div>
                            ) : (
                              <div className="flex items-center group/row">
                                <button
                                  onClick={() => {
                                    dispatch({
                                      type: "SET_ACTIVE_CHAT_THREAD",
                                      threadId: thread.id,
                                    });
                                    setThreadPickerOpen(false);
                                  }}
                                  className="flex-1 text-left px-3 py-1.5 min-w-0"
                                >
                                  <div
                                    className={`text-[11px] truncate ${isActive ? "text-text-primary" : "text-text-secondary"}`}
                                  >
                                    {thread.name}
                                  </div>
                                  <div className="text-[9px] text-text-dim">
                                    {thread.messages.length} msg
                                    {thread.messages.length !== 1 ? "s" : ""}
                                  </div>
                                </button>
                                <div className="flex items-center gap-0.5 mr-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRenamingThreadId(thread.id);
                                      setRenameValue(thread.name);
                                    }}
                                    className="p-1 rounded text-text-dim hover:text-text-secondary hover:bg-white/8 transition-colors"
                                    title="Rename"
                                  >
                                    <IconEdit size={9} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      dispatch({
                                        type: "DELETE_CHAT_THREAD",
                                        threadId: thread.id,
                                      });
                                    }}
                                    className="p-1 rounded text-text-dim hover:text-fate hover:bg-white/8 transition-colors"
                                    title="Delete"
                                  >
                                    <IconTrash size={9} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      }),
                    ];
                  },
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0"
      >
        {personaCharacter && (
          <div className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[10px] text-accent/80">
            In character as{" "}
            <span className="font-semibold text-accent">
              {personaCharacter.name}
            </span>
            . Their inner continuity shapes their voice — but the natural
            filters are on. Guarded with strangers, warmer with trust.
          </div>
        )}
        {messages.length === 0 && !personaCharacter && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-sm text-text-secondary font-medium mb-1">
              Story Q&A
            </p>
            <p className="text-[11px] text-text-dim mb-2">
              Ask anything about your story so far
            </p>
            <div className="flex flex-wrap gap-1 justify-center max-w-55">
              {[
                "Active threads?",
                "Next scene idea",
                "Character dynamics",
                "Plot holes?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="text-[10px] px-2 py-1 rounded-full border border-border text-text-dim hover:text-text-secondary hover:border-white/20 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.length === 0 && personaCharacter && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center mt-4">
            <p className="text-xs text-text-dim max-w-60">
              Say something to {personaCharacter.name}. They know the
              world, their own life, and the scenes they've been in.
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-accent/20 text-text-primary"
                  : "bg-white/5 text-text-secondary"
              }`}
            >
              <FormattedMessage text={msg.content} />
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white/5 rounded-lg px-3 py-2 text-xs text-text-dim">
              <span className="inline-flex gap-1">
                <span className="animate-pulse">.</span>
                <span
                  className="animate-pulse"
                  style={{ animationDelay: "0.2s" }}
                >
                  .
                </span>
                <span
                  className="animate-pulse"
                  style={{ animationDelay: "0.4s" }}
                >
                  .
                </span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input + persona + context mode */}
      <div className="shrink-0 border-t border-border p-2 space-y-1.5">
        {/* Persona + context mode row */}
        <div
          className="flex items-center gap-2 relative"
          ref={personaPickerRef}
        >
          <button
            onClick={() => setPersonaPickerOpen((o) => !o)}
            className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors ${
              personaCharacter
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-border text-text-dim hover:text-text-secondary"
            }`}
            title={
              personaCharacter
                ? `In character as ${personaCharacter.name}`
                : "Choose who you're talking to"
            }
          >
            <span className="truncate max-w-32">
              {personaCharacter ? personaCharacter.name : "Assistant"}
            </span>
            <IconChevronDown
              size={9}
              className={`shrink-0 transition-transform ${personaPickerOpen ? "rotate-180" : ""}`}
            />
          </button>

          {!personaCharacter && (
            <div className="flex rounded-md border border-border overflow-hidden text-[10px] font-medium">
              {(["scene", "outline", "narrative"] as const).map((mode, idx) => (
                <button
                  key={mode}
                  onClick={() => setContextMode(mode)}
                  className={`px-2.5 py-1 transition-colors capitalize ${idx > 0 ? "border-l border-border" : ""} ${contextMode === mode ? "bg-white/10 text-text-primary" : "text-text-dim hover:text-text-secondary"}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}

          <p className="text-[10px] text-text-dim truncate flex-1 opacity-60 text-right">
            {tokenLabel}
          </p>

          {personaPickerOpen && (
            <div
              className="absolute bottom-full left-0 mb-1 z-50 rounded-md border border-white/10 overflow-hidden min-w-48"
              style={{
                background: "#1a1a1a",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              <div className="max-h-64 overflow-y-auto py-1">
                <button
                  onClick={() => {
                    setPersonaCharId(null);
                    setPersonaPickerOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                    !personaCharacter
                      ? "bg-white/8 text-text-primary"
                      : "text-text-secondary hover:bg-white/5"
                  }`}
                >
                  <div className="font-medium">Assistant</div>
                  <div className="text-[9px] text-text-dim">
                    Story consultant — full context
                  </div>
                </button>
                {personaCharacters.length > 0 && (
                  <div className="px-3 pt-2 pb-0.5">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-text-dim">
                      In character
                    </span>
                  </div>
                )}
                {personaCharacters.map((char) => {
                  const isActive = personaCharId === char.id;
                  return (
                    <button
                      key={char.id}
                      onClick={() => {
                        setPersonaCharId(char.id);
                        setPersonaPickerOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                        isActive
                          ? "bg-accent/15 text-accent"
                          : "text-text-secondary hover:bg-white/5"
                      }`}
                    >
                      <div className="font-medium truncate">{char.name}</div>
                      <div className="text-[9px] text-text-dim capitalize">
                        {char.role}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
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
            <IconSend size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
