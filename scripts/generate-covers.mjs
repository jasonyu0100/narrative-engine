#!/usr/bin/env node
/**
 * Generate cover photos for seed narratives using Replicate's Seedream 4.5 model.
 *
 * Usage:
 *   node scripts/generate-covers.mjs                  # generate all
 *   node scripts/generate-covers.mjs --seed got       # one seed only
 *   node scripts/generate-covers.mjs --dry-run        # preview prompts
 *
 * Images are saved to public/covers/<seed-id>.jpg and referenced in seed data files.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "covers");

const MODEL = "bytedance/seedream-4.5";
const API_BASE = `https://api.replicate.com/v1/models/${MODEL}/predictions`;
const POLL_INTERVAL = 2000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

// ── Cover prompts per seed narrative ─────────────────────────────────────────

const COVERS = [
  {
    id: "N-GOT",
    slug: "got",
    title: "A Game of Thrones — Season One",
    style:
      "Dark medieval fantasy, gritty realism, cinematic lighting, muted desaturated palette, HBO-inspired,",
    prompt:
      "epic book cover art, the Iron Throne made of a thousand melted swords in a vast dark stone throne room, shafts of golden light cutting through dust, wolf and lion and dragon heraldry banners hanging from the walls, a crown lying abandoned on the steps, political intrigue and betrayal atmosphere, dramatic chiaroscuro, no text no letters no words no watermarks",
  },
  {
    id: "N-LOTR",
    slug: "lotr",
    title: "The Lord of the Rings — The Fellowship of the Ring",
    style:
      "Epic high-fantasy oil painting style, dramatic lighting, rich earth tones, inspired by Alan Lee and John Howe,",
    prompt:
      "epic book cover art, nine silhouetted travelers walking along a mountain ridge at sunset, a glowing golden ring hovering above them casting long shadows, misty mountains stretching into the distance, ancient forests below, a dark tower with a fiery eye barely visible on the far horizon, epic scale and grandeur, no text no letters no words no watermarks",
  },
  {
    id: "N-HP",
    slug: "hp",
    title: "Harry Potter and the Philosopher's Stone",
    style:
      "Magical fantasy illustration, warm golden light mixed with mysterious shadows, painterly style,",
    prompt:
      "epic book cover art, a magnificent Gothic castle with many towers and turrets perched on a cliff above a dark lake at night, warm golden light pouring from hundreds of windows, a full moon behind the tallest tower, an owl flying across the moon, magical aurora in the starry sky, enchanted and wondrous atmosphere, no text no letters no words no watermarks",
  },
  {
    id: "N-SW",
    slug: "sw",
    title: "Star Wars — A New Hope",
    style:
      "Cinematic sci-fi art, dramatic rim lighting, cool blue and warm orange contrast, concept art style,",
    prompt:
      "epic movie poster art, a young hero silhouette holding an ignited blue lightsaber upward against a massive Death Star space station in the sky, twin suns setting on the desert horizon, X-wing fighters streaking across the sky, a towering dark armored villain faintly visible in the stars above, hope against tyranny, no text no letters no words no watermarks",
  },
  {
    id: "N-RI",
    slug: "ri",
    title: "Reverend Insanity — Rebirth of the Demon Venerable",
    style:
      "Chinese xianxia fantasy painting, ink wash undertones, dramatic qi energy effects, dark and atmospheric,",
    prompt:
      "epic book cover art, a cold-eyed young cultivator standing on a misty mountain peak looking down at the world below, dark robes billowing in wind, spectral Gu worms orbiting his hands with faint golden glow, a translucent cicada spirit visible behind him like a ghost of his past life, bamboo forests and ancient clan buildings far below in the valley, ominous and calculating atmosphere, no text no letters no words no watermarks",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startPrediction(apiToken, prompt) {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        prompt,
        num_outputs: 1,
        aspect_ratio: "3:4",
        output_format: "jpg",
        output_quality: 90,
      },
    }),
  });
  const data = await res.json();
  if (!data.id) {
    throw new Error(`Failed to start prediction: ${JSON.stringify(data)}`);
  }
  return data;
}

async function pollPrediction(apiToken, predictionId) {
  while (true) {
    const res = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    const data = await res.json();

    if (data.status === "succeeded") {
      if (data.output && data.output.length > 0) {
        return data.output[0];
      }
      throw new Error("Prediction succeeded but no output URL");
    } else if (data.status === "failed") {
      throw new Error(`Prediction failed: ${data.error}`);
    } else if (data.status === "canceled") {
      throw new Error("Prediction was canceled");
    }

    await sleep(POLL_INTERVAL);
  }
}

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buffer);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const seedFilter = args.includes("--seed")
    ? args[args.indexOf("--seed") + 1]
    : null;
  const dryRun = args.includes("--dry-run");

  // Load API token
  if (!dryRun && !process.env.REPLICATE_API_TOKEN) {
    for (const envFile of [".env.local", ".env"]) {
      const envPath = path.join(ROOT, envFile);
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf-8");
        for (const line of envContent.split("\n")) {
          const match = line.match(/^(\w+)=(.+)$/);
          if (match) process.env[match[1]] = match[2].trim();
        }
        break;
      }
    }
    if (!process.env.REPLICATE_API_TOKEN) {
      console.error(
        "Error: REPLICATE_API_TOKEN not set. Add it to .env.local or export it."
      );
      process.exit(1);
    }
  }

  const apiToken = process.env.REPLICATE_API_TOKEN;

  // Build task list
  const tasks = COVERS.filter(
    (c) => !seedFilter || c.slug === seedFilter
  ).map((c) => ({
    ...c,
    fullPrompt: `${c.style} ${c.prompt}`,
    outputPath: path.join(OUT_DIR, `${c.slug}.jpg`),
  }));

  console.log(`\n  Seedream 4.5 Cover Generator`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Aspect: 3:4`);
  console.log(`   Format: PNG`);
  console.log(`   Tasks: ${tasks.length} covers`);
  if (seedFilter) console.log(`   Filter: ${seedFilter}`);
  if (dryRun) console.log(`   Mode: DRY RUN`);
  console.log("");

  // Create output directory
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (dryRun) {
    for (const task of tasks) {
      console.log(`[${task.slug}] ${task.title}`);
      console.log(`  Prompt: ${task.fullPrompt}`);
      console.log(`  Output: ${task.outputPath}\n`);
    }
    console.log(`Dry run complete. ${tasks.length} covers would be generated.`);
    return;
  }

  // Filter out already-existing files
  const pending = tasks.filter((task) => {
    if (fs.existsSync(task.outputPath)) {
      console.log(`  Skipping (exists): ${task.slug}.jpg`);
      return false;
    }
    return true;
  });

  if (pending.length === 0) {
    console.log("All covers already exist. Nothing to generate.");
    return;
  }

  console.log(
    `  ${tasks.length - pending.length} skipped (already exist), ${pending.length} to generate\n`
  );

  let completed = 0;
  let failed = 0;
  const errors = [];

  // Process sequentially to avoid rate limits (burst of 1 on low-credit accounts)
  for (const task of pending) {
    let success = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`  Retry ${attempt}/${MAX_RETRIES}: ${task.slug}`);
        } else {
          console.log(`  Starting: ${task.slug} — "${task.title}"`);
        }

        const prediction = await startPrediction(apiToken, task.fullPrompt);
        console.log(`  ${task.slug} -> prediction ${prediction.id}`);

        const imageUrl = await pollPrediction(apiToken, prediction.id);
        await downloadFile(imageUrl, task.outputPath);

        const size = fs.statSync(task.outputPath).size;
        if (size === 0) {
          fs.unlinkSync(task.outputPath);
          throw new Error("Downloaded file is empty (0 bytes)");
        }

        console.log(
          `  Done: ${task.slug}.jpg (${(size / 1024 / 1024).toFixed(1)} MB)`
        );
        completed++;
        success = true;
        break;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          console.warn(
            `  ${task.slug} attempt ${attempt} failed: ${err.message}`
          );
          await sleep(RETRY_DELAY * attempt);
        } else {
          failed++;
          errors.push({ task, error: err.message });
          console.error(`  FAILED: ${task.slug} — ${err.message}`);
        }
      }
    }
    // Pause between covers to respect rate limits
    if (success && pending.indexOf(task) < pending.length - 1) {
      console.log(`  Waiting 12s before next cover...\n`);
      await sleep(12000);
    }
  }

  console.log(`\n  Done! ${completed} generated, ${failed} failed`);
  if (errors.length > 0) {
    console.log(`\n  Failures:`);
    for (const { task, error } of errors) {
      console.log(`    - ${task.slug}: ${error}`);
    }
  }

  // Print the coverImageUrl values to add to seed files
  if (completed > 0) {
    console.log(`\n  Add to seed data files:`);
    for (const task of tasks) {
      if (fs.existsSync(task.outputPath)) {
        console.log(`    ${task.id}: coverImageUrl: '/covers/${task.slug}.jpg'`);
      }
    }
  }
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
