#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const DEFAULT_RESULTS_DIR = join(ROOT, "scripts/eval-results");
const DEFAULT_INPUT_DIR = join(ROOT, "scripts/eval-inputs");

function parseArgs(argv) {
  const args = {
    inputDir: DEFAULT_INPUT_DIR,
    output: "",
    files: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--input-dir") args.inputDir = resolve(argv[++i]);
    else if (arg === "--output") args.output = resolve(argv[++i]);
    else args.files.push(resolve(arg));
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/render-eval-report.mjs [options] <main.jsonl> [retry.jsonl...]

Options:
  --input-dir <dir>      Fixture dir. Defaults to scripts/eval-inputs
  --output <file>        HTML output file. Defaults beside the main JSONL

The first JSONL is treated as the main run. Later JSONL files are used only to
replace matching errored rows from the main run.
`);
}

function latestJsonlFiles() {
  if (!existsSync(DEFAULT_RESULTS_DIR)) return [];
  return readdirSync(DEFAULT_RESULTS_DIR)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .map((file) => join(DEFAULT_RESULTS_DIR, file));
}

function readJsonl(file) {
  const text = readFileSync(file, "utf8").trim();
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => ({
    ...JSON.parse(line),
    _sourceFile: basename(file),
  }));
}

function keyFor(row) {
  return `${row.modelId}\u0000${row.fixtureId}\u0000${row.run ?? 1}`;
}

function mergeRows(files) {
  const mainRows = readJsonl(files[0]);
  const retryRows = files.slice(1).flatMap(readJsonl).filter((row) => !row.error);
  const retryByKey = new Map(retryRows.map((row) => [keyFor(row), row]));
  return mainRows.map((row) => {
    if (!row.error) return row;
    const retry = retryByKey.get(keyFor(row));
    if (!retry) return row;
    return {
      ...retry,
      _retriedFromError: row.error,
    };
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value) {
  return `$${Number(value || 0).toFixed(6)}`;
}

function ms(value) {
  return `${Math.round(Number(value || 0))}ms`;
}

function loadFixtureMeta(inputDir, outputFile) {
  const meta = new Map();
  const imageQuestionsPath = join(inputDir, "image-questions.json");
  const imageDir = join(inputDir, "images");
  if (existsSync(imageQuestionsPath)) {
    const questions = JSON.parse(readFileSync(imageQuestionsPath, "utf8"));
    for (const item of questions) {
      const fixtureId = basename(item.file, extname(item.file));
      const imagePath = join(imageDir, item.file);
      const src = relative(dirname(outputFile), imagePath).replaceAll("\\", "/");
      meta.set(fixtureId, {
        id: fixtureId,
        file: item.file,
        kind: "image",
        question: item.question || item.context || "",
        src,
      });
    }
  }

  const highlightsPath = join(inputDir, "highlights.json");
  if (existsSync(highlightsPath)) {
    const highlights = JSON.parse(readFileSync(highlightsPath, "utf8"));
    for (const item of highlights) {
      meta.set(item.id, {
        id: item.id,
        kind: "text",
        text: item.text || "",
        question: item.context || "",
      });
    }
  }
  return meta;
}

function percentiles(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const pick = (p) => {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  };
  return { p50: pick(0.5), p90: pick(0.9) };
}

function summarize(rows) {
  const byModel = new Map();
  for (const row of rows) {
    const list = byModel.get(row.modelId) || [];
    list.push(row);
    byModel.set(row.modelId, list);
  }

  return [...byModel.entries()].map(([modelId, list]) => {
    const ok = list.filter((row) => !row.error);
    const avg = (field) => ok.length
      ? ok.reduce((sum, row) => sum + Number(row[field] || 0), 0) / ok.length
      : 0;
    const sum = (field) => ok.reduce((total, row) => total + Number(row[field] || 0), 0);
    const lat = percentiles(ok.map((row) => Number(row.latencyMs || 0)));
    return {
      modelId,
      provider: list.find((row) => row.provider)?.provider || "",
      model: list.find((row) => row.model)?.model || "",
      runs: list.length,
      errors: list.length - ok.length,
      avgLatencyMs: avg("latencyMs"),
      p50LatencyMs: lat.p50,
      p90LatencyMs: lat.p90,
      avgOutputTokens: avg("outputTokens"),
      avgReasoningTokens: avg("reasoningTokens"),
      avgCostUsd: avg("costUsd"),
      totalCostUsd: sum("costUsd"),
      bannedStarts: ok.filter((row) => row.bannedPhraseStart).length,
      refusals: ok.filter((row) => row.refusal).length,
    };
  }).sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);
}

function groupByFixture(rows) {
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.fixtureId) || [];
    list.push(row);
    groups.set(row.fixtureId, list);
  }
  return groups;
}

function renderMetricTable(summary) {
  const rows = summary.map((item) => `
    <tr>
      <td><code>${escapeHtml(item.modelId)}</code></td>
      <td>${escapeHtml(item.provider)}</td>
      <td>${escapeHtml(item.model)}</td>
      <td>${item.runs}</td>
      <td>${item.errors}</td>
      <td>${ms(item.avgLatencyMs)}</td>
      <td>${ms(item.p50LatencyMs)}</td>
      <td>${ms(item.p90LatencyMs)}</td>
      <td>${Math.round(item.avgOutputTokens)}</td>
      <td>${Math.round(item.avgReasoningTokens)}</td>
      <td>${money(item.avgCostUsd)}</td>
      <td>${money(item.totalCostUsd)}</td>
      <td>${item.bannedStarts}</td>
      <td>${item.refusals}</td>
    </tr>`).join("");

  return `<section class="panel">
    <h2>Performance Summary</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Provider</th>
            <th>API model</th>
            <th>Runs</th>
            <th>Errors</th>
            <th>Avg latency</th>
            <th>P50</th>
            <th>P90</th>
            <th>Avg out tok</th>
            <th>Avg think tok</th>
            <th>Avg cost</th>
            <th>Total cost</th>
            <th>Banned</th>
            <th>Refusals</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function renderInput(meta, fixtureId) {
  if (!meta) {
    return `<p class="muted">No fixture metadata found for <code>${escapeHtml(fixtureId)}</code>.</p>`;
  }
  if (meta.kind === "image") {
    return `<div class="input-grid">
      <a href="${escapeHtml(meta.src)}"><img src="${escapeHtml(meta.src)}" alt="${escapeHtml(meta.file)}"></a>
      <div>
        <div class="field-label">File</div>
        <p><code>${escapeHtml(meta.file)}</code></p>
        <div class="field-label">Question</div>
        <p>${escapeHtml(meta.question)}</p>
      </div>
    </div>`;
  }
  return `<div>
    <div class="field-label">Question</div>
    <p>${escapeHtml(meta.question)}</p>
    <div class="field-label">Highlight text</div>
    <pre class="source-text" dir="auto">${escapeHtml(meta.text)}</pre>
  </div>`;
}

function renderResultCard(row) {
  const classes = ["result-card"];
  if (row.error) classes.push("is-error");
  if (row._retriedFromError) classes.push("is-retry");
  const output = row.error || row.output || "[empty output]";
  const tags = [
    row.error ? `<span class="tag bad">error</span>` : `<span class="tag good">ok</span>`,
    row._retriedFromError ? `<span class="tag warn">retried</span>` : "",
    row.bannedPhraseStart ? `<span class="tag bad">banned start</span>` : "",
    row.refusal ? `<span class="tag bad">refusal</span>` : "",
    row.cloudVisionLatencyMs ? `<span class="tag">OCR ${ms(row.cloudVisionLatencyMs)}</span>` : "",
  ].filter(Boolean).join(" ");

  const ocr = row.cloudVisionText
    ? `<details class="ocr"><summary>Cloud Vision OCR text</summary><pre dir="auto">${escapeHtml(row.cloudVisionText)}</pre></details>`
    : "";

  return `<details class="${classes.join(" ")}">
    <summary>
      <span><code>${escapeHtml(row.modelId)}</code></span>
      <span class="summary-metrics">${tags} <b>${ms(row.latencyMs)}</b> ${money(row.costUsd)} ${Number(row.outputTokens || 0)} tok</span>
    </summary>
    <div class="metrics">
      <span><b>API model:</b> <code>${escapeHtml(row.model)}</code></span>
      <span><b>Provider:</b> ${escapeHtml(row.provider)}</span>
      <span><b>Latency:</b> ${ms(row.latencyMs)}</span>
      <span><b>Model latency:</b> ${ms(row.modelLatencyMs)}</span>
      <span><b>Input tokens:</b> ${Number(row.inputTokens || 0)}</span>
      <span><b>Output tokens:</b> ${Number(row.outputTokens || 0)}</span>
      <span><b>Thinking tokens:</b> ${Number(row.reasoningTokens || 0)}</span>
      <span><b>Billable output:</b> ${Number(row.billableOutputTokens || row.outputTokens || 0)}</span>
      <span><b>Total tokens:</b> ${Number(row.totalTokens || 0)}</span>
      <span><b>Cost:</b> ${money(row.costUsd)}</span>
      <span><b>Max output:</b> ${Number(row.maxOutputTokens || 0)}</span>
      <span><b>Stop:</b> ${escapeHtml(row.stopReason || "")}</span>
      <span><b>Prompt:</b> ${escapeHtml(row.promptSource || "")}</span>
      <span><b>Source:</b> ${escapeHtml(row._sourceFile || "")}</span>
    </div>
    ${row._retriedFromError ? `<p class="retry-note">Replaced failed main-run row: ${escapeHtml(row._retriedFromError)}</p>` : ""}
    <pre class="output" dir="auto">${escapeHtml(output)}</pre>
    ${ocr}
  </details>`;
}

function renderFixtures(rows, fixtureMeta) {
  const groups = groupByFixture(rows);
  return [...groups.entries()].map(([fixtureId, list], index) => {
    const meta = fixtureMeta.get(fixtureId);
    const kind = meta?.kind || list[0]?.fixtureKind || "";
    const cards = list.map(renderResultCard).join("");
    return `<section class="fixture" data-fixture="${escapeHtml(fixtureId)}" data-kind="${escapeHtml(kind)}">
      <h2>${index + 1}. ${escapeHtml(fixtureId)} <span>${escapeHtml(kind)}</span></h2>
      ${renderInput(meta, fixtureId)}
      <div class="result-list">${cards}</div>
    </section>`;
  }).join("");
}

function renderHtml({ rows, files, outputFile, inputDir }) {
  const summary = summarize(rows);
  const fixtureMeta = loadFixtureMeta(inputDir, outputFile);
  const totalCost = rows.filter((row) => !row.error).reduce((sum, row) => sum + Number(row.costUsd || 0), 0);
  const fixtures = new Set(rows.map((row) => row.fixtureId));
  const models = new Set(rows.map((row) => row.modelId));
  const errors = rows.filter((row) => row.error).length;
  const retried = rows.filter((row) => row._retriedFromError).length;
  const generated = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Model Eval Report</title>
  <style>
    :root { color-scheme: light; --border:#d7dce2; --muted:#687280; --ink:#15191f; --bg:#f6f7f9; --panel:#fff; --accent:#0f766e; --bad:#b42318; --warn:#9a6700; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--ink); line-height:1.45; }
    header { padding:28px 32px 20px; background:#fff; border-bottom:1px solid var(--border); position:sticky; top:0; z-index:10; }
    h1 { margin:0 0 8px; font-size:26px; }
    h2 { margin:0 0 16px; font-size:20px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; }
    main { max-width:1500px; margin:0 auto; padding:24px 28px 60px; }
    .meta { display:flex; flex-wrap:wrap; gap:10px; color:var(--muted); font-size:14px; }
    .pill { background:#eef2f6; border:1px solid var(--border); border-radius:999px; padding:4px 10px; }
    .controls { display:flex; gap:12px; flex-wrap:wrap; margin-top:16px; }
    .controls input, .controls select { border:1px solid var(--border); border-radius:8px; padding:9px 10px; background:#fff; min-width:220px; }
    .panel, .fixture { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:18px; margin-bottom:18px; }
    .table-wrap { overflow:auto; border:1px solid var(--border); border-radius:8px; }
    table { border-collapse:collapse; width:100%; font-size:13px; background:#fff; }
    th, td { padding:9px 10px; border-bottom:1px solid var(--border); text-align:left; vertical-align:top; white-space:nowrap; }
    th { background:#f0f3f6; font-weight:700; position:sticky; top:0; }
    .input-grid { display:grid; grid-template-columns:minmax(220px, 440px) 1fr; gap:18px; align-items:start; margin-bottom:16px; }
    img { max-width:100%; max-height:520px; object-fit:contain; border:1px solid var(--border); border-radius:8px; background:#fff; }
    .field-label { font-size:12px; text-transform:uppercase; color:var(--muted); font-weight:700; letter-spacing:.04em; margin-top:4px; }
    .source-text, .output, .ocr pre { white-space:pre-wrap; overflow:auto; border:1px solid var(--border); border-radius:8px; background:#fbfcfd; padding:12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:13px; }
    .result-list { display:grid; grid-template-columns:repeat(auto-fit, minmax(420px, 1fr)); gap:12px; }
    .result-card { border:1px solid var(--border); border-radius:8px; background:#fff; }
    .result-card[open] { box-shadow:0 1px 2px rgba(20,30,45,.08); }
    .result-card summary { cursor:pointer; padding:11px 12px; display:flex; justify-content:space-between; gap:12px; align-items:center; }
    .summary-metrics { color:var(--muted); font-size:12px; text-align:right; }
    .metrics { display:flex; flex-wrap:wrap; gap:8px 14px; padding:0 12px 8px; color:var(--muted); font-size:12px; border-top:1px solid #eef1f4; padding-top:10px; }
    .output { margin:0 12px 12px; max-height:420px; }
    .ocr { margin:0 12px 12px; }
    .ocr summary { color:var(--muted); padding:8px 0; justify-content:flex-start; }
    .tag { display:inline-block; border:1px solid var(--border); border-radius:999px; padding:1px 6px; color:var(--muted); background:#f8fafb; }
    .tag.good { color:var(--accent); border-color:#9fd8d1; background:#eefbf8; }
    .tag.bad { color:var(--bad); border-color:#f1b6b0; background:#fff3f1; }
    .tag.warn, .retry-note { color:var(--warn); }
    .retry-note { padding:0 12px; font-size:13px; }
    .fixture h2 span { color:var(--muted); font-size:13px; font-weight:500; }
    .muted { color:var(--muted); }
    @media (max-width:760px) {
      header { position:static; padding:20px; }
      main { padding:16px; }
      .input-grid { grid-template-columns:1fr; }
      .result-list { grid-template-columns:1fr; }
      .result-card summary { display:block; }
      .summary-metrics { display:block; text-align:left; margin-top:6px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Model Eval Report</h1>
    <div class="meta">
      <span class="pill">${rows.length} rows</span>
      <span class="pill">${fixtures.size} fixtures</span>
      <span class="pill">${models.size} models</span>
      <span class="pill">${errors} errors</span>
      <span class="pill">${retried} retried rows</span>
      <span class="pill">${money(totalCost)} clean cost</span>
      <span class="pill">Generated ${escapeHtml(generated)}</span>
    </div>
    <div class="meta" style="margin-top:8px">
      ${files.map((file) => `<span class="pill">${escapeHtml(basename(file))}</span>`).join("")}
    </div>
    <div class="controls">
      <input id="search" type="search" placeholder="Search fixture, question, or output">
      <select id="kind">
        <option value="">All fixture types</option>
        <option value="image">Images</option>
        <option value="text">Text highlights</option>
      </select>
    </div>
  </header>
  <main>
    ${renderMetricTable(summary)}
    ${renderFixtures(rows, fixtureMeta)}
  </main>
  <script>
    const search = document.getElementById('search');
    const kind = document.getElementById('kind');
    function applyFilters() {
      const q = search.value.trim().toLowerCase();
      const k = kind.value;
      for (const section of document.querySelectorAll('.fixture')) {
        const matchesKind = !k || section.dataset.kind === k;
        const matchesSearch = !q || section.textContent.toLowerCase().includes(q);
        section.style.display = matchesKind && matchesSearch ? '' : 'none';
      }
    }
    search.addEventListener('input', applyFilters);
    kind.addEventListener('change', applyFilters);
  </script>
</body>
</html>`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const files = args.files.length ? args.files : latestJsonlFiles();
  if (!files.length) throw new Error("No JSONL result files found.");
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`Result file not found: ${file}`);
  }

  const outputFile = args.output || join(dirname(files[0]), `${basename(files[0], ".jsonl")}-report.html`);
  mkdirSync(dirname(outputFile), { recursive: true });
  const rows = mergeRows(files);
  writeFileSync(outputFile, renderHtml({
    rows,
    files,
    outputFile,
    inputDir: args.inputDir,
  }));
  console.log(`Wrote ${outputFile}`);
}

main();
