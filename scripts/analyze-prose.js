/**
 * Unified prose analysis pipeline.
 *
 * Phase 1: Extract minimal plans (beats + anchors) from all works
 * Phase 2: Build authorial profiles with Markov chain beat transitions
 * Phase 3: Validate type coverage and generate empirical report
 *
 * Usage: node scripts/analyze-prose.js [scenes-per-work]
 * Requires: dev server running on localhost:3001
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3001/api/generate';
const CONCURRENCY = 20;
const WORKS_DIR = path.join(__dirname, '..', 'public', 'works');
const OUT_DIR = path.join(__dirname, '..', 'public', 'prose-profiles');

async function callGenerate(prompt, systemPrompt, maxTokens = 8000) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, systemPrompt, maxTokens }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return (await res.json()).content;
}

async function parallelMap(items, fn, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// ── Beat taxonomy ───────────────────────────────────────────────────────────

const BEAT_FNS = [
  'breathe',     // Pacing, atmosphere, sensory grounding, scene establishment
  'inform',      // Knowledge delivery — character or reader learns something now
  'advance',     // Forward momentum — plot moves, goals pursued, tension rises
  'bond',        // Relationship shifts between characters
  'turn',        // Scene pivots — revelation, reversal, interruption
  'reveal',      // Character nature exposed through action or choice
  'shift',       // Power dynamic inverts
  'expand',      // World-building — new rules, systems, geography
  'foreshadow',  // Plants information that pays off later
  'resolve',     // Tension releases — question answered, conflict settles
];

const MECHANISMS = [
  'dialogue',     // Characters speaking
  'thought',      // Internal monologue — character's private reasoning
  'action',       // Physical movement, gesture, body in space
  'environment',  // Setting, weather, arrivals, spatial context, sensory detail
  'narration',    // Narrator addresses reader, authorial commentary, rhetoric
  'memory',       // Flashback triggered by association
  'document',     // Embedded text: letter, newspaper, sign, cited poetry/scripture
  'comic',        // Humor — physical comedy, ironic observation, absurdity
];

// Map old types to merged types for normalization
const FN_ALIASES = { ground: 'breathe', drive: 'advance', escalate: 'advance', contrast: 'inform', argue: 'inform', illustrate: 'inform', challenge: 'inform' };
const MECH_ALIASES = { sense: 'environment', rhetoric: 'narration', quotation: 'document' };

// ── Plan extraction prompt ──────────────────────────────────────────────────

const EXTRACT_SYSTEM = `You are a literary analyst. Given prose and its metadata, extract a minimal scene plan.

Return ONLY valid JSON:
{
  "beats": [
    {
      "fn": "breathe|inform|advance|bond|turn|reveal|shift|expand|foreshadow|resolve",
      "mechanism": "dialogue|thought|action|environment|narration|memory|document|comic",
      "what": "One sentence: the concrete action or event",
      "anchor": "The one sensory detail that makes this beat physical"
    }
  ],
  "anchors": ["Exact memorable lines from the prose — 0-5 iconic phrases."]
}

BEAT FUNCTIONS (10) — what the beat DOES in the scene:
  breathe    — Pacing, atmosphere, sensory grounding, scene establishment. Physical reality, who is where, environmental texture. Use for scene openings AND mid-scene pauses.
  inform     — Knowledge delivery. Character or reader learns something NOW. A fact, a letter, a secret, an argument, an example, a counterpoint. The primary engine of all prose.
  advance    — Forward momentum. Plot moves, goals pursued, tension rises, character acts on impulse or reacts to pressure. Covers both deliberate progression and raw momentum.
  bond       — Relationship shifts between characters. Trust deepens, suspicion grows, alliance forms or fractures. Requires two characters interacting.
  turn       — Scene pivots. A revelation reframes everything. A reversal. An interruption that changes the scene's direction.
  reveal     — Character nature exposed through action or choice. Not information — the reader sees WHO someone is.
  shift      — Power dynamic inverts. Who has leverage changes hands.
  expand     — World-building. New rule, system, geography, or cultural element introduced.
  foreshadow — Plants information that pays off LATER. Detail that seems incidental now but becomes significant.
  resolve    — Tension releases. Question answered. Conflict settles. The payoff beat.

MECHANISMS (8) — HOW the beat reads as prose:
  dialogue    — Characters speaking. Conversation with subtext.
  thought     — Internal monologue. POV character's private reasoning and observation.
  action      — Physical movement, gesture, interaction with objects. Body in space.
  environment — Setting, weather, lighting, arrivals, spatial context, sensory details (smells, sounds, textures).
  narration   — Narrator addresses reader, authorial commentary, rhetorical structures (anaphora, parallelism, antithesis). The authorial voice stepping forward.
  memory      — Flashback triggered by association. Transports to another time.
  document    — Embedded text: letter, newspaper, sign, book excerpt, cited poetry, scripture, proverb.
  comic       — Humor. Physical comedy, ironic observation, absurdity, bathos.

Target ~8-15 beats per 1000 words. Opening beats should be 'breathe'. Return ONLY valid JSON.`;

// ── Main ────────────────────────────────────────────────────────────────────

const WORK_FILES = [
  'harry_potter_and_the_prisoner_of_azkaban.json',
  'harry_potter_and_the_chamber_of_secrets.json',
  'harry_potter_and_the_sorcerer_s_stone.json',
  'reverend_insanity.json',
  'nineteen_eighty_four.json',
  'the_great_gatsby.json',
  'a_tale_of_two_cities.json',
  'romeo_and_juliet.json',
  'alice_s_adventures_in_wonderland.json',
  'the_wealth_of_nations.json',
];

async function extractPlans(work, scenesPerWork) {
  const charNames = {};
  Object.entries(work.characters || {}).forEach(([id, c]) => charNames[id] = c.name);
  const locNames = {};
  Object.entries(work.locations || {}).forEach(([id, l]) => locNames[id] = l.name);

  const allScenes = Object.values(work.scenes).filter(s => s.prose && !s.plan?.beats?.length);
  const scenes = scenesPerWork > 0 ? allScenes.slice(0, scenesPerWork) : allScenes;

  return parallelMap(scenes, async (s, i) => {
    const povName = charNames[s.povId] || s.povId;
    const locName = locNames[s.locationId] || s.locationId;
    const wordCount = s.prose.split(/\s+/).length;

    console.log(`    [${i + 1}/${scenes.length}] ${s.id} (${wordCount} words)...`);

    try {
      const raw = await callGenerate(
        `SCENE: ${s.summary}\nPOV: ${povName} | Location: ${locName}\nWords: ${wordCount}\n\nPROSE:\n${s.prose}`,
        EXTRACT_SYSTEM, 6000
      );
      const match = raw.match(/\{[\s\S]*\}/);
      const plan = JSON.parse(match[0]);

      // Normalize fn/mechanism to merged types
      for (const b of plan.beats || []) {
        b.fn = FN_ALIASES[b.fn] || b.fn;
        b.mechanism = MECH_ALIASES[b.mechanism] || b.mechanism;
        if (!BEAT_FNS.includes(b.fn)) b.fn = 'advance';
        if (!MECHANISMS.includes(b.mechanism)) b.mechanism = 'action';
      }

      console.log(`      ✓ ${plan.beats?.length || 0} beats, ${(plan.anchors || []).length} anchors`);
      return { sceneId: s.id, wordCount, plan };
    } catch (err) {
      console.log(`      ✗ ${err.message}`);
      return { sceneId: s.id, wordCount, plan: null, error: err.message };
    }
  }, CONCURRENCY);
}

function buildProfile(work, plans) {
  const validPlans = plans.filter(p => p.plan?.beats?.length > 0);
  if (validPlans.length === 0) return null;

  // Count everything
  const fnCounts = {};
  const mechCounts = {};
  const transitions = {};
  let totalBeats = 0;
  const beatsPerKWord = [];

  for (const fn of BEAT_FNS) fnCounts[fn] = 0;
  for (const m of MECHANISMS) mechCounts[m] = 0;

  for (const p of validPlans) {
    const beats = p.plan.beats;
    totalBeats += beats.length;
    beatsPerKWord.push(beats.length / (p.wordCount / 1000));

    for (const b of beats) {
      fnCounts[b.fn] = (fnCounts[b.fn] || 0) + 1;
      mechCounts[b.mechanism] = (mechCounts[b.mechanism] || 0) + 1;
    }
    for (let i = 1; i < beats.length; i++) {
      const key = `${beats[i - 1].fn}→${beats[i].fn}`;
      transitions[key] = (transitions[key] || 0) + 1;
    }
  }

  // Normalize distributions
  const norm = (obj) => {
    const total = Object.values(obj).reduce((s, v) => s + v, 0) || 1;
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v > 0) result[k] = Math.round(v / total * 1000) / 1000;
    }
    return result;
  };

  // Build Markov transition matrix
  const markov = {};
  for (const fn of BEAT_FNS) {
    const outgoing = {};
    let total = 0;
    for (const [key, count] of Object.entries(transitions)) {
      const [from, to] = key.split('→');
      if (from === fn) { outgoing[to] = count; total += count; }
    }
    if (total > 0) {
      markov[fn] = {};
      for (const [to, count] of Object.entries(outgoing)) {
        markov[fn][to] = Math.round(count / total * 1000) / 1000;
      }
    }
  }

  // Collect all anchors
  const allAnchors = validPlans.flatMap(p => p.plan.anchors || []);

  return {
    title: work.title,
    scenesAnalyzed: validPlans.length,
    totalBeats,
    avgBeatsPerKWord: Math.round(beatsPerKWord.reduce((s, v) => s + v, 0) / beatsPerKWord.length * 10) / 10,
    beatDistribution: norm(fnCounts),
    mechanismDistribution: norm(mechCounts),
    markovTransitions: markov,
    sampleAnchors: allAnchors.slice(0, 10),
  };
}

async function main() {
  const scenesPerWork = parseInt(process.argv[2] || '0', 10); // 0 = all scenes

  // Ensure output directory
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const allProfiles = [];

  for (const workFile of WORK_FILES) {
    const workPath = path.join(WORKS_DIR, workFile);
    if (!fs.existsSync(workPath)) continue;
    const work = JSON.parse(fs.readFileSync(workPath, 'utf-8'));
    const proseScenes = Object.values(work.scenes).filter(s => s.prose);
    // Skip scenes that already have a plan with beats
    const needsPlan = proseScenes.filter(s => !s.plan?.beats?.length);
    const toProcess = scenesPerWork > 0 ? needsPlan.slice(0, scenesPerWork) : needsPlan;

    console.log(`\n═══ ${work.title} (${proseScenes.length} prose scenes, ${needsPlan.length} need plans) ═══`);

    if (toProcess.length === 0) {
      console.log('  All scenes already have plans, skipping extraction');
    } else {
      // Phase 1: Extract plans
      console.log(`  Extracting plans for ${toProcess.length} scenes (concurrency: ${CONCURRENCY})...`);
      const plans = await extractPlans(work, scenesPerWork > 0 ? scenesPerWork : 99999);

      // Write plans back into the work JSON
      let written = 0;
      for (const p of plans) {
        if (p.plan && p.plan.beats?.length > 0 && work.scenes[p.sceneId]) {
          work.scenes[p.sceneId].plan = p.plan;
          written++;
        }
      }

      if (written > 0) {
        fs.writeFileSync(workPath, JSON.stringify(work, null, 2));
        console.log(`  ✓ Wrote ${written} plans back to ${workFile}`);
      }
    }

    // Phase 2: Build profile from ALL scenes with plans (including previously written)
    const allWithPlans = Object.values(work.scenes)
      .filter(s => s.plan?.beats?.length > 0)
      .map(s => ({ sceneId: s.id, wordCount: s.prose?.split(/\s+/).length ?? 0, plan: s.plan }));

    const profile = buildProfile(work, allWithPlans);
    if (!profile) { console.log('  ✗ No valid plans for profile'); continue; }

    // Add profile ID
    profile.id = workFile.replace('.json', '');
    profile.builtIn = true;

    allProfiles.push(profile);

    // Write profile into the work JSON as well
    work.proseProfile = profile;
    fs.writeFileSync(workPath, JSON.stringify(work, null, 2));

    // Save individual profile
    const profilePath = path.join(OUT_DIR, workFile.replace('.json', '_profile.json'));
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
    console.log(`  Profile: ${profile.totalBeats} beats, ${profile.avgBeatsPerKWord} beats/kw`);
    console.log(`  Top fn: ${Object.entries(profile.beatDistribution).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${Math.round(v * 100)}%`).join(' ')}`);
    console.log(`  Top mech: ${Object.entries(profile.mechanismDistribution).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${Math.round(v * 100)}%`).join(' ')}`);
  }

  // ── Phase 3: Empirical Report ───────────────────────────────────────────

  console.log('\n\n' + '═'.repeat(70));
  console.log('EMPIRICAL PROSE ANALYSIS REPORT');
  console.log('═'.repeat(70));

  // Type coverage
  console.log('\n── BEAT FUNCTION COVERAGE ──');
  const globalFn = {};
  for (const fn of BEAT_FNS) globalFn[fn] = 0;
  for (const p of allProfiles) {
    for (const [fn, pct] of Object.entries(p.beatDistribution)) {
      globalFn[fn] = (globalFn[fn] || 0) + pct * p.totalBeats;
    }
  }
  const totalGlobalBeats = Object.values(globalFn).reduce((s, v) => s + v, 0);
  const usedFns = Object.entries(globalFn).filter(([, v]) => v > 0);
  const unusedFns = BEAT_FNS.filter(fn => !globalFn[fn] || globalFn[fn] === 0);
  console.log(`Used: ${usedFns.length}/${BEAT_FNS.length}`);
  for (const [fn, count] of usedFns.sort((a, b) => b[1] - a[1])) {
    const works = allProfiles.filter(p => p.beatDistribution[fn] > 0).map(p => p.title.slice(0, 15));
    console.log(`  ${fn.padEnd(14)} ${Math.round(count).toString().padStart(4)} (${Math.round(count / totalGlobalBeats * 100)}%)  found in: ${works.join(', ')}`);
  }
  if (unusedFns.length > 0) console.log(`  UNUSED: ${unusedFns.join(', ')}`);

  console.log('\n── MECHANISM COVERAGE ──');
  const globalMech = {};
  for (const m of MECHANISMS) globalMech[m] = 0;
  for (const p of allProfiles) {
    for (const [m, pct] of Object.entries(p.mechanismDistribution)) {
      globalMech[m] = (globalMech[m] || 0) + pct * p.totalBeats;
    }
  }
  const usedMechs = Object.entries(globalMech).filter(([, v]) => v > 0);
  const unusedMechs = MECHANISMS.filter(m => !globalMech[m] || globalMech[m] === 0);
  console.log(`Used: ${usedMechs.length}/${MECHANISMS.length}`);
  for (const [m, count] of usedMechs.sort((a, b) => b[1] - a[1])) {
    console.log(`  ${m.padEnd(14)} ${Math.round(count).toString().padStart(4)} (${Math.round(count / totalGlobalBeats * 100)}%)`);
  }
  if (unusedMechs.length > 0) console.log(`  UNUSED: ${unusedMechs.join(', ')}`);

  // Markov analysis
  console.log('\n── MARKOV CHAIN ANALYSIS ──');
  console.log('Top universal transitions (appear in 3+ works):');
  const transCount = {};
  const transWorks = {};
  for (const p of allProfiles) {
    for (const [from, tos] of Object.entries(p.markovTransitions)) {
      for (const [to, prob] of Object.entries(tos)) {
        const key = `${from}→${to}`;
        transCount[key] = (transCount[key] || 0) + prob;
        if (!transWorks[key]) transWorks[key] = new Set();
        transWorks[key].add(p.title.slice(0, 12));
      }
    }
  }
  Object.entries(transCount)
    .filter(([k]) => (transWorks[k]?.size || 0) >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([k, v]) => {
      console.log(`  ${k.padEnd(24)} avg_prob: ${(v / allProfiles.length).toFixed(3)}  works: ${[...transWorks[k]].join(', ')}`);
    });

  // Per-work Markov fingerprint
  console.log('\n── WORK FINGERPRINTS (top 3 transitions) ──');
  for (const p of allProfiles) {
    const allTrans = [];
    for (const [from, tos] of Object.entries(p.markovTransitions)) {
      for (const [to, prob] of Object.entries(tos)) {
        allTrans.push({ key: `${from}→${to}`, prob });
      }
    }
    const top3 = allTrans.sort((a, b) => b.prob - a.prob).slice(0, 3);
    console.log(`  ${p.title.slice(0, 35).padEnd(37)} ${top3.map(t => `${t.key}:${(t.prob * 100).toFixed(0)}%`).join('  ')}`);
  }

  // Uniqueness test
  console.log('\n── UNIQUENESS TEST ──');
  console.log('Cosine similarity between beat distributions (lower = more unique):');
  for (let i = 0; i < allProfiles.length; i++) {
    for (let j = i + 1; j < allProfiles.length; j++) {
      const a = allProfiles[i], b = allProfiles[j];
      let dot = 0, magA = 0, magB = 0;
      for (const fn of BEAT_FNS) {
        const va = a.beatDistribution[fn] || 0;
        const vb = b.beatDistribution[fn] || 0;
        dot += va * vb;
        magA += va * va;
        magB += vb * vb;
      }
      const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
      const label = sim > 0.95 ? '(very similar)' : sim > 0.85 ? '(similar)' : sim > 0.70 ? '(distinct)' : '(very distinct)';
      console.log(`  ${a.title.slice(0, 20).padEnd(22)} × ${b.title.slice(0, 20).padEnd(22)} cos=${sim.toFixed(3)} ${label}`);
    }
  }

  // Save combined profiles
  const combinedPath = path.join(OUT_DIR, 'all_profiles.json');
  fs.writeFileSync(combinedPath, JSON.stringify(allProfiles, null, 2));
  console.log(`\nAll profiles → ${combinedPath}`);

  // Sample anchors per work
  console.log('\n── SAMPLE ANCHORS ──');
  for (const p of allProfiles) {
    console.log(`  ${p.title.slice(0, 30)}:`);
    (p.sampleAnchors || []).slice(0, 3).forEach(a => console.log(`    "${a.slice(0, 100)}${a.length > 100 ? '...' : ''}"`));
  }
}

main().catch(console.error);
