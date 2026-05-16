#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const DEFAULT_INPUT_DIR = join(ROOT, "scripts/eval-inputs");
const DEFAULT_OUTPUT_DIR = join(ROOT, "scripts/eval-results");
const DEFAULT_BACKEND_DIR = resolve(ROOT, "../highlighter-backend");
const DEFAULT_ENV_FILE = join(ROOT, ".env.benchmark");
const BANNED_START = "the user is asking";

function modelRegistry() {
  const bases = [
    {
      id: "gpt-5.5",
      provider: "openai",
      model: process.env.OPENAI_55_MODEL || "gpt-5.5",
      inputPerMillion: Number(process.env.OPENAI_55_INPUT_PER_MTOK || 5),
      outputPerMillion: Number(process.env.OPENAI_55_OUTPUT_PER_MTOK || 30),
      normal: { reasoningEffort: process.env.OPENAI_55_NORMAL_REASONING_EFFORT || "none" },
    },
    {
      id: "gemini-3.1-pro-preview",
      aliases: ["gemini-3.1-pro"],
      provider: "gemini",
      model: process.env.GEMINI_31_PRO_MODEL || "gemini-3.1-pro-preview",
      inputPerMillion: Number(process.env.GEMINI_31_PRO_INPUT_PER_MTOK || 2),
      outputPerMillion: Number(process.env.GEMINI_31_PRO_OUTPUT_PER_MTOK || 12),
      normal: { geminiThinkingLevel: process.env.GEMINI_31_PRO_NORMAL_THINKING_LEVEL || "low" },
    },
    {
      id: "sonnet",
      aliases: ["claude-sonnet-4.6", "claude-sonnet-4-6"],
      provider: "anthropic",
      model: process.env.ANTHROPIC_SONNET_MODEL || "claude-sonnet-4-6",
      inputPerMillion: Number(process.env.ANTHROPIC_SONNET_INPUT_PER_MTOK || 3),
      outputPerMillion: Number(process.env.ANTHROPIC_SONNET_OUTPUT_PER_MTOK || 15),
    },
    {
      id: "opus",
      aliases: ["claude-opus-4.7", "claude-opus-4-7"],
      provider: "anthropic",
      model: process.env.ANTHROPIC_OPUS_MODEL || "claude-opus-4-7",
      inputPerMillion: Number(process.env.ANTHROPIC_OPUS_INPUT_PER_MTOK || 5),
      outputPerMillion: Number(process.env.ANTHROPIC_OPUS_OUTPUT_PER_MTOK || 25),
    },
  ];

  const variants = [];
  for (const base of bases) {
    const { normal = {}, ...shared } = base;
    variants.push({ ...shared, id: shared.id, variant: "normal", ...normal });
    variants.push({ ...shared, id: `${shared.id}-cloud-vision`, variant: "cloud-vision", cloudVision: true, ...normal });
  }
  return variants;
}

function modelLookupIds(model) {
  return [model.id, ...(model.aliases || [])];
}

function parseArgs(argv) {
  const args = {
    inputDir: DEFAULT_INPUT_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    backendDir: DEFAULT_BACKEND_DIR,
    envFile: DEFAULT_ENV_FILE,
    envFileExplicit: false,
    promptFile: "",
    only: "",
    limit: 0,
    repeat: 1,
    shuffle: false,
    maxOutputTokens: 350,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--input-dir") args.inputDir = resolve(argv[++i]);
    else if (arg === "--output-dir") args.outputDir = resolve(argv[++i]);
    else if (arg === "--backend-dir") args.backendDir = resolve(argv[++i]);
    else if (arg === "--env-file") {
      args.envFile = resolve(argv[++i]);
      args.envFileExplicit = true;
    }
    else if (arg === "--prompt-file") args.promptFile = resolve(argv[++i]);
    else if (arg === "--only") args.only = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--repeat") args.repeat = Number(argv[++i]);
    else if (arg === "--shuffle") args.shuffle = true;
    else if (arg === "--max-output-tokens") args.maxOutputTokens = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/model-benchmark.mjs [options]

Options:
  --input-dir <dir>           Fixture dir. Defaults to scripts/eval-inputs
  --output-dir <dir>          Result dir. Defaults to scripts/eval-results
  --backend-dir <dir>         Backend dir to import production prompts from
  --env-file <file>           Key file. Defaults to .env.benchmark if present
  --prompt-file <file>        Override backend prompts for deliberate experiments
  --only <ids>                Comma-separated model ids to run
  --limit <n>                 Limit number of fixtures after optional shuffle
  --repeat <n>                Repeat each model/fixture n times
  --shuffle                   Randomize fixture order
  --max-output-tokens <n>     Defaults to 350

Model ids:
  ${modelRegistry().map((model) => model.id).join(", ")}
Aliases:
  ${modelRegistry()
    .flatMap((model) => (model.aliases || []).map((alias) => `${alias} -> ${model.id}`))
    .join(", ") || "none"}

Required env:
  ANTHROPIC_API_KEY for Sonnet/Opus
  OPENAI_API_KEY for OpenAI models
  GEMINI_API_KEY for Gemini
  Google Cloud ADC for Cloud Vision, or GOOGLE_OAUTH_ACCESS_TOKEN

Key file:
  Create ${DEFAULT_ENV_FILE} with KEY=value lines. Existing shell env wins.

Prompt source:
  Defaults to importing RESPONSE_STYLE, text_prompt, and image_prompt from:
  ${DEFAULT_BACKEND_DIR}/routes/explain.py

Fixture files:
  screenshots: scripts/eval-inputs/images/*.png|jpg|jpeg|webp
  questions:   scripts/eval-inputs/image-questions.json
  highlights:   scripts/eval-inputs/highlights.json

By default, + Cloud Vision variants send OCR text only to the LLM. Set
SEND_IMAGE_WITH_CLOUD_VISION=1 to send both OCR text and the original image.
`);
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(file, required = false) {
  if (!existsSync(file)) {
    if (required) throw new Error(`Env file not found: ${file}`);
    return 0;
  }

  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let loaded = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq === -1) continue;
    const key = normalized.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(normalized.slice(eq + 1));
    loaded += 1;
  }
  return loaded;
}

function mediaType(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function loadFixtures(inputDir) {
  const fixtures = [];
  const imageQuestionsPath = join(inputDir, "image-questions.json");
  const imageQuestions = existsSync(imageQuestionsPath)
    ? JSON.parse(readFileSync(imageQuestionsPath, "utf8"))
    : [];
  const questionByFile = new Map(imageQuestions.map((item) => [item.file, item]));
  const questionById = new Map(imageQuestions.map((item) => [item.id, item]));
  const imageDir = join(inputDir, "images");
  if (existsSync(imageDir)) {
    for (const file of readdirSync(imageDir)) {
      if (!/\.(png|jpe?g|webp)$/i.test(file)) continue;
      const path = join(imageDir, file);
      const id = basename(file, extname(file));
      const metadata = questionByFile.get(file) || questionById.get(id) || {};
      fixtures.push({
        id,
        kind: "image",
        path,
        file,
        mimeType: mediaType(file),
        base64: readFileSync(path).toString("base64"),
        context: metadata.question || metadata.context || "",
      });
    }
  }

  const highlightsPath = join(inputDir, "highlights.json");
  if (existsSync(highlightsPath)) {
    const highlights = JSON.parse(readFileSync(highlightsPath, "utf8"));
    for (const [index, item] of highlights.entries()) {
      fixtures.push({
        id: item.id || `highlight-${index + 1}`,
        kind: "text",
        text: String(item.text || ""),
        context: String(item.context || ""),
      });
    }
  }

  return fixtures;
}

function inputPreview(fixture) {
  if (fixture.kind === "image") return `${fixture.file} (${fixture.mimeType})`;
  return fixture.text.replace(/\s+/g, " ").slice(0, 240);
}

function makePrompt(basePrompt, fixture, ocrText = "") {
  const parts = [basePrompt];
  if (ocrText) {
    parts.push(`OCR text from Google Cloud Vision:\n${ocrText}`);
    parts.push("Use the OCR text as the source of truth. If the image and OCR disagree, mention uncertainty briefly.");
  }
  if (fixture.kind === "text") parts.push(`Selected text:\n${fixture.text}`);
  if (fixture.context) parts.push(`User question/context:\n${fixture.context}`);
  return parts.join("\n\n");
}

function productionPromptPayload(fixture, ocrText = "") {
  if (ocrText) {
    return {
      kind: "text",
      text: ocrText,
      context: fixture.context || "",
    };
  }

  if (fixture.kind === "image") {
    return {
      kind: "image",
      text: "",
      context: fixture.context || "",
    };
  }

  return {
    kind: "text",
    text: fixture.text || "",
    context: fixture.context || "",
  };
}

function loadProductionPrompt(fixture, ocrText, backendDir) {
  const payload = {
    backend_dir: backendDir,
    ...productionPromptPayload(fixture, ocrText),
  };

  const script = `
import json
import sys

payload = json.load(sys.stdin)
sys.path.insert(0, payload["backend_dir"])

from routes.explain import RESPONSE_STYLE, image_prompt, text_prompt

if payload["kind"] == "image":
    prompt = image_prompt(payload.get("context", ""))
else:
    prompt = text_prompt(payload.get("text", ""), payload.get("context", ""))

json.dump({"prompt": prompt, "system": RESPONSE_STYLE}, sys.stdout)
`;

  try {
    return JSON.parse(execFileSync("python3", ["-c", script], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }));
  } catch (error) {
    const detail = error?.stderr?.toString?.() || error?.message || String(error);
    throw new Error(`Could not import production prompt from ${backendDir}/routes/explain.py: ${detail}`);
  }
}

function extractAnthropicText(data) {
  return (data.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function extractOpenAIText(data) {
  if (data.output_text) return data.output_text.trim();
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function extractGeminiText(data) {
  return (data.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("\n")
    .trim();
}

function extractQwenText(data) {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => part.text || part.content || "")
      .join("\n")
      .trim();
  }
  return "";
}

function costFromTokens(usage, model) {
  if (Number.isFinite(usage.cost_usd)) return usage.cost_usd;
  const inputTokens = usage.billable_input_tokens ?? usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.billable_output_tokens ?? usage.output_tokens ?? usage.completion_tokens ?? 0;
  return ((inputTokens * model.inputPerMillion) + (outputTokens * model.outputPerMillion)) / 1_000_000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(res, bodyText) {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;

  const match = bodyText.match(/retry in ([\d.]+)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000);

  return 60_000;
}

async function requestJson(url, init, attempts = 3) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (res.status === 429 && attempts > 1) {
    await sleep(retryDelayMs(res, text));
    return requestJson(url, init, attempts - 1);
  }
  if (!res.ok) {
    const detail = data.error?.message || data.error || text || `${res.status}`;
    throw new Error(`${res.status} ${res.statusText}: ${String(detail).slice(0, 500)}`);
  }
  return data;
}

async function callAnthropic(model, fixture, prompt, systemPrompt, maxOutputTokens) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  const content = [{ type: "text", text: prompt }];
  if (fixture.kind === "image") {
    content.unshift({
      type: "image",
      source: { type: "base64", media_type: fixture.mimeType, data: fixture.base64 },
    });
  }
  const body = {
    model: model.model,
    max_tokens: maxOutputTokens,
    messages: [{ role: "user", content }],
  };
  if (systemPrompt) body.system = systemPrompt;
  if (model.anthropicThinking) {
    body.thinking = {
      type: "adaptive",
      display: process.env.ANTHROPIC_THINKING_DISPLAY || "omitted",
    };
    body.output_config = { effort: model.anthropicEffort || "high" };
  }

  const data = await requestJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  return {
    output: extractAnthropicText(data),
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    },
    stopReason: data.stop_reason,
  };
}

async function callOpenAI(model, fixture, prompt, systemPrompt, maxOutputTokens) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const content = [{ type: "input_text", text: prompt }];
  if (fixture.kind === "image") {
    content.push({ type: "input_image", image_url: `data:${fixture.mimeType};base64,${fixture.base64}` });
  }
  const input = [];
  if (systemPrompt) {
    input.push({ role: "system", content: [{ type: "input_text", text: systemPrompt }] });
  }
  input.push({ role: "user", content });

  const body = {
    model: model.model,
    input,
    max_output_tokens: maxOutputTokens,
  };
  if (model.reasoningEffort) {
    body.reasoning = {
      effort: model.reasoningEffort,
    };
  }

  const data = await requestJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return {
    output: extractOpenAIText(data),
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      reasoning_tokens: data.usage?.output_tokens_details?.reasoning_tokens ?? 0,
      total_tokens: data.usage?.total_tokens ?? 0,
    },
    stopReason: data.status,
  };
}

async function callGemini(model, fixture, prompt, systemPrompt, maxOutputTokens) {
  if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
  const requestDelayMs = Number(process.env.GEMINI_REQUEST_DELAY_MS || 0);
  if (requestDelayMs > 0) await sleep(requestDelayMs);

  const parts = [{ text: prompt }];
  if (fixture.kind === "image") {
    parts.unshift({ inlineData: { mimeType: fixture.mimeType, data: fixture.base64 } });
  }
  const generationConfig = {
    maxOutputTokens,
    responseMimeType: "text/plain",
  };
  if (model.geminiThinkingLevel) {
    generationConfig.thinkingConfig = {
      thinkingLevel: model.geminiThinkingLevel,
    };
  } else if (process.env.GEMINI_THINKING_BUDGET !== "default") {
    generationConfig.thinkingConfig = {
      thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET ?? 0),
    };
  }
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig,
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const data = await requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    output: extractGeminiText(data),
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      thoughts_tokens: data.usageMetadata?.thoughtsTokenCount ?? 0,
      billable_output_tokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
      total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
    },
    stopReason: data.candidates?.[0]?.finishReason,
  };
}

function qwenApiKey() {
  return process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || "";
}

async function callQwen(model, fixture, prompt, systemPrompt, maxOutputTokens) {
  const apiKey = qwenApiKey();
  if (!apiKey) throw new Error("Missing DASHSCOPE_API_KEY or QWEN_API_KEY");
  const requestDelayMs = Number(process.env.QWEN_REQUEST_DELAY_MS || 0);
  if (requestDelayMs > 0) await sleep(requestDelayMs);

  const content = [];
  if (fixture.kind === "image") {
    content.push({
      type: "image_url",
      image_url: { url: `data:${fixture.mimeType};base64,${fixture.base64}` },
    });
  }
  content.push({ type: "text", text: prompt });

  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content });

  const body = {
    model: model.model,
    messages,
    max_tokens: maxOutputTokens,
    enable_thinking: process.env.QWEN_ENABLE_THINKING === "1",
  };
  const baseUrl = process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  const data = await requestJson(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const outputTokens = data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0;
  const inputTokens = data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0;
  return {
    output: extractQwenText(data),
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      reasoning_tokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      total_tokens: data.usage?.total_tokens ?? inputTokens + outputTokens,
    },
    stopReason: data.choices?.[0]?.finish_reason,
  };
}

async function callOpenRouter(model, fixture, prompt, systemPrompt, maxOutputTokens) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY");
  const requestDelayMs = Number(process.env.OPENROUTER_REQUEST_DELAY_MS || 0);
  if (requestDelayMs > 0) await sleep(requestDelayMs);

  const content = [];
  if (fixture.kind === "image") {
    content.push({
      type: "image_url",
      image_url: { url: `data:${fixture.mimeType};base64,${fixture.base64}` },
    });
  }
  content.push({ type: "text", text: prompt });

  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content });

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
  };
  if (process.env.OPENROUTER_HTTP_REFERER) headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER;
  if (process.env.OPENROUTER_APP_TITLE) headers["X-Title"] = process.env.OPENROUTER_APP_TITLE;

  const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const data = await requestJson(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model.model,
      messages,
      max_tokens: maxOutputTokens,
    }),
  });
  const outputTokens = data.usage?.completion_tokens ?? 0;
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  return {
    output: extractQwenText(data),
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      reasoning_tokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      cost_usd: data.usage?.cost ?? data.usage?.total_cost ?? data.usage?.cost_usd ?? data.usage?.total_cost_usd,
      total_tokens: data.usage?.total_tokens ?? inputTokens + outputTokens,
    },
    stopReason: data.choices?.[0]?.finish_reason,
  };
}

function getGoogleAccessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  return execFileSync("gcloud", ["auth", "application-default", "print-access-token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getGoogleQuotaProject() {
  if (process.env.GOOGLE_CLOUD_QUOTA_PROJECT) return process.env.GOOGLE_CLOUD_QUOTA_PROJECT;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;

  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    join(process.env.HOME || "", ".config/gcloud/application_default_credentials.json");
  if (!existsSync(adcPath)) return "";

  try {
    const adc = JSON.parse(readFileSync(adcPath, "utf8"));
    return adc.quota_project_id || adc.project_id || "";
  } catch {
    return "";
  }
}

async function callCloudVision(fixture) {
  if (fixture.kind !== "image") return { text: "", latencyMs: 0, costUsd: 0 };
  const start = performance.now();
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${getGoogleAccessToken()}`,
  };
  const quotaProject = getGoogleQuotaProject();
  if (quotaProject) headers["x-goog-user-project"] = quotaProject;

  const data = await requestJson("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers,
    body: JSON.stringify({
      requests: [{
        image: { content: fixture.base64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        imageContext: { languageHints: ["ar", "en"] },
      }],
    }),
  });
  const latencyMs = Math.round(performance.now() - start);
  const response = data.responses?.[0] || {};
  if (response.error) throw new Error(response.error.message || JSON.stringify(response.error));
  return {
    text: response.fullTextAnnotation?.text || "",
    latencyMs,
    costUsd: Number(process.env.CLOUD_VISION_OCR_COST_PER_IMAGE || 0.0015),
  };
}

async function callModel(model, fixture, prompt, systemPrompt, maxOutputTokens) {
  const modelFixture = model.cloudVision && process.env.SEND_IMAGE_WITH_CLOUD_VISION !== "1"
    ? { ...fixture, kind: "text", text: "" }
    : fixture;
  if (model.provider === "anthropic") return callAnthropic(model, modelFixture, prompt, systemPrompt, maxOutputTokens);
  if (model.provider === "openai") return callOpenAI(model, modelFixture, prompt, systemPrompt, maxOutputTokens);
  if (model.provider === "gemini") return callGemini(model, modelFixture, prompt, systemPrompt, maxOutputTokens);
  if (model.provider === "qwen") return callQwen(model, modelFixture, prompt, systemPrompt, maxOutputTokens);
  if (model.provider === "openrouter") return callOpenRouter(model, modelFixture, prompt, systemPrompt, maxOutputTokens);
  throw new Error(`Unsupported provider: ${model.provider}`);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function summarize(results) {
  const byModel = new Map();
  for (const result of results) {
    const list = byModel.get(result.modelId) || [];
    list.push(result);
    byModel.set(result.modelId, list);
  }

  const lines = ["# Model Benchmark Results", ""];
  lines.push("| Model | Runs | Errors | Refusals | Banned starts | Avg latency | Avg output tokens | Avg cost |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const [modelId, list] of byModel) {
    const ok = list.filter((item) => !item.error);
    const avg = (field) => ok.length ? ok.reduce((sum, item) => sum + (item[field] || 0), 0) / ok.length : 0;
    lines.push([
      modelId,
      list.length,
      list.filter((item) => item.error).length,
      ok.filter((item) => item.refusal).length,
      ok.filter((item) => item.bannedPhraseStart).length,
      `${Math.round(avg("latencyMs"))}ms`,
      Math.round(avg("outputTokens")),
      `$${avg("costUsd").toFixed(6)}`,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  lines.push("", "## Inputs And Outputs", "");
  for (const result of results) {
    lines.push(`### ${result.modelId} / ${result.fixtureId} / run ${result.run}`);
    lines.push("");
    lines.push(`- Input: ${result.inputPreview}`);
    lines.push(`- Latency: ${result.latencyMs ?? 0}ms`);
    lines.push(`- Output tokens: ${result.outputTokens ?? 0}`);
    lines.push(`- Cost: $${(result.costUsd ?? 0).toFixed(6)}`);
    lines.push(`- Banned phrase start: ${result.bannedPhraseStart ? "yes" : "no"}`);
    lines.push(`- Refusal/error: ${result.refusal || result.error ? "yes" : "no"}`);
    if (result.error) {
      lines.push("", "```text", result.error, "```", "");
    } else {
      lines.push("", "```text", result.output || "[empty output]", "```", "");
    }
    if (result.cloudVisionText) {
      lines.push("<details><summary>Cloud Vision OCR text</summary>", "", "```text", result.cloudVisionText, "```", "", "</details>", "");
    }
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const loadedEnvCount = loadEnvFile(args.envFile, args.envFileExplicit);
  if (loadedEnvCount > 0) {
    console.log(`Loaded ${loadedEnvCount} values from ${args.envFile}`);
  }

  const customPrompt = args.promptFile ? readFileSync(args.promptFile, "utf8") : "";
  let fixtures = loadFixtures(args.inputDir);
  if (args.shuffle) fixtures = shuffle(fixtures);
  if (args.limit > 0) fixtures = fixtures.slice(0, args.limit);
  if (fixtures.length === 0) {
    throw new Error(`No fixtures found. Add images to ${join(args.inputDir, "images")} or highlights.json.`);
  }

  const allModels = modelRegistry();
  const selectedIds = new Set(args.only ? args.only.split(",").map((item) => item.trim()) : allModels.map((model) => model.id));
  const models = allModels.filter((model) => modelLookupIds(model).some((id) => selectedIds.has(id)));
  if (models.length === 0) throw new Error(`No matching models for --only=${args.only}`);

  mkdirSync(args.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonlPath = join(args.outputDir, `${stamp}.jsonl`);
  const mdPath = join(args.outputDir, `${stamp}.md`);
  const results = [];

  for (const fixture of fixtures) {
    for (const model of models) {
      for (let run = 1; run <= args.repeat; run += 1) {
        const base = {
          timestamp: new Date().toISOString(),
          fixtureId: fixture.id,
          fixtureKind: fixture.kind,
          inputPreview: inputPreview(fixture),
          modelId: model.id,
          provider: model.provider,
          model: model.model,
          run,
        };
        console.log(`Running ${model.id} on ${fixture.id} (${run}/${args.repeat})`);
        try {
          const ocr = model.cloudVision ? await callCloudVision(fixture) : { text: "", latencyMs: 0, costUsd: 0 };
          const productionPrompt = loadProductionPrompt(fixture, ocr.text, args.backendDir);
          const modelPrompt = customPrompt ? makePrompt(customPrompt, fixture, ocr.text) : productionPrompt.prompt;
          const promptSource = customPrompt
            ? args.promptFile
            : ocr.text
              ? "backend:text_prompt(cloud-vision-ocr, context)"
              : fixture.kind === "image"
                ? "backend:image_prompt(context)"
                : "backend:text_prompt(text, context)";
          const start = performance.now();
          const requestMaxOutputTokens = model.deepThinking
            ? Math.max(args.maxOutputTokens, Number(process.env.DEEP_THINKING_MAX_OUTPUT_TOKENS || 1600))
            : args.maxOutputTokens;
          const response = await callModel(model, fixture, modelPrompt, productionPrompt.system, requestMaxOutputTokens);
          const modelLatencyMs = Math.round(performance.now() - start);
          const output = response.output || "";
          const lower = output.trimStart().toLowerCase();
          const usageCostUsd = costFromTokens(response.usage, model);
          const result = {
            ...base,
            latencyMs: modelLatencyMs + ocr.latencyMs,
            modelLatencyMs,
            cloudVisionLatencyMs: ocr.latencyMs,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
            reasoningTokens: response.usage.reasoning_tokens ?? response.usage.thoughts_tokens ?? 0,
            billableOutputTokens: response.usage.billable_output_tokens ?? response.usage.output_tokens,
            costUsd: usageCostUsd + ocr.costUsd,
            modelCostUsd: usageCostUsd,
            cloudVisionCostUsd: ocr.costUsd,
            bannedPhraseStart: lower.startsWith(BANNED_START),
            refusal: /\b(i can'?t|i cannot|sorry|unable to assist|i'm unable)\b/i.test(output),
            stopReason: response.stopReason,
            maxOutputTokens: requestMaxOutputTokens,
            promptSource,
            output,
            cloudVisionText: ocr.text,
          };
          results.push(result);
          writeFileSync(jsonlPath, `${results.map((item) => JSON.stringify(item)).join("\n")}\n`);
        } catch (error) {
          const result = {
            ...base,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            bannedPhraseStart: false,
            refusal: false,
            error: error instanceof Error ? error.message : String(error),
          };
          results.push(result);
          writeFileSync(jsonlPath, `${results.map((item) => JSON.stringify(item)).join("\n")}\n`);
        }
      }
    }
  }

  writeFileSync(mdPath, summarize(results));
  console.log(`\nWrote ${jsonlPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
