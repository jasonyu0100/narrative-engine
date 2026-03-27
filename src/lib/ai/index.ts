// Context builders
export { narrativeContext, narrativeContext as branchContext, sceneContext, outlineContext, worldContext } from './context';

// Scene generation
export { generateScenes, generateScenePlan, rewriteScenePlan, generateSceneProse } from './scenes';

// World building & direction
export { suggestArcDirection, suggestAutoDirection, suggestWorldExpansion, expandWorld, generateNarrative, computeWorldMetrics } from './world';
export type { WorldExpansion, WorldExpansionSize, WorldExpansionStrategy, WorldMetrics, DirectionSuggestion } from './world';

// Prose scoring & rewriting
export { scoreSceneProse, rewriteSceneProse, scoreAndRewriteSceneProse, generateChartAnnotations } from './prose';
export type { ChartAnnotation } from './prose';

// Prose alignment
export { runAlignment, buildContinuityPlan, buildFixAnalysis, runFixWindows } from './alignment';
export type { AlignmentProgress, AlignmentPhase, FixResult } from './alignment';

// Premise
export { generatePremiseQuestion, buildPremiseText } from './premise';
export type { PremiseEntity, PremiseEdge, PremiseDecision, PremiseQuestion, PremiseQuestionResult } from './premise';
