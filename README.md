# TranslateTrainer

A local-first desktop app that turns everyday AI translation into reusable personal language-learning
material.

**Status: Slices 1–6 implemented** — translation, history/search, learning extraction, daily
adaptive training, and translation-memory context. See [docs/design.md](docs/design.md).

## The idea

```text
Translate → Save → accumulate a personal corpus → AI analyzes it
→ personalized daily training → record performance → improve future training
```

Your Vault of plain Markdown files is the source of truth. Indexes and caches are derived and
rebuildable. No database, no cloud backend — the only external service is your own LLM provider
(OpenAI-compatible cloud API or a local server such as Ollama, LM Studio, or vLLM).

## Requirements

- Node.js 20+
- pnpm 11+

## Getting started

```bash
pnpm install
pnpm dev
```

On first run: open **Settings**, pick a Vault folder (defaults to `Documents/TranslationVault`),
enter your provider's **Base URL**, **model**, and **API key** (stored encrypted via the OS keychain
in the app's private data directory — never in the Vault, never in the renderer). Then translate,
edit if needed, and hit **Save**.

## What you can do today

- **Translate** — auto-detected languages, four modes (natural/literal/professional/concise),
  editable results. Glossary entries and similar previous translations are injected as context, and
  your corrections are preserved next to the AI output forever.
- **History** — full-text search across source, translations, corrections, notes, and tags; filters
  by language, tag, and date; edit tags/notes; soft delete and restore; re-translate.
- **Memory** — extracted vocabulary, expressions, and grammar points with provenance links back to
  the source records; mark mastered or exclude from training; maintain a glossary that outranks all
  inferred preferences.
- **Training** — a daily session (reverse translation + cloze) built from *your* history: due
  reviews, weak items, and new material. Answers are graded deterministically first, with AI
  semantic evaluation for free-text translations; review history adapts what comes back tomorrow.

## Vault layout

```text
TranslationVault/
├─ translations/YYYY/MM/tr_YYYYMMDD_NNN.md   # source of truth (Obsidian-friendly)
├─ memory/vocabulary/ · memory/expressions/   # learning points with provenance
├─ memory/glossary/glossary.md                # explicit term → translation rules
├─ training/sessions/ · logs/reviews.jsonl    # daily sessions, append-only review history
├─ prompts/                                   # optional overrides for built-in prompts
├─ config.json                                # non-secret settings
└─ .app/index/                                # derived search index (rebuildable)
```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the Electron app with HMR |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript (strict) |
| `pnpm test` | Vitest suite (mocked AI — no paid calls) |
| `pnpm build` | Build main/preload/renderer bundles |
| `pnpm dist` | Package an unpacked build (`release/`) for the current platform |
| `pnpm dist:installer` | Build a Windows NSIS installer |

## Architecture

React renderer ⇄ typed `contextBridge` IPC (Zod-validated, result envelopes) ⇄ Electron Main ⇄
`@tt/core` (translation service + context retrieval, prompt manager, Markdown storage, search index,
learning memory, training engine, OpenAI-compatible LLM client with timeout/retry/typed errors).
`@tt/contracts` holds the shared types and schemas. Details in [docs/design.md](docs/design.md);
agent rules in [AGENTS.md](AGENTS.md).
