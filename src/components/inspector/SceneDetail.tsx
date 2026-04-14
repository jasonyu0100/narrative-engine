"use client";

import { useImageUrl } from "@/hooks/useAssetUrl";
import { computeForceSnapshots, detectCubeCorner, getEffectivePovId, resolveEntityName } from "@/lib/narrative-utils";
import { useStore } from "@/lib/store";
import { isScene, resolveEntry, type Scene } from "@/types/narrative";
import { useMemo } from "react";

type Props = {
  sceneId: string;
};

export default function SceneDetail({ sceneId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const forceSnapshot = useMemo(() => {
    if (!narrative) return { fate: 0, world: 0, system: 0 };
    const allScenes = state.resolvedEntryKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
    const forceMap = computeForceSnapshots(allScenes);
    return forceMap[sceneId] ?? { fate: 0, world: 0, system: 0 };
  }, [narrative, state.resolvedEntryKeys, sceneId]);

  // Resolve entry early to determine imageUrl for hook
  const entry = narrative ? resolveEntry(narrative, sceneId) : null;
  const imageUrl = useImageUrl(
    entry && isScene(entry) ? entry.imageUrl : undefined,
  );

  // Entities introduced by this scene — taken directly from the authoritative
  // new* arrays. IDs are filtered against narrative.* so stale introductions
  // (e.g. an entity removed during revision) don't render as dead links.
  const firstAppearances = useMemo<{
    characters: string[];
    locations: string[];
    artifacts: string[];
    threads: string[];
  }>(() => {
    const empty = { characters: [], locations: [], artifacts: [], threads: [] };
    if (!narrative || !entry || entry.kind !== "scene") return empty;
    return {
      characters: (entry.newCharacters ?? [])
        .map((c) => c.id)
        .filter((id) => narrative.characters[id]),
      locations: (entry.newLocations ?? [])
        .map((l) => l.id)
        .filter((id) => narrative.locations[id]),
      artifacts: (entry.newArtifacts ?? [])
        .map((a) => a.id)
        .filter((id) => narrative.artifacts[id]),
      threads: (entry.newThreads ?? [])
        .map((t) => t.id)
        .filter((id) => narrative.threads[id]),
    };
  }, [narrative, entry]);

  if (!narrative) return null;
  if (!entry) return null;

  // ── World Build Commit view ─────────────────────────────────────────────
  if (entry.kind === "world_build") {
    const m = entry.expansionManifest;
    const totalWorldNodes = (m.worldDeltas ?? []).reduce(
      (acc, cm) => acc + (cm.addedNodes?.length ?? 0),
      0,
    );
    const isEmpty =
      m.newCharacters.length === 0 &&
      m.newLocations.length === 0 &&
      m.newThreads.length === 0 &&
      (m.newArtifacts?.length ?? 0) === 0 &&
      (m.systemDeltas?.addedNodes?.length ?? 0) === 0 &&
      (m.worldDeltas?.length ?? 0) === 0 &&
      (m.relationshipDeltas?.length ?? 0) === 0 &&
      (m.ownershipDeltas?.length ?? 0) === 0 &&
      (m.tieDeltas?.length ?? 0) === 0;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline gap-2">
          <h2 className="font-mono text-xs text-text-dim">{entry.id}</h2>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
            World Build
          </span>
        </div>

        <p className="text-xs text-text-secondary leading-relaxed">
          {entry.summary || "No summary available."}
        </p>

        <div className="flex flex-col gap-1.5">
          {isEmpty && (
            <p className="text-[10px] text-text-dim italic">
              This expansion added nothing new.
            </p>
          )}
          {m.newCharacters.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Characters
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {m.newCharacters.map((mc) => {
                  const char = narrative.characters[mc.id];
                  return (
                    <button
                      key={mc.id}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "character", characterId: mc.id },
                        })
                      }
                      className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {char?.name ?? mc.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {m.newLocations.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Locations
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {m.newLocations.map((ml) => {
                  const loc = narrative.locations[ml.id];
                  return (
                    <button
                      key={ml.id}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "location", locationId: ml.id },
                        })
                      }
                      className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {loc?.name ?? ml.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {m.newThreads.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Threads
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {m.newThreads.map((mt) => {
                  const thread = narrative.threads[mt.id];
                  const depCount =
                    thread?.dependents?.filter((id) => narrative.threads[id])
                      .length ?? 0;
                  return (
                    <button
                      key={mt.id}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "thread", threadId: mt.id },
                        })
                      }
                      className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {thread?.description ?? mt.description}
                      {depCount > 0 && (
                        <span className="text-cyan-400/70 ml-1">
                          &#x21C4;{depCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(m.newArtifacts?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Artifacts
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {m.newArtifacts!.map((ma) => {
                  const art = narrative.artifacts?.[ma.id];
                  return (
                    <button
                      key={ma.id}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "artifact", artifactId: ma.id },
                        })
                      }
                      className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {art?.name ?? ma.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(m.systemDeltas?.addedNodes?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                System Knowledge
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {m.systemDeltas!.addedNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() =>
                      dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "codex" })
                    }
                    className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                  >
                    {node.concept}
                    <span className="text-text-dim ml-1">({node.type})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {(m.worldDeltas?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                World ({totalWorldNodes})
              </h3>
              <div className="flex flex-col gap-0.5">
                {m.worldDeltas!.map((cm, i) => {
                  const char = narrative.characters[cm.entityId];
                  const loc = narrative.locations[cm.entityId];
                  const art = narrative.artifacts?.[cm.entityId];
                  const name = resolveEntityName(narrative, cm.entityId);
                  const kind = char
                    ? "character"
                    : loc
                      ? "location"
                      : art
                        ? "artifact"
                        : null;
                  return (
                    <button
                      key={`${cm.entityId}-${i}`}
                      type="button"
                      disabled={!kind}
                      onClick={() => {
                        if (kind === "character")
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: {
                              type: "character",
                              characterId: cm.entityId,
                            },
                          });
                        else if (kind === "location")
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: {
                              type: "location",
                              locationId: cm.entityId,
                            },
                          });
                        else if (kind === "artifact")
                          dispatch({
                            type: "SET_INSPECTOR",
                            context: {
                              type: "artifact",
                              artifactId: cm.entityId,
                            },
                          });
                      }}
                      className="text-left text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60"
                    >
                      <span className="font-mono text-text-dim mr-1">
                        {cm.entityId}
                      </span>
                      {name}
                      <span className="text-text-dim ml-1">
                        +{cm.addedNodes?.length ?? 0} node
                        {(cm.addedNodes?.length ?? 0) === 1 ? "" : "s"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(m.relationshipDeltas?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Relationship Shifts
              </h3>
              <div className="flex flex-col gap-0.5">
                {m.relationshipDeltas!.map((rm, i) => {
                  const from = narrative.characters[rm.from]?.name ?? rm.from;
                  const to = narrative.characters[rm.to]?.name ?? rm.to;
                  const sign = rm.valenceDelta > 0 ? "+" : "";
                  return (
                    <div
                      key={`${rm.from}-${rm.to}-${i}`}
                      className="text-[10px] text-text-secondary"
                    >
                      <span className="text-text-primary">{from}</span>
                      <span className="text-text-dim mx-1">&rarr;</span>
                      <span className="text-text-primary">{to}</span>
                      <span className="text-text-dim ml-1">{rm.type}</span>
                      <span className="text-fate ml-1">
                        ({sign}
                        {rm.valenceDelta.toFixed(2)})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {(m.ownershipDeltas?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Ownership
              </h3>
              <div className="flex flex-col gap-0.5">
                {m.ownershipDeltas!.map((om, i) => {
                  const art = narrative.artifacts?.[om.artifactId];
                  const fromName = resolveEntityName(narrative, om.fromId);
                  const toName = resolveEntityName(narrative, om.toId);
                  return (
                    <div
                      key={`${om.artifactId}-${i}`}
                      className="text-[10px] text-text-secondary"
                    >
                      <span className="text-text-primary">
                        {art?.name ?? om.artifactId}
                      </span>
                      <span className="text-text-dim mx-1">:</span>
                      <span>{fromName}</span>
                      <span className="text-text-dim mx-1">&rarr;</span>
                      <span>{toName}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {(m.tieDeltas?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                Ties
              </h3>
              <div className="flex flex-col gap-0.5">
                {m.tieDeltas!.map((tm, i) => {
                  const loc = narrative.locations[tm.locationId];
                  const char = narrative.characters[tm.characterId];
                  return (
                    <div
                      key={`${tm.locationId}-${tm.characterId}-${i}`}
                      className="text-[10px] text-text-secondary"
                    >
                      <span className="text-text-primary">
                        {char?.name ?? tm.characterId}
                      </span>
                      <span className="text-text-dim mx-1">
                        {tm.action === "add" ? "joined" : "left"}
                      </span>
                      <span className="text-text-primary">
                        {loc?.name ?? tm.locationId}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Scene Commit view ───────────────────────────────────────────────────
  const scene = entry as Scene;
  const location = narrative.locations[scene.locationId];
  const effectivePovId = getEffectivePovId(scene);
  const povCharacter = effectivePovId
    ? narrative.characters[effectivePovId]
    : null;

  const { fate, world, system } = forceSnapshot;
  const cubeCorner = detectCubeCorner(forceSnapshot);

  const arc = Object.values(narrative.arcs).find((a) =>
    a.sceneIds.includes(sceneId),
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Scene still */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt={scene.summary}
          className="w-full aspect-[2/3] object-cover rounded-lg border border-border"
        />
      )}

      {/* Scene ID + Arc */}
      <div className="flex items-baseline gap-2">
        <h2 className="font-mono text-xs text-text-dim">{scene.id}</h2>
        {arc && (
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "SET_INSPECTOR",
                context: { type: "arc", arcId: arc.id },
              })
            }
            className="text-[10px] text-text-dim uppercase tracking-wider hover:text-text-secondary transition-colors"
          >
            {arc.name}
          </button>
        )}
      </div>

      {/* Location + POV */}
      <div className="flex flex-col gap-1.5">
        {location && (
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "SET_INSPECTOR",
                context: { type: "location", locationId: location.id },
              })
            }
            className="flex items-center gap-1.5 text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            <svg
              className="w-3.5 h-3.5 shrink-0 text-text-dim"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
            <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">
              Location
            </span>
            {location.name}
          </button>
        )}
        {povCharacter && (
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "SET_INSPECTOR",
                context: { type: "character", characterId: povCharacter.id },
              })
            }
            className="flex items-center gap-1.5 text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            <svg
              className="w-3.5 h-3.5 shrink-0 text-text-dim"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">
              POV
            </span>
            {povCharacter.name}
          </button>
        )}
      </div>

      {/* Summary */}
      <p className="text-xs text-text-secondary leading-relaxed">
        {scene.summary || "No summary available."}
      </p>

      {/* First Appearances — entities introduced for the first time in this scene */}
      {(firstAppearances.characters.length > 0 ||
        firstAppearances.locations.length > 0 ||
        firstAppearances.artifacts.length > 0 ||
        firstAppearances.threads.length > 0) && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-emerald-400/15 bg-emerald-400/5 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <svg
              className="w-3 h-3 shrink-0 text-emerald-400/80"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2l1.8 5.5L19 9l-5 3.5L15.5 19 12 15.5 8.5 19 10 12.5 5 9l5.2-1.5z" />
            </svg>
            <h3 className="text-[10px] uppercase tracking-widest font-semibold text-emerald-400/80">
              First Appearances
            </h3>
            <span className="ml-auto text-[10px] text-emerald-400/40 font-mono tabular-nums">
              {firstAppearances.characters.length +
                firstAppearances.locations.length +
                firstAppearances.artifacts.length +
                firstAppearances.threads.length}
            </span>
          </div>
          {firstAppearances.characters.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Characters · {firstAppearances.characters.length}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {firstAppearances.characters.map((cid) => {
                  const c = narrative.characters[cid];
                  if (!c) return null;
                  return (
                    <button
                      key={cid}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "character", characterId: cid },
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100 transition-colors hover:bg-emerald-400/20"
                    >
                      <span>{c.name}</span>
                      <span className="text-[8px] uppercase tracking-wider text-emerald-400/60">
                        {c.role}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {firstAppearances.locations.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Locations · {firstAppearances.locations.length}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {firstAppearances.locations.map((lid) => {
                  const l = narrative.locations[lid];
                  if (!l) return null;
                  return (
                    <button
                      key={lid}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "location", locationId: lid },
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100 transition-colors hover:bg-emerald-400/20"
                    >
                      <span>{l.name}</span>
                      <span className="text-[8px] uppercase tracking-wider text-emerald-400/60">
                        {l.prominence}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {firstAppearances.artifacts.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Artifacts · {firstAppearances.artifacts.length}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {firstAppearances.artifacts.map((aid) => {
                  const a = narrative.artifacts[aid];
                  if (!a) return null;
                  return (
                    <button
                      key={aid}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "artifact", artifactId: aid },
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100 transition-colors hover:bg-emerald-400/20"
                    >
                      <span>{a.name}</span>
                      <span className="text-[8px] uppercase tracking-wider text-emerald-400/60">
                        {a.significance}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {firstAppearances.threads.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-wider text-text-dim">
                Threads · {firstAppearances.threads.length}
              </span>
              <div className="flex flex-col gap-1">
                {firstAppearances.threads.map((tid) => {
                  const t = narrative.threads[tid];
                  if (!t) return null;
                  return (
                    <button
                      key={tid}
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "thread", threadId: tid },
                        })
                      }
                      className="group flex items-start gap-1.5 rounded bg-emerald-400/10 px-2 py-1 text-left transition-colors hover:bg-emerald-400/20"
                    >
                      <span className="shrink-0 font-mono text-[9px] text-emerald-400/60">
                        {tid}
                      </span>
                      <span className="text-[10px] leading-tight text-emerald-100">
                        {t.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Participants */}
      {scene.participantIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Participants
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {scene.participantIds.map((cid, cidIdx) => {
              const character = narrative.characters[cid];
              if (!character) return null;
              return (
                <button
                  key={`${cid}-${cidIdx}`}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_INSPECTOR",
                      context: { type: "character", characterId: cid },
                    })
                  }
                  className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                >
                  {character.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Artifact Usages */}
      {(scene.artifactUsages ?? []).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Artifacts
          </h3>
          <div className="flex flex-col gap-1.5">
            {(scene.artifactUsages ?? []).map((au, auIdx) => {
              const artifact = narrative.artifacts[au.artifactId];
              const character = au.characterId
                ? narrative.characters[au.characterId]
                : null;
              if (!artifact) return null;
              return (
                <div
                  key={`${au.artifactId}-${au.characterId}-${auIdx}`}
                  className="flex flex-col gap-0.5"
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: {
                            type: "artifact",
                            artifactId: au.artifactId,
                          },
                        })
                      }
                      className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300 transition-colors hover:bg-amber-400/20"
                    >
                      {artifact.name}
                    </button>
                    {character && (
                      <span className="text-[10px] text-text-dim">
                        ({character.name})
                      </span>
                    )}
                  </div>
                  {au.usage && (
                    <span className="text-[10px] text-text-dim pl-2">
                      {au.usage}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Force Snapshot */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <svg width="24" height="12" viewBox="0 0 24 12">
            {cubeCorner.key.split("").map((c, i) => {
              const isHi = c === "H";
              const colors = ["#EF4444", "#22C55E", "#3B82F6"];
              const barH = isHi ? 10 : 5;
              const barY = isHi ? 1 : 6;
              return (
                <rect
                  key={i}
                  x={i * 9}
                  y={barY}
                  width={7}
                  height={barH}
                  rx={1.5}
                  fill={colors[i]}
                  opacity={isHi ? 1 : 0.4}
                />
              );
            })}
          </svg>
          <span className="text-[11px] text-text-secondary">
            {cubeCorner.name}
          </span>
        </div>
      </div>

      {/* Character Movements */}
      {scene.characterMovements &&
        Object.keys(scene.characterMovements).length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
              Movements
            </h3>
            {Object.entries(scene.characterMovements).map(([charId, mv]) => {
              const charName = narrative.characters[charId]?.name ?? charId;
              const toLocName =
                narrative.locations[mv.locationId]?.name ?? mv.locationId;
              return (
                <div key={charId} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: { type: "character", characterId: charId },
                        })
                      }
                      className="text-text-primary transition-colors hover:underline"
                    >
                      {charName}
                    </button>
                    <span className="text-text-dim">&rarr;</span>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: "SET_INSPECTOR",
                          context: {
                            type: "location",
                            locationId: mv.locationId,
                          },
                        })
                      }
                      className="text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {toLocName}
                    </button>
                  </div>
                  {mv.transition && (
                    <span className="text-[10px] text-text-dim italic ml-3">
                      {mv.transition}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

      {/* Thread Deltas */}
      {scene.threadDeltas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Thread Deltas
          </h3>
          {scene.threadDeltas.map((tm, tmIdx) => {
            const thread = narrative.threads[tm.threadId];
            return (
              <div
                key={`${tm.threadId}-${tmIdx}`}
                className="flex items-center gap-1.5 text-xs"
              >
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_INSPECTOR",
                      context: { type: "thread", threadId: tm.threadId },
                    })
                  }
                  className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary transition-colors hover:bg-white/12 shrink-0"
                >
                  {tm.threadId}
                </button>
                {thread && (
                  <span className="text-text-dim text-[10px] truncate max-w-25">
                    {thread.description}
                  </span>
                )}
                <span className="text-text-dim ml-auto shrink-0">
                  {tm.from} &rarr; {tm.to}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* World Deltas */}
      {scene.worldDeltas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            World Deltas
          </h3>
          {scene.worldDeltas.flatMap((km, kmIdx) => {
            const entityName = resolveEntityName(narrative, km.entityId);
            const isChar = !!narrative.characters[km.entityId];
            return (km.addedNodes ?? []).map((node, nIdx) => (
              <div
                key={`${km.entityId}-${node.id}-${kmIdx}-${nIdx}`}
                className="flex flex-col gap-0.5 text-xs"
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      isChar &&
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: {
                          type: "character",
                          characterId: km.entityId,
                        },
                      })
                    }
                    className="text-text-primary transition-colors hover:underline"
                  >
                    {entityName}
                  </button>
                  <span className="text-world">+</span>
                  <span className="font-mono text-[10px] text-text-dim">
                    {node.id}
                  </span>
                </div>
                <span className="text-text-secondary pl-2">{node.content}</span>
              </div>
            ));
          })}
        </div>
      )}

      {/* Relationship Deltas */}
      {scene.relationshipDeltas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Relationship Deltas
          </h3>
          {scene.relationshipDeltas.map((rm, i) => {
            const fromName = narrative.characters[rm.from]?.name ?? rm.from;
            const toName = narrative.characters[rm.to]?.name ?? rm.to;
            return (
              <div
                key={`${rm.from}-${rm.to}-${i}`}
                className="flex flex-col gap-0.5 text-xs"
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "character", characterId: rm.from },
                      })
                    }
                    className="text-text-primary transition-colors hover:underline"
                  >
                    {fromName}
                  </button>
                  <span className="text-text-dim">&harr;</span>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_INSPECTOR",
                        context: { type: "character", characterId: rm.to },
                      })
                    }
                    className="text-text-primary transition-colors hover:underline"
                  >
                    {toName}
                  </button>
                  <span
                    className={
                      rm.valenceDelta >= 0 ? "text-world" : "text-fate"
                    }
                  >
                    {rm.valenceDelta > 0 ? "+" : ""}
                    {rm.valenceDelta}
                  </span>
                </div>
                <span className="text-text-secondary pl-2">{rm.type}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Ownership Deltas */}
      {(scene.ownershipDeltas?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Artifact Transfers
          </h3>
          {scene.ownershipDeltas!.map((om, i) => {
            const artName = resolveEntityName(narrative, om.artifactId);
            const fromName = resolveEntityName(narrative, om.fromId);
            const toName = resolveEntityName(narrative, om.toId);
            return (
              <div
                key={`om-${om.artifactId}-${i}`}
                className="flex items-center gap-1.5 text-xs"
              >
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_INSPECTOR",
                      context: { type: "artifact", artifactId: om.artifactId },
                    })
                  }
                  className="text-amber-400 transition-colors hover:underline"
                >
                  {artName}
                </button>
                <span className="text-text-dim">
                  {fromName} → {toName}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Tie Deltas */}
      {(scene.tieDeltas?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Ties
          </h3>
          {scene.tieDeltas!.map((mm, i) => {
            const charName =
              narrative.characters[mm.characterId]?.name ?? mm.characterId;
            const locName =
              narrative.locations[mm.locationId]?.name ?? mm.locationId;
            return (
              <div
                key={`mm-${mm.locationId}-${mm.characterId}-${i}`}
                className="flex items-center gap-1.5 text-xs"
              >
                <span
                  className={mm.action === "add" ? "text-world" : "text-fate"}
                >
                  {mm.action === "add" ? "+" : "−"}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_INSPECTOR",
                      context: {
                        type: "character",
                        characterId: mm.characterId,
                      },
                    })
                  }
                  className="text-text-primary transition-colors hover:underline"
                >
                  {charName}
                </button>
                <span className="text-text-dim">
                  {mm.action === "add" ? "joins" : "leaves"}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_INSPECTOR",
                      context: { type: "location", locationId: mm.locationId },
                    })
                  }
                  className="text-text-primary transition-colors hover:underline"
                >
                  {locName}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* System Knowledge Deltas */}
      {scene.systemDeltas &&
        ((scene.systemDeltas.addedNodes?.length ?? 0) > 0 ||
          (scene.systemDeltas.addedEdges?.length ?? 0) > 0) && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
              System Knowledge
            </h3>
            {(scene.systemDeltas.addedNodes ?? []).map((node, i) => (
              <div
                key={`wk-node-${node.id}-${i}`}
                className="flex items-center gap-1.5 text-xs"
              >
                <span className="text-world">+</span>
                <span className="text-text-primary">{node.concept}</span>
                <span className="text-[10px] text-text-dim">({node.type})</span>
              </div>
            ))}
            {(scene.systemDeltas.addedEdges ?? []).map((edge, i) => {
              const fromNode = narrative.systemGraph.nodes[edge.from];
              const toNode = narrative.systemGraph.nodes[edge.to];
              const shortName = (concept: string) => {
                const dash = concept.indexOf(" — ");
                return dash > 0 ? concept.slice(0, dash) : concept;
              };
              return (
                <div
                  key={`wk-edge-${edge.from}-${edge.to}-${i}`}
                  className="text-xs pl-3 text-text-dim"
                >
                  {shortName(fromNode?.concept ?? edge.from ?? "")}{" "}
                  <span className="italic text-text-dim">{edge.relation}</span>{" "}
                  {shortName(toNode?.concept ?? edge.to ?? "")}
                </div>
              );
            })}
          </div>
        )}

      {/* Events */}
      {scene.events.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Events
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {scene.events.map((evt, evtIdx) => (
              <span
                key={`${evt}-${evtIdx}`}
                className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400/80"
              >
                {evt}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ForceBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <span className="text-[10px] uppercase text-text-dim">{label}</span>
      <div className="h-1.5 w-full rounded-full bg-white/6">
        <div
          className="h-1.5 rounded-full"
          style={{
            width: `${Math.max(0, Math.min(1, value)) * 100}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}
