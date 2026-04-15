"use client";

import { useImageUrl } from "@/hooks/useAssetUrl";
import {
  getWorldNodesAtScene,
  getRelationshipsAtScene,
  getThreadIdsAtScene,
  getOwnershipAtScene,
  getTiesAtScene,
} from "@/lib/scene-filter";
import { useStore } from "@/lib/store";
import type { CharacterRole } from "@/types/narrative";
import React, { useState } from "react";
import { CollapsibleSection, Paginator, paginateRecent } from "./CollapsibleSection";
import ImagePromptEditor from "./ImagePromptEditor";

type Props = {
  characterId: string;
};

const roleClasses: Record<CharacterRole, string> = {
  anchor: "text-text-primary",
  recurring: "text-text-secondary",
  transient: "text-text-dim",
};

const continuityDotColors: Record<string, string> = {
  trait: "bg-violet-400",
  state: "bg-emerald-400",
  history: "bg-amber-400",
  capability: "bg-blue-400",
  belief: "bg-pink-300",
  relation: "bg-purple-400",
  secret: "bg-amber-500",
  goal: "bg-sky-400",
  weakness: "bg-red-400",
};


export default function CharacterDetail({ characterId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [continuityPage, setContinuityPage] = useState(0);
  const [threadPage, setThreadPage] = useState(0);
  const [relPage, setRelPage] = useState(0);
  const [lifecyclePage, setLifecyclePage] = useState(0);
  if (!narrative) return null;

  const character = narrative.characters[characterId];
  if (!character) return null;

  const imageUrl = useImageUrl(character.imageUrl);

  const sceneKeysUpToCurrent = state.resolvedEntryKeys.slice(
    0,
    state.viewState.currentSceneIndex + 1,
  );

  // Knowledge filtered to current scene
  const worldNodes = getWorldNodesAtScene(
    character.world.nodes,
    characterId,
    narrative.scenes,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  );

  // Threads filtered to current scene
  const threadIds = getThreadIdsAtScene(
    character.threadIds ?? [],
    narrative.threads,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  );

  // Relationships filtered + valence adjusted to current scene
  const relationships = getRelationshipsAtScene(
    narrative,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  ).filter((r) => r.from === characterId || r.to === characterId);

  // Current scene deltas for this character
  const currentSceneKey = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
  const currentScene = currentSceneKey
    ? narrative.scenes[currentSceneKey]
    : null;
  const recentWorldDeltas = currentScene
    ? currentScene.worldDeltas.filter((m) => m.entityId === characterId)
    : [];
  const recentRelationshipDeltas = currentScene
    ? currentScene.relationshipDeltas.filter(
        (rm) => rm.from === characterId || rm.to === characterId,
      )
    : [];
  const recentThreadDeltas = currentScene
    ? currentScene.threadDeltas.filter((tm) =>
        narrative.threads[tm.threadId]?.participants?.some(
          (a) => a.id === characterId,
        ),
      )
    : [];
  const recentMovement =
    currentScene?.characterMovements?.[characterId] ?? null;
  const recentEvents =
    currentScene && currentScene.participantIds.includes(characterId)
      ? currentScene.events
      : [];
  const hasRecentActivity =
    recentWorldDeltas.length > 0 ||
    recentRelationshipDeltas.length > 0 ||
    recentThreadDeltas.length > 0 ||
    recentMovement !== null ||
    recentEvents.length > 0;

  // Scenes: all scenes up to current scene index where this character participates
  const lifecycle = sceneKeysUpToCurrent
    .map((k) => narrative.scenes[k])
    .filter((s) => s && s.participantIds.includes(characterId))
    .map((s) => ({
      sceneId: s.id,
      worldDeltas: s.worldDeltas.filter(
        (km) => km.entityId === characterId,
      ),
      relationshipDeltas: s.relationshipDeltas.filter(
        (rm) => rm.from === characterId || rm.to === characterId,
      ),
      threadDeltas: s.threadDeltas.filter((tm) =>
        narrative.threads[tm.threadId]?.participants?.some(
          (a) => a.id === characterId,
        ),
      ),
      movement: s.characterMovements?.[characterId] ?? null,
    }));

  return (
    <div className="flex flex-col gap-4">
      {/* Portrait */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt={character.name}
          className="w-full aspect-3/4 object-cover rounded-lg border border-border"
        />
      )}

      {/* Name + ID */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-text-primary">
          {character.name}
        </h2>
        <span className="font-mono text-[10px] text-text-dim">
          {characterId}
        </span>
      </div>

      {/* Role badge */}
      <span
        className={`text-[10px] uppercase tracking-widest ${roleClasses[character.role]}`}
      >
        {character.role}
      </span>

      {/* Image prompt — editable, with AI suggest from continuity */}
      <ImagePromptEditor
        kind="character"
        entityId={characterId}
        value={character.imagePrompt}
      />


      {/* Recent — current scene deltas, open by default */}
      {hasRecentActivity &&
        currentScene &&
        (() => {
          const totalCount =
            recentWorldDeltas.length +
            recentRelationshipDeltas.length +
            recentThreadDeltas.length +
            (recentMovement ? 1 : 0);
          const groups: React.ReactNode[] = [];

          if (recentEvents.length > 0) {
            groups.push(
              <ul key="events" className="flex flex-col gap-0.5">
                {recentEvents.map((ev, i) => (
                  <li key={i} className="text-xs text-text-dim italic">
                    {ev}
                  </li>
                ))}
              </ul>,
            );
          }
          if (recentThreadDeltas.length > 0) {
            groups.push(
              <ul key="threads" className="flex flex-col gap-0.5">
                {recentThreadDeltas.map((tm, i) => (
                  <li key={i} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "thread", threadId: tm.threadId },
                        })
                      }
                      className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary text-left"
                    >
                      {tm.threadId}
                      {narrative.threads[tm.threadId] && (
                        <span className="ml-1.5 font-sans text-text-dim">
                          {narrative.threads[tm.threadId].description}
                        </span>
                      )}
                    </button>
                    <span className="text-xs text-text-secondary">
                      <span className="text-text-dim">{tm.from}</span>
                      {" \u2192 "}
                      <span className="text-fate">{tm.to}</span>
                    </span>
                  </li>
                ))}
              </ul>,
            );
          }
          if (recentWorldDeltas.length > 0) {
            groups.push(
              <ul key="continuity" className="flex flex-col gap-0.5">
                {recentWorldDeltas.flatMap((km, kmIdx) =>
                  (km.addedNodes ?? []).map((node, nIdx) => (
                    <li
                      key={`${node.id}-${kmIdx}-${nIdx}`}
                      className="flex items-start gap-1"
                    >
                      <span className="shrink-0 text-world">+</span>
                      <span className="text-xs text-text-secondary">
                        {node.content}
                      </span>
                    </li>
                  )),
                )}
              </ul>,
            );
          }
          if (recentRelationshipDeltas.length > 0) {
            groups.push(
              <ul key="relationships" className="flex flex-col gap-0.5">
                {recentRelationshipDeltas.map((rm, rmIdx) => {
                  const otherId = rm.from === characterId ? rm.to : rm.from;
                  const otherName =
                    narrative.characters[otherId]?.name ?? otherId;
                  return (
                    <li
                      key={`${rm.from}-${rm.to}-${rmIdx}`}
                      className="text-xs text-text-secondary"
                    >
                      <span
                        className={
                          rm.valenceDelta >= 0 ? "text-world" : "text-drive"
                        }
                      >
                        {rm.valenceDelta > 0 ? "+" : ""}
                        {rm.valenceDelta}
                      </span>{" "}
                      {otherName}: {rm.type}
                    </li>
                  );
                })}
              </ul>,
            );
          }
          if (recentMovement) {
            groups.push(
              <span key="movement" className="text-xs text-text-secondary">
                &rarr;{" "}
                {narrative.locations[recentMovement.locationId]?.name ??
                  recentMovement.locationId}
                {recentMovement.transition && (
                  <span className="text-text-dim italic">
                    {" "}
                    — {recentMovement.transition}
                  </span>
                )}
              </span>,
            );
          }

          return (
            <CollapsibleSection title="Recent" count={totalCount} defaultOpen>
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_INSPECTOR",
                      context: { type: "scene", sceneId: currentScene.id },
                    })
                  }
                  className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary text-left mb-1"
                >
                  {currentScene.id}
                </button>
                {groups.map((group, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <div className="border-t border-white/5 my-1" />}
                    {group}
                  </React.Fragment>
                ))}
              </div>
            </CollapsibleSection>
          );
        })()}

      {/* Continuity — paginated, most recent first */}
      {worldNodes.length > 0 &&
        (() => {
          const { pageItems, totalPages, safePage } = paginateRecent(
            worldNodes,
            continuityPage,
          );
          return (
            <CollapsibleSection
              title="World"
              count={worldNodes.length}
            >
              <ul className="flex flex-col gap-1">
                {pageItems.map((node, i) => (
                  <li
                    key={`${node.id}-${i}`}
                    className="flex items-start gap-2"
                  >
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${continuityDotColors[node.type] ?? "bg-white/40"}`}
                    />
                    <span className="text-xs text-text-primary">
                      {node.content}
                    </span>
                  </li>
                ))}
              </ul>
              <Paginator
                page={safePage}
                totalPages={totalPages}
                onPage={setContinuityPage}
              />
            </CollapsibleSection>
          );
        })()}

      {/* Threads — paginated, most recent first */}
      {threadIds.length > 0 &&
        (() => {
          const { pageItems, totalPages, safePage } = paginateRecent(
            threadIds,
            threadPage,
          );
          return (
            <CollapsibleSection title="Threads" count={threadIds.length}>
              <ul className="flex flex-col gap-1">
                {pageItems.map((tid, i) => (
                  <li key={`${tid}-${i}`}>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "thread", threadId: tid },
                        })
                      }
                      className="font-mono text-xs text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {tid}
                      {narrative.threads[tid] && (
                        <span className="ml-1.5 font-sans text-text-dim">
                          {narrative.threads[tid].description}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <Paginator
                page={safePage}
                totalPages={totalPages}
                onPage={setThreadPage}
              />
            </CollapsibleSection>
          );
        })()}

      {/* Artifacts owned by this character (at the current scene) */}
      {(() => {
        const sceneOwnership = getOwnershipAtScene(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
        // Only consider artifacts that have been introduced by this scene.
        // An artifact with no entry in sceneOwnership doesn't yet exist at this
        // point in the timeline — falling back to its final parentId would
        // leak future ownership into earlier scenes.
        const owned = Object.values(narrative.artifacts ?? {}).filter((a) => {
          if (!sceneOwnership.has(a.id)) return false;
          return sceneOwnership.get(a.id) === characterId;
        });
        if (owned.length === 0) return null;
        return (
          <CollapsibleSection title="Artifacts" count={owned.length}>
            <ul className="flex flex-col gap-1">
              {owned.map((art) => (
                <li key={art.id}>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "artifact", artifactId: art.id },
                      })
                    }
                    className="text-xs text-amber-400 transition-colors hover:underline"
                  >
                    {art.name}
                    <span className="ml-1.5 text-text-dim">
                      ({art.significance})
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        );
      })()}

      {/* Ties — locations this character has a significant bond with (at the current scene) */}
      {(() => {
        const sceneTies = getTiesAtScene(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
        const ties = Object.values(narrative.locations).filter((loc) =>
          (sceneTies.get(loc.id) ?? new Set()).has(characterId),
        );
        if (ties.length === 0) return null;
        return (
          <CollapsibleSection title="Ties" count={ties.length}>
            <ul className="flex flex-col gap-1">
              {ties.map((loc) => (
                <li key={loc.id}>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "location", locationId: loc.id },
                      })
                    }
                    className="text-xs text-text-primary transition-colors hover:underline"
                  >
                    {loc.name}
                    <span className="ml-1.5 text-[9px] text-text-dim">
                      {loc.prominence}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        );
      })()}

      {/* Relationships — paginated, most recent first */}
      {relationships.length > 0 &&
        (() => {
          const { pageItems, totalPages, safePage } = paginateRecent(
            relationships,
            relPage,
          );
          return (
            <CollapsibleSection
              title="Relationships"
              count={relationships.length}
            >
              <ul className="flex flex-col gap-2">
                {pageItems.map((rel, relIdx) => {
                  const isOutgoing = rel.from === characterId;
                  const otherId = isOutgoing ? rel.to : rel.from;
                  const other = narrative.characters[otherId];
                  const arrow = isOutgoing ? "\u2192" : "\u2190";
                  const clamped = Math.max(-1, Math.min(1, rel.valence));
                  const pct = Math.abs(clamped) * 100;
                  const isPositive = rel.valence > 0;
                  const isNegative = rel.valence < 0;
                  return (
                    <li
                      key={`${rel.from}-${rel.to}-${rel.type}-${relIdx}`}
                      className="flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-primary flex items-center gap-1">
                          <span className="text-text-dim">{arrow}</span>
                          <button
                            type="button"
                            onClick={() =>
                              dispatch({
                                type: "SET_INSPECTOR",
                                context: {
                                  type: "character",
                                  characterId: otherId,
                                },
                              })
                            }
                            className="hover:underline transition-colors"
                          >
                            {other?.name ?? otherId}
                          </button>
                        </span>
                        <span className="text-[10px] text-text-dim">
                          {rel.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden relative">
                          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
                          {isPositive && (
                            <div
                              className="absolute top-0 bottom-0 left-1/2 rounded-r-full"
                              style={{
                                width: `${pct / 2}%`,
                                backgroundColor: "#22C55E",
                              }}
                            />
                          )}
                          {isNegative && (
                            <div
                              className="absolute top-0 bottom-0 rounded-l-full"
                              style={{
                                width: `${pct / 2}%`,
                                right: "50%",
                                backgroundColor: "#EF4444",
                              }}
                            />
                          )}
                        </div>
                        <span
                          className={`text-[10px] font-mono w-6 text-right ${isPositive ? "text-world" : isNegative ? "text-fate" : "text-text-dim"}`}
                        >
                          {rel.valence > 0 ? "+" : ""}
                          {Number(rel.valence.toFixed(2))}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Paginator
                page={safePage}
                totalPages={totalPages}
                onPage={setRelPage}
              />
            </CollapsibleSection>
          );
        })()}

      {/* Scenes — paginated, most recent first */}
      {lifecycle.length > 0 &&
        (() => {
          const { pageItems, totalPages, safePage } = paginateRecent(
            lifecycle,
            lifecyclePage,
          );
          return (
            <CollapsibleSection
              title="Scenes"
              count={lifecycle.length}
              defaultOpen
            >
              <ul className="flex flex-col gap-2">
                {pageItems.map(
                  ({
                    sceneId,
                    worldDeltas,
                    relationshipDeltas,
                    threadDeltas,
                    movement,
                  }) => (
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
                      {threadDeltas.map((tm, tmIdx) => (
                        <span
                          key={`${tm.threadId}-${tmIdx}`}
                          className="text-xs text-text-secondary"
                        >
                          {tm.threadId}: {tm.from} &rarr; {tm.to}
                        </span>
                      ))}
                      {worldDeltas.flatMap((km, kmIdx) =>
                        (km.addedNodes ?? []).map((node, nIdx) => (
                          <span
                            key={`${node.id}-${kmIdx}-${nIdx}`}
                            className="text-xs text-text-secondary"
                          >
                            <span className="text-world">+</span> {node.content}
                          </span>
                        )),
                      )}
                      {relationshipDeltas.map((rm, rmIdx) => {
                        const otherId =
                          rm.from === characterId ? rm.to : rm.from;
                        const otherName =
                          narrative.characters[otherId]?.name ?? otherId;
                        return (
                          <span
                            key={`${rm.from}-${rm.to}-${rmIdx}`}
                            className="text-xs text-text-secondary"
                          >
                            <span
                              className={
                                rm.valenceDelta >= 0
                                  ? "text-world"
                                  : "text-drive"
                              }
                            >
                              {rm.valenceDelta > 0 ? "+" : ""}
                              {rm.valenceDelta}
                            </span>{" "}
                            {otherName}: {rm.type}
                          </span>
                        );
                      })}
                      {movement && (
                        <span className="text-xs text-text-secondary">
                          &rarr;{" "}
                          {narrative.locations[movement.locationId]?.name ??
                            movement.locationId}
                          {movement.transition && (
                            <span className="text-text-dim italic">
                              {" "}
                              — {movement.transition}
                            </span>
                          )}
                        </span>
                      )}
                    </li>
                  ),
                )}
              </ul>
              <Paginator
                page={safePage}
                totalPages={totalPages}
                onPage={setLifecyclePage}
              />
            </CollapsibleSection>
          );
        })()}
    </div>
  );
}
