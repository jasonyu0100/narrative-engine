/**
 * Centralized constants for easy tuning across the narrative engine.
 * Grouped by domain — import what you need from '@/lib/constants'.
 */

// ── Analysis & Extraction ────────────────────────────────────────────────────

/** Max concurrent LLM calls during chunk analysis */
export const ANALYSIS_CONCURRENCY = 20;

/** Delay (ms) between launching each call in the initial analysis batch */
export const ANALYSIS_STAGGER_DELAY_MS = 200;

/** Max auto-retries for parse/type errors during chunk analysis */
export const ANALYSIS_MAX_CHUNK_RETRIES = 3;

/** Target number of sections per analysis chunk */
export const ANALYSIS_TARGET_SECTIONS_PER_CHUNK = 12;

/** Target word count per analysis chunk */
export const ANALYSIS_TARGET_CHUNK_WORDS = 4000;

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
export const GRAPH_CONTINUITY_LIMIT = 20;

/** Arc count above which ForceAnalytics switches to dense mode */
export const DENSE_ARC_THRESHOLD = 20;

/** Default sliding window size for home-page ForceCharts */
export const FORCE_CHARTS_WINDOW_DEFAULT = 100;

/** Scene window for delivery sparklines on key moment cards (slides + report) */
export const MOMENT_SPARKLINE_WINDOW = 50;

/** Max recent continuity nodes shown per entity in sceneContext */
export const SCENE_CONTEXT_RECENT_CONTINUITY = 25;
