'use client';

import { useState, useMemo } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { useStore } from '@/lib/store';
import type { ErrorLogEntry } from '@/types/narrative';

type Props = {
  onClose: () => void;
};

type FilterSeverity = 'all' | 'error' | 'warning';
type FilterCategory = 'all' | 'network' | 'timeout' | 'parsing' | 'validation' | 'unknown';
type FilterSource = 'all' | ErrorLogEntry['source'];

export default function ErrorLogModal({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const [filterSeverity, setFilterSeverity] = useState<FilterSeverity>('all');
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('all');
  const [filterSource, setFilterSource] = useState<FilterSource>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    let logs = [...state.errorLogs].reverse(); // Most recent first

    if (filterSeverity !== 'all') {
      logs = logs.filter(l => l.severity === filterSeverity);
    }

    if (filterCategory !== 'all') {
      logs = logs.filter(l => l.category === filterCategory);
    }

    if (filterSource !== 'all') {
      logs = logs.filter(l => l.source === filterSource);
    }

    return logs;
  }, [state.errorLogs, filterSeverity, filterCategory, filterSource]);

  const stats = useMemo(() => {
    const errors = state.errorLogs.filter(l => l.severity === 'error').length;
    const warnings = state.errorLogs.filter(l => l.severity === 'warning').length;
    const categories = {
      network: state.errorLogs.filter(l => l.category === 'network').length,
      timeout: state.errorLogs.filter(l => l.category === 'timeout').length,
      parsing: state.errorLogs.filter(l => l.category === 'parsing').length,
      validation: state.errorLogs.filter(l => l.category === 'validation').length,
      unknown: state.errorLogs.filter(l => l.category === 'unknown').length,
    };
    return { errors, warnings, categories };
  }, [state.errorLogs]);

  function handleClear() {
    if (confirm('Clear all error logs? This cannot be undone.')) {
      dispatch({ type: 'CLEAR_ERROR_LOGS' });
    }
  }

  function formatTimestamp(ts: number): string {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);

    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;

    return date.toLocaleString();
  }

  function getSeverityColor(severity: 'error' | 'warning'): string {
    switch (severity) {
      case 'error': return 'text-red-400';
      case 'warning': return 'text-yellow-400';
    }
  }

  function getCategoryIcon(category: ErrorLogEntry['category']): string {
    switch (category) {
      case 'network': return '🌐';
      case 'timeout': return '⏱️';
      case 'parsing': return '📄';
      case 'validation': return '✓';
      case 'unknown': return '❓';
    }
  }

  return (
    <Modal onClose={onClose} size="xl">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center justify-between w-full pr-8">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Error & Warning Logs</h2>
            <p className="text-[10px] text-text-dim mt-0.5">
              {state.errorLogs.length} total ({stats.errors} errors, {stats.warnings} warnings)
            </p>
          </div>
          {state.errorLogs.length > 0 && (
            <button
              onClick={handleClear}
              className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </ModalHeader>

      <ModalBody>
        {/* Filters */}
        <div className="flex gap-2 mb-3 flex-wrap">
          <div className="flex gap-1">
            <button
              onClick={() => setFilterSeverity('all')}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                filterSeverity === 'all' ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterSeverity('error')}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                filterSeverity === 'error' ? 'bg-red-500/20 text-red-400' : 'text-text-dim hover:text-red-400'
              }`}
            >
              Errors ({stats.errors})
            </button>
            <button
              onClick={() => setFilterSeverity('warning')}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                filterSeverity === 'warning' ? 'bg-yellow-500/20 text-yellow-400' : 'text-text-dim hover:text-yellow-400'
              }`}
            >
              Warnings ({stats.warnings})
            </button>
          </div>

          <div className="h-4 w-px bg-border mx-1"></div>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value as FilterCategory)}
            className="px-2 py-1 rounded text-[10px] bg-white/5 border border-border text-text-primary"
          >
            <option value="all">All Categories</option>
            <option value="network">Network ({stats.categories.network})</option>
            <option value="timeout">Timeout ({stats.categories.timeout})</option>
            <option value="parsing">Parsing ({stats.categories.parsing})</option>
            <option value="validation">Validation ({stats.categories.validation})</option>
            <option value="unknown">Unknown ({stats.categories.unknown})</option>
          </select>

          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value as FilterSource)}
            className="px-2 py-1 rounded text-[10px] bg-white/5 border border-border text-text-primary"
          >
            <option value="all">All Sources</option>
            <option value="auto-play">Auto Mode</option>
            <option value="mcts">MCTS</option>
            <option value="manual-generation">Manual Generation</option>
            <option value="analysis">Analysis</option>
            <option value="world-expansion">World Expansion</option>
            <option value="direction-generation">Direction</option>
            <option value="prose-generation">Prose</option>
            <option value="plan-generation">Plan</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Log List */}
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-8 text-text-dim text-xs">
              {state.errorLogs.length === 0 ? 'No errors or warnings logged' : 'No logs match the current filters'}
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="border border-border rounded-lg p-3 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs">{getCategoryIcon(log.category)}</span>
                      <span className={`text-[10px] font-medium ${getSeverityColor(log.severity)}`}>
                        {log.severity.toUpperCase()}
                      </span>
                      <span className="text-[10px] text-text-dim">{log.source}</span>
                      {log.operation && (
                        <>
                          <span className="text-text-dim/30">·</span>
                          <span className="text-[10px] text-text-dim">{log.operation}</span>
                        </>
                      )}
                      <span className="text-[9px] text-text-dim ml-auto">{formatTimestamp(log.timestamp)}</span>
                    </div>

                    <p className="text-xs text-text-primary mb-1">{log.message}</p>

                    <p className="text-[10px] text-text-dim font-mono truncate">{log.errorMessage}</p>

                    {log.details && Object.keys(log.details).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {Object.entries(log.details).map(([key, value]) => (
                          value != null && (
                            <span key={key} className="text-[9px] bg-white/5 px-1.5 py-0.5 rounded text-text-dim">
                              {key}: {String(value)}
                            </span>
                          )
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    className="text-[10px] text-text-dim hover:text-text-secondary transition-colors flex-shrink-0"
                  >
                    {expandedId === log.id ? '▼' : '▶'}
                  </button>
                </div>

                {expandedId === log.id && (
                  <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                    <div>
                      <p className="text-[9px] text-text-dim font-medium mb-1">Error Message:</p>
                      <pre className="text-[10px] text-text-secondary font-mono bg-black/20 p-2 rounded overflow-x-auto whitespace-pre-wrap break-words">
                        {log.errorMessage}
                      </pre>
                    </div>

                    {log.errorStack && (
                      <div>
                        <p className="text-[9px] text-text-dim font-medium mb-1">Stack Trace:</p>
                        <pre className="text-[9px] text-text-secondary font-mono bg-black/20 p-2 rounded overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                          {log.errorStack}
                        </pre>
                      </div>
                    )}

                    {log.details && (
                      <div>
                        <p className="text-[9px] text-text-dim font-medium mb-1">Details:</p>
                        <pre className="text-[10px] text-text-secondary font-mono bg-black/20 p-2 rounded overflow-x-auto">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          onClick={onClose}
          className="px-3 py-1.5 bg-white/10 hover:bg-white/15 text-text-primary text-xs rounded transition-colors"
        >
          Close
        </button>
      </ModalFooter>
    </Modal>
  );
}
