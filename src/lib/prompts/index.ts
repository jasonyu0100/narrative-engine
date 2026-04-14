/**
 * Centralized Prompts
 *
 * Single source of truth for all LLM prompts, schemas, and prompt builders.
 * Organized by domain for maintainability.
 */

// ── Core Prompts ────────────────────────────────────────────────────────────
export { PROMPT_FORCE_STANDARDS, buildForceStandardsPrompt } from './core/forces';
export { PROMPT_STRUCTURAL_RULES } from './core/structural-rules';
export { PROMPT_DELTAS } from './core/deltas';
export { PROMPT_BEAT_TAXONOMY } from './core/beat-taxonomy';

// ── Entity Prompts ──────────────────────────────────────────────────────────
export { PROMPT_ARTIFACTS } from './entities/artifacts';
export { PROMPT_LOCATIONS } from './entities/locations';
export { PROMPT_ENTITY_INTEGRATION } from './entities/integration';
export { PROMPT_WORLD } from './entities/continuity';

// ── Scene Prompts ───────────────────────────────────────────────────────────
export { PROMPT_POV } from './scenes/pov';
export { PROMPT_SUMMARY_REQUIREMENT } from './scenes/summary';
export {
  promptThreadLifecycle,
  buildThreadHealthPrompt,
  buildCompletedBeatsPrompt,
} from './scenes/thread-lifecycle';
export { buildScenePlanSystemPrompt } from './scenes/plan';
export { buildBeatAnalystSystemPrompt } from './scenes/analyze';
export { buildScenePlanEditSystemPrompt } from './scenes/edit';
export { PROMPT_PROPOSITION_TRANSMISSION } from './scenes/proposition-transmission';
export { buildSceneProseSystemPrompt } from './scenes/prose';
export type { SceneProseSystemPromptArgs } from './scenes/prose';

// ── Schemas ─────────────────────────────────────────────────────────────────
export {
  // Generation schemas (ID-based)
  SCHEMA_THREAD_DELTAS,
  SCHEMA_WORLD_DELTAS,
  SCHEMA_RELATIONSHIP_DELTAS,
  SCHEMA_SYSTEM_DELTAS,
  SCHEMA_ARTIFACT_USAGES,
  SCHEMA_OWNERSHIP_DELTAS,
  SCHEMA_TIE_DELTAS,
  SCHEMA_CHARACTER_MOVEMENTS,
  SCHEMA_EVENTS,
  SCHEMA_SCENE_DELTAS,
  // Analysis schemas (name-based)
  SCHEMA_ANALYSIS_THREAD_DELTAS,
  SCHEMA_ANALYSIS_WORLD_DELTAS,
  SCHEMA_ANALYSIS_RELATIONSHIP_DELTAS,
  SCHEMA_ANALYSIS_ARTIFACT_USAGES,
  SCHEMA_ANALYSIS_OWNERSHIP_DELTAS,
  SCHEMA_ANALYSIS_TIE_DELTAS,
  SCHEMA_ANALYSIS_CHARACTER_MOVEMENTS,
  SCHEMA_ANALYSIS_SYSTEM_DELTAS,
} from './schemas/deltas';

export {
  // Entity creation schemas
  SCHEMA_CHARACTER_CREATION,
  SCHEMA_CHARACTER_WORLD_NODE,
  SCHEMA_LOCATION_CREATION,
  SCHEMA_LOCATION_WORLD_NODE,
  SCHEMA_ARTIFACT_CREATION,
  SCHEMA_ARTIFACT_WORLD_NODE,
  SCHEMA_THREAD_CREATION,
  SCHEMA_RELATIONSHIP_CREATION,
  // Analysis entity schemas
  SCHEMA_ANALYSIS_CHARACTER,
  SCHEMA_ANALYSIS_LOCATION,
  SCHEMA_ANALYSIS_ARTIFACT,
  SCHEMA_ANALYSIS_THREAD,
  SCHEMA_ANALYSIS_RELATIONSHIP,
} from './schemas/entities';

// ── Ingest Prompts ──────────────────────────────────────────────────────────
export {
  buildIngestRulesPrompt,
  buildIngestSystemsPrompt,
  buildIngestProseProfilePrompt,
  buildDeriveProseProfilePrompt,
} from './ingest';

// ── Premise Prompts ─────────────────────────────────────────────────────────
export {
  PREMISE_SYSTEM,
  PREMISE_SUGGEST_PROMPT,
  PHASE_GUIDANCE,
  SCHEMA_PREMISE_QUESTION,
} from './premise';

// ── Prose Prompts ───────────────────────────────────────────────────────────
export { FORMAT_INSTRUCTIONS } from './prose/format-instructions';

// ── Review Prompts ──────────────────────────────────────────────────────────
export {
  buildBranchReviewPrompt,
  buildProseReviewPrompt,
  buildPlanReviewPrompt,
} from './review';

// ── Report Prompts ──────────────────────────────────────────────────────────
export { REPORT_SYSTEM, REPORT_ANALYSIS_PROMPT, REPORT_SECTIONS } from './report';
export type { ReportSectionKey } from './report';

// ── Analysis Prompts ────────────────────────────────────────────────────────
export {
  SCENE_STRUCTURE_SYSTEM,
  buildSceneStructurePrompt,
  ARC_GROUPING_SYSTEM,
  buildArcGroupingPrompt,
  RECONCILE_ENTITIES_SYSTEM,
  buildReconcileEntitiesPrompt,
  RECONCILE_SEMANTIC_SYSTEM,
  buildReconcileSemanticPrompt,
  THREADING_SYSTEM,
  buildThreadingPrompt,
} from './analysis';
