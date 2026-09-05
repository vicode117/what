# Design — TranslateTrainer

Architecture after Slices 1–6, following the product prompt.

## Architecture in brief

- **Electron architecture**: React renderer (Vite + Tailwind + shadcn/ui primitives) ⇄ typed IPC over
  `contextBridge` (`window.app.*` only, result-envelope, Zod-validated in Main) ⇄ Electron Main ⇄
  Application Core. `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- **Vault structure** (source of truth):
  - `translations/YYYY/MM/tr_YYYYMMDD_NNN.md` — records with YAML frontmatter and body sections
    `## Source`, `## Translation` (final), `## AI Translation` (original, present when the user
    edited), `## Notes`. `analyzedAt` / `deletedAt` frontmatter fields track analysis and soft delete.
  - `memory/vocabulary/*.md` + `memory/expressions/*.md` — learning points (dedup/merged by
    normalized term, provenance via `sourceTranslationIds`, occurrence dates, review scheduling state).
  - `memory/glossary/glossary.md` — explicit user glossary (`- term :: translation`).
  - `training/sessions/YYYY-MM-DD.json` — the persisted daily session.
  - `logs/reviews.jsonl` — append-only review events.
  - `.app/index/search.json` — derived full-text index (rebuildable; "Rebuild Index" in Settings).
  - `config.json` — non-secret settings; `prompts/` — user prompt overrides.
- **AI client boundary**: `LlmClient { generate(request): Promise<GenerationResult> }` with an
  OpenAI-compatible adapter; per-attempt timeout (AbortController), bounded retry with backoff for
  NETWORK_ERROR / RATE_LIMIT / PROVIDER_ERROR, typed errors (`TIMEOUT | RATE_LIMIT | AUTH_ERROR |
  NETWORK_ERROR | INVALID_RESPONSE | PROVIDER_ERROR | CANCELLED | …`).
- **Translation hot path**: Main prewarms and reuses prompt, provider, glossary, and search-index
  runtime state; initialization is single-flight and invalidated when settings, prompts, or the
  Vault path changes. Streaming exposes first-token timing and renders the first delta immediately.
- **Renderer / Preload / Main boundary**: renderer calls only domain APIs
  (`translation.*`, `history.*`, `memory.*`, `glossary.*`, `training.*`, `maintenance.rebuildIndex`,
  `settings.*`); it never sees the API key (only `hasApiKey`), the filesystem, or Node APIs.
  Credentials live in Main via Electron `safeStorage` in the userData directory.
- **Markdown persistence**: pure, tested serializer/parser; Markdown files are authoritative and
  every index/cache is derived and rebuildable.

## Data flow

```text
Translate:  input ──ContextRetriever──▶ glossary + similar history ──▶ prompt ──▶ LlmClient ──▶ result
Save:       result ──▶ TranslationStore ──▶ translations/YYYY/MM/*.md ──▶ index upsert
Analyze:    record ──LearningExtractor (JSON+Zod)──▶ candidates ──▶ LearningPointStore (dedup/merge)
Train:      due+weak+new points ──WeightedSelectionStrategy──▶ exercises ──▶ submit ──▶
            AnswerEvaluator ──▶ review log append + scheduler update
Watch:      chokidar (debounced) ──▶ re-parse changed files ──▶ index refresh (never rewrites md)
```

## Key decisions

1. **Internal-packages pattern** — workspace packages ship TS source; electron-vite bundles them and
   the packaged asar contains only `out/` plus the `prompts/` resource (empty runtime dependencies).
2. **Result-envelope IPC** — every handler returns `{ok…}`; Zod failures become typed
   `VALIDATION_ERROR`; the renderer never inspects provider exceptions.
3. **Keys in userData, not Vault** — `config.json` (non-secret) may sync via cloud drives; the
   safeStorage-encrypted key does not.
4. **Search without a search library** — tokenized AND-matching with field weights plus CJK
   substring fallback over a derived index. FlexSearch would only add value at much larger scale.
5. **Deterministic-first training** — exercises are generated from real records (no invented
   material); AI is used for structured extraction and answer evaluation, both Zod-validated.
6. **Replaceable pedagogy boundaries** — `ExerciseSelectionStrategy` (default 50% due / 30% weak /
   20% new, user-corrected first) and `ReviewScheduler` (default 1d/2d/3→60d streaks) are
   interfaces, so FSRS-class algorithms slot in without touching UI or services.
7. **Latency before abstraction** — translation setup is warmed at app start, repeated disk/config
   work is cached, and stream updates are coalesced only after the first delta; no provider racing
   or quality-changing prompt/model shortcut is used.

## IPC contract (summary)

| Channel | Purpose |
| --- | --- |
| `translation:translate` / `translation:save` | translate with context; persist Markdown |
| `history:get/list/update/delete/restore/analyze` | record access, filters, soft delete, extraction |
| `memory:list/update/delete` | learning points |
| `glossary:list/add/remove` | explicit glossary |
| `training:get-today/submit` | daily session + answer evaluation |
| `settings:get/update/choose-vault`, `index:rebuild` | configuration, maintenance |

Every reply is `{ ok: true, data } | { ok: false, error }` with an `ErrorCode` from `@tt/contracts`.

## Status & roadmap

Slices 1–6 implemented and verified (lint / typecheck / tests / build / packaged build).
Slice 7 (embeddings + semantic retrieval) is deliberately NOT implemented — the spec requires full
text retrieval to prove insufficient first. Other follow-ups: statistics dashboard and richer history
analytics.
