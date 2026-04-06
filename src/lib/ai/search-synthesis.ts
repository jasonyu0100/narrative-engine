/**
 * AI Search Synthesis - Generate Google-style AI overview from search results
 * Streams synthesized text with inline citations linking to results
 */

import { callGenerateStream } from './api';
import { ANALYSIS_MODEL } from '../constants';
import { logInfo, logError } from '../system-logger';
import type { NarrativeState, SearchResult, SearchSynthesis } from '@/types/narrative';

/**
 * Build search context for LLM synthesis
 */
function buildSearchContext(
  query: string,
  results: SearchResult[],
  topArc: { arcId: string; avgSimilarity: number } | null,
  timeline: Array<{ sceneIndex: number; maxSimilarity: number }>,
  narrative: NarrativeState,
): string {
  let context = `═══ SEARCH QUERY ═══\n"${query}"\n\n`;

  // Results (top 10)
  context += `═══ SEARCH RESULTS ═══\n`;
  const topResults = results.slice(0, 10);
  topResults.forEach((result, idx) => {
    const citationNum = idx + 1;
    context += `[${citationNum}] ${result.type.toUpperCase()} — ${(result.similarity * 100).toFixed(1)}% match\n`;
    context += `    Content: ${result.content}\n`;
    context += `    Context: ${result.context}\n`;
    context += `    Scene: ${result.sceneId}\n`;
    if (result.beatIndex !== undefined) {
      context += `    Beat: ${result.beatIndex + 1}\n`;
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
 * @param results - Search results
 * @param topArc - Top matching arc (if any)
 * @param topScene - Top matching scene (if any)
 * @param timeline - Timeline heatmap data
 * @param onToken - Optional callback for streaming tokens
 * @returns SearchSynthesis with overview text and citation metadata
 */
export async function synthesizeSearchResults(
  narrative: NarrativeState,
  query: string,
  results: SearchResult[],
  topArc: { arcId: string; avgSimilarity: number } | null,
  topScene: { sceneId: string; similarity: number } | null,
  timeline: Array<{ sceneIndex: number; maxSimilarity: number }>,
  onToken?: (token: string) => void,
): Promise<SearchSynthesis> {
  logInfo('Starting search synthesis', {
    source: 'other',
    operation: 'synthesize-search',
    details: { query: query.substring(0, 100), resultCount: results.length },
  });

  // Build context from search results
  const context = buildSearchContext(query, results, topArc, timeline, narrative);

  // Create synthesis prompt - plain text with inline citations
  const prompt = `${context}

You are a narrative analysis assistant. The user has searched for: "${query}"

Based on the search results above, provide a concise 2-3 paragraph synthesis that directly answers the user's search query.

**Guidelines:**
- Use inline citations like [1], [2], [3] when referencing specific results
- Write in a clear, informative style (similar to a Google AI Overview)
- Focus on narrative patterns and connections, not just listing matches
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
      .filter(id => id >= 1 && id <= results.length)
      .map(id => {
        const result = results[id - 1]; // Convert 1-indexed to 0-indexed
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
      overview: `Found ${results.length} results matching "${query}". ${
        topArc
          ? `The arc "${narrative.arcs[topArc.arcId]?.name}" shows the highest relevance. `
          : ''
      }${
        results.length > 0
          ? `Top match: ${results[0].content.substring(0, 100)}...`
          : 'Try refining your search query.'
      }`,
      citations: results.slice(0, 3).map((result, idx) => ({
        id: idx + 1,
        sceneId: result.sceneId,
        type: result.type === 'scene' ? 'scene' : result.type === 'beat' ? 'beat' : 'proposition',
        title: result.content.substring(0, 60),
        similarity: result.similarity,
      })),
    };
  }
}
