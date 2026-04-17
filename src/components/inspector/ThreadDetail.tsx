"use client";

import {
  classifyThreadKind,
  computeActiveArcs,
  computeThreadStatuses,
} from "@/lib/narrative-utils";
import { getThreadLogAtScene } from "@/lib/scene-filter";
import { useStore } from "@/lib/store";
import { useMemo, useState } from "react";
import { CollapsibleSection, Paginator, paginateRecent } from "./CollapsibleSection";

type Props = {
  threadId: string;
};

const statusClasses: Record<string, string> = {
  latent: "text-text-dim",
  seeded: "text-amber-400",
  active: "text-blue-400",
  escalating: "text-orange-400",
  critical: "text-fate",
  resolved: "text-world",
  subverted: "text-violet-400",
  abandoned: "text-text-dim",
};

const stanceClasses: Record<string, string> = {
  cooperative: "text-emerald-400",
  competitive: "text-red-400",
  neutral: "text-text-dim",
};

const threadLogDotColors: Record<string, string> = {
  pulse: "bg-white/40",
  transition: "bg-fate",
  setup: "bg-amber-400",
  escalation: "bg-orange-400",
  payoff: "bg-emerald-400",
  twist: "bg-violet-400",
  callback: "bg-sky-400",
  resistance: "bg-red-500",
  stall: "bg-red-400/50",
};

export default function ThreadDetail({ threadId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [logPage, setLogPage] = useState(0);
  const [scenesPage, setScenesPage] = useState(0);

  const thread = narrative?.threads[threadId];

  const currentStatuses = useMemo(
    () =>
      narrative
        ? computeThreadStatuses(narrative, state.viewState.currentSceneIndex)
        : {},
    [narrative, state.viewState.currentSceneIndex],
  );

  // Progressive reveal: thread log nodes visible at current scene index
  const visibleLog = useMemo(() => {
    if (!narrative || !thread) return { nodes: [], edges: [] };
    return getThreadLogAtScene(
      thread.threadLog ?? { nodes: {}, edges: [] },
      threadId,
      narrative.scenes,
      state.resolvedEntryKeys,
      state.viewState.currentSceneIndex,
    );
  }, [
    narrative,
    thread,
    threadId,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  ]);

  if (!narrative || !thread) return null;

  const currentStatus = currentStatuses[threadId] ?? thread.status;

  // Resolve anchor names
  const anchors = (thread.participants ?? []).map((a) => ({
    ...a,
    name:
      a.type === "character"
        ? (narrative.characters[a.id]?.name ?? a.id)
        : (narrative.locations[a.id]?.name ?? a.id),
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Thread ID badge + description */}
      <div className="flex flex-col gap-1">
        <span className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-dim self-start">
          {thread.id}
        </span>
        <p className="text-sm text-text-primary">{thread.description}</p>
      </div>

      {/* Status + kind + bandwidth */}
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] uppercase tracking-widest ${statusClasses[currentStatus] ?? "text-text-secondary"}`}
        >
          {currentStatus}
        </span>
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded-full ${
            classifyThreadKind(thread, narrative.scenes) === "storyline"
              ? "bg-blue-500/15 text-blue-400"
              : "bg-amber-500/15 text-amber-400"
          }`}
        >
          {classifyThreadKind(thread, narrative.scenes)}
        </span>
        <span className="text-[9px] text-text-dim font-mono ml-auto">
          {computeActiveArcs(threadId, narrative.scenes)}/
          {Object.keys(narrative.arcs).length || 1} arcs
        </span>
      </div>

      {/* Thread Log — progressive-reveal paginated list */}
      {visibleLog.nodes.length > 0 &&
        (() => {
          const { pageItems, totalPages, safePage } = paginateRecent(
            visibleLog.nodes,
            logPage,
          );
          return (
            <CollapsibleSection
              title="Thread Log"
              count={visibleLog.nodes.length}
              defaultOpen
            >
              <ul className="flex flex-col gap-1">
                {pageItems.map((node, i) => (
                  <li
                    key={`${node.id}-${i}`}
                    className="flex items-start gap-2"
                  >
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${threadLogDotColors[node.type] ?? "bg-white/40"}`}
                    />
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: {
                              type: "threadLog",
                              threadId,
                              nodeId: node.id,
                            },
                          })
                        }
                        className="text-xs text-text-primary hover:text-white transition-colors text-left"
                      >
                        {node.content}
                      </button>
                      {(node.actorId || node.stance) && (
                        <span className="text-[9px] text-text-dim/70 ml-0">
                          {node.actorId && (
                            <span>
                              {narrative.characters[node.actorId]?.name ??
                                narrative.locations[node.actorId]?.name ??
                                narrative.artifacts[node.actorId]?.name ??
                                node.actorId}
                            </span>
                          )}
                          {node.actorId && node.targetId && <span> → </span>}
                          {node.targetId && (
                            <span>
                              {narrative.characters[node.targetId]?.name ??
                                narrative.locations[node.targetId]?.name ??
                                narrative.artifacts[node.targetId]?.name ??
                                node.targetId}
                            </span>
                          )}
                          {node.stance && (
                            <span className={`ml-1.5 ${stanceClasses[node.stance] ?? "text-text-dim"}`}>
                              {node.stance}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <Paginator
                page={safePage}
                totalPages={totalPages}
                onPage={setLogPage}
              />
            </CollapsibleSection>
          );
        })()}

      {/* Scenes — derived from scene.threadDeltas, up to current index */}
      {(() => {
        const sceneKeysUpToCurrent = state.resolvedEntryKeys.slice(
          0,
          state.viewState.currentSceneIndex + 1,
        );
        const sceneTouches = sceneKeysUpToCurrent
          .map((k) => narrative.scenes[k])
          .filter(
            (s) =>
              s && s.threadDeltas.some((tm) => tm.threadId === threadId),
          )
          .map((s) => ({
            sceneId: s.id,
            deltas: s.threadDeltas.filter(
              (tm) => tm.threadId === threadId,
            ),
          }));
        if (sceneTouches.length === 0) return null;
        const { pageItems, totalPages, safePage } = paginateRecent(
          sceneTouches,
          scenesPage,
        );
        return (
          <CollapsibleSection title="Scenes" count={sceneTouches.length}>
            <ul className="flex flex-col gap-1.5">
              {pageItems.map(({ sceneId, deltas }) => (
                <li key={sceneId} className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "scene", sceneId },
                      })
                    }
                    className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary"
                  >
                    {sceneId}
                  </button>
                  {deltas.map((tm, tmIdx) => (
                    <span
                      key={`${tm.from}-${tm.to}-${tmIdx}`}
                      className={`text-xs ${tm.from === tm.to ? "text-text-dim" : "text-fate"}`}
                    >
                      {tm.from} &rarr; {tm.to}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <Paginator
              page={safePage}
              totalPages={totalPages}
              onPage={setScenesPage}
            />
          </CollapsibleSection>
        );
      })()}

      {/* Participants & Stakes */}
      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
          {anchors.length === 0 ? "General Thread" : "Participants"}
        </h3>
        {anchors.map((a, i) => {
          const participant = thread.participants[i];
          return (
            <button
              key={`${a.id}-${i}`}
              type="button"
              onClick={() =>
                dispatch({
                  type: "SET_INSPECTOR",
                  context:
                    a.type === "character"
                      ? { type: "character", characterId: a.id }
                      : a.type === "location"
                        ? { type: "location", locationId: a.id }
                        : { type: "artifact", artifactId: a.id },
                })
              }
              className="text-left text-xs text-text-secondary transition-colors hover:text-text-primary flex flex-col"
            >
              <span>
                <span className="text-[10px] text-text-dim mr-1">{a.type}</span>
                {a.name}
              </span>
              {participant?.stake && (
                <span className="text-[9px] text-text-dim/80 italic ml-4">
                  stake: {participant.stake}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Connected Threads — bidirectional: what this thread converges with + what depends on it */}
      {(() => {
        const convergesWith = thread.dependents.filter(
          (id) => narrative.threads[id],
        );
        const dependedOnBy = Object.values(narrative.threads).filter(
          (t) => t.id !== threadId && t.dependents.includes(threadId),
        );
        if (convergesWith.length === 0 && dependedOnBy.length === 0)
          return null;
        return (
          <div className="flex flex-col gap-2">
            {convergesWith.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                  Converges With
                </h3>
                <ul className="flex flex-col gap-1">
                  {convergesWith.map((depId) => (
                    <li key={depId}>
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: { type: "thread", threadId: depId },
                          })
                        }
                        className="text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
                      >
                        <span className="font-mono text-[10px] text-text-dim mr-1">
                          {depId}
                        </span>
                        {narrative.threads[depId]?.description}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {dependedOnBy.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                  Connected From
                </h3>
                <ul className="flex flex-col gap-1">
                  {dependedOnBy.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: { type: "thread", threadId: t.id },
                          })
                        }
                        className="text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
                      >
                        <span className="font-mono text-[10px] text-text-dim mr-1">
                          {t.id}
                        </span>
                        {t.description}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
