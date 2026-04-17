/**
 * Centralized constants for easy tuning across the narrative engine.
 * Grouped by domain — import what you need from '@/lib/constants'.
 */

// ── Analysis & Extraction ────────────────────────────────────────────────────

/** Max concurrent LLM calls during chunk analysis */
export const ANALYSIS_CONCURRENCY = 20;

/** Delay (ms) between launching each call in the initial analysis batch */
export const ANALYSIS_STAGGER_DELAY_MS = 200;


/** Max corpus size (words) accepted for analysis */
export const ANALYSIS_MAX_CORPUS_WORDS = 500_000;

// ── AI Models ───────────────────────────────────────────────────────────────

/** Default LLM model used across all API routes */
export const DEFAULT_MODEL = "google/gemini-2.5-flash";

/** Model for plans and prose (creative writing tasks) */
export const WRITING_MODEL = "google/gemini-3-flash-preview";

/** Model for scoring, reconciliation, and text analysis */
export const ANALYSIS_MODEL = "google/gemini-2.5-flash";

/** Model for scene generation — MCTS, auto mode, manual */
export const GENERATE_MODEL = "google/gemini-2.5-flash";

// ── AI Pricing (per million tokens) ──────────────────────────────────────────

export const MODEL_PRICING: Record<string, { input: number; output: number }> =
  {
    "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
    "google/gemini-3-flash-preview": { input: 0.5, output: 3.0 },
  };

/** Fallback pricing when model is unknown */
export const DEFAULT_PRICING = { input: 0.3, output: 2.5 };

// ── AI Temperature ───────────────────────────────────────────────────────────

/** Temperature for creative generation — scenes, prose, wizard */
export const DEFAULT_TEMPERATURE = 0.8;

/** Temperature for structured extraction — analysis, scoring, reconciliation */
export const ANALYSIS_TEMPERATURE = 0.1;

// ── AI Token Limits ─────────────────────────────────────────────────────────

/** Max output tokens for massive structured output (full branch evaluation, multi-scene generation) */
export const MAX_TOKENS_XLARGE = 128000;

/** Max output tokens for large structured generation (scenes, narratives, analysis) */
export const MAX_TOKENS_LARGE = 64000;

/** Max output tokens for the /api/generate route when no explicit limit is passed */
export const MAX_TOKENS_DEFAULT = 32000;

/** Max output tokens for small focused output (single scene plan, rewrite, profile extraction) */
export const MAX_TOKENS_SMALL = 16000;

// ── AI Timeouts ─────────────────────────────────────────────────────────────

/** Timeout for non-streaming API calls (ms) — 8 minutes */
export const API_TIMEOUT_MS = 8 * 60 * 1000;

/** Timeout for streaming API calls (ms) — 15 minutes (longer for prose generation) */
export const API_STREAM_TIMEOUT_MS = 15 * 60 * 1000;

/** Age threshold (ms) for marking stale pending API logs as timed out — 20 minutes */
export const API_LOG_STALE_THRESHOLD_MS = 20 * 60 * 1000;

// ── AI Reasoning ────────────────────────────────────────────────────────────

/** Default reasoning budget (thinking tokens) applied to all LLM calls.
 *  Corresponds to REASONING_BUDGETS['low'] in narrative.ts.
 *  Story settings can override this per-story. */
export const DEFAULT_REASONING_BUDGET = 2048;

// ── AI Context ───────────────────────────────────────────────────────────────

/** Rolling window size for force computation & normalization */
export const FORCE_WINDOW_SIZE = 10;

// ── Generation ───────────────────────────────────────────────────────────────

/** Concurrent scene plan generation slots (Story modal bulk plan) */
export const PLAN_CONCURRENCY = 10;

/** Concurrent prose generation slots (Story modal bulk write) */
export const PROSE_CONCURRENCY = 10;

/** Concurrent audio generation slots (Story modal bulk audio) */
export const AUDIO_CONCURRENCY = 10;

/** Concurrent prose rewrite slots */
export const REWRITE_CONCURRENCY = 10;

/** Max children per MCTS node */
export const MCTS_MAX_NODE_CHILDREN = 8;

/** Arcs per season before auto-engine manual stop */
export const AUTO_STOP_CYCLE_LENGTH = 25;

// ── Narrative Shape Analysis ─────────────────────────────────────────────────

/** Scenes-per-window divisor for adaptive peak detection radius: max(2, floor(n / N)) */
export const PEAK_WINDOW_SCENES_DIVISOR = 25;

/** Middle band bounds for V-shape trough detection (excludes edge 20% on each side) */
export const SHAPE_TROUGH_BAND_LO = 0.2;
export const SHAPE_TROUGH_BAND_HI = 0.8;

// ── UI: Pagination & Limits ──────────────────────────────────────────────────

/** Items per page in inspector detail panels */
export const INSPECTOR_PAGE_SIZE = 20;

/** Knowledge nodes shown in the WorldGraph per entity */
export const GRAPH_WORLD_LIMIT = 20;

/** Arc count above which ForceAnalytics switches to dense mode */
export const DENSE_ARC_THRESHOLD = 20;

/** Default sliding window size for ForceTimeline */
export const FORCE_TIMELINE_WINDOW_DEFAULT = 100;

/** Scene window for delivery sparklines on key moment cards (slides + report) */
export const MOMENT_SPARKLINE_WINDOW = 50;

// ── Scale Standards ─────────────────────────────────────────────────────────
// Beat → Scene → Arc hierarchy. Analysis is strict; generation is flexible.

/** Words per beat — the atomic unit of prose */
export const WORDS_PER_BEAT = 100;
/** Beats per scene — standard scene size */
export const BEATS_PER_SCENE = 12;
/** Scenes per arc — standard arc length */
export const SCENES_PER_ARC = 4;

/** Derived: words per scene (~1,000) */
export const WORDS_PER_SCENE = WORDS_PER_BEAT * BEATS_PER_SCENE;
/** Derived: beats per 1000 words (10) — for prose profile compatibility */
export const BEATS_PER_KWORD = Math.round(BEATS_PER_SCENE / (WORDS_PER_SCENE / 1000));

// Legacy aliases — used by beat profiles and prose density validation
export const BEAT_DENSITY_MIN = 8;
export const BEAT_DENSITY_MAX = 14;
export const BEAT_DENSITY_DEFAULT = BEATS_PER_KWORD;
export const WORDS_PER_BEAT_MIN = Math.round(1000 / BEAT_DENSITY_MAX);
export const WORDS_PER_BEAT_MAX = Math.round(1000 / BEAT_DENSITY_MIN);
export const WORDS_PER_BEAT_DEFAULT = WORDS_PER_BEAT;

// ── Embeddings & Semantic Search ─────────────────────────────────────────────

/** OpenAI embedding model for semantic search */
export const EMBEDDING_MODEL = 'text-embedding-3-small';

/** Embedding vector dimensions (OpenAI text-embedding-3-small) */
export const EMBEDDING_DIMENSIONS = 1536;

/** Batch size for embedding API calls (texts per request) */
export const EMBEDDING_BATCH_SIZE = 50;

/** Concurrent embedding generation batches */
export const EMBEDDING_CONCURRENCY = 10;

/** Direct scene-summary matches (thematic widener). Small on purpose —
 *  aggregate scene summaries derived from proposition membership already
 *  supply the per-proposition scene context; this pool only catches
 *  thematic queries where propositions genuinely miss. */
export const SEARCH_TOP_K_SCENES = 3;

/** Proposition-level results — the primary RAG signal. Top 10 of the
 *  proposition embedding pool feed the synthesis. */
export const SEARCH_TOP_K_PROPOSITIONS = 10;

/** Minimum cosine similarity threshold for search results (0-1) */
export const SEARCH_SIMILARITY_THRESHOLD = 0.3;

/** Number of candidate plans to generate in plan candidates */
export const PLAN_CANDIDATES_COUNT = 5;

/** Limit for continuity nodes and thread logs per entity in LLM context */
export const ENTITY_LOG_CONTEXT_LIMIT = 25;

// ── Tiered recency zones for narrative context ──────────────────────────────
// Scene history is rendered at progressively lower resolution based on
// distance from the current scene:
//   Near  (0 .. NEAR_RECENCY_ZONE)                 → full delta detail
//   Mid   (NEAR .. NEAR + MID)                     → summary + thread transitions + movements
//   Far   (beyond NEAR + MID)                      → summary + POV/location only

/** Most recent scenes rendered with full delta detail. */
export const NEAR_RECENCY_ZONE = 5;

/** Scenes after NEAR rendered with thread transitions and movements only. */
export const MID_RECENCY_ZONE = 15;
