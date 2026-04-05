'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import type { ApiLogEntry } from '@/types/narrative';

function StatusBadge({ status }: { status: ApiLogEntry['status'] }) {
  const styles = {
    pending: 'bg-amber-400/15 text-amber-400',
    success: 'bg-emerald-400/15 text-emerald-400',
    error: 'bg-red-400/15 text-red-400',
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${styles[status]}`}>
      {status === 'pending' ? (
        <span className="inline-flex items-center gap-1">
          <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
            <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          pending
        </span>
      ) : status}
    </span>
  );
}

function LogDetail({ entry, onClose }: { entry: ApiLogEntry; onClose: () => void }) {
  const hasReasoning = !!entry.reasoningContent;
  const hasSystemPrompt = !!entry.systemPromptPreview;
  const [tab, setTab] = useState<'system' | 'prompt' | 'response' | 'reasoning'>('prompt');

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
          <span className="text-[13px] text-text-primary font-medium truncate">{entry.caller}</span>
          {entry.model && <span className={`text-[9px] font-mono ${entry.model.startsWith('replicate/') ? 'text-pink-400' : 'text-text-dim'}`}>{entry.model.split('/').pop()}</span>}
          <StatusBadge status={entry.status} />
        </div>
        <span className="text-[10px] text-text-dim shrink-0">
          {entry.durationMs != null ? `${(entry.durationMs / 1000).toFixed(1)}s` : '...'}
        </span>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5 text-[10px] text-text-dim shrink-0">
        <span>Prompt: ~{(entry.promptTokens ?? 0).toLocaleString()} tokens</span>
        {entry.responseTokens != null && <span>Response: ~{entry.responseTokens.toLocaleString()} tokens</span>}
        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
      </div>

      {entry.error && (
        <div className="px-4 py-2 text-[11px] text-red-400 bg-red-400/5 border-b border-white/5 shrink-0">
          {entry.error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-white/8 shrink-0">
        {hasSystemPrompt && (
          <button
            className={`px-4 py-2 text-[11px] transition-colors ${tab === 'system' ? 'text-cyan-400 border-b border-cyan-400/50' : 'text-text-dim hover:text-cyan-300'}`}
            onClick={() => setTab('system')}
          >
            System
          </button>
        )}
        <button
          className={`px-4 py-2 text-[11px] transition-colors ${tab === 'prompt' ? 'text-text-primary border-b border-white/30' : 'text-text-dim hover:text-text-secondary'}`}
          onClick={() => setTab('prompt')}
        >
          Prompt
        </button>
        <button
          className={`px-4 py-2 text-[11px] transition-colors ${tab === 'response' ? 'text-text-primary border-b border-white/30' : 'text-text-dim hover:text-text-secondary'}`}
          onClick={() => setTab('response')}
        >
          Response
        </button>
        {hasReasoning && (
          <button
            className={`px-4 py-2 text-[11px] transition-colors ${tab === 'reasoning' ? 'text-purple-400 border-b border-purple-400/50' : 'text-text-dim hover:text-purple-300'}`}
            onClick={() => setTab('reasoning')}
          >
            Reasoning
          </button>
        )}
      </div>

      {/* Content */}
      <div className="overflow-y-auto p-4" style={{ maxHeight: 'calc(80vh - 10rem)' }}>
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word font-mono text-text-secondary">
          {tab === 'system'
            ? entry.systemPromptPreview || '(no system prompt)'
            : tab === 'prompt'
            ? entry.promptPreview || '(empty)'
            : tab === 'reasoning'
            ? entry.reasoningContent || '(no reasoning content)'
            : entry.responsePreview || (entry.status === 'pending' ? 'Waiting for response...' : '(empty)')}
        </pre>
      </div>
    </div>
  );
}

type LogFilter = 'all' | 'narrative' | 'analysis' | 'discovery';

export function ApiLogsModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState<LogFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filter logs based on selected context
  const filteredLogs = state.apiLogs.filter((log) => {
    if (filter === 'all') return true;
    if (filter === 'narrative') return log.narrativeId === state.activeNarrativeId;
    if (filter === 'analysis') {
      // Show logs from any analysis job
      return log.analysisId != null;
    }
    if (filter === 'discovery') {
      // Show logs from any discovery session
      return log.discoveryId != null;
    }
    return true;
  });

  const selectedEntry = selectedId ? filteredLogs.find((l) => l.id === selectedId) : null;

  const pendingCount = filteredLogs.filter((l) => l.status === 'pending').length;
  const errorCount = filteredLogs.filter((l) => l.status === 'error').length;

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="80vh">
      {selectedEntry ? (
        <LogDetail entry={selectedEntry} onClose={() => setSelectedId(null)} />
      ) : (
        <>
          <ModalHeader onClose={onClose}>
            <div className="flex items-center gap-3">
              <h2 className="text-[14px] font-medium text-text-primary">API Logs</h2>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as LogFilter)}
                className="bg-white/5 border border-white/10 text-text-primary text-[11px] px-2 py-1 rounded hover:bg-white/8 transition-colors"
              >
                <option value="all">All</option>
                <option value="narrative">Narrative</option>
                <option value="analysis">Analysis</option>
                <option value="discovery">Discovery</option>
              </select>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              {pendingCount > 0 && (
                <span className="text-amber-400">{pendingCount} pending</span>
              )}
              {errorCount > 0 && (
                <span className="text-red-400">{errorCount} failed</span>
              )}
              <span className="text-text-dim">{filteredLogs.length} {filter === 'all' ? 'total' : filter}</span>
            </div>
            {state.apiLogs.length > 0 && (
              <button
                onClick={() => dispatch({ type: 'CLEAR_API_LOGS' })}
                className="text-[11px] text-text-dim hover:text-text-secondary transition-colors px-2 py-1 rounded hover:bg-white/5"
              >
                Clear
              </button>
            )}
          </ModalHeader>
          <ModalBody className="p-0">
            {filteredLogs.length === 0 ? (
              <div className="flex items-center justify-center h-full p-8">
                <p className="text-[12px] text-text-dim">
                  {filter === 'all' ? 'No API calls yet. Generate or expand to see logs.' : `No ${filter} API calls.`}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {[...filteredLogs].reverse().map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedId(entry.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/4 transition-colors text-left"
                  >
                    <StatusBadge status={entry.status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-text-primary font-medium">{entry.caller}</span>
                        {entry.model && (
                          <span className={`text-[9px] font-mono ${entry.model.startsWith('replicate/') ? 'text-pink-400' : 'text-text-dim'}`}>
                            {entry.model.split('/').pop()}
                          </span>
                        )}
                        {entry.model?.startsWith('replicate/') ? (
                          <span className="text-[10px] text-pink-400/60">$0.04</span>
                        ) : (
                          <span className="text-[10px] text-text-dim">~{(entry.promptTokens ?? 0).toLocaleString()} tokens</span>
                        )}
                      </div>
                      {entry.error && (
                        <p className="text-[10px] text-red-400 truncate mt-0.5">{entry.error}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-text-dim">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </div>
                      {entry.durationMs != null && (
                        <div className="text-[10px] text-text-dim">
                          {(entry.durationMs / 1000).toFixed(1)}s
                        </div>
                      )}
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
