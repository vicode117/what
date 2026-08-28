# AGENTS.md

Guidance for AI agents (and humans) working on TranslateTrainer.

## What this is

Local-first desktop app: AI translation → Markdown history → personal language memory →
history-derived daily training. Slices 1–6 of the product prompt are implemented; read
`docs/design.md` for architecture details.

## Repository structure

```text
apps/desktop        Electron app: src/main, src/preload, src/renderer
packages/contracts  Shared types + Zod schemas + IPC contract (@tt/contracts)
packages/core       Business logic (@tt/core)
  src/ai/           LlmClient boundary, OpenAI-compatible adapter, retry
  src/prompts/      PromptManager
  src/translation/  TranslationService, ContextRetriever
  src/storage/      Markdown serialize/parse, TranslationStore, SearchIndexService
  src/history/      HistoryService (list/search/edit/soft-delete)
  src/memory/       LearningPointStore (dedup/merge), MemoryService, GlossaryStore
  src/analysis/     LearningExtractor (structured AI output)
  src/training/     TrainingService, generator, selection strategy, scheduler, evaluator, review log
prompts/            Version-controlled prompt templates (translation/, analysis/, training/)
docs/               design.md
```

Workspace packages ship TypeScript source directly (`main: ./src/index.ts`, "internal packages"
pattern); apps bundle them. The desktop app has empty runtime `dependencies` — everything is bundled
into `out/`, so the packaged asar ships only build output plus the `prompts/` extra resource.

## Commands

```bash
pnpm install          # deps (allowBuilds: electron, esbuild; override pins @electron/get ≥3.1 for app-builder-lib)
pnpm dev              # electron-vite dev (renderer HMR)
pnpm lint             # eslint
pnpm typecheck        # tsc --noEmit for contracts, core, desktop (node + web)
pnpm test             # vitest run (no network, no paid LLM calls)
pnpm build            # electron-vite build (main + preload + renderer)
pnpm dist             # build + electron-builder --dir (packaging verification)
pnpm dist:installer   # build + NSIS installer
```

## Architecture boundaries

- Renderer → `window.app.*` (contextBridge domain API) → ipcMain handlers (Zod-validated) → Core.
- Business logic lives in `packages/core`; never in React components or IPC handlers.
- Renderer imports only `@tt/contracts` (types) — never `@tt/core` (Node APIs).
- Errors crossing IPC must be `AppError`/`ErrorPayload` with an `ErrorCode`. Never leak raw
  provider exceptions to the renderer.
- Vault layout: `translations/YYYY/MM/*.md` (source of truth), `memory/` (learning points,
  glossary), `training/sessions/`, `logs/reviews.jsonl` (append-only), `.app/index/` (derived).

## Markdown source-of-truth rule

The Vault Markdown is the only authoritative store. Records keep the AI translation AND the user
final translation (`## AI Translation` + `## Translation`, `edited` flag). Never overwrite the AI
output with later edits. Soft delete uses a `deletedAt` frontmatter field; the file stays until the
user deletes it externally.

## Derived-index rule

`.app/index/search.json` (and anything else under `.app/`) is derived data only. It must always be
rebuildable from Vault Markdown (`maintenance.rebuildIndex`) and must never be treated as
authoritative. The chokidar watcher only refreshes index entries — it never rewrites Markdown.

## AI client architecture

- Small app-defined boundary: `LlmClient.generate(request)` in `@tt/core/ai`. No Vercel AI SDK.
- One OpenAI-compatible adapter; cloud and local (Ollama/vLLM) providers use the same abstraction
  via config (baseUrl/model/key/timeout/temperature/retries).
- Per-attempt timeout + bounded retry (NETWORK_ERROR, RATE_LIMIT, PROVIDER_ERROR only) + typed
  error codes. Do not retry indefinitely; do not spread retry/timeout logic across the codebase.
- Structured AI output (extraction, answer evaluation) is always parsed through Zod schemas;
  anything else becomes INVALID_RESPONSE.
- API keys: Main process only (safeStorage in userData). Never in the Vault, never in the renderer,
  never logged. Logs record request id, provider, model, latency, error code — not content.

## Prompt management rules

- Prompts are Markdown files in `prompts/` (repo, version controlled), rendered via `PromptManager`
  with `{{variables}}`. Vault `prompts/` overrides built-ins by key (`translation/<mode>.md`,
  `analysis/extract-learning-points.md`, `training/evaluate-answer.md`).
- Modes and features affect prompts only. Never inline prompt text in TypeScript.
- Translation prompts include `{{context}}`; ContextRetriever renders it (glossary first — it
  outranks inferred preferences — then similar previous translations).

## IPC security rules

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- No `window.fs` / `window.node` / `window.exec` / generic `invoke`. Only domain APIs from
  `@tt/contracts` `AppApi`.
- Validate every IPC payload with the Zod schemas in `@tt/contracts` before touching Core.

## Training provenance rules

- Every exercise/learning point references its source translation id(s) — no source-less exercises.
- Learning points deduplicate by normalized term; repeats append sources/occurrences, never fork.
- Deleted records never feed training; mastered/excluded items are never selected.
- User-corrected translations rank first in selection; explicit glossary outranks everything.
- Selection (WeightedSelectionStrategy 50/30/20) and scheduling (SimpleScheduler) live behind
  replaceable interfaces — do not spread their logic across the codebase.
- Review history is append-only JSONL; derived statistics may be rebuilt from it.

## Testing rules

- Vitest; AI clients are always mocked/injected (`fetchImpl`, `sleepImpl`, client stubs). Normal
  tests NEVER call paid LLM APIs.
- Cover: Markdown serialize/parse, record persistence, id sequencing, search/index behavior, schema
  validation, prompt construction, retry/error mapping, extraction validation, dedup/merge,
  selection + scheduling rules, and the spec-57 invariants (see training-service.test.ts).

## Invariants (never break)

1. Never introduce a database without an explicit requirement.
2. Never make `.app` caches authoritative.
3. Never expose API keys to the Renderer.
4. Never overwrite user-edited translations with AI output.
5. Never generate history-based training without source references.
6. Never move business logic into React components.
7. Never introduce the Vercel AI SDK as the central AI abstraction.
8. Never make normal tests call paid LLM APIs.
