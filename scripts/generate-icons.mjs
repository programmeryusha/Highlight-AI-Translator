import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../public/icons");
mkdirSync(outDir, { recursive: true });

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const s = size / 128; // scale factor

  // Background — rounded rect
  const radius = size * 0.22;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fillStyle = "#1a1a2e";
  ctx.fill();

  // Highlight bar (thick angled stroke) — the "highlighter" motif
  const pad = size * 0.18;
  const barY = size * 0.62;
  const barH = size * 0.13;

  // Purple highlight band across lower portion
  ctx.fillStyle = "#6366f1";
  ctx.beginPath();
  ctx.roundRect(pad, barY, size - pad * 2, barH, barH * 0.4);
  ctx.fill();

  // Letter "H" in white above the bar
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${Math.round(size * 0.42)}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("H", size / 2, size * 0.38);

  return canvas;
}

for (const size of [16, 48, 128]) {
  const canvas = drawIcon(size);
  const buffer = canvas.toBuffer("image/png");
  writeFileSync(join(outDir, `icon${size}.png`), buffer);
  console.log(`✓ icon${size}.png`);
}
