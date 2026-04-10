import { describe, it, expect } from 'vitest';
import {
  computeGroups,
  heatColor,
  computeCharacterPositions,
  buildGraphData,
  buildOverviewGraphData,
  ROLE_RADIUS,
  ROLE_FILL,
  LOCATION_SIZE,
  LOCATION_FILL,
  CONTINUITY_FILL,
  KNOWLEDGE_OPACITY,
  WK_TYPE_COLORS,
  type GraphNode,
  type GraphLink,
} from '@/components/canvas/graph-utils';
import type {
  Character,
  Location,
  Artifact,
  RelationshipEdge,
  Arc,
  Scene,
  WorldBuild,
} from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createCharacter(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    name: `Character ${id}`,
    role: 'recurring',
    continuity: { nodes: {}, edges: [] },
    threadIds: [],
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
    continuity: { nodes: {}, edges: [] },
    threadIds: [],
    ...overrides,
  };
}

function createArtifact(id: string, parentId: string, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id,
    parentId,
    name: `Artifact ${id}`,
    significance: 'minor',
    continuity: { nodes: {}, edges: [] },
    threadIds: [],
    ...overrides,
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
    summary: 'Test scene',
    events: [],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    characterMovements: {},
    ...overrides,
  };
}

function createArc(id: string, overrides: Partial<Arc> = {}): Arc {
  return {
    id,
    name: `Arc ${id}`,
    sceneIds: [],
    develops: [],
    locationIds: [],
    activeCharacterIds: [],
    initialCharacterLocations: {},
    ...overrides,
  };
}

// ── Constants Tests ──────────────────────────────────────────────────────────

describe('Graph Constants', () => {
  it('ROLE_RADIUS has values for all roles', () => {
    expect(ROLE_RADIUS.anchor).toBeGreaterThan(0);
    expect(ROLE_RADIUS.recurring).toBeGreaterThan(0);
    expect(ROLE_RADIUS.transient).toBeGreaterThan(0);
    expect(ROLE_RADIUS.anchor).toBeGreaterThan(ROLE_RADIUS.recurring);
    expect(ROLE_RADIUS.recurring).toBeGreaterThan(ROLE_RADIUS.transient);
  });

  it('ROLE_FILL has colors for all roles', () => {
    expect(ROLE_FILL.anchor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(ROLE_FILL.recurring).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(ROLE_FILL.transient).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('LOCATION constants are defined', () => {
    expect(LOCATION_SIZE).toBeGreaterThan(0);
    expect(LOCATION_FILL).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('CONTINUITY_FILL has colors for continuity types', () => {
    expect(CONTINUITY_FILL.trait).toBeDefined();
    expect(CONTINUITY_FILL.state).toBeDefined();
    expect(CONTINUITY_FILL.history).toBeDefined();
    expect(CONTINUITY_FILL.capability).toBeDefined();
    expect(CONTINUITY_FILL.belief).toBeDefined();
    expect(CONTINUITY_FILL.relation).toBeDefined();
    expect(CONTINUITY_FILL.secret).toBeDefined();
    expect(CONTINUITY_FILL.goal).toBeDefined();
    expect(CONTINUITY_FILL.weakness).toBeDefined();
  });

  it('KNOWLEDGE_OPACITY has values between 0 and 1', () => {
    for (const val of Object.values(KNOWLEDGE_OPACITY)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it('WK_TYPE_COLORS has colors for world knowledge types', () => {
    expect(WK_TYPE_COLORS.principle).toBeDefined();
    expect(WK_TYPE_COLORS.system).toBeDefined();
    expect(WK_TYPE_COLORS.concept).toBeDefined();
    expect(WK_TYPE_COLORS.tension).toBeDefined();
    expect(WK_TYPE_COLORS.event).toBeDefined();
    expect(WK_TYPE_COLORS.structure).toBeDefined();
    expect(WK_TYPE_COLORS.environment).toBeDefined();
    expect(WK_TYPE_COLORS.convention).toBeDefined();
    expect(WK_TYPE_COLORS.constraint).toBeDefined();
  });
});

// ── computeGroups Tests ──────────────────────────────────────────────────────

describe('computeGroups', () => {
  it('returns empty array for no nodes', () => {
    const groups = computeGroups([], []);
    expect(groups).toEqual([]);
  });

  it('returns each isolated node as its own group', () => {
    const nodes: GraphNode[] = [
      { id: 'a', kind: 'character', label: 'A' },
      { id: 'b', kind: 'character', label: 'B' },
      { id: 'c', kind: 'character', label: 'C' },
    ];
    const groups = computeGroups(nodes, []);
    expect(groups.length).toBe(3);
    expect(groups.every((g) => g.length === 1)).toBe(true);
  });

  it('groups connected nodes together', () => {
    const nodes: GraphNode[] = [
      { id: 'a', kind: 'character', label: 'A' },
      { id: 'b', kind: 'character', label: 'B' },
      { id: 'c', kind: 'character', label: 'C' },
    ];
    const links: GraphLink[] = [
      { id: 'link-1', source: 'a', target: 'b', linkKind: 'relationship' },
    ];
    const groups = computeGroups(nodes, links);
    expect(groups.length).toBe(2);
    // One group has 2 nodes, one has 1
    const sizes = groups.map((g) => g.length).sort((a, b) => b - a);
    expect(sizes).toEqual([2, 1]);
  });

  it('handles fully connected graph', () => {
    const nodes: GraphNode[] = [
      { id: 'a', kind: 'character', label: 'A' },
      { id: 'b', kind: 'character', label: 'B' },
      { id: 'c', kind: 'character', label: 'C' },
    ];
    const links: GraphLink[] = [
      { id: 'link-1', source: 'a', target: 'b', linkKind: 'relationship' },
      { id: 'link-2', source: 'b', target: 'c', linkKind: 'relationship' },
    ];
    const groups = computeGroups(nodes, links);
    expect(groups.length).toBe(1);
    expect(groups[0].length).toBe(3);
  });

  it('sorts groups by size descending', () => {
    const nodes: GraphNode[] = [
      { id: 'a', kind: 'character', label: 'A' },
      { id: 'b', kind: 'character', label: 'B' },
      { id: 'c', kind: 'character', label: 'C' },
      { id: 'd', kind: 'character', label: 'D' },
      { id: 'e', kind: 'character', label: 'E' },
    ];
    const links: GraphLink[] = [
      // Group 1: a-b-c (3 nodes)
      { id: 'link-1', source: 'a', target: 'b', linkKind: 'relationship' },
      { id: 'link-2', source: 'b', target: 'c', linkKind: 'relationship' },
      // Group 2: d-e (2 nodes)
      { id: 'link-3', source: 'd', target: 'e', linkKind: 'relationship' },
    ];
    const groups = computeGroups(nodes, links);
    expect(groups.length).toBe(2);
    expect(groups[0].length).toBe(3);
    expect(groups[1].length).toBe(2);
  });

  it('handles node references instead of IDs in links', () => {
    const nodes: GraphNode[] = [
      { id: 'a', kind: 'character', label: 'A' },
      { id: 'b', kind: 'character', label: 'B' },
    ];
    // D3 sometimes replaces source/target strings with node references
    const links: GraphLink[] = [
      { id: 'link-1', source: nodes[0], target: nodes[1], linkKind: 'relationship' },
    ];
    const groups = computeGroups(nodes, links);
    expect(groups.length).toBe(1);
    expect(groups[0].length).toBe(2);
  });
});

// ── heatColor Tests ──────────────────────────────────────────────────────────

describe('heatColor', () => {
  it('returns blue at t=0', () => {
    const color = heatColor(0);
    expect(color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    // Should be close to system blue (#3B82F6 = rgb(59,130,246))
    expect(color).toBe('rgb(59,130,246)');
  });

  it('returns green at t=0.5', () => {
    const color = heatColor(0.5);
    // Should be close to world green (#22C55E = rgb(34,197,94))
    expect(color).toBe('rgb(34,197,94)');
  });

  it('returns red at t=1', () => {
    const color = heatColor(1);
    // Should be close to drive red (#EF4444 = rgb(239,68,68))
    expect(color).toBe('rgb(239,68,68)');
  });

  it('interpolates between stops', () => {
    const color = heatColor(0.25);
    // Between blue and green
    expect(color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    // Parse RGB values
    const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
    expect(match).not.toBeNull();
    const [, r, g, b] = match!;
    // Should be between blue (59,130,246) and green (34,197,94)
    expect(parseInt(r)).toBeGreaterThanOrEqual(34);
    expect(parseInt(r)).toBeLessThanOrEqual(59);
  });

  it('handles boundary values', () => {
    // Test values at exact boundaries work correctly
    expect(heatColor(0)).toBeDefined();
    expect(heatColor(1)).toBeDefined();
    // Note: values outside [0,1] are undefined behavior (no clamping)
  });
});

// ── computeCharacterPositions Tests ──────────────────────────────────────────

describe('computeCharacterPositions', () => {
  it('returns initial positions when no scenes', () => {
    const arc = createArc('arc-1', {
      sceneIds: [],
      initialCharacterLocations: { 'char-1': 'loc-1', 'char-2': 'loc-2' },
    });
    const positions = computeCharacterPositions(arc, {}, 0, []);
    expect(positions).toEqual({ 'char-1': 'loc-1', 'char-2': 'loc-2' });
  });

  it('updates positions based on scene movements', () => {
    const scenes: Record<string, Scene> = {
      'scene-1': createScene('scene-1', {
        characterMovements: { 'char-1': { locationId: 'loc-2', transition: 'walks to' } },
      }),
      'scene-2': createScene('scene-2', {
        characterMovements: { 'char-1': { locationId: 'loc-3', transition: 'travels to' } },
      }),
    };
    const arc = createArc('arc-1', {
      sceneIds: ['scene-1', 'scene-2'],
      initialCharacterLocations: { 'char-1': 'loc-1' },
    });
    const resolvedKeys = ['scene-1', 'scene-2'];

    // At scene 0, char-1 moves to loc-2
    const pos0 = computeCharacterPositions(arc, scenes, 0, resolvedKeys);
    expect(pos0['char-1']).toBe('loc-2');

    // At scene 1, char-1 moves to loc-3
    const pos1 = computeCharacterPositions(arc, scenes, 1, resolvedKeys);
    expect(pos1['char-1']).toBe('loc-3');
  });

  it('stops at current scene index', () => {
    const scenes: Record<string, Scene> = {
      'scene-1': createScene('scene-1', {
        characterMovements: { 'char-1': { locationId: 'loc-2', transition: 'walks to' } },
      }),
      'scene-2': createScene('scene-2', {
        characterMovements: { 'char-1': { locationId: 'loc-3', transition: 'travels to' } },
      }),
    };
    const arc = createArc('arc-1', {
      sceneIds: ['scene-1', 'scene-2'],
      initialCharacterLocations: { 'char-1': 'loc-1' },
    });
    const resolvedKeys = ['scene-1', 'scene-2'];

    // Only process up to scene 0
    const positions = computeCharacterPositions(arc, scenes, 0, resolvedKeys);
    expect(positions['char-1']).toBe('loc-2'); // Not loc-3
  });

  it('handles arc starting after index 0 in resolved keys', () => {
    const scenes: Record<string, Scene> = {
      'scene-0': createScene('scene-0'),
      'scene-1': createScene('scene-1', {
        characterMovements: { 'char-1': { locationId: 'loc-2', transition: 'walks to' } },
      }),
    };
    const arc = createArc('arc-1', {
      sceneIds: ['scene-1'],
      initialCharacterLocations: { 'char-1': 'loc-1' },
    });
    const resolvedKeys = ['scene-0', 'scene-1'];

    // Scene-1 is at index 1 in resolved keys
    const positions = computeCharacterPositions(arc, scenes, 1, resolvedKeys);
    expect(positions['char-1']).toBe('loc-2');
  });
});

// ── buildGraphData Tests ─────────────────────────────────────────────────────

describe('buildGraphData', () => {
  it('returns empty graph for empty inputs', () => {
    const { nodes, links } = buildGraphData({}, {}, [], {});
    expect(nodes).toEqual([]);
    expect(links).toEqual([]);
  });

  it('creates character nodes', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1', { name: 'Alice', role: 'anchor', threadIds: ['t1', 't2'] }),
      'char-2': createCharacter('char-2', { name: 'Bob', role: 'transient' }),
    };
    const { nodes } = buildGraphData(characters, {}, [], {});

    expect(nodes.length).toBe(2);
    const alice = nodes.find((n) => n.id === 'char-1');
    expect(alice).toBeDefined();
    expect(alice?.kind).toBe('character');
    expect(alice?.label).toBe('Alice');
    expect(alice?.role).toBe('anchor');
    expect(alice?.threadCount).toBe(2);
  });

  it('creates location nodes', () => {
    const locations: Record<string, Location> = {
      'loc-1': createLocation('loc-1', { name: 'Castle', threadIds: ['t1'] }),
    };
    const { nodes } = buildGraphData({}, locations, [], {});

    expect(nodes.length).toBe(1);
    expect(nodes[0].kind).toBe('location');
    expect(nodes[0].label).toBe('Castle');
    expect(nodes[0].threadCount).toBe(1);
  });

  it('creates relationship links', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1'),
      'char-2': createCharacter('char-2'),
    };
    const relationships: RelationshipEdge[] = [
      { from: 'char-1', to: 'char-2', type: 'friend', valence: 5 },
    ];
    const { links } = buildGraphData(characters, {}, relationships, {});

    expect(links.length).toBe(1);
    expect(links[0].linkKind).toBe('relationship');
    expect(links[0].label).toBe('friend');
    expect(links[0].valence).toBe(5);
  });

  it('creates spatial links for child locations', () => {
    const locations: Record<string, Location> = {
      'loc-1': createLocation('loc-1', { name: 'Kingdom' }),
      'loc-2': createLocation('loc-2', { name: 'Castle', parentId: 'loc-1' }),
    };
    const { links } = buildGraphData({}, locations, [], {});

    expect(links.length).toBe(1);
    expect(links[0].linkKind).toBe('spatial');
    expect(links[0].source).toBe('loc-2');
    expect(links[0].target).toBe('loc-1');
  });

  it('creates character-location links from positions', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1'),
    };
    const locations: Record<string, Location> = {
      'loc-1': createLocation('loc-1'),
    };
    const positions = { 'char-1': 'loc-1' };
    const { links } = buildGraphData(characters, locations, [], positions);

    const charLocLink = links.find((l) => l.linkKind === 'character-location');
    expect(charLocLink).toBeDefined();
    expect(charLocLink?.source).toBe('char-1');
    expect(charLocLink?.target).toBe('loc-1');
  });

  it('includes artifact nodes with ownership links', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1'),
    };
    const artifacts: Record<string, Artifact> = {
      'art-1': createArtifact('art-1', 'char-1', { name: 'Magic Sword' }),
    };
    const { nodes, links } = buildGraphData(characters, {}, [], {}, artifacts);

    const artNode = nodes.find((n) => n.id === 'art-1');
    expect(artNode).toBeDefined();
    expect(artNode?.kind).toBe('artifact');
    expect(artNode?.label).toBe('Magic Sword');

    const ownerLink = links.find((l) => l.linkKind === 'ownership');
    expect(ownerLink).toBeDefined();
    expect(ownerLink?.source).toBe('art-1');
    expect(ownerLink?.target).toBe('char-1');
  });

  it('renders artifacts passed by caller even without owner in graph', () => {
    const characters: Record<string, Character> = {};
    const artifacts: Record<string, Artifact> = {
      'art-1': createArtifact('art-1', 'char-missing'),
    };
    const { nodes, links } = buildGraphData(characters, {}, [], {}, artifacts);

    // Artifact appears (pre-filtered by caller) but no ownership edge since owner not in graph
    expect(nodes.find((n) => n.id === 'art-1')).toBeDefined();
    expect(links.find((l) => l.id.includes('art-1'))).toBeUndefined();
  });

  it('includes image metadata on nodes', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1', { imageUrl: 'https://example.com/img.jpg', imagePrompt: 'A warrior' }),
    };
    const { nodes } = buildGraphData(characters, {}, [], {});

    expect(nodes[0].imageUrl).toBe('https://example.com/img.jpg');
    expect(nodes[0].imagePrompt).toBe('A warrior');
  });
});

// ── buildOverviewGraphData Tests ─────────────────────────────────────────────

describe('buildOverviewGraphData', () => {
  it('returns empty graph when no usage', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1'),
    };
    const { nodes } = buildOverviewGraphData(characters, {}, [], {}, {}, [], 0);
    expect(nodes).toEqual([]);
  });

  it('includes characters that appear in scenes', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1'),
      'char-2': createCharacter('char-2'),
    };
    const scenes: Record<string, Scene> = {
      'scene-1': createScene('scene-1', { participantIds: ['char-1'] }),
    };
    const { nodes } = buildOverviewGraphData(
      characters, {}, [], scenes, {}, ['scene-1'], 0,
    );

    expect(nodes.length).toBe(1);
    expect(nodes[0].id).toBe('char-1');
    expect(nodes[0].usageCount).toBe(1);
  });

  it('includes locations that appear in scenes', () => {
    const locations: Record<string, Location> = {
      'loc-1': createLocation('loc-1'),
      'loc-2': createLocation('loc-2'),
    };
    const scenes: Record<string, Scene> = {
      'scene-1': createScene('scene-1', { locationId: 'loc-1' }),
    };
    const { nodes } = buildOverviewGraphData(
      {}, locations, [], scenes, {}, ['scene-1'], 0,
    );

    expect(nodes.length).toBe(1);
    expect(nodes[0].id).toBe('loc-1');
    expect(nodes[0].usageCount).toBe(1);
  });

  it('counts multiple usages', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1'),
    };
    const scenes: Record<string, Scene> = {
      'scene-1': createScene('scene-1', { participantIds: ['char-1'] }),
      'scene-2': createScene('scene-2', { participantIds: ['char-1'] }),
      'scene-3': createScene('scene-3', { participantIds: ['char-1'] }),
    };
    const { nodes } = buildOverviewGraphData(
      characters, {}, [], scenes, {}, ['scene-1', 'scene-2', 'scene-3'], 2,
    );

    expect(nodes[0].usageCount).toBe(3);
  });

  it('only counts up to current scene index', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1'),
    };
    const scenes: Record<string, Scene> = {
      'scene-1': createScene('scene-1', { participantIds: ['char-1'] }),
      'scene-2': createScene('scene-2', { participantIds: ['char-1'] }),
      'scene-3': createScene('scene-3', { participantIds: ['char-1'] }),
    };
    const { nodes } = buildOverviewGraphData(
      characters, {}, [], scenes, {}, ['scene-1', 'scene-2', 'scene-3'], 1,
    );

    expect(nodes[0].usageCount).toBe(2); // Only scene-1 and scene-2
  });

  it('counts world build introductions', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1'),
    };
    const worldBuilds: Record<string, WorldBuild> = {
      'wb-1': {
        kind: 'world_build',
        id: 'wb-1',
        summary: 'Expansion',
        expansionManifest: {
          characters: [{ id: 'char-1', name: 'Alice', role: 'recurring', continuity: { nodes: {}, edges: [] }, threadIds: [] }],
          locations: [],
          threads: [],
          relationships: [],
          worldKnowledgeMutations: { addedNodes: [], addedEdges: [] },
          artifacts: [],
        },
      },
    };
    const { nodes } = buildOverviewGraphData(
      characters, {}, [], {}, worldBuilds, ['wb-1'], 0,
    );

    expect(nodes.length).toBe(1);
    expect(nodes[0].usageCount).toBe(1);
  });

  it('only includes relationships between active characters', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1'),
      'char-2': createCharacter('char-2'),
      'char-3': createCharacter('char-3'),
    };
    const relationships: RelationshipEdge[] = [
      { from: 'char-1', to: 'char-2', type: 'friend', valence: 5 },
      { from: 'char-2', to: 'char-3', type: 'enemy', valence: -5 },
    ];
    const scenes: Record<string, Scene> = {
      'scene-1': createScene('scene-1', { participantIds: ['char-1', 'char-2'] }),
    };
    const { links } = buildOverviewGraphData(
      characters, {}, relationships, scenes, {}, ['scene-1'], 0,
    );

    // Only char-1 and char-2 are active, so only their relationship is included
    expect(links.length).toBe(1);
    expect(links[0].label).toBe('friend');
  });

  it('includes spatial links for active locations', () => {
    const locations: Record<string, Location> = {
      'loc-1': createLocation('loc-1'),
      'loc-2': createLocation('loc-2', { parentId: 'loc-1' }),
    };
    const scenes: Record<string, Scene> = {
      'scene-1': createScene('scene-1', { locationId: 'loc-2' }),
      'scene-2': createScene('scene-2', { locationId: 'loc-1' }),
    };
    const { links } = buildOverviewGraphData(
      {}, locations, [], scenes, {}, ['scene-1', 'scene-2'], 1,
    );

    const spatialLink = links.find((l) => l.linkKind === 'spatial');
    expect(spatialLink).toBeDefined();
  });

  it('excludes spatial links when parent is not active', () => {
    const locations: Record<string, Location> = {
      'loc-1': createLocation('loc-1'),
      'loc-2': createLocation('loc-2', { parentId: 'loc-1' }),
    };
    const scenes: Record<string, Scene> = {
      'scene-1': createScene('scene-1', { locationId: 'loc-2' }),
    };
    const { links } = buildOverviewGraphData(
      {}, locations, [], scenes, {}, ['scene-1'], 0,
    );

    // loc-1 is not used in any scene, so no spatial link
    expect(links.find((l) => l.linkKind === 'spatial')).toBeUndefined();
  });

  it('includes artifacts for active owners', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1'),
    };
    const artifacts: Record<string, Artifact> = {
      'art-1': createArtifact('art-1', 'char-1'),
    };
    const scenes: Record<string, Scene> = {
      'scene-1': createScene('scene-1', { participantIds: ['char-1'] }),
    };
    const { nodes } = buildOverviewGraphData(
      characters, {}, [], scenes, {}, ['scene-1'], 0, artifacts,
    );

    expect(nodes.find((n) => n.id === 'art-1')).toBeDefined();
  });

  it('renders artifacts passed by caller but skips ownership edge for inactive owners', () => {
    const characters: Record<string, Character> = {
      'char-1': createCharacter('char-1'),
      'char-2': createCharacter('char-2'),
    };
    const artifacts: Record<string, Artifact> = {
      'art-1': createArtifact('art-1', 'char-2'),
    };
    const scenes: Record<string, Scene> = {
      'scene-1': createScene('scene-1', { participantIds: ['char-1'] }),
    };
    const { nodes, links } = buildOverviewGraphData(
      characters, {}, [], scenes, {}, ['scene-1'], 0, artifacts,
    );

    // Artifact appears (pre-filtered by caller) but no ownership edge since char-2 not active
    expect(nodes.find((n) => n.id === 'art-1')).toBeDefined();
    expect(links.find((l) => l.id.includes('art-1'))).toBeUndefined();
  });
});
