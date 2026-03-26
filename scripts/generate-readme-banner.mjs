#!/usr/bin/env node
/**
 * Generate a GitHub README banner image using Replicate's Seedream 4.5 model.
 *
 * Usage:
 *   node scripts/generate-readme-banner.mjs              # generate banner
 *   node scripts/generate-readme-banner.mjs --dry-run    # preview prompt
 *
 * Edit TARGET_WIDTH / TARGET_HEIGHT to set any custom size.
 * Seedream 4.5 supports arbitrary dimensions via width/height params.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "public", "readme-banner.png");

const MODEL = "bytedance/seedream-4.5";
const API_BASE = `https://api.replicate.com/v1/models/${MODEL}/predictions`;
const POLL_INTERVAL = 2000;

// Custom output dimensions — Seedream 4.5 accepts width/height directly
// Seedream min 1024 per dimension — use aspect_ratio instead of width/height
const USE_ASPECT_RATIO = "21:9";

const PROMPT = [
  "Ultra-wide dark banner with vibrant aurora borealis aesthetic.",
  "Abstract flowing curtains of light in vivid emerald green, electric violet, deep magenta, cyan blue, and warm amber,",
  "sweeping across a dark sky background.",
  "Within the aurora, faint luminous nodes and connecting edges suggest a knowledge graph structure — like constellations forming a narrative timeline.",
  "The colours blend and shift like northern lights, creating depth and movement.",
  "Subtle geometric grid on the ground plane reflecting the aurora glow.",
  "Cinematic, ethereal, vibrant, multicolour.",
  "Ultra-wide panoramic banner format.",
  "No text, no letters, no words, no watermarks, no UI elements.",
].join(" ");

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
        aspect_ratio: USE_ASPECT_RATIO,
        output_format: "png",
        output_quality: 95,
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

  console.log(`\n  README Banner Generator`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Aspect: ${USE_ASPECT_RATIO}`);
  console.log(`  Output: ${OUTPUT_PATH}`);
  if (dryRun) console.log(`  Mode: DRY RUN`);
  console.log(`\n  Prompt: ${PROMPT}\n`);

  if (dryRun) {
    console.log("  Dry run complete.");
    return;
  }

  const apiToken = process.env.REPLICATE_API_TOKEN;

  console.log("  Starting prediction...");
  const prediction = await startPrediction(apiToken, PROMPT);
  console.log(`  Prediction ID: ${prediction.id}`);
  console.log("  Polling...");

  const imageUrl = await pollPrediction(apiToken, prediction.id);
  console.log(`  Downloading...`);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  await downloadFile(imageUrl, OUTPUT_PATH);

  const size = fs.statSync(OUTPUT_PATH).size;
  console.log(`  Done: readme-banner.png (${(size / 1024).toFixed(0)} KB)\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
