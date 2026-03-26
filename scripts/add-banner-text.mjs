#!/usr/bin/env node
/**
 * Overlay "NARRATIVE ENGINE" text on the readme banner.
 * Uses sharp (already installed via Next.js).
 */

import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(__dirname, "..", "public", "readme-banner.png");
const OUTPUT = INPUT; // overwrite

const TEXT = "NARRATIVE ENGINE";
const SUBTEXT = "V1.1";
const FONT_SIZE = 120;
const PADDING_RIGHT = 80;
const PADDING_BOTTOM = 60;

async function main() {
  const image = sharp(INPUT);
  const { width, height } = await image.metadata();

  // Create SVG text overlay
  const svg = `<svg width="${width}" height="${height}">
    <style>
      .title {
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: ${FONT_SIZE}px;
        font-weight: 700;
        letter-spacing: 0.15em;
        fill: white;
        opacity: 0.9;
      }
      .sub {
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: ${Math.round(FONT_SIZE * 0.35)}px;
        font-weight: 500;
        letter-spacing: 0.25em;
        fill: white;
        opacity: 0.5;
      }
    </style>
    <text
      x="${width - PADDING_RIGHT}"
      y="${height - PADDING_BOTTOM}"
      text-anchor="end"
      class="title"
    >${TEXT} <tspan class="sub">${SUBTEXT}</tspan></text>
  </svg>`;

  await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer()
    .then((buf) => sharp(buf).png().toFile(OUTPUT));

  console.log(`  Done: added "${TEXT}" to banner (${width}x${height})`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
