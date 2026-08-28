# Project Prompt — Personal AI Translation & Training Tool

You are helping me design and implement a new local-first desktop application:

# TranslateTrainer

A personal AI-powered translation, translation-history, and language-training application.

The core idea is:

```text
Translate
    ↓
Save
    ↓
Accumulate personal language corpus
    ↓
AI analyzes historical translations
    ↓
Generate personalized daily training
    ↓
User completes exercises
    ↓
Record performance
    ↓
Improve future training
```

This is NOT merely a translation UI.

The long-term product goal is:

> Turn everything I translate in daily life into reusable personal language-learning material.

The system should gradually understand:

- words I frequently encounter
- expressions I repeatedly translate
- phrases I do not understand well
- mistakes I repeatedly make
- terminology related to my work and interests
- translation corrections I manually make
- content I already know well
- content I should review again

The application should become more useful as translation history grows.

---

# 1. Product Principles

Always prioritize:

```text
Local First
User-Owned Data
Markdown First
AI as Enhancement
Simple Architecture
Type Safety
Privacy
Rebuildable Derived Data
```

The user's files are the source of truth.

Search indexes, embeddings, caches, and generated recommendations are derived data.

They must always be rebuildable from source files.

Do NOT make the application depend on a proprietary cloud backend.

---

# 2. Technology Stack

Use:

```text
Electron
Node.js
React
Vite
TypeScript
Tailwind CSS
shadcn/ui
pnpm
```

Use TypeScript throughout:

```text
Electron Main
Preload
Renderer
Core
AI Client
Training Engine
```

Do NOT introduce:

```text
FastAPI
ASP.NET Core
NestJS
PostgreSQL
SQLite
Next.js
```

for the initial application.

There is no local HTTP backend.

---

# 3. Application Architecture

Use:

```text
React Renderer
      │
      │ Typed API
      ▼
Preload / contextBridge
      │
      ▼
Electron Main
      │
      ▼
Application Core
      │
      ├─ Translation
      ├─ History
      ├─ Storage
      ├─ Search
      ├─ AI
      ├─ Memory
      ├─ Training
      └─ Review
```

Keep business logic outside React components.

Renderer must NOT directly access:

```text
filesystem
API keys
environment variables
Node.js APIs
```

---

# 4. Electron Security

Mandatory:

```text
nodeIntegration = false
contextIsolation = true
```

Use narrowly scoped APIs through `contextBridge`.

Do NOT expose:

```ts
window.fs
window.node
window.exec
window.invoke
```

Instead expose domain APIs such as:

```ts
window.app.translation.translate(...)
window.app.translation.save(...)

window.app.history.search(...)
window.app.history.get(...)

window.app.training.getToday(...)
window.app.training.submit(...)

window.app.settings.get(...)
window.app.settings.update(...)
```

Validate IPC input before passing it into Core services.

---

# 5. Local-First Storage

Do NOT introduce a database.

The user's Vault directory is the source of truth.

Example:

```text
TranslationVault/
├─ translations/
│  ├─ 2026/
│  │  ├─ 08/
│  │  │  ├─ xxx.md
│  │  │  └─ yyy.md
│
├─ training/
│  ├─ sessions/
│  └─ generated/
│
├─ memory/
│  ├─ vocabulary/
│  ├─ expressions/
│  └─ glossary/
│
├─ logs/
│  └─ reviews.jsonl
│
├─ prompts/
│
├─ .app/
│  ├─ index/
│  ├─ cache/
│  └─ embeddings/
│
└─ config.json
```

User-visible knowledge should preferably remain:

```text
Markdown
```

Machine-oriented derived state may use:

```text
JSON
JSONL
```

inside `.app/`.

`.app/` must be fully rebuildable.

---

# 6. Obsidian Compatibility

Translation records must be normal Markdown files that can be browsed outside the application.

Do not invent a proprietary binary document format.

Use YAML frontmatter for metadata.

Example:

```markdown
---
id: tr_20260829_001
createdAt: 2026-08-29T10:30:00+08:00
sourceLanguage: en
targetLanguage: zh-CN
provider: openai-compatible
model: example-model
tags:
  - software
  - ai
---

# Translation

## Source

The application should remain maintainable over time.

## Translation

这个应用应该能够长期保持可维护性。

## Notes

...
```

Exact schema may evolve.

Keep it human-readable.

---

# 7. Translation Record

Every saved translation should preserve:

```text
ID

Source Text

Translated Text

Source Language

Target Language

Created Time

AI Provider

Model

User Tags

User Notes

AI Notes if generated

User-edited Translation if changed
```

Do not overwrite the original AI translation when the user edits it.

Preserve conceptually:

```text
AI Translation

User Final Translation
```

because the difference between them is valuable training data.

---

# 8. User Corrections Are Important Data

If AI produces:

```text
A
```

and the user changes it to:

```text
B
```

do NOT simply replace A.

Store both.

This difference is an important signal.

It may indicate:

```text
translation mistake

word preference

terminology preference

tone preference

domain terminology

grammar misunderstanding
```

Future training should be able to use these corrections.

---

# 9. Translation Workflow

Primary flow:

```text
Input text
    ↓
Detect / choose language
    ↓
Translate
    ↓
Show result
    ↓
Optional explanation
    ↓
User edits if necessary
    ↓
Save
```

Saving should be easy and fast.

Do not require users to fill many metadata fields before saving.

Most metadata should be generated automatically.

---

# 10. Main Translation UI

The main page should prioritize speed.

Suggested layout:

```text
┌─────────────────────────────────────────┐
│ Source                                  │
│                                         │
│ ...                                     │
│                                         │
├─────────────────────────────────────────┤
│ Translation                             │
│                                         │
│ ...                                     │
│                                         │
└─────────────────────────────────────────┘
```

Actions may include:

```text
Translate

Save

Copy

Explain

Improve

Alternative Translation
```

Avoid making every AI capability permanently visible.

Use progressive disclosure.

---

# 11. Language Selection

Allow:

```text
Auto Detect
English
Chinese
Japanese
...
```

The supported list may grow later.

Remember recent language pairs.

Do not build a huge language configuration system initially.

---

# 12. Translation Modes

Support configurable translation intent.

Initial modes may include:

```text
Natural

Literal

Professional

Concise
```

Later domain-specific modes may include:

```text
Software Development

Technical Documentation

Business

Academic
```

Do not implement dozens of modes initially.

Modes should primarily affect prompts.

---

# 13. AI Architecture

Build a custom AI pipeline.

Do NOT use Vercel AI SDK as the central abstraction.

Use application-defined interfaces.

Conceptually:

```text
TranslationService
       ↓
Prompt Builder
       ↓
LLM Client
       ↓
Provider Adapter
```

Example conceptual boundary:

```ts
interface LlmClient {
  generate(request: GenerationRequest): Promise<GenerationResult>;

  stream?(
    request: GenerationRequest
  ): AsyncIterable<GenerationChunk>;
}
```

Do not over-design a universal AI framework.

Support only capabilities actually needed.

---

# 14. AI Provider Configuration

Support OpenAI-compatible APIs first.

Configuration should support:

```text
Provider

Base URL

API Key

Model

Timeout

Temperature
```

This should make it possible to use providers such as:

```text
OpenAI-compatible cloud services

local OpenAI-compatible servers

Ollama-compatible workflows when exposed appropriately
```

Do not hard-code model names into business logic.

---

# 15. Protect API Keys

API keys must never be exposed to React Renderer.

Store credentials using platform-appropriate secure mechanisms when practical.

At minimum:

Renderer:

```text
must NOT receive API keys
```

Electron Main:

```text
owns provider credentials
```

Do not log API keys.

---

# 16. Prompt Management

Do not scatter prompts across TypeScript classes.

Store meaningful prompts separately.

Example:

```text
prompts/
├─ translation/
│  ├─ natural.md
│  ├─ literal.md
│  └─ technical.md
│
├─ analysis/
│  ├─ explain.md
│  └─ extract-learning-points.md
│
└─ training/
   ├─ cloze.md
   ├─ reverse-translation.md
   ├─ error-correction.md
   └─ daily-session.md
```

Prompt changes must be version controllable.

Prompt configuration should be testable.

---

# 17. Structured AI Output

If AI output will be consumed programmatically:

use structured output.

Use Zod to validate results.

Example:

```ts
type TranslationAnalysis = {
  difficultWords: ...
  expressions: ...
  grammarPoints: ...
  learningPoints: ...
};
```

Do not parse important structured data from arbitrary prose using fragile regular expressions.

---

# 18. Translation History

Provide a dedicated History view.

Users should be able to:

```text
Search

Filter by date

Filter by language

Filter by tag

Filter by topic

Open translation

Edit notes

Re-translate

Add to training

Delete / restore
```

The filesystem remains authoritative.

---

# 19. Search

Start with local full-text search.

Search should include:

```text
source text

translated text

user corrections

notes

tags

AI-generated learning points
```

Use a lightweight local index.

A library such as:

```text
FlexSearch
```

may be used if it provides clear value.

The search index is derived data.

It must be rebuildable.

---

# 20. Semantic Search

Do NOT add embeddings to the MVP merely because AI is present.

First implement full-text search.

Introduce semantic search when history becomes large enough that:

```text
keyword search is insufficient
```

If embeddings are introduced:

store them locally as derived data.

Conceptually:

```text
Translation Markdown
        ↓
Chunk / normalize
        ↓
Embedding
        ↓
Local embedding index
```

Embedding data must always be rebuildable.

---

# 21. Personal Language Memory

The application should gradually build reusable personal learning memory.

Potential categories:

```text
Vocabulary

Expressions

Terminology

Grammar Patterns

Frequent Mistakes

User Translation Preferences

Domain Terms
```

Do NOT treat AI-extracted memory as unquestionable fact.

Every memory item should retain provenance.

Example:

```text
Expression:
take something into account

Meaning:
考虑某事

Source Translation:
tr_20260829_001
```

---

# 22. Memory Pipeline

Conceptually:

```text
Translation saved
       ↓
Analyze for learning value
       ↓
Extract candidate memory
       ↓
Deduplicate
       ↓
Merge / update
       ↓
Use in future translation and training
```

Do not re-run expensive AI analysis every time the application starts.

Track whether a translation has already been analyzed.

---

# 23. Translation Memory vs Learning Memory

Keep these concepts separate.

## Translation Memory

Helps future translation.

Examples:

```text
preferred terminology

previous translation

domain-specific phrase

personal style preference
```

## Learning Memory

Helps training.

Examples:

```text
unknown word

repeated mistake

difficult phrase

grammar pattern

review performance
```

The same historical record may contribute to both.

Do not force both into one generic `memory` object.

---

# 24. Personal Glossary

Allow the user to explicitly maintain glossary entries.

Example:

```text
work order
→ 工单

traceability
→ 可追溯性

wire harness
→ 线束
```

Explicit user glossary entries have higher authority than automatically inferred preferences.

Priority conceptually:

```text
Explicit User Glossary
        ↓
Confirmed User Correction
        ↓
Historical Translation Preference
        ↓
Generic Model Preference
```

The AI translation prompt may use relevant glossary terms.

---

# 25. Context Retrieval for Translation

Do not send the entire history to the LLM.

Before translation:

```text
Input
  ↓
Retrieve relevant memory
  ↓
Select top relevant items
  ↓
Inject compact context
  ↓
Translate
```

Context may include:

```text
glossary terms

similar previous translations

known style preferences

domain terminology
```

Keep token usage controlled.

---

# 26. Training Goal

The training system should transform passive translation history into active learning.

Do not generate generic language lessons unrelated to actual history.

Prefer training derived from:

```text
what the user translated

what the user corrected

what the user struggled with

what the user repeatedly encountered
```

---

# 27. Training Sources

Candidate training material can come from:

```text
recent translations

frequent phrases

user-corrected translations

saved vocabulary

difficult expressions

review mistakes

important domain terminology

older items due for review
```

Every generated exercise must reference its source material.

---

# 28. Training Exercise Types

Initial exercise types:

## Reverse Translation

Show:

```text
Chinese
```

Ask user to produce:

```text
English
```

or vice versa.

---

## Cloze

Example:

```text
We need to ____ this issue into account.
```

---

## Vocabulary Recall

Show:

```text
traceability
```

Ask for meaning or usage.

---

## Phrase Recall

Show a context and ask the user to recall the expression.

---

## Error Correction

Show a translation similar to one the user previously got wrong.

Ask the user to correct it.

---

## Sentence Reconstruction

Provide fragments and ask the user to reconstruct the sentence.

---

Do not implement every exercise type in the first slice.

Start with:

```text
Reverse Translation
Cloze
```

---

# 29. AI-Generated Training

AI may generate exercises from historical records.

But AI must NOT invent unrelated learning material when the purpose is history-based training.

A generated exercise should contain structured metadata:

```text
exerciseId

type

question

referenceAnswer

explanation

difficulty

sourceTranslationIds

learningPointIds
```

Validate with Zod.

---

# 30. Daily Training

Generate a daily training session.

Conceptually:

```text
Due reviews
    +
Recent translations
    +
Repeated mistakes
    +
High-value vocabulary
    ↓
Daily Session
```

The daily session should stay reasonably short.

Initial target:

```text
10–20 exercises
```

rather than generating a huge lesson.

Quality > quantity.

---

# 31. Daily Training Selection

Exercise selection should balance:

```text
Review

New Material

Weak Areas
```

Example conceptual ratio:

```text
50% due review

30% weak items

20% recent/new material
```

This is an initial heuristic, not a permanent scientific rule.

Make the strategy replaceable.

Do not hard-code selection decisions throughout UI components.

---

# 32. Training Difficulty

Difficulty can initially be simple:

```text
Easy

Normal

Hard
```

Estimate difficulty using signals such as:

```text
word frequency

sentence length

previous review performance

number of user errors

AI classification
```

Do not build a sophisticated ML difficulty model.

---

# 33. Review Feedback

After each exercise allow:

```text
Correct

Partially Correct

Incorrect
```

or equivalent scoring.

Optionally allow:

```text
Easy

Good

Hard
```

for recall feedback.

Store the review result.

---

# 34. Review History

Review events should be append-only whenever practical.

Example:

```text
logs/reviews.jsonl
```

Each event might contain:

```json
{
  "exerciseId": "...",
  "learningPointId": "...",
  "timestamp": "...",
  "result": "incorrect",
  "durationMs": 8300
}
```

Do not rewrite a giant history file for every answer.

The event log is the source for review history.

Derived statistics can be rebuilt.

---

# 35. Spaced Review

Do not begin by implementing a complicated learning algorithm.

MVP can use simple scheduling based on:

```text
lastReviewedAt

successCount

failureCount

difficulty

nextReviewAt
```

Design the scheduling boundary so a more sophisticated algorithm such as FSRS can be introduced later.

Do not spread scheduling formulas throughout the codebase.

---

# 36. AI Evaluation of Free-Text Answers

For translation exercises, exact string equality is insufficient.

Evaluation should combine deterministic checks with AI when needed.

Conceptually:

```text
User Answer
     ↓
Basic normalization
     ↓
Deterministic comparison where possible
     ↓
AI semantic evaluation if necessary
```

AI evaluation should return structured data:

```text
correct

partiallyCorrect

incorrect

feedback

importantDifferences
```

Do not pretend translation has only one valid answer.

---

# 37. AI Feedback

Training feedback should explain:

```text
what was good

what was wrong

better expression

important vocabulary

grammar issue
```

Keep feedback concise.

Do not turn every question into a long textbook lesson unless requested.

---

# 38. Learning Point Provenance

Every learning item must be traceable.

Example:

```text
Learning Point
    ↓
Source Translation
    ↓
Original Source Text
```

This allows the user to understand why something was selected for training.

AI-generated learning points must never become disconnected anonymous facts.

---

# 39. Duplicate Learning Points

The same word or phrase may occur in many translations.

Do not generate five independent learning records unnecessarily.

Implement deduplication.

Conceptually distinguish:

```text
Learning Point
```

from:

```text
Occurrences
```

Example:

```text
traceability

Occurrences:
2026-08-20
2026-08-23
2026-08-29
```

Repeated occurrence may increase training priority.

---

# 40. User Control

The user must be able to:

```text
exclude an item from training

mark as mastered

reset progress

pin important terminology

edit learning notes

delete generated learning points
```

AI recommendations must remain suggestions.

---

# 41. Training Page

Initial training UI should be distraction-free.

Example:

```text
Daily Training

3 / 15

Translate:

“这个功能需要考虑向后兼容。”

[ Answer input ]

[ Submit ]
```

After answer:

```text
Result

Reference answer

AI feedback

Related expression

Source record
```

Avoid dashboard noise during training.

---

# 42. Dashboard

Keep dashboard simple.

Useful items:

```text
Translate

Today's Training

Recent Translations

Due Reviews

Recently Learned
```

Potential statistics:

```text
translations this week

training completed

review accuracy

items due
```

Do not manufacture meaningless AI productivity metrics.

---

# 43. Main Navigation

Initial navigation:

```text
Translate

History

Training

Memory

Settings
```

Do not add empty pages for speculative features.

---

# 44. Custom AI Client

The AI layer must be independently testable.

Recommended conceptual structure:

```text
ai/
├─ client/
├─ providers/
├─ prompts/
├─ translation/
├─ analysis/
├─ memory/
└─ training/
```

Avoid a single huge:

```text
AIService.ts
```

containing every AI feature.

Likewise, do not create dozens of interfaces before needed.

---

# 45. Retry and Timeout

LLM calls must support:

```text
timeout

retry

cancellation

structured errors
```

Do not retry indefinitely.

Distinguish errors such as:

```text
TIMEOUT

RATE_LIMIT

AUTH_ERROR

NETWORK_ERROR

INVALID_RESPONSE

PROVIDER_ERROR
```

Renderer should not inspect provider-specific exception strings.

---

# 46. Streaming

Use streaming when it materially improves UX.

Translation itself may use streaming.

Long AI explanations may use streaming.

Training generation does NOT need streaming unless useful.

Do not automatically make every AI call streaming.

---

# 47. Privacy

Translation content may contain sensitive personal or work information.

Do not unnecessarily log:

```text
source text

translated text

full prompts

API keys
```

Logs should focus on:

```text
request id

provider

model

latency

token usage when available

error code
```

If content logging is useful for debugging, make it explicit and disabled by default.

---

# 48. Local Models

The architecture should allow locally hosted models through configurable APIs.

Do not create separate application architecture for:

```text
cloud model
```

and:

```text
local model
```

Both should preferably use the same provider abstraction when possible.

---

# 49. Sync

The Vault should work inside:

```text
OneDrive

iCloud Drive

Dropbox

Git repository

ordinary local folder
```

SkillSync-like custom machine synchronization is NOT required.

Let the filesystem/cloud provider handle machine synchronization.

The application should tolerate:

```text
external file modification

file appearing

file disappearing

merge conflict files
```

without corrupting data.

---

# 50. File Watching

Monitor the Vault for external changes.

Use a reliable cross-platform watcher such as:

```text
chokidar
```

if appropriate.

Watcher events should be debounced.

On changes:

```text
detect affected file
      ↓
re-read
      ↓
update index
```

Do not rewrite externally modified Markdown unnecessarily.

---

# 51. Indexes and Caches

Search indexes, metadata indexes, and embedding indexes belong under:

```text
.app/
```

They are derived.

There must be a command/action:

```text
Rebuild Index
```

If `.app/` is deleted:

the application must still be able to reconstruct it from source files.

---

# 52. Repository Architecture

Suggested repository:

```text
translate-trainer/
├─ apps/
│  └─ desktop/
│     ├─ src/
│     │  ├─ main/
│     │  ├─ preload/
│     │  └─ renderer/
│     └─ ...
│
├─ packages/
│  ├─ core/
│  ├─ ai/
│  └─ contracts/
│
├─ prompts/
├─ docs/
│
├─ AGENTS.md
├─ package.json
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
└─ README.md
```

Keep package count small.

If `core` and `ai` are initially simple enough to live together, prefer fewer packages.

---

# 53. Frontend Structure

Use feature-oriented organization:

```text
renderer/
├─ components/
│  └─ ui/
│
├─ features/
│  ├─ translation/
│  ├─ history/
│  ├─ training/
│  ├─ memory/
│  └─ settings/
│
├─ hooks/
├─ lib/
├─ routes/
└─ types/
```

Use shadcn/ui for primitives.

---

# 54. Renderer State

Use:

```text
React local state
```

for simple UI state.

Use:

```text
TanStack Query
```

for asynchronous Core state such as:

```text
translation history

daily training

memory items

search results
```

Conceptually:

```text
React
  ↓
TanStack Query
  ↓
Typed Application Client
  ↓
IPC
  ↓
Core
```

Use Zustand only if substantial cross-page client state emerges.

Do not duplicate query data into Zustand.

---

# 55. Testing

Use:

```text
Vitest
Testing Library
```

Focus tests on:

```text
Markdown serialization

Markdown parsing

translation storage

history indexing

memory extraction schema

training selection

review scheduling

AI response validation

prompt construction

provider retry behavior
```

AI clients must be mockable.

Normal tests must NOT require paid LLM calls.

---

# 56. AI Evaluation Dataset

Create a small local fixture dataset.

Examples:

```text
software development sentences

technical documentation

daily English

mixed Chinese/English text

ambiguous sentences

user-edited translations
```

Use it to evaluate:

```text
translation quality

structured extraction

training generation

answer evaluation
```

Real-model evaluations should be separate from ordinary unit tests.

---

# 57. Important Training Tests

Explicitly test:

```text
training references real history

no source-less exercise is generated

mastered items are deprioritized

incorrect items return sooner

duplicate vocabulary is merged

user corrections receive higher priority

deleted records are not used
```

These rules are more important than UI snapshot coverage.

---

# 58. AGENTS.md

Maintain a concise:

```text
AGENTS.md
```

Include:

```text
repository structure

build commands

test commands

architecture boundaries

Markdown source-of-truth rule

derived-index rule

AI client architecture

prompt management rules

IPC security rules

training provenance rules
```

Important instructions:

```text
Never introduce a database without an explicit requirement.

Never make `.app` caches authoritative.

Never expose API keys to Renderer.

Never overwrite user-edited translations with AI output.

Never generate history-based training without source references.

Never move business logic into React components.

Never introduce Vercel AI SDK as the central AI abstraction.

Never make normal tests call paid LLM APIs.
```

---

# 59. Definition of Done

Before claiming completion:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Verify Electron application build for the current platform when appropriate.

Do not claim:

```text
fixed

working

tests pass
```

without running verification.

---

# 60. MVP Vertical Slices

Do NOT build the complete product at once.

## Slice 1 — Translation

Build one complete flow:

```text
Input
  ↓
LLM Translation
  ↓
Result
  ↓
Save Markdown
  ↓
Open Saved Record
```

Include:

```text
provider configuration

translation prompt

typed AI client

Markdown persistence

basic error handling
```

Nothing more.

---

## Slice 2 — History

Add:

```text
history list

search

filters

translation detail

user correction

tags

notes
```

Implement local indexing.

---

## Slice 3 — Learning Extraction

For saved translations:

```text
Translation
   ↓
AI Analysis
   ↓
Vocabulary
Expressions
Learning Points
```

Persist learning data with source provenance.

Implement deduplication.

---

## Slice 4 — Daily Training

Implement:

```text
Reverse Translation

Cloze

Daily Training Queue

Submit Answer

Review Result

Review History
```

Every exercise must reference historical material.

---

## Slice 5 — Adaptive Training

Use review history to prioritize:

```text
incorrect items

difficult items

frequently encountered items

recently corrected translations

due reviews
```

---

## Slice 6 — Translation Memory

Use relevant historical information to improve translation:

```text
glossary

user corrections

similar previous translations

preferred terminology
```

Retrieve only relevant context.

---

## Slice 7 — Semantic Memory

Only if full-text retrieval becomes insufficient:

```text
embedding

semantic retrieval

local vector index
```

Do not introduce this earlier.

---

# 61. MVP Non-Goals

Do NOT initially build:

```text
social features

cloud accounts

team collaboration

web version

mobile app

teacher marketplace

generic flashcard platform

full language course system

speech recognition

speech synthesis

browser extension

OCR

multi-agent system

complex RAG

vector database

AI Agent framework
```

Evaluate them later based on actual use.

---

# 62. Core Invariants

The following must always remain true:

1. Markdown files are the primary user-owned source of truth.

2. No database is required to access or preserve translation history.

3. Derived indexes can always be rebuilt.

4. AI translations never silently overwrite user corrections.

5. User corrections are high-value learning signals.

6. Training content should primarily derive from actual translation history.

7. Training exercises retain provenance to source records.

8. Explicit user glossary rules outrank inferred AI preferences.

9. Renderer never receives unrestricted filesystem access.

10. Renderer never receives AI provider credentials.

11. LLM providers are replaceable through a small application-defined boundary.

12. Prompts are independently maintained and version controlled.

13. AI structured outputs are runtime validated.

14. Normal tests never depend on live LLM APIs.

15. Full-text retrieval comes before embeddings.

16. Simple review scheduling comes before complex learning algorithms.

17. The application remains fully usable without any cloud service other than an optional LLM provider.

---

# 63. Initial Task

This is a new project.

Start with:

## Step 1 — Design

Present in approximately 20 lines:

```text
Electron architecture

Vault structure

TranslationRecord model

AI client boundary

Renderer / Preload / Main boundary

Markdown persistence strategy
```

Then show the proposed repository structure.

## Step 2 — First Vertical Slice

Implement ONLY:

```text
Enter text

      ↓

Call configured LLM

      ↓

Display translation

      ↓

Save translation as Markdown

      ↓

Display saved translation
```

Required capabilities:

```text
OpenAI-compatible AI provider

provider/model configuration

prompt management

typed LLM client

timeout

basic retry

typed errors

Markdown serialization

Markdown parsing

file persistence

basic tests
```

Do NOT implement:

```text
training

embeddings

semantic search

memory extraction

spaced repetition

complex statistics
```

until the basic translation + persistence workflow works end-to-end.

Before implementation of architecture-affecting changes, follow the project's normal design/approval workflow.

After implementation run:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

and report:

## Completed

## Architecture Decisions

## Verification

## Remaining