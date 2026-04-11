import { describe, it, expect } from 'vitest';
import type { SystemMutation, SystemGraph, SystemNode, SystemNodeType } from '@/types/narrative';
import {
  EMPTY_SYSTEM_GRAPH,
  systemEdgeKey,
  sanitizeSystemMutation,
  applySystemMutation,
  seenSystemEdgeKeysFromGraph,
  normalizeSystemConcept,
  makeSystemIdAllocator,
  resolveSystemConceptIds,
} from '@/lib/system-graph';

// ── Fixture helpers ──────────────────────────────────────────────────────────

function node(id: string, concept: string, type: SystemNodeType = 'concept'): SystemNode {
  return { id, concept, type };
}

function edge(from: string, to: string, relation = 'relates_to') {
  return { from, to, relation };
}

function mutation(
  nodes: SystemNode[] = [],
  edges: { from: string; to: string; relation: string }[] = [],
): SystemMutation {
  return { addedNodes: nodes.slice(), addedEdges: edges.slice() };
}

// ── EMPTY_SYSTEM_GRAPH ────────────────────────────────────────────────────

describe('EMPTY_SYSTEM_GRAPH', () => {
  it('is a canonical empty graph', () => {
    expect(EMPTY_SYSTEM_GRAPH).toEqual({ nodes: {}, edges: [] });
  });
});

// ── systemEdgeKey ────────────────────────────────────────────────────────────────

describe('systemEdgeKey', () => {
  it('produces a stable key from from/to/relation', () => {
    expect(systemEdgeKey(edge('SYS-01', 'SYS-02', 'enables'))).toBe('SYS-01→SYS-02→enables');
  });

  it('differentiates edges that share endpoints but not relation', () => {
    const a = systemEdgeKey(edge('SYS-01', 'SYS-02', 'enables'));
    const b = systemEdgeKey(edge('SYS-01', 'SYS-02', 'blocks'));
    expect(a).not.toBe(b);
  });

  it('is directional', () => {
    const a = systemEdgeKey(edge('SYS-01', 'SYS-02', 'enables'));
    const b = systemEdgeKey(edge('SYS-02', 'SYS-01', 'enables'));
    expect(a).not.toBe(b);
  });
});

// ── sanitizeSystemMutation ───────────────────────────────────────────

describe('sanitizeSystemMutation', () => {
  it('filters self-loops (from === to)', () => {
    const m = mutation([], [edge('SYS-01', 'SYS-01', 'enables'), edge('SYS-01', 'SYS-02', 'enables')]);
    sanitizeSystemMutation(m, new Set(['SYS-01', 'SYS-02']), new Set());
    expect(m.addedEdges).toHaveLength(1);
    expect(m.addedEdges[0]).toEqual({ from: 'SYS-01', to: 'SYS-02', relation: 'enables' });
  });

  it('filters orphan edges (endpoint not in validIds)', () => {
    const m = mutation([], [edge('SYS-01', 'SYS-02'), edge('SYS-01', 'SYS-99'), edge('SYS-88', 'SYS-02')]);
    sanitizeSystemMutation(m, new Set(['SYS-01', 'SYS-02']), new Set());
    expect(m.addedEdges).toHaveLength(1);
    expect(m.addedEdges[0].to).toBe('SYS-02');
  });

  it('filters edges missing from, to, or relation', () => {
    const m: SystemMutation = {
      addedNodes: [],
      addedEdges: [
        { from: 'SYS-01', to: 'SYS-02', relation: '' },
        { from: '', to: 'SYS-02', relation: 'enables' },
        { from: 'SYS-01', to: '', relation: 'enables' },
        { from: 'SYS-01', to: 'SYS-02', relation: 'enables' },
      ],
    };
    sanitizeSystemMutation(m, new Set(['SYS-01', 'SYS-02']), new Set());
    expect(m.addedEdges).toHaveLength(1);
  });

  it('filters cross-mutation duplicates using the shared seenEdgeKeys set', () => {
    const valid = new Set(['SYS-01', 'SYS-02']);
    const seen = new Set<string>();
    const m1 = mutation([], [edge('SYS-01', 'SYS-02', 'enables')]);
    const m2 = mutation([], [edge('SYS-01', 'SYS-02', 'enables'), edge('SYS-02', 'SYS-01', 'enables')]);
    sanitizeSystemMutation(m1, valid, seen);
    sanitizeSystemMutation(m2, valid, seen);
    // m1 keeps its one edge, m2 keeps only the reverse-direction one.
    expect(m1.addedEdges).toHaveLength(1);
    expect(m2.addedEdges).toHaveLength(1);
    expect(m2.addedEdges[0]).toEqual({ from: 'SYS-02', to: 'SYS-01', relation: 'enables' });
  });

  it('filters nodes missing concept or type', () => {
    const m: SystemMutation = {
      addedNodes: [
        { id: 'SYS-01', concept: 'Magic', type: 'system' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'SYS-02', concept: '', type: 'concept' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'SYS-03', concept: 'Ether', type: '' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: '', concept: 'Ley', type: 'concept' } as any,
      ],
      addedEdges: [],
    };
    sanitizeSystemMutation(m, new Set(['SYS-01', 'SYS-02', 'SYS-03']), new Set());
    expect(m.addedNodes).toHaveLength(1);
    expect(m.addedNodes[0].id).toBe('SYS-01');
  });

  it('handles undefined addedNodes/addedEdges gracefully', () => {
    const m = { addedNodes: undefined, addedEdges: undefined } as unknown as SystemMutation;
    sanitizeSystemMutation(m, new Set(), new Set());
    expect(m.addedNodes).toEqual([]);
    expect(m.addedEdges).toEqual([]);
  });

  it('returns the mutated object for chaining', () => {
    const m = mutation();
    const result = sanitizeSystemMutation(m, new Set(), new Set());
    expect(result).toBe(m);
  });
});

// ── applySystemMutation ──────────────────────────────────────────────

describe('applySystemMutation', () => {
  it('adds new nodes to the graph', () => {
    const graph: SystemGraph = { nodes: {}, edges: [] };
    applySystemMutation(graph, mutation([node('SYS-01', 'Magic', 'system')], []));
    expect(graph.nodes['SYS-01']).toEqual({ id: 'SYS-01', concept: 'Magic', type: 'system' });
  });

  it('does not overwrite existing nodes', () => {
    const graph: SystemGraph = { nodes: { 'SYS-01': node('SYS-01', 'Magic', 'system') }, edges: [] };
    applySystemMutation(graph, mutation([node('SYS-01', 'OTHER CONCEPT', 'principle')], []));
    expect(graph.nodes['SYS-01'].concept).toBe('Magic');
    expect(graph.nodes['SYS-01'].type).toBe('system');
  });

  it('adds new edges', () => {
    const graph: SystemGraph = { nodes: {}, edges: [] };
    applySystemMutation(graph, mutation([], [edge('SYS-01', 'SYS-02', 'enables')]));
    expect(graph.edges).toHaveLength(1);
  });

  it('does not duplicate existing edges', () => {
    const graph: SystemGraph = {
      nodes: {},
      edges: [edge('SYS-01', 'SYS-02', 'enables')],
    };
    applySystemMutation(graph, mutation([], [edge('SYS-01', 'SYS-02', 'enables')]));
    expect(graph.edges).toHaveLength(1);
  });

  it('treats different relations as different edges', () => {
    const graph: SystemGraph = {
      nodes: {},
      edges: [edge('SYS-01', 'SYS-02', 'enables')],
    };
    applySystemMutation(graph, mutation([], [edge('SYS-01', 'SYS-02', 'blocks')]));
    expect(graph.edges).toHaveLength(2);
  });
});

// ── seenSystemEdgeKeysFromGraph ────────────────────────────────────────────────────

describe('seenSystemEdgeKeysFromGraph', () => {
  it('returns a set of edge keys from the graph', () => {
    const graph: SystemGraph = {
      nodes: {},
      edges: [edge('SYS-01', 'SYS-02', 'enables'), edge('SYS-02', 'SYS-03', 'blocks')],
    };
    const seen = seenSystemEdgeKeysFromGraph(graph);
    expect(seen.has('SYS-01→SYS-02→enables')).toBe(true);
    expect(seen.has('SYS-02→SYS-03→blocks')).toBe(true);
    expect(seen.size).toBe(2);
  });

  it('handles undefined graph', () => {
    const seen = seenSystemEdgeKeysFromGraph(undefined);
    expect(seen.size).toBe(0);
  });

  it('handles empty graph', () => {
    const seen = seenSystemEdgeKeysFromGraph({ nodes: {}, edges: [] });
    expect(seen.size).toBe(0);
  });
});

// ── normalizeSystemConcept ───────────────────────────────────────────────────────

describe('normalizeSystemConcept', () => {
  it('lowercases', () => {
    expect(normalizeSystemConcept('Mana Binding')).toBe('mana binding');
  });

  it('trims whitespace', () => {
    expect(normalizeSystemConcept('  Mana Binding  ')).toBe('mana binding');
  });

  it('treats case + whitespace variants as equal', () => {
    expect(normalizeSystemConcept('MANA BINDING')).toBe(normalizeSystemConcept('  mana binding'));
  });

  it('does NOT normalize punctuation or hyphenation', () => {
    // Documented limitation: "mana-binding" and "mana binding" are distinct.
    expect(normalizeSystemConcept('mana-binding')).not.toBe(normalizeSystemConcept('mana binding'));
  });
});

// ── makeSystemIdAllocator ────────────────────────────────────────────────────────

describe('makeSystemIdAllocator', () => {
  it('starts at SYS-01 when seeded with no ids', () => {
    const alloc = makeSystemIdAllocator([]);
    expect(alloc()).toBe('SYS-01');
    expect(alloc()).toBe('SYS-02');
  });

  it('seeds from the max existing id', () => {
    const alloc = makeSystemIdAllocator(['SYS-01', 'SYS-05', 'SYS-03']);
    expect(alloc()).toBe('SYS-06');
    expect(alloc()).toBe('SYS-07');
  });

  it('supports legacy WK- prefix in seed', () => {
    const alloc = makeSystemIdAllocator(['WK-01', 'WK-05', 'WK-03']);
    expect(alloc()).toBe('SYS-06');
  });

  it('ignores non-SYS/WK ids in seed', () => {
    const alloc = makeSystemIdAllocator(['C-01', 'L-02', 'T-99']);
    expect(alloc()).toBe('SYS-01');
  });

  it('ignores malformed ids in seed', () => {
    const alloc = makeSystemIdAllocator(['SYS-foo', 'SYS-', 'SYS-03']);
    expect(alloc()).toBe('SYS-04');
  });

  it('pads to at least 2 digits', () => {
    const alloc = makeSystemIdAllocator([]);
    for (let i = 0; i < 9; i++) alloc();
    expect(alloc()).toBe('SYS-10');
  });

  it('yields unique ids on repeated calls', () => {
    const alloc = makeSystemIdAllocator([]);
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(alloc());
    expect(ids.size).toBe(50);
  });
});

// ── resolveSystemConceptIds ──────────────────────────────────────────────────────

describe('resolveSystemConceptIds', () => {
  const alloc = (seed: string[] = []) => makeSystemIdAllocator(seed);

  it('allocates fresh ids for genuinely new concepts', () => {
    const { idMap, newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'SYS-GEN-2', concept: 'Leylines', type: 'concept' },
      ],
      {},
      alloc(),
    );
    expect(newNodes).toHaveLength(2);
    expect(idMap['SYS-GEN-1']).toBe('SYS-01');
    expect(idMap['SYS-GEN-2']).toBe('SYS-02');
    expect(newNodes[0]).toEqual({ id: 'SYS-01', concept: 'Mana Binding', type: 'system' });
  });

  it('collapses a raw node whose concept exists in the existing graph', () => {
    const existing = { 'SYS-07': node('SYS-07', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveSystemConceptIds(
      [{ id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'principle' }],
      existing,
      alloc(['SYS-07']),
    );
    expect(idMap['SYS-GEN-1']).toBe('SYS-07');
    expect(newNodes).toHaveLength(0);
  });

  it('is case-insensitive when matching existing concepts', () => {
    const existing = { 'SYS-05': node('SYS-05', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveSystemConceptIds(
      [{ id: 'SYS-GEN-1', concept: 'MANA BINDING', type: 'system' }],
      existing,
      alloc(['SYS-05']),
    );
    expect(idMap['SYS-GEN-1']).toBe('SYS-05');
    expect(newNodes).toHaveLength(0);
  });

  it('is whitespace-insensitive when matching existing concepts', () => {
    const existing = { 'SYS-05': node('SYS-05', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveSystemConceptIds(
      [{ id: 'SYS-GEN-1', concept: '  mana binding  ', type: 'system' }],
      existing,
      alloc(['SYS-05']),
    );
    expect(idMap['SYS-GEN-1']).toBe('SYS-05');
    expect(newNodes).toHaveLength(0);
  });

  it('collapses within-batch duplicates to a single fresh id', () => {
    const { idMap, newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'SYS-GEN-2', concept: 'Mana Binding', type: 'concept' },
        { id: 'SYS-GEN-3', concept: 'MANA BINDING', type: 'principle' },
      ],
      {},
      alloc(),
    );
    expect(newNodes).toHaveLength(1);
    expect(idMap['SYS-GEN-1']).toBe('SYS-01');
    expect(idMap['SYS-GEN-2']).toBe('SYS-01');
    expect(idMap['SYS-GEN-3']).toBe('SYS-01');
  });

  it('existing-graph match takes priority over within-batch match', () => {
    const existing = { 'SYS-42': node('SYS-42', 'Mana Binding', 'system') };
    const { idMap, newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'SYS-GEN-2', concept: 'mana binding', type: 'concept' },
      ],
      existing,
      alloc(['SYS-42']),
    );
    expect(newNodes).toHaveLength(0);
    expect(idMap['SYS-GEN-1']).toBe('SYS-42');
    expect(idMap['SYS-GEN-2']).toBe('SYS-42');
  });

  it('preserves the first-occurrence concept + type when collapsing within-batch', () => {
    const { newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
        { id: 'SYS-GEN-2', concept: 'MANA BINDING', type: 'principle' },
      ],
      {},
      alloc(),
    );
    expect(newNodes[0].concept).toBe('Mana Binding');
    expect(newNodes[0].type).toBe('system');
  });

  it('skips raw nodes missing id, concept, or type', () => {
    const { newNodes } = resolveSystemConceptIds(
      [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: '', concept: 'A', type: 'concept' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'SYS-GEN-1', concept: '', type: 'concept' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'SYS-GEN-2', concept: 'B', type: '' } as any,
        { id: 'SYS-GEN-3', concept: 'C', type: 'concept' },
      ],
      {},
      alloc(),
    );
    expect(newNodes).toHaveLength(1);
    expect(newNodes[0].concept).toBe('C');
  });

  it('idMap enables correct edge remapping end-to-end', () => {
    // Simulates the caller pattern: resolve, then remap edges via idMap.
    const existing = { 'SYS-05': node('SYS-05', 'Magic', 'system') };
    const { idMap, newNodes } = resolveSystemConceptIds(
      [
        { id: 'SYS-GEN-1', concept: 'Magic', type: 'system' }, // → SYS-05 (existing)
        { id: 'SYS-GEN-2', concept: 'Runes', type: 'concept' }, // → fresh
      ],
      existing,
      alloc(['SYS-05']),
    );
    const rawEdges = [edge('SYS-GEN-1', 'SYS-GEN-2', 'enables')];
    const remapped = rawEdges.map((e) => ({
      from: idMap[e.from] ?? e.from,
      to: idMap[e.to] ?? e.to,
      relation: e.relation,
    }));
    expect(newNodes).toHaveLength(1);
    expect(remapped[0]).toEqual({ from: 'SYS-05', to: 'SYS-06', relation: 'enables' });
  });

  it('handles empty input', () => {
    const { idMap, newNodes } = resolveSystemConceptIds([], {}, alloc());
    expect(idMap).toEqual({});
    expect(newNodes).toEqual([]);
  });
});
