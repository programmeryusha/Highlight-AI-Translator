# Model Benchmark Inputs

Drop screenshot fixtures into:

```text
scripts/eval-inputs/images/
```

Supported image types are PNG, JPG/JPEG, and WebP.

The current screenshot questions expect these filenames:

```text
youtube-comments-covid-1.png
youtube-comments-dialect-2.png
youtube-comments-replies-3.png
youtube-comments-virus-4.png
youtube-comments-fake-news-5.png
youtube-comments-replies-6.png
youtube-search-france24-7.png
youtube-search-missile-8.png
linkedin-milestone-9.png
linkedin-internship-10.png
poetry.png
stories.png
stories_2.png
kaleela.png
kaleela_2.png
huroof.png
trip.png
trip_2.png
labeed.png
```

Each screenshot's question/context is stored in:

```text
scripts/eval-inputs/image-questions.json
```

For text-highlight fixtures, create:

```text
scripts/eval-inputs/highlights.json
```

Example:

```json
[
  {
    "id": "youtube-algerian-comment",
    "text": "بس كلام فاضي. أنتم هنود تصدقوا. كفاية كذبة كورونا",
    "context": "Translate this YouTube comment naturally."
  }
]
```

The benchmark script leaves the extension source untouched.

For local API keys, copy the example file and fill in the real values:

```bash
cp .env.benchmark.example .env.benchmark
```

The benchmark loads `.env.benchmark` automatically if it exists. Existing shell
environment variables take priority over values in the file.

Qwen Cloud uses a DashScope API key. Put it in `.env.benchmark` as either:

```text
DASHSCOPE_API_KEY=sk-...
```

or:

```text
QWEN_API_KEY=sk-...
```

The default Qwen endpoint is:

```text
https://dashscope-intl.aliyuncs.com/compatible-mode/v1
```

OpenRouter models use:

```text
OPENROUTER_API_KEY=sk-or-v1-...
```

The Qwen candidate set is intentionally narrow: native `qwen3.5-flash` and
`qwen3-vl-flash`, plus OpenRouter `qwen/qwen3-vl-8b-instruct`,
`qwen/qwen3.6-flash`, and `qwen/qwen3.6-35b-a3b`. Each has a direct-image
variant and a Cloud Vision OCR variant for screenshot comparison.

The DeepSeek candidate set is OpenRouter-based. DeepSeek is included as Cloud
Vision variants because the DeepSeek chat models are text models, so
screenshots need OCR text first. The set covers V4 Flash, V4 Pro, V3.2, V3.2
Speciale, and R1 0528.

Useful Qwen/OpenRouter benchmark commands:

```bash
npm run bench:qwen
npm run bench:deepseek
npm run bench:openrouter
npm run bench:qwen-openrouter
```

By default, the benchmark imports the production prompt functions from the
sibling backend repo:

```text
/Users/yusha/highlighter-backend/routes/explain.py
```

Specifically, it uses `RESPONSE_STYLE`, `text_prompt`, and `image_prompt`. If
the backend moves, run the benchmark with `--backend-dir /path/to/highlighter-backend`.
Use `--prompt-file` only when you intentionally want to test a non-production
prompt.

For `*-cloud-vision` variants, Cloud Vision OCR text is sent to the LLM
without the original image by default. Set `SEND_IMAGE_WITH_CLOUD_VISION=1` if
you want to benchmark OCR text plus image.
