# Design — TranslateTrainer

Initial architecture design (Slice 1), following the product prompt.

## Architecture in brief

- **Electron architecture**: React renderer (Vite + Tailwind + shadcn/ui primitives) ⇄ typed IPC over
  `contextBridge` (`window.app.*` only, result-envelope, Zod-validated in Main) ⇄ Electron Main ⇄
  Application Core. `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- **Vault structure**: `translations/YYYY/MM/*.md` (source of truth), `config.json` (non-secret
  settings), `prompts/` (user prompt overrides), plus future `training/`, `memory/`, `logs/`, `.app/`
  (derived, rebuildable) directories from the spec.
- **TranslationRecord**: `id: tr_YYYYMMDD_NNN`, `createdAt`, `sourceLanguage`, `targetLanguage`,
  `mode`, `provider`, `model`, `tags`, plus body sections `## Source`, `## Translation` (final),
  `## AI Translation` (original, present when the user edited), `## Notes`.
- **AI client boundary**: `LlmClient { generate(request): Promise<GenerationResult> }` with an
  OpenAI-compatible adapter; per-attempt timeout (AbortController), bounded retry with backoff for
  NETWORK_ERROR / RATE_LIMIT / PROVIDER_ERROR, and typed errors
  (`TIMEOUT | RATE_LIMIT | AUTH_ERROR | NETWORK_ERROR | INVALID_RESPONSE | PROVIDER_ERROR | CANCELLED | …`).
- **Renderer / Preload / Main boundary**: renderer calls only domain APIs
  (`translation.translate/save`, `history.get`, `settings.get/update/chooseVault`); it never sees the
  API key (only `hasApiKey`), the filesystem, or Node APIs. Credentials live in Main via Electron
  `safeStorage` in the userData directory (outside the syncable Vault).
- **Markdown persistence**: YAML frontmatter + fixed `##` sections, human-readable and Obsidian
  compatible. Parser and serializer are pure, tested functions; Markdown files are authoritative and
  any future index is derived and rebuildable.

## Repository structure

```text
translate-trainer/
├─ apps/
│  └─ desktop/            # Electron app (main / preload / renderer)
│     ├─ src/main/        # window, IPC handlers, credentials, vault path
│     ├─ src/preload/     # contextBridge domain API
│     └─ src/renderer/    # React UI (features/, components/ui/, lib/, hooks/)
├─ packages/
│  ├─ contracts/          # shared types + Zod schemas + IPC contract (@tt/contracts)
│  └─ core/               # business logic, no Electron imports (@tt/core)
│     └─ src/
│        ├─ ai/           # LlmClient, OpenAI-compatible adapter, retry
│        ├─ prompts/      # PromptManager
│        ├─ translation/  # TranslationService
│        ├─ storage/      # Markdown serialize/parse, TranslationStore, ids
│        └─ settings/     # SettingsStore (vault config.json)
├─ prompts/               # version-controlled prompt templates (translation/<mode>.md)
├─ docs/
├─ AGENTS.md
├─ package.json           # pnpm workspace root
└─ pnpm-workspace.yaml
```

Workspace packages are "internal packages": they ship TypeScript source (`main: ./src/index.ts`)
and are bundled by Vite/electron-vite. The desktop app declares empty runtime dependencies so the
packaged asar contains only the built `out/` bundles plus the `prompts/` resource.

## IPC contract

| Channel | Request | Result |
| --- | --- | --- |
| `translation:translate` | `{ text, sourceLanguage, targetLanguage, mode }` | `{ translatedText, provider, model, usage?, durationMs }` |
| `translation:save` | `{ sourceText, aiTranslation, userTranslation?, …meta }` | `{ id, filePath }` |
| `history:get` | `{ id }` | record or `null` |
| `settings:get` | — | settings + `hasApiKey` (never the key) |
| `settings:update` | partial provider/apiKey/vault/defaults patch | updated settings view |
| `settings:choose-vault` | — | chosen path or `null` |

Every reply is `{ ok: true, data } | { ok: false, error }`; errors carry an `ErrorCode` from
`@tt/contracts`, so the renderer never parses provider exception strings.

## User corrections (Slice 1 behavior)

Saving stores `aiTranslation` always. When the user's final text differs, it is stored as
`userTranslation` with `edited: true` in frontmatter and the AI original is preserved in a
`## AI Translation` section. Nothing ever overwrites the AI output.

## Roadmap

Slices 2–7 from the product prompt: history + search + corrections; learning extraction with
provenance and dedup; daily training (reverse translation + cloze) with review log; adaptive
selection; translation memory retrieval; semantic memory (only if full-text retrieval proves
insufficient).
