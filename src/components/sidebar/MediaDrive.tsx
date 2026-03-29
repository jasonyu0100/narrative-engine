'use client';

import { useMemo, useState, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry } from '@/types/narrative';
import { apiHeaders } from '@/lib/api-headers';
import { logApiCall, updateApiLog } from '@/lib/api-logger';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import MediaPreview from '@/components/sidebar/MediaPreview';
import type { MediaItem } from '@/components/sidebar/MediaPreview';
import type { Scene, Character, Location, Artifact } from '@/types/narrative';

type AssetTab = 'characters' | 'locations' | 'artifacts' | 'scenes';

type SceneReadiness = {
  scene: Scene;
  missingCharacters: Character[];
  missingLocation: Location | null;
  ready: boolean;
};

async function generateImage(
  type: 'character' | 'location' | 'scene',
  payload: Record<string, unknown>,
): Promise<{ imageUrl: string }> {
  const body = JSON.stringify({ type, ...payload });
  const logId = logApiCall(`MediaDrive.generateImage(${type})`, body.length, body, 'replicate/seedream-4.5');
  const start = performance.now();

  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: apiHeaders(),
      body,
    });
    if (!res.ok) {
      const err = await res.json();
      const message = err.error || 'Image generation failed';
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
      throw new Error(message);
    }
    const data = await res.json();
    updateApiLog(logId, { status: 'success', durationMs: Math.round(performance.now() - start), responsePreview: `image generated (${type})` });
    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw err;
  }
}

function Spinner() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" className="animate-spin">
      <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="12 8" />
    </svg>
  );
}

function GenerateButton({ onClick, disabled, generating }: { onClick: () => void; disabled: boolean; generating: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-white/6 text-text-dim hover:text-accent hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      title="Generate image"
    >
      {generating ? <Spinner /> : (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="1" y="2" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1" />
          <circle cx="3.5" cy="4.5" r="1" stroke="currentColor" strokeWidth="0.8" fill="none" />
          <path d="M1 7L4 5L6 6.5L8 4.5L9 5.5V7.5C9 7.8 8.8 8 8.5 8H1.5C1.2 8 1 7.8 1 7.5V7Z" fill="currentColor" opacity="0.4" />
        </svg>
      )}
    </button>
  );
}

export default function MediaDrive() {
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const narrative = state.activeNarrative;
  const [tab, setTab] = useState<AssetTab>('characters');
  const [generating, setGenerating] = useState<string | null>(null);
  const [showStyleEditor, setShowStyleEditor] = useState(false);
  const [styleDraft, setStyleDraft] = useState(narrative?.imageStyle ?? '');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const characters = useMemo(() => {
    if (!narrative) return [];
    return Object.values(narrative.characters).sort((a, b) => {
      const roleOrder = { anchor: 0, recurring: 1, transient: 2 };
      return (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3);
    });
  }, [narrative]);

  const locations = useMemo(() => {
    if (!narrative) return [];
    return Object.values(narrative.locations);
  }, [narrative]);

  const artifacts = useMemo(() => {
    if (!narrative) return [];
    return Object.values(narrative.artifacts ?? {});
  }, [narrative]);

  const scenes = useMemo(() => {
    if (!narrative) return [];
    const keys = state.resolvedEntryKeys.slice(0, state.currentSceneIndex + 1);
    return keys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => e?.kind === 'scene');
  }, [narrative, state.resolvedEntryKeys, state.currentSceneIndex]);

  // Compute scene readiness — which references are missing
  const sceneReadiness = useMemo((): SceneReadiness[] => {
    if (!narrative) return [];
    return scenes.map((scene) => {
      const missingCharacters = scene.participantIds
        .map((id) => narrative.characters[id])
        .filter((c): c is Character => !!c && !c.imageUrl);
      const loc = narrative.locations[scene.locationId];
      const missingLocation = loc && !loc.imageUrl ? loc : null;
      return {
        scene,
        missingCharacters,
        missingLocation,
        ready: missingCharacters.length === 0 && !missingLocation,
      };
    });
  }, [narrative, scenes]);

  // Build preview items for current tab (only items with images)
  const previewItems = useMemo((): MediaItem[] => {
    if (tab === 'characters') {
      return characters.filter((c) => c.imageUrl).map((c) => ({
        id: c.id,
        imageUrl: c.imageUrl!,
        label: c.name,
        sublabel: c.role,
        aspectClass: 'aspect-[3/4]',
      }));
    }
    if (tab === 'locations') {
      return locations.filter((l) => l.imageUrl).map((l) => ({
        id: l.id,
        imageUrl: l.imageUrl!,
        label: l.name,
        sublabel: l.parentId && narrative?.locations[l.parentId] ? `in ${narrative.locations[l.parentId].name}` : undefined,
        aspectClass: 'aspect-video',
      }));
    }
    if (tab === 'artifacts') {
      return artifacts.filter((a) => a.imageUrl).map((a) => ({
        id: a.id,
        imageUrl: a.imageUrl!,
        label: a.name,
        sublabel: a.significance,
        aspectClass: 'aspect-square',
      }));
    }
    return scenes.filter((s) => s.imageUrl).map((s) => ({
      id: s.id,
      imageUrl: s.imageUrl!,
      label: s.summary.slice(0, 80) + (s.summary.length > 80 ? '...' : ''),
      sublabel: s.id,
      aspectClass: 'aspect-2/3',
    }));
  }, [tab, characters, locations, artifacts, scenes, narrative]);

  const openPreview = useCallback((id: string) => {
    const idx = previewItems.findIndex((item) => item.id === id);
    if (idx >= 0) setPreviewIndex(idx);
  }, [previewItems]);

  const requireKeys = useCallback(() => {
    if (access.userApiKeys && !access.hasReplicateKey) {
      window.dispatchEvent(new Event('open-api-keys'));
      return true;
    }
    return false;
  }, [access.userApiKeys, access.hasReplicateKey]);

  const generateCharacterImage = useCallback(async (char: Character) => {
    if (!narrative || generating || requireKeys()) return;
    setGenerating(char.id);
    try {
      const hints = char.continuity.nodes.map((n) => `${n.type}: ${n.content}`);
      const { imageUrl } = await generateImage('character', {
        name: char.name,
        role: char.role,
        worldSummary: narrative.worldSummary,
        continuityHints: hints.slice(0, 5),
        imagePrompt: char.imagePrompt,
        imageStyle: narrative.imageStyle,
      });
      dispatch({ type: 'SET_CHARACTER_IMAGE', characterId: char.id, imageUrl });
    } catch (err) {
      console.error('Failed to generate character image:', err);
    } finally {
      setGenerating(null);
    }
  }, [narrative, generating, dispatch, requireKeys]);

  const generateLocationImage = useCallback(async (loc: Location) => {
    if (!narrative || generating || requireKeys()) return;
    setGenerating(loc.id);
    try {
      const parentName = loc.parentId ? narrative.locations[loc.parentId]?.name : undefined;
      const hints = loc.continuity.nodes.map((n) => `${n.type}: ${n.content}`);
      const { imageUrl } = await generateImage('location', {
        name: loc.name,
        parentName,
        worldSummary: narrative.worldSummary,
        continuityHints: hints.slice(0, 5),
        imagePrompt: loc.imagePrompt,
        imageStyle: narrative.imageStyle,
      });
      dispatch({ type: 'SET_LOCATION_IMAGE', locationId: loc.id, imageUrl });
    } catch (err) {
      console.error('Failed to generate location image:', err);
    } finally {
      setGenerating(null);
    }
  }, [narrative, generating, dispatch, requireKeys]);

  const generateArtifactImage = useCallback(async (artifact: Artifact) => {
    if (!narrative || generating || requireKeys()) return;
    setGenerating(artifact.id);
    try {
      const hints = artifact.continuity.nodes.map((n) => `${n.type}: ${n.content}`);
      const ownerName = narrative.characters[artifact.parentId]?.name
        ?? narrative.locations[artifact.parentId]?.name
        ?? undefined;
      const { imageUrl } = await generateImage('character', {
        name: artifact.name,
        role: `artifact (${artifact.significance})`,
        worldSummary: narrative.worldSummary,
        continuityHints: [`Owner: ${ownerName ?? 'unknown'}`, ...hints.slice(0, 4)],
        imagePrompt: artifact.imagePrompt,
        imageStyle: narrative.imageStyle,
      });
      dispatch({ type: 'SET_ARTIFACT_IMAGE', artifactId: artifact.id, imageUrl });
    } catch (err) {
      console.error('Failed to generate artifact image:', err);
    } finally {
      setGenerating(null);
    }
  }, [narrative, generating, dispatch, requireKeys]);

  const generateSceneImage = useCallback(async (readiness: SceneReadiness) => {
    if (!narrative || generating || requireKeys()) return;
    setGenerating(readiness.scene.id);
    try {
      // Cascade: generate all missing refs in parallel with staggered starts
      const stagger = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      const refTasks: Promise<void>[] = [];
      let delay = 0;

      for (const char of readiness.missingCharacters) {
        const d = delay;
        refTasks.push(
          stagger(d).then(() =>
            generateImage('character', {
              name: char.name,
              role: char.role,
              worldSummary: narrative.worldSummary,
              continuityHints: char.continuity.nodes.map((n) => `${n.type}: ${n.content}`).slice(0, 5),
              imagePrompt: char.imagePrompt,
              imageStyle: narrative.imageStyle,
            })
              .then(({ imageUrl }) => { dispatch({ type: 'SET_CHARACTER_IMAGE', characterId: char.id, imageUrl }); })
          ).catch((err) => { console.error(`Failed to generate portrait for ${char.name}:`, err); }),
        );
        delay += 500;
      }

      if (readiness.missingLocation) {
        const loc = readiness.missingLocation;
        const parentName = loc.parentId ? narrative.locations[loc.parentId]?.name : undefined;
        const d = delay;
        refTasks.push(
          stagger(d).then(() =>
            generateImage('location', {
              name: loc.name,
              parentName,
              worldSummary: narrative.worldSummary,
              continuityHints: loc.continuity.nodes.map((n) => `${n.type}: ${n.content}`).slice(0, 5),
              imagePrompt: loc.imagePrompt,
              imageStyle: narrative.imageStyle,
            })
              .then(({ imageUrl }) => { dispatch({ type: 'SET_LOCATION_IMAGE', locationId: loc.id, imageUrl }); })
          ).catch((err) => { console.error(`Failed to generate location ${loc.name}:`, err); }),
        );
      }

      // Wait for all refs to settle (partial failures don't block the scene)
      await Promise.allSettled(refTasks);

      // Generate the scene still
      const locationName = narrative.locations[readiness.scene.locationId]?.name ?? 'unknown';
      const charDescs = readiness.scene.participantIds
        .map((id) => narrative.characters[id])
        .filter(Boolean)
        .map((c) => ({
          name: c.name,
          visualDescription: c.imagePrompt || c.continuity.nodes.slice(0, 3).map((n) => n.content).join('. ') || c.role,
        }));
      const { imageUrl } = await generateImage('scene', {
        summary: readiness.scene.summary,
        locationName,
        characterDescriptions: charDescs,
        worldSummary: narrative.worldSummary,
        imageStyle: narrative.imageStyle,
      });
      dispatch({ type: 'SET_SCENE_IMAGE', sceneId: readiness.scene.id, imageUrl });
    } catch (err) {
      console.error('Failed to generate scene image:', err);
    } finally {
      setGenerating(null);
    }
  }, [narrative, generating, dispatch, requireKeys]);

  if (!narrative) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-xs text-text-dim text-center">Select a narrative</p>
      </div>
    );
  }



  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Style settings */}
      <div className="shrink-0 border-b border-border">
        <button
          onClick={() => setShowStyleEditor(!showStyleEditor)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-text-dim hover:text-text-secondary transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1" />
            <circle cx="5" cy="5" r="1.5" fill="currentColor" />
          </svg>
          <span className="flex-1 text-left truncate">
            {narrative.imageStyle ? `Style: ${narrative.imageStyle.slice(0, 30)}...` : 'Set image style'}
          </span>
          <span className="text-[8px]" style={{ transform: showStyleEditor ? 'rotate(180deg)' : 'none' }}>
            ▼
          </span>
        </button>
        {showStyleEditor && (
          <div className="px-2 pb-2 space-y-1">
            <textarea
              value={styleDraft}
              onChange={(e) => setStyleDraft(e.target.value)}
              placeholder="e.g. Dark medieval fantasy, gritty realism, muted palette, cinematic lighting, HBO-inspired"
              rows={3}
              className="w-full bg-white/5 border border-border rounded px-2 py-1.5 text-[10px] text-text-primary placeholder:text-text-dim resize-none focus:outline-none focus:border-white/20 transition-colors"
            />
            <button
              onClick={() => {
                dispatch({ type: 'SET_IMAGE_STYLE', style: styleDraft });
                setShowStyleEditor(false);
              }}
              className="text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              Save style
            </button>
          </div>
        )}
      </div>

      {/* Asset type tabs */}
      <div className="shrink-0 flex border-b border-border">
        {([
          ['characters', 'Cast'],
          ['locations', 'Places'],
          ['artifacts', 'Items'],
          ['scenes', 'Stills'],
        ] as [AssetTab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 px-1 py-1.5 text-[10px] font-medium transition-colors ${
              tab === key
                ? 'text-text-primary border-b border-accent'
                : 'text-text-dim hover:text-text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {/* ── Characters ── */}
        {tab === 'characters' && characters.map((char) => (
          <div key={char.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-elevated transition-colors">
            {char.imageUrl ? (
              <button onClick={() => openPreview(char.id)} className="shrink-0">
                <img src={char.imageUrl} alt={char.name} className="w-8 h-8 rounded-full object-cover border border-border hover:border-accent/50 transition-colors" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded-full bg-white/6 shrink-0 flex items-center justify-center border border-border border-dashed">
                <span className="text-[10px] text-text-dim">{char.name[0]}</span>
              </div>
            )}
            <button
              onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: char.id } })}
              className="flex-1 text-left min-w-0"
            >
              <p className="text-xs text-text-primary truncate">{char.name}</p>
              <p className="text-[10px] text-text-dim">{char.role}</p>
            </button>
            <GenerateButton onClick={() => generateCharacterImage(char)} disabled={generating !== null} generating={generating === char.id} />
          </div>
        ))}

        {/* ── Locations ── */}
        {tab === 'locations' && locations.map((loc) => (
          <div key={loc.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-elevated transition-colors">
            {loc.imageUrl ? (
              <button onClick={() => openPreview(loc.id)} className="shrink-0">
                <img src={loc.imageUrl} alt={loc.name} className="w-8 h-8 rounded object-cover border border-border hover:border-accent/50 transition-colors" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded bg-white/6 shrink-0 flex items-center justify-center border border-border border-dashed">
                <span className="text-[10px] text-text-dim">{loc.name[0]}</span>
              </div>
            )}
            <button
              onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: loc.id } })}
              className="flex-1 text-left min-w-0"
            >
              <p className="text-xs text-text-primary truncate">{loc.name}</p>
              {loc.parentId && narrative.locations[loc.parentId] && (
                <p className="text-[10px] text-text-dim truncate">in {narrative.locations[loc.parentId].name}</p>
              )}
            </button>
            <GenerateButton onClick={() => generateLocationImage(loc)} disabled={generating !== null} generating={generating === loc.id} />
          </div>
        ))}

        {/* ── Artifacts ── */}
        {tab === 'artifacts' && artifacts.map((artifact) => (
          <div key={artifact.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-elevated transition-colors">
            {artifact.imageUrl ? (
              <button onClick={() => openPreview(artifact.id)} className="shrink-0">
                <img src={artifact.imageUrl} alt={artifact.name} className="w-8 h-8 rounded object-cover border border-border hover:border-accent/50 transition-colors" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded bg-white/6 shrink-0 flex items-center justify-center border border-border border-dashed">
                <span className="text-[10px] text-text-dim">{artifact.name[0]}</span>
              </div>
            )}
            <button
              onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'artifact', artifactId: artifact.id } })}
              className="flex-1 text-left min-w-0"
            >
              <p className="text-xs text-text-primary truncate">{artifact.name}</p>
              <p className="text-[10px] text-text-dim">{artifact.significance}</p>
            </button>
            <GenerateButton onClick={() => generateArtifactImage(artifact)} disabled={generating !== null} generating={generating === artifact.id} />
          </div>
        ))}

        {/* ── Scenes ── */}
        {tab === 'scenes' && sceneReadiness.map(({ scene, missingCharacters, missingLocation, ready }) => (
          <div key={scene.id} className="rounded border border-border overflow-hidden mb-2">
            {scene.imageUrl ? (
              <div className="relative group">
                <button
                  onClick={() => openPreview(scene.id)}
                  className="w-full"
                >
                  <img src={scene.imageUrl} alt={scene.summary} className="w-full aspect-2/3 object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent px-2 py-1.5">
                    <p className="text-[10px] text-white/70 leading-tight truncate">
                      <span className="text-white/40 font-mono mr-1">{scene.id}</span>
                      {scene.summary}
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => generateSceneImage({ scene, missingCharacters, missingLocation, ready })}
                  disabled={generating !== null}
                  className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded bg-black/60 text-white/50 hover:text-white opacity-0 group-hover:opacity-100 disabled:opacity-30 transition-opacity"
                  title="Regenerate"
                >
                  {generating === scene.id ? <Spinner /> : (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
                    </svg>
                  )}
                </button>
              </div>
            ) : (
              <div className="px-2 py-1.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="font-mono text-[10px] bg-white/6 text-text-secondary px-1.5 py-0.5 rounded shrink-0">
                    {scene.id}
                  </span>
                  <span className="text-[10px] text-text-primary truncate flex-1">
                    {scene.summary.slice(0, 50)}{scene.summary.length > 50 ? '...' : ''}
                  </span>
                </div>

                {/* Readiness indicator */}
                {!ready && (
                  <div className="mb-1.5">
                    {missingCharacters.length > 0 && (
                      <p className="text-[9px] text-amber-400/70 leading-tight">
                        Missing: {missingCharacters.map((c) => c.name).join(', ')}
                      </p>
                    )}
                    {missingLocation && (
                      <p className="text-[9px] text-amber-400/70 leading-tight">
                        Missing: {missingLocation.name} (location)
                      </p>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => generateSceneImage({ scene, missingCharacters, missingLocation, ready })}
                    disabled={generating !== null}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {generating === scene.id ? (
                      <><Spinner /> <span>{!ready ? 'Generating references...' : 'Generating...'}</span></>
                    ) : (
                      ready ? 'Generate still' : `Generate (+ ${missingCharacters.length + (missingLocation ? 1 : 0)} refs)`
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {previewIndex !== null && previewItems.length > 0 && (
        <MediaPreview
          items={previewItems}
          currentIndex={previewIndex}
          onNavigate={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}
