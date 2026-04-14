/**
 * Text Analysis Pipeline — converts a large corpus (book, screenplay, etc.)
 * into a full NarrativeState by splitting into chunks, analyzing each with LLM,
 * and assembling the results.
 *
 * Adapted from scripts/analyze-chapter.ts and scripts/assemble-narrative.ts
 * for in-browser use with the app's existing callGenerate infrastructure.
 */

import {
  ANALYSIS_MODEL,
  ANALYSIS_TEMPERATURE,
  MAX_TOKENS_DEFAULT,
  SCENES_PER_ARC,
  WORDS_PER_SCENE,
} from "@/lib/constants";
import { logWarning } from "@/lib/system-logger";
import type {
  AnalysisChunkResult,
  Arc,
  Artifact,
  BeatPlan,
  Branch,
  Character,
  WorldNodeType,
  Location,
  NarrativeState,
  ProseProfile,
  RelationshipEdge,
  Scene,
  SceneVersionPointers,
  SystemNodeType,
  Thread,
  ThreadLogNodeType,
  WorldBuild,
} from "@/types/narrative";
import {
  DEFAULT_STORY_SETTINGS,
  THREAD_ACTIVE_STATUSES,
  THREAD_LOG_NODE_TYPES,
  THREAD_TERMINAL_STATUSES,
} from "@/types/narrative";

// ── Scene-level Splitting ────────────────────────────────────────────────────

/**
 * Split corpus into scene-sized prose chunks (~1200 words each).
 * Returns ordered array of { index, prose, wordCount }.
 */
export function splitCorpusIntoScenes(
  text: string,
): { index: number; prose: string; wordCount: number }[] {
  const TARGET = WORDS_PER_SCENE;
  const scenes: { index: number; prose: string; wordCount: number }[] = [];

  // Split on paragraph breaks first, then sentence breaks for long paragraphs
  let paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Break any paragraph longer than TARGET into sentence-level chunks
  const expanded: string[] = [];
  for (const para of paragraphs) {
    const wc = para.split(/\s+/).length;
    if (wc > TARGET) {
      // Split on sentence boundaries
      const sentences = para.match(/[^.!?]+[.!?]+["']?\s*/g) ?? [para];
      let sentBuf = "";
      for (const sent of sentences) {
        if (
          sentBuf &&
          sentBuf.split(/\s+/).length + sent.split(/\s+/).length > TARGET
        ) {
          expanded.push(sentBuf.trim());
          sentBuf = sent;
        } else {
          sentBuf += sent;
        }
      }
      if (sentBuf.trim()) expanded.push(sentBuf.trim());
    } else {
      expanded.push(para);
    }
  }
  paragraphs = expanded;

  // Group paragraphs into ~1200-word scenes
  let buffer: string[] = [];
  let bufferWords = 0;

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).length;
    if (bufferWords >= TARGET) {
      // Buffer already at target — flush immediately
      scenes.push({
        index: scenes.length,
        prose: buffer.join("\n\n"),
        wordCount: bufferWords,
      });
      buffer = [para];
      bufferWords = paraWords;
    } else if (bufferWords > 0 && bufferWords + paraWords > TARGET * 1.15) {
      // Adding this paragraph would overshoot — flush and start new
      scenes.push({
        index: scenes.length,
        prose: buffer.join("\n\n"),
        wordCount: bufferWords,
      });
      buffer = [para];
      bufferWords = paraWords;
    } else {
      buffer.push(para);
      bufferWords += paraWords;
    }
  }
  if (buffer.length > 0) {
    scenes.push({
      index: scenes.length,
      prose: buffer.join("\n\n"),
      wordCount: bufferWords,
    });
  }

  // Merge any tiny trailing scene into the previous one
  if (scenes.length > 1 && scenes[scenes.length - 1].wordCount < TARGET * 0.3) {
    const last = scenes.pop()!;
    const prev = scenes[scenes.length - 1];
    scenes[scenes.length - 1] = {
      ...prev,
      prose: prev.prose + "\n\n" + last.prose,
      wordCount: prev.wordCount + last.wordCount,
    };
  }

  return scenes;
}

// ── Per-Scene Structure Extraction ──────────────────────────────────────────

/**
 * Scene structure result — entities and deltas extracted from one scene's prose.
 */
export type SceneStructureResult = {
  povName: string;
  locationName: string;
  participantNames: string[];
  events: string[];
  summary: string;
  characters: AnalysisChunkResult["characters"];
  locations: AnalysisChunkResult["locations"];
  artifacts: NonNullable<AnalysisChunkResult["artifacts"]>;
  threads: AnalysisChunkResult["threads"];
  relationships: AnalysisChunkResult["relationships"];
  threadDeltas: AnalysisChunkResult["scenes"][0]["threadDeltas"];
  worldDeltas: AnalysisChunkResult["scenes"][0]["worldDeltas"];
  relationshipDeltas: AnalysisChunkResult["scenes"][0]["relationshipDeltas"];
  artifactUsages: NonNullable<
    AnalysisChunkResult["scenes"][0]["artifactUsages"]
  >;
  ownershipDeltas: NonNullable<
    AnalysisChunkResult["scenes"][0]["ownershipDeltas"]
  >;
  tieDeltas: NonNullable<AnalysisChunkResult["scenes"][0]["tieDeltas"]>;
  characterMovements: NonNullable<
    AnalysisChunkResult["scenes"][0]["characterMovements"]
  >;
  systemDeltas?: AnalysisChunkResult["scenes"][0]["systemDeltas"];
};

/**
 * Extract structure from a single scene's prose, informed by its beat plan.
 * The plan tells the LLM where beat boundaries are; the prose is the source of truth for deltas.
 */
export async function extractSceneStructure(
  prose: string,
  plan: BeatPlan | null,
  onToken?: (token: string, accumulated: string) => void,
): Promise<SceneStructureResult> {
  const beatSection = plan
    ? `\n\nBEAT PLAN (${plan.beats.length} beats — use as a guide for where events happen):\n${plan.beats.map((b, i) => `Beat ${i + 1} [${b.fn}/${b.mechanism}]: ${b.what}`).join("\n")}`
    : "";

  const prompt = `Extract narrative structure from this scene's prose.

SCENE PROSE:
${prose}${beatSection}

FORCE FORMULAS — your extractions are the direct inputs:
- FATE = Σ √arcs × stageWeight × (1 + log(1 + investment)) (thread commitment toward resolution). Ref: ~1.5/scene.
- WORLD = ΔN_c + √ΔE_c (entity transformation — what we learn about characters, locations, artifacts). Ref: ~12/scene.
- SYSTEM = ΔN + √ΔE (world deepening — rules, structures, concepts). Ref: ~3/scene.

Return JSON:
{
  "povName": "POV character name",
  "locationName": "Where this scene takes place",
  "participantNames": ["All characters present"],
  "events": ["short_event_tags"],
  "summary": "3-5 sentence narrative summary using character and location NAMES",
  "characters": [{"name": "Full Name", "role": "anchor|recurring|transient", "firstAppearance": false, "imagePrompt": "1-2 sentence LITERAL physical description: concrete traits like hair colour, build, clothing style. No metaphors or figurative language."}],
  "locations": [{"name": "Location Name", "prominence": "domain|place|margin", "parentName": "Parent or null", "description": "Brief description", "imagePrompt": "1-2 sentence LITERAL visual description: architecture, landscape, lighting, weather. Concrete physical details only, no metaphors.", "tiedCharacterNames": ["characters tied here"]}],
  "artifacts": [{"name": "Artifact Name", "significance": "key|notable|minor", "imagePrompt": "1-2 sentence LITERAL visual description — concrete physical details only, no metaphors or figurative language", "ownerName": "owner or null"}],
  "threads": [{"description": "A COMPELLING QUESTION with stakes, uncertainty, investment — 15-30 words. BAD: 'Will X succeed?' GOOD: 'Can Marcus protect his daughter from the cult that killed his wife?'", "participantNames": ["names"], "statusAtStart": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "statusAtEnd": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "development": "15-25 words: how this question was advanced or answered in this scene"}],
  "relationships": [{"from": "Name", "to": "Name", "type": "description", "valence": 0.0}],
  "threadDeltas": [{"threadDescription": "exact thread description", "from": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "to": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "addedNodes": [{"content": "15-25 words: how this question was advanced or answered in this scene", "type": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall"}]}],
  "worldDeltas": [{"entityName": "Name", "addedNodes": [{"content": "15-25 words, PRESENT tense: a stable fact about the entity — their unique perspective on reality, identity, or condition", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
  "relationshipDeltas": [{"from": "Name", "to": "Name", "type": "description", "valenceDelta": 0.1}],
  "artifactUsages": [{"artifactName": "Name", "characterName": "who or null", "usage": "what the artifact did"}],
  "ownershipDeltas": [{"artifactName": "Name", "fromName": "prev", "toName": "new"}],
  "tieDeltas": [{"locationName": "Name", "characterName": "Name", "action": "add|remove"}],
  "characterMovements": [{"characterName": "Name", "locationName": "destination", "transition": "15-25 words describing how they traveled — the journey, transport, or spatial transition"}],
  "systemDeltas": {"addedNodes": [{"concept": "15-25 words, PRESENT tense: a general rule or structural fact — how the world works, no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"fromConcept": "name", "toConcept": "name", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]}
}`;

  const fieldGuide = `
EXTRACTION STANDARDS — every delta must EARN its place. Low-value deltas flatten the force graph. Each scene records structural deltas that feed the force formulas.

DETECTING FATE — Threads are COMPELLING QUESTIONS that shape fate.
- A compelling question has STAKES (what's at risk), UNCERTAINTY (outcome not obvious), INVESTMENT (we care).
- BAD: "Will Bob succeed?" (generic, no stakes). GOOD: "Can Marcus protect his daughter from the cult?" (specific, stakes, investment)
- Fate is the intangible bigger picture. Threads are questions; fate is where the answers lead.
- Read prose for MOMENTS THAT MATTER — when does this scene advance the larger story?
- A thread delta records your detection: "this moment moves the story closer to answering the question."
- Thread logs track incremental ANSWERS to these questions over time.
- Fate is what pulls world and system toward meaning. Without it, nothing resolves.

threadDeltas — lifecycle: latent→seeded→active→escalating→critical→resolved/subverted.
- Escalating = POINT OF NO RETURN. Once detected, the story has promised resolution.
- Abandoned = cleanup. Threads below escalating that go nowhere should be abandoned, not left hanging.
- ONE step at a time. NEVER skip phases.
- Most scenes: 1-2 PULSES (same→same). Real transitions are RARE: 0-1 per scene.
- Only record a transition when the prose shows a clear, irreversible shift in tension.
- Touching 2-3 threads per scene (mostly pulses) with at most one transition is typical.
- THREAD LOG: each threadDelta MUST include 1-3 log entries (15-25 words each) recording how the question was advanced or answered.
  Log types: pulse (question maintained), transition (question urgency advanced), setup (groundwork laid for answer), escalation (stakes raised), payoff (question answered), twist (expectations subverted), callback (reference to earlier thread event), resistance (opposition to answer), stall (question stagnated).
  DENSITY STANDARDS (per thread touch):
    Pulse: 1 log node — what aspect of the thread was maintained or reinforced.
    Transition: 2-3 log nodes — what caused the shift, what changed, and what it means going forward.
    Critical/resolution scenes: 2-3 nodes — the payoff, its consequences, and any callbacks to earlier setup.
  Each log node describes a SPECIFIC observation about thread progression, not a restatement of the scene summary.

worldDeltas — what we LEARN about an entity that wasn't known before. Applies to characters, locations, and artifacts.
- Characters: new behaviour, belief, capability, or inner state revealed. Not restating what's already known.
- Locations: new history, rules, dangers, or properties revealed. A location revisited can still earn continuity if the scene reveals something new about it.
- Artifacts: new capabilities, limitations, or properties demonstrated through usage.
- Short-lived artifacts (tables, figures, equations, embedded letters/notes/documents): the worldDelta captures the CONTENTS revealed — the data shown, the claim plotted, the text quoted. This is the artifact's entire knowledge graph; it will rarely be extended by later scenes.
- QUALITY BAR: each node must describe something NOT KNOWN before this scene.
  BAD: "Alice is curious" (observation). BAD: "The White Rabbit has pink eyes" (already established).
  GOOD: "Alice abandons caution entirely, chasing the Rabbit without considering how to return" (new behaviour).
  GOOD: "The forest conceals an ancient boundary ward that repels outsiders" (new location property).
  GOOD: "The wand backfires when used against its maker" (new artifact limitation).
  GOOD: "Table 2 reports a 2.3 BLEU drop on EN-DE when positional encoding is removed" (short-lived artifact contents).
- MAX 2-3 nodes per entity per scene. Most scenes: POV character + one other entity.
- Entities that appear without revealing anything new: ZERO nodes.
- addedEdges: connect causally linked changes with "follows", "causes", "contradicts", "enables".
- Types: trait, state, history, capability, belief, relation, secret, goal, weakness.

relationshipDeltas — only when a relationship SHIFTS, not just exists.
- valenceDelta: ±0.1 subtle, ±0.2-0.3 meaningful, ±0.4-0.5 dramatic. Most scenes: 0-1.

systemDeltas — REVEALED world rules, not character observations. 15-25 words, PRESENT TENSE.
  FICTION: ✓ "Wizards cannot Apparate within Hogwarts grounds due to ancient protective enchantments."
  FICTION: ✓ "The One Ring corrupts its bearer over time, amplifying their desire for power."
  FICTION: ✗ "Magic" (too vague) — describe HOW it works
  NON-FICTION: ✓ "Self-attention computes weighted sums where each position attends to all positions in the sequence."
  NON-FICTION: ✓ "Transformers eliminate recurrence entirely, relying solely on attention mechanisms for sequence modeling."
  NON-FICTION: ✗ "Transformer architecture" (too short) — describe what it DOES
- MAX 1-2 concepts per scene. Most scenes: 0-1. Only exposition/world-building: 3+.
- Types: principle, system, concept, tension, event, structure, environment, convention, constraint.
- Edges: enables, governs, opposes, extends, created_by, constrains, exist_within.

ENTITY EXTRACTION — entities carry ONLY identity (name, role, significance). ALL world/lore MUST be emitted as scenes[].worldDeltas on the scene where it is revealed.

- characters: conscious beings with AGENCY IN THE SCENE. The test: does this person ACT, SPEAK, DECIDE, or THINK within the scene? If they are only NAMED (cited, referenced, listed, footnoted) without acting, they are NOT a character — skip entirely.
  FICTION: ✓ Harry Potter, Gandalf, Elizabeth Bennet — people with agency
  FICTION: ✓ Hedwig, Shadowfax — named animals with personality
  NON-FICTION: ✓ Einstein proposed relativity after observing X — acting in the narrative
  NON-FICTION: ✓ "the lead researcher configured the experiment" — someone performing an action
  NON-FICTION: ✗ "Vaswani et al., 2017", "Brown et al., 2020", "(Misra and Maaten, 2020)" — CITATION REFERENCES. Names appear once as a pointer to prior work, with no agency in the current text. Skip.
  NON-FICTION: ✗ Bibliography entries (full author-title-venue tuples at the end of a paper). Skip entirely — these are a REFERENCE LIST, not a cast.
  NON-FICTION: ✗ "Bordes et al., 2015", "Silver et al., 2021" — inline citations, even when repeated, if the author is only referenced (not depicted acting).
  NON-FICTION: ✗ "The scientific community", "reviewers", "prior work by X and Y" — collectives or one-line name-drops, not characters.
  EDGE CASE — the single test: take the scene, delete the character. Does the scene still read the same? If yes, they are a reference/citation, not a character. Do not extract them, and do not invent a transient character for one-line name-drops.
  anchor: 3-5 worldDeltas on first appearance. recurring: 2-4. transient: 1-2.

- locations: PHYSICAL spatial areas you can STAND IN.
  FICTION: ✓ Hogwarts, the Shire, Pemberley — places you can walk into
  FICTION: ✗ "The wizarding world", "Middle-earth politics" — abstract domains (system knowledge)
  NON-FICTION: ✓ Google's data center, Stanford lab, the conference room — physical places
  NON-FICTION: ✗ "The field of machine learning", "academia", "NeurIPS" — abstract domains (system knowledge)
  Nest via parentName. tiedCharacterNames: characters who BELONG (residents, members).
  domain: 3-5 worldDeltas. place: 2-4. margin: 1-2.

- artifacts: things with UTILITY or ECONOMIC VALUE — objects that are USED, WIELDED, POSSESSED, CONSUMED, or DEPLOYED. The defining test: does this artifact deliver a specific utility to someone in the scene? If no utility → not an artifact.
  FICTION: ✓ A wand, the One Ring, a ship, a letter — objects wielded or possessed
  FICTION: ✓ A diary entry, a newspaper clipping, a map, a prophecy scroll — in-text DOCUMENTS that deliver information the reader/characters consume (short-lived: significance=minor/notable)
  FICTION: ✗ "Magic", "swordsmanship", "prophecy-as-concept" — concepts (system knowledge)
  NON-FICTION: ✓ GPT-4, TensorFlow, WMT dataset, P100 GPU — specific software/hardware/datasets actually USED in the work
  NON-FICTION: ✓ Figure 3, Table 2, Equation 4, Algorithm 1 — in-text artefacts whose utility is delivering specific data/claims/procedures. Name them explicitly with their content ("Figure 3: Mode-1 perception-action episode", "Table 2: ablation results").
  NON-FICTION: ✗ "Transformer architecture", "attention mechanism", "BLEU score" — techniques/metrics (system knowledge)
  NON-FICTION: ✗ "JEPA", "H-JEPA", "GAN", "VAE", "VQ-VAE", "Transformers", "Boltzmann Machine", "Siamese Network", "Dyna architecture", "Memory Network system", "SimCLR", "MoCo", "BYOL", "BERT" — these are METHOD CLASSES / ARCHITECTURES / CONCEPTS, not artifacts. They belong in systemDeltas. An artifact would be a specific trained model, binary, checkpoint, or dataset someone uses.
  NON-FICTION: ✗ "Brown et al., 2020", "Silver et al., 2021", "Vaswani et al., 2017", "(Misra and Maaten, 2020)" — CITATION REFERENCES to prior work. Not artifacts. Not characters. They are pointers into the bibliography; if the cited work introduces a concept being discussed, that concept belongs in systemDeltas.
  NON-FICTION: ✗ Bibliography entries (full author-title-venue tuples at the end of a paper). Skip entirely — they carry no scene-level narrative utility.
  NON-FICTION: ✗ The work being analysed itself (e.g., "A Path Towards Autonomous Machine Intelligence"). The paper is the text, not an artifact within it.
  NON-FICTION: ✗ Groups or collections of people ("the authors", "reviewers", "prior work by X and Y"). Not artifacts.
  ownerName: character/location/null. For figures/tables/equations the owner is the author (or null). Documents have an owner (sender, writer).
  significance: key (load-bearing throughout) / notable (referenced across multiple scenes) / minor (short-lived — appears once, including most tables/figures/embedded documents).
  key: 2-4 worldDeltas. notable: 1-3. minor: 1.
  SHORT-LIVED ARTIFACTS (tables, figures, equations, algorithm listings, embedded letters/diaries/notes/maps): the artifact's utility IS its content. worldDeltas MUST capture the CONTENTS — what the table shows, what the figure depicts, what the equation computes, what the letter says. One dense node is usually enough. Do NOT promote the contents to systemDeltas unless the text itself generalises them into a rule.
    GOOD (Table 2): "Ablation removes positional encoding and BLEU drops 2.3 points on EN-DE, showing positional signal is load-bearing."
    GOOD (Figure 4): "Plots attention weights across layers: lower layers attend locally, upper layers attend globally across 200-token windows."
    GOOD (Equation 1): "Defines total cost C(s) as the sum of intrinsic cost IC(s) and trainable cost TC(s)."
    GOOD (letter): "Contains Dumbledore's instructions to leave Harry with the Dursleys and a warning that Voldemort may return."
    BAD: "Table 2 shows results" (no contents). BAD: "A letter from Dumbledore" (no contents).
  DEDUPLICATION: If the same figure/table/equation is referenced in multiple scenes, it is ONE artifact. Do not emit "Figure 10" and "Figure 10: A few standard architectures and their capacity for collapse" as separate artifacts — pick the fullest labelled form.

- threads: narrative tensions. development: what specifically happened.

DISTINCTNESS — every entity must be genuinely distinct from all others:
- Two threads are distinct if resolving one does NOT automatically resolve the other
- Two characters are distinct if they are different people (not name variants)
- Two locations are distinct if they are different physical spaces (not name variants)
- Two artifacts are distinct if they are different objects (not name variants)
- Two system concepts are distinct if they describe different rules/facts (not rephrasing)
If entities overlap, pick ONE canonical form. Do not extract duplicates.

events — 2-4 word tags. 2-4 per scene. Each names a discrete beat.
artifactUsages — when an artifact delivers utility. Every artifact referenced for what it DOES (not just mentioned by name) is a usage. Every usage MUST have a character who used it.
  usage: describe WHAT the artifact did — the specific utility delivered (searched for X, generated Y, computed Z).
ownershipDeltas — only when artifacts change hands.
tieDeltas — significant bond changes. NOT temporary visits.
characterMovements — only physical relocation. Vivid transitions.

VARIANCE IS SIGNAL:
- Quiet scene: 0 transitions, 1 continuity node, 0 system, 2 events = CORRECT.
- Climactic scene: 2 transitions, 5 nodes, 3 concepts, 5 events = CORRECT.
- If every scene has similar counts, you are extracting noise. The graph needs peaks and valleys.`;

  const fullPrompt = prompt + "\n" + fieldGuide;
  const system = `You are a narrative structure extractor. Given a scene's exact prose and its beat plan, extract all entities, deltas, and structural data accurately. Dense prose deserves rich extraction; sparse prose deserves minimal extraction. Return only valid JSON.`;
  const raw = await callAnalysis(fullPrompt, system, onToken);
  const json = extractJSON(raw);
  const parsed = JSON.parse(json) as SceneStructureResult;

  return {
    povName: parsed.povName ?? "",
    locationName: parsed.locationName ?? "",
    participantNames: parsed.participantNames ?? [],
    events: parsed.events ?? [],
    summary: parsed.summary ?? "",
    characters: parsed.characters ?? [],
    locations: parsed.locations ?? [],
    artifacts: parsed.artifacts ?? [],
    threads: parsed.threads ?? [],
    relationships: parsed.relationships ?? [],
    threadDeltas: parsed.threadDeltas ?? [],
    worldDeltas: parsed.worldDeltas ?? [],
    relationshipDeltas: parsed.relationshipDeltas ?? [],
    artifactUsages: parsed.artifactUsages ?? [],
    ownershipDeltas: parsed.ownershipDeltas ?? [],
    tieDeltas: parsed.tieDeltas ?? [],
    characterMovements: parsed.characterMovements ?? [],
    systemDeltas: parsed.systemDeltas,
  };
}

// ── Arc Grouping ────────────────────────────────────────────────────────────

/**
 * Group scenes into arcs of ~4 scenes each and name them via LLM.
 */
export async function groupScenesIntoArcs(
  sceneSummaries: { index: number; summary: string }[],
  onToken?: (token: string, accumulated: string) => void,
): Promise<{ name: string; sceneIndices: number[] }[]> {
  // Pre-group into chunks of SCENES_PER_ARC
  const groups: { sceneIndices: number[]; summaries: string[] }[] = [];
  for (let i = 0; i < sceneSummaries.length; i += SCENES_PER_ARC) {
    const slice = sceneSummaries.slice(i, i + SCENES_PER_ARC);
    groups.push({
      sceneIndices: slice.map((s) => s.index),
      summaries: slice.map((s) => s.summary),
    });
  }

  const prompt = `Name each arc based on its scene summaries. An arc is a narrative unit of ~4 scenes.

${groups.map((g, i) => `ARC ${i + 1} (scenes ${g.sceneIndices[0] + 1}-${g.sceneIndices[g.sceneIndices.length - 1] + 1}):\n${g.summaries.map((s, j) => `  Scene ${g.sceneIndices[j] + 1}: ${s}`).join("\n")}`).join("\n\n")}

Return JSON array of arc names (one per arc, in order):
["Arc 1 Name", "Arc 2 Name", ...]

Rules:
- Each name should capture the arc's thematic thrust in 2-5 words
- Names should be evocative and specific, not generic ("The Betrayal at Dawn" not "Events")`;

  const system =
    "You are a narrative analyst. Name story arcs based on scene summaries. Return only a JSON array of strings.";
  const raw = await callAnalysis(prompt, system, onToken);
  const json = extractJSON(raw);
  const names = JSON.parse(json) as string[];

  return groups.map((g, i) => ({
    name: names[i] ?? `Arc ${i + 1}`,
    sceneIndices: g.sceneIndices,
  }));
}

// ── LLM Call ─────────────────────────────────────────────────────────────────

async function callAnalysis(
  prompt: string,
  systemPrompt: string,
  onToken?: (token: string, accumulated: string) => void,
): Promise<string> {
  const { logApiCall, updateApiLog } = await import("@/lib/api-logger");
  const { apiHeaders } = await import("@/lib/api-headers");
  const logId = logApiCall(
    "analyzeChunk",
    prompt.length + systemPrompt.length,
    prompt,
    ANALYSIS_MODEL,
  );
  const start = performance.now();

  try {
    const useStream = !!onToken;
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        prompt,
        systemPrompt,
        maxTokens: MAX_TOKENS_DEFAULT,
        stream: useStream,
        model: ANALYSIS_MODEL,
        temperature: ANALYSIS_TEMPERATURE,
        reasoningBudget: 0,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      const message = err.error || "Analysis failed";
      updateApiLog(logId, {
        status: "error",
        error: message,
        durationMs: Math.round(performance.now() - start),
      });
      throw new Error(message);
    }

    let content: string;

    if (useStream && res.body) {
      // Stream SSE tokens
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.token) {
                accumulated += parsed.token;
                onToken(parsed.token, accumulated);
              }
            } catch {
              // skip malformed
            }
          }
        }
      }
      content = accumulated;
    } else {
      const data = await res.json();
      content = data.content;
    }

    updateApiLog(logId, {
      status: "success",
      durationMs: Math.round(performance.now() - start),
      responseLength: content.length,
      responsePreview: content,
    });
    return content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, {
      status: "error",
      error: message,
      durationMs: Math.round(performance.now() - start),
    });
    throw err;
  }
}

// ── JSON Extraction ──────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  text = text.replace(/,\s*([}\]])/g, "$1");

  // Fix missing opening quote on string values: "key": value" → "key": "value"
  text = text.replace(/:\s*([a-zA-Z_][a-zA-Z0-9_]*)"(,|\s*[}\]])/g, ': "$1"$2');
  // Fix missing closing quote: "key": "value → "key": "value"
  text = text.replace(/:\s*"([^"]*?)(\n)/g, ': "$1"$2');
  // Escape raw newlines/tabs inside string values (not already escaped)
  text = text.replace(/"([^"]*?)"/g, (_match, inner: string) => {
    const escaped = inner
      .replace(/(?<!\\)\n/g, "\\n")
      .replace(/(?<!\\)\r/g, "\\r")
      .replace(/(?<!\\)\t/g, "\\t");
    return `"${escaped}"`;
  });

  let opens = 0,
    closes = 0,
    sqOpens = 0,
    sqCloses = 0;
  for (const ch of text) {
    if (ch === "{") opens++;
    else if (ch === "}") closes++;
    else if (ch === "[") sqOpens++;
    else if (ch === "]") sqCloses++;
  }
  while (sqCloses < sqOpens) {
    text += "]";
    sqCloses++;
  }
  while (closes < opens) {
    text += "}";
    closes++;
  }

  return text;
}

// ── Reconciliation (Phase 3) ─────────────────────────────────────────────────
// Phase 2 (beat plan extraction) is handled by analysis-runner.ts directly

type CharacterNameMap = Record<string, string>; // variant → canonical

type EntityMerges = {
  characterMerges: CharacterNameMap;
  locationMerges: Record<string, string>;
  artifactMerges: Record<string, string>;
};

type SemanticMerges = {
  threadMerges: Record<string, string>;
  systemMerges: Record<string, string>;
};

function parseMergeJSON<T extends object>(raw: string): T {
  const json = extractJSON(raw);
  try {
    return JSON.parse(json) as T;
  } catch {
    const repaired = json
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\x00-\x1F\x7F]/g, (ch) =>
        ch === "\n" || ch === "\t" ? ch : "",
      );
    return JSON.parse(repaired) as T;
  }
}

/**
 * Phase 3a — Entity reconciliation (characters, locations, artifacts).
 * Entities are proper-named and referentially unique: the same person, place,
 * or object appears under multiple surface forms. Resolve aggressively to the
 * fullest canonical name.
 */
async function reconcileEntities(
  allCharNames: Set<string>,
  allLocNames: Set<string>,
  allArtifactNames: Set<string>,
  onToken?: (token: string, accumulated: string) => void,
): Promise<EntityMerges> {
  if (
    allCharNames.size === 0 &&
    allLocNames.size === 0 &&
    allArtifactNames.size === 0
  ) {
    return { characterMerges: {}, locationMerges: {}, artifactMerges: {} };
  }

  const prompt = `Reconcile named entities extracted independently from different scenes of the same story. The same person, place, or object often appears under different surface forms (title, first name, nickname, full name). Your job: collapse every variant of the same entity onto its fullest canonical form.

CHARACTERS (${allCharNames.size}):
${[...allCharNames].map((n, i) => `${i + 1}. "${n}"`).join("\n")}

LOCATIONS (${allLocNames.size}):
${[...allLocNames].map((n, i) => `${i + 1}. "${n}"`).join("\n")}

ARTIFACTS (${allArtifactNames.size}):
${[...allArtifactNames].map((n, i) => `${i + 1}. "${n}"`).join("\n")}

For each category, map every variant to its canonical form. Only include entries where variant ≠ canonical.

Return JSON:
{
  "characterMerges": { "variant": "canonical" },
  "locationMerges": { "variant": "canonical" },
  "artifactMerges": { "variant": "canonical" }
}

═══ PRINCIPLE ═══
Entities are unique referents — a character, place, or object exists once in the story world. If two surface forms clearly denote the same referent, they MUST be merged. Prefer the fullest, most identifying canonical form.

═══ CHARACTER MERGING ═══
MERGE aggressively when it is the same person:
  ✓ "Harry" / "Harry Potter" → "Harry Potter" (pick fullest)
  ✓ "Professor McGonagall" / "Minerva McGonagall" / "McGonagall" → "Professor Minerva McGonagall"
  ✓ "Mr. Dursley" / "Vernon Dursley" / "Uncle Vernon" → "Vernon Dursley"
  ✓ "Hagrid" / "Rubeus Hagrid" → "Rubeus Hagrid"
  ✓ "Dumbledore" / "Albus Dumbledore" / "Professor Dumbledore" → "Albus Dumbledore"

Canonical choice: pick the form that is most uniquely identifying. Full name > title + last name > first name alone. If a title is part of how the character is known (Professor, Lord), prefer including it.

DO NOT MERGE: Different people who share a surname or title.
  ✗ "Mr. Dursley" + "Dudley Dursley" — different people, same family
  ✗ "Professor Snape" + "Professor McGonagall" — different professors
  ✗ "Fred Weasley" + "George Weasley" — twins, different people

═══ LOCATION MERGING ═══
MERGE aggressively when it is the same place:
  ✓ "The Great Hall" / "Great Hall" / "Hogwarts Great Hall" → "Great Hall"
  ✓ "Platform Nine and Three-Quarters" / "Platform 9¾" → "Platform 9¾"
  ✓ "Diagon Alley" / "the Alley" (if context makes it unambiguous)

DO NOT MERGE: Distinct places even if adjacent or nested.
  ✗ "The Great Hall" + "The Entrance Hall" — different rooms in Hogwarts
  ✗ "Diagon Alley" + "Knockturn Alley" — different streets
  ✗ "Hogwarts" + "Hogsmeade" — different locations

═══ ARTIFACT MERGING ═══
MERGE aggressively when it is the same object:
  ✓ "the Elder Wand" / "Elder Wand" / "Dumbledore's wand" → "the Elder Wand"
  ✓ "Marauder's Map" / "The Marauder's Map" → "the Marauder's Map"
  ✓ "the Sorcerer's Stone" / "the Philosopher's Stone" (if clearly the same object)

DO NOT MERGE: Different instances of the same type.
  ✗ "Harry's wand" + "Voldemort's wand" — different wands
  ✗ "The Invisibility Cloak" + "The Elder Wand" — different Hallows

Empty object {} if no merges needed for a category.`;

  const system = `You resolve surface-form variants of named entities (characters, locations, artifacts) to their canonical full forms. Entities are unique referents: when two variants clearly denote the same person/place/object, you MUST merge them. Prefer the fullest identifying name. Return only valid JSON.`;

  const raw = await callAnalysis(prompt, system, onToken);
  const parsed = parseMergeJSON<Partial<EntityMerges>>(raw);
  return {
    characterMerges: parsed.characterMerges ?? {},
    locationMerges: parsed.locationMerges ?? {},
    artifactMerges: parsed.artifactMerges ?? {},
  };
}

/**
 * Phase 3b — Semantic reconciliation (threads, system knowledge).
 * Threads and knowledge nodes are full propositions, not proper names. Two
 * items that look similar often capture distinct nuances. Default stance is
 * to PRESERVE. Only collapse when meaning, scope, and stakes are effectively
 * identical and one phrasing is just a restatement of the other.
 */
async function reconcileSemantic(
  allThreadDescs: Set<string>,
  allWKConcepts: Set<string>,
  onToken?: (token: string, accumulated: string) => void,
): Promise<SemanticMerges> {
  if (allThreadDescs.size === 0 && allWKConcepts.size === 0) {
    return { threadMerges: {}, systemMerges: {} };
  }

  const prompt = `Reconcile narrative THREADS and SYSTEM KNOWLEDGE concepts extracted independently from different scenes of the same story. Unlike named entities, these are propositions — full sentences that encode nuance. Your job: preserve distinct nuances. Only merge when two items are genuine restatements of the same proposition.

THREADS (${allThreadDescs.size}):
${[...allThreadDescs].map((d, i) => `${i + 1}. "${d}"`).join("\n")}

SYSTEM KNOWLEDGE (${allWKConcepts.size}):
${[...allWKConcepts].map((c, i) => `${i + 1}. "${c}"`).join("\n")}

For each category, map every variant to its canonical form. Only include entries where variant ≠ canonical.

Return JSON:
{
  "threadMerges": { "variant": "canonical" },
  "systemMerges": { "variant": "canonical" }
}

═══ GUIDING PRINCIPLE ═══
DEFAULT IS TO KEEP SEPARATE. Threads and knowledge concepts are deliberately fine-grained. A typical story has dozens of distinct threads and system concepts — squashing them loses narrative texture. Only merge when you would be embarrassed to present both items in a final analysis because they say the exact same thing.

Test for merging: if I resolved the canonical form, would every variant also be resolved as a natural consequence? If there's any distinguishing element (different participants, different stakes, different scope, different mechanism), the answer is NO — keep separate.

═══ THREAD MERGING ═══
MERGE only when two descriptions are the same narrative tension restated:
  ✓ "Who is trying to steal the Stone?" + "The mystery of who wants the Sorcerer's Stone" — identical question, different wording
  ✓ "Snape's antagonism toward Harry" + "Snape's hostility toward Harry" — same relational tension
  ✓ "Will Harry survive Voldemort?" + "Harry's survival against Voldemort" — same question

KEEP SEPARATE — any of these distinctions is enough:
  ✗ Different participants: "Harry's conflict with Snape" vs "Harry's conflict with Malfoy"
  ✗ Different scope: "Harry's fear of Voldemort" vs "The wizarding world's fear of Voldemort"
  ✗ Different stakes: "Harry learns he is a wizard" vs "Harry adjusts to Hogwarts life"
  ✗ Different antagonists: "Harry vs Voldemort" vs "Harry vs the Dursleys"
  ✗ Different phases of related arcs: "Discovering the Stone is hidden" vs "Reaching the Stone"
  ✗ Seemingly-related mysteries that are actually distinct: "Who opened the Chamber?" vs "Who is the Heir of Slytherin?"
  ✗ A thread from two characters' perspectives where each has their own arc: "Snape's loyalty to Dumbledore" vs "Dumbledore's trust in Snape" — linked but they are distinct internal arcs

═══ SYSTEM KNOWLEDGE MERGING ═══
MERGE only when two concepts state the same rule or fact in different words:
  ✓ "Magic requires a wand to channel" + "Wands are required to cast spells" — same rule
  ✓ "The house point system rewards behavior" + "Houses earn and lose points based on student conduct" — same mechanism

KEEP SEPARATE — any of these is a distinction:
  ✗ Different mechanisms in the same domain: "Unforgivable Curses are illegal" vs "Dark magic is dangerous" — one is a legal rule, the other is a physical principle
  ✗ Related but distinct facts: "Hogwarts has four houses" vs "The Sorting Hat assigns students" — both about the house system, but different claims
  ✗ Parent and child concepts: "Magic exists" vs "Spells require incantations" — the second is more specific
  ✗ Different types in the same family: "World models enable planning" vs "World models enable reasoning" — these share a subject but make distinct claims
  ✗ Claims about the same subject with different predicates: "AI systems require large datasets" vs "AI systems are unreliable without supervision" — same topic, different propositions

═══ WHEN IN DOUBT — DO NOT MERGE ═══
Losing a distinction is worse than keeping a duplicate. The downstream pipeline can still work with slight redundancy, but it cannot recover lost nuance. If you are even slightly unsure, leave both items intact.

Empty object {} if no merges needed for a category.`;

  const system = `You reconcile narrative threads and system knowledge concepts. These are propositions, not proper names — apparent duplicates frequently encode real nuance. Your default stance is to PRESERVE. Only merge two items when one is clearly a restatement of the other with the same participants, scope, stakes, and claim. When in doubt, keep separate. Return only valid JSON.`;

  const raw = await callAnalysis(prompt, system, onToken);
  const parsed = parseMergeJSON<Partial<SemanticMerges>>(raw);
  return {
    threadMerges: parsed.threadMerges ?? {},
    systemMerges: parsed.systemMerges ?? {},
  };
}

/**
 * Reconcile independently-extracted chunk results:
 * - Phase 3a (entities): aggressive merging of character/location/artifact name variants
 * - Phase 3b (semantic): nuanced merging of threads and system knowledge, default-preserve
 * - Stitch thread continuity across chunks (connect same threads, fix status chains)
 */
export async function reconcileResults(
  results: AnalysisChunkResult[],
  onToken?: (token: string, accumulated: string) => void,
): Promise<AnalysisChunkResult[]> {
  // Collect all unique names and thread descriptions across chunks
  const allCharNames = new Set<string>();
  const allThreadDescs = new Set<string>();
  const allLocNames = new Set<string>();
  const allArtifactNames = new Set<string>();
  const allWKConcepts = new Set<string>();

  for (const r of results) {
    for (const c of r.characters ?? []) allCharNames.add(c.name);
    for (const t of r.threads ?? []) allThreadDescs.add(t.description);
    for (const l of r.locations ?? []) allLocNames.add(l.name);
    for (const a of r.artifacts ?? []) allArtifactNames.add(a.name);
    for (const s of r.scenes ?? []) {
      for (const n of s.systemDeltas?.addedNodes ?? [])
        allWKConcepts.add(n.concept);
    }
  }

  // Two sequential streaming calls — entities first, then threads + knowledge.
  // Sequential keeps the stream viewer readable (one phase at a time) and lets
  // the entities phase finish before the semantic phase begins.
  let phaseLog = "";
  const phaseStream = (tag: string) =>
    onToken
      ? (token: string, accumulated: string) =>
          onToken(token, `${phaseLog}[${tag}]\n${accumulated}`)
      : undefined;

  const entityMerges = await reconcileEntities(
    allCharNames,
    allLocNames,
    allArtifactNames,
    phaseStream("entities"),
  );
  phaseLog = `[entities] done\n\n`;

  const semanticMerges = await reconcileSemantic(
    allThreadDescs,
    allWKConcepts,
    phaseStream("threads+knowledge"),
  );

  const charMap = entityMerges.characterMerges;
  const locMap = entityMerges.locationMerges;
  const artMap = entityMerges.artifactMerges;
  const threadMap = semanticMerges.threadMerges;
  const wkMap = semanticMerges.systemMerges;

  const resolveChar = (name: string) => charMap[name] ?? name;
  const resolveThread = (desc: string) => threadMap[desc] ?? desc;
  const resolveLoc = (name: string) => locMap[name] ?? name;
  const resolveArt = (name: string) => artMap[name] ?? name;
  const resolveWK = (concept: string) => wkMap[concept] ?? concept;

  // Unified entity resolver — tries all maps so the same entity always resolves
  // to the same canonical name regardless of which field references it.
  const resolveEntity = (name: string): string =>
    charMap[name] ?? locMap[name] ?? artMap[name] ?? name;

  // Apply merges to all results
  const reconciled: AnalysisChunkResult[] = results.map((r) => ({
    ...r,
    characters: deduplicateBy(
      (r.characters ?? []).map((c) => ({ ...c, name: resolveChar(c.name) })),
      (c) => c.name,
      (a, b) => ({
        ...a,
        role: higherRole(a.role, b.role),
        imagePrompt: a.imagePrompt || b.imagePrompt,
      }),
    ),
    locations: deduplicateBy(
      (r.locations ?? []).map((l) => ({
        ...l,
        name: resolveLoc(l.name),
        parentName: l.parentName ? resolveEntity(l.parentName) : null,
        tiedCharacterNames: (l.tiedCharacterNames ?? []).map(resolveEntity),
      })),
      (l) => l.name,
      (a, b) => ({
        ...a,
        tiedCharacterNames: [
          ...new Set([
            ...(a.tiedCharacterNames ?? []),
            ...(b.tiedCharacterNames ?? []),
          ]),
        ],
        prominence:
          a.prominence && b.prominence
            ? (({ margin: 0, place: 1, domain: 2 } as Record<string, number>)[
                b.prominence
              ] ?? 0) >
              (({ margin: 0, place: 1, domain: 2 } as Record<string, number>)[
                a.prominence
              ] ?? 0)
              ? b.prominence
              : a.prominence
            : a.prominence || b.prominence,
        imagePrompt: a.imagePrompt || b.imagePrompt,
      }),
    ),
    artifacts: deduplicateBy(
      (r.artifacts ?? []).map((a) => ({
        ...a,
        name: resolveArt(a.name),
        ownerName: a.ownerName ? resolveEntity(a.ownerName) : null,
      })),
      (a) => a.name,
      (a, b) => ({
        ...a,
        significance: higherSignificance(a.significance, b.significance),
        imagePrompt: a.imagePrompt || b.imagePrompt,
      }),
    ),
    threads: deduplicateBy(
      (r.threads ?? []).map((t) => ({
        ...t,
        description: resolveThread(t.description),
        participantNames: t.participantNames.map(resolveEntity),
        statusAtStart: normalizeStatus(t.statusAtStart),
        statusAtEnd: normalizeStatus(t.statusAtEnd),
      })),
      (t) => t.description,
      (a, b) => ({
        ...a,
        statusAtEnd: b.statusAtEnd,
        development: `${a.development}; ${b.development}`,
      }),
    ),
    scenes: (r.scenes ?? []).map((s) => ({
      ...s,
      povName: resolveEntity(s.povName),
      locationName: resolveEntity(s.locationName),
      participantNames: [...new Set(s.participantNames.map(resolveEntity))],
      threadDeltas: deduplicateBy(
        (s.threadDeltas ?? []).map((tm) => ({
          ...tm,
          threadDescription: resolveThread(tm.threadDescription),
          from: normalizeStatus(tm.from),
          to: normalizeStatus(tm.to),
        })),
        (tm) => tm.threadDescription,
        // When two deltas target the same thread in one scene, keep widest transition and merge logs
        (a, b) => ({
          ...a,
          from: a.from,
          to: b.to,
          addedNodes: [...(a.addedNodes ?? []), ...(b.addedNodes ?? [])],
        }),
      ),
      worldDeltas: deduplicateBy(
        (s.worldDeltas ?? []).map((km) => ({
          ...km,
          entityName: resolveEntity(km.entityName),
        })),
        (km) => km.entityName,
        (a, b) => ({
          ...a,
          addedNodes: mergeContinuity(a.addedNodes, b.addedNodes),
        }),
      ),
      relationshipDeltas: (s.relationshipDeltas ?? []).map((rm) => ({
        ...rm,
        from: resolveEntity(rm.from),
        to: resolveEntity(rm.to),
      })),
      artifactUsages: (s.artifactUsages ?? []).map((au) => ({
        ...au,
        artifactName: resolveArt(au.artifactName),
        characterName: au.characterName
          ? resolveEntity(au.characterName)
          : null,
      })),
      ownershipDeltas: (s.ownershipDeltas ?? []).map((om) => ({
        ...om,
        artifactName: resolveArt(om.artifactName),
        fromName: resolveEntity(om.fromName),
        toName: resolveEntity(om.toName),
      })),
      tieDeltas: (s.tieDeltas ?? []).map((tm) => ({
        ...tm,
        locationName: resolveEntity(tm.locationName),
        characterName: resolveEntity(tm.characterName),
      })),
      characterMovements: (s.characterMovements ?? []).map((cm) => ({
        ...cm,
        characterName: resolveEntity(cm.characterName),
        locationName: resolveEntity(cm.locationName),
      })),
      systemDeltas: s.systemDeltas
        ? {
            addedNodes: (s.systemDeltas.addedNodes ?? []).map((n) => ({
              ...n,
              concept: resolveWK(n.concept),
            })),
            addedEdges: (s.systemDeltas.addedEdges ?? []).map((e) => ({
              ...e,
              fromConcept: resolveWK(e.fromConcept),
              toConcept: resolveWK(e.toConcept),
            })),
          }
        : undefined,
    })),
    relationships: deduplicateBy(
      (r.relationships ?? []).map((rel) => ({
        ...rel,
        from: resolveEntity(rel.from),
        to: resolveEntity(rel.to),
      })),
      (rel) => `${rel.from}→${rel.to}`,
      (a, b) => ({ ...a, valence: b.valence }), // keep later valence
    ),
  }));

  // Stitch thread continuity across chunks:
  // 1. Thread-level: statusAtStart of chunk N+1 matches statusAtEnd of chunk N
  // 2. Scene-level: threadDelta.from values are consistent with the running status
  const threadStatusTracker: Record<string, string> = {};
  for (const r of reconciled) {
    // Fix thread-level statuses
    for (const t of r.threads) {
      if (threadStatusTracker[t.description]) {
        t.statusAtStart = threadStatusTracker[t.description];
      }
      threadStatusTracker[t.description] = t.statusAtEnd;
    }

    // Build a per-scene running status from the chunk's thread tracker
    const sceneThreadStatus: Record<string, string> = {};
    // Seed with thread-level statusAtStart for this chunk
    for (const t of r.threads) {
      sceneThreadStatus[t.description] = t.statusAtStart;
    }
    // Also seed from cross-chunk tracker for threads not in this chunk's thread list
    for (const [desc, status] of Object.entries(threadStatusTracker)) {
      if (!sceneThreadStatus[desc]) sceneThreadStatus[desc] = status;
    }

    // Fix scene-level threadDelta from/to values to chain correctly
    for (const scene of r.scenes) {
      for (const tm of scene.threadDeltas) {
        const currentStatus = sceneThreadStatus[tm.threadDescription];
        if (currentStatus && tm.from !== currentStatus) {
          tm.from = currentStatus;
        }
        // Update running status for next scene/delta
        sceneThreadStatus[tm.threadDescription] = tm.to;
      }
    }
  }

  return reconciled;
}

/**
 * Phase 4a: Analyze thread dependencies on canonical (post-merge) thread list.
 * Runs after reconciliation to identify causal relationships between distinct threads.
 */
export async function analyzeThreading(
  canonicalThreads: string[],
  onToken?: (token: string, accumulated: string) => void,
): Promise<Record<string, string[]>> {
  if (canonicalThreads.length < 2) return {};

  const prompt = `You are analyzing narrative threads to identify causal dependencies.

CANONICAL THREADS (post-merge, deduplicated):
${canonicalThreads.map((d, i) => `${i + 1}. "${d}"`).join("\n")}

Identify which threads CAUSALLY DEPEND on other threads. A depends on B means:
- A's resolution is affected by B's trajectory
- B must progress or resolve for A to advance
- They converge at critical story moments

Return JSON:
{
  "threadDependencies": {
    "exact thread description": ["exact dependent thread 1", "exact dependent thread 2"]
  }
}

RULES:
- Use EXACT thread descriptions from the list above — copy-paste precisely
- A thread can depend on multiple others; dependencies can be mutual
- NOT dependencies: threads that are merely thematic, or share characters without causal interaction
- Focus on structural narrative connections, not surface-level similarities
- If no dependencies exist, return { "threadDependencies": {} }`;

  const system = `You are a narrative structure analyst. Identify causal dependencies between story threads. Return only valid JSON.`;

  const raw = await callAnalysis(prompt, system, onToken);
  const json = extractJSON(raw);

  try {
    const parsed = JSON.parse(json);
    return parsed.threadDependencies ?? {};
  } catch {
    const repaired = json
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\x00-\x1F\x7F]/g, (ch) =>
        ch === "\n" || ch === "\t" ? ch : "",
      );
    const parsed = JSON.parse(repaired);
    return parsed.threadDependencies ?? {};
  }
}

/** Normalize free-form LLM status strings to the canonical vocabulary */
function normalizeStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  // Direct matches
  const allStatuses = [
    ...THREAD_ACTIVE_STATUSES,
    ...THREAD_TERMINAL_STATUSES,
  ] as readonly string[];
  if (allStatuses.includes(s)) return s;
  // Common LLM variants → canonical
  const aliases: Record<string, string> = {
    inactive: "latent",
    introduced: "latent",
    emerging: "latent",
    developing: "seeded",
    planted: "seeded",
    setup: "seeded",
    hinted: "seeded",
    ongoing: "active",
    progressing: "active",
    "in progress": "active",
    rising: "active",
    intensifying: "active",
    heightening: "active",
    building: "active",
    peak: "critical",
    climactic: "critical",
    urgent: "critical",
    crisis: "critical",
    concluded: "resolved",
    completed: "resolved",
    settled: "resolved",
    closed: "resolved",
    twisted: "subverted",
    inverted: "subverted",
    upended: "subverted",
    reversed: "subverted",
    defied: "subverted",
    dropped: "abandoned",
    forgotten: "abandoned",
    faded: "abandoned",
    reset: "abandoned",
  };
  if (aliases[s]) return aliases[s];
  // Fuzzy: check if any canonical status is a substring
  for (const canonical of allStatuses) {
    if (s.includes(canonical)) return canonical;
  }
  return s; // keep original if no match — assembleNarrative will still accept it
}

/** Check if a content string is subsumed by any entry in a set (exact or substring) */
function isContentSubsumed(norm: string, existing: Set<string>): boolean {
  if (existing.has(norm)) return true;
  for (const e of existing) {
    if (e.includes(norm) || norm.includes(e)) return true;
  }
  return false;
}

/** Merge two continuity arrays, dropping entries whose content is identical or near-identical (substring match) */
function mergeContinuity(
  a: { type: string; content: string }[],
  b: { type: string; content: string }[],
): { type: string; content: string }[] {
  const result = [...a];
  const existing = new Set(a.map((n) => n.content.toLowerCase().trim()));
  for (const node of b) {
    const norm = node.content.toLowerCase().trim();
    if (isContentSubsumed(norm, existing)) continue;
    result.push(node);
    existing.add(norm);
  }
  return result;
}

function higherSignificance(a: string, b: string): string {
  const rank: Record<string, number> = { minor: 0, notable: 1, key: 2 };
  return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a;
}

function higherRole(a: string, b: string): string {
  const rank: Record<string, number> = {
    transient: 0,
    recurring: 1,
    anchor: 2,
  };
  return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a;
}

function deduplicateBy<T>(
  items: T[],
  key: (item: T) => string,
  merge: (existing: T, incoming: T) => T,
): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (map.has(k)) {
      map.set(k, merge(map.get(k)!, item));
    } else {
      map.set(k, item);
    }
  }
  return [...map.values()];
}

// ── Meta-context sampling ────────────────────────────────────────────────────
// Builds a representative snapshot of the corpus for rules/systems/profile
// extraction. Samples evenly across chunks within a ~4000 char budget so it
// scales from 5 chunks to 500 without blowing up prompt size.

function buildMetaContext(
  results: AnalysisChunkResult[],
  characters: Record<string, Character>,
  threads: Record<string, Thread>,
  locations: Record<string, Location>,
  scenes: Record<string, Scene>,
  worldSummary: string,
): string {
  const lines: string[] = [];

  // ── World summary (cap at 2000 chars) ──
  lines.push(`WORLD SUMMARY: ${worldSummary.slice(0, 2000)}`);

  // ── Characters ──
  lines.push(
    `\nCHARACTERS: ${Object.values(characters)
      .map((c) => `${c.name} (${c.role})`)
      .join(", ")}`,
  );

  // ── Threads ──
  lines.push(
    `\nTHREADS: ${Object.values(threads)
      .map((t) => `"${t.description}" [${t.status}]`)
      .join(", ")}`,
  );

  // ── Locations ──
  lines.push(
    `\nLOCATIONS: ${Object.values(locations)
      .map((l) => l.name)
      .join(", ")}`,
  );

  // ── Scene summaries — evenly sampled across the full corpus ──
  const allScenes = Object.values(scenes);
  const SUMMARY_BUDGET = 8; // target sample count
  const summaryStep = Math.max(
    1,
    Math.floor(allScenes.length / SUMMARY_BUDGET),
  );
  const sampledSummaries: string[] = [];
  for (
    let i = 0;
    i < allScenes.length && sampledSummaries.length < SUMMARY_BUDGET;
    i += summaryStep
  ) {
    const s = allScenes[i];
    const pov =
      Object.values(characters).find((c) => c.id === s.povId)?.name ?? s.povId;
    sampledSummaries.push(`- [${pov}] ${s.summary.slice(0, 150)}`);
  }
  if (sampledSummaries.length > 0) {
    lines.push(
      `\nSCENE SUMMARIES (${sampledSummaries.length} evenly sampled from ${allScenes.length}):\n${sampledSummaries.join("\n")}`,
    );
  }

  // ── System knowledge concepts — deduplicated, capped ──
  const concepts = new Set<string>();
  for (const r of results) {
    for (const sc of r.scenes) {
      for (const n of sc.systemDeltas?.addedNodes ?? []) {
        if (n.concept) concepts.add(`${n.concept} (${n.type})`);
      }
    }
  }
  if (concepts.size > 0) {
    const sampled = [...concepts].slice(0, 25);
    lines.push(
      `\nWORLD KNOWLEDGE CONCEPTS (${sampled.length} of ${concepts.size}):\n${sampled.join(", ")}`,
    );
  }

  // ── Prose excerpts — sampled from early, middle, late for voice range ──
  const chunksWithProse: { chunkIdx: number; prose: string }[] = [];
  for (let ci = 0; ci < results.length; ci++) {
    for (const sc of results[ci].scenes) {
      if (sc.prose) {
        chunksWithProse.push({ chunkIdx: ci, prose: sc.prose });
        break; // one per chunk is enough
      }
    }
  }

  if (chunksWithProse.length > 0) {
    // Pick up to 4 excerpts: first, ~33%, ~66%, last
    const indices =
      chunksWithProse.length <= 4
        ? chunksWithProse.map((_, i) => i)
        : [
            0,
            Math.floor(chunksWithProse.length * 0.33),
            Math.floor(chunksWithProse.length * 0.66),
            chunksWithProse.length - 1,
          ];
    const unique = [...new Set(indices)];
    const excerpts = unique.map((i) => chunksWithProse[i].prose.slice(0, 2500));
    lines.push(
      `\nPROSE EXCERPTS (${excerpts.length} sampled from early/mid/late for voice range):\n${excerpts.map((e) => `---\n${e}\n---`).join("\n")}`,
    );
  } else {
    lines.push(
      "\n(no prose available — infer voice from summaries and world tone)",
    );
  }

  return lines.join("\n");
}

// ── Assemble Narrative ───────────────────────────────────────────────────────

export async function assembleNarrative(
  title: string,
  results: AnalysisChunkResult[],
  threadDependencies: Record<string, string[]>,
  onToken?: (token: string, accumulated: string) => void,
  arcGroups?: { name: string; sceneIndices: number[] }[],
): Promise<NarrativeState> {
  const PREFIX =
    title
      .replace(/[^a-zA-Z]/g, "")
      .slice(0, 3)
      .toUpperCase() || "TXT";
  let charCounter = 0,
    locCounter = 0,
    threadCounter = 0,
    sceneCounter = 0,
    arcCounter = 0,
    kCounter = 0,
    tkCounter = 0,
    wkCounter = 0,
    artifactCounter = 0;

  const nextId = (pre: string, counter: () => number, pad = 2) =>
    `${pre}-${PREFIX}-${String(counter()).padStart(pad, "0")}`;
  const nextCharId = () => nextId("C", () => ++charCounter);
  const nextLocId = () => nextId("L", () => ++locCounter);
  const nextThreadId = () => nextId("T", () => ++threadCounter);
  const nextSceneId = () => nextId("S", () => ++sceneCounter, 3);
  const nextArcId = () => nextId("ARC", () => ++arcCounter);
  const nextKId = () => nextId("K", () => ++kCounter, 3);
  const nextTkId = () => nextId("TK", () => ++tkCounter, 3);
  const nextWkId = () => nextId("WK", () => ++wkCounter, 2);
  const nextArtifactIdFn = () => nextId("A", () => ++artifactCounter);

  const charNameToId: Record<string, string> = {};
  const locNameToId: Record<string, string> = {};
  const threadDescToId: Record<string, string> = {};
  const artifactNameToId: Record<string, string> = {};
  const wkConceptToId: Record<string, string> = {}; // lowercase concept → WK ID

  const getWkId = (concept: string) => {
    const key = concept.toLowerCase();
    if (!wkConceptToId[key]) wkConceptToId[key] = nextWkId();
    return wkConceptToId[key];
  };

  const getCharId = (name: string) => {
    if (!charNameToId[name]) charNameToId[name] = nextCharId();
    return charNameToId[name];
  };
  const getLocId = (name: string) => {
    if (!locNameToId[name]) locNameToId[name] = nextLocId();
    return locNameToId[name];
  };
  const getThreadId = (desc: string) => {
    if (!threadDescToId[desc]) threadDescToId[desc] = nextThreadId();
    return threadDescToId[desc];
  };
  const getArtifactId = (name: string) => {
    if (!artifactNameToId[name]) artifactNameToId[name] = nextArtifactIdFn();
    return artifactNameToId[name];
  };
  /** Resolve an entity name to its ID — checks characters first, then locations, then artifacts. Falls back to character ID. */
  const getEntityId = (name: string) =>
    charNameToId[name] ??
    locNameToId[name] ??
    artifactNameToId[name] ??
    getCharId(name);

  const characters: Record<string, Character> = {};
  const locations: Record<string, Location> = {};
  const artifactEntities: Record<string, Artifact> = {};
  const threads: Record<string, Thread> = {};
  const scenes: Record<string, Scene> = {};
  const arcs: Record<string, Arc> = {};
  const relationshipMap: Record<string, RelationshipEdge> = {};

  // Deferred knowledge: character/location knowledge extracted per-chunk will be
  // attributed to the first scene of that chunk so all knowledge flows through
  // scene deltas (enabling temporal filtering).
  // No deferred knowledge — continuity is built directly on entities during creation
  // Track which chunk each entity was first introduced in (for per-batch world commits)
  const charFirstChunk = new Map<string, number>();
  const locFirstChunk = new Map<string, number>();
  const threadFirstChunk = new Map<string, number>();
  const artifactFirstChunk = new Map<string, number>();
  const chunkFirstSceneId = new Map<number, string>(); // chunkIdx → first scene id
  const allOrderedSceneIds: string[] = []; // flat ordered list for arc group assignment
  const seenWkNodeIds = new Set<string>(); // track knowledge nodes already added by prior scenes
  const seenWkEdgeKeys = new Set<string>(); // track knowledge edges already added (from→to→relation)

  for (let chunkIdx = 0; chunkIdx < results.length; chunkIdx++) {
    const ch = results[chunkIdx];
    // Characters — create entities with continuity built directly
    for (const c of ch.characters ?? []) {
      const id = getCharId(c.name);
      if (!characters[id]) {
        characters[id] = {
          id,
          name: c.name,
          role: c.role as Character["role"],
          threadIds: [],
          world: { nodes: {}, edges: [] },
          ...(c.imagePrompt ? { imagePrompt: c.imagePrompt } : {}),
        };
        charFirstChunk.set(id, chunkIdx);
      } else if (c.imagePrompt) {
        characters[id].imagePrompt = c.imagePrompt;
      }
      const rank: Record<string, number> = {
        transient: 0,
        recurring: 1,
        anchor: 2,
      };
      if ((rank[c.role] ?? 0) > (rank[characters[id].role] ?? 0)) {
        characters[id].role = c.role as Character["role"];
      }
    }

    // Locations — identity only; all lore flows through scene.worldDeltas
    for (const loc of ch.locations ?? []) {
      const id = getLocId(loc.name);
      if (!locations[id]) {
        const parentId = loc.parentName ? getLocId(loc.parentName) : null;
        const tiedCharacterIds = (loc.tiedCharacterNames ?? [])
          .map((n: string) => getCharId(n))
          .filter(Boolean);
        locations[id] = {
          id,
          name: loc.name,
          prominence: (loc.prominence &&
          ["domain", "place", "margin"].includes(loc.prominence)
            ? loc.prominence
            : "place") as Location["prominence"],
          parentId,
          tiedCharacterIds,
          threadIds: [],
          world: { nodes: {}, edges: [] },
          ...(loc.imagePrompt ? { imagePrompt: loc.imagePrompt } : {}),
        };
        locFirstChunk.set(id, chunkIdx);
      } else {
        if (loc.imagePrompt) locations[id].imagePrompt = loc.imagePrompt;
        const promRank: Record<string, number> = {
          margin: 0,
          place: 1,
          domain: 2,
        };
        if (
          (promRank[loc.prominence ?? ""] ?? 0) >
          (promRank[locations[id].prominence] ?? 0)
        ) {
          locations[id].prominence = loc.prominence as Location["prominence"];
        }
        // Accumulate tied characters across scenes (not just first creation)
        const newTied = (loc.tiedCharacterNames ?? [])
          .map((n: string) => getCharId(n))
          .filter(Boolean);
        for (const cid of newTied) {
          if (!locations[id].tiedCharacterIds.includes(cid)) {
            locations[id].tiedCharacterIds = [
              ...locations[id].tiedCharacterIds,
              cid,
            ];
          }
        }
      }
    }

    // Artifacts
    for (const a of ch.artifacts ?? []) {
      const id = getArtifactId(a.name);
      const ownerName = a.ownerName;
      const parentId = ownerName
        ? (charNameToId[ownerName] ??
          locNameToId[ownerName] ??
          getLocId(ownerName))
        : null;
      if (!artifactEntities[id]) {
        artifactEntities[id] = {
          id,
          name: a.name,
          significance: (["key", "notable", "minor"].includes(a.significance)
            ? a.significance
            : "notable") as Artifact["significance"],
          world: { nodes: {}, edges: [] },
          threadIds: [],
          parentId,
          ...(a.imagePrompt ? { imagePrompt: a.imagePrompt } : {}),
        };
        artifactFirstChunk.set(id, chunkIdx);
      } else {
        if (a.imagePrompt) artifactEntities[id].imagePrompt = a.imagePrompt;
        if (parentId) artifactEntities[id].parentId = parentId;
      }
    }

    // Threads
    for (const t of ch.threads ?? []) {
      const id = getThreadId(t.description);
      const newAnchors = (t.participantNames ?? []).map((name) => {
        if (charNameToId[name])
          return { id: charNameToId[name], type: "character" as const };
        if (locNameToId[name])
          return { id: locNameToId[name], type: "location" as const };
        return { id: getCharId(name), type: "character" as const };
      });
      if (!threads[id]) {
        threads[id] = {
          id,
          participants: newAnchors,
          description: t.description,
          status: t.statusAtEnd ?? "latent",
          openedAt: "",
          dependents: [],
          threadLog: { nodes: {}, edges: [] },
        };
        threadFirstChunk.set(id, chunkIdx);
      } else {
        threads[id].status = t.statusAtEnd ?? threads[id].status;
        // Accumulate anchors from later chunks
        const existingAnchorIds = new Set(
          threads[id].participants.map((a) => a.id),
        );
        for (const anchor of newAnchors) {
          if (!existingAnchorIds.has(anchor.id)) {
            threads[id].participants.push(anchor);
            existingAnchorIds.add(anchor.id);
          }
        }
      }
    }

    // Scenes — collect into flat list; arcs created from arcGroups after loop
    const chScenes: Scene[] = [];
    const arcId = "__pending__"; // Will be assigned from arcGroups below

    for (const s of ch.scenes ?? []) {
      const sceneId = nextSceneId();
      const locationId = getLocId(s.locationName ?? "Unknown");
      const participantIds = (s.participantNames ?? []).map((n) =>
        getCharId(n),
      );
      const povId = s.povName
        ? getCharId(s.povName)
        : (participantIds[0] ?? "");

      const scene: Scene = {
        kind: "scene",
        id: sceneId,
        arcId,
        locationId,
        povId,
        participantIds,
        events: s.events ?? [],
        threadDeltas: (s.threadDeltas ?? []).map((tm) => {
          // Coerce invalid from/to statuses — extraction sometimes returns
          // log node type vocabulary (e.g. "pulse") in the status fields.
          // Anything outside the lifecycle vocabulary collapses to a
          // status-hold so the thread's stored phase can't be polluted.
          const validStatuses = new Set<string>([
            ...THREAD_ACTIVE_STATUSES,
            ...THREAD_TERMINAL_STATUSES,
            "abandoned",
          ]);
          const safeFrom = validStatuses.has(tm.from) ? tm.from : "latent";
          const safeTo = validStatuses.has(tm.to) ? tm.to : safeFrom;
          const fallbackType: ThreadLogNodeType =
            safeFrom === safeTo ? "pulse" : "transition";
          // Assign IDs to log nodes. Chain edges are created deterministically
          // by applyThreadDelta during store replay — same as world graph chain edges.
          const addedNodes = (tm.addedNodes ?? [])
            .filter(
              (e) => e && typeof e.content === "string" && e.content.trim(),
            )
            .map((e) => ({
              id: nextTkId(),
              content: e.content,
              type: (THREAD_LOG_NODE_TYPES.includes(e.type as ThreadLogNodeType)
                ? e.type
                : fallbackType) as ThreadLogNodeType,
            }));
          // Synthesize a fallback log entry if the LLM omitted them — every
          // threadDelta must produce at least one log node, otherwise the
          // thread's history goes blank on a silent extraction miss.
          if (addedNodes.length === 0) {
            const desc = tm.threadDescription || "thread";
            addedNodes.push({
              id: nextTkId(),
              content:
                safeFrom === safeTo
                  ? `Thread "${desc}" held ${safeTo} without transition`
                  : `Thread "${desc}" advanced from ${safeFrom} to ${safeTo}`,
              type: fallbackType,
            });
          }
          return {
            threadId: getThreadId(tm.threadDescription),
            from: safeFrom,
            to: safeTo,
            addedNodes,
          };
        }),
        worldDeltas: (s.worldDeltas ?? []).map((km) => {
          const entityId = getEntityId(km.entityName);
          // Assign IDs in the order the LLM listed world nodes — applyWorldDelta
          // chains them sequentially via co_occurs during store replay.
          const nodes = (km.addedNodes ?? []).map((n) => ({
            id: nextKId(),
            content: n.content,
            type: (n.type || "trait") as WorldNodeType,
          }));
          return { entityId, addedNodes: nodes };
        }),
        relationshipDeltas: (s.relationshipDeltas ?? []).map((rm) => ({
          from: getCharId(rm.from),
          to: getCharId(rm.to),
          type: rm.type,
          valenceDelta: rm.valenceDelta ?? 0,
        })),
        characterMovements: (() => {
          const mvs = s.characterMovements ?? [];
          if (mvs.length === 0) return undefined;
          const result: Record<
            string,
            { locationId: string; transition: string }
          > = {};
          for (const mv of mvs) {
            const charId = getCharId(mv.characterName);
            const locId = getLocId(mv.locationName);
            if (charId && locId && locId !== locationId) {
              result[charId] = {
                locationId: locId,
                transition: mv.transition ?? "",
              };
            }
          }
          return Object.keys(result).length > 0 ? result : undefined;
        })(),
        artifactUsages:
          (() => {
            const aus = s.artifactUsages ?? [];
            if (aus.length === 0) return undefined;
            return aus
              .map((au) => ({
                artifactId: getArtifactId(au.artifactName),
                characterId: au.characterName
                  ? getCharId(au.characterName)
                  : null,
                usage: au.usage || "",
              }))
              .filter((au) => artifactEntities[au.artifactId]);
          })() || undefined,
        ownershipDeltas:
          (() => {
            const oms = s.ownershipDeltas ?? [];
            if (oms.length === 0) return undefined;
            return oms
              .map((om) => ({
                artifactId: getArtifactId(om.artifactName),
                fromId:
                  charNameToId[om.fromName] ??
                  locNameToId[om.fromName] ??
                  getLocId(om.fromName),
                toId:
                  charNameToId[om.toName] ??
                  locNameToId[om.toName] ??
                  getLocId(om.toName),
              }))
              .filter((om) => artifactEntities[om.artifactId]);
          })() || undefined,
        tieDeltas:
          (() => {
            const mms = s.tieDeltas ?? [];
            if (mms.length === 0) return undefined;
            return mms
              .map(
                (mm: {
                  locationName: string;
                  characterName: string;
                  action: string;
                }) => ({
                  locationId: getLocId(mm.locationName),
                  characterId: getCharId(mm.characterName),
                  action: mm.action as "add" | "remove",
                }),
              )
              .filter(
                (mm) =>
                  mm.characterId &&
                  (mm.action === "add" || mm.action === "remove"),
              );
          })() || undefined,
        systemDeltas: (() => {
          const wkm = s.systemDeltas;
          if (!wkm) return undefined;
          // Only add nodes not already seen in prior scenes
          const addedNodes = (wkm.addedNodes ?? [])
            .filter((n) => !seenWkNodeIds.has(getWkId(n.concept)))
            .map((n) => {
              const id = getWkId(n.concept);
              seenWkNodeIds.add(id);
              return {
                id,
                concept: n.concept,
                type: ([
                  "principle",
                  "system",
                  "concept",
                  "tension",
                  "event",
                  "structure",
                  "environment",
                  "convention",
                  "constraint",
                ].includes(n.type)
                  ? n.type
                  : "concept") as SystemNodeType,
              };
            });
          const addedEdges = (wkm.addedEdges ?? [])
            .filter((e) => {
              // Only accept edges where both endpoints are declared nodes (known concepts)
              // wkConceptToId tracks all concepts with IDs assigned via getWkId
              const fromKey = e.fromConcept?.toLowerCase();
              const toKey = e.toConcept?.toLowerCase();
              if (!fromKey || !toKey) return false;
              const fromId = wkConceptToId[fromKey];
              const toId = wkConceptToId[toKey];
              // Both concepts must already exist as actual nodes (seen in some scene)
              return (
                !!fromId &&
                !!toId &&
                seenWkNodeIds.has(fromId) &&
                seenWkNodeIds.has(toId)
              );
            })
            .map((e) => ({
              from: getWkId(e.fromConcept),
              to: getWkId(e.toConcept),
              relation: e.relation,
            }))
            // Filter self-loops and cross-scene duplicates
            .filter((e) => {
              if (e.from === e.to) return false;
              const key = `${e.from}→${e.to}→${e.relation}`;
              if (seenWkEdgeKeys.has(key)) return false;
              seenWkEdgeKeys.add(key);
              return true;
            });
          if (addedNodes.length === 0 && addedEdges.length === 0)
            return undefined;
          return { addedNodes, addedEdges };
        })(),
        summary: s.summary ?? "",
        // Create version arrays for analyzed scenes
        proseVersions:
          s.prose || s.beatProseMap
            ? [
                {
                  prose: s.prose ?? "",
                  beatProseMap: s.beatProseMap,
                  branchId: "main",
                  timestamp: Date.now(),
                  version: "1",
                  versionType: "generate" as const,
                  ...(s.plan ? { sourcePlanVersion: "1" } : {}),
                },
              ]
            : undefined,
        planVersions: s.plan
          ? [
              {
                plan: s.plan,
                branchId: "main",
                timestamp: Date.now(),
                version: "1",
                versionType: "generate" as const,
              },
            ]
          : undefined,
        // Preserve embeddings from analysis pipeline
        summaryEmbedding: (s as any).summaryEmbedding,
        proseEmbedding: (s as any).proseEmbedding,
        planEmbeddingCentroid: (s as any).planEmbeddingCentroid,
      };

      scenes[sceneId] = scene;
      chScenes.push(scene);
      if (!chunkFirstSceneId.has(chunkIdx))
        chunkFirstSceneId.set(chunkIdx, sceneId);
    }

    // Distribute deferred knowledge across the chunk's scenes.
    // Each knowledge node goes to the first scene where that character participates,
    // spreading deltas naturally instead of spiking the first scene.
    if (chScenes.length > 0) {
      // Continuity is built directly on entities — no deferred flush needed
    }

    // Track scene order for arc group assignment below
    allOrderedSceneIds.push(...chScenes.map((s) => s.id));

    for (const tm of chScenes.flatMap((s) => s.threadDeltas)) {
      if (threads[tm.threadId] && !threads[tm.threadId].openedAt) {
        threads[tm.threadId].openedAt = chScenes[0]?.id;
      }
    }

    // Relationships — later chunks update type and valence (chronological last-write-wins)
    for (const r of ch.relationships ?? []) {
      const fromId = getCharId(r.from);
      const toId = getCharId(r.to);
      const key = `${fromId}→${toId}`;
      const existing = relationshipMap[key];
      if (existing) {
        // Keep latest type, but blend valence toward the newer value to show progression
        existing.type = r.type;
        existing.valence = r.valence;
      } else {
        relationshipMap[key] = {
          from: fromId,
          to: toId,
          type: r.type,
          valence: r.valence,
        };
      }
    }
  }

  // Ensure parent locations are at least as prominent as their children
  const promRankFinal: Record<string, number> = {
    margin: 0,
    place: 1,
    domain: 2,
  };
  for (const loc of Object.values(locations)) {
    if (loc.parentId && locations[loc.parentId]) {
      const parent = locations[loc.parentId];
      if (
        (promRankFinal[parent.prominence] ?? 0) <
        (promRankFinal[loc.prominence] ?? 0)
      ) {
        parent.prominence = loc.prominence;
      }
    }
  }

  // ── Create arcs from arcGroups ──────────────────────────────────────────────
  if (arcGroups && arcGroups.length > 0) {
    for (const group of arcGroups) {
      const arcId = nextArcId();
      const sceneIds = group.sceneIndices
        .filter((i) => i < allOrderedSceneIds.length)
        .map((i) => allOrderedSceneIds[i]);
      if (sceneIds.length === 0) continue;

      const arcScenes = sceneIds.map((id) => scenes[id]).filter(Boolean);
      const develops = [
        ...new Set(
          arcScenes.flatMap((s) => s.threadDeltas.map((tm) => tm.threadId)),
        ),
      ];
      const locationIds = [...new Set(arcScenes.map((s) => s.locationId))];
      const activeCharacterIds = [
        ...new Set(arcScenes.flatMap((s) => s.participantIds)),
      ];
      const initialCharacterLocations: Record<string, string> = {};
      for (const cid of activeCharacterIds) {
        const first = arcScenes.find((s) => s.participantIds.includes(cid));
        if (first) initialCharacterLocations[cid] = first.locationId;
      }

      arcs[arcId] = {
        id: arcId,
        name: group.name,
        sceneIds,
        develops,
        locationIds,
        activeCharacterIds,
        initialCharacterLocations,
      };
      // Assign arcId to scenes
      for (const scene of arcScenes) scene.arcId = arcId;
    }
  } else {
    // Fallback: group every 4 scenes into an arc
    for (let i = 0; i < allOrderedSceneIds.length; i += 4) {
      const arcId = nextArcId();
      const sceneIds = allOrderedSceneIds.slice(i, i + 4);
      const arcScenes = sceneIds.map((id) => scenes[id]).filter(Boolean);
      const develops = [
        ...new Set(
          arcScenes.flatMap((s) => s.threadDeltas.map((tm) => tm.threadId)),
        ),
      ];
      const locationIds = [...new Set(arcScenes.map((s) => s.locationId))];
      const activeCharacterIds = [
        ...new Set(arcScenes.flatMap((s) => s.participantIds)),
      ];
      const initialCharacterLocations: Record<string, string> = {};
      for (const cid of activeCharacterIds) {
        const first = arcScenes.find((s) => s.participantIds.includes(cid));
        if (first) initialCharacterLocations[cid] = first.locationId;
      }
      arcs[arcId] = {
        id: arcId,
        name: `Arc ${Math.floor(i / 4) + 1}`,
        sceneIds,
        develops,
        locationIds,
        activeCharacterIds,
        initialCharacterLocations,
      };
      for (const scene of arcScenes) scene.arcId = arcId;
    }
  }

  // Apply thread dependencies from reconciliation (description → array of dependent descriptions)
  const threadDescToIdMap = new Map(
    Object.values(threads).map((t) => [t.description, t.id]),
  );
  for (const [desc, depDescs] of Object.entries(threadDependencies)) {
    const threadId = threadDescToIdMap.get(desc);
    if (!threadId || !threads[threadId]) continue;
    for (const depDesc of depDescs) {
      const depId = threadDescToIdMap.get(depDesc);
      if (
        depId &&
        depId !== threadId &&
        !threads[threadId].dependents.includes(depId)
      ) {
        threads[threadId].dependents.push(depId);
      }
    }
  }

  // Wire thread IDs on characters/locations
  for (const thread of Object.values(threads)) {
    for (const anchor of thread.participants) {
      if (anchor.type === "character" && characters[anchor.id]) {
        if (!characters[anchor.id].threadIds.includes(thread.id))
          characters[anchor.id].threadIds.push(thread.id);
      }
      if (anchor.type === "location" && locations[anchor.id]) {
        if (!locations[anchor.id].threadIds.includes(thread.id))
          locations[anchor.id].threadIds.push(thread.id);
      }
    }
  }

  // Thread logs and world graphs are now derived from scene deltas by
  // store.tsx/computeDerivedEntities via applyWorldDelta on load. Entities start
  // with empty world graphs; the store builds them on replay with proper
  // within-scene chain edges and no cross-scene links.

  const relationships = Object.values(relationshipMap);

  // World builds — one per ~3 arcs (12 scenes), only when new entities are introduced.
  // The first batch always gets a commit; later batches are skipped if nothing new appeared.
  const WORLD_COMMIT_INTERVAL = SCENES_PER_ARC * 3; // ~12 scenes = 3 arcs
  const worldBuilds: Record<string, WorldBuild> = {};
  // Map from the first scene id of a batch → the world build commit to insert before it
  const worldBuildBeforeScene = new Map<string, string>(); // sceneId → worldBuildId

  for (
    let batchStart = 0;
    batchStart < results.length;
    batchStart += WORLD_COMMIT_INTERVAL
  ) {
    const batchEnd = Math.min(
      batchStart + WORLD_COMMIT_INTERVAL,
      results.length,
    );
    const batchChunkIndices = new Set(
      Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i),
    );
    const isInitial = batchStart === 0;

    const newCharIds = Object.keys(characters).filter((id) =>
      batchChunkIndices.has(charFirstChunk.get(id) ?? 0),
    );
    const newLocIds = Object.keys(locations).filter((id) =>
      batchChunkIndices.has(locFirstChunk.get(id) ?? 0),
    );
    const newThreadIds = Object.keys(threads).filter((id) =>
      batchChunkIndices.has(threadFirstChunk.get(id) ?? 0),
    );
    const newArtifactIds = Object.keys(artifactEntities).filter((id) =>
      batchChunkIndices.has(artifactFirstChunk.get(id) ?? 0),
    );

    if (
      !isInitial &&
      newCharIds.length === 0 &&
      newLocIds.length === 0 &&
      newThreadIds.length === 0 &&
      newArtifactIds.length === 0
    )
      continue;

    const batchNum = Math.floor(batchStart / WORLD_COMMIT_INTERVAL) + 1;
    const worldBuildId = `WB-${PREFIX}-${String(batchNum).padStart(3, "0")}`;
    const artSuffix =
      newArtifactIds.length > 0 ? `, ${newArtifactIds.length} artifacts` : "";
    const summary = isInitial
      ? `Initial world: ${newCharIds.length} characters, ${newLocIds.length} locations, ${newThreadIds.length} threads${artSuffix}`
      : `Chunks ${batchStart + 1}–${batchEnd}: +${newCharIds.length} characters, +${newLocIds.length} locations, +${newThreadIds.length} threads${artSuffix}`;

    worldBuilds[worldBuildId] = {
      kind: "world_build",
      id: worldBuildId,
      summary,
      expansionManifest: {
        newCharacters: newCharIds.map((id) => characters[id]).filter(Boolean),
        newLocations: newLocIds.map((id) => locations[id]).filter(Boolean),
        newThreads: newThreadIds.map((id) => threads[id]).filter(Boolean),
        newArtifacts: newArtifactIds
          .map((id) => artifactEntities[id])
          .filter(Boolean),
        systemDeltas: { addedNodes: [], addedEdges: [] },
        relationshipDeltas: [],
      },
    };

    // Find the first scene of the first chunk in this batch
    for (let ci = batchStart; ci < batchEnd; ci++) {
      const firstScene = chunkFirstSceneId.get(ci);
      if (firstScene) {
        worldBuildBeforeScene.set(firstScene, worldBuildId);
        break;
      }
    }
  }

  // Build entryIds: world build commits interleaved before their batch's first scene
  const entryIds: string[] = [];
  for (const sceneId of Object.keys(scenes)) {
    const worldBuildId = worldBuildBeforeScene.get(sceneId);
    if (worldBuildId) entryIds.push(worldBuildId);
    entryIds.push(sceneId);
  }

  // Branch — build version pointers for analyzed scenes
  const branchId = `B-${PREFIX}-MAIN`;
  const versionPointers: Record<string, SceneVersionPointers> = {};

  // Set explicit version pointers for all scenes with version arrays
  for (const sceneId of Object.keys(scenes)) {
    const scene = scenes[sceneId];
    const pointers: SceneVersionPointers = {};

    if (scene.proseVersions && scene.proseVersions.length > 0) {
      pointers.proseVersion = scene.proseVersions[0].version;
    }

    if (scene.planVersions && scene.planVersions.length > 0) {
      pointers.planVersion = scene.planVersions[0].version;
    }

    if (pointers.proseVersion || pointers.planVersion) {
      versionPointers[sceneId] = pointers;
    }
  }

  const branches: Record<string, Branch> = {
    [branchId]: {
      id: branchId,
      name: "Canon Timeline",
      parentBranchId: null,
      forkEntryId: null,
      entryIds,
      versionPointers,
      createdAt: Date.now() - 86400000,
    },
  };

  const worldSummary = results.map((ch) => ch.chapterSummary).join(" ");

  // Generate image style and prose profile from the analyzed content
  let imageStyle: string | undefined;
  let proseProfile: ProseProfile | undefined;
  let planGuidance = "";
  let genre: string | undefined;
  let subgenre: string | undefined;
  let patterns: string[] = [];
  let antiPatterns: string[] = [];

  try {
    const metaResult = await callAnalysis(
      `Based on the following world summary and character/thread data, extract:

1. IMAGE STYLE: A short (1-2 sentence) visual style description for consistent imagery.

2. PROSE PROFILE: Infer the author's distinctive voice and style from the text. Use your own words — choose values that accurately describe this specific work, not generic labels.
   - register: tonal register (conversational/literary/raw/clinical/sardonic/lyrical/mythic/journalistic or other)
   - stance: narrative stance (close_third/intimate_first_person/omniscient_ironic/detached_observer/unreliable_first or other)
   - tense: grammatical tense (past/present)
   - sentenceRhythm: structural cadence (terse/varied/flowing/staccato/periodic or other)
   - interiority: depth of character thought access (surface/moderate/deep/embedded)
   - dialogueWeight: proportion of dialogue (sparse/moderate/heavy/almost_none)
   - devices: 2-5 literary devices this author characteristically employs (specific, not generic)
   - rules: 3-6 SPECIFIC prose rules as imperatives — concrete enough to apply sentence-by-sentence. Derive these from what the author DOES. BAD: "Write well". GOOD: "Show emotion through physical reaction, never name it" / "No figurative language — just plain statements of fact" / "Exposition delivered only through discovery and dialogue" / "Terse does not mean monotone — vary between clipped fragments and occasional longer compound sentences"
   - antiPatterns: 3-5 SPECIFIC prose failures to avoid — concrete patterns that would break this author's voice. Derive from what the author does NOT do. BAD: "Don't be boring". GOOD: "NEVER use 'This was a [Name]' to introduce a mechanic — show what it does" / "No strategic summaries in internal monologue ('He calculated that...') — show calculation through action" / "Do not follow a reveal with a sentence restating its significance" / "Do not write narrator summaries of what the character already achieved on-page"

3. PLAN GUIDANCE: 2-4 sentences of specific guidance for scene beat plans. What mechanisms should dominate? How should exposition be handled? What should plans avoid? Be specific to this work's voice.

4. PATTERNS: 3-5 positive thematic commandments — what makes THIS series good. Derive from the work's GENRE and subgenre. First identify the genre (fantasy/sci-fi/thriller/romance/horror/literary/mystery/etc) and its specific subgenre (progression fantasy/space opera/cozy mystery/etc), then extract the patterns that make THIS work succeed within that tradition. Include:
   - Genre-specific tropes the work embraces and executes well (e.g. "Power scaling follows predictable but satisfying tiers" for progression fantasy)
   - Structural patterns that define the work's rhythm (e.g. "Each arc ends with a cultivation breakthrough that costs more than expected")
   - Character dynamics characteristic of the genre (e.g. "Rivals become reluctant allies before becoming true friends")
   NOT prose style (that's in proseProfile). EXAMPLES: "Every cost paid must compound into later consequence", "Magic always extracts a price from the wielder", "The underdog earns every advantage through sacrifice, never luck"

5. ANTI-PATTERNS: 3-5 negative story commandments — what to avoid in THIS series. Derive from common genre pitfalls and this work's specific failures to avoid:
   - Genre tropes the work actively subverts or avoids (e.g. "No harem dynamics — romantic tension with only one interest")
   - Common pitfalls in this genre (e.g. "Characters cannot conveniently forget established power limitations")
   - Patterns that would break THIS work's tone (e.g. "Humor never undercuts genuine emotional stakes")
   EXAMPLES: "No deus ex machina rescues — solutions must be seeded", "No convenient power-ups without prior setup", "Antagonists cannot be stupid just to let protagonists win"

${buildMetaContext(results, characters, threads, locations, scenes, worldSummary)}

Return JSON:
{
  "imageStyle": "style directive",
  "genre": "primary genre (fantasy/sci-fi/thriller/romance/horror/mystery/literary/etc)",
  "subgenre": "specific subgenre (progression fantasy/space opera/cozy mystery/dark romance/LitRPG/xianxia/etc)",
  "proseProfile": {
    "register": "string",
    "stance": "string",
    "tense": "string",
    "sentenceRhythm": "string",
    "interiority": "string",
    "dialogueWeight": "string",
    "devices": ["device1", "device2"],
    "rules": ["prose rule 1", "prose rule 2"],
    "antiPatterns": ["anti-pattern 1", "anti-pattern 2"]
  },
  "planGuidance": "How beat plans should be structured for this work",
  "patterns": ["story pattern 1", "story pattern 2"],
  "antiPatterns": ["story anti-pattern 1", "story anti-pattern 2"]
}`,
      "You are a literary analyst. Extract the visual style and prose voice of a narrative. Return only valid JSON.",
      onToken,
    );
    const metaParsed = JSON.parse(extractJSON(metaResult));
    imageStyle = metaParsed.imageStyle;
    if (
      metaParsed.proseProfile &&
      typeof metaParsed.proseProfile === "object"
    ) {
      const pp = metaParsed.proseProfile;
      const str = (v: unknown) =>
        typeof v === "string" && v.trim() ? v.trim() : undefined;
      proseProfile = {
        register: str(pp.register) ?? "",
        stance: str(pp.stance) ?? "",
        tense: str(pp.tense),
        sentenceRhythm: str(pp.sentenceRhythm),
        interiority: str(pp.interiority),
        dialogueWeight: str(pp.dialogueWeight),
        devices: Array.isArray(pp.devices)
          ? pp.devices.filter((d: unknown) => typeof d === "string")
          : [],
        rules: Array.isArray(pp.rules)
          ? pp.rules.filter((r: unknown) => typeof r === "string")
          : [],
        antiPatterns: Array.isArray(pp.antiPatterns)
          ? pp.antiPatterns.filter((a: unknown) => typeof a === "string")
          : [],
      };
    }
    if (
      typeof metaParsed.planGuidance === "string" &&
      metaParsed.planGuidance.trim()
    ) {
      planGuidance = metaParsed.planGuidance.trim();
    }
    if (Array.isArray(metaParsed.patterns)) {
      patterns = metaParsed.patterns.filter((p: unknown) => typeof p === "string");
    }
    if (Array.isArray(metaParsed.antiPatterns)) {
      antiPatterns = metaParsed.antiPatterns.filter((p: unknown) => typeof p === "string");
    }
  } catch (err) {
    logWarning(
      "Style/profile extraction failed - using defaults",
      err instanceof Error ? err : String(err),
      {
        source: "analysis",
        operation: "meta-extraction",
        details: { title, chunkCount: results.length },
      },
    );
  }

  const narrative: NarrativeState = {
    id: `N-${PREFIX}-${Date.now().toString(36)}`,
    title,
    description: results[0]?.chapterSummary || title,
    characters,
    locations,
    threads,
    artifacts: artifactEntities,
    arcs,
    scenes,
    worldBuilds,
    branches,
    relationships,
    systemGraph: { nodes: {}, edges: [] }, // derived — recomputed by withDerivedEntities on load
    worldSummary,
    imageStyle,
    proseProfile,
    storySettings: planGuidance
      ? { ...DEFAULT_STORY_SETTINGS, planGuidance }
      : undefined,
    patterns: patterns.length > 0 ? patterns : undefined,
    antiPatterns: antiPatterns.length > 0 ? antiPatterns : undefined,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
  };

  return narrative;
}
