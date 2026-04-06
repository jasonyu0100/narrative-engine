'use client';

import { useState, useMemo } from 'react';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { useStore } from '@/lib/store';
import type { SystemLogEntry } from '@/types/narrative';

type Props = {
  onClose: () => void;
};

function SeverityBadge({ severity }: { severity: 'error' | 'warning' | 'info' }) {
  const styles = {
    error: 'bg-red-400/15 text-red-400',
    warning: 'bg-amber-400/15 text-amber-400',
    info: 'bg-cyan-400/15 text-cyan-400',
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${styles[severity]}`}>
      {severity}
    </span>
  );
}

function CategoryBadge({ category }: { category: SystemLogEntry['category'] }) {
  const styles = {
    network: 'bg-blue-400/10 text-blue-400',
    timeout: 'bg-orange-400/10 text-orange-400',
    parsing: 'bg-purple-400/10 text-purple-400',
    validation: 'bg-yellow-400/10 text-yellow-400',
    lifecycle: 'bg-green-400/10 text-green-400',
    unknown: 'bg-gray-400/10 text-gray-400',
  };
  return (
    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${styles[category]}`}>
      {category}
    </span>
  );
}

function LogDetail({ entry, onClose }: { entry: SystemLogEntry; onClose: () => void }) {
  const [tab, setTab] = useState<'message' | 'stack' | 'details'>('message');

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text-primary transition-colors text-xs"
          >
            &larr; Back
          </button>
          <div className="w-px h-3.5 bg-white/10" />
          <span className="text-[13px] text-text-primary font-medium truncate">{entry.source}</span>
          {entry.operation && <span className="text-[10px] text-text-dim">{entry.operation}</span>}
          <SeverityBadge severity={entry.severity} />
          <CategoryBadge category={entry.category} />
        </div>
        <span className="text-[10px] text-text-dim shrink-0">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Context message */}
      <div className="px-4 py-3 border-b border-white/5 shrink-0">
        <p className="text-[12px] text-text-primary leading-relaxed">{entry.message}</p>
      </div>

      {/* Metadata */}
      {entry.details && Object.keys(entry.details).length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 text-[10px] text-text-dim shrink-0 flex-wrap">
          {Object.entries(entry.details).map(([key, value]) => (
            value != null && (
              <span key={key}>
                <span className="text-text-dim/60">{key}:</span> <span className="text-text-secondary">{String(value)}</span>
              </span>
            )
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-white/8 shrink-0">
        <button
          className={`px-4 py-2 text-[11px] transition-colors ${tab === 'message' ? 'text-text-primary border-b border-white/30' : 'text-text-dim hover:text-text-secondary'}`}
          onClick={() => setTab('message')}
        >
          Error Message
        </button>
        {entry.errorStack && (
          <button
            className={`px-4 py-2 text-[11px] transition-colors ${tab === 'stack' ? 'text-red-400 border-b border-red-400/50' : 'text-text-dim hover:text-red-300'}`}
            onClick={() => setTab('stack')}
          >
            Stack Trace
          </button>
        )}
        {entry.details && Object.keys(entry.details).length > 0 && (
          <button
            className={`px-4 py-2 text-[11px] transition-colors ${tab === 'details' ? 'text-cyan-400 border-b border-cyan-400/50' : 'text-text-dim hover:text-cyan-300'}`}
            onClick={() => setTab('details')}
          >
            Details
          </button>
        )}
      </div>

      {/* Content */}
      <div className="overflow-y-auto p-4" style={{ maxHeight: 'calc(80vh - 14rem)' }}>
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word font-mono text-text-secondary">
          {tab === 'message'
            ? entry.errorMessage
            : tab === 'stack'
            ? entry.errorStack || '(no stack trace)'
            : JSON.stringify(entry.details, null, 2)}
        </pre>
      </div>
    </div>
  );
}

type ContextFilter = 'all' | 'narrative' | 'analysis' | 'discovery';

export default function SystemLogModal({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const logs = state.systemLogs;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [filterContext, setFilterContext] = useState<ContextFilter>('all');

  const selectedEntry = selectedId ? logs.find((l) => l.id === selectedId) : null;

  const filteredLogs = useMemo(() => {
    let filtered = [...logs].reverse(); // Most recent first

    // Filter by severity
    if (filterSeverity !== 'all') {
      filtered = filtered.filter(l => l.severity === filterSeverity);
    }

    // Filter by context
    if (filterContext !== 'all') {
      if (filterContext === 'narrative') {
        filtered = filtered.filter(l => l.narrativeId === state.activeNarrativeId);
      } else if (filterContext === 'analysis') {
        filtered = filtered.filter(l => l.analysisId != null);
      } else if (filterContext === 'discovery') {
        filtered = filtered.filter(l => l.discoveryId != null);
      }
    }

    return filtered;
  }, [logs, filterSeverity, filterContext, state.activeNarrativeId]);

  const errorCount = logs.filter((l) => l.severity === 'error').length;
  const warningCount = logs.filter((l) => l.severity === 'warning').length;
  const infoCount = logs.filter((l) => l.severity === 'info').length;

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

    return date.toLocaleTimeString();
  }

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="80vh">
      {selectedEntry ? (
        <LogDetail entry={selectedEntry} onClose={() => setSelectedId(null)} />
      ) : (
        <>
          <ModalHeader onClose={onClose}>
            <div className="flex items-center gap-3">
              <h2 className="text-[14px] font-medium text-text-primary">System Logs</h2>
              <select
                value={filterContext}
                onChange={(e) => setFilterContext(e.target.value as ContextFilter)}
                className="bg-white/5 border border-white/10 text-text-primary text-[11px] px-2 py-1 rounded hover:bg-white/8 transition-colors"
              >
                <option value="all">All</option>
                <option value="narrative">Narrative</option>
                <option value="analysis">Analysis</option>
                <option value="discovery">Discovery</option>
              </select>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              {errorCount > 0 && (
                <span className="text-red-400">{errorCount} errors</span>
              )}
              {warningCount > 0 && (
                <span className="text-amber-400">{warningCount} warnings</span>
              )}
              {infoCount > 0 && (
                <span className="text-cyan-400">{infoCount} info</span>
              )}
              <span className="text-text-dim">{filteredLogs.length} {filterContext === 'all' ? 'total' : filterContext}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Quick filter */}
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
                  Errors
                </button>
                <button
                  onClick={() => setFilterSeverity('warning')}
                  className={`px-2 py-1 rounded text-[10px] transition-colors ${
                    filterSeverity === 'warning' ? 'bg-amber-500/20 text-amber-400' : 'text-text-dim hover:text-amber-400'
                  }`}
                >
                  Warnings
                </button>
                <button
                  onClick={() => setFilterSeverity('info')}
                  className={`px-2 py-1 rounded text-[10px] transition-colors ${
                    filterSeverity === 'info' ? 'bg-cyan-500/20 text-cyan-400' : 'text-text-dim hover:text-cyan-400'
                  }`}
                >
                  Info
                </button>
              </div>
              {logs.length > 0 && (
                <button
                  onClick={() => dispatch({ type: 'CLEAR_SYSTEM_LOGS' })}
                  className="text-[11px] text-text-dim hover:text-text-secondary transition-colors px-2 py-1 rounded hover:bg-white/5"
                >
                  Clear
                </button>
              )}
            </div>
          </ModalHeader>
          <ModalBody className="p-0">
            {filteredLogs.length === 0 ? (
              <div className="flex items-center justify-center h-full p-8">
                <p className="text-[12px] text-text-dim">
                  {logs.length === 0
                    ? 'No errors or warnings logged yet.'
                    : 'No logs match the current filter.'}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {filteredLogs.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedId(entry.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/4 transition-colors text-left"
                  >
                    <SeverityBadge severity={entry.severity} />
                    <CategoryBadge category={entry.category} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-text-primary font-medium">{entry.source}</span>
                        {entry.operation && (
                          <span className="text-[10px] text-text-dim">{entry.operation}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-text-secondary truncate mt-0.5">{entry.message}</p>
                      {entry.errorMessage && entry.errorMessage !== entry.message && (
                        <p className="text-[10px] text-text-dim/70 font-mono truncate mt-0.5">{entry.errorMessage}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-text-dim">
                        {formatTimestamp(entry.timestamp)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ModalBody>
        </>
      )}
    </Modal>
  );
}
