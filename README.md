# TranslateTrainer

A local-first desktop app that turns everyday AI translation into reusable personal language-learning
material.

**Current status: Slice 1 (translation + Markdown persistence) complete.** History/search, learning
extraction, and training come next — see [docs/design.md](docs/design.md).

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
edit if needed, and hit **Save** — a Markdown file appears under `translations/YYYY/MM/`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the Electron app with HMR |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript (strict) |
| `pnpm test` | Vitest suite (mocked AI — no paid calls) |
| `pnpm build` | Build main/preload/renderer bundles |
| `pnpm dist` | Package an unpacked build (`release/`) for the current platform |
| `pnpm dist:installer` | Build a Windows NSIS installer |

## Vault layout

```text
TranslationVault/
├─ translations/YYYY/MM/tr_YYYYMMDD_NNN.md   # source of truth (Obsidian-friendly)
├─ prompts/                                   # optional overrides for built-in prompts
├─ config.json                                # non-secret settings
└─ training/ memory/ logs/ .app/              # reserved for upcoming slices
```

Saved records keep both the AI translation and your final version — your corrections are the
valuable training signal the product is built around.

## Architecture

React renderer ⇄ typed `contextBridge` IPC (Zod-validated, result envelopes) ⇄ Electron Main ⇄
`@tt/core` (translation service, prompt manager, Markdown storage, OpenAI-compatible LLM client with
timeout/retry/typed errors). `@tt/contracts` holds the shared types and schemas. Details in
[docs/design.md](docs/design.md); agent rules in [AGENTS.md](AGENTS.md).
