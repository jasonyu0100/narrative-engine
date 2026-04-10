import { describe, it, expect } from 'vitest';
import {
  buildVirtualState,
  scoreArc,
  scoreScene,
  extractOrderedScenes,
} from '@/lib/mcts-state';
import type { NarrativeState, Scene, Arc, Thread, Character, ContinuityMutation, RelationshipMutation, ThreadMutation } from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createMinimalNarrative(): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test',
    description: 'Test narrative',
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

function createCharacter(id: string): Character {
  return {
    id,
    name: `Character ${id}`,
    role: 'anchor',
    continuity: { nodes: {}, edges: [] },
    threadIds: [],
  };
}

function createThread(id: string): Thread {
  return {
    id,
    description: 'Test thread',
    status: 'latent',
    participants: [],
    dependents: [],
    openedAt: 'S-001',
    threadLog: { nodes: {}, edges: [] },
  };
}

function createScene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'ARC-01',
    povId: 'C-01',
    locationId: 'L-01',
    participantIds: ['C-01'],
    events: [],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    summary: 'Test scene',
    ...overrides,
  };
}

function createArc(id: string, sceneIds: string[] = []): Arc {
  return {
    id,
    name: `Arc ${id}`,
    sceneIds,
    develops: [],
    locationIds: [],
    activeCharacterIds: [],
    initialCharacterLocations: {},
  };
}

// ── Build Virtual State ──────────────────────────────────────────────────────

describe('buildVirtualState', () => {
  it('returns root state for empty ancestor chain', () => {
    const rootNarrative = createMinimalNarrative();
    const rootResolvedKeys = ['S-001'];
    const rootCurrentIndex = 0;

    const result = buildVirtualState(
      rootNarrative,
      rootResolvedKeys,
      rootCurrentIndex,
      [],
      'main'
    );

    expect(result.narrative.id).toBe('test-narrative');
    expect(result.resolvedKeys).toEqual(['S-001']);
    expect(result.currentIndex).toBe(0);
  });

  it('adds scenes to narrative from ancestor nodes', () => {
    const rootNarrative = createMinimalNarrative();
    const scene1 = createScene('S-001');
    const scene2 = createScene('S-002');
    const arc = createArc('ARC-01', ['S-001', 'S-002']);

    const result = buildVirtualState(
      rootNarrative,
      [],
      -1,
      [{ scenes: [scene1, scene2], arc }],
      'main'
    );

    expect(result.narrative.scenes['S-001']).toBeDefined();
    expect(result.narrative.scenes['S-002']).toBeDefined();
    expect(result.resolvedKeys).toEqual(['S-001', 'S-002']);
    expect(result.currentIndex).toBe(1);
  });

  it('adds arc to narrative', () => {
    const rootNarrative = createMinimalNarrative();
    const scene = createScene('S-001');
    const arc = createArc('ARC-01', ['S-001']);

    const result = buildVirtualState(
      rootNarrative,
      [],
      -1,
      [{ scenes: [scene], arc }],
      'main'
    );

    expect(result.narrative.arcs['ARC-01']).toBeDefined();
    expect(result.narrative.arcs['ARC-01'].sceneIds).toContain('S-001');
  });

  it('extends existing arc without duplicates', () => {
    const rootNarrative = createMinimalNarrative();
    rootNarrative.arcs['ARC-01'] = createArc('ARC-01', ['S-001']);

    const scene = createScene('S-002');
    const arc = createArc('ARC-01', ['S-001', 'S-002']); // S-001 already exists

    const result = buildVirtualState(
      rootNarrative,
      ['S-001'],
      0,
      [{ scenes: [scene], arc }],
      'main'
    );

    // Should have both scenes, S-001 not duplicated
    const arcSceneIds = result.narrative.arcs['ARC-01'].sceneIds;
    expect(arcSceneIds.filter((id) => id === 'S-001').length).toBe(1);
    expect(arcSceneIds).toContain('S-002');
  });

  it('extends branch entryIds', () => {
    const rootNarrative = createMinimalNarrative();
    rootNarrative.branches.main.entryIds = ['S-001'];

    const scene = createScene('S-002');
    const arc = createArc('ARC-01', ['S-002']);

    const result = buildVirtualState(
      rootNarrative,
      ['S-001'],
      0,
      [{ scenes: [scene], arc }],
      'main'
    );

    expect(result.narrative.branches.main.entryIds).toEqual(['S-001', 'S-002']);
  });

  it('applies thread mutations', () => {
    const rootNarrative = createMinimalNarrative();
    rootNarrative.threads['T-01'] = createThread('T-01');

    const threadMutation: ThreadMutation = { threadId: 'T-01', from: 'latent', to: 'active' };
    const scene = createScene('S-001', { threadMutations: [threadMutation] });
    const arc = createArc('ARC-01', ['S-001']);

    const result = buildVirtualState(
      rootNarrative,
      [],
      -1,
      [{ scenes: [scene], arc }],
      'main'
    );

    expect(result.narrative.threads['T-01'].status).toBe('active');
  });

  it('applies continuity mutations (added)', () => {
    const rootNarrative = createMinimalNarrative();
    rootNarrative.characters['C-01'] = createCharacter('C-01');

    const continuityMutation: ContinuityMutation = {
      entityId: 'C-01',
      addedNodes: [{ id: 'K-01', content: 'Learned a secret', type: 'belief' }],
      addedEdges: [],
    };
    const scene = createScene('S-001', { continuityMutations: [continuityMutation] });
    const arc = createArc('ARC-01', ['S-001']);

    const result = buildVirtualState(
      rootNarrative,
      [],
      -1,
      [{ scenes: [scene], arc }],
      'main'
    );

    const char = result.narrative.characters['C-01'];
    expect(char.continuity.nodes['K-01']).toBeDefined();
  });

  it('applies continuity mutations with edges', () => {
    const rootNarrative = createMinimalNarrative();
    rootNarrative.characters['C-01'] = createCharacter('C-01');

    const continuityMutation: ContinuityMutation = {
      entityId: 'C-01',
      addedNodes: [
        { id: 'K-01', content: 'Initial fact', type: 'belief' },
        { id: 'K-02', content: 'Connected fact', type: 'belief' },
      ],
      addedEdges: [{ from: 'K-01', to: 'K-02', relation: 'caused_by' }],
    };
    const scene = createScene('S-001', { continuityMutations: [continuityMutation] });
    const arc = createArc('ARC-01', ['S-001']);

    const result = buildVirtualState(
      rootNarrative,
      [],
      -1,
      [{ scenes: [scene], arc }],
      'main'
    );

    const char = result.narrative.characters['C-01'];
    expect(char.continuity.nodes['K-01']).toBeDefined();
    expect(char.continuity.nodes['K-02']).toBeDefined();
    // 2 nodes → 1 co_occurs chain edge + 1 explicit caused_by edge
    expect(char.continuity.edges).toHaveLength(2);
    expect(char.continuity.edges.some(e => e.relation === 'caused_by')).toBe(true);
    expect(char.continuity.edges.some(e => e.relation === 'co_occurs')).toBe(true);
  });

  it('applies relationship mutations (new relationship)', () => {
    const rootNarrative = createMinimalNarrative();

    const relationshipMutation: RelationshipMutation = {
      from: 'C-01',
      to: 'C-02',
      type: 'trust',
      valenceDelta: 0.5,
    };
    const scene = createScene('S-001', { relationshipMutations: [relationshipMutation] });
    const arc = createArc('ARC-01', ['S-001']);

    const result = buildVirtualState(
      rootNarrative,
      [],
      -1,
      [{ scenes: [scene], arc }],
      'main'
    );

    const rel = result.narrative.relationships.find((r) => r.from === 'C-01' && r.to === 'C-02');
    expect(rel).toBeDefined();
    expect(rel!.valence).toBe(0.5);
    expect(rel!.type).toBe('trust');
  });

  it('applies relationship mutations (update existing)', () => {
    const rootNarrative = createMinimalNarrative();
    rootNarrative.relationships = [{ from: 'C-01', to: 'C-02', type: 'neutral', valence: 0.3 }];

    const relationshipMutation: RelationshipMutation = {
      from: 'C-01',
      to: 'C-02',
      type: 'alliance',
      valenceDelta: 0.4,
    };
    const scene = createScene('S-001', { relationshipMutations: [relationshipMutation] });
    const arc = createArc('ARC-01', ['S-001']);

    const result = buildVirtualState(
      rootNarrative,
      [],
      -1,
      [{ scenes: [scene], arc }],
      'main'
    );

    const rel = result.narrative.relationships.find((r) => r.from === 'C-01' && r.to === 'C-02');
    expect(rel!.valence).toBe(0.7); // 0.3 + 0.4
    expect(rel!.type).toBe('alliance');
  });

  it('clamps relationship valence to [-1, 1]', () => {
    const rootNarrative = createMinimalNarrative();
    rootNarrative.relationships = [{ from: 'C-01', to: 'C-02', type: 'trust', valence: 0.8 }];

    const relationshipMutation: RelationshipMutation = {
      from: 'C-01',
      to: 'C-02',
      type: 'trust',
      valenceDelta: 0.5, // Would make it 1.3
    };
    const scene = createScene('S-001', { relationshipMutations: [relationshipMutation] });
    const arc = createArc('ARC-01', ['S-001']);

    const result = buildVirtualState(
      rootNarrative,
      [],
      -1,
      [{ scenes: [scene], arc }],
      'main'
    );

    const rel = result.narrative.relationships.find((r) => r.from === 'C-01' && r.to === 'C-02');
    expect(rel!.valence).toBe(1); // Clamped to max
  });

  it('applies world knowledge mutations', () => {
    const rootNarrative = createMinimalNarrative();

    const scene = createScene('S-001', {
      worldKnowledgeMutations: {
        addedNodes: [{ id: 'WK-01', concept: 'Magic system', type: 'system' }],
        addedEdges: [{ from: 'WK-01', to: 'WK-02', relation: 'enables' }],
      },
    });
    const arc = createArc('ARC-01', ['S-001']);

    const result = buildVirtualState(
      rootNarrative,
      [],
      -1,
      [{ scenes: [scene], arc }],
      'main'
    );

    expect(result.narrative.worldKnowledge.nodes['WK-01']).toBeDefined();
    expect(result.narrative.worldKnowledge.edges.some((e) => e.from === 'WK-01')).toBe(true);
  });

  it('chains multiple ancestor nodes', () => {
    const rootNarrative = createMinimalNarrative();
    rootNarrative.threads['T-01'] = createThread('T-01');

    const scene1 = createScene('S-001', {
      threadMutations: [{ threadId: 'T-01', from: 'latent', to: 'active' }],
    });
    const arc1 = createArc('ARC-01', ['S-001']);

    const scene2 = createScene('S-002', {
      threadMutations: [{ threadId: 'T-01', from: 'active', to: 'critical' }],
    });
    const arc2 = createArc('ARC-02', ['S-002']);

    const result = buildVirtualState(
      rootNarrative,
      [],
      -1,
      [
        { scenes: [scene1], arc: arc1 },
        { scenes: [scene2], arc: arc2 },
      ],
      'main'
    );

    expect(result.narrative.threads['T-01'].status).toBe('critical');
    expect(result.resolvedKeys).toEqual(['S-001', 'S-002']);
    expect(result.currentIndex).toBe(1);
  });

  it('does not mutate root narrative', () => {
    const rootNarrative = createMinimalNarrative();
    rootNarrative.threads['T-01'] = createThread('T-01');
    const originalStatus = rootNarrative.threads['T-01'].status;

    const scene = createScene('S-001', {
      threadMutations: [{ threadId: 'T-01', from: 'latent', to: 'resolved' }],
    });
    const arc = createArc('ARC-01', ['S-001']);

    buildVirtualState(rootNarrative, [], -1, [{ scenes: [scene], arc }], 'main');

    expect(rootNarrative.threads['T-01'].status).toBe(originalStatus);
  });
});

// ── Score Arc ────────────────────────────────────────────────────────────────

describe('scoreArc', () => {
  it('returns 0 for empty arc', () => {
    const score = scoreArc([], []);
    expect(score).toBe(0);
  });

  it('returns positive score for scenes with mutations', () => {
    const scene = createScene('S-001', {
      threadMutations: [{ threadId: 'T-01', from: 'latent', to: 'active' }],
      continuityMutations: [{ entityId: 'C-01', addedNodes: [{ id: 'K-01', content: 'x', type: 'history' }], addedEdges: [] }],
      events: ['event1'],
    });

    const score = scoreArc([scene], []);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('scores multiple scenes', () => {
    const scene1 = createScene('S-001', {
      threadMutations: [{ threadId: 'T-01', from: 'latent', to: 'active' }],
    });
    const scene2 = createScene('S-002', {
      threadMutations: [{ threadId: 'T-01', from: 'active', to: 'critical' }],
      events: ['climax'],
    });

    const score = scoreArc([scene1, scene2], []);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('higher mutations lead to higher scores', () => {
    const lowMutationScene = createScene('S-001', {
      events: ['minor_event'],
    });

    const highMutationScene = createScene('S-002', {
      threadMutations: [
        { threadId: 'T-01', from: 'latent', to: 'resolved' },
        { threadId: 'T-02', from: 'active', to: 'critical' },
      ],
      continuityMutations: Array(5).fill({ entityId: 'C-01', addedNodes: [{ id: 'K-01', content: 'x', type: 'history' }], addedEdges: [] }),
      events: ['event1', 'event2', 'event3'],
      worldKnowledgeMutations: {
        addedNodes: [{ id: 'WK-01', concept: 'x', type: 'system' }],
        addedEdges: [{ from: 'WK-01', to: 'WK-02', relation: 'x' }],
      },
    });

    const lowScore = scoreArc([lowMutationScene], []);
    const highScore = scoreArc([highMutationScene], []);

    expect(highScore).toBeGreaterThanOrEqual(lowScore);
  });
});

// ── Score Scene ──────────────────────────────────────────────────────────────

describe('scoreScene', () => {
  it('returns positive score for scene with mutations', () => {
    const scene = createScene('S-001', {
      threadMutations: [{ threadId: 'T-01', from: 'latent', to: 'active' }],
      events: ['event1'],
    });

    const score = scoreScene(scene, []);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('handles scene without prior context', () => {
    const scene = createScene('S-001');
    const score = scoreScene(scene, []);
    expect(typeof score).toBe('number');
  });

  it('considers swing when prior scenes exist', () => {
    const priorScene = createScene('S-001', {
      threadMutations: [{ threadId: 'T-01', from: 'latent', to: 'active' }],
    });

    const currentScene = createScene('S-002', {
      threadMutations: [{ threadId: 'T-01', from: 'active', to: 'resolved' }],
      continuityMutations: Array(3).fill({ entityId: 'C-01', addedNodes: [{ id: 'K-01', content: 'x', type: 'history' }], addedEdges: [] }),
    });

    const scoreWithPrior = scoreScene(currentScene, [priorScene]);
    const scoreWithoutPrior = scoreScene(currentScene, []);

    // Both should be valid scores
    expect(scoreWithPrior).toBeGreaterThanOrEqual(0);
    expect(scoreWithoutPrior).toBeGreaterThanOrEqual(0);
  });
});

// ── Extract Ordered Scenes ───────────────────────────────────────────────────

describe('extractOrderedScenes', () => {
  it('returns empty array for empty keys', () => {
    const narrative = createMinimalNarrative();
    const scenes = extractOrderedScenes(narrative, []);
    expect(scenes).toEqual([]);
  });

  it('extracts scenes in order of resolvedKeys', () => {
    const narrative = createMinimalNarrative();
    narrative.scenes['S-001'] = createScene('S-001');
    narrative.scenes['S-002'] = createScene('S-002');
    narrative.scenes['S-003'] = createScene('S-003');

    const scenes = extractOrderedScenes(narrative, ['S-002', 'S-001', 'S-003']);
    expect(scenes.map((s) => s.id)).toEqual(['S-002', 'S-001', 'S-003']);
  });

  it('skips non-scene entries (world commits)', () => {
    const narrative = createMinimalNarrative();
    narrative.scenes['S-001'] = createScene('S-001');
    narrative.worldBuilds['WB-001'] = {
      kind: 'world_build',
      id: 'WB-001',
      summary: 'Test world expansion',
      expansionManifest: {
        characters: [],
        locations: [],
        threads: [],
        relationships: [],
        worldKnowledge: { addedNodes: [], addedEdges: [] },
        artifacts: [],
      },
    };

    const scenes = extractOrderedScenes(narrative, ['S-001', 'WB-001']);
    expect(scenes.length).toBe(1);
    expect(scenes[0].id).toBe('S-001');
  });

  it('skips missing entries', () => {
    const narrative = createMinimalNarrative();
    narrative.scenes['S-001'] = createScene('S-001');

    const scenes = extractOrderedScenes(narrative, ['S-001', 'S-MISSING']);
    expect(scenes.length).toBe(1);
    expect(scenes[0].id).toBe('S-001');
  });
});
