import { describe, it, expect } from 'vitest';
import type { WorldKnowledgeMutation, WorldKnowledgeGraph, WorldKnowledgeNode, WorldKnowledgeNodeType } from '@/types/narrative';
import {
  EMPTY_WORLD_KNOWLEDGE,
  wkEdgeKey,
  sanitizeWorldKnowledgeMutation,
  applyWorldKnowledgeMutation,
  seenEdgeKeysFromGraph,
  normalizeWkConcept,
  makeWkIdAllocator,
  resolveWkConceptIds,
} from '@/lib/world-knowledge-graph';

// ── Fixture helpers ──────────────────────────────────────────────────────────

function node(id: string, concept: string, type: WorldKnowledgeNodeType = 'concept'): WorldKnowledgeNode {
  return { id, concept, type };
}

function edge(from: string, to: string, relation = 'relates_to') {
  return { from, to, relation };
}

function mutation(
  nodes: WorldKnowledgeNode[] = [],
  edges: { from: string; to: string; relation: string }[] = [],
): WorldKnowledgeMutation {
  return { addedNodes: nodes.slice(), addedEdges: edges.slice() };
}

// ── EMPTY_WORLD_KNOWLEDGE ────────────────────────────────────────────────────

describe('EMPTY_WORLD_KNOWLEDGE', () => {
  it('is a canonical empty graph', () => {
    expect(EMPTY_WORLD_KNOWLEDGE).toEqual({ nodes: {}, edges: [] });
  });
});

// ── wkEdgeKey ────────────────────────────────────────────────────────────────

describe('wkEdgeKey', () => {
  it('produces a stable key from from/to/relation', () => {
    expect(wkEdgeKey(edge('WK-01', 'WK-02', 'enables'))).toBe('WK-01→WK-02→enables');
  });

  it('differentiates edges that share endpoints but not relation', () => {
    const a = wkEdgeKey(edge('WK-01', 'WK-02', 'enables'));
    const b = wkEdgeKey(edge('WK-01', 'WK-02', 'blocks'));
    expect(a).not.toBe(b);
  });

  it('is directional', () => {
    const a = wkEdgeKey(edge('WK-01', 'WK-02', 'enables'));
    const b = wkEdgeKey(edge('WK-02', 'WK-01', 'enables'));
    expect(a).not.toBe(b);
  });
});

// ── sanitizeWorldKnowledgeMutation ───────────────────────────────────────────

describe('sanitizeWorldKnowledgeMutation', () => {
  it('filters self-loops (from === to)', () => {
    const m = mutation([], [edge('WK-01', 'WK-01', 'enables'), edge('WK-01', 'WK-02', 'enables')]);
    sanitizeWorldKnowledgeMutation(m, new Set(['WK-01', 'WK-02']), new Set());
    expect(m.addedEdges).toHaveLength(1);
    expect(m.addedEdges[0]).toEqual({ from: 'WK-01', to: 'WK-02', relation: 'enables' });
  });

  it('filters orphan edges (endpoint not in validIds)', () => {
    const m = mutation([], [edge('WK-01', 'WK-02'), edge('WK-01', 'WK-99'), edge('WK-88', 'WK-02')]);
    sanitizeWorldKnowledgeMutation(m, new Set(['WK-01', 'WK-02']), new Set());
    expect(m.addedEdges).toHaveLength(1);
    expect(m.addedEdges[0].to).toBe('WK-02');
  });

  it('filters edges missing from, to, or relation', () => {
    const m: WorldKnowledgeMutation = {
      addedNodes: [],
      addedEdges: [
        { from: 'WK-01', to: 'WK-02', relation: '' },
        { from: '', to: 'WK-02', relation: 'enables' },
        { from: 'WK-01', to: '', relation: 'enables' },
        { from: 'WK-01', to: 'WK-02', relation: 'enables' },
      ],
    };
    sanitizeWorldKnowledgeMutation(m, new Set(['WK-01', 'WK-02']), new Set());
    expect(m.addedEdges).toHaveLength(1);
  });

  it('filters cross-mutation duplicates using the shared seenEdgeKeys set', () => {
    const valid = new Set(['WK-01', 'WK-02']);
    const seen = new Set<string>();
    const m1 = mutation([], [edge('WK-01', 'WK-02', 'enables')]);
    const m2 = mutation([], [edge('WK-01', 'WK-02', 'enables'), edge('WK-02', 'WK-01', 'enables')]);
    sanitizeWorldKnowledgeMutation(m1, valid, seen);
    sanitizeWorldKnowledgeMutation(m2, valid, seen);
    // m1 keeps its one edge, m2 keeps only the reverse-direction one.
    expect(m1.addedEdges).toHaveLength(1);
    expect(m2.addedEdges).toHaveLength(1);
    expect(m2.addedEdges[0]).toEqual({ from: 'WK-02', to: 'WK-01', relation: 'enables' });
  });

  it('filters nodes missing concept or type', () => {
    const m: WorldKnowledgeMutation = {
      addedNodes: [
        { id: 'WK-01', concept: 'Magic', type: 'system' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'WK-02', concept: '', type: 'concept' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'WK-03', concept: 'Ether', type: '' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: '', concept: 'Ley', type: 'concept' } as any,
      ],
      addedEdges: [],
    };
    sanitizeWorldKnowledgeMutation(m, new Set(['WK-01', 'WK-02', 'WK-03']), new Set());
    expect(m.addedNodes).toHaveLength(1);
    expect(m.addedNodes[0].id).toBe('WK-01');
  });

  it('handles undefined addedNodes/addedEdges gracefully', () => {
    const m = { addedNodes: undefined, addedEdges: undefined } as unknown as WorldKnowledgeMutation;
    sanitizeWorldKnowledgeMutation(m, new Set(), new Set());
    expect(m.addedNodes).toEqual([]);
    expect(m.addedEdges).toEqual([]);
  });

  it('returns the mutated object for chaining', () => {
    const m = mutation();
    const result = sanitizeWorldKnowledgeMutation(m, new Set(), new Set());
    expect(result).toBe(m);
  });
});

// ── applyWorldKnowledgeMutation ──────────────────────────────────────────────

describe('applyWorldKnowledgeMutation', () => {
  it('adds new nodes to the graph', () => {
    const graph: WorldKnowledgeGraph = { nodes: {}, edges: [] };
    applyWorldKnowledgeMutation(graph, mutation([node('WK-01', 'Magic', 'system')], []));
    expect(graph.nodes['WK-01']).toEqual({ id: 'WK-01', concept: 'Magic', type: 'system' });
  });

  it('does not overwrite existing nodes', () => {
    const graph: WorldKnowledgeGraph = { nodes: { 'WK-01': node('WK-01', 'Magic', 'system') }, edges: [] };
    applyWorldKnowledgeMutation(graph, mutation([node('WK-01', 'OTHER CONCEPT', 'principle')], []));
    expect(graph.nodes['WK-01'].concept).toBe('Magic');
    expect(graph.nodes['WK-01'].type).toBe('system');
  });

  it('adds new edges', () => {
    const graph: WorldKnowledgeGraph = { nodes: {}, edges: [] };
    applyWorldKnowledgeMutation(graph, mutation([], [edge('WK-01', 'WK-02', 'enables')]));
    expect(graph.edges).toHaveLength(1);
  });

  it('does not duplicate existing edges', () => {
    const graph: WorldKnowledgeGraph = {
      nodes: {},
      edges: [edge('WK-01', 'WK-02', 'enables')],
    };
    applyWorldKnowledgeMutation(graph, mutation([], [edge('WK-01', 'WK-02', 'enables')]));
    expect(graph.edges).toHaveLength(1);
  });

  it('treats different relations as different edges', () => {
    const graph: WorldKnowledgeGraph = {
      nodes: {},
      edges: [edge('WK-01', 'WK-02', 'enables')],
    };
    applyWorldKnowledgeMutation(graph, mutation([], [edge('WK-01', 'WK-02', 'blocks')]));
    expect(graph.edges).toHaveLength(2);
  });
});

// ── seenEdgeKeysFromGraph ────────────────────────────────────────────────────

describe('seenEdgeKeysFromGraph', () => {
  it('returns a set of edge keys from the graph', () => {
    const graph: WorldKnowledgeGraph = {
      nodes: {},
      edges: [edge('WK-01', 'WK-02', 'enables'), edge('WK-02', 'WK-03', 'blocks')],
    };
    const seen = seenEdgeKeysFromGraph(graph);
    expect(seen.has('WK-01→WK-02→enables')).toBe(true);
    expect(seen.has('WK-02→WK-03→blocks')).toBe(true);
    expect(seen.size).toBe(2);
  });

  it('handles undefined graph', () => {
    const seen = seenEdgeKeysFromGraph(undefined);
    expect(seen.size).toBe(0);
  });

  it('handles empty graph', () => {
    const seen = seenEdgeKeysFromGraph({ nodes: {}, edges: [] });
    expect(seen.size).toBe(0);
  });
});

// ── normalizeWkConcept ───────────────────────────────────────────────────────

describe('normalizeWkConcept', () => {
  it('lowercases', () => {
    expect(normalizeWkConcept('Mana Binding')).toBe('mana binding');
  });

  it('trims whitespace', () => {
    expect(normalizeWkConcept('  Mana Binding  ')).toBe('mana binding');
  });

  it('treats case + whitespace variants as equal', () => {
    expect(normalizeWkConcept('MANA BINDING')).toBe(normalizeWkConcept('  mana binding'));
  });

  it('does NOT normalize punctuation or hyphenation', () => {
    // Documented limitation: "mana-binding" and "mana binding" are distinct.
    expect(normalizeWkConcept('mana-binding')).not.toBe(normalizeWkConcept('mana binding'));
  });
});

// ── makeWkIdAllocator ────────────────────────────────────────────────────────

describe('makeWkIdAllocator', () => {
  it('starts at WK-01 when seeded with no ids', () => {
    const alloc = makeWkIdAllocator([]);
    expect(alloc()).toBe('WK-01');
    expect(alloc()).toBe('WK-02');
  });

  it('seeds from the max existing id', () => {
    const alloc = makeWkIdAllocator(['WK-01', 'WK-05', 'WK-03']);
    expect(alloc()).toBe('WK-06');
    expect(alloc()).toBe('WK-07');
  });

  it('ignores non-WK ids in seed', () => {
    const alloc = makeWkIdAllocator(['C-01', 'L-02', 'T-99']);
    expect(alloc()).toBe('WK-01');
  });

  it('ignores malformed WK ids in seed', () => {
    const alloc = makeWkIdAllocator(['WK-foo', 'WK-', 'WK-03']);
    expect(alloc()).toBe('WK-04');
  });

  it('pads to at least 2 digits', () => {
    const alloc = makeWkIdAllocator([]);
    for (let i = 0; i < 9; i++) alloc();
    expect(alloc()).toBe('WK-10');
  });

  it('yields unique ids on repeated calls', () => {
    const alloc = makeWkIdAllocator([]);
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(alloc());
    expect(ids.size).toBe(50);
  });
});

// ── resolveWkConceptIds ──────────────────────────────────────────────────────

describe('resolveWkConceptIds', () => {
  const alloc = (seed: string[] = []) => makeWkIdAllocator(seed);

  it('allocates fresh ids for genuinely new concepts', () => {
    const { idMap, newNodes } = resolveWkConceptIds(
      [
        { id: 'WK-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'WK-GEN-2', concept: 'Leylines', type: 'concept' },
      ],
      {},
      alloc(),
    );
    expect(newNodes).toHaveLength(2);
    expect(idMap['WK-GEN-1']).toBe('WK-01');
    expect(idMap['WK-GEN-2']).toBe('WK-02');
    expect(newNodes[0]).toEqual({ id: 'WK-01', concept: 'Mana Binding', type: 'system' });
  });

  it('collapses a raw node whose concept exists in the existing graph', () => {
    const existing = { 'WK-07': node('WK-07', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveWkConceptIds(
      [{ id: 'WK-GEN-1', concept: 'Mana Binding', type: 'principle' }],
      existing,
      alloc(['WK-07']),
    );
    expect(idMap['WK-GEN-1']).toBe('WK-07');
    expect(newNodes).toHaveLength(0);
  });

  it('is case-insensitive when matching existing concepts', () => {
    const existing = { 'WK-05': node('WK-05', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveWkConceptIds(
      [{ id: 'WK-GEN-1', concept: 'MANA BINDING', type: 'system' }],
      existing,
      alloc(['WK-05']),
    );
    expect(idMap['WK-GEN-1']).toBe('WK-05');
    expect(newNodes).toHaveLength(0);
  });

  it('is whitespace-insensitive when matching existing concepts', () => {
    const existing = { 'WK-05': node('WK-05', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveWkConceptIds(
      [{ id: 'WK-GEN-1', concept: '  mana binding  ', type: 'system' }],
      existing,
      alloc(['WK-05']),
    );
    expect(idMap['WK-GEN-1']).toBe('WK-05');
    expect(newNodes).toHaveLength(0);
  });

  it('collapses within-batch duplicates to a single fresh id', () => {
    const { idMap, newNodes } = resolveWkConceptIds(
      [
        { id: 'WK-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'WK-GEN-2', concept: 'Mana Binding', type: 'concept' },
        { id: 'WK-GEN-3', concept: 'MANA BINDING', type: 'principle' },
      ],
      {},
      alloc(),
    );
    expect(newNodes).toHaveLength(1);
    expect(idMap['WK-GEN-1']).toBe('WK-01');
    expect(idMap['WK-GEN-2']).toBe('WK-01');
    expect(idMap['WK-GEN-3']).toBe('WK-01');
  });

  it('existing-graph match takes priority over within-batch match', () => {
    const existing = { 'WK-42': node('WK-42', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveWkConceptIds(
      [
        { id: 'WK-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'WK-GEN-2', concept: 'mana binding', type: 'concept' },
      ],
      existing,
      alloc(['WK-42']),
    );
    expect(newNodes).toHaveLength(0);
    expect(idMap['WK-GEN-1']).toBe('WK-42');
    expect(idMap['WK-GEN-2']).toBe('WK-42');
  });

  it('preserves the first-occurrence concept + type when collapsing within-batch', () => {
    const { newNodes } = resolveWkConceptIds(
      [
        { id: 'WK-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'WK-GEN-2', concept: 'MANA BINDING', type: 'principle' },
      ],
      {},
      alloc(),
    );
    expect(newNodes[0].concept).toBe('Mana Binding');
    expect(newNodes[0].type).toBe('system');
  });

  it('skips raw nodes missing id, concept, or type', () => {
    const { newNodes } = resolveWkConceptIds(
      [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: '', concept: 'A', type: 'concept' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'WK-GEN-1', concept: '', type: 'concept' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'WK-GEN-2', concept: 'B', type: '' } as any,
        { id: 'WK-GEN-3', concept: 'C', type: 'concept' },
      ],
      {},
      alloc(),
    );
    expect(newNodes).toHaveLength(1);
    expect(newNodes[0].concept).toBe('C');
  });

  it('idMap enables correct edge remapping end-to-end', () => {
    // Simulates the caller pattern: resolve, then remap edges via idMap.
    const existing = { 'WK-05': node('WK-05', 'Magic', 'system') };
    const { idMap, newNodes } = resolveWkConceptIds(
      [
        { id: 'WK-GEN-1', concept: 'Magic', type: 'system' }, // → WK-05 (existing)
        { id: 'WK-GEN-2', concept: 'Runes', type: 'concept' }, // → fresh
      ],
      existing,
      alloc(['WK-05']),
    );
    const rawEdges = [edge('WK-GEN-1', 'WK-GEN-2', 'enables')];
    const remapped = rawEdges.map((e) => ({
      from: idMap[e.from] ?? e.from,
      to: idMap[e.to] ?? e.to,
      relation: e.relation,
    }));
    expect(newNodes).toHaveLength(1);
    expect(remapped[0]).toEqual({ from: 'WK-05', to: 'WK-06', relation: 'enables' });
  });

  it('handles empty input', () => {
    const { idMap, newNodes } = resolveWkConceptIds([], {}, alloc());
    expect(idMap).toEqual({});
    expect(newNodes).toEqual([]);
  });
});
