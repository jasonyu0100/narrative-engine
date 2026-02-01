import type { NarrativeState } from '@/types/narrative';

const STORAGE_KEY = 'narrative-engine:narratives';

export function loadNarratives(): NarrativeState[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as NarrativeState[];
  } catch {
    return [];
  }
}

export function saveNarratives(narratives: NarrativeState[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(narratives));
  } catch {
    // localStorage full or unavailable
  }
}

export function saveNarrative(narrative: NarrativeState) {
  const all = loadNarratives();
  const idx = all.findIndex((n) => n.id === narrative.id);
  if (idx >= 0) {
    all[idx] = narrative;
  } else {
    all.push(narrative);
  }
  saveNarratives(all);
}

export function deleteNarrative(id: string) {
  const all = loadNarratives();
  saveNarratives(all.filter((n) => n.id !== id));
}

export function loadNarrative(id: string): NarrativeState | null {
  const all = loadNarratives();
  return all.find((n) => n.id === id) ?? null;
}
