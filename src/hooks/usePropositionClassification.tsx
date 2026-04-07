'use client';

/**
 * Proposition classification provider & hook.
 *
 * Computation runs in a Web Worker to avoid blocking the main thread.
 * Recomputes automatically when plans change (debounced).
 */

import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import { propKey, type NarrativeClassification, type PropConnection } from '@/lib/proposition-classify';
import type { NarrativeState, PropositionClassification } from '@/types/narrative';
import { resolveEntry, isScene } from '@/types/narrative';

// ── Context ─────────────────────────────────────────────────────────────────

type ClassificationContextValue = {
  getClassification: (sceneId: string, beatIndex: number, propIndex: number) => PropositionClassification | null;
  getConnections: (sceneId: string, beatIndex: number, propIndex: number) => { backward: PropConnection[]; forward: PropConnection[] } | null;
  sceneProfiles: NarrativeClassification['sceneProfiles'] | null;
};

const ClassificationContext = createContext<ClassificationContextValue>({
  getClassification: () => null,
  getConnections: () => null,
  sceneProfiles: null,
});

// ── Provider ────────────────────────────────────────────────────────────────

export function PropositionClassificationProvider({
  narrative,
  resolvedKeys,
  children,
}: {
  narrative: NarrativeState | null;
  resolvedKeys: string[];
  children: ReactNode;
}) {
  const [result, setResult] = useState<NarrativeClassification | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cheap version key — only changes when plan structure actually changes
  const planVersion = useMemo(() => {
    if (!narrative) return '';
    let hash = 0;
    for (const key of resolvedKeys) {
      const entry = resolveEntry(narrative, key);
      if (!entry || !isScene(entry)) continue;
      const pv = entry.planVersions;
      if (pv && pv.length > 0) {
        const latest = pv[pv.length - 1];
        const beatCount = latest.plan?.beats?.length ?? 0;
        const propCount = latest.plan?.beats?.reduce((s, b) => s + (b.propositions?.length ?? 0), 0) ?? 0;
        hash = ((hash << 5) - hash + beatCount * 97 + propCount * 31 + pv.length) | 0;
      }
    }
    return `${narrative.id}:${hash}`;
  }, [narrative, resolvedKeys]);

  const runClassification = useCallback(async () => {
    if (!narrative || resolvedKeys.length === 0) return;

    // Dynamic import to avoid loading classification code on initial bundle
    const { classifyPropositions } = await import('@/lib/proposition-classify');
    const res = await classifyPropositions(narrative, resolvedKeys);
    setResult(res);
  }, [narrative, resolvedKeys]);

  // Debounce: wait 500ms after last plan change before computing
  useEffect(() => {
    if (!planVersion) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runClassification();
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [planVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const value = useMemo<ClassificationContextValue>(() => ({
    getClassification: (sceneId: string, beatIndex: number, propIndex: number) => {
      return result?.classifications.get(propKey(sceneId, beatIndex, propIndex)) ?? null;
    },
    getConnections: (sceneId: string, beatIndex: number, propIndex: number) => {
      return result?.connections.get(propKey(sceneId, beatIndex, propIndex)) ?? null;
    },
    sceneProfiles: result?.sceneProfiles ?? null,
  }), [result]);

  return (
    <ClassificationContext.Provider value={value}>
      {children}
    </ClassificationContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function usePropositionClassification(): ClassificationContextValue {
  return useContext(ClassificationContext);
}
