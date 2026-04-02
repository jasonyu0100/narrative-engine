import { describe, it, expect } from 'vitest';
import {
  getStateAtIndex,
  buildStorySettingsBlock,
  narrativeContext,
  sceneContext,
  sceneScale,
  deriveLogicRules,
  logicContext,
  outlineContext,
  worldContext,
  THREAD_LIFECYCLE_DOC,
} from '@/lib/ai/context';
import type { NarrativeState, Scene, Character, Location, Thread, Arc, WorldBuild } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createMinimalNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test Story',
    description: 'Test description',
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
    worldSummary: 'A test world',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createCharacter(id: string, name: string, role: string = 'recurring'): Character {
  return {
    id,
    name,
    role: role as 'anchor' | 'recurring' | 'transient',
    continuity: { nodes: [] },
    threadIds: [],
  };
}

function createLocation(id: string, name: string, parentId?: string): Location {
  return {
    id,
    name,
    parentId: parentId ?? null,
    continuity: { nodes: [] },
    threadIds: [],
  };
}

function createThread(id: string, description: string, participants: string[] = []): Thread {
  return {
    id,
    description,
    status: 'dormant',
    participants: participants.map((pid) => ({ id: pid, type: 'character' as const })),
    dependents: [],
    openedAt: 's1',
  };
}

function createScene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    povId: 'char-1',
    locationId: 'loc-1',
    participantIds: ['char-1'],
    summary: 'Test scene summary',
    events: [],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    characterMovements: {},
    ...overrides,
  };
}

function createWorldBuild(id: string, summary: string): WorldBuild {
  return {
    kind: 'world_build',
    id,
    summary,
    expansionManifest: {
      characters: [],
      locations: [],
      threads: [],
      artifacts: [],
      relationships: [],
      worldKnowledge: { addedNodes: [], addedEdges: [] },
    },
  };
}

function createArc(id: string, name: string, sceneIds: string[]): Arc {
  return {
    id,
    name,
    sceneIds,
    develops: [],
    locationIds: [],
    activeCharacterIds: [],
    initialCharacterLocations: {},
  };
}

// ── THREAD_LIFECYCLE_DOC ─────────────────────────────────────────────────────

describe('THREAD_LIFECYCLE_DOC', () => {
  it('contains active statuses', () => {
    expect(THREAD_LIFECYCLE_DOC).toContain('Active statuses');
    expect(THREAD_LIFECYCLE_DOC).toContain('dormant');
    expect(THREAD_LIFECYCLE_DOC).toContain('active');
    expect(THREAD_LIFECYCLE_DOC).toContain('escalating');
    expect(THREAD_LIFECYCLE_DOC).toContain('critical');
  });

  it('contains terminal statuses', () => {
    expect(THREAD_LIFECYCLE_DOC).toContain('Terminal');
    expect(THREAD_LIFECYCLE_DOC).toContain('resolved');
    expect(THREAD_LIFECYCLE_DOC).toContain('subverted');
    expect(THREAD_LIFECYCLE_DOC).toContain('abandoned');
  });
});

// ── getStateAtIndex ──────────────────────────────────────────────────────────

describe('getStateAtIndex', () => {
  it('returns empty state for empty narrative', () => {
    const n = createMinimalNarrative();
    const state = getStateAtIndex(n, [], 0);

    expect(state.liveNodeIds.size).toBe(0);
    expect(state.relationships.length).toBe(0);
    expect(Object.keys(state.threadStatuses).length).toBe(0);
    expect(Object.keys(state.artifactOwnership).length).toBe(0);
  });

  it('replays continuity mutations correctly', () => {
    const n = createMinimalNarrative({
      scenes: {
        's1': createScene('s1', {
          continuityMutations: [
            { characterId: 'c1', nodeId: 'node-1', action: 'added', content: 'Knowledge 1', nodeType: 'knowledge' },
          ],
        }),
        's2': createScene('s2', {
          continuityMutations: [
            { characterId: 'c1', nodeId: 'node-2', action: 'added', content: 'Knowledge 2', nodeType: 'knowledge' },
          ],
        }),
        's3': createScene('s3', {
          continuityMutations: [
            { characterId: 'c1', nodeId: 'node-1', action: 'removed', content: 'Knowledge 1', nodeType: 'knowledge' },
          ],
        }),
      },
    });

    // At index 1 (after s1, s2), both nodes exist
    const stateAt1 = getStateAtIndex(n, ['s1', 's2'], 1);
    expect(stateAt1.liveNodeIds.has('node-1')).toBe(true);
    expect(stateAt1.liveNodeIds.has('node-2')).toBe(true);

    // At index 2 (after s3), node-1 is removed
    const stateAt2 = getStateAtIndex(n, ['s1', 's2', 's3'], 2);
    expect(stateAt2.liveNodeIds.has('node-1')).toBe(false);
    expect(stateAt2.liveNodeIds.has('node-2')).toBe(true);
  });

  it('replays relationship mutations correctly', () => {
    const n = createMinimalNarrative({
      scenes: {
        's1': createScene('s1', {
          relationshipMutations: [
            { from: 'c1', to: 'c2', type: 'ally', valenceDelta: 0.5 },
          ],
        }),
        's2': createScene('s2', {
          relationshipMutations: [
            { from: 'c1', to: 'c2', type: 'rival', valenceDelta: -0.3 },
          ],
        }),
      },
    });

    const state = getStateAtIndex(n, ['s1', 's2'], 1);
    expect(state.relationships.length).toBe(1);
    expect(state.relationships[0].valence).toBeCloseTo(0.2); // 0.5 + (-0.3) = 0.2
    expect(state.relationships[0].type).toBe('rival'); // latest type
  });

  it('clamps relationship valence between -1 and 1', () => {
    const n = createMinimalNarrative({
      scenes: {
        's1': createScene('s1', {
          relationshipMutations: [
            { from: 'c1', to: 'c2', type: 'ally', valenceDelta: 0.8 },
          ],
        }),
        's2': createScene('s2', {
          relationshipMutations: [
            { from: 'c1', to: 'c2', type: 'ally', valenceDelta: 0.5 },
          ],
        }),
      },
    });

    const state = getStateAtIndex(n, ['s1', 's2'], 1);
    expect(state.relationships[0].valence).toBe(1); // Clamped at 1
  });

  it('replays thread mutations correctly', () => {
    const n = createMinimalNarrative({
      scenes: {
        's1': createScene('s1', {
          threadMutations: [
            { threadId: 't1', from: 'dormant', to: 'active' },
          ],
        }),
        's2': createScene('s2', {
          threadMutations: [
            { threadId: 't1', from: 'active', to: 'escalating' },
            { threadId: 't2', from: 'dormant', to: 'active' },
          ],
        }),
      },
    });

    const state = getStateAtIndex(n, ['s1', 's2'], 1);
    expect(state.threadStatuses['t1']).toBe('escalating');
    expect(state.threadStatuses['t2']).toBe('active');
  });

  it('tracks artifact ownership from world builds', () => {
    const n = createMinimalNarrative({
      worldBuilds: {
        'wb1': {
          kind: 'world_build',
          id: 'wb1',
          summary: 'World build 1',
          expansionManifest: {
            characters: [],
            locations: [],
            threads: [],
            artifacts: [{ id: 'art-1', name: 'Artifact', significance: 'minor' as const, continuity: { nodes: [] }, parentId: 'c1' }],
            relationships: [],
            worldKnowledge: { addedNodes: [], addedEdges: [] },
          },
        },
      },
      scenes: {
        's1': createScene('s1', {
          ownershipMutations: [
            { artifactId: 'art-1', fromId: 'c1', toId: 'c2' },
          ],
        }),
      },
    });

    // After world build only
    const state0 = getStateAtIndex(n, ['wb1'], 0);
    expect(state0.artifactOwnership['art-1']).toBe('c1');

    // After ownership transfer
    const state1 = getStateAtIndex(n, ['wb1', 's1'], 1);
    expect(state1.artifactOwnership['art-1']).toBe('c2');
  });
});

// ── buildStorySettingsBlock ──────────────────────────────────────────────────

describe('buildStorySettingsBlock', () => {
  it('returns empty string for default settings', () => {
    const n = createMinimalNarrative();
    const block = buildStorySettingsBlock(n);
    expect(block).toBe('');
  });

  it('includes POV mode when not free', () => {
    const n = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, povMode: 'single', povCharacterIds: ['c1'] },
      characters: { c1: createCharacter('c1', 'Hero') },
    });
    const block = buildStorySettingsBlock(n);
    expect(block).toContain('SINGLE POV');
    expect(block).toContain('Hero');
  });

  it('includes pareto POV guidance', () => {
    const n = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, povMode: 'pareto', povCharacterIds: ['c1'] },
      characters: { c1: createCharacter('c1', 'Protagonist') },
    });
    const block = buildStorySettingsBlock(n);
    expect(block).toContain('PARETO POV');
    expect(block).toContain('Protagonist');
    expect(block).toContain('80%');
  });

  it('includes story direction when set', () => {
    const n = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, storyDirection: 'The hero must defeat the villain' },
    });
    const block = buildStorySettingsBlock(n);
    expect(block).toContain('STORY DIRECTION');
    expect(block).toContain('defeat the villain');
  });

  it('includes story constraints when set', () => {
    const n = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, storyConstraints: 'No character deaths' },
    });
    const block = buildStorySettingsBlock(n);
    expect(block).toContain('STORY CONSTRAINTS');
    expect(block).toContain('No character deaths');
  });

  it('includes narrative guidance when set', () => {
    const n = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, narrativeGuidance: 'Keep scenes tight and focused' },
    });
    const block = buildStorySettingsBlock(n);
    expect(block).toContain('NARRATIVE GUIDANCE');
    expect(block).toContain('tight and focused');
  });
});

// ── sceneScale ───────────────────────────────────────────────────────────────

describe('sceneScale', () => {
  it('returns minimum 600 words for simple scene', () => {
    const scene = createScene('s1', {
      events: [],
      threadMutations: [],
      continuityMutations: [],
      relationshipMutations: [],
      participantIds: ['c1'],
      summary: 'A short summary',
    });

    const scale = sceneScale(scene);
    expect(scale.estWords).toBeGreaterThanOrEqual(600);
  });

  it('scales up for complex scenes', () => {
    const simpleScene = createScene('s1', {
      events: ['Event 1'],
      threadMutations: [],
      continuityMutations: [],
      relationshipMutations: [],
      participantIds: ['c1'],
      summary: 'Short',
    });

    const complexScene = createScene('s2', {
      events: ['Event 1', 'Event 2', 'Event 3', 'Event 4'],
      threadMutations: [
        { threadId: 't1', from: 'dormant', to: 'active' },
        { threadId: 't2', from: 'active', to: 'escalating' },
      ],
      continuityMutations: [
        { characterId: 'c1', nodeId: 'n1', action: 'added', content: 'Knowledge', nodeType: 'knowledge' },
        { characterId: 'c2', nodeId: 'n2', action: 'added', content: 'Knowledge 2', nodeType: 'knowledge' },
      ],
      relationshipMutations: [
        { from: 'c1', to: 'c2', type: 'ally', valenceDelta: 0.5 },
      ],
      participantIds: ['c1', 'c2', 'c3', 'c4'],
      summary: 'A much longer and more detailed summary that describes many things happening in this scene with great detail and complexity',
      characterMovements: { c1: { locationId: 'loc-2', transition: 'walked to' } },
    });

    const simpleScale = sceneScale(simpleScene);
    const complexScale = sceneScale(complexScene);

    expect(complexScale.estWords).toBeGreaterThan(simpleScale.estWords);
  });

  it('returns planWords range based on estWords', () => {
    const scene = createScene('s1', {
      events: ['Event 1', 'Event 2'],
      threadMutations: [{ threadId: 't1', from: 'dormant', to: 'active' }],
      participantIds: ['c1', 'c2'],
    });

    const scale = sceneScale(scene);
    expect(scale.planWords).toMatch(/^\d+-\d+$/);

    // Parse the range and check proportions
    const [min, max] = scale.planWords.split('-').map(Number);
    expect(min).toBeCloseTo(scale.estWords * 0.3, -1);
    expect(max).toBeCloseTo(scale.estWords * 0.5, -1);
  });

  it('adds complexity for long summaries', () => {
    const shortSummary = createScene('s1', { summary: 'Short' });
    const longSummary = createScene('s2', { summary: 'x'.repeat(500) });

    const shortScale = sceneScale(shortSummary);
    const longScale = sceneScale(longSummary);

    expect(longScale.estWords).toBeGreaterThan(shortScale.estWords);
  });
});

// ── sceneContext ─────────────────────────────────────────────────────────────

describe('sceneContext', () => {
  it('includes scene summary', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero', 'anchor') },
      locations: { loc1: createLocation('loc1', 'Castle') },
    });
    const scene = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      participantIds: ['c1'],
      summary: 'The hero arrives at the castle',
    });

    const ctx = sceneContext(n, scene);
    expect(ctx).toContain('The hero arrives at the castle');
    expect(ctx).toContain('Hero');
    expect(ctx).toContain('Castle');
  });

  it('includes events', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
    });
    const scene = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      events: ['The gate opens', 'Guards appear'],
    });

    const ctx = sceneContext(n, scene);
    expect(ctx).toContain('The gate opens');
    expect(ctx).toContain('Guards appear');
  });

  it('includes thread mutations', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
      threads: { t1: createThread('t1', 'The Quest for the Sword') },
    });
    const scene = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      threadMutations: [{ threadId: 't1', from: 'dormant', to: 'active' }],
    });

    const ctx = sceneContext(n, scene);
    expect(ctx).toContain('Quest for the Sword');
    expect(ctx).toContain('dormant');
    expect(ctx).toContain('active');
  });

  it('includes relationship mutations', () => {
    const n = createMinimalNarrative({
      characters: {
        c1: createCharacter('c1', 'Hero'),
        c2: createCharacter('c2', 'Mentor'),
      },
      locations: { loc1: createLocation('loc1', 'Castle') },
    });
    const scene = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      participantIds: ['c1', 'c2'],
      relationshipMutations: [
        { from: 'c1', to: 'c2', type: 'mentor', valenceDelta: 0.3 },
      ],
    });

    const ctx = sceneContext(n, scene);
    expect(ctx).toContain('Hero');
    expect(ctx).toContain('Mentor');
    expect(ctx).toContain('0.3');
  });
});

// ── deriveLogicRules / logicContext ──────────────────────────────────────────

describe('deriveLogicRules', () => {
  it('returns empty string for scene with no special constraints', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
    });
    const scene = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      participantIds: ['c1'],
      events: [],
      threadMutations: [],
      continuityMutations: [],
      relationshipMutations: [],
    });

    const rules = deriveLogicRules(n, scene);
    expect(rules).toBe('');
  });

  it('includes thread transitions when present', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
      threads: { t1: createThread('t1', 'The Quest') },
    });
    const scene = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      threadMutations: [{ threadId: 't1', from: 'dormant', to: 'active' }],
    });

    const rules = deriveLogicRules(n, scene);
    expect(rules).toContain('The Quest');
    expect(rules).toContain('dormant');
    expect(rules).toContain('active');
  });

  it('includes events when present', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
    });
    const scene = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      events: ['The dragon attacks', 'Hero draws sword'],
    });

    const rules = deriveLogicRules(n, scene);
    expect(rules).toContain('dragon attacks');
    expect(rules).toContain('draws sword');
  });
});

describe('logicContext', () => {
  it('delegates to deriveLogicRules', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
    });
    const scene = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      events: ['Event 1'],
    });

    const rules = deriveLogicRules(n, scene, ['s1'], 0);
    const ctx = logicContext(n, scene, ['s1'], 0);

    expect(ctx).toBe(rules);
  });
});

// ── outlineContext ───────────────────────────────────────────────────────────

describe('outlineContext', () => {
  it('groups scenes by arc', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
      scenes: {
        s1: createScene('s1', { povId: 'c1', locationId: 'loc1', arcId: 'arc-1', summary: 'Scene 1 summary' }),
        s2: createScene('s2', { povId: 'c1', locationId: 'loc1', arcId: 'arc-1', summary: 'Scene 2 summary' }),
      },
      arcs: {
        'arc-1': createArc('arc-1', 'Act I', ['s1', 's2']),
      },
    });

    const outline = outlineContext(n, ['s1', 's2'], 1);
    expect(outline).toContain('Act I');
    expect(outline).toContain('Scene 1 summary');
    expect(outline).toContain('Scene 2 summary');
  });

  it('includes world commits as markers', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
      scenes: {
        s1: createScene('s1', { summary: 'Scene 1' }),
      },
      worldBuilds: {
        wb1: createWorldBuild('wb1', 'World expansion'),
      },
      arcs: {
        'arc-1': createArc('arc-1', 'Act I', ['s1']),
      },
    });

    const outline = outlineContext(n, ['wb1', 's1'], 1);
    expect(outline).toContain('world-commit');
    expect(outline).toContain('World expansion');
  });
});

// ── worldContext ─────────────────────────────────────────────────────────────

describe('worldContext', () => {
  it('includes world summary', () => {
    const n = createMinimalNarrative({
      worldSummary: 'A magical realm of wonder',
    });

    const ctx = worldContext(n, [], 0);
    expect(ctx).toContain('magical realm of wonder');
  });

  it('includes world rules when present', () => {
    const n = createMinimalNarrative({
      rules: ['Magic has a cost', 'Time flows differently'],
    });

    const ctx = worldContext(n, [], 0);
    expect(ctx).toContain('Magic has a cost');
    expect(ctx).toContain('Time flows differently');
  });

  it('includes world commits in chronological order', () => {
    const n = createMinimalNarrative({
      worldBuilds: {
        wb1: createWorldBuild('wb1', 'First expansion'),
        wb2: createWorldBuild('wb2', 'Second expansion'),
      },
    });

    const ctx = worldContext(n, ['wb1', 'wb2'], 1);
    expect(ctx).toContain('First expansion');
    expect(ctx).toContain('Second expansion');
    // Check ordering by finding indices
    const first = ctx.indexOf('First expansion');
    const second = ctx.indexOf('Second expansion');
    expect(first).toBeLessThan(second);
  });
});

// ── narrativeContext ─────────────────────────────────────────────────────────

describe('narrativeContext', () => {
  it('includes narrative title', () => {
    const n = createMinimalNarrative({ title: 'Epic Adventure' });
    const ctx = narrativeContext(n, [], 0);
    expect(ctx).toContain('Epic Adventure');
  });

  it('includes world summary', () => {
    const n = createMinimalNarrative({
      worldSummary: 'A land of mystery and magic',
    });
    const ctx = narrativeContext(n, [], 0);
    expect(ctx).toContain('mystery and magic');
  });

  it('includes characters', () => {
    const n = createMinimalNarrative({
      characters: {
        c1: createCharacter('c1', 'Hero', 'anchor'),
        c2: createCharacter('c2', 'Sidekick', 'supporting'),
      },
    });
    const ctx = narrativeContext(n, [], 0);
    expect(ctx).toContain('Hero');
    expect(ctx).toContain('Sidekick');
  });

  it('includes locations', () => {
    const n = createMinimalNarrative({
      locations: {
        loc1: createLocation('loc1', 'Castle'),
        loc2: createLocation('loc2', 'Forest'),
      },
    });
    const ctx = narrativeContext(n, [], 0);
    expect(ctx).toContain('Castle');
    expect(ctx).toContain('Forest');
  });

  it('includes threads', () => {
    const n = createMinimalNarrative({
      threads: {
        t1: createThread('t1', 'The Quest for Glory'),
        t2: createThread('t2', 'Romance Subplot'),
      },
    });
    const ctx = narrativeContext(n, [], 0);
    expect(ctx).toContain('Quest for Glory');
    expect(ctx).toContain('Romance Subplot');
  });

  it('includes valid-ids section', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
      threads: { t1: createThread('t1', 'Quest') },
    });
    const ctx = narrativeContext(n, [], 0);
    expect(ctx).toContain('valid-ids');
    expect(ctx).toContain('c1');
    expect(ctx).toContain('loc1');
    expect(ctx).toContain('t1');
  });

  it('includes scene history', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
      scenes: {
        s1: createScene('s1', {
          povId: 'c1',
          locationId: 'loc1',
          summary: 'Hero enters the castle',
        }),
        s2: createScene('s2', {
          povId: 'c1',
          locationId: 'loc1',
          summary: 'Hero meets the king',
        }),
      },
    });
    const ctx = narrativeContext(n, ['s1', 's2'], 1);
    expect(ctx).toContain('Hero enters the castle');
    expect(ctx).toContain('Hero meets the king');
  });
});
