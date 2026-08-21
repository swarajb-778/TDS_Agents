# Loqol TDS — Seller Disclosure App

## What this is

A take-home build. A web app where a California home seller completes the
Transfer Disclosure Statement (TDS) — via **voice conversation** or **interactive
form**, their choice, switchable mid-flow — and the answers are pushed to
**DocuSeal** to produce a signable filled PDF. A real estate agent creates the
deal, sends the request, and reviews what comes back.

The blank form is at `assets/ca-tds-blank.pdf`. It's flat — no fillable fields.

## What is actually being graded

The brief says it outright: *"We care about this more than we care about your
architecture."* Weight your effort accordingly.

1. **The seller experience.** A stressed, non-technical person doing this at 10pm
   after work. Question order, handling "I don't understand" / "I don't know" /
   contradictory answers, showing how much is left, surviving a closed tab.
2. **A defensible voice-vs-form routing decision**, argued question by question.
3. **A working end-to-end path** into DocuSeal producing a real signable PDF.
4. Architecture and coverage — table stakes, not the differentiator.

Explicitly pre-forgiven: not every one of the ~150 fields wired up. Explicitly
**not** forgiven: a bad seller flow, or "a rendering of the TDS with input boxes
on it."

## Hard rules

These are decisions already made and defended in `docs/DECISIONS.md`. Don't
relitigate them mid-task; if one is genuinely blocking, say so and stop.

- **The registry is the single source of truth.** Never hardcode a question,
  label, option list, or PDF field name anywhere else. Adding a question means
  adding it to `src/tds/registry.ts` — the form, voice agent, progress meter,
  conflict engine, and DocuSeal mapping all derive from it.
- **Never block the seller.** Validation, conflicts, and missing follow-ups
  surface as notes and review cards. Nothing interrupts forward progress.
  An abandoned session is worse than an inconsistent one.
- **Never auto-correct an answer.** The seller signs this under penalty. Quote
  both conflicting answers back and ask which is right. Never "you made an
  error" — the seller isn't wrong, the form is confusing.
- **The model does not own the state machine.** `flow.ts` owns the question
  queue. The voice agent gets tools, calls them, and every write goes through
  `validateAnswer()` before it touches the store. Low confidence → reject and
  re-ask, never guess.
- **"I don't know" is a first-class answer status**, not a validation failure.
  On a TDS it's often legitimately "No — not aware," since the form asks about
  the *seller's* knowledge. Surface that distinction; don't coerce it.
- **Modality is a default, not a jail.** Every form question needs a mic
  affordance; every voice question needs "just show me the buttons." Never talk
  a seller out of switching.
- **No buyer signer roles.** A TDS is completed at listing, before an offer
  exists. Buyer fields stay unassigned.
- **Never put the OpenAI or DocuSeal key in the client.** Realtime sessions use
  a server-minted ephemeral token.

## Current state

**Done and typechecking:** `src/tds/` — 89 questions, 144 DocuSeal fields, zero
validator errors. Gates, follow-up queue-jumping, progress, resume, 20 conflict
rules and field mapping are all implemented and exercised by `scripts/smoke.ts`
and `scripts/form-check.ts`.

**Done and running against Supabase:** `src/db/` — schema, migration, seed, and
the answer repository. `loadAnswers()` returns the `AnswerMap` the flow engine
consumes; `writeAnswer()` is the single write path for both modalities and all
four answer statuses, and every mutation lands an `answer_events` row in the
same transaction. `npm run db:check` asserts the round-trip.

**Done:** the seller form path for "What's in the home" — `src/app/s/[token]/`,
Next.js App Router, phone-first. Nine groups of tap-to-add chips with a confirm
per group; `src/tds/form-view.ts` holds the pure projection (chip vs explicit
yes/no, landing group) so it can be asserted without a browser.

**Done:** DocuSeal, end to end. Template #5513725 is generated from the PDF's
own checkbox glyphs by `scripts/build-template.ts`; `scripts/fill-pdf.ts` turns
a seeded deal into a real filled, signable PDF.

**Done:** the voice path — `src/app/s/[token]/voice-chapter.tsx` over WebRTC,
`/api/voice/session` for ephemeral tokens, `/api/voice/tool` for server-executed
tool calls. `src/tds/voice.ts` builds the agent's brief from the registry.

**Done:** handoff, resume and progress. `SellerFlow` derives chapter and
modality from the answer set on every render, renders `resume()`'s welcome-back
copy, and pulls the map back before switching path. `ProgressHeader` speaks in
chapters and minutes. Skipping defers a question to a second pass rather than
re-asking it.

**Done:** conflicts in the UI — a quiet inline note on the question just
answered, and a review screen before signing that quotes both sides back and
lets the seller stand by both. Acknowledgements persist in
`conflict_acknowledgements` and never alter the answers.

**Done:** the write-up — `docs/DECISIONS.md`, with `README.md` rewritten to
point at it.

**Done:** the agent view — `src/app/agent/`, signed-cookie auth with CSRF on
mutations, deal list with derived status, and a review screen showing every
answer with its source and the seller's verbatim.

**Done:** the design system — semantic tokens in `globals.css` for both light
and dark, shared primitives in `src/app/ui.tsx`, and `npm run contrast:check`
asserting every token pair against WCAG in both themes.

**All eight tasks in `docs/BUILD_PLAN.md` are complete.**

**Known gaps:** 4 of 144 registry fields have no slot on the supplied PDF — it
is a paraphrased TDS, not the official C.A.R. form. Enumerated in
`docs/BUILD_PLAN.md` under task 3.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router) + TypeScript, one deployable |
| DB | Postgres (Neon or Supabase) + Drizzle |
| Agent auth | Email + password, httpOnly `Secure` `SameSite=Lax` session cookie, CSRF on mutations |
| Seller auth | **No account.** Opaque high-entropy token, stored hashed, scoped to one disclosure request, 14-day expiry, agent-reissuable |
| Voice | OpenAI Realtime over WebRTC, in-browser. Ephemeral token minted server-side |
| Signature | DocuSeal, Test Mode, free tier |

Sellers get a magic link because a stressed person at 10pm will not create an
account, and forcing one is where you lose them. Same pattern DocuSign uses.

## Conventions

- Question ids mirror the form: `A.dishwasher`, `B.gate`, `C.7`, `meta.county`.
  Follow-ups are `${parentId}.explanation`.
- DocuSeal field names are snake_case and derived from question ids:
  `a_dishwasher`, `b_yes`, `c7_yes`. They live **only** in the registry's
  `docuseal` mapping.
- Answers are keyed `(deal_id, question_id)`. One store, two input adapters.
  There is nothing to sync between voice and form.
- Every answer write records `source` (which modality) and, for voice,
  `confidence` and `verbatim`. This is a legal document; the audit trail is not
  optional.
- Seller-facing copy never says "Section B" or cites a statute number. Use
  `sellerLabel` / `plainEnglish` / `voicePrompt` from the registry.

## Commands

```bash
npm install
npm run typecheck    # tsc --noEmit
npm run validate     # registry integrity — dangling gates, dupes, missing prompts
npm run smoke        # exercises gates, follow-ups, progress, conflicts, mapping
```

`npm run validate` must pass before any commit that touches the registry.

## Working style for this repo

- Read `src/tds/types.ts` before touching anything else — it's short and it
  explains the whole shape.
- One task from `docs/BUILD_PLAN.md` at a time. Each has acceptance criteria.
- After changing the registry, run `npm run validate` and `npm run smoke`.
- When you add a DocuSeal field, diff `expectedFieldNames()` against the actual
  template. A typo'd field name fails **silently** — the submission succeeds and
  the answer vanishes.
- If a task requires a product decision not covered above, ask rather than
  guessing. Seller-experience choices are the graded part; don't improvise them.
