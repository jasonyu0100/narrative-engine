import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateBeatPlan, validateBeatProseMap, validateExtractionResult, validateWorldKnowledge, retryWithValidation } from '@/lib/ai/validation';
import type { BeatPlan } from '@/types/narrative';

describe('ai-validation', () => {
  describe('validateBeatPlan', () => {
    it('validates a correct beat plan', () => {
      const validPlan = {
        beats: [
          {
            fn: 'breathe',
            mechanism: 'environment',
            what: 'Morning light filters through',
            propositions: [{ content: 'golden rays' }],
            startPara: 0,
            endPara: 2,
          },
          {
            fn: 'advance',
            mechanism: 'action',
            what: 'Character moves forward',
            propositions: [{ content: 'steps taken' }],
            startPara: 3,
            endPara: 5,
          },
        ],
      };

      const result = validateBeatPlan(validPlan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
      const result = validateBeatPlan(null);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Response is not an object');
    });

    it('rejects missing beats array', () => {
      const result = validateBeatPlan({});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing or invalid beats array');
    });

    it('rejects empty beats array', () => {
      const result = validateBeatPlan({ beats: [] });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Beats array is empty - no beats extracted');
    });

    it('rejects beat with invalid fn value', () => {
      const result = validateBeatPlan({
        beats: [
          {
            fn: 'INVALID_FN',
            mechanism: 'action',
            what: 'Something happens',
          },
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("invalid fn value 'INVALID_FN'"))).toBe(true);
    });

    it('rejects beat with invalid mechanism value', () => {
      const result = validateBeatPlan({
        beats: [
          {
            fn: 'advance',
            mechanism: 'INVALID_MECHANISM',
            what: 'Something happens',
          },
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("invalid mechanism value 'INVALID_MECHANISM'"))).toBe(true);
    });

    it('rejects beat with missing what field', () => {
      const result = validateBeatPlan({
        beats: [
          {
            fn: 'advance',
            mechanism: 'action',
          },
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("missing or invalid 'what' field"))).toBe(true);
    });

    it('rejects beat with what field too short', () => {
      const result = validateBeatPlan({
        beats: [
          {
            fn: 'advance',
            mechanism: 'action',
            what: 'Hi',
          },
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("'what' field too short"))).toBe(true);
    });

    it('rejects beat with endPara < startPara', () => {
      const result = validateBeatPlan({
        beats: [
          {
            fn: 'advance',
            mechanism: 'action',
            what: 'Something happens',
            startPara: 5,
            endPara: 2,
          },
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('endPara (2) < startPara (5)'))).toBe(true);
    });

    it('validates beat with optional propositions', () => {
      const result = validateBeatPlan({
        beats: [
          {
            fn: 'advance',
            mechanism: 'action',
            what: 'Something happens',
            propositions: [
              { content: 'First prop' },
              { content: 'Second prop' },
            ],
          },
        ],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects beat with non-array propositions', () => {
      const result = validateBeatPlan({
        beats: [
          {
            fn: 'advance',
            mechanism: 'action',
            what: 'Something happens',
            propositions: 'not an array',
          },
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("'propositions' must be an array"))).toBe(true);
    });

    it('accumulates multiple errors for invalid beat', () => {
      const result = validateBeatPlan({
        beats: [
          {
            fn: 'INVALID',
            mechanism: 'INVALID',
            what: 'Hi',
          },
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors.some((e) => e.includes('invalid fn value'))).toBe(true);
      expect(result.errors.some((e) => e.includes('invalid mechanism value'))).toBe(true);
      expect(result.errors.some((e) => e.includes("'what' field too short"))).toBe(true);
    });
  });

  describe('validateBeatProseMap', () => {
    const simpleBeatPlan: BeatPlan = {
      beats: [
        { fn: 'breathe', mechanism: 'environment', what: 'Setup', propositions: [] },
        { fn: 'advance', mechanism: 'action', what: 'Action', propositions: [] },
      ],
    };

    const sampleProse = 'This is some sample prose text that spans multiple sentences. It contains enough content to validate coverage ratios.';

    it('validates a correct beat prose map', () => {
      const validMap = {
        chunks: [
          { beat: simpleBeatPlan.beats[0], prose: 'This is some sample prose text that spans multiple sentences.' },
          { beat: simpleBeatPlan.beats[1], prose: 'It contains enough content to validate coverage ratios.' },
        ],
        createdAt: Date.now(),
      };

      const result = validateBeatProseMap(validMap, simpleBeatPlan, sampleProse);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
      const result = validateBeatProseMap(null, simpleBeatPlan, sampleProse);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Beat prose map is not an object');
    });

    it('rejects missing chunks array', () => {
      const result = validateBeatProseMap({}, simpleBeatPlan, sampleProse);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Missing or invalid chunks array'))).toBe(true);
    });

    it('rejects empty chunks array', () => {
      const result = validateBeatProseMap({ chunks: [] }, simpleBeatPlan, sampleProse);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Chunks array is empty'))).toBe(true);
    });

    it('detects chunk count mismatch', () => {
      const result = validateBeatProseMap(
        {
          chunks: [
            { beat: simpleBeatPlan.beats[0], prose: 'First chunk' },
          ],
        },
        simpleBeatPlan,
        sampleProse
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Beat chunk count mismatch: 1 chunks for 2 beats'))).toBe(true);
    });

    it('rejects chunk with missing prose', () => {
      const result = validateBeatProseMap(
        {
          chunks: [
            { beat: simpleBeatPlan.beats[0] },
            { beat: simpleBeatPlan.beats[1], prose: 'Second chunk' },
          ],
        },
        simpleBeatPlan,
        sampleProse
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Chunk 0: missing or invalid prose field'))).toBe(true);
    });

    it('rejects chunk with empty prose', () => {
      const result = validateBeatProseMap(
        {
          chunks: [
            { beat: simpleBeatPlan.beats[0], prose: '  ' },
            { beat: simpleBeatPlan.beats[1], prose: 'Second chunk' },
          ],
        },
        simpleBeatPlan,
        sampleProse
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Chunk 0: prose is empty'))).toBe(true);
    });

    it('rejects poor prose coverage (<40%)', () => {
      const result = validateBeatProseMap(
        {
          chunks: [
            { beat: simpleBeatPlan.beats[0], prose: 'Short' },
            { beat: simpleBeatPlan.beats[1], prose: 'Text' },
          ],
        },
        simpleBeatPlan,
        sampleProse
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Poor prose coverage'))).toBe(true);
    });

    it('accepts adequate prose coverage (>=40%)', () => {
      // 50+ characters out of 114 = ~44% coverage
      const result = validateBeatProseMap(
        {
          chunks: [
            { beat: simpleBeatPlan.beats[0], prose: 'This is some sample prose text that spans' },
            { beat: simpleBeatPlan.beats[1], prose: 'multiple sentences.' },
          ],
        },
        simpleBeatPlan,
        sampleProse
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('validateExtractionResult', () => {
    it('validates extraction with all entity types', () => {
      const validExtraction = {
        characters: [{ id: 'C-1', name: 'Alice' }],
        locations: [{ id: 'L-1', name: 'Castle' }],
        threads: [{ id: 'T-1', description: 'Main quest' }],
        scenes: [{ id: 'S-1', summary: 'Scene 1' }],
      };

      const result = validateExtractionResult(validExtraction);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
      const result = validateExtractionResult(null);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Extraction result is not an object');
    });

    it('rejects completely empty extraction', () => {
      const result = validateExtractionResult({
        characters: [],
        locations: [],
        threads: [],
        scenes: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No content extracted - all arrays empty (characters, locations, threads, scenes)');
    });

    it('accepts extraction with only characters', () => {
      const result = validateExtractionResult({
        characters: [{ id: 'C-1', name: 'Alice' }],
        locations: [],
        threads: [],
        scenes: [],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts extraction with only scenes', () => {
      const result = validateExtractionResult({
        characters: [],
        locations: [],
        threads: [],
        scenes: [{ id: 'S-1', summary: 'Scene 1' }],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects non-array characters field', () => {
      const result = validateExtractionResult({
        characters: 'not an array',
        locations: [],
        threads: [],
        scenes: [{ id: 'S-1' }],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('characters field exists but is not an array'))).toBe(true);
    });

    it('rejects non-array scenes field', () => {
      const result = validateExtractionResult({
        characters: [{ id: 'C-1' }],
        scenes: 'not an array',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('scenes field exists but is not an array'))).toBe(true);
    });
  });

  describe('validateWorldKnowledge', () => {
    it('validates world knowledge with nodes and edges', () => {
      const validKnowledge = {
        nodes: [
          { id: 'N-1', content: 'Magic System', type: 'system' },
          { id: 'N-2', content: 'Wands', type: 'concept' },
        ],
        edges: [
          { source: 'N-1', target: 'N-2', type: 'contains' },
        ],
      };

      const result = validateWorldKnowledge(validKnowledge);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts world knowledge with only nodes', () => {
      const result = validateWorldKnowledge({
        nodes: [
          { id: 'N-1', content: 'Magic', type: 'system' },
        ],
        edges: [],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
      const result = validateWorldKnowledge(null);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('World knowledge result is not an object');
    });

    it('rejects completely empty world knowledge', () => {
      const result = validateWorldKnowledge({
        nodes: [],
        edges: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No world knowledge extracted - both nodes and edges are empty');
    });

    it('rejects invalid node structure', () => {
      const result = validateWorldKnowledge({
        nodes: [
          { id: 'N-1', content: 'Valid', type: 'system' },
          { id: 'N-2', content: 'Missing type' }, // missing type
        ],
        edges: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Node 1: missing or invalid type'))).toBe(true);
    });

    it('rejects invalid edge structure', () => {
      const result = validateWorldKnowledge({
        nodes: [{ id: 'N-1', content: 'Node', type: 'system' }],
        edges: [
          { source: 'N-1', target: 'N-2', type: 'contains' },
          { source: 'N-2' }, // missing target and type
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Edge 1: missing or invalid target'))).toBe(true);
      expect(result.errors.some((e) => e.includes('Edge 1: missing or invalid type'))).toBe(true);
    });
  });

  describe('retryWithValidation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('succeeds on first attempt when validation passes', async () => {
      const operationFn = vi.fn().mockResolvedValue({ beats: [{ fn: 'advance', mechanism: 'action', what: 'Something happens' }] });
      const validateFn = vi.fn().mockReturnValue({ valid: true, errors: [] });

      const result = await retryWithValidation(
        operationFn,
        validateFn,
        'test-operation',
        3,
        'manual-generation'
      );

      expect(result).toEqual({ beats: [{ fn: 'advance', mechanism: 'action', what: 'Something happens' }] });
      expect(operationFn).toHaveBeenCalledTimes(1);
      expect(validateFn).toHaveBeenCalledTimes(1);
    });

    it('retries on validation failure and succeeds', async () => {
      const operationFn = vi.fn()
        .mockResolvedValueOnce({ beats: [] }) // First attempt - invalid
        .mockResolvedValueOnce({ beats: [{ fn: 'advance', mechanism: 'action', what: 'Something happens' }] }); // Second attempt - valid

      const validateFn = vi.fn()
        .mockReturnValueOnce({ valid: false, errors: ['Empty beats'] })
        .mockReturnValueOnce({ valid: true, errors: [] });

      const result = await retryWithValidation(
        operationFn,
        validateFn,
        'test-operation',
        3,
        'manual-generation'
      );

      expect(result).toEqual({ beats: [{ fn: 'advance', mechanism: 'action', what: 'Something happens' }] });
      expect(operationFn).toHaveBeenCalledTimes(2);
      expect(validateFn).toHaveBeenCalledTimes(2);
    });

    it('throws error after max retries exhausted', async () => {
      const operationFn = vi.fn().mockResolvedValue({ beats: [] });
      const validateFn = vi.fn().mockReturnValue({ valid: false, errors: ['Empty beats'] });

      await expect(
        retryWithValidation(
          operationFn,
          validateFn,
          'test-operation',
          3,
          'manual-generation'
        )
      ).rejects.toThrow('test-operation validation failed after 3 attempts');

      expect(operationFn).toHaveBeenCalledTimes(3);
      expect(validateFn).toHaveBeenCalledTimes(3);
    });

    it('includes validation errors in final error message', async () => {
      const operationFn = vi.fn().mockResolvedValue({ beats: [] });
      const validateFn = vi.fn().mockReturnValue({ valid: false, errors: ['Error 1', 'Error 2'] });

      try {
        await retryWithValidation(
          operationFn,
          validateFn,
          'test-operation',
          2,
          'manual-generation'
        );
        throw new Error('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('Error 1');
        expect(err.message).toContain('Error 2');
      }
    });

    it('propagates operation errors after retries', async () => {
      const operationFn = vi.fn().mockRejectedValue(new Error('Network failure'));
      const validateFn = vi.fn();

      await expect(
        retryWithValidation(
          operationFn,
          validateFn,
          'test-operation',
          3,
          'manual-generation'
        )
      ).rejects.toThrow('test-operation failed after 3 attempts. Last error: Network failure');

      // Retries even on thrown errors
      expect(operationFn).toHaveBeenCalledTimes(3);
      expect(validateFn).not.toHaveBeenCalled();
    });

    it('uses exponential backoff between retries', async () => {
      const operationFn = vi.fn()
        .mockResolvedValueOnce({ beats: [] })
        .mockResolvedValueOnce({ beats: [{ fn: 'advance', mechanism: 'action', what: 'Something' }] });

      const validateFn = vi.fn()
        .mockReturnValueOnce({ valid: false, errors: ['Invalid'] })
        .mockReturnValueOnce({ valid: true, errors: [] });

      const startTime = Date.now();
      await retryWithValidation(
        operationFn,
        validateFn,
        'test-operation',
        3,
        'manual-generation'
      );
      const endTime = Date.now();

      // Should have at least 1 second delay (first retry backoff)
      expect(endTime - startTime).toBeGreaterThanOrEqual(1000);
    });
  });
});
