import { describe, it, expect } from 'vitest';
import { buildBeatProseMapFromCounts } from '@/lib/ai/scenes';
import type { Beat } from '@/types/narrative';

const beat = (fn: Beat['fn'] = 'advance'): Beat => ({
  fn, mechanism: 'action', what: 'test', propositions: [],
});

describe('buildBeatProseMapFromCounts', () => {
  const paragraphs = ['para 0', 'para 1', 'para 2', 'para 3', 'para 4'];

  it('builds prose map from valid counts', () => {
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat(), beat(), beat()],
      [2, 2, 1],
    );
    expect(result).not.toBeNull();
    expect(result!.chunks).toHaveLength(3);
    expect(result!.chunks[0].prose).toBe('para 0\n\npara 1');
    expect(result!.chunks[1].prose).toBe('para 2\n\npara 3');
    expect(result!.chunks[2].prose).toBe('para 4');
  });

  it('builds prose map with startIndex cross-check', () => {
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat(), beat(), beat()],
      [2, 2, 1],
      [0, 2, 4],
    );
    expect(result).not.toBeNull();
    expect(result!.chunks).toHaveLength(3);
  });

  it('auto-corrects when counts are off by 1-2', () => {
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat(), beat()],
      [2, 2], // sum 4, need 5 — last beat absorbs the extra
    );
    expect(result).not.toBeNull();
    expect(result!.chunks).toHaveLength(2);
    expect(result!.chunks[1].prose).toContain('para 4');
  });

  it('rejects when counts are off by more than 2', () => {
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat(), beat()],
      [1, 1], // sum 2, need 5 — diff too large
    );
    expect(result).toBeNull();
  });

  it('rejects when a count is zero', () => {
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat(), beat(), beat()],
      [2, 0, 3],
    );
    expect(result).toBeNull();
  });

  it('rejects when a count is negative', () => {
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat(), beat(), beat()],
      [3, -1, 3],
    );
    expect(result).toBeNull();
  });

  it('rejects when startIndex has a gap (paragraph skipped)', () => {
    // LLM says startIndex:0 chunks:2, startIndex:4 chunks:1
    // cursor would be 2 after first beat, but LLM says 4 — gap at paragraph 2-3
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat(), beat()],
      [2, 3],
      [0, 4], // startIndex 4 !== cursor 2
    );
    expect(result).toBeNull();
  });

  it('rejects when startIndex has overlap', () => {
    // LLM says startIndex:0 chunks:3, startIndex:2 chunks:2
    // cursor would be 3 after first beat, but LLM says 2 — overlap
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat(), beat()],
      [3, 2],
      [0, 2], // startIndex 2 !== cursor 3
    );
    expect(result).toBeNull();
  });

  it('rejects when first startIndex is not 0', () => {
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat(), beat()],
      [2, 3],
      [1, 3], // first startIndex should be 0
    );
    expect(result).toBeNull();
  });

  it('works with single beat spanning all paragraphs', () => {
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat()],
      [5],
      [0],
    );
    expect(result).not.toBeNull();
    expect(result!.chunks).toHaveLength(1);
    expect(result!.chunks[0].prose).toBe('para 0\n\npara 1\n\npara 2\n\npara 3\n\npara 4');
  });

  it('works without startIndices (backwards compatible)', () => {
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat(), beat()],
      [3, 2],
    );
    expect(result).not.toBeNull();
    expect(result!.chunks).toHaveLength(2);
  });

  it('rejects mismatched beat and count array lengths', () => {
    const result = buildBeatProseMapFromCounts(
      paragraphs,
      [beat(), beat()],
      [5], // 1 count but 2 beats
    );
    expect(result).toBeNull();
  });

  it('rejects empty paragraphs', () => {
    const result = buildBeatProseMapFromCounts(
      [],
      [beat()],
      [0],
    );
    expect(result).toBeNull();
  });
});
