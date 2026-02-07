#!/usr/bin/env npx tsx
/**
 * assemble-narrative.ts — Merge chapter analysis JSONs into a single NarrativeState
 * that can be imported directly into the app via the Import JSON button.
 *
 * Usage:
 *   npx tsx scripts/assemble-narrative.ts <book-dir> <title> [<description>]
 *
 * Example:
 *   npx tsx scripts/assemble-narrative.ts data/books/great-gatsby "The Great Gatsby"
 *
 * Expects:  <book-dir>/analysis/chapter-01.json, chapter-02.json, ...
 * Outputs:  <book-dir>/narrative.json  (importable NarrativeState)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: npx tsx scripts/assemble-narrative.ts <book-dir> <title> [<description>]');
  process.exit(1);
}

const bookDir = args[0];
const title = args[1];
const description = args[2] ?? '';
const analysisDir = join(bookDir, 'analysis');
const outputFile = join(bookDir, 'narrative.json');

if (!existsSync(analysisDir)) {
  console.error(`Analysis dir not found: ${analysisDir}`);
  process.exit(1);
}

// ── Load all chapter analyses ───────────────────────────────────────────────
const chapterFiles = readdirSync(analysisDir)
  .filter(f => f.match(/^chapter-\d+\.json$/))
  .sort();

console.log(`Found ${chapterFiles.length} chapter analyses`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chapters: any[] = chapterFiles.map(f => ({
  chapter: parseInt(f.match(/chapter-(\d+)/)?.[1] ?? '0', 10),
  ...JSON.parse(readFileSync(join(analysisDir, f), 'utf-8')),
}));

// ── ID generation helpers ───────────────────────────────────────────────────
const PREFIX = 'GBY'; // Short book prefix
let charCounter = 0;
let locCounter = 0;
let threadCounter = 0;
let sceneCounter = 0;
let arcCounter = 0;
let kCounter = 0;

function nextCharId() { return `C-${PREFIX}-${String(++charCounter).padStart(2, '0')}`; }
function nextLocId() { return `L-${PREFIX}-${String(++locCounter).padStart(2, '0')}`; }
function nextThreadId() { return `T-${PREFIX}-${String(++threadCounter).padStart(2, '0')}`; }
function nextSceneId() { return `S-${PREFIX}-${String(++sceneCounter).padStart(3, '0')}`; }
function nextArcId() { return `ARC-${PREFIX}-${String(++arcCounter).padStart(2, '0')}`; }
function nextKId() { return `K-${PREFIX}-${String(++kCounter).padStart(3, '0')}`; }

// ── Name → ID maps (built as we process chapters) ──────────────────────────
const charNameToId: Record<string, string> = {};
const locNameToId: Record<string, string> = {};
const threadDescToId: Record<string, string> = {};

function getCharId(name: string): string {
  if (!charNameToId[name]) charNameToId[name] = nextCharId();
  return charNameToId[name];
}

function getLocId(name: string): string {
  if (!locNameToId[name]) locNameToId[name] = nextLocId();
  return locNameToId[name];
}

function getThreadId(desc: string): string {
  if (!threadDescToId[desc]) threadDescToId[desc] = nextThreadId();
  return threadDescToId[desc];
}

// ── Accumulate into NarrativeState structures ───────────────────────────────
type Character = {
  id: string; name: string; role: string; threadIds: string[];
  knowledge: { nodes: { id: string; type: string; content: string }[]; edges: { from: string; to: string; type: string }[] };
};
type Location = {
  id: string; name: string; parentId: string | null; threadIds: string[];
  knowledge: { nodes: { id: string; type: string; content: string }[]; edges: { from: string; to: string; type: string }[] };
};
type Thread = {
  id: string; anchors: { id: string; type: 'character' | 'location' }[];
  description: string; status: string; openedAt: string; dependents: string[];
};
type Scene = {
  kind: 'scene'; id: string; arcId: string; locationId: string;
  participantIds: string[]; events: string[];
  threadMutations: { threadId: string; from: string; to: string }[];
  knowledgeMutations: { characterId: string; nodeId: string; action: string; content: string; nodeType?: string }[];
  relationshipMutations: { from: string; to: string; type: string; valenceDelta: number }[];
  stakes: number; prose: string; summary: string;
};
type Arc = {
  id: string; name: string; sceneIds: string[]; develops: string[];
  locationIds: string[]; activeCharacterIds: string[];
  initialCharacterLocations: Record<string, string>;
};
type RelationshipEdge = { from: string; to: string; type: string; valence: number };

const characters: Record<string, Character> = {};
const locations: Record<string, Location> = {};
const threads: Record<string, Thread> = {};
const scenes: Record<string, Scene> = {};
const arcs: Record<string, Arc> = {};
const relationships: RelationshipEdge[] = [];
const relationshipMap: Record<string, RelationshipEdge> = {};

// ── Process each chapter ────────────────────────────────────────────────────
for (const ch of chapters) {
  const chNum = ch.chapter;
  console.log(`\nProcessing Chapter ${chNum}...`);

  // — Characters —
  for (const c of ch.characters ?? []) {
    const id = getCharId(c.name);
    if (!characters[id]) {
      characters[id] = {
        id, name: c.name, role: c.role, threadIds: [],
        knowledge: { nodes: [], edges: [] },
      };
    }
    // Upgrade role
    const rank: Record<string, number> = { transient: 0, recurring: 1, anchor: 2 };
    if ((rank[c.role] ?? 0) > (rank[characters[id].role] ?? 0)) {
      characters[id].role = c.role;
    }
    // Add knowledge nodes
    for (const k of c.knowledge ?? []) {
      const kId = nextKId();
      characters[id].knowledge.nodes.push({ id: kId, type: k.type, content: k.content });
    }
  }

  // — Locations —
  for (const loc of ch.locations ?? []) {
    const id = getLocId(loc.name);
    if (!locations[id]) {
      const parentId = loc.parentName ? getLocId(loc.parentName) : null;
      locations[id] = {
        id, name: loc.name, parentId, threadIds: [],
        knowledge: { nodes: [], edges: [] },
      };
      // Add lore as knowledge nodes
      for (const lore of loc.lore ?? []) {
        const kId = nextKId();
        locations[id].knowledge.nodes.push({ id: kId, type: 'lore', content: lore });
      }
    }
  }

  // — Threads —
  for (const t of ch.threads ?? []) {
    const id = getThreadId(t.description);
    if (!threads[id]) {
      const anchors = (t.anchorNames ?? []).map((name: string) => {
        if (charNameToId[name]) return { id: charNameToId[name], type: 'character' as const };
        if (locNameToId[name]) return { id: locNameToId[name], type: 'location' as const };
        // Default to character, create ID
        return { id: getCharId(name), type: 'character' as const };
      });
      threads[id] = {
        id, anchors, description: t.description,
        status: t.statusAtEnd ?? t.statusAtStart ?? 'dormant',
        openedAt: '', dependents: [],
      };
    } else {
      // Update status
      threads[id].status = t.statusAtEnd ?? threads[id].status;
    }
  }

  // — Scenes (one arc per chapter) —
  const chScenes: Scene[] = [];
  const arcId = nextArcId();

  for (const s of ch.scenes ?? []) {
    const sceneId = nextSceneId();
    const locationId = getLocId(s.locationName ?? 'Unknown');
    const participantIds = (s.participantNames ?? []).map((n: string) => getCharId(n));

    const threadMutations = (s.threadMutations ?? []).map((tm: any) => ({
      threadId: getThreadId(tm.threadDescription),
      from: tm.from,
      to: tm.to,
    }));

    const knowledgeMutations = (s.knowledgeMutations ?? []).map((km: any) => ({
      characterId: getCharId(km.characterName),
      nodeId: nextKId(),
      action: km.action ?? 'added',
      content: km.content,
      nodeType: km.type,
    }));

    const relationshipMutations = (s.relationshipMutations ?? []).map((rm: any) => ({
      from: getCharId(rm.from),
      to: getCharId(rm.to),
      type: rm.type,
      valenceDelta: rm.valenceDelta ?? 0,
    }));

    const scene: Scene = {
      kind: 'scene',
      id: sceneId,
      arcId,
      locationId,
      participantIds,
      events: s.events ?? [],
      threadMutations,
      knowledgeMutations,
      relationshipMutations,
      stakes: s.stakes ?? 30,
      prose: '',
      summary: s.summary ?? '',
    };

    scenes[sceneId] = scene;
    chScenes.push(scene);
  }

  // — Arc for this chapter —
  if (chScenes.length > 0) {
    const sceneIds = chScenes.map(s => s.id);
    const develops = [...new Set(chScenes.flatMap(s => s.threadMutations.map(tm => tm.threadId)))];
    const locationIds = [...new Set(chScenes.map(s => s.locationId))];
    const activeCharacterIds = [...new Set(chScenes.flatMap(s => s.participantIds))];
    const initialCharacterLocations: Record<string, string> = {};
    for (const cid of activeCharacterIds) {
      const first = chScenes.find(s => s.participantIds.includes(cid));
      if (first) initialCharacterLocations[cid] = first.locationId;
    }

    arcs[arcId] = {
      id: arcId,
      name: `Chapter ${chNum}`,
      sceneIds,
      develops,
      locationIds,
      activeCharacterIds,
      initialCharacterLocations,
    };

    // Set thread openedAt for threads first appearing in this chapter's scenes
    for (const tm of chScenes.flatMap(s => s.threadMutations)) {
      if (threads[tm.threadId] && !threads[tm.threadId].openedAt) {
        threads[tm.threadId].openedAt = chScenes[0].id;
      }
    }
  }

  // — Relationships —
  for (const r of ch.relationships ?? []) {
    const fromId = getCharId(r.from);
    const toId = getCharId(r.to);
    const key = `${fromId}→${toId}`;
    relationshipMap[key] = { from: fromId, to: toId, type: r.type, valence: r.valence };
  }

  console.log(`  Scenes: ${chScenes.length}, Arc: ${arcs[arcId]?.name ?? 'none'}`);
}

// ── Wire up thread IDs on characters ────────────────────────────────────────
for (const thread of Object.values(threads)) {
  for (const anchor of thread.anchors) {
    if (anchor.type === 'character' && characters[anchor.id]) {
      if (!characters[anchor.id].threadIds.includes(thread.id)) {
        characters[anchor.id].threadIds.push(thread.id);
      }
    }
    if (anchor.type === 'location' && locations[anchor.id]) {
      if (!locations[anchor.id].threadIds.includes(thread.id)) {
        locations[anchor.id].threadIds.push(thread.id);
      }
    }
  }
}

// ── Add knowledge edges (connect sequential nodes per character) ─────────
for (const char of Object.values(characters)) {
  const nodes = char.knowledge.nodes;
  for (let i = 1; i < nodes.length; i++) {
    char.knowledge.edges.push({
      from: nodes[i - 1].id,
      to: nodes[i].id,
      type: 'develops',
    });
  }
}

// ── Build relationships array ───────────────────────────────────────────────
for (const r of Object.values(relationshipMap)) {
  relationships.push(r);
}

// ── Build commits ───────────────────────────────────────────────────────────
const sceneList = Object.values(scenes);
const commits = sceneList.map((scene, i) => ({
  id: `CM-${PREFIX}-${String(i + 1).padStart(3, '0')}`,
  parentId: i === 0 ? null : `CM-${PREFIX}-${String(i).padStart(3, '0')}`,
  sceneId: scene.id,
  arcId: scene.arcId,
  diffName: scene.events[0] ?? 'scene',
  threadMutations: scene.threadMutations,
  knowledgeMutations: scene.knowledgeMutations,
  relationshipMutations: scene.relationshipMutations,
  authorOverride: null,
  createdAt: Date.now() - (sceneList.length - i) * 3600000,
}));

// ── World build commit ──────────────────────────────────────────────────────
const wxId = `WX-${PREFIX}-init`;
const worldBuild = {
  kind: 'world_build' as const,
  id: wxId,
  summary: `World created: ${Object.keys(characters).length} characters (${Object.values(characters).map(c => c.name).join(', ')}), ${Object.keys(locations).length} locations, ${Object.keys(threads).length} threads, ${relationships.length} relationships`,
  expansionManifest: {
    characterIds: Object.keys(characters),
    locationIds: Object.keys(locations),
    threadIds: Object.keys(threads),
    relationshipCount: relationships.length,
  },
};

// ── Branch ──────────────────────────────────────────────────────────────────
const branchId = `B-${PREFIX}-MAIN`;
const branches = {
  [branchId]: {
    id: branchId,
    name: 'Canon Timeline',
    parentBranchId: null,
    forkEntryId: null,
    entryIds: [wxId, ...Object.keys(scenes)],
    createdAt: Date.now() - 86400000,
  },
};

// ── World summary from chapter summaries ────────────────────────────────────
const worldSummary = chapters.map(ch => ch.chapterSummary).join(' ');

// ── Assemble NarrativeState ─────────────────────────────────────────────────
const narrative = {
  id: `N-${PREFIX}`,
  title,
  description: description || chapters[0]?.chapterSummary || title,
  characters,
  locations,
  threads,
  arcs,
  scenes,
  worldBuilds: { [wxId]: worldBuild },
  branches,
  commits,
  relationships,
  worldSummary,
  controlMode: 'auto',
  activeForces: { stakes: 0, pacing: 0, variety: 0 },
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
};

writeFileSync(outputFile, JSON.stringify(narrative, null, 2));

console.log(`\n${'═'.repeat(60)}`);
console.log(`Narrative assembled: ${outputFile}`);
console.log(`  Characters: ${Object.keys(characters).length}`);
console.log(`  Locations: ${Object.keys(locations).length}`);
console.log(`  Threads: ${Object.keys(threads).length}`);
console.log(`  Arcs: ${Object.keys(arcs).length}`);
console.log(`  Scenes: ${Object.keys(scenes).length}`);
console.log(`  Relationships: ${relationships.length}`);
console.log(`  Commits: ${commits.length}`);
console.log(`\nImport via the app's "Import JSON" button in the top bar.`);
