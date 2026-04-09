import { describe, it, expect } from 'vitest';
import type { NarrativeState, Scene, Character, Location } from '@/types/narrative';
import { computeWorldMetrics } from '@/lib/ai/world';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createScene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    povId: 'C-01',
    locationId: 'L-01',
    participantIds: ['C-01'],
    summary: `Scene ${id} summary`,
    events: ['Event 1'],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    characterMovements: {},
    ...overrides,
  };
}

function createCharacter(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    name: `Character ${id}`,
    role: 'recurring',
    threadIds: [],
    continuity: { nodes: {}, edges: [] },
    ...overrides,
  };
}

function createLocation(id: string, overrides: Partial<Location> = {}): Location {
  return {
    id,
    name: `Location ${id}`,
    prominence: 'place' as const,
    parentId: null,
    tiedCharacterIds: [],
    threadIds: [],
    continuity: { nodes: {}, edges: [] },
    ...overrides,
  };
}

function createMinimalNarrative(): NarrativeState {
  return {
    id: 'N-001',
    title: 'Test Narrative',
    description: 'A test story',
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    scenes: {},
    arcs: {},
    worldBuilds: {},
    branches: {
      main: {
        id: 'main',
        name: 'Main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: [],
        createdAt: Date.now(),
      },
    },
    relationships: [],
    worldKnowledge: { nodes: {}, edges: [] },
    worldSummary: '',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── computeWorldMetrics Tests ────────────────────────────────────────────────

describe('computeWorldMetrics', () => {
  describe('basic metrics', () => {
    it('returns zeros for empty narrative', () => {
      const narrative = createMinimalNarrative();
      const result = computeWorldMetrics(narrative, []);

      expect(result.totalScenes).toBe(0);
      expect(result.totalCharacters).toBe(0);
      expect(result.totalLocations).toBe(0);
      expect(result.usedCharacters).toBe(0);
      expect(result.usedLocations).toBe(0);
    });

    it('counts total characters and locations', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01'),
        'C-02': createCharacter('C-02'),
        'C-03': createCharacter('C-03'),
      };
      narrative.locations = {
        'L-01': createLocation('L-01'),
        'L-02': createLocation('L-02'),
      };

      const result = computeWorldMetrics(narrative, []);

      expect(result.totalCharacters).toBe(3);
      expect(result.totalLocations).toBe(2);
    });

    it('counts used characters and locations from scenes', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01'),
        'C-02': createCharacter('C-02'),
        'C-03': createCharacter('C-03'), // Not used in any scene
      };
      narrative.locations = {
        'L-01': createLocation('L-01'),
        'L-02': createLocation('L-02'), // Not used in any scene
      };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01', 'C-02'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-01'], locationId: 'L-01' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002']);

      expect(result.totalScenes).toBe(2);
      expect(result.usedCharacters).toBe(2); // C-01 and C-02
      expect(result.usedLocations).toBe(1); // L-01 only
    });
  });

  describe('average scenes per character', () => {
    it('calculates average correctly', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01'),
        'C-02': createCharacter('C-02'),
      };
      narrative.locations = { 'L-01': createLocation('L-01') };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01', 'C-02'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-01'], locationId: 'L-01' }),
        'S-003': createScene('S-003', { participantIds: ['C-01'], locationId: 'L-01' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002', 'S-003']);

      // C-01 appears in 3 scenes, C-02 appears in 1 scene
      // Average = (3 + 1) / 2 = 2
      expect(result.avgScenesPerCharacter).toBe(2);
    });

    it('returns 0 when no characters used', () => {
      const narrative = createMinimalNarrative();
      const result = computeWorldMetrics(narrative, []);

      expect(result.avgScenesPerCharacter).toBe(0);
    });
  });

  describe('cast concentration', () => {
    it('calculates concentration as ratio of most-used character', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01'),
        'C-02': createCharacter('C-02'),
      };
      narrative.locations = { 'L-01': createLocation('L-01') };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-01'], locationId: 'L-01' }),
        'S-003': createScene('S-003', { participantIds: ['C-01'], locationId: 'L-01' }),
        'S-004': createScene('S-004', { participantIds: ['C-02'], locationId: 'L-01' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002', 'S-003', 'S-004']);

      // C-01 appears in 3 of 4 scenes = 75%
      expect(result.castConcentration).toBe(0.75);
    });

    it('returns 0 when no scenes', () => {
      const narrative = createMinimalNarrative();
      const result = computeWorldMetrics(narrative, []);

      expect(result.castConcentration).toBe(0);
    });
  });

  describe('stale characters', () => {
    it('marks characters as stale when not seen recently', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01'),
        'C-02': createCharacter('C-02'),
      };
      narrative.locations = { 'L-01': createLocation('L-01') };

      // Create 20 scenes - C-02 only appears in first scene
      const scenes: Record<string, Scene> = {};
      const keys: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const id = `S-${String(i).padStart(3, '0')}`;
        scenes[id] = createScene(id, {
          participantIds: i === 1 ? ['C-01', 'C-02'] : ['C-01'],
          locationId: 'L-01',
        });
        keys.push(id);
      }
      narrative.scenes = scenes;

      const result = computeWorldMetrics(narrative, keys);

      // staleThreshold = max(5, 20 * 0.3) = 6
      // C-02 last seen at index 0, (20 - 1 - 0) = 19 > 6 → stale
      expect(result.staleCharacters).toBe(1);
    });

    it('does not mark characters as stale when recently seen', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01'),
        'C-02': createCharacter('C-02'),
      };
      narrative.locations = { 'L-01': createLocation('L-01') };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01', 'C-02'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-01', 'C-02'], locationId: 'L-01' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002']);

      expect(result.staleCharacters).toBe(0);
    });
  });

  describe('average knowledge per character', () => {
    it('calculates average knowledge nodes', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01', {
          continuity: { nodes: { 'K-01': { id: 'K-01', type: 'secret', content: 'A secret' } }, edges: [] },
        }),
        'C-02': createCharacter('C-02', {
          continuity: {
            nodes: {
              'K-02': { id: 'K-02', type: 'history', content: 'Fact 1' },
              'K-03': { id: 'K-03', type: 'history', content: 'Fact 2' },
              'K-04': { id: 'K-04', type: 'history', content: 'Fact 3' },
            },
            edges: [],
          },
        }),
      };

      const result = computeWorldMetrics(narrative, []);

      // (1 + 3) / 2 = 2
      expect(result.avgKnowledgePerCharacter).toBe(2);
    });

    it('returns 0 when no characters', () => {
      const narrative = createMinimalNarrative();
      const result = computeWorldMetrics(narrative, []);

      expect(result.avgKnowledgePerCharacter).toBe(0);
    });

    it('handles characters without continuity', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01'), // No continuity
        'C-02': createCharacter('C-02', {
          continuity: { nodes: { 'K-01': { id: 'K-01', type: 'history', content: 'Fact' } }, edges: [] },
        }),
      };

      const result = computeWorldMetrics(narrative, []);

      // (0 + 1) / 2 = 0.5
      expect(result.avgKnowledgePerCharacter).toBe(0.5);
    });
  });

  describe('location concentration', () => {
    it('calculates concentration as ratio of most-used location', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = { 'C-01': createCharacter('C-01') };
      narrative.locations = {
        'L-01': createLocation('L-01'),
        'L-02': createLocation('L-02'),
      };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-01'], locationId: 'L-01' }),
        'S-003': createScene('S-003', { participantIds: ['C-01'], locationId: 'L-02' }),
        'S-004': createScene('S-004', { participantIds: ['C-01'], locationId: 'L-01' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002', 'S-003', 'S-004']);

      // L-01 appears in 3 of 4 scenes = 75%
      expect(result.locationConcentration).toBe(0.75);
    });
  });

  describe('stale locations', () => {
    it('marks locations as stale when not used recently', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = { 'C-01': createCharacter('C-01') };
      narrative.locations = {
        'L-01': createLocation('L-01'),
        'L-02': createLocation('L-02'),
      };

      // Create 20 scenes - L-02 only used in first scene
      const scenes: Record<string, Scene> = {};
      const keys: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const id = `S-${String(i).padStart(3, '0')}`;
        scenes[id] = createScene(id, {
          participantIds: ['C-01'],
          locationId: i === 1 ? 'L-02' : 'L-01',
        });
        keys.push(id);
      }
      narrative.scenes = scenes;

      const result = computeWorldMetrics(narrative, keys);

      // L-02 last seen at index 0, (20 - 1 - 0) = 19 > 6 → stale
      expect(result.staleLocations).toBe(1);
    });
  });

  describe('location depth', () => {
    it('calculates max nesting depth', () => {
      const narrative = createMinimalNarrative();
      narrative.locations = {
        'L-01': createLocation('L-01', { parentId: undefined }), // Root
        'L-02': createLocation('L-02', { parentId: 'L-01' }), // Depth 2
        'L-03': createLocation('L-03', { parentId: 'L-02' }), // Depth 3
        'L-04': createLocation('L-04', { parentId: 'L-03' }), // Depth 4
      };

      const result = computeWorldMetrics(narrative, []);

      expect(result.locationDepth).toBe(4);
    });

    it('returns 0 when no locations', () => {
      const narrative = createMinimalNarrative();
      const result = computeWorldMetrics(narrative, []);

      expect(result.locationDepth).toBe(0);
    });

    it('handles multiple root locations', () => {
      const narrative = createMinimalNarrative();
      narrative.locations = {
        'L-01': createLocation('L-01', { parentId: undefined }), // Root 1
        'L-02': createLocation('L-02', { parentId: 'L-01' }), // Depth 2 under L-01
        'L-03': createLocation('L-03', { parentId: undefined }), // Root 2
        'L-04': createLocation('L-04', { parentId: 'L-03' }), // Depth 2 under L-03
        'L-05': createLocation('L-05', { parentId: 'L-04' }), // Depth 3 under L-03
      };

      const result = computeWorldMetrics(narrative, []);

      expect(result.locationDepth).toBe(3); // Max depth is under L-03
    });

    it('handles circular references gracefully', () => {
      const narrative = createMinimalNarrative();
      narrative.locations = {
        'L-01': createLocation('L-01', { parentId: 'L-02' }),
        'L-02': createLocation('L-02', { parentId: 'L-01' }),
      };

      // Should not infinite loop
      const result = computeWorldMetrics(narrative, []);

      expect(result.locationDepth).toBeGreaterThanOrEqual(0);
    });
  });

  describe('average children per location', () => {
    it('calculates average child count', () => {
      const narrative = createMinimalNarrative();
      narrative.locations = {
        'L-01': createLocation('L-01', { parentId: undefined }), // Has 2 children
        'L-02': createLocation('L-02', { parentId: 'L-01' }), // Has 1 child
        'L-03': createLocation('L-03', { parentId: 'L-01' }), // Has 0 children
        'L-04': createLocation('L-04', { parentId: 'L-02' }), // Has 0 children
      };

      const result = computeWorldMetrics(narrative, []);

      // L-01: 2 children, L-02: 1 child, L-03: 0, L-04: 0
      // Average = (2 + 1 + 0 + 0) / 4 = 0.75
      expect(result.avgChildrenPerLocation).toBe(0.75);
    });
  });

  describe('relationships per character', () => {
    it('calculates relationships per character correctly', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01'),
        'C-02': createCharacter('C-02'),
        'C-03': createCharacter('C-03'),
        'C-04': createCharacter('C-04'),
      };
      narrative.relationships = [
        { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
        { from: 'C-01', to: 'C-03', type: 'rival', valence: -0.5 },
        { from: 'C-02', to: 'C-03', type: 'friend', valence: 0.7 },
      ];

      const result = computeWorldMetrics(narrative, []);

      // 3 relationships × 2 / 4 characters = 1.5
      expect(result.relationshipsPerCharacter).toBe(1.5);
    });

    it('returns 0 when no characters', () => {
      const narrative = createMinimalNarrative();
      narrative.relationships = [
        { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
      ];

      const result = computeWorldMetrics(narrative, []);

      expect(result.relationshipsPerCharacter).toBe(0);
    });
  });

  describe('orphaned characters', () => {
    it('counts characters not in any relationship', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01'),
        'C-02': createCharacter('C-02'),
        'C-03': createCharacter('C-03'), // Orphaned
        'C-04': createCharacter('C-04'), // Orphaned
      };
      narrative.relationships = [
        { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
      ];

      const result = computeWorldMetrics(narrative, []);

      expect(result.orphanedCharacters).toBe(2);
    });

    it('counts all characters as orphaned when no relationships', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01'),
        'C-02': createCharacter('C-02'),
      };
      narrative.relationships = [];

      const result = computeWorldMetrics(narrative, []);

      expect(result.orphanedCharacters).toBe(2);
    });
  });

  describe('recommendation logic', () => {
    // The recommendation logic requires depth/breadth signals to exceed the other by > 1
    // So we need at least 2 more signals in one direction than the other

    it('recommends depth when multiple depth signals present', () => {
      const narrative = createMinimalNarrative();
      // Set up multiple depth signals:
      // 1. Low knowledge density (< 3 nodes/char)
      // 2. Sparse relationships (< 2/char)
      // 3. Orphaned characters (> 2)
      narrative.characters = {
        'C-01': createCharacter('C-01'),
        'C-02': createCharacter('C-02'),
        'C-03': createCharacter('C-03'),
        'C-04': createCharacter('C-04'),
      };
      // No continuity = 0 knowledge per character (< 3) → depth signal
      // No relationships = 4 orphaned (> 2) → depth signal
      // 0 relationships / 4 chars = 0 relationships per char (< 2) → depth signal
      narrative.relationships = [];
      // Multiple locations spread out to avoid breadth signals
      narrative.locations = {
        'L-01': createLocation('L-01'),
        'L-02': createLocation('L-02'),
        'L-03': createLocation('L-03'),
        'L-04': createLocation('L-04'),
      };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01', 'C-02'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-03', 'C-04'], locationId: 'L-02' }),
        'S-003': createScene('S-003', { participantIds: ['C-01', 'C-03'], locationId: 'L-03' }),
        'S-004': createScene('S-004', { participantIds: ['C-02', 'C-04'], locationId: 'L-04' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002', 'S-003', 'S-004']);

      expect(result.recommendation).toBe('depth');
      expect(result.reasoning).toContain('Depth recommended');
    });

    it('recommends depth when orphaned characters and sparse relationships', () => {
      const narrative = createMinimalNarrative();
      // Enough knowledge to avoid that signal, but orphans + sparse relationships
      narrative.characters = {
        'C-01': createCharacter('C-01', { continuity: { nodes: { 'K-01': { id: 'K-01', type: 'secret', content: 'Secret 1' }, 'K-02': { id: 'K-02', type: 'history', content: 'Fact 1' }, 'K-03': { id: 'K-03', type: 'history', content: 'Fact 2' } }, edges: [] } }),
        'C-02': createCharacter('C-02', { continuity: { nodes: { 'K-04': { id: 'K-04', type: 'history', content: 'Fact 3' }, 'K-05': { id: 'K-05', type: 'history', content: 'Fact 4' }, 'K-06': { id: 'K-06', type: 'history', content: 'Fact 5' } }, edges: [] } }),
        'C-03': createCharacter('C-03', { continuity: { nodes: { 'K-07': { id: 'K-07', type: 'history', content: 'Fact 6' }, 'K-08': { id: 'K-08', type: 'history', content: 'Fact 7' }, 'K-09': { id: 'K-09', type: 'history', content: 'Fact 8' } }, edges: [] } }),
        'C-04': createCharacter('C-04', { continuity: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact 9' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact 10' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact 11' } }, edges: [] } }),
      };
      // No relationships: 4 orphaned (> 2), 0 per char (< 2) - two depth signals
      narrative.relationships = [];
      narrative.locations = {
        'L-01': createLocation('L-01'),
        'L-02': createLocation('L-02'),
        'L-03': createLocation('L-03'),
        'L-04': createLocation('L-04'),
      };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01', 'C-02'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-03', 'C-04'], locationId: 'L-02' }),
        'S-003': createScene('S-003', { participantIds: ['C-01', 'C-03'], locationId: 'L-03' }),
        'S-004': createScene('S-004', { participantIds: ['C-02', 'C-04'], locationId: 'L-04' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002', 'S-003', 'S-004']);

      expect(result.recommendation).toBe('depth');
      expect(result.reasoning).toContain('orphaned');
    });

    it('recommends breadth when multiple breadth signals present', () => {
      const narrative = createMinimalNarrative();
      // Set up multiple breadth signals:
      // 1. High location concentration (> 50%)
      // 2. Few locations relative to cast (< 30%)
      // Add enough knowledge and relationships to avoid depth signals
      narrative.characters = {
        'C-01': createCharacter('C-01', {
          continuity: { nodes: { 'K-01': { id: 'K-01', type: 'history', content: 'Fact 1' }, 'K-02': { id: 'K-02', type: 'history', content: 'Fact 2' }, 'K-03': { id: 'K-03', type: 'history', content: 'Fact 3' } }, edges: [] },
        }),
        'C-02': createCharacter('C-02', {
          continuity: { nodes: { 'K-04': { id: 'K-04', type: 'history', content: 'Fact 4' }, 'K-05': { id: 'K-05', type: 'history', content: 'Fact 5' }, 'K-06': { id: 'K-06', type: 'history', content: 'Fact 6' } }, edges: [] },
        }),
        'C-03': createCharacter('C-03', {
          continuity: { nodes: { 'K-07': { id: 'K-07', type: 'history', content: 'Fact 7' }, 'K-08': { id: 'K-08', type: 'history', content: 'Fact 8' }, 'K-09': { id: 'K-09', type: 'history', content: 'Fact 9' } }, edges: [] },
        }),
        'C-04': createCharacter('C-04', {
          continuity: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact 10' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact 11' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact 12' } }, edges: [] },
        }),
        'C-05': createCharacter('C-05', {
          continuity: { nodes: { 'K-13': { id: 'K-13', type: 'history', content: 'Fact 13' }, 'K-14': { id: 'K-14', type: 'history', content: 'Fact 14' }, 'K-15': { id: 'K-15', type: 'history', content: 'Fact 15' } }, edges: [] },
        }),
        'C-06': createCharacter('C-06', {
          continuity: { nodes: { 'K-16': { id: 'K-16', type: 'history', content: 'Fact 16' }, 'K-17': { id: 'K-17', type: 'history', content: 'Fact 17' }, 'K-18': { id: 'K-18', type: 'history', content: 'Fact 18' } }, edges: [] },
        }),
        'C-07': createCharacter('C-07', {
          continuity: { nodes: { 'K-19': { id: 'K-19', type: 'history', content: 'Fact 19' }, 'K-20': { id: 'K-20', type: 'history', content: 'Fact 20' }, 'K-21': { id: 'K-21', type: 'history', content: 'Fact 21' } }, edges: [] },
        }),
        'C-08': createCharacter('C-08', {
          continuity: { nodes: { 'K-22': { id: 'K-22', type: 'history', content: 'Fact 22' }, 'K-23': { id: 'K-23', type: 'history', content: 'Fact 23' }, 'K-24': { id: 'K-24', type: 'history', content: 'Fact 24' } }, edges: [] },
        }),
        'C-09': createCharacter('C-09', {
          continuity: { nodes: { 'K-25': { id: 'K-25', type: 'history', content: 'Fact 25' }, 'K-26': { id: 'K-26', type: 'history', content: 'Fact 26' }, 'K-27': { id: 'K-27', type: 'history', content: 'Fact 27' } }, edges: [] },
        }),
        'C-10': createCharacter('C-10', {
          continuity: { nodes: { 'K-28': { id: 'K-28', type: 'history', content: 'Fact 28' }, 'K-29': { id: 'K-29', type: 'history', content: 'Fact 29' }, 'K-30': { id: 'K-30', type: 'history', content: 'Fact 30' } }, edges: [] },
        }),
      };
      // Add enough relationships to avoid sparse/orphan signals (at least 2/char)
      narrative.relationships = [
        { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
        { from: 'C-02', to: 'C-03', type: 'ally', valence: 0.5 },
        { from: 'C-03', to: 'C-04', type: 'ally', valence: 0.5 },
        { from: 'C-04', to: 'C-05', type: 'ally', valence: 0.5 },
        { from: 'C-05', to: 'C-06', type: 'ally', valence: 0.5 },
        { from: 'C-06', to: 'C-07', type: 'ally', valence: 0.5 },
        { from: 'C-07', to: 'C-08', type: 'ally', valence: 0.5 },
        { from: 'C-08', to: 'C-09', type: 'ally', valence: 0.5 },
        { from: 'C-09', to: 'C-10', type: 'ally', valence: 0.5 },
        { from: 'C-10', to: 'C-01', type: 'ally', valence: 0.5 },
      ];
      // Only 1 location for 10 characters = 10% (< 30%) → breadth signal
      // All scenes in same location = 100% concentration (> 50%) → breadth signal
      narrative.locations = {
        'L-01': createLocation('L-01'),
      };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01', 'C-02', 'C-03', 'C-04', 'C-05'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-06', 'C-07', 'C-08', 'C-09', 'C-10'], locationId: 'L-01' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002']);

      expect(result.recommendation).toBe('breadth');
      expect(result.reasoning).toContain('Breadth recommended');
    });

    it('recommends breadth when stale characters and few locations', () => {
      const narrative = createMinimalNarrative();
      // 10 characters - 5 will be stale (> 40%)
      // Only 2 locations for 10 chars (20% < 30%) - another breadth signal
      narrative.characters = {
        'C-01': createCharacter('C-01', { continuity: { nodes: { 'K-01': { id: 'K-01', type: 'history', content: 'Fact' }, 'K-02': { id: 'K-02', type: 'history', content: 'Fact' }, 'K-03': { id: 'K-03', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-02': createCharacter('C-02', { continuity: { nodes: { 'K-04': { id: 'K-04', type: 'history', content: 'Fact' }, 'K-05': { id: 'K-05', type: 'history', content: 'Fact' }, 'K-06': { id: 'K-06', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-03': createCharacter('C-03', { continuity: { nodes: { 'K-07': { id: 'K-07', type: 'history', content: 'Fact' }, 'K-08': { id: 'K-08', type: 'history', content: 'Fact' }, 'K-09': { id: 'K-09', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-04': createCharacter('C-04', { continuity: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-05': createCharacter('C-05', { continuity: { nodes: { 'K-13': { id: 'K-13', type: 'history', content: 'Fact' }, 'K-14': { id: 'K-14', type: 'history', content: 'Fact' }, 'K-15': { id: 'K-15', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-06': createCharacter('C-06', { continuity: { nodes: { 'K-16': { id: 'K-16', type: 'history', content: 'Fact' }, 'K-17': { id: 'K-17', type: 'history', content: 'Fact' }, 'K-18': { id: 'K-18', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-07': createCharacter('C-07', { continuity: { nodes: { 'K-19': { id: 'K-19', type: 'history', content: 'Fact' }, 'K-20': { id: 'K-20', type: 'history', content: 'Fact' }, 'K-21': { id: 'K-21', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-08': createCharacter('C-08', { continuity: { nodes: { 'K-22': { id: 'K-22', type: 'history', content: 'Fact' }, 'K-23': { id: 'K-23', type: 'history', content: 'Fact' }, 'K-24': { id: 'K-24', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-09': createCharacter('C-09', { continuity: { nodes: { 'K-25': { id: 'K-25', type: 'history', content: 'Fact' }, 'K-26': { id: 'K-26', type: 'history', content: 'Fact' }, 'K-27': { id: 'K-27', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-10': createCharacter('C-10', { continuity: { nodes: { 'K-28': { id: 'K-28', type: 'history', content: 'Fact' }, 'K-29': { id: 'K-29', type: 'history', content: 'Fact' }, 'K-30': { id: 'K-30', type: 'history', content: 'Fact' } }, edges: [] } }),
      };
      narrative.relationships = [
        { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
        { from: 'C-02', to: 'C-03', type: 'ally', valence: 0.5 },
        { from: 'C-03', to: 'C-04', type: 'ally', valence: 0.5 },
        { from: 'C-04', to: 'C-05', type: 'ally', valence: 0.5 },
        { from: 'C-05', to: 'C-06', type: 'ally', valence: 0.5 },
        { from: 'C-06', to: 'C-07', type: 'ally', valence: 0.5 },
        { from: 'C-07', to: 'C-08', type: 'ally', valence: 0.5 },
        { from: 'C-08', to: 'C-09', type: 'ally', valence: 0.5 },
        { from: 'C-09', to: 'C-10', type: 'ally', valence: 0.5 },
        { from: 'C-10', to: 'C-01', type: 'ally', valence: 0.5 },
      ];
      // Only 2 locations for 10 characters (20% < 30%) → breadth signal
      narrative.locations = {
        'L-01': createLocation('L-01'),
        'L-02': createLocation('L-02'),
      };

      // Create 20 scenes
      // - Characters C-01 through C-05 only appear in first 2 scenes (stale after)
      // - Remaining scenes use C-06-C-10 evenly to avoid cast concentration
      const scenes: Record<string, Scene> = {};
      const keys: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const id = `S-${String(i).padStart(3, '0')}`;
        if (i <= 2) {
          scenes[id] = createScene(id, {
            participantIds: ['C-01', 'C-02', 'C-03', 'C-04', 'C-05'],
            locationId: 'L-01',
          });
        } else {
          // Rotate through C-06 to C-10
          const charIdx = ((i - 3) % 5) + 6;
          const char2Idx = ((i - 2) % 5) + 6;
          scenes[id] = createScene(id, {
            participantIds: [`C-${String(charIdx).padStart(2, '0')}`, `C-${String(char2Idx).padStart(2, '0')}`],
            locationId: i % 2 === 0 ? 'L-01' : 'L-02',
          });
        }
        keys.push(id);
      }
      narrative.scenes = scenes;

      const result = computeWorldMetrics(narrative, keys);

      // Should have breadth signals: stale characters (50% > 40%) + few locations (20% < 30%)
      expect(result.recommendation).toBe('breadth');
      expect(result.reasoning).toContain('Breadth recommended');
    });

    it('recommends balanced when signals are equal', () => {
      const narrative = createMinimalNarrative();
      // Set up a balanced world with no strong signals
      // - 3 knowledge per char (>= 3) → no depth signal
      // - Deep location hierarchy (depth 3 with 3 root locations) → no depth signal
      // - All chars connected with 2 relationships each → no depth signal
      // - Locations well distributed → no breadth signal
      narrative.characters = {
        'C-01': createCharacter('C-01', {
          continuity: { nodes: { 'K-01': { id: 'K-01', type: 'history', content: 'Fact 1' }, 'K-02': { id: 'K-02', type: 'history', content: 'Fact 2' }, 'K-03': { id: 'K-03', type: 'history', content: 'Fact 3' } }, edges: [] },
        }),
        'C-02': createCharacter('C-02', {
          continuity: { nodes: { 'K-04': { id: 'K-04', type: 'history', content: 'Fact 4' }, 'K-05': { id: 'K-05', type: 'history', content: 'Fact 5' }, 'K-06': { id: 'K-06', type: 'history', content: 'Fact 6' } }, edges: [] },
        }),
        'C-03': createCharacter('C-03', {
          continuity: { nodes: { 'K-07': { id: 'K-07', type: 'history', content: 'Fact 7' }, 'K-08': { id: 'K-08', type: 'history', content: 'Fact 8' }, 'K-09': { id: 'K-09', type: 'history', content: 'Fact 9' } }, edges: [] },
        }),
        'C-04': createCharacter('C-04', {
          continuity: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact 10' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact 11' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact 12' } }, edges: [] },
        }),
      };
      narrative.relationships = [
        { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
        { from: 'C-02', to: 'C-03', type: 'ally', valence: 0.5 },
        { from: 'C-03', to: 'C-04', type: 'ally', valence: 0.5 },
        { from: 'C-04', to: 'C-01', type: 'ally', valence: 0.5 },
      ];
      // 3 locations with hierarchy (depth 3) to avoid shallow hierarchy signal
      // Also 3 locs <= 3 locs condition
      narrative.locations = {
        'L-01': createLocation('L-01'), // root
        'L-02': { ...createLocation('L-02'), parentId: 'L-01' }, // child
        'L-03': { ...createLocation('L-03'), parentId: 'L-02' }, // grandchild (depth 3)
      };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01', 'C-02'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-02', 'C-03'], locationId: 'L-02' }),
        'S-003': createScene('S-003', { participantIds: ['C-03', 'C-04'], locationId: 'L-03' }),
        'S-004': createScene('S-004', { participantIds: ['C-04', 'C-01'], locationId: 'L-01' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002', 'S-003', 'S-004']);

      expect(result.recommendation).toBe('balanced');
    });

    it('reports balanced reasoning when signals roughly equal', () => {
      const narrative = createMinimalNarrative();
      // Create a world with equal depth and breadth signals (1 each)
      // Depth signal: sparse relationships (< 2/char) - only 1 relationship / 4 chars
      // Breadth signal: high location concentration (> 50%) - 3/4 scenes at L-01
      // (avoid "few locations" signal by having >= 30% ratio: 2 locs / 4 chars = 50%)
      narrative.characters = {
        'C-01': createCharacter('C-01', {
          continuity: { nodes: { 'K-01': { id: 'K-01', type: 'history', content: 'Fact 1' }, 'K-02': { id: 'K-02', type: 'history', content: 'Fact 2' }, 'K-03': { id: 'K-03', type: 'history', content: 'Fact 3' } }, edges: [] },
        }),
        'C-02': createCharacter('C-02', {
          continuity: { nodes: { 'K-04': { id: 'K-04', type: 'history', content: 'Fact 4' }, 'K-05': { id: 'K-05', type: 'history', content: 'Fact 5' }, 'K-06': { id: 'K-06', type: 'history', content: 'Fact 6' } }, edges: [] },
        }),
        'C-03': createCharacter('C-03', {
          continuity: { nodes: { 'K-07': { id: 'K-07', type: 'history', content: 'Fact 7' }, 'K-08': { id: 'K-08', type: 'history', content: 'Fact 8' }, 'K-09': { id: 'K-09', type: 'history', content: 'Fact 9' } }, edges: [] },
        }),
        'C-04': createCharacter('C-04', {
          continuity: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact 10' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact 11' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact 12' } }, edges: [] },
        }),
      };
      // Only 1 relationship → 2 endpoints / 4 chars = 0.5/char (< 2) → depth signal
      // 2 orphans (C-03, C-04) → but we need only 1 depth signal, so add more relationships
      // Actually: 1 rel = 2 endpoints → 4 chars → 0.5/char + 2 orphans = 2 depth signals
      // Let me use 2 rels: 4 endpoints / 4 chars = 1/char (< 2) → 1 depth signal, 0 orphans
      narrative.relationships = [
        { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
        { from: 'C-03', to: 'C-04', type: 'ally', valence: 0.5 },
      ];
      // 2 locations for 4 chars (50% >= 30%) → no "few locations" signal
      // But use L-01 for 3/4 scenes → 75% concentration (> 50%) → breadth signal
      narrative.locations = {
        'L-01': createLocation('L-01'),
        'L-02': createLocation('L-02'),
      };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01', 'C-02'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-02', 'C-03'], locationId: 'L-01' }),
        'S-003': createScene('S-003', { participantIds: ['C-03', 'C-04'], locationId: 'L-01' }),
        'S-004': createScene('S-004', { participantIds: ['C-04', 'C-01'], locationId: 'L-02' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002', 'S-003', 'S-004']);

      // 1 depth signal (sparse relationships) vs 1 breadth signal (high location concentration) = balanced
      expect(result.recommendation).toBe('balanced');
      expect(result.reasoning.toLowerCase()).toContain('balanced');
    });
  });

  describe('depth signals', () => {
    it('detects shallow location hierarchy', () => {
      const narrative = createMinimalNarrative();
      // 4 locations but max depth of 2
      narrative.locations = {
        'L-01': createLocation('L-01'),
        'L-02': createLocation('L-02'),
        'L-03': createLocation('L-03', { parentId: 'L-01' }),
        'L-04': createLocation('L-04', { parentId: 'L-02' }),
      };
      narrative.characters = {
        'C-01': createCharacter('C-01'),
      };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01'], locationId: 'L-01' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001']);

      expect(result.locationDepth).toBe(2);
      expect(result.reasoning).toContain('shallow');
    });

    it('detects high cast concentration', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01', { continuity: { nodes: { 'K-01': { id: 'K-01', type: 'history', content: 'Fact' }, 'K-02': { id: 'K-02', type: 'history', content: 'Fact' }, 'K-03': { id: 'K-03', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-02': createCharacter('C-02', { continuity: { nodes: { 'K-04': { id: 'K-04', type: 'history', content: 'Fact' }, 'K-05': { id: 'K-05', type: 'history', content: 'Fact' }, 'K-06': { id: 'K-06', type: 'history', content: 'Fact' } }, edges: [] } }),
      };
      narrative.relationships = [
        { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
        { from: 'C-02', to: 'C-01', type: 'ally', valence: 0.5 },
      ];
      narrative.locations = { 'L-01': createLocation('L-01') };
      // C-01 appears in all 5 scenes, C-02 only in 1
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01', 'C-02'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-01'], locationId: 'L-01' }),
        'S-003': createScene('S-003', { participantIds: ['C-01'], locationId: 'L-01' }),
        'S-004': createScene('S-004', { participantIds: ['C-01'], locationId: 'L-01' }),
        'S-005': createScene('S-005', { participantIds: ['C-01'], locationId: 'L-01' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002', 'S-003', 'S-004', 'S-005']);

      expect(result.castConcentration).toBe(1.0); // 5/5 = 100%
      expect(result.reasoning).toContain('concentration');
    });

    it('detects sparse relationships', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = {
        'C-01': createCharacter('C-01', { continuity: { nodes: { 'K-01': { id: 'K-01', type: 'history', content: 'Fact' }, 'K-02': { id: 'K-02', type: 'history', content: 'Fact' }, 'K-03': { id: 'K-03', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-02': createCharacter('C-02', { continuity: { nodes: { 'K-04': { id: 'K-04', type: 'history', content: 'Fact' }, 'K-05': { id: 'K-05', type: 'history', content: 'Fact' }, 'K-06': { id: 'K-06', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-03': createCharacter('C-03', { continuity: { nodes: { 'K-07': { id: 'K-07', type: 'history', content: 'Fact' }, 'K-08': { id: 'K-08', type: 'history', content: 'Fact' }, 'K-09': { id: 'K-09', type: 'history', content: 'Fact' } }, edges: [] } }),
        'C-04': createCharacter('C-04', { continuity: { nodes: { 'K-10': { id: 'K-10', type: 'history', content: 'Fact' }, 'K-11': { id: 'K-11', type: 'history', content: 'Fact' }, 'K-12': { id: 'K-12', type: 'history', content: 'Fact' } }, edges: [] } }),
      };
      // Only 1 relationship = 0.5 per character (< 2)
      narrative.relationships = [
        { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
      ];
      narrative.locations = { 'L-01': createLocation('L-01') };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01', 'C-02', 'C-03', 'C-04'], locationId: 'L-01' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001']);

      expect(result.relationshipsPerCharacter).toBe(0.5); // 1 * 2 / 4
      expect(result.reasoning).toContain('sparse relationships');
    });
  });

  describe('breadth signals', () => {
    it('detects few locations relative to cast', () => {
      const narrative = createMinimalNarrative();
      // 10 characters, only 2 locations (< 30%)
      const chars: Record<string, Character> = {};
      for (let i = 1; i <= 10; i++) {
        const id = `C-${String(i).padStart(2, '0')}`;
        chars[id] = createCharacter(id, {
          continuity: { nodes: { [`K-${i}`]: { id: `K-${i}`, type: 'history', content: 'Fact' }, [`K-${i}0`]: { id: `K-${i}0`, type: 'history', content: 'Fact' }, [`K-${i}00`]: { id: `K-${i}00`, type: 'history', content: 'Fact' } }, edges: [] },
        });
      }
      narrative.characters = chars;
      // Add enough relationships
      narrative.relationships = [
        { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
        { from: 'C-02', to: 'C-03', type: 'ally', valence: 0.5 },
        { from: 'C-03', to: 'C-04', type: 'ally', valence: 0.5 },
        { from: 'C-04', to: 'C-05', type: 'ally', valence: 0.5 },
        { from: 'C-05', to: 'C-06', type: 'ally', valence: 0.5 },
        { from: 'C-06', to: 'C-07', type: 'ally', valence: 0.5 },
        { from: 'C-07', to: 'C-08', type: 'ally', valence: 0.5 },
        { from: 'C-08', to: 'C-09', type: 'ally', valence: 0.5 },
        { from: 'C-09', to: 'C-10', type: 'ally', valence: 0.5 },
        { from: 'C-10', to: 'C-01', type: 'ally', valence: 0.5 },
      ];
      narrative.locations = {
        'L-01': createLocation('L-01'),
        'L-02': createLocation('L-02'),
      };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01', 'C-02'], locationId: 'L-01' }),
        'S-002': createScene('S-002', { participantIds: ['C-03', 'C-04'], locationId: 'L-02' }),
      };

      const result = computeWorldMetrics(narrative, ['S-001', 'S-002']);

      // 2 locations / 10 characters = 20% (< 30%)
      expect(result.reasoning).toContain('location count low');
    });
  });

  describe('edge cases', () => {
    it('handles world commits in resolvedKeys', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = { 'C-01': createCharacter('C-01') };
      narrative.locations = { 'L-01': createLocation('L-01') };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01'], locationId: 'L-01' }),
      };
      narrative.worldBuilds = {
        'WB-001': {
          id: 'WB-001',
          kind: 'world_build',
          summary: 'Test world build',
          expansionManifest: {
            characters: [],
            locations: [],
            threads: [],
            artifacts: [],
            relationships: [],
            worldKnowledge: { addedNodes: [], addedEdges: [] },
          },
        },
      };

      // resolvedKeys includes both scenes and world builds
      const result = computeWorldMetrics(narrative, ['WB-001', 'S-001']);

      // World builds should be filtered out
      expect(result.totalScenes).toBe(1);
    });

    it('handles missing scenes in resolvedKeys', () => {
      const narrative = createMinimalNarrative();
      narrative.characters = { 'C-01': createCharacter('C-01') };
      narrative.locations = { 'L-01': createLocation('L-01') };
      narrative.scenes = {
        'S-001': createScene('S-001', { participantIds: ['C-01'], locationId: 'L-01' }),
      };

      // S-002 doesn't exist
      const result = computeWorldMetrics(narrative, ['S-001', 'S-002', 'S-003']);

      expect(result.totalScenes).toBe(1);
    });
  });
});
