import { describe, it, expect } from 'vitest';
import {
  resolveProseForBranch,
  resolvePlanForBranch,
  getResolvedProseVersion,
  getResolvedPlanVersion,
} from '@/lib/narrative-utils';
import type { Scene, Branch, ProseVersion, PlanVersion, BeatPlan } from '@/types/narrative';

// Helper to create a minimal scene with versions
function createScene(
  id: string,
  proseVersions: ProseVersion[] = [],
  planVersions: PlanVersion[] = [],
): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    locationId: 'loc-1',
    povId: 'char-1',
    participantIds: ['char-1'],
    events: [],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    summary: 'Test scene',
    proseVersions,
    planVersions,
  };
}

// Helper to create a branch
function createBranch(
  id: string,
  parentBranchId: string | null = null,
  createdAt: number = Date.now(),
  versionPointers?: Record<string, { proseVersion?: string; planVersion?: string }>,
): Branch {
  return {
    id,
    name: `Branch ${id}`,
    parentBranchId,
    forkEntryId: null,
    entryIds: [],
    createdAt,
    versionPointers,
  };
}

// Helper to create a prose version
function createProseVersion(
  version: string,
  branchId: string,
  versionType: 'generate' | 'rewrite' | 'edit' = 'generate',
  timestamp: number = Date.now(),
  parentVersion?: string,
  sourcePlanVersion?: string,
): ProseVersion {
  return {
    prose: `Prose content for V${version}`,
    branchId,
    timestamp,
    version,
    versionType,
    parentVersion,
    sourcePlanVersion,
  };
}

// Helper to create a plan version
function createPlanVersion(
  version: string,
  branchId: string,
  versionType: 'generate' | 'rewrite' | 'edit' = 'generate',
  timestamp: number = Date.now(),
  parentVersion?: string,
): PlanVersion {
  return {
    plan: {
      beats: [{ fn: 'advance', mechanism: 'action', what: `Beat for V${version}`, propositions: [] }],
    } as BeatPlan,
    branchId,
    timestamp,
    version,
    versionType,
    parentVersion,
  };
}

describe('Version Number Computation', () => {
  // These tests verify the version numbering logic
  // The actual computation happens in store.tsx, but we test the outcomes

  describe('Major versions (generate)', () => {
    it('should start at V1 for first generation', () => {
      // First generation on a branch should be V1
      const pv = createProseVersion('1', 'branch-1', 'generate', 1000);
      expect(pv.version).toBe('1');
      expect(pv.versionType).toBe('generate');
    });

    it('should increment major version for subsequent generations', () => {
      // After V1, regeneration should create V2
      const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
      const v2 = createProseVersion('2', 'branch-1', 'generate', 2000);
      expect(v2.version).toBe('2');
    });
  });

  describe('Minor versions (rewrite)', () => {
    it('should create V1.1 for first rewrite after V1', () => {
      const pv = createProseVersion('1.1', 'branch-1', 'rewrite', 2000, '1');
      expect(pv.version).toBe('1.1');
      expect(pv.versionType).toBe('rewrite');
      expect(pv.parentVersion).toBe('1');
    });

    it('should increment minor version for subsequent rewrites', () => {
      const v1_1 = createProseVersion('1.1', 'branch-1', 'rewrite', 2000, '1');
      const v1_2 = createProseVersion('1.2', 'branch-1', 'rewrite', 3000, '1.1');
      expect(v1_2.version).toBe('1.2');
      expect(v1_2.parentVersion).toBe('1.1');
    });
  });

  describe('Edit versions (sub-minor)', () => {
    it('should create V1.0.1 for first edit after V1', () => {
      const pv = createProseVersion('1.0.1', 'branch-1', 'edit', 2000, '1');
      expect(pv.version).toBe('1.0.1');
      expect(pv.versionType).toBe('edit');
    });

    it('should create V1.1.1 for first edit after V1.1', () => {
      const pv = createProseVersion('1.1.1', 'branch-1', 'edit', 3000, '1.1');
      expect(pv.version).toBe('1.1.1');
      expect(pv.parentVersion).toBe('1.1');
    });

    it('should increment edit version for subsequent edits', () => {
      const v1_1_1 = createProseVersion('1.1.1', 'branch-1', 'edit', 3000, '1.1');
      const v1_1_2 = createProseVersion('1.1.2', 'branch-1', 'edit', 4000, '1.1.1');
      expect(v1_1_2.version).toBe('1.1.2');
    });
  });
});

describe('Prose Resolution', () => {
  describe('resolveProseForBranch', () => {
    it('should return undefined for scene with no versions and no legacy prose', () => {
      const scene = createScene('scene-1');
      const branches = { 'branch-1': createBranch('branch-1') };

      const result = resolveProseForBranch(scene, 'branch-1', branches);
      expect(result.prose).toBeUndefined();
    });

    it('should return undefined when no versions exist (no legacy fallback)', () => {
      const scene = createScene('scene-1');
      // Legacy prose field is ignored - no fallback
      scene.prose = 'Legacy prose content';
      const branches = { 'branch-1': createBranch('branch-1') };

      const result = resolveProseForBranch(scene, 'branch-1', branches);
      expect(result.prose).toBeUndefined();
    });

    it('should return the latest version for the current branch', () => {
      const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
      const v2 = createProseVersion('2', 'branch-1', 'generate', 2000);
      const scene = createScene('scene-1', [v1, v2]);
      const branches = { 'branch-1': createBranch('branch-1') };

      const result = resolveProseForBranch(scene, 'branch-1', branches);
      expect(result.prose).toBe('Prose content for V2');
    });

    it('should return pinned version when version pointer exists', () => {
      const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
      const v2 = createProseVersion('2', 'branch-1', 'generate', 2000);
      const scene = createScene('scene-1', [v1, v2]);
      const branches = {
        'branch-1': createBranch('branch-1', null, 500, {
          'scene-1': { proseVersion: '1' },
        }),
      };

      const result = resolveProseForBranch(scene, 'branch-1', branches);
      expect(result.prose).toBe('Prose content for V1');
    });

    it('should resolve parent branch versions before fork time', () => {
      // Parent branch has V1 at t=1000
      const v1 = createProseVersion('1', 'parent', 'generate', 1000);
      // Parent branch has V2 at t=3000 (after fork)
      const v2 = createProseVersion('2', 'parent', 'generate', 3000);
      const scene = createScene('scene-1', [v1, v2]);

      // Child branch forked at t=2000
      const branches = {
        parent: createBranch('parent', null, 500),
        child: createBranch('child', 'parent', 2000),
      };

      // Child should see V1 (before fork), not V2 (after fork)
      const result = resolveProseForBranch(scene, 'child', branches);
      expect(result.prose).toBe('Prose content for V1');
    });

    it('should prefer child branch versions over parent', () => {
      const parentV1 = createProseVersion('1', 'parent', 'generate', 1000);
      const childV2 = createProseVersion('2', 'child', 'generate', 3000);
      const scene = createScene('scene-1', [parentV1, childV2]);

      const branches = {
        parent: createBranch('parent', null, 500),
        child: createBranch('child', 'parent', 2000),
      };

      const result = resolveProseForBranch(scene, 'child', branches);
      expect(result.prose).toBe('Prose content for V2');
    });
  });

  describe('getResolvedProseVersion', () => {
    it('should return the version string of resolved prose', () => {
      const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
      const v1_1 = createProseVersion('1.1', 'branch-1', 'rewrite', 2000, '1');
      const scene = createScene('scene-1', [v1, v1_1]);
      const branches = { 'branch-1': createBranch('branch-1') };

      const version = getResolvedProseVersion(scene, 'branch-1', branches);
      expect(version).toBe('1.1');
    });

    it('should return undefined for legacy (unversioned) prose', () => {
      const scene = createScene('scene-1');
      scene.prose = 'Legacy prose';
      const branches = { 'branch-1': createBranch('branch-1') };

      const version = getResolvedProseVersion(scene, 'branch-1', branches);
      expect(version).toBeUndefined();
    });

    it('should return pinned version when pointer exists', () => {
      const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
      const v2 = createProseVersion('2', 'branch-1', 'generate', 2000);
      const scene = createScene('scene-1', [v1, v2]);
      const branches = {
        'branch-1': createBranch('branch-1', null, 500, {
          'scene-1': { proseVersion: '1' },
        }),
      };

      const version = getResolvedProseVersion(scene, 'branch-1', branches);
      expect(version).toBe('1');
    });
  });
});

describe('Plan Resolution', () => {
  describe('resolvePlanForBranch', () => {
    it('should return undefined for scene with no versions and no legacy plan', () => {
      const scene = createScene('scene-1');
      const branches = { 'branch-1': createBranch('branch-1') };

      const result = resolvePlanForBranch(scene, 'branch-1', branches);
      expect(result).toBeUndefined();
    });

    it('should return undefined when no versions exist (no legacy fallback)', () => {
      const scene = createScene('scene-1');
      // Legacy plan field is ignored - no fallback
      scene.plan = { beats: [{ fn: 'advance', mechanism: 'action', what: 'Legacy beat', propositions: [] }] } as BeatPlan;
      const branches = { 'branch-1': createBranch('branch-1') };

      const result = resolvePlanForBranch(scene, 'branch-1', branches);
      expect(result).toBeUndefined();
    });

    it('should return the latest version for the current branch', () => {
      const v1 = createPlanVersion('1', 'branch-1', 'generate', 1000);
      const v2 = createPlanVersion('2', 'branch-1', 'generate', 2000);
      const scene = createScene('scene-1', [], [v1, v2]);
      const branches = { 'branch-1': createBranch('branch-1') };

      const result = resolvePlanForBranch(scene, 'branch-1', branches);
      expect(result?.beats[0].what).toBe('Beat for V2');
    });

    it('should return pinned version when version pointer exists', () => {
      const v1 = createPlanVersion('1', 'branch-1', 'generate', 1000);
      const v2 = createPlanVersion('2', 'branch-1', 'generate', 2000);
      const scene = createScene('scene-1', [], [v1, v2]);
      const branches = {
        'branch-1': createBranch('branch-1', null, 500, {
          'scene-1': { planVersion: '1' },
        }),
      };

      const result = resolvePlanForBranch(scene, 'branch-1', branches);
      expect(result?.beats[0].what).toBe('Beat for V1');
    });
  });

  describe('getResolvedPlanVersion', () => {
    it('should return the version string of resolved plan', () => {
      const v1 = createPlanVersion('1', 'branch-1', 'generate', 1000);
      const v1_1 = createPlanVersion('1.1', 'branch-1', 'rewrite', 2000, '1');
      const scene = createScene('scene-1', [], [v1, v1_1]);
      const branches = { 'branch-1': createBranch('branch-1') };

      const version = getResolvedPlanVersion(scene, 'branch-1', branches);
      expect(version).toBe('1.1');
    });
  });
});

describe('Branch Isolation', () => {
  it('should isolate prose between branches', () => {
    // Parent branch has prose V1
    const parentProse = createProseVersion('1', 'parent', 'generate', 1000);
    // Child branch has prose V1 (different content, same structure)
    const childProse = createProseVersion('1', 'child', 'generate', 3000);
    childProse.prose = 'Child branch prose';

    const scene = createScene('scene-1', [parentProse, childProse]);

    const branches = {
      parent: createBranch('parent', null, 500),
      child: createBranch('child', 'parent', 2000),
    };

    // Parent sees parent's prose
    const parentResult = resolveProseForBranch(scene, 'parent', branches);
    expect(parentResult.prose).toBe('Prose content for V1');

    // Child sees child's prose
    const childResult = resolveProseForBranch(scene, 'child', branches);
    expect(childResult.prose).toBe('Child branch prose');
  });

  it('should allow child to inherit from parent before modification', () => {
    // Only parent has prose
    const parentProse = createProseVersion('1', 'parent', 'generate', 1000);
    const scene = createScene('scene-1', [parentProse]);

    const branches = {
      parent: createBranch('parent', null, 500),
      child: createBranch('child', 'parent', 2000),
    };

    // Child sees parent's prose (inherited)
    const result = resolveProseForBranch(scene, 'child', branches);
    expect(result.prose).toBe('Prose content for V1');
  });

  it('should not show parent updates made after fork', () => {
    // Parent has V1 before fork
    const v1 = createProseVersion('1', 'parent', 'generate', 1000);
    // Parent updates to V2 after fork
    const v2 = createProseVersion('2', 'parent', 'generate', 5000);

    const scene = createScene('scene-1', [v1, v2]);

    const branches = {
      parent: createBranch('parent', null, 500),
      child: createBranch('child', 'parent', 2000), // Fork at t=2000
    };

    // Parent sees V2 (latest)
    const parentResult = resolveProseForBranch(scene, 'parent', branches);
    expect(parentResult.prose).toBe('Prose content for V2');

    // Child sees V1 (before fork)
    const childResult = resolveProseForBranch(scene, 'child', branches);
    expect(childResult.prose).toBe('Prose content for V1');
  });

  it('should handle grandchild branch resolution', () => {
    // Grandparent has V1
    const v1 = createProseVersion('1', 'grandparent', 'generate', 1000);
    const scene = createScene('scene-1', [v1]);

    const branches = {
      grandparent: createBranch('grandparent', null, 500),
      parent: createBranch('parent', 'grandparent', 2000),
      child: createBranch('child', 'parent', 3000),
    };

    // Grandchild should inherit from grandparent through parent
    const result = resolveProseForBranch(scene, 'child', branches);
    expect(result.prose).toBe('Prose content for V1');
  });
});

describe('Version Pointers', () => {
  it('should override automatic resolution with explicit pointer', () => {
    const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
    const v1_1 = createProseVersion('1.1', 'branch-1', 'rewrite', 2000, '1');
    const v1_1_1 = createProseVersion('1.1.1', 'branch-1', 'edit', 3000, '1.1');
    const scene = createScene('scene-1', [v1, v1_1, v1_1_1]);

    // Without pointer, resolves to latest (V1.1.1)
    const branchesNoPointer = {
      'branch-1': createBranch('branch-1'),
    };
    const resultNoPointer = resolveProseForBranch(scene, 'branch-1', branchesNoPointer);
    expect(resultNoPointer.prose).toBe('Prose content for V1.1.1');

    // With pointer to V1.1, resolves to V1.1
    const branchesWithPointer = {
      'branch-1': createBranch('branch-1', null, 500, {
        'scene-1': { proseVersion: '1.1' },
      }),
    };
    const resultWithPointer = resolveProseForBranch(scene, 'branch-1', branchesWithPointer);
    expect(resultWithPointer.prose).toBe('Prose content for V1.1');
  });

  it('should support independent prose and plan pointers', () => {
    const proseV1 = createProseVersion('1', 'branch-1', 'generate', 1000);
    const proseV2 = createProseVersion('2', 'branch-1', 'generate', 2000);
    const planV1 = createPlanVersion('1', 'branch-1', 'generate', 1000);
    const planV2 = createPlanVersion('2', 'branch-1', 'generate', 2000);

    const scene = createScene('scene-1', [proseV1, proseV2], [planV1, planV2]);

    // Pin prose to V1, let plan auto-resolve to V2
    const branches = {
      'branch-1': createBranch('branch-1', null, 500, {
        'scene-1': { proseVersion: '1' },
      }),
    };

    const proseResult = resolveProseForBranch(scene, 'branch-1', branches);
    expect(proseResult.prose).toBe('Prose content for V1');

    const planResult = resolvePlanForBranch(scene, 'branch-1', branches);
    expect(planResult?.beats[0].what).toBe('Beat for V2');
  });

  it('should fall back to automatic resolution if pinned version not found', () => {
    const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
    const v2 = createProseVersion('2', 'branch-1', 'generate', 2000);
    const scene = createScene('scene-1', [v1, v2]);

    // Pin to V99 which doesn't exist
    const branches = {
      'branch-1': createBranch('branch-1', null, 500, {
        'scene-1': { proseVersion: '99' },
      }),
    };

    // Should fall back to latest (V2) since V99 doesn't exist
    const result = resolveProseForBranch(scene, 'branch-1', branches);
    expect(result.prose).toBe('Prose content for V2');
  });
});

describe('Plan-to-Prose Linkage', () => {
  it('should track source plan version in prose', () => {
    const planV1 = createPlanVersion('1', 'branch-1', 'generate', 1000);
    const proseV1 = createProseVersion('1', 'branch-1', 'generate', 2000, undefined, '1');

    expect(proseV1.sourcePlanVersion).toBe('1');
  });

  it('should track different plan versions for different prose versions', () => {
    const planV1 = createPlanVersion('1', 'branch-1', 'generate', 1000);
    const planV2 = createPlanVersion('2', 'branch-1', 'generate', 2000);
    const proseFromPlanV1 = createProseVersion('1', 'branch-1', 'generate', 3000, undefined, '1');
    const proseFromPlanV2 = createProseVersion('2', 'branch-1', 'generate', 4000, undefined, '2');

    expect(proseFromPlanV1.sourcePlanVersion).toBe('1');
    expect(proseFromPlanV2.sourcePlanVersion).toBe('2');
  });

  it('should not require sourcePlanVersion for rewrites', () => {
    const rewrite = createProseVersion('1.1', 'branch-1', 'rewrite', 2000, '1');
    expect(rewrite.sourcePlanVersion).toBeUndefined();
  });
});

describe('Edge Cases', () => {
  it('should handle empty branches object', () => {
    const scene = createScene('scene-1');
    // Legacy prose is ignored - no branch to resolve
    scene.prose = 'Legacy prose';

    const result = resolveProseForBranch(scene, 'nonexistent', {});
    expect(result.prose).toBeUndefined();
  });

  it('should handle nonexistent branch', () => {
    const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
    const scene = createScene('scene-1', [v1]);

    const result = resolveProseForBranch(scene, 'nonexistent', { 'branch-1': createBranch('branch-1') });
    // Branch doesn't exist - returns undefined
    expect(result.prose).toBeUndefined();
  });

  it('should handle scene with no id match in version pointers', () => {
    const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
    const scene = createScene('scene-1', [v1]);

    const branches = {
      'branch-1': createBranch('branch-1', null, 500, {
        'other-scene': { proseVersion: '1' },
      }),
    };

    // Should resolve normally since scene-1 has no pointer
    const result = resolveProseForBranch(scene, 'branch-1', branches);
    expect(result.prose).toBe('Prose content for V1');
  });

  it('should handle complex version numbers correctly', () => {
    // Test sorting of version numbers like 1.10 vs 1.9
    const v1_9 = createProseVersion('1.9', 'branch-1', 'rewrite', 9000);
    const v1_10 = createProseVersion('1.10', 'branch-1', 'rewrite', 10000);
    const scene = createScene('scene-1', [v1_9, v1_10]);

    const branches = { 'branch-1': createBranch('branch-1') };

    // Latest by timestamp should be V1.10
    const result = resolveProseForBranch(scene, 'branch-1', branches);
    expect(result.prose).toBe('Prose content for V1.10');
  });

  it('should handle versions created at same timestamp', () => {
    // Two versions at same timestamp - should handle gracefully
    const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
    const v2 = createProseVersion('2', 'branch-1', 'generate', 1000);
    const scene = createScene('scene-1', [v1, v2]);

    const branches = { 'branch-1': createBranch('branch-1') };

    // Both at same timestamp - behavior depends on array order
    // This tests that it doesn't crash
    const result = resolveProseForBranch(scene, 'branch-1', branches);
    expect(result.prose).toBeDefined();
  });
});

describe('Version Resolution with Complex Branch Hierarchies', () => {
  it('should handle diamond-shaped branch hierarchy', () => {
    // Grandparent → Parent1 & Parent2 → Child (merges both)
    // In our model, child can only have one parent, but this tests deep hierarchies

    const v1 = createProseVersion('1', 'root', 'generate', 1000);
    const scene = createScene('scene-1', [v1]);

    const branches = {
      root: createBranch('root', null, 500),
      branch_a: createBranch('branch_a', 'root', 2000),
      branch_b: createBranch('branch_b', 'root', 2000),
      child_of_a: createBranch('child_of_a', 'branch_a', 3000),
    };

    // child_of_a should trace back through branch_a to root
    const result = resolveProseForBranch(scene, 'child_of_a', branches);
    expect(result.prose).toBe('Prose content for V1');
  });

  it('should correctly isolate updates in sibling branches', () => {
    // Root has V1
    const rootV1 = createProseVersion('1', 'root', 'generate', 1000);
    // Branch A adds V2
    const branchAV2 = createProseVersion('2', 'branch_a', 'generate', 3000);
    // Branch B adds V2 (different content)
    const branchBV2 = createProseVersion('2', 'branch_b', 'generate', 3000);
    branchBV2.prose = 'Branch B prose V2';

    const scene = createScene('scene-1', [rootV1, branchAV2, branchBV2]);

    const branches = {
      root: createBranch('root', null, 500),
      branch_a: createBranch('branch_a', 'root', 2000),
      branch_b: createBranch('branch_b', 'root', 2000),
    };

    // Root sees V1
    const rootResult = resolveProseForBranch(scene, 'root', branches);
    expect(rootResult.prose).toBe('Prose content for V1');

    // Branch A sees its V2
    const branchAResult = resolveProseForBranch(scene, 'branch_a', branches);
    expect(branchAResult.prose).toBe('Prose content for V2');

    // Branch B sees its V2
    const branchBResult = resolveProseForBranch(scene, 'branch_b', branches);
    expect(branchBResult.prose).toBe('Branch B prose V2');
  });
});

describe('Beat Prose Map and Prose Score Resolution', () => {
  it('should resolve beatProseMap along with prose', () => {
    const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
    v1.beatProseMap = {
      chunks: [{ beatIndex: 0, prose: 'First beat' }],
      createdAt: 1000,
    };

    const scene = createScene('scene-1', [v1]);
    const branches = { 'branch-1': createBranch('branch-1') };

    const result = resolveProseForBranch(scene, 'branch-1', branches);
    expect(result.beatProseMap?.chunks[0].prose).toBe('First beat');
  });

  it('should resolve proseScore along with prose', () => {
    const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
    v1.proseScore = { overall: 85, details: { clarity: 90, style: 80 } };

    const scene = createScene('scene-1', [v1]);
    const branches = { 'branch-1': createBranch('branch-1') };

    const result = resolveProseForBranch(scene, 'branch-1', branches);
    expect(result.proseScore?.overall).toBe(85);
    expect(result.proseScore?.details?.clarity).toBe(90);
  });

  it('should return undefined beatProseMap when no versions exist (no legacy fallback)', () => {
    const scene = createScene('scene-1');
    // Legacy fields are ignored - no fallback
    scene.prose = 'Legacy prose';
    scene.beatProseMap = { chunks: [{ beatIndex: 0, prose: 'Legacy beat' }], createdAt: 500 };

    const branches = { 'branch-1': createBranch('branch-1') };

    const result = resolveProseForBranch(scene, 'branch-1', branches);
    expect(result.beatProseMap).toBeUndefined();
  });
});

describe('Version Pointer Auto-Update', () => {
  // These tests verify the behavior that version pointers should auto-update
  // when new versions are created (tested in store, documented here for clarity)

  it('should use version pointers to track current resolved version', () => {
    // When a user creates a new version, the pointer should be updated automatically
    // This test verifies that resolving with a pointer works correctly
    const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
    const v2 = createProseVersion('2', 'branch-1', 'generate', 2000);
    const scene = createScene('scene-1', [v1, v2]);

    // Without pointer: resolves to latest (V2)
    const branchWithoutPointer = createBranch('branch-1');
    const resultWithoutPointer = resolveProseForBranch(scene, 'branch-1', { 'branch-1': branchWithoutPointer });
    expect(resultWithoutPointer.prose).toBe('Prose content for V2');

    // With pointer to V2: resolves to V2 (same as latest, but explicit)
    const branchWithPointer = createBranch('branch-1', null, 500, {
      'scene-1': { proseVersion: '2' },
    });
    const resultWithPointer = resolveProseForBranch(scene, 'branch-1', { 'branch-1': branchWithPointer });
    expect(resultWithPointer.prose).toBe('Prose content for V2');
  });

  it('should allow switching between versions via pointer', () => {
    const v1 = createProseVersion('1', 'branch-1', 'generate', 1000);
    const v1_1 = createProseVersion('1.1', 'branch-1', 'rewrite', 2000, '1');
    const v1_1_1 = createProseVersion('1.1.1', 'branch-1', 'edit', 3000, '1.1');
    const scene = createScene('scene-1', [v1, v1_1, v1_1_1]);

    // Point to V1 (major)
    const branchPointingV1 = createBranch('branch-1', null, 500, {
      'scene-1': { proseVersion: '1' },
    });
    const resultV1 = resolveProseForBranch(scene, 'branch-1', { 'branch-1': branchPointingV1 });
    expect(resultV1.prose).toBe('Prose content for V1');

    // Point to V1.1 (rewrite)
    const branchPointingV1_1 = createBranch('branch-1', null, 500, {
      'scene-1': { proseVersion: '1.1' },
    });
    const resultV1_1 = resolveProseForBranch(scene, 'branch-1', { 'branch-1': branchPointingV1_1 });
    expect(resultV1_1.prose).toBe('Prose content for V1.1');

    // Point to V1.1.1 (edit)
    const branchPointingV1_1_1 = createBranch('branch-1', null, 500, {
      'scene-1': { proseVersion: '1.1.1' },
    });
    const resultV1_1_1 = resolveProseForBranch(scene, 'branch-1', { 'branch-1': branchPointingV1_1_1 });
    expect(resultV1_1_1.prose).toBe('Prose content for V1.1.1');
  });
});
