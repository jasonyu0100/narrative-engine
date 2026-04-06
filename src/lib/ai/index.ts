// Context builders
export { narrativeContext, narrativeContext as branchContext, sceneContext, outlineContext, worldContext, deriveLogicRules, logicContext } from './context';

// Scene generation
export { generateScenes, generateArcStepwise, generateScenePlan, rewriteScenePlan, generateSceneProse } from './scenes';
export type { ArcPlan, GenerateStepwiseOptions } from './scenes';

// World building & direction
export { suggestArcDirection, suggestAutoDirection, suggestWorldExpansion, expandWorld, generateNarrative, computeWorldMetrics } from './world';
export type { WorldExpansion, WorldExpansionSize, WorldExpansionStrategy, WorldMetrics, DirectionSuggestion } from './world';

// Prose rewriting
export { rewriteSceneProse } from './prose';

// Premise
export { generatePremiseQuestion, buildPremiseText, suggestPremise } from './premise';
export type { PremiseEntity, PremiseEdge, PremiseDecision, PremiseQuestion, PremiseQuestionResult } from './premise';

// Review & course correction
export { reviewBranch, reviewProseQuality, reviewPlanQuality, refreshDirection } from './review';
