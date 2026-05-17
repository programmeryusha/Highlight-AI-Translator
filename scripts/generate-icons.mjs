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
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, "#111827");
  bg.addColorStop(1, "#253141");
  ctx.fillStyle = bg;
  ctx.fill();

  // Highlighted text strip
  ctx.save();
  ctx.translate(size * 0.2, size * 0.68);
  ctx.rotate(-0.13);
  ctx.fillStyle = "#facc15";
  ctx.beginPath();
  ctx.roundRect(0, 0, size * 0.62, size * 0.18, size * 0.04);
  ctx.fill();
  ctx.restore();

  // Lens ring
  const cx = size * 0.48;
  const cy = size * 0.43;
  const r = size * 0.23;
  ctx.lineWidth = Math.max(2, size * 0.085);
  ctx.strokeStyle = "#f8fafc";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Lens handle
  ctx.lineCap = "round";
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = Math.max(2, size * 0.09);
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.62, cy + r * 0.62);
  ctx.lineTo(size * 0.78, size * 0.76);
  ctx.stroke();

  // Small glint suggests "AI read this"
  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.moveTo(size * 0.68, size * 0.18);
  ctx.lineTo(size * 0.72, size * 0.28);
  ctx.lineTo(size * 0.82, size * 0.32);
  ctx.lineTo(size * 0.72, size * 0.36);
  ctx.lineTo(size * 0.68, size * 0.46);
  ctx.lineTo(size * 0.64, size * 0.36);
  ctx.lineTo(size * 0.54, size * 0.32);
  ctx.lineTo(size * 0.64, size * 0.28);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

for (const size of [16, 48, 128]) {
  const canvas = drawIcon(size);
  const buffer = canvas.toBuffer("image/png");
  writeFileSync(join(outDir, `icon${size}.png`), buffer);
  console.log(`✓ icon${size}.png`);
}
