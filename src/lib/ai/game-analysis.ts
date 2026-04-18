/**
 * Game-theoretic scene analysis — a purely additive, post-hoc layer.
 *
 * Given a scene's beat plan + optional prose + participant context, decompose
 * the scene into a sequence of 2×2 games. Does NOT mutate the scene's deltas,
 * threadLogs, or payoffMatrices — writes only to scene.gameAnalysis.
 */

import { callGenerateStream } from "./api";
import { parseJson } from "./json";
import { buildGameTheorySystemPrompt } from "@/lib/prompts/scenes/game-theory";
import { ANALYSIS_MODEL } from "@/lib/constants";
import { logError, logInfo } from "@/lib/system-logger";
import { resolvePlanForBranch, resolveProseForBranch } from "@/lib/narrative-utils";
import { REASONING_BUDGETS } from "@/types/narrative";
import type {
  BeatGame,
  GameOutcome,
  NarrativeState,
  PlayerMove,
  Scene,
  SceneGameAnalysis,
} from "@/types/narrative";

type RawGame = Record<string, unknown>;

function coerceMove(v: unknown): PlayerMove | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  // Accept only the canonical vocabulary — no legacy aliases.
  if (s === "advance") return "advance";
  if (s === "block") return "block";
  return null;
}

function coercePayoff(v: unknown): number {
  const n = typeof v === "number" ? Math.round(v) : 2;
  return Math.max(0, Math.min(4, isFinite(n) ? n : 2));
}

function coerceOutcome(v: unknown): GameOutcome {
  const c = (v ?? {}) as Record<string, unknown>;
  return {
    description: typeof c.description === "string" ? c.description : "",
    payoffA: coercePayoff(c.payoffA),
    payoffB: coercePayoff(c.payoffB),
  };
}

/**
 * Build the scene context block the analyser reads:
 * participants with names + roles, beat plan with indices, optional prose.
 */
function buildSceneContext(
  narrative: NarrativeState,
  scene: Scene,
  branchId: string | null,
): string {
  const branches = narrative.branches;
  const plan = branchId ? resolvePlanForBranch(scene, branchId, branches) : undefined;
  const prose = branchId
    ? resolveProseForBranch(scene, branchId, branches).prose
    : undefined;

  const parts: string[] = [];
  parts.push(`SCENE ${scene.id}`);
  parts.push(`SUMMARY: ${scene.summary}`);
  parts.push("");

  // ── PARTICIPANTS table — the authoritative ID registry for this scene ──
  // Every playerAId/playerBId the LLM emits MUST be drawn from this list.
  parts.push("PARTICIPANTS — use these exact IDs for playerAId / playerBId:");
  parts.push("  ID                KIND        NAME");
  const seen = new Set<string>();
  const pushRow = (id: string, kind: string, name: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    parts.push(`  ${id.padEnd(17)} ${kind.padEnd(11)} ${name}`);
  };
  for (const pid of scene.participantIds ?? []) {
    const c = narrative.characters[pid];
    const l = narrative.locations[pid];
    const a = narrative.artifacts[pid];
    if (c) pushRow(pid, "character", c.name);
    else if (l) pushRow(pid, "location", l.name);
    else if (a) pushRow(pid, "artifact", a.name);
  }
  if (scene.povId) {
    const pov = narrative.characters[scene.povId];
    if (pov) pushRow(scene.povId, "character", `${pov.name} (POV)`);
  }
  // Also surface the scene's location so location-as-force games are legal
  if (scene.locationId) {
    const loc = narrative.locations[scene.locationId];
    if (loc) pushRow(scene.locationId, "location", `${loc.name} (setting)`);
  }
  if (seen.size === 0) {
    parts.push("  (none — this scene has no listed participants; return empty games array)");
  }
  parts.push("");

  // Beats — include every proposition so the analyser sees the full
  // propositional content of each beat, not a preview.
  if (plan?.beats?.length) {
    parts.push(`BEAT PLAN (${plan.beats.length} beats):`);
    plan.beats.forEach((b, i) => {
      parts.push(`[${i}] (${b.fn}/${b.mechanism}) ${b.what}`);
      const props = b.propositions ?? [];
      if (props.length > 0) {
        parts.push(`    propositions (${props.length}):`);
        for (const p of props) {
          parts.push(`      - ${p.content}`);
        }
      }
    });
    parts.push("");
  } else {
    parts.push("BEAT PLAN: (none — analyse from summary + prose)");
    parts.push("");
  }

  if (prose && prose.trim()) {
    parts.push("PROSE:");
    parts.push(prose.trim());
  }

  return parts.join("\n");
}

/**
 * Resolve a player reference to a REAL entity ID. Tries an exact ID match
 * first, then case-insensitive name match against characters/locations/
 * artifacts. Returns null when the reference doesn't correspond to any
 * entity — callers drop the game rather than smuggling invented IDs through.
 */
function resolvePlayerId(
  rawId: unknown,
  rawName: unknown,
  narrative: NarrativeState,
): { id: string; name: string } | null {
  const tryDirect = (s: string): { id: string; name: string } | null => {
    if (!s) return null;
    if (narrative.characters[s]) return { id: s, name: narrative.characters[s].name };
    if (narrative.locations[s]) return { id: s, name: narrative.locations[s].name };
    if (narrative.artifacts[s]) return { id: s, name: narrative.artifacts[s].name };
    return null;
  };
  const tryName = (s: string): { id: string; name: string } | null => {
    if (!s) return null;
    const lower = s.toLowerCase();
    for (const c of Object.values(narrative.characters)) {
      if (c.name?.toLowerCase() === lower) return { id: c.id, name: c.name };
    }
    for (const l of Object.values(narrative.locations)) {
      if (l.name?.toLowerCase() === lower) return { id: l.id, name: l.name };
    }
    for (const a of Object.values(narrative.artifacts)) {
      if (a.name?.toLowerCase() === lower) return { id: a.id, name: a.name };
    }
    return null;
  };

  const id = typeof rawId === "string" ? rawId.trim() : "";
  const name = typeof rawName === "string" ? rawName.trim() : "";
  // Prefer ID lookup, then name lookup. Never fall back to the raw string.
  return tryDirect(id) ?? tryName(name) ?? tryName(id) ?? null;
}

function sanitiseGame(raw: RawGame, narrative: NarrativeState): BeatGame | null {
  const beatIndex = typeof raw.beatIndex === "number" ? raw.beatIndex : -1;
  if (beatIndex < 0) {
    logError(
      "game-analysis: dropped game with invalid beatIndex",
      new Error(`invalid beatIndex: ${String(raw.beatIndex)}`),
      {
        source: "analysis",
        operation: "sanitise",
        details: { beatIndex: String(raw.beatIndex ?? "(missing)"), narrativeId: narrative.id },
      },
      "warning",
    );
    return null;
  }

  const a = resolvePlayerId(raw.playerAId, raw.playerAName, narrative);
  const b = resolvePlayerId(raw.playerBId, raw.playerBName, narrative);
  if (!a || !b || a.id === b.id) {
    logError(
      "game-analysis: dropped game with invalid or duplicate players",
      new Error(
        `unresolved players: A=${String(raw.playerAId ?? raw.playerAName)} B=${String(raw.playerBId ?? raw.playerBName)}`,
      ),
      {
        source: "analysis",
        operation: "sanitise",
        details: {
          beatIndex,
          playerAId: String(raw.playerAId ?? "(missing)"),
          playerAName: String(raw.playerAName ?? "(missing)"),
          playerBId: String(raw.playerBId ?? "(missing)"),
          playerBName: String(raw.playerBName ?? "(missing)"),
          resolvedA: a ? a.id : "(unresolved)",
          resolvedB: b ? b.id : "(unresolved)",
        },
      },
      "warning",
    );
    return null;
  }

  const movedA = coerceMove(raw.playerAPlayed);
  const movedB = coerceMove(raw.playerBPlayed);
  if (!movedA || !movedB) {
    logError(
      "game-analysis: dropped game with missing/invalid moves",
      new Error(
        `missing/invalid moves: A=${String(raw.playerAPlayed)}, B=${String(raw.playerBPlayed)}`,
      ),
      {
        source: "analysis",
        operation: "sanitise",
        details: {
          beatIndex,
          playerAPlayed: String(raw.playerAPlayed ?? "(missing)"),
          playerBPlayed: String(raw.playerBPlayed ?? "(missing)"),
        },
      },
      "warning",
    );
    return null;
  }
  const asStr = (v: unknown, fallback = ""): string =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;

  return {
    beatIndex,
    beatExcerpt: asStr(raw.beatExcerpt),
    playerAId: a.id,
    playerAName: a.name,
    playerAAdvance: asStr(raw.playerAAdvance, "advances"),
    playerABlock: asStr(raw.playerABlock, "blocks"),
    playerAPlayed: movedA,
    playerBId: b.id,
    playerBName: b.name,
    playerBAdvance: asStr(raw.playerBAdvance, "advances"),
    playerBBlock: asStr(raw.playerBBlock, "blocks"),
    playerBPlayed: movedB,
    bothAdvance: coerceOutcome(raw.bothAdvance),
    advanceBlock: coerceOutcome(raw.advanceBlock),
    blockAdvance: coerceOutcome(raw.blockAdvance),
    bothBlock: coerceOutcome(raw.bothBlock),
    rationale: asStr(raw.rationale),
  };
}

/**
 * Analyse a single scene and produce a SceneGameAnalysis.
 *
 * Streams tokens + reasoning as they arrive so the UI can show the AI
 * pondering the decisions in real time.
 */
export async function generateSceneGameAnalysis(
  narrative: NarrativeState,
  scene: Scene,
  branchId: string | null,
  onToken?: (token: string, accumulated: string) => void,
  onReasoning?: (token: string, accumulated: string) => void,
): Promise<SceneGameAnalysis> {
  logInfo("Starting game-theory analysis", {
    source: "analysis",
    operation: "analyse-scene",
    details: { narrativeId: narrative.id, sceneId: scene.id },
  });

  const systemPrompt = buildGameTheorySystemPrompt();
  const userPrompt = buildSceneContext(narrative, scene, branchId);

  const reasoningBudget =
    REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? "low"] ||
    undefined;

  let fullText = "";
  let fullReasoning = "";

  const raw = await callGenerateStream(
    userPrompt,
    systemPrompt,
    (token) => {
      fullText += token;
      onToken?.(token, fullText);
    },
    undefined,
    "generateSceneGameAnalysis",
    ANALYSIS_MODEL,
    reasoningBudget,
    (token) => {
      fullReasoning += token;
      onReasoning?.(token, fullReasoning);
    },
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJson(raw, `generateSceneGameAnalysis:${scene.id}`) as Record<
      string,
      unknown
    >;
  } catch (err) {
    logError("Failed to parse game-analysis response", err, {
      source: "analysis",
      operation: "parse",
      details: { sceneId: scene.id },
    });
    throw err;
  }

  const rawGames = Array.isArray(parsed.games) ? (parsed.games as RawGame[]) : [];
  const games = rawGames
    .map((g) => sanitiseGame(g, narrative))
    .filter((g): g is BeatGame => g !== null)
    .sort((x, y) => x.beatIndex - y.beatIndex);

  const summary =
    typeof parsed.summary === "string" ? parsed.summary : undefined;

  return {
    games,
    generatedAt: Date.now(),
    summary,
  };
}
