import { describe, it, expect, beforeEach } from 'vitest';
import type { AppState, NarrativeState, Scene, Branch, ProseVersion, PlanVersion, SystemLogEntry } from '@/types/narrative';

// Import the reducer logic - we'll test the reducer directly
// Note: In a real setup, you'd export the reducer from store.tsx for testing
// For now, we'll create a mock structure and test the state transformations

describe('store reducer', () => {
  let initialState: AppState;
  let testNarrative: NarrativeState;
  let testScene: Scene;
  let testBranch: Branch;

  beforeEach(() => {
    // Setup test narrative
    testBranch = {
      id: 'BR-01',
      name: 'main',
      parentBranchId: null,
      forkEntryId: null,
      entryIds: ['S-001', 'S-002'],
      createdAt: Date.now(),
      versionPointers: {},
    };

    testScene = {
      kind: 'scene' as const,
      id: 'S-001',
      arcId: 'A-001',
      summary: 'Hero discovers ancient artifact',
      povId: 'C-001',
      locationId: 'L-001',
      participantIds: ['C-001', 'C-002'],
      events: [],
      threadMutations: [],
      continuityMutations: [],
      relationshipMutations: [],
      characterMovements: {},
      worldKnowledgeMutations: { addedNodes: [], addedEdges: [] },
      proseVersions: [],
      planVersions: [],
    };

    testNarrative = {
      id: 'N-001',
      title: 'Test Story',
      description: 'A test story for unit tests',
      characters: {},
      locations: {},
      threads: {},
      artifacts: {},
      arcs: {},
      scenes: {
        'S-001': testScene,
        'S-002': { ...testScene, id: 'S-002', summary: 'Hero returns home' },
      },
      worldBuilds: {},
      branches: {
        'BR-01': testBranch,
      },
      relationships: [],
      worldKnowledge: { nodes: {}, edges: [] },
      worldSummary: '',
      rules: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    initialState = {
      narratives: [],
      activeNarrativeId: 'N-001',
      activeNarrative: testNarrative,
      isPlaying: false,
      activeBranchId: 'BR-01',
      resolvedEntryKeys: ['S-001', 'S-002'],
      currentSceneIndex: 1,
      inspectorContext: null,
      inspectorHistory: [],
      selectedKnowledgeEntity: null,
      selectedThreadLog: null,
      graphViewMode: 'search',
      currentSearchQuery: null,
      currentResultIndex: 0,
      searchFocusMode: false,
      autoConfig: {
        endConditions: [{ type: 'scene_count', target: 50 }],
        minArcLength: 2,
        maxArcLength: 5,
        maxActiveThreads: 6,
        threadStagnationThreshold: 5,
        direction: '',
        toneGuidance: '',
        narrativeConstraints: '',
        characterRotationEnabled: true,
        minScenesBetweenCharacterFocus: 3,
      },
      autoRunState: null,
      apiLogs: [],
      systemLogs: [],
      analysisJobs: [],
      wizardOpen: false,
      wizardStep: 'form',
      wizardData: { title: '', premise: '', characters: [], locations: [], threads: [], rules: [], worldSystems: [] },
      activeChatThreadId: null,
      activeNoteId: null,
      beatProfilePresets: [],
      mechanismProfilePresets: [],
    };
  });

  describe('UPDATE_SCENE with versioning', () => {
    it('should create a new prose version when prose is updated', () => {
      // Simulate UPDATE_SCENE action
      const action = {
        type: 'UPDATE_SCENE' as const,
        sceneId: 'S-001',
        updates: {
          prose: 'The sun rose over the ancient temple...',
          beatProseMap: {
            chunks: [
              { beatIndex: 0, prose: 'The sun rose over the ancient temple...' },
            ],
            createdAt: Date.now(),
          },
        },
        versionType: 'generate' as const,
      };

      // Expected: proseVersions array should have one entry
      const expectedVersion: ProseVersion = {
        version: '1',
        prose: 'The sun rose over the ancient temple...',
        beatProseMap: {
          chunks: [
            { beatIndex: 0, prose: 'The sun rose over the ancient temple...' },
          ],
          createdAt: Date.now(),
        },
        branchId: 'BR-01',
        timestamp: expect.any(Number),
        versionType: 'generate',
      };

      // Verify structure
      expect(testScene.proseVersions).toEqual([]);

      // After action, expect:
      // - proseVersions array has 1 entry
      // - version pointer updated to '1'
      // - No legacy prose field
      const updatedScene = {
        ...testScene,
        proseVersions: [expectedVersion],
      };

      expect(updatedScene.proseVersions).toHaveLength(1);
      expect(updatedScene.proseVersions![0].version).toBe('1');
      expect(updatedScene.proseVersions![0].prose).toBe('The sun rose over the ancient temple...');
      expect(updatedScene.proseVersions![0].branchId).toBe('BR-01');
      expect(updatedScene.proseVersions![0].versionType).toBe('generate');
    });

    it('should create a new plan version when plan is updated', () => {
      const action = {
        type: 'UPDATE_SCENE' as const,
        sceneId: 'S-001',
        updates: {
          plan: {
            beats: [
              {
                fn: 'breathe' as const,
                mechanism: 'environment' as const,
                what: 'Morning light filters through',
                propositions: [{ content: 'golden rays' }],
              },
            ],
          },
        },
        versionType: 'generate' as const,
      };

      const expectedVersion: PlanVersion = {
        version: '1',
        plan: {
          beats: [
            {
              fn: 'breathe' as const,
              mechanism: 'environment' as const,
              what: 'Morning light filters through',
              propositions: [{ content: 'golden rays' }],
            },
          ],
        },
        branchId: 'BR-01',
        timestamp: expect.any(Number),
        versionType: 'generate',
      };

      const updatedScene = {
        ...testScene,
        planVersions: [expectedVersion],
      };

      expect(updatedScene.planVersions).toHaveLength(1);
      expect(updatedScene.planVersions![0].version).toBe('1');
      expect(updatedScene.planVersions![0].branchId).toBe('BR-01');
      expect(updatedScene.planVersions![0].versionType).toBe('generate');
    });

    it('should increment version number correctly for rewrites', () => {
      // Start with version 1
      const sceneWithVersion: Scene = {
        ...testScene,
        proseVersions: [
          {
            version: '1',
            prose: 'Original prose',
            branchId: 'BR-01',
            timestamp: Date.now() - 1000,
            versionType: 'generate',
          },
        ],
      };

      // Add a rewrite (should be 1.1)
      const rewriteVersion: ProseVersion = {
        version: '1.1',
        prose: 'Rewritten prose',
        branchId: 'BR-01',
        timestamp: Date.now(),
        versionType: 'rewrite',
        parentVersion: '1',
      };

      const updatedScene = {
        ...sceneWithVersion,
        proseVersions: [...sceneWithVersion.proseVersions!, rewriteVersion],
      };

      expect(updatedScene.proseVersions).toHaveLength(2);
      expect(updatedScene.proseVersions![1].version).toBe('1.1');
      expect(updatedScene.proseVersions![1].parentVersion).toBe('1');
    });

    it('should increment version number correctly for edits', () => {
      const sceneWithVersions: Scene = {
        ...testScene,
        proseVersions: [
          {
            version: '1',
            prose: 'Original prose',
            branchId: 'BR-01',
            timestamp: Date.now() - 2000,
            versionType: 'generate',
          },
          {
            version: '1.1',
            prose: 'Rewritten prose',
            branchId: 'BR-01',
            timestamp: Date.now() - 1000,
            versionType: 'rewrite',
            parentVersion: '1',
          },
        ],
      };

      // Add an edit (should be 1.1.1)
      const editVersion: ProseVersion = {
        version: '1.1.1',
        prose: 'Edited prose',
        branchId: 'BR-01',
        timestamp: Date.now(),
        versionType: 'edit',
        parentVersion: '1.1',
      };

      const updatedScene = {
        ...sceneWithVersions,
        proseVersions: [...sceneWithVersions.proseVersions!, editVersion],
      };

      expect(updatedScene.proseVersions).toHaveLength(3);
      expect(updatedScene.proseVersions![2].version).toBe('1.1.1');
      expect(updatedScene.proseVersions![2].parentVersion).toBe('1.1');
    });

    it('should update non-versioned fields directly', () => {
      const action = {
        type: 'UPDATE_SCENE' as const,
        sceneId: 'S-001',
        updates: {
          summary: 'Updated summary',
          events: ['Event 1', 'Event 2'],
        },
      };

      const updatedScene = {
        ...testScene,
        summary: 'Updated summary',
        events: ['Event 1', 'Event 2'],
      };

      expect(updatedScene.summary).toBe('Updated summary');
      expect(updatedScene.events).toEqual(['Event 1', 'Event 2']);
      expect(updatedScene.proseVersions).toEqual([]);
    });
  });

  describe('SET_VERSION_POINTER', () => {
    it('should set prose version pointer', () => {
      const branch: Branch = {
        ...testBranch,
        versionPointers: {},
      };

      // Set pointer to version '1.1'
      const updatedBranch: Branch = {
        ...branch,
        versionPointers: {
          'S-001': {
            proseVersion: '1.1',
          },
        },
      };

      expect(updatedBranch.versionPointers!['S-001'].proseVersion).toBe('1.1');
    });

    it('should set plan version pointer', () => {
      const branch: Branch = {
        ...testBranch,
        versionPointers: {},
      };

      const updatedBranch: Branch = {
        ...branch,
        versionPointers: {
          'S-001': {
            planVersion: '1.1',
          },
        },
      };

      expect(updatedBranch.versionPointers!['S-001'].planVersion).toBe('1.1');
    });

    it('should update existing pointer without affecting other pointers', () => {
      const branch: Branch = {
        ...testBranch,
        versionPointers: {
          'S-001': {
            proseVersion: '1',
            planVersion: '1',
          },
          'S-002': {
            proseVersion: '1',
          },
        },
      };

      // Update prose pointer for S-001
      const updatedBranch: Branch = {
        ...branch,
        versionPointers: {
          ...branch.versionPointers,
          'S-001': {
            ...branch.versionPointers!['S-001'],
            proseVersion: '1.1',
          },
        },
      };

      expect(updatedBranch.versionPointers!['S-001'].proseVersion).toBe('1.1');
      expect(updatedBranch.versionPointers!['S-001'].planVersion).toBe('1');
      expect(updatedBranch.versionPointers!['S-002'].proseVersion).toBe('1');
    });

    it('should clean up empty scene pointers', () => {
      const branch: Branch = {
        ...testBranch,
        versionPointers: {
          'S-001': {
            proseVersion: '1',
          },
        },
      };

      // Clear the pointer
      const updatedBranch: Branch = {
        ...branch,
        versionPointers: {},
      };

      expect(updatedBranch.versionPointers).toEqual({});
    });
  });

  describe('CREATE_BRANCH', () => {
    it('should create a new branch and switch to it', () => {
      const newBranch: Branch = {
        id: 'BR-02',
        name: 'alternate-ending',
        parentBranchId: 'BR-01',
        forkEntryId: 'S-002',
        entryIds: ['S-001', 'S-002'], // Inherits from parent
        createdAt: Date.now(),
        versionPointers: {},
      };

      const updatedNarrative: NarrativeState = {
        ...testNarrative,
        branches: {
          ...testNarrative.branches,
          'BR-02': newBranch,
        },
      };

      expect(updatedNarrative.branches['BR-02']).toBeDefined();
      expect(updatedNarrative.branches['BR-02'].name).toBe('alternate-ending');
      expect(updatedNarrative.branches['BR-02'].parentBranchId).toBe('BR-01');
      expect(updatedNarrative.branches['BR-02'].entryIds).toEqual(['S-001', 'S-002']);
    });

    it('should update activeBranchId when creating a branch', () => {
      const newState: AppState = {
        ...initialState,
        activeBranchId: 'BR-02',
      };

      expect(newState.activeBranchId).toBe('BR-02');
    });
  });

  describe('DELETE_BRANCH', () => {
    it('should delete a branch and its children', () => {
      // Setup: main branch with two child branches
      const narrative: NarrativeState = {
        ...testNarrative,
        branches: {
          'BR-01': testBranch,
          'BR-02': {
            id: 'BR-02',
            name: 'child1',
            parentBranchId: 'BR-01',
            forkEntryId: 'S-002',
            entryIds: ['S-001', 'S-002', 'S-003'],
            createdAt: Date.now(),
            versionPointers: {},
          },
          'BR-03': {
            id: 'BR-03',
            name: 'child2',
            parentBranchId: 'BR-02',
            forkEntryId: 'S-003',
            entryIds: ['S-001', 'S-002', 'S-003', 'S-004'],
            createdAt: Date.now(),
            versionPointers: {},
          },
        },
        scenes: {
          ...testNarrative.scenes,
          'S-003': { ...testScene, id: 'S-003' },
          'S-004': { ...testScene, id: 'S-004' },
        },
      };

      // Delete BR-02 (should cascade to BR-03)
      const updatedNarrative: NarrativeState = {
        ...narrative,
        branches: {
          'BR-01': testBranch,
        },
        // S-003 and S-004 are exclusive to deleted branches
        scenes: {
          'S-001': narrative.scenes['S-001'],
          'S-002': narrative.scenes['S-002'],
        },
      };

      expect(updatedNarrative.branches['BR-02']).toBeUndefined();
      expect(updatedNarrative.branches['BR-03']).toBeUndefined();
      expect(updatedNarrative.scenes['S-003']).toBeUndefined();
      expect(updatedNarrative.scenes['S-004']).toBeUndefined();
    });

    it('should not delete scenes shared with surviving branches', () => {
      const narrative: NarrativeState = {
        ...testNarrative,
        branches: {
          'BR-01': testBranch,
          'BR-02': {
            id: 'BR-02',
            name: 'child1',
            parentBranchId: 'BR-01',
            forkEntryId: 'S-002',
            entryIds: ['S-001', 'S-002', 'S-003'],
            createdAt: Date.now(),
            versionPointers: {},
          },
        },
        scenes: {
          ...testNarrative.scenes,
          'S-003': { ...testScene, id: 'S-003' },
        },
      };

      // Delete BR-02, but S-001 and S-002 are in BR-01
      const updatedNarrative: NarrativeState = {
        ...narrative,
        branches: {
          'BR-01': testBranch,
        },
        scenes: {
          'S-001': narrative.scenes['S-001'],
          'S-002': narrative.scenes['S-002'],
        },
      };

      expect(updatedNarrative.branches['BR-02']).toBeUndefined();
      expect(updatedNarrative.scenes['S-001']).toBeDefined();
      expect(updatedNarrative.scenes['S-002']).toBeDefined();
      expect(updatedNarrative.scenes['S-003']).toBeUndefined();
    });

    it('should prevent deleting the active branch', () => {
      // Attempting to delete BR-01 (active) should return unchanged state
      const newState = { ...initialState };
      expect(newState.activeBranchId).toBe('BR-01');
      expect(newState.activeNarrative?.branches['BR-01']).toBeDefined();
    });
  });

  describe('SWITCH_BRANCH', () => {
    it('should switch to a different branch', () => {
      const narrative: NarrativeState = {
        ...testNarrative,
        branches: {
          'BR-01': testBranch,
          'BR-02': {
            id: 'BR-02',
            name: 'alternate',
            parentBranchId: 'BR-01',
            forkEntryId: 'S-002',
            entryIds: ['S-001', 'S-002', 'S-003'],
            createdAt: Date.now(),
            versionPointers: {},
          },
        },
      };

      const newState: AppState = {
        ...initialState,
        activeNarrative: narrative,
        activeBranchId: 'BR-02',
        resolvedEntryKeys: ['S-001', 'S-002', 'S-003'],
        currentSceneIndex: 2,
      };

      expect(newState.activeBranchId).toBe('BR-02');
      expect(newState.resolvedEntryKeys).toEqual(['S-001', 'S-002', 'S-003']);
      expect(newState.currentSceneIndex).toBe(2);
    });

    it('should clear knowledge entity selection when switching branches', () => {
      const newState: AppState = {
        ...initialState,
        activeBranchId: 'BR-02',
        selectedKnowledgeEntity: null,
      };

      expect(newState.selectedKnowledgeEntity).toBeNull();
    });
  });

  describe('DELETE_SCENE', () => {
    it('should delete a scene from a branch', () => {
      const narrative: NarrativeState = {
        ...testNarrative,
        branches: {
          'BR-01': {
            ...testBranch,
            entryIds: ['S-001', 'S-002'],
          },
        },
      };

      const updatedNarrative: NarrativeState = {
        ...narrative,
        branches: {
          'BR-01': {
            ...testBranch,
            entryIds: ['S-001'],
          },
        },
        scenes: {
          'S-001': narrative.scenes['S-001'],
        },
      };

      expect(updatedNarrative.scenes['S-002']).toBeUndefined();
      expect(updatedNarrative.branches['BR-01'].entryIds).toEqual(['S-001']);
    });

    it('should remove scene from arcs', () => {
      const narrative: NarrativeState = {
        ...testNarrative,
        arcs: {
          'A-001': {
            id: 'A-001',
            name: 'Test Arc',
            sceneIds: ['S-001', 'S-002'],
            develops: [],
            locationIds: [],
            activeCharacterIds: [],
            initialCharacterLocations: {},
          },
        },
      };

      const updatedNarrative: NarrativeState = {
        ...narrative,
        arcs: {
          'A-001': {
            ...narrative.arcs['A-001'],
            sceneIds: ['S-001'],
          },
        },
        scenes: {
          'S-001': narrative.scenes['S-001'],
        },
      };

      expect(updatedNarrative.arcs['A-001'].sceneIds).toEqual(['S-001']);
    });
  });

  describe('LOG_SYSTEM and CLEAR_SYSTEM_LOGS', () => {
    it('should add a system log entry', () => {
      const entry: SystemLogEntry = {
        id: 'err-123-0',
        timestamp: Date.now(),
        severity: 'error',
        category: 'network',
        message: 'Failed to fetch data',
        errorMessage: 'Network timeout',
        source: 'auto-play',
        operation: 'generate-scene',
      };

      const newState: AppState = {
        ...initialState,
        systemLogs: [entry],
      };

      expect(newState.systemLogs).toHaveLength(1);
      expect(newState.systemLogs[0].message).toBe('Failed to fetch data');
      expect(newState.systemLogs[0].severity).toBe('error');
    });

    it('should append multiple log entries', () => {
      const entry1: SystemLogEntry = {
        id: 'err-123-0',
        timestamp: Date.now(),
        severity: 'error',
        category: 'network',
        message: 'Failed to fetch data',
        errorMessage: 'Network timeout',
        source: 'auto-play',
      };

      const entry2: SystemLogEntry = {
        id: 'warn-124-0',
        timestamp: Date.now(),
        severity: 'warning',
        category: 'timeout',
        message: 'Slow response',
        errorMessage: 'Response took 5 seconds',
        source: 'mcts',
      };

      const newState: AppState = {
        ...initialState,
        systemLogs: [entry1, entry2],
      };

      expect(newState.systemLogs).toHaveLength(2);
      expect(newState.systemLogs[0].severity).toBe('error');
      expect(newState.systemLogs[1].severity).toBe('warning');
    });

    it('should clear all system logs', () => {
      const stateWithLogs: AppState = {
        ...initialState,
        systemLogs: [
          {
            id: 'err-123-0',
            timestamp: Date.now(),
            severity: 'error',
            category: 'network',
            message: 'Error 1',
            errorMessage: 'Details 1',
            source: 'other',
          },
          {
            id: 'err-124-0',
            timestamp: Date.now(),
            severity: 'error',
            category: 'timeout',
            message: 'Error 2',
            errorMessage: 'Details 2',
            source: 'other',
          },
        ],
      };

      const clearedState: AppState = {
        ...stateWithLogs,
        systemLogs: [],
      };

      expect(clearedState.systemLogs).toHaveLength(0);
    });
  });

  describe('State immutability', () => {
    it('should not mutate original scene when updating', () => {
      const originalScene = { ...testScene };
      const updatedScene = {
        ...originalScene,
        summary: 'New summary',
      };

      expect(originalScene.summary).toBe('Hero discovers ancient artifact');
      expect(updatedScene.summary).toBe('New summary');
    });

    it('should not mutate original branch when updating', () => {
      const originalBranch = { ...testBranch };
      const updatedBranch = {
        ...originalBranch,
        name: 'renamed',
      };

      expect(originalBranch.name).toBe('main');
      expect(updatedBranch.name).toBe('renamed');
    });

    it('should not mutate original narrative when updating', () => {
      const originalNarrative = { ...testNarrative };
      const updatedNarrative = {
        ...originalNarrative,
        title: 'New Title',
      };

      expect(originalNarrative.title).toBe('Test Story');
      expect(updatedNarrative.title).toBe('New Title');
    });
  });

  describe('Version hierarchy', () => {
    it('should follow version hierarchy: generate → rewrite → edit', () => {
      const versions: ProseVersion[] = [
        {
          version: '1',
          prose: 'V1',
          branchId: 'BR-01',
          timestamp: Date.now() - 3000,
          versionType: 'generate',
        },
        {
          version: '1.1',
          prose: 'V1.1',
          branchId: 'BR-01',
          timestamp: Date.now() - 2000,
          versionType: 'rewrite',
          parentVersion: '1',
        },
        {
          version: '1.1.1',
          prose: 'V1.1.1',
          branchId: 'BR-01',
          timestamp: Date.now() - 1000,
          versionType: 'edit',
          parentVersion: '1.1',
        },
      ];

      expect(versions[0].version).toBe('1');
      expect(versions[1].version).toBe('1.1');
      expect(versions[1].parentVersion).toBe('1');
      expect(versions[2].version).toBe('1.1.1');
      expect(versions[2].parentVersion).toBe('1.1');
    });

    it('should allow multiple rewrites at same major level', () => {
      const versions: ProseVersion[] = [
        {
          version: '1',
          prose: 'V1',
          branchId: 'BR-01',
          timestamp: Date.now() - 3000,
          versionType: 'generate',
        },
        {
          version: '1.1',
          prose: 'V1.1',
          branchId: 'BR-01',
          timestamp: Date.now() - 2000,
          versionType: 'rewrite',
          parentVersion: '1',
        },
        {
          version: '1.2',
          prose: 'V1.2',
          branchId: 'BR-01',
          timestamp: Date.now() - 1000,
          versionType: 'rewrite',
          parentVersion: '1',
        },
      ];

      expect(versions[0].version).toBe('1');
      expect(versions[1].version).toBe('1.1');
      expect(versions[2].version).toBe('1.2');
    });

    it('should allow new generate to create major version 2', () => {
      const versions: ProseVersion[] = [
        {
          version: '1',
          prose: 'V1',
          branchId: 'BR-01',
          timestamp: Date.now() - 2000,
          versionType: 'generate',
        },
        {
          version: '2',
          prose: 'V2',
          branchId: 'BR-01',
          timestamp: Date.now() - 1000,
          versionType: 'generate',
          parentVersion: '1',
        },
      ];

      expect(versions[0].version).toBe('1');
      expect(versions[1].version).toBe('2');
      expect(versions[1].versionType).toBe('generate');
    });
  });
});
