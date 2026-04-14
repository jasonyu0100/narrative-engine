/**
 * Analysis Prompts — corpus → narrative-state extraction pipeline.
 */

export {
  SCENE_STRUCTURE_SYSTEM,
  buildSceneStructurePrompt,
} from './scene-structure';

export {
  ARC_GROUPING_SYSTEM,
  buildArcGroupingPrompt,
  type ArcGroup,
} from './arcs';

export {
  RECONCILE_ENTITIES_SYSTEM,
  buildReconcileEntitiesPrompt,
} from './reconcile-entities';

export {
  RECONCILE_SEMANTIC_SYSTEM,
  buildReconcileSemanticPrompt,
} from './reconcile-semantic';

export {
  THREADING_SYSTEM,
  buildThreadingPrompt,
} from './threading';
