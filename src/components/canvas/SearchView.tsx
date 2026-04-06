'use client';

import { useStore } from '@/lib/store';
import { useState, useCallback, useEffect } from 'react';
import { searchNarrative } from '@/lib/search';
import { synthesizeSearchResults } from '@/lib/ai/search-synthesis';
import { loadSearchState, saveSearchState } from '@/lib/persistence';
import Image from 'next/image';
import { resolveProseForBranch, resolvePlanForBranch } from '@/lib/narrative-utils';

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
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchStage, setSearchStage] = useState<string>('');
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load persisted search state on mount
  useEffect(() => {
    const loadPersistedSearch = async () => {
      const savedSearch = await loadSearchState();
      if (savedSearch && savedSearch.synthesis) {
        setQuery(savedSearch.query);

        // Map saved results to QueryResponse format
        const allResults = savedSearch.results.slice(0, 10).map((res, idx) => ({
          id: idx + 1,
          sceneId: res.sceneId,
          beatIndex: res.beatIndex,
          propIndex: res.propIndex,
          content: res.content.length > 200 ? res.content.substring(0, 197) + '...' : res.content,
          similarity: res.similarity,
        }));

        setResponse({
          question: savedSearch.query,
          answer: savedSearch.synthesis.overview,
          citations: allResults,
        });
      }
      setIsLoaded(true);
    };

    loadPersistedSearch();
  }, []);

  const handleQuery = useCallback(async (question: string) => {
    const narrative = state.activeNarrative;
    const resolvedKeys = state.resolvedEntryKeys;

    if (!narrative || !resolvedKeys || question.trim().length === 0) return;

    setIsSearching(true);
    setSearchStage('Embedding query');
    setErrorMessage(null);
    setResponse(null);
    setStreamingAnswer('');

    try {
      const sceneCount = resolvedKeys.length;

      // Stage 1: Searching
      setSearchStage(`Searching ${sceneCount} scene${sceneCount !== 1 ? 's' : ''}`);
      const result = await searchNarrative(narrative, resolvedKeys, question.trim());

      if (result.results.length > 0) {
        // Stage 2: Found results, generating AI summary
        setSearchStage(`Found ${result.results.length} results — generating summary`);

        const synthesis = await synthesizeSearchResults(
          narrative,
          question.trim(),
          result.results,
          result.topArc,
          result.topScene,
          result.timeline,
          (token) => {
            // Update immediately for responsive streaming
            setStreamingAnswer(prev => {
              if (prev.length === 0) {
                // First token received, we're streaming now
                setSearchStage('');
              }
              return prev + token;
            });
          }
        );

        // Map all search results (top 10) for display, not just cited ones
        const allResults = result.results.slice(0, 10).map((res, idx) => ({
          id: idx + 1,
          sceneId: res.sceneId,
          beatIndex: res.beatIndex,
          propIndex: res.propIndex,
          content: res.content.length > 200 ? res.content.substring(0, 197) + '...' : res.content,
          similarity: res.similarity,
        }));

        const responseData = {
          question: question.trim(),
          answer: synthesis.overview,
          citations: allResults,
        };
        setResponse(responseData);

        // Persist search state
        await saveSearchState({
          query: question.trim(),
          embedding: result.embedding,
          synthesis,
          results: result.results,
          timeline: result.timeline,
          topArc: result.topArc,
          topScene: result.topScene,
          topBeat: result.topBeat,
        });
      } else {
        setErrorMessage('No relevant content found. Try a different question or generate embeddings.');
      }
    } catch (err) {
      setErrorMessage('Query failed. Please try again.');
    } finally {
      setIsSearching(false);
      setSearchStage('');
    }
  }, [state.activeNarrative, state.resolvedEntryKeys]);

  const getSceneInfo = useCallback((sceneId: string, beatIndex?: number) => {
    const narrative = state.activeNarrative;
    if (!narrative || !state.activeBranchId) return null;

    const scene = narrative.scenes[sceneId];
    if (!scene) return null;

    const proseData = resolveProseForBranch(scene, state.activeBranchId, narrative.branches);
    const planData = resolvePlanForBranch(scene, state.activeBranchId, narrative.branches);

    let beatProse: string | null = null;
    if (beatIndex !== undefined && proseData?.beatProseMap) {
      const beatChunk = proseData.beatProseMap.chunks.find(c => c.beatIndex === beatIndex);
      beatProse = beatChunk?.prose || null;
    }

    // Get arc index (1-based)
    const arc = scene.arcId ? narrative.arcs[scene.arcId] : null;
    const arcIndex = arc ? Object.keys(narrative.arcs).indexOf(scene.arcId!) + 1 : null;

    // Get scene index (1-based) from resolved keys
    const sceneIndex = state.resolvedEntryKeys.indexOf(sceneId) + 1;

    return {
      scene,
      prose: proseData?.prose || null,
      beatProse,
      plan: planData?.beats || null,
      arc,
      arcIndex,
      sceneIndex: sceneIndex > 0 ? sceneIndex : null,
    };
  }, [state.activeNarrative, state.activeBranchId, state.resolvedEntryKeys]);

  const navigateToCitation = useCallback((citation: QueryResponse['citations'][0]) => {
    const sceneIndex = state.resolvedEntryKeys.indexOf(citation.sceneId);
    if (sceneIndex < 0) return;

    const sceneInfo = getSceneInfo(citation.sceneId, citation.beatIndex);
    const hasProse = sceneInfo?.prose || sceneInfo?.beatProse;

    // Step 1: Set scene index
    dispatch({ type: 'SET_SCENE_INDEX', index: sceneIndex });

    if (hasProse) {
      // Step 2: Switch to prose view
      dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'prose' });

      // Step 3: Toggle beat plan side-by-side after view mode changes
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('canvas:toggle-beat-plan', { detail: { enabled: true } }));

        // Step 4: Scroll to beat after side-by-side view is enabled
        if (citation.beatIndex !== undefined) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('prose:scroll-to-beat', {
              detail: { beatIndex: citation.beatIndex, propIndex: citation.propIndex },
            }));
          }, 200);
        }
      }, 100);
    } else {
      // Fallback to plan view if no prose available
      dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'plan' });

      if (citation.beatIndex !== undefined) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('plan:scroll-to-beat', {
            detail: { beatIndex: citation.beatIndex },
          }));
        }, 200);
      }
    }
  }, [state.resolvedEntryKeys, dispatch, getSceneInfo]);

  const handleSuggestedQuery = useCallback((suggestedQuery: string) => {
    setQuery(suggestedQuery);
    handleQuery(suggestedQuery);
  }, [handleQuery]);

  return (
    <div className="flex flex-col items-center h-full overflow-y-auto">
      {/* Hero Section */}
      <div className={`w-full flex flex-col items-center transition-all duration-500 ${response || isSearching ? 'pt-8 pb-6' : 'pt-32'}`}>
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
                  if (e.key === 'Enter' && !isSearching) {
                    handleQuery(query);
                  }
                }}
                placeholder="Search your narrative..."
                className="w-full px-6 py-3.5 bg-bg-elevated border border-border rounded-full text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-sky-500/50 transition-all shadow-sm"
                disabled={isSearching}
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {isSearching && searchStage && (
                  <span className="text-xs text-text-dim mr-2">{searchStage}</span>
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
            <div className="text-xs text-sky-400 mb-3 font-medium">AI Overview</div>
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
              <div className="text-xs text-text-dim mb-4">
                {response.citations.length} result{response.citations.length !== 1 ? 's' : ''}
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
                          {/* Context breadcrumb */}
                          <div className="flex items-center gap-2 text-xs mb-2 text-text-dim">
                            {sceneInfo?.arcIndex && (
                              <>
                                <span>Arc {sceneInfo.arcIndex}</span>
                                <span className="opacity-40">›</span>
                              </>
                            )}
                            {sceneInfo?.sceneIndex && (
                              <>
                                <span>Scene {sceneInfo.sceneIndex}</span>
                                <span className="opacity-40">›</span>
                              </>
                            )}
                            {beatPlan && (
                              <>
                                <span>Beat {(cit.beatIndex ?? 0) + 1}</span>
                                <span className="opacity-40">·</span>
                                <span className="opacity-70">{beatPlan.fn}</span>
                              </>
                            )}
                            <span className="opacity-40">·</span>
                            <span className="text-sky-500/90">{(cit.similarity * 100).toFixed(0)}%</span>
                          </div>

                          {/* Result content */}
                          <div className="text-sm text-text-primary leading-relaxed group-hover:text-sky-300 transition-colors">
                            {cit.content}
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
                          <svg className="w-4 h-4 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
