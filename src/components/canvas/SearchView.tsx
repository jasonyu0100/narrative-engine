"use client";

import { synthesizeSearchResults } from "@/lib/ai/search-synthesis";
import {
  resolvePlanForBranch,
  resolveProseForBranch,
} from "@/lib/narrative-utils";
import { searchNarrative } from "@/lib/search";
import { useStore } from "@/lib/store";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

type QueryResponse = {
  question: string;
  answer: string;
  citations: Array<{
    id: number;
    sceneId: string;
    beatIndex?: number;
    propIndex?: number;
    content: string;
    similarity: number;
    type: "scene" | "beat" | "proposition";
  }>;
};

const SUGGESTED_QUERIES = [
  "What are the main conflicts?",
  "Character relationships and dynamics",
  "Key plot turning points",
  "Thematic patterns across scenes",
  "World-building details and rules",
  "Character motivations and goals",
];

export function SearchView() {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchStage, setSearchStage] = useState<string>("");
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [showDetailTimeline, setShowDetailTimeline] = useState(false);

  // Load search state from store when narrative changes
  useEffect(() => {
    if (!state.activeNarrative?.id) {
      setQuery("");
      setResponse(null);
      setStreamingAnswer("");
      setErrorMessage(null);
      setIsLoaded(true);
      return;
    }

    const savedSearch = state.currentSearchQuery;
    if (savedSearch && savedSearch.synthesis) {
      setQuery(savedSearch.query);

      // Guaranteed representation: top 5 summaries + top 10 details, then sort by similarity
      const topScenes = savedSearch.sceneResults.slice(0, 5);
      const topDetails = savedSearch.detailResults.slice(0, 10);
      const combined = [...topScenes, ...topDetails]
        .sort((a, b) => b.similarity - a.similarity)
        .map((res, idx) => ({
          id: idx + 1,
          sceneId: res.sceneId,
          beatIndex: res.beatIndex,
          propIndex: res.propIndex,
          content:
            res.content.length > 200
              ? res.content.substring(0, 197) + "..."
              : res.content,
          similarity: res.similarity,
          type: res.type,
        }));

      setResponse({
        question: savedSearch.query,
        answer: savedSearch.synthesis.overview,
        citations: combined,
      });
    } else {
      // Clear local state if no saved search
      setQuery("");
      setResponse(null);
      setStreamingAnswer("");
      setErrorMessage(null);
    }
    setIsLoaded(true);
  }, [state.activeNarrative?.id, state.currentSearchQuery]);

  // Listen for clear search event from top bar
  useEffect(() => {
    const handleClear = () => {
      setQuery("");
      setResponse(null);
      setStreamingAnswer("");
      setErrorMessage(null);
      dispatch({ type: "CLEAR_SEARCH" });
    };

    window.addEventListener("search:clear", handleClear);
    return () => window.removeEventListener("search:clear", handleClear);
  }, [dispatch]);

  const handleQuery = useCallback(
    async (question: string) => {
      const narrative = state.activeNarrative;
      const resolvedKeys = state.resolvedEntryKeys;

      if (!narrative || !resolvedKeys || question.trim().length === 0) return;

      setIsSearching(true);
      setSearchStage("Embedding query");
      setErrorMessage(null);
      setResponse(null);
      setStreamingAnswer("");

      try {
        const sceneCount = resolvedKeys.length;

        // Stage 1: Searching
        setSearchStage(
          `Searching ${sceneCount} scene${sceneCount !== 1 ? "s" : ""}`,
        );
        const result = await searchNarrative(
          narrative,
          resolvedKeys,
          question.trim(),
        );

        if (result.results.length > 0) {
          // Stage 2: Found results, generating AI summary
          const summaryCount = Math.min(5, result.sceneResults.length);
          const detailCount = Math.min(10, result.detailResults.length);
          const totalUsed = summaryCount + detailCount;
          setSearchStage(
            `Found ${result.results.length} results — synthesizing top ${totalUsed}`,
          );

          const synthesis = await synthesizeSearchResults(
            narrative,
            question.trim(),
            result.sceneResults,
            result.detailResults,
            result.topArc,
            result.topScene,
            result.detailTimeline,
            (token) => {
              // Update immediately for responsive streaming
              setStreamingAnswer((prev) => {
                if (prev.length === 0) {
                  // First token received, we're streaming now
                  setSearchStage("");
                }
                return prev + token;
              });
            },
          );

          // Guaranteed representation: top 5 summaries + top 10 details, then sort by similarity
          const topScenes = result.sceneResults.slice(0, 5);
          const topDetails = result.detailResults.slice(0, 10);
          const combined = [...topScenes, ...topDetails]
            .sort((a, b) => b.similarity - a.similarity)
            .map((res, idx) => ({
              id: idx + 1,
              sceneId: res.sceneId,
              beatIndex: res.beatIndex,
              propIndex: res.propIndex,
              content:
                res.content.length > 200
                  ? res.content.substring(0, 197) + "..."
                  : res.content,
              similarity: res.similarity,
              type: res.type,
            }));

          const responseData = {
            question: question.trim(),
            answer: synthesis.overview,
            citations: combined,
          };
          setResponse(responseData);

          // Save search state to store
          dispatch({
            type: "SET_SEARCH_QUERY",
            query: {
              query: question.trim(),
              embedding: result.embedding,
              synthesis,
              results: result.results,
              sceneResults: result.sceneResults,
              detailResults: result.detailResults,
              sceneTimeline: result.sceneTimeline,
              detailTimeline: result.detailTimeline,
              topArc: result.topArc,
              topScene: result.topScene,
              topBeat: result.topBeat,
            },
          });
        } else {
          setErrorMessage(
            "No relevant content found. Try a different question or generate embeddings.",
          );
        }
      } catch (err) {
        setErrorMessage("Query failed. Please try again.");
      } finally {
        setIsSearching(false);
        setSearchStage("");
      }
    },
    [state.activeNarrative, state.resolvedEntryKeys, dispatch],
  );

  const getSceneInfo = useCallback(
    (sceneId: string, beatIndex?: number) => {
      const narrative = state.activeNarrative;
      if (!narrative || !state.activeBranchId) return null;

      const scene = narrative.scenes[sceneId];
      if (!scene) return null;

      const proseData = resolveProseForBranch(
        scene,
        state.activeBranchId,
        narrative.branches,
      );
      const planData = resolvePlanForBranch(
        scene,
        state.activeBranchId,
        narrative.branches,
      );

      let beatProse: string | null = null;
      if (beatIndex !== undefined && proseData?.beatProseMap) {
        const beatChunk = proseData.beatProseMap.chunks.find(
          (c) => c.beatIndex === beatIndex,
        );
        beatProse = beatChunk?.prose || null;
      }

      // Get arc index (1-based)
      const arc = scene.arcId ? narrative.arcs[scene.arcId] : null;
      const arcIndex = arc
        ? Object.keys(narrative.arcs).indexOf(scene.arcId!) + 1
        : null;

      // Get scene index (1-based) - count only scenes, not world commits
      const entryPosition = state.resolvedEntryKeys.indexOf(sceneId);
      const sceneIndex = entryPosition >= 0
        ? state.resolvedEntryKeys
            .slice(0, entryPosition + 1)
            .filter((id) => narrative.scenes[id]).length
        : null;

      return {
        scene,
        prose: proseData?.prose || null,
        beatProse,
        plan: planData?.beats || null,
        arc,
        arcIndex,
        sceneIndex,
      };
    },
    [state.activeNarrative, state.activeBranchId, state.resolvedEntryKeys],
  );

  const navigateToCitation = useCallback(
    (citation: QueryResponse["citations"][0]) => {
      const sceneIndex = state.resolvedEntryKeys.indexOf(citation.sceneId);
      if (sceneIndex < 0) return;

      const sceneInfo = getSceneInfo(citation.sceneId, citation.beatIndex);
      const hasProse = sceneInfo?.prose || sceneInfo?.beatProse;

      // Step 1: Set scene index
      dispatch({ type: "SET_SCENE_INDEX", index: sceneIndex });

      if (hasProse) {
        // Step 2: Switch to prose view
        dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "prose" });

        // Step 3: Toggle beat plan side-by-side after view mode changes
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("canvas:toggle-beat-plan", {
              detail: { enabled: true },
            }),
          );

          // Step 4: Scroll to beat after side-by-side view is enabled
          if (citation.beatIndex !== undefined) {
            setTimeout(() => {
              window.dispatchEvent(
                new CustomEvent("prose:scroll-to-beat", {
                  detail: {
                    beatIndex: citation.beatIndex,
                    propIndex: citation.propIndex,
                  },
                }),
              );
            }, 200);
          }
        }, 100);
      } else {
        // Fallback to plan view if no prose available
        dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "plan" });

        if (citation.beatIndex !== undefined) {
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("plan:scroll-to-beat", {
                detail: { beatIndex: citation.beatIndex },
              }),
            );
          }, 200);
        }
      }
    },
    [state.resolvedEntryKeys, dispatch, getSceneInfo],
  );

  const handleSuggestedQuery = useCallback(
    (suggestedQuery: string) => {
      setQuery(suggestedQuery);
      handleQuery(suggestedQuery);
    },
    [handleQuery],
  );

  return (
    <div className="flex flex-col items-center h-full overflow-y-auto">
      {/* Hero Section */}
      <div
        className={`w-full flex flex-col items-center transition-all duration-500 ${response || isSearching ? "pt-8 pb-6" : "pt-32"}`}
      >
        {/* Logo - Only show when no results */}
        {!response && !isSearching && isLoaded && (
          <div className="w-full flex justify-center mb-16">
            <div className="flex items-center gap-4">
              <Image
                src="/logo.svg"
                alt="InkTide"
                width={64}
                height={64}
                className="opacity-70"
              />
              <h1 className="text-3xl uppercase tracking-[0.3em] text-text-secondary font-light">
                Search
              </h1>
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="w-full flex justify-center px-8">
          <div className="w-full max-w-2xl">
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isSearching) {
                    handleQuery(query);
                  }
                }}
                placeholder="Search your narrative..."
                className="w-full px-6 py-3.5 bg-bg-elevated border border-border rounded-full text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-sky-500/50 transition-all shadow-sm"
                disabled={isSearching}
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {isSearching && searchStage && (
                  <span className="text-xs text-text-dim mr-2">
                    {searchStage}
                  </span>
                )}
                {isSearching && (
                  <div className="w-4 h-4 border-2 border-sky-500/20 border-t-sky-500 rounded-full animate-spin" />
                )}
              </div>
            </div>

            {errorMessage && (
              <div className="mt-3 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400 text-center">
                {errorMessage}
              </div>
            )}
          </div>
        </div>

        {/* Suggested Queries - Only show when no results */}
        {!response && !isSearching && !errorMessage && isLoaded && (
          <div className="w-full max-w-2xl px-8 mt-8">
            <div className="text-xs text-text-dim mb-3">Try searching for:</div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUERIES.map((suggested) => (
                <button
                  key={suggested}
                  onClick={() => handleSuggestedQuery(suggested)}
                  className="px-4 py-2 bg-bg-elevated border border-border rounded-full text-xs text-text-secondary hover:border-sky-500/50 hover:bg-bg-elevated/80 transition-all"
                >
                  {suggested}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Results Section */}
      {(response || streamingAnswer) && (
        <div className="w-full max-w-3xl px-8 pb-16 space-y-8">
          {/* AI Overview */}
          <div className="bg-bg-elevated/50 border-l-2 border-sky-500 pl-6 pr-4 py-5 rounded-r-lg">
            <div className="text-xs text-sky-400 mb-3 font-medium">
              AI Overview
            </div>
            <div className="text-sm leading-relaxed text-text-primary">
              {response ? response.answer : streamingAnswer}
              {!response && streamingAnswer && (
                <span className="inline-block w-0.5 h-4 ml-1 bg-sky-400 animate-pulse" />
              )}
            </div>
          </div>

          {/* Search Results */}
          {response && response.citations.length > 0 && (
            <div>
              {/* Timeline heat curve */}
              {state.currentSearchQuery &&
                (() => {
                  const timeline = showDetailTimeline
                    ? state.currentSearchQuery.detailTimeline
                    : state.currentSearchQuery.sceneTimeline;

                  if (!timeline || timeline.length === 0) return null;

                  // Filter out world commits for visualization (only render scenes)
                  const sceneTimeline = timeline.filter((point) => {
                    const entryId = state.resolvedEntryKeys[point.sceneIndex];
                    return !!state.activeNarrative?.scenes[entryId];
                  });

                  if (sceneTimeline.length === 0) return null;

                  return (
                    <div className="mb-8">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-xs text-text-dim">
                          Activation Timeline
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setShowDetailTimeline(false)}
                            className={`text-[10px] px-2 py-1 rounded transition-colors ${
                              !showDetailTimeline
                                ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                                : "bg-bg-elevated text-text-dim hover:text-text-secondary border border-border"
                            }`}
                          >
                            Scenes
                          </button>
                          <button
                            onClick={() => setShowDetailTimeline(true)}
                            className={`text-[10px] px-2 py-1 rounded transition-colors ${
                              showDetailTimeline
                                ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                                : "bg-bg-elevated text-text-dim hover:text-text-secondary border border-border"
                            }`}
                          >
                            Details
                          </button>
                        </div>
                      </div>

                      {/* Heat curve visualization */}
                      <div className="relative h-16 group/timeline">
                        <div className="absolute inset-0 bg-bg-elevated/30 rounded-lg border border-border">
                          <div className="absolute inset-0 flex items-end">
                            {sceneTimeline.map((point) => {
                              const similarity =
                                "similarity" in point
                                  ? point.similarity
                                  : point.maxSimilarity;

                              // Get scene info for tooltip
                              const sceneId =
                                state.resolvedEntryKeys[point.sceneIndex];
                              const scene =
                                state.activeNarrative?.scenes[sceneId];
                              const sceneSummary = scene?.summary || "";

                              // Get actual scene number (count only scenes up to this point in resolvedKeys)
                              const sceneNumber = state.resolvedEntryKeys
                                .slice(0, point.sceneIndex + 1)
                                .filter(
                                  (id) => state.activeNarrative?.scenes[id],
                                ).length;

                              // Find min/max for normalization (amplify differences)
                              const allSimilarities = sceneTimeline.map((p) =>
                                "similarity" in p
                                  ? p.similarity
                                  : p.maxSimilarity,
                              );
                              const maxSim = Math.max(...allSimilarities);
                              const minSim = Math.min(
                                ...allSimilarities.filter((s) => s > 0),
                              );

                              // Normalize to 0-1 range within actual data range
                              const normalized =
                                maxSim > minSim && similarity > 0
                                  ? (similarity - minSim) / (maxSim - minSim)
                                  : similarity > 0
                                    ? 1
                                    : 0;

                              // Apply exponential scaling (power of 2.5 amplifies differences dramatically)
                              const amplified = Math.pow(normalized, 2.5);

                              // Convert to percentage height (scale to 85% max to leave room at top)
                              const height =
                                similarity > 0
                                  ? Math.max(3, amplified * 85)
                                  : 0;

                              const isHigh = similarity > 0.7;
                              const isMedium =
                                similarity > 0.4 && similarity <= 0.7;

                              return (
                                <div
                                  key={point.sceneIndex}
                                  className="flex-1 h-full flex items-end justify-center px-px relative group/bar"
                                >
                                  <div
                                    className={`w-full rounded-sm transition-all ${
                                      isHigh
                                        ? "bg-sky-400"
                                        : isMedium
                                          ? "bg-sky-500/70"
                                          : "bg-sky-500/50"
                                    } group-hover/bar:brightness-125`}
                                    style={{ height: `${height}%` }}
                                  />
                                  {/* Enhanced hover tooltip */}
                                  {similarity > 0 && (
                                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover/bar:opacity-100 pointer-events-none transition-opacity z-50">
                                      <div className="bg-bg-elevated border border-border rounded-lg px-2.5 py-1.5 shadow-xl w-xs">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] font-semibold text-text-primary whitespace-nowrap">
                                            Scene {sceneNumber}
                                          </span>
                                          <span
                                            className={`text-[10px] font-medium ${
                                              isHigh
                                                ? "text-sky-400"
                                                : isMedium
                                                  ? "text-sky-500"
                                                  : "text-sky-600"
                                            }`}
                                          >
                                            {(similarity * 100).toFixed(0)}%
                                          </span>
                                        </div>
                                        {sceneSummary && (
                                          <div className="text-[9px] text-text-secondary leading-snug mt-1">
                                            {sceneSummary}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

              {/* Result count */}
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs text-text-dim">
                  {response.citations.length} result
                  {response.citations.length !== 1 ? "s" : ""}
                </div>
              </div>

              <div className="space-y-4">
                {response.citations.map((cit) => {
                  const sceneInfo = getSceneInfo(cit.sceneId, cit.beatIndex);
                  const beatPlan = sceneInfo?.plan?.[cit.beatIndex ?? 0];

                  return (
                    <div
                      key={cit.id}
                      className="group cursor-pointer"
                      onClick={() => navigateToCitation(cit)}
                    >
                      <div className="flex items-start gap-4 py-3 px-1 hover:bg-bg-elevated/30 rounded-lg transition-colors">
                        {/* Result number */}
                        <div className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-bg-elevated border border-border text-xs text-text-dim font-medium mt-0.5">
                          {cit.id}
                        </div>

                        <div className="flex-1 min-w-0">
                          {/* Result content */}
                          <div className="text-sm text-text-primary leading-relaxed group-hover:text-sky-300 transition-colors mb-2">
                            {cit.content}
                          </div>

                          {/* Context breadcrumb */}
                          <div className="flex items-center gap-2 text-[10px] text-text-dim/70">
                            {sceneInfo?.arcIndex && (
                              <>
                                <span>Arc {sceneInfo.arcIndex}</span>
                                <span className="opacity-40">›</span>
                              </>
                            )}
                            {sceneInfo?.sceneIndex && (
                              <>
                                <span>Scene {sceneInfo.sceneIndex}</span>
                                {cit.type !== "scene" && (
                                  <span className="opacity-40">›</span>
                                )}
                              </>
                            )}
                            {cit.type !== "scene" && beatPlan && (
                              <>
                                <span>Beat {(cit.beatIndex ?? 0) + 1}</span>
                                <span className="opacity-40">·</span>
                                <span className="opacity-70">
                                  {beatPlan.fn}
                                </span>
                              </>
                            )}
                            <span className="opacity-40">·</span>
                            <span className="text-sky-500/80">
                              {(cit.similarity * 100).toFixed(0)}%
                            </span>
                          </div>

                          {/* Beat prose if available */}
                          {sceneInfo?.beatProse && (
                            <div className="mt-2 text-xs text-text-secondary/60 leading-relaxed line-clamp-2">
                              {sceneInfo.beatProse}
                            </div>
                          )}
                        </div>

                        {/* Navigate icon */}
                        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <svg
                            className="w-4 h-4 text-sky-400"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          >
                            <path d="M5 12h14m-7-7l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
