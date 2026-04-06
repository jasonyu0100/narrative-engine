/**
 * AI Search Synthesis - Generate Google-style AI overview from search results
 * Streams synthesized text with inline citations linking to results
 */

import { callGenerateStream } from './api';
import { ANALYSIS_MODEL } from '../constants';
import { logInfo, logError } from '../system-logger';
import type { NarrativeState, SearchResult, SearchSynthesis } from '@/types/narrative';

/**
 * Build search context for LLM synthesis with dual-level architecture
 */
function buildSearchContext(
  query: string,
  combinedResults: SearchResult[],
  sceneCount: number,
  detailCount: number,
  topArc: { arcId: string; avgSimilarity: number } | null,
  timeline: Array<{ sceneIndex: number; maxSimilarity: number }>,
  narrative: NarrativeState,
): string {
  let context = `═══ SEARCH QUERY ═══\n"${query}"\n\n`;

  // Combined results sorted by similarity (mix of scenes and details)
  context += `═══ SEARCH RESULTS (${sceneCount} scene summaries + ${detailCount} detail facts, top ${combinedResults.length} by similarity) ═══\n`;
  combinedResults.forEach((result, idx) => {
    const citationNum = idx + 1;
    if (result.type === 'scene') {
      context += `[${citationNum}] SCENE SUMMARY — ${(result.similarity * 100).toFixed(1)}% match\n`;
      context += `    Summary: ${result.content}\n`;
      context += `    Scene: ${result.sceneId}\n`;
    } else {
      context += `[${citationNum}] ${result.type.toUpperCase()} — ${(result.similarity * 100).toFixed(1)}% match\n`;
      context += `    Content: ${result.content}\n`;
      context += `    Context: ${result.context}\n`;
      context += `    Scene: ${result.sceneId}\n`;
      if (result.beatIndex !== undefined) {
        context += `    Beat: ${result.beatIndex + 1}\n`;
      }
    }
    context += `\n`;
  });

  // Arc relevance
  if (topArc) {
    const arc = narrative.arcs[topArc.arcId];
    if (arc) {
      context += `═══ TOP ARC ═══\n`;
      context += `Arc: "${arc.name}"\n`;
      context += `Average relevance: ${(topArc.avgSimilarity * 100).toFixed(1)}%\n`;
      context += `Scenes: ${arc.sceneIds.length}\n\n`;
    }
  }

  // Timeline pattern
  if (timeline.length > 0) {
    context += `═══ TIMELINE PATTERN ═══\n`;
    const peaks = timeline
      .filter(p => p.maxSimilarity > 0.7)
      .sort((a, b) => b.maxSimilarity - a.maxSimilarity)
      .slice(0, 5);

    if (peaks.length > 0) {
      context += `Peak matches at scenes: ${peaks.map(p => `${p.sceneIndex + 1} (${(p.maxSimilarity * 100).toFixed(0)}%)`).join(', ')}\n`;
    }

    const highRelevanceCount = timeline.filter(p => p.maxSimilarity > 0.6).length;
    const totalScenes = timeline.length;
    context += `High-relevance scenes: ${highRelevanceCount} out of ${totalScenes}\n`;
  }

  return context;
}

/**
 * Synthesize search results into an AI overview with inline citations
 *
 * @param narrative - Current narrative state
 * @param query - Search query text
 * @param sceneResults - Scene-level search results (high-level context)
 * @param detailResults - Detail-level search results (specific facts)
 * @param topArc - Top matching arc (if any)
 * @param topScene - Top matching scene (if any)
 * @param timeline - Timeline heatmap data
 * @param onToken - Optional callback for streaming tokens
 * @returns SearchSynthesis with overview text and citation metadata
 */
export async function synthesizeSearchResults(
  narrative: NarrativeState,
  query: string,
  sceneResults: SearchResult[],
  detailResults: SearchResult[],
  topArc: { arcId: string; avgSimilarity: number } | null,
  _topScene: { sceneId: string; similarity: number } | null,
  timeline: Array<{ sceneIndex: number; maxSimilarity: number }>,
  onToken?: (token: string) => void,
): Promise<SearchSynthesis> {
  // Guaranteed representation: take top 5 summaries + top 10 details, then sort by similarity
  const topScenes = (sceneResults ?? []).slice(0, 5);
  const topDetails = (detailResults ?? []).slice(0, 10);

  // Combine and sort by similarity for final ordering
  const topResults = [...topScenes, ...topDetails].sort((a, b) => b.similarity - a.similarity);

  // Count breakdown
  const sceneCount = topResults.filter(r => r.type === 'scene').length;
  const beatCount = topResults.filter(r => r.type === 'beat').length;
  const propCount = topResults.filter(r => r.type === 'proposition').length;
  const detailCount = beatCount + propCount;

  logInfo('Starting search synthesis', {
    source: 'other',
    operation: 'synthesize-search',
    details: {
      query: query.substring(0, 100),
      scenePoolSize: sceneResults?.length ?? 0,
      detailPoolSize: detailResults?.length ?? 0,
      topResultsCount: topResults.length,
      sceneCount,
      detailCount,
    },
  });

  // Build context from combined top results
  const context = buildSearchContext(query, topResults, sceneCount, detailCount, topArc, timeline, narrative);

  // Count unique scenes across top results
  const uniqueScenes = new Set(topResults.map(r => r.sceneId)).size;

  // Detect if this is a thematic pattern query or specific content query
  const isThematicQuery = sceneCount > detailCount || uniqueScenes > topResults.length * 0.6;
  const isLocalizedContent = uniqueScenes <= 3 && propCount > sceneCount;

  // Create synthesis prompt - plain text with inline citations
  const prompt = `${context}

You are a narrative analysis assistant. The user has searched for: "${query}"

Based on the search results above, provide a concise 2-3 paragraph synthesis that directly answers the user's search query.

**Dual-Level Search Architecture:**
The search retrieves from two pools (${sceneResults?.length ?? 0} scene summaries + ${detailResults?.length ?? 0} detail facts), then combines and sorts by similarity.
Results shown: top ${topResults.length} by activation strength (${sceneCount} scenes + ${detailCount} details competing for mindshare).

**Result Composition:**
- Scene summaries: ${sceneCount} (high-level thematic context)
- Detail facts: ${detailCount} (${beatCount} beats + ${propCount} propositions - specific moments)
- Unique scenes represented: ${uniqueScenes} out of ${topResults.length} results
${isThematicQuery ? '- Pattern detected: THEMATIC (results span multiple scenes, query is abstract)' : ''}
${isLocalizedContent ? '- Pattern detected: LOCALIZED (results cluster in few scenes, query is specific)' : ''}

**Guidelines:**
- Intelligently balance high-level themes (scene summaries) AND specific details (propositions/beats) based on the query
- Scene summaries provide thematic context across the narrative - use them to identify patterns
- Detail facts ground claims with specific moments - use them for concrete evidence
- Detect whether the user wants high-level thematic analysis or specific details, and bias accordingly
- Only cite the most relevant results using inline citations like [1], [2], [3]
- You don't need to reference every result—focus on the strongest matches
- Write in a clear, informative style (similar to a Google AI Overview)
${isThematicQuery ? '- This appears to be a thematic query - prioritize scene summaries to emphasize patterns ACROSS scenes' : ''}
${isLocalizedContent ? '- This appears to be a specific content query - prioritize detail facts for concrete evidence' : ''}
- If the query asks about patterns but results are localized, acknowledge that the content is concentrated
- If the query asks for specific content but results are scattered, note which scenes are most relevant
- Identify which arcs and scenes are most relevant
- Note timeline patterns if applicable

Write your response as plain text with inline citations.`;

  // Stream the synthesis as plain text
  let accumulatedText = '';

  try {
    await callGenerateStream(
      prompt,
      'You are a narrative analysis assistant. Provide concise, accurate synthesis of search results with inline citations.',
      (token) => {
        accumulatedText += token;
        // Stream clean text to the UI
        if (onToken) {
          onToken(token);
        }
      },
      2048, // maxTokens
      'synthesizeSearchResults', // caller
      ANALYSIS_MODEL, // model
      undefined, // reasoningBudget
      undefined, // onReasoning
      0.3, // temperature
    );

    // Extract citation numbers from the text using regex
    const citationMatches = accumulatedText.match(/\[(\d+)\]/g) || [];
    const citationIds = Array.from(new Set(
      citationMatches.map(match => parseInt(match.replace(/\[|\]/g, ''), 10))
    )).sort((a, b) => a - b);

    // Map citation IDs to result metadata
    const citations = citationIds
      .filter(id => id >= 1 && id <= topResults.length)
      .map(id => {
        const result = topResults[id - 1]; // Convert 1-indexed to 0-indexed
        return {
          id,
          sceneId: result.sceneId,
          type: (result.type === 'scene' ? 'scene'
            : result.type === 'beat' ? 'beat'
            : result.type === 'proposition' ? 'proposition'
            : 'scene') as 'arc' | 'scene' | 'beat' | 'proposition',
          title: result.content.length > 60
            ? result.content.substring(0, 57) + '...'
            : result.content,
          similarity: result.similarity,
        };
      });

    const overview = accumulatedText.trim();

    logInfo('Search synthesis completed', {
      source: 'other',
      operation: 'synthesize-search-complete',
      details: {
        query: query.substring(0, 100),
        overviewLength: overview.length,
        citationCount: citations.length,
      },
    });

    return {
      overview,
      citations,
    };

  } catch (error) {
    logError('Search synthesis failed', error, {
      source: 'other',
      operation: 'synthesize-search-error',
      details: { query: query.substring(0, 100) },
    });

    // Return fallback synthesis
    return {
      overview: `Found ${topResults.length} results matching "${query}". ${
        topArc
          ? `The arc "${narrative.arcs[topArc.arcId]?.name}" shows the highest relevance. `
          : ''
      }${
        topResults.length > 0
          ? `Top match: ${topResults[0].content.substring(0, 100)}...`
          : 'Try refining your search query.'
      }`,
      citations: topResults.slice(0, 3).map((result, idx) => ({
        id: idx + 1,
        sceneId: result.sceneId,
        type: result.type === 'scene' ? 'scene' : result.type === 'beat' ? 'beat' : 'proposition',
        title: result.content.substring(0, 60),
        similarity: result.similarity,
      })),
    };
  }
}
