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

// ── AI Model ────────────────────────────────────────────────────────────────

/** Default LLM model used across all API routes */
export const DEFAULT_MODEL = 'google/gemini-2.5-flash';

// ── AI Context ───────────────────────────────────────────────────────────────

/** Max scenes included in branchContext — defines the time horizon.
 *  Only entities referenced within this window appear in context,
 *  and only knowledge nodes added during this window are included. */
export const MAX_CONTEXT_SCENES = 100;

/** Rolling window size for force computation & normalization */
export const FORCE_WINDOW_SIZE = 10;

// ── Generation ───────────────────────────────────────────────────────────────

/** Concurrent scene plan generation slots (Story modal bulk plan) */
export const PLAN_CONCURRENCY = 10;

/** Concurrent prose generation slots (Story modal bulk write) */
export const PROSE_CONCURRENCY = 10;

/** Concurrent prose rewrite slots */
export const REWRITE_CONCURRENCY = 10;

/** Max children per MCTS node */
export const MCTS_MAX_NODE_CHILDREN = 8;

/** Arcs per season before auto-engine manual stop */
export const AUTO_STOP_CYCLE_LENGTH = 25;

// ── UI: Pagination & Limits ──────────────────────────────────────────────────

/** Items per page in inspector detail panels */
export const INSPECTOR_PAGE_SIZE = 20;

/** Knowledge nodes shown in the WorldGraph per entity */
export const GRAPH_KNOWLEDGE_LIMIT = 20;

/** Arc count above which ForceTracker switches to dense mode */
export const DENSE_ARC_THRESHOLD = 20;

/** Default sliding window size for home-page ForceCharts */
export const FORCE_CHARTS_WINDOW_DEFAULT = 100;
