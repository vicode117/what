# AGENTS.md

Guidance for AI agents (and humans) working on TranslateTrainer.

## What this is

Local-first desktop app: AI translation → saved Markdown history → (later) personal language memory
and training. Read `docs/design.md` for the architecture and the product prompt for the full spec.

## Repository structure

```text
apps/desktop        Electron app: src/main, src/preload, src/renderer
packages/contracts  Shared types + Zod schemas + IPC contract (@tt/contracts)
packages/core       Business logic (@tt/core): ai/, prompts/, translation/, storage/, settings/
prompts/            Version-controlled prompt templates (Markdown)
docs/               design.md
```

Workspace packages ship TypeScript source directly (`main: ./src/index.ts`, "internal packages"
pattern); apps bundle them. The desktop app has empty runtime `dependencies` — everything is bundled
into `out/`, so the packaged asar ships only build output plus the `prompts/` extra resource.

## Commands

```bash
pnpm install          # deps (allowBuilds: electron, esbuild)
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
- `packages/contracts` is dependency-light (zod only) and safe to bundle anywhere.
- Errors crossing IPC must be `AppError`/`ErrorPayload` with an `ErrorCode`. Never leak raw
  provider exceptions to the renderer.

## Markdown source-of-truth rule

The Vault (`translations/YYYY/MM/*.md`, YAML frontmatter) is the only authoritative store.
Records keep the AI translation AND the user final translation (`## AI Translation` +
`## Translation`, `edited` flag). Never overwrite the AI output with later edits, and never
regenerate files in ways that would lose user text.

## Derived-index rule

`.app/` (indexes, caches, embeddings — future work) is derived data only. It must always be
rebuildable from Vault Markdown and must never be treated as authoritative. A "Rebuild Index"
action must exist once indexes exist.

## AI client architecture

- Small app-defined boundary: `LlmClient.generate(request)` in `@tt/core/ai`. No Vercel AI SDK.
- One OpenAI-compatible adapter; cloud and local (Ollama/vLLM) providers use the same abstraction
  via config (baseUrl/model/key/timeout/temperature/retries).
- Per-attempt timeout + bounded retry (NETWORK_ERROR, RATE_LIMIT, PROVIDER_ERROR only) + typed
  error codes. Do not retry indefinitely; do not spread retry/timeout logic across the codebase.
- API keys: Main process only (safeStorage in userData). Never in the Vault, never in the renderer,
  never logged. Logs record request id, provider, model, latency, error code — not content.

## Prompt management rules

- Prompts are Markdown files in `prompts/` (repo, version controlled), rendered via `PromptManager`
  with `{{variables}}`. Vault `prompts/` overrides built-ins by key (`translation/<mode>.md`).
- Modes affect prompts only. Never inline prompt text in TypeScript.

## IPC security rules

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- No `window.fs` / `window.node` / `window.exec` / generic `invoke`. Only domain APIs from
  `@tt/contracts` `AppApi`.
- Validate every IPC payload with the Zod schemas in `@tt/contracts` before touching Core.

## Training provenance rules (for upcoming slices)

- Every exercise/learning point must reference its source translation id(s).
- Never generate history-based training without source references.
- Deduplicate learning points; keep occurrences, not duplicate records.
- User corrections outrank inferred preferences; explicit glossary outranks everything.
- Deleted records must never feed training; mastered items are deprioritized.

## Testing rules

- Vitest; AI clients are always mocked/injected (`fetchImpl`, `sleepImpl`). Normal tests NEVER call
  paid LLM APIs.
- Cover: Markdown serialize/parse, record persistence, id sequencing, schema validation, prompt
  construction, retry/error mapping — plus, for training later: provenance, dedup, scheduling.

## Invariants (never break)

1. Never introduce a database without an explicit requirement.
2. Never make `.app` caches authoritative.
3. Never expose API keys to the Renderer.
4. Never overwrite user-edited translations with AI output.
5. Never generate history-based training without source references.
6. Never move business logic into React components.
7. Never introduce the Vercel AI SDK as the central AI abstraction.
8. Never make normal tests call paid LLM APIs.
