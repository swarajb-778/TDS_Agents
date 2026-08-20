# Loqol TDS

Seller disclosure app for the California Transfer Disclosure Statement. Sellers
answer by **voice** or **form** — their choice, switchable mid-flow — and the
answers push to **DocuSeal** as a filled, signable PDF.

## Quickstart

```bash
npm install
cp .env.example .env      # fill in DocuSeal Test Mode key, OpenAI key, DATABASE_URL
npm run check             # typecheck + registry validation + smoke test
```

`npm run check` passes on a clean clone with no env vars — the registry and flow
engine have no external dependencies.

## Repo map

```
CLAUDE.md              ← read this first. Operating brief and hard rules.
docs/
  BUILD_PLAN.md        ← ordered tasks with acceptance criteria. Start at #1.
  REGISTRY.md          ← the routing decision, defended. Design rationale.
src/tds/
  types.ts             Question, Answer, Gate, FollowUp, DocuSealMapping
  registry.ts          The form itself — 89 questions, translations, voice prompts
  flow.ts              Gates, next-question, progress, resume, voice tools, validation
  conflicts.ts         19 cross-answer rules with seller-facing messages
  docuseal.ts          Field mapping, submission builder, Section C geometry
scripts/
  validate.ts          Registry integrity — run before any registry commit
  smoke.ts             Exercises gates, follow-ups, progress, conflicts, mapping
assets/
  ca-tds-blank.pdf     The source form. Flat, no fillable fields.
```

## The core idea

One declarative registry. The form renderer, the voice agent's tool schemas, the
progress meter, the conflict engine, and the DocuSeal field map are all
projections of it.

```
                    src/tds/registry.ts
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   Form renderer      Voice agent           DocuSeal
        │                   │                   │
        └────────┬──────────┘                   │
                 ▼                              │
          answers table ────────────────────────┘
```

"Start in one path, finish in the other" sounds like a sync problem. It isn't —
there's a single answer store and two input adapters writing to it. There is
nothing to sync.

**Status:** registry and flow engine complete and tested. Everything else is
`docs/BUILD_PLAN.md`.
