import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logError, logWarning, onSystemLog, setSystemLoggerNarrativeId, type LogContext } from '@/lib/system-logger';

describe('system-logger', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state
    onSystemLog(() => {});
    setSystemLoggerNarrativeId(null);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('logError', () => {
    it('creates system log entry with correct structure', () => {
      const listener = vi.fn();
      onSystemLog(listener);

      const context: LogContext = {
        source: 'auto-play',
        operation: 'generate-scene',
        details: { sceneId: 'S-001', attempt: 1 },
      };

      const id = logError('Failed to generate scene', new Error('Network timeout'), context);

      expect(id).toMatch(/^err-\d+-\d+$/);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          severity: 'error',
          message: 'Failed to generate scene',
          errorMessage: 'Network timeout',
          source: 'auto-play',
          operation: 'generate-scene',
          details: { sceneId: 'S-001', attempt: 1 },
        })
      );
    });

    it('categorizes network errors correctly', () => {
      const listener = vi.fn();
      onSystemLog(listener);

      logError('Test', new Error('fetch failed'), { source: 'other' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ category: 'network' }));

      vi.clearAllMocks();
      logError('Test', new Error('ECONNREFUSED'), { source: 'other' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ category: 'network' }));
    });

    it('categorizes timeout errors correctly', () => {
      const listener = vi.fn();
      onSystemLog(listener);

      logError('Test', new Error('Request timed out'), { source: 'other' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ category: 'timeout' }));
    });

    it('categorizes parsing errors correctly', () => {
      const listener = vi.fn();
      onSystemLog(listener);

      logError('Test', new Error('Invalid JSON'), { source: 'other' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ category: 'parsing' }));
    });

    it('categorizes validation errors correctly', () => {
      const listener = vi.fn();
      onSystemLog(listener);

      logError('Test', new Error('validation failed'), { source: 'other' });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ category: 'validation' }));
    });

    it('includes narrative ID when set', () => {
      const listener = vi.fn();
      onSystemLog(listener);
      setSystemLoggerNarrativeId('N-001');

      logError('Test', new Error('Test error'), { source: 'other' });

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ narrativeId: 'N-001' }));
    });

    it('excludes narrative ID when not set', () => {
      const listener = vi.fn();
      onSystemLog(listener);
      setSystemLoggerNarrativeId(null);

      logError('Test', new Error('Test error'), { source: 'other' });

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ narrativeId: undefined }));
    });

    it('handles non-Error error values', () => {
      const listener = vi.fn();
      onSystemLog(listener);

      logError('Test', 'String error', { source: 'other' });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: 'String error',
          errorStack: undefined,
        })
      );
    });

    it('includes error stack when Error object provided', () => {
      const listener = vi.fn();
      onSystemLog(listener);

      const error = new Error('Test error');
      logError('Test', error, { source: 'other' });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          errorStack: expect.stringContaining('Error: Test error'),
        })
      );
    });

    it('logs to console.error for error severity', () => {
      onSystemLog(() => {});

      logError('Test message', new Error('Test error'), { source: 'auto-play', operation: 'test', details: { foo: 'bar' } });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] [auto-play/test] Test message'),
        { foo: 'bar' }
      );
    });

    it('returns unique IDs for sequential calls', () => {
      const listener = vi.fn();
      onSystemLog(listener);

      const id1 = logError('First', new Error('E1'), { source: 'other' });
      const id2 = logError('Second', new Error('E2'), { source: 'other' });

      expect(id1).not.toBe(id2);
    });
  });

  describe('logWarning', () => {
    it('creates warning log entry with warning severity', () => {
      const listener = vi.fn();
      onSystemLog(listener);

      const context: LogContext = {
        source: 'mcts',
        operation: 'expand-node',
      };

      const id = logWarning('Node expansion slow', 'Timeout approaching', context);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          severity: 'warning',
          message: 'Node expansion slow',
          errorMessage: 'Timeout approaching',
        })
      );
    });

    it('logs to console.warn for warning severity', () => {
      onSystemLog(() => {});

      logWarning('Test warning', 'Warning details', { source: 'other', details: { test: true } });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARNING]'),
        { test: true }
      );
    });
  });

  describe('setSystemLoggerNarrativeId', () => {
    it('updates narrative ID for subsequent logs', () => {
      const listener = vi.fn();
      onSystemLog(listener);

      setSystemLoggerNarrativeId('N-001');
      logError('Error 1', new Error('Test'), { source: 'other' });

      setSystemLoggerNarrativeId('N-002');
      logError('Error 2', new Error('Test'), { source: 'other' });

      expect(listener).toHaveBeenNthCalledWith(1, expect.objectContaining({ narrativeId: 'N-001' }));
      expect(listener).toHaveBeenNthCalledWith(2, expect.objectContaining({ narrativeId: 'N-002' }));
    });
  });

  describe('onSystemLog', () => {
    it('replaces previous listener', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      onSystemLog(listener1);
      onSystemLog(listener2);

      logError('Test', new Error('Test'), { source: 'other' });

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });
});
