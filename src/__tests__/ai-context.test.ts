import { describe, it, expect } from 'vitest';
import {
  getStateAtIndex,
  buildStorySettingsBlock,
  classifyTier,
  narrativeContext,
  sceneContext,
  sceneScale,
  outlineContext,
  THREAD_LIFECYCLE_DOC,
  tierOfOrigin,
} from '@/lib/ai/context';
import { NEAR_RECENCY_ZONE, MID_RECENCY_ZONE } from '@/lib/constants';
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
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: 'A test world',
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
    world: { nodes: {}, edges: [] },
    threadIds: [],
  };
}
function createLocation(id: string, name: string, parentId?: string): Location {
  return {
    id,
    name,
    prominence: 'place' as const,
    parentId: parentId ?? null,
    tiedCharacterIds: [],
    world: { nodes: {}, edges: [] },
    threadIds: [],
  };
}
function createThread(id: string, description: string, participants: string[] = []): Thread {
  return {
    id,
    description,
    status: 'latent',
    participants: participants.map((pid) => ({ id: pid, type: 'character' as const })),
    dependents: [],
    openedAt: 's1',
    threadLog: { nodes: {}, edges: [] },
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
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
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
      newCharacters: [],
      newLocations: [],
      newThreads: [],
      newArtifacts: [],
      systemDeltas: { addedNodes: [], addedEdges: [] },
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
    expect(THREAD_LIFECYCLE_DOC).toContain('latent');
    expect(THREAD_LIFECYCLE_DOC).toContain('active');
    expect(THREAD_LIFECYCLE_DOC).toContain('critical');
  });
  it('contains terminal statuses', () => {
    expect(THREAD_LIFECYCLE_DOC).toContain('Terminal');
    expect(THREAD_LIFECYCLE_DOC).toContain('resolved');
    expect(THREAD_LIFECYCLE_DOC).toContain('subverted');
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
  it('replays world deltas correctly (additive)', () => {
    const n = createMinimalNarrative({
      scenes: {
        's1': createScene('s1', {
          worldDeltas: [
            { entityId: 'c1', addedNodes: [{ id: 'node-1', content: 'Knowledge 1', type: 'belief' }] },
          ],
        }),
        's2': createScene('s2', {
          worldDeltas: [
            { entityId: 'c1', addedNodes: [{ id: 'node-2', content: 'Knowledge 2', type: 'belief' }] },
          ],
        }),
      },
    });
    // At index 0 (after s1), only node-1 exists
    const stateAt0 = getStateAtIndex(n, ['s1', 's2'], 0);
    expect(stateAt0.liveNodeIds.has('node-1')).toBe(true);
    expect(stateAt0.liveNodeIds.has('node-2')).toBe(false);
    // At index 1 (after s1, s2), both nodes and edge exist
    const stateAt1 = getStateAtIndex(n, ['s1', 's2'], 1);
    expect(stateAt1.liveNodeIds.has('node-1')).toBe(true);
    expect(stateAt1.liveNodeIds.has('node-2')).toBe(true);
  });
  it('replays relationship deltas correctly', () => {
    const n = createMinimalNarrative({
      scenes: {
        's1': createScene('s1', {
          relationshipDeltas: [
            { from: 'c1', to: 'c2', type: 'ally', valenceDelta: 0.5 },
          ],
        }),
        's2': createScene('s2', {
          relationshipDeltas: [
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
          relationshipDeltas: [
            { from: 'c1', to: 'c2', type: 'ally', valenceDelta: 0.8 },
          ],
        }),
        's2': createScene('s2', {
          relationshipDeltas: [
            { from: 'c1', to: 'c2', type: 'ally', valenceDelta: 0.5 },
          ],
        }),
      },
    });
    const state = getStateAtIndex(n, ['s1', 's2'], 1);
    expect(state.relationships[0].valence).toBe(1); // Clamped at 1
  });
  it('replays thread deltas correctly', () => {
    const n = createMinimalNarrative({
      scenes: {
        's1': createScene('s1', {
          threadDeltas: [
            { threadId: 't1', from: 'latent', to: 'active', addedNodes: [] },
          ],
        }),
        's2': createScene('s2', {
          threadDeltas: [
            { threadId: 't1', from: 'active', to: 'active', addedNodes: [] },
            { threadId: 't2', from: 'latent', to: 'active', addedNodes: [] },
          ],
        }),
      },
    });
    const state = getStateAtIndex(n, ['s1', 's2'], 1);
    expect(state.threadStatuses['t1']).toBe('active');
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
            newCharacters: [],
            newLocations: [],
            newThreads: [],
            newArtifacts: [{ id: 'art-1', name: 'Artifact', significance: 'minor' as const, world: { nodes: {}, edges: [] }, parentId: 'c1', threadIds: [] }],
            systemDeltas: { addedNodes: [], addedEdges: [] },
          },
        },
      },
      scenes: {
        's1': createScene('s1', {
          ownershipDeltas: [
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
      threadDeltas: [],
      worldDeltas: [],
      relationshipDeltas: [],
      participantIds: ['c1'],
      summary: 'A short summary',
    });
    const scale = sceneScale(scene);
    expect(scale.estWords).toBeGreaterThanOrEqual(600);
  });
  it('returns standard scale values', () => {
    const scene = createScene('s1');
    const scale = sceneScale(scene);
    expect(scale.estWords).toBe(1200);
    expect(scale.planWords).toMatch(/^\d+-\d+$/);
    const [min, max] = scale.planWords.split('-').map(Number);
    expect(min).toBe(360);
    expect(max).toBe(600);
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
  it('includes thread deltas', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
      threads: { t1: createThread('t1', 'The Quest for the Sword') },
    });
    const scene = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      threadDeltas: [{ threadId: 't1', from: 'latent', to: 'active', addedNodes: [] }],
    });
    const ctx = sceneContext(n, scene);
    expect(ctx).toContain('Quest for the Sword');
    expect(ctx).toContain('latent');
    expect(ctx).toContain('active');
  });
  it('includes relationship deltas', () => {
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
      relationshipDeltas: [
        { from: 'c1', to: 'c2', type: 'mentor', valenceDelta: 0.3 },
      ],
    });
    const ctx = sceneContext(n, scene);
    expect(ctx).toContain('Hero');
    expect(ctx).toContain('Mentor');
    expect(ctx).toContain('0.3');
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
// ── narrativeContext ─────────────────────────────────────────────────────────
describe('narrativeContext', () => {
  it('includes narrative title', () => {
    const n = createMinimalNarrative({ title: 'Epic Adventure' });
    const ctx = narrativeContext(n, [], 0);
    expect(ctx).toContain('Epic Adventure');
  });
  it('omits the standalone world-summary prose block (structured context is preferred)', () => {
    const n = createMinimalNarrative({
      worldSummary: 'A land of mystery and magic',
    });
    const ctx = narrativeContext(n, [], 0);
    expect(ctx).not.toContain('<world>');
    expect(ctx).not.toContain('mystery and magic');
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

  it('omits the force-trajectory and current-state blocks', () => {
    const n = createMinimalNarrative();
    const ctx = narrativeContext(n, [], 0);
    expect(ctx).not.toContain('<force-trajectory');
    expect(ctx).not.toContain('<current-state');
  });

  it('frames scene-history as the source of truth in its hint', () => {
    const n = createMinimalNarrative();
    const ctx = narrativeContext(n, [], 0);
    expect(ctx).toMatch(/<scene-history[^>]*source of truth/i);
  });

  it('reports tier counts in the scene-history scope', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
      scenes: {
        s1: createScene('s1', { povId: 'c1', locationId: 'loc1' }),
        s2: createScene('s2', { povId: 'c1', locationId: 'loc1' }),
      },
    });
    const ctx = narrativeContext(n, ['s1', 's2'], 1);
    expect(ctx).toMatch(/\d+ near, \d+ mid, \d+ far/);
  });
});

// ── Tiered recency classification ────────────────────────────────────────────
describe('classifyTier', () => {
  it('assigns near to the most recent scenes', () => {
    expect(classifyTier(0, false, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE)).toBe('near');
    expect(classifyTier(NEAR_RECENCY_ZONE - 1, false, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE)).toBe('near');
  });

  it('assigns mid to the next band back', () => {
    expect(classifyTier(NEAR_RECENCY_ZONE, false, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE)).toBe('mid');
    expect(
      classifyTier(NEAR_RECENCY_ZONE + MID_RECENCY_ZONE - 1, false, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE),
    ).toBe('mid');
  });

  it('assigns far to scenes beyond both zones', () => {
    expect(
      classifyTier(NEAR_RECENCY_ZONE + MID_RECENCY_ZONE, false, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE),
    ).toBe('far');
    expect(classifyTier(1_000, false, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE)).toBe('far');
  });

  it('promotes important scenes one tier up', () => {
    // far → mid
    expect(
      classifyTier(NEAR_RECENCY_ZONE + MID_RECENCY_ZONE + 5, true, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE),
    ).toBe('mid');
    // mid → near
    expect(classifyTier(NEAR_RECENCY_ZONE, true, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE)).toBe('near');
    // near → near (already floor)
    expect(classifyTier(0, true, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE)).toBe('near');
  });
});

describe('tierOfOrigin', () => {
  it('returns seed for nodes without a recorded origin scene', () => {
    expect(tierOfOrigin(undefined, 10, [], NEAR_RECENCY_ZONE, MID_RECENCY_ZONE)).toBe('seed');
  });

  it('maps origin index to the tier containing it', () => {
    const total = 30;
    const sceneImportance = new Array<boolean>(total).fill(false);
    // Origin at the current scene → near.
    expect(tierOfOrigin(total - 1, total, sceneImportance, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE)).toBe('near');
    // Origin far back → far.
    expect(tierOfOrigin(0, total, sceneImportance, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE)).toBe('far');
  });

  it('promotes a far-origin node if its origin scene is important', () => {
    const total = 30;
    const sceneImportance = new Array<boolean>(total).fill(false);
    sceneImportance[0] = true;
    expect(tierOfOrigin(0, total, sceneImportance, NEAR_RECENCY_ZONE, MID_RECENCY_ZONE)).toBe('mid');
  });
});

// ── Tiered scene-history rendering ───────────────────────────────────────────
describe('narrativeContext scene-history tiers', () => {
  function makeSceneRun(count: number, opts: { participantIds?: string[]; summaryBase?: string } = {}): Record<string, Scene> {
    const scenes: Record<string, Scene> = {};
    for (let i = 0; i < count; i++) {
      const id = `s${i + 1}`;
      scenes[id] = createScene(id, {
        povId: 'c1',
        locationId: 'loc1',
        participantIds: opts.participantIds ?? ['c1'],
        summary: `${opts.summaryBase ?? 'summary'}-${i + 1}`,
      });
    }
    return scenes;
  }

  it('tags the most recent scene as near tier', () => {
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
      scenes: makeSceneRun(3),
    });
    const keys = Object.keys(n.scenes);
    const ctx = narrativeContext(n, keys, keys.length - 1);
    expect(ctx).toMatch(/tier="near"[^>]*>summary-3/);
  });

  it('renders a far-tier entry with only summary + POV + location (no participants, threads, deltas)', () => {
    // Push the first scene into far: need > NEAR + MID scenes total.
    const count = NEAR_RECENCY_ZONE + MID_RECENCY_ZONE + 2;
    const scenes = makeSceneRun(count, { participantIds: ['c1', 'c2'] });
    const n = createMinimalNarrative({
      characters: {
        c1: createCharacter('c1', 'Hero'),
        c2: createCharacter('c2', 'Sidekick'),
      },
      locations: { loc1: createLocation('loc1', 'Castle') },
      scenes,
    });
    const keys = Object.keys(n.scenes);
    const ctx = narrativeContext(n, keys, keys.length - 1);
    const farMatch = ctx.match(/<entry index="1"[^>]*>summary-1<\/entry>/);
    expect(farMatch).not.toBeNull();
    const entry = farMatch![0];
    expect(entry).toContain('tier="far"');
    expect(entry).not.toContain('participants=');
    expect(entry).not.toContain('threads=');
    expect(entry).not.toContain('continuity=');
  });

  it('mid-tier entries omit the participants attribute (threads imply names)', () => {
    // Put a scene squarely in mid: index < NEAR from end, but inside NEAR+MID.
    const count = NEAR_RECENCY_ZONE + 3;
    const scenes = makeSceneRun(count, { participantIds: ['c1', 'c2'] });
    const n = createMinimalNarrative({
      characters: {
        c1: createCharacter('c1', 'Hero'),
        c2: createCharacter('c2', 'Sidekick'),
      },
      locations: { loc1: createLocation('loc1', 'Castle') },
      scenes,
    });
    const keys = Object.keys(n.scenes);
    const ctx = narrativeContext(n, keys, keys.length - 1);
    const midEntry = ctx.match(/<entry index="1"[^>]*tier="mid"[^>]*>[^<]*<\/entry>/);
    expect(midEntry).not.toBeNull();
    expect(midEntry![0]).not.toContain('participants=');
  });

  it('important scenes (thread transitions into critical/resolved) survive in higher tiers', () => {
    // Place an important scene far back and verify its worldDeltas / relationships survive.
    const totalScenes = NEAR_RECENCY_ZONE + MID_RECENCY_ZONE + 5;
    const scenes: Record<string, Scene> = {};
    for (let i = 0; i < totalScenes; i++) {
      const id = `s${i + 1}`;
      scenes[id] = createScene(id, { povId: 'c1', locationId: 'loc1', summary: `summary-${i + 1}` });
    }
    // Mark the first scene as important via a thread transition → critical.
    scenes.s1 = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      summary: 'summary-1',
      threadDeltas: [{ threadId: 't1', from: 'escalating', to: 'critical', addedNodes: [] }],
    });
    const n = createMinimalNarrative({
      characters: { c1: createCharacter('c1', 'Hero') },
      locations: { loc1: createLocation('loc1', 'Castle') },
      threads: { t1: createThread('t1', 'Can Hero survive?', ['c1']) },
      scenes,
    });
    const keys = Object.keys(n.scenes);
    const ctx = narrativeContext(n, keys, keys.length - 1);
    // Far by distance, but promoted to mid due to importance — so the entry
    // must include thread transitions and the mid tier label.
    const entryMatch = ctx.match(/<entry index="1"[\s\S]*?<\/entry>/);
    expect(entryMatch).not.toBeNull();
    const entry = entryMatch![0];
    expect(entry).toContain('summary-1');
    expect(entry).toContain('tier="mid"');
    expect(entry).toContain('threads=');
  });
});

// ── Relationship recency filter ──────────────────────────────────────────────
describe('narrativeContext relationship recency', () => {
  it('keeps relationships whose most recent delta is in near/mid tier', () => {
    const scenes: Record<string, Scene> = {};
    for (let i = 0; i < NEAR_RECENCY_ZONE; i++) {
      scenes[`s${i + 1}`] = createScene(`s${i + 1}`, { povId: 'c1', locationId: 'loc1' });
    }
    // Latest scene has a relationship delta → relationship is in near tier.
    scenes.s1 = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      relationshipDeltas: [{ from: 'c1', to: 'c2', type: 'ally', valenceDelta: 0.3 }],
    });
    const n = createMinimalNarrative({
      characters: {
        c1: createCharacter('c1', 'Hero'),
        c2: createCharacter('c2', 'Ally'),
      },
      locations: { loc1: createLocation('loc1', 'Castle') },
      scenes,
      relationships: [{ from: 'c1', to: 'c2', type: 'ally', valence: 0.5 }],
    });
    const keys = Object.keys(n.scenes);
    const ctx = narrativeContext(n, keys, keys.length - 1);
    expect(ctx).toContain('<relationship from="Hero" to="Ally"');
  });

  it('drops relationships whose most recent delta is in far tier', () => {
    // Build enough scenes to push scene 1 into far tier (> NEAR + MID).
    const total = NEAR_RECENCY_ZONE + MID_RECENCY_ZONE + 3;
    const scenes: Record<string, Scene> = {};
    for (let i = 0; i < total; i++) {
      scenes[`s${i + 1}`] = createScene(`s${i + 1}`, { povId: 'c1', locationId: 'loc1' });
    }
    // Only scene 1 (far) has the relationship delta.
    scenes.s1 = createScene('s1', {
      povId: 'c1',
      locationId: 'loc1',
      relationshipDeltas: [{ from: 'c1', to: 'c2', type: 'rival', valenceDelta: -0.2 }],
    });
    const n = createMinimalNarrative({
      characters: {
        c1: createCharacter('c1', 'Hero'),
        c2: createCharacter('c2', 'Foe'),
      },
      locations: { loc1: createLocation('loc1', 'Castle') },
      scenes,
      relationships: [{ from: 'c1', to: 'c2', type: 'rival', valence: -0.4 }],
    });
    const keys = Object.keys(n.scenes);
    const ctx = narrativeContext(n, keys, keys.length - 1);
    expect(ctx).not.toContain('<relationship from="Hero" to="Foe"');
  });
});
