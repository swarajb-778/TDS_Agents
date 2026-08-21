# Loqol TDS

A California Transfer Disclosure Statement, completed by the seller **by voice
or by form — their choice, switchable mid-question** — and pushed to DocuSeal as
a filled, signable PDF.

**→ [`docs/DECISIONS.md`](docs/DECISIONS.md) is the write-up.** The routing
decision and its defence, the six seller-experience questions from the brief,
the auth model, and what I deliberately skipped. Start there.

---

## Run it

```bash
npm install
cp .env.example .env      # DATABASE_URL, DOCUSEAL_API_KEY, OPENAI_API_KEY, AUTH_SECRET
npm run db:migrate
npm run db:seed           # prints two magic links
npm run dev
```

`.env.example` documents which Supabase connection string to use and why the
transaction pooler will not work.

The seed creates one agent (`agent@loqol.test` / `loqol-demo-2026`) and two
deals: one untouched, one mid-flow carrying all four answer statuses, a voice
answer with its verbatim, a follow-up explanation, and a pair of answers that
trips a hard conflict rule. Open either magic link to be the seller.

## Try it

`npm run db:seed` prints two magic links and the agent login. Open the links in
a **phone-sized window** — the seller flow is designed phone-first.

**Dana Reyes** starts fresh. **Marcus Oyelaran** is mid-flow and already carries
all four answer statuses, a voice answer with its verbatim, and a pair of
answers that trips a hard conflict.

### As the seller

1. **Open Dana's link.** You land on a welcome screen naming where you are and
   how long is left — not a percentage.
2. **"What's in the home."** Tap what the house has, then *"That's everything
   here."* That confirm is what turns untapped chips into an explicit *no*.
   Tap **Fireplace** and watch two more questions appear without a reload.
3. **Tap "Come back to this"** on any question. It will not be re-asked
   immediately — it returns once nothing new is left.
4. **Close the tab and reopen the same link.** You land back in the same place.
   Nothing is stored about your position; it is derived from your answers.
5. **Keep going to "Anything not working."** That chapter is voice-first. Press
   **Start talking** and allow the microphone. If you deny it, or you would
   rather not, *"Just show me the buttons"* is there in every state.
6. **In voice, try these deliberately:** hedge on an answer ("I think so,
   maybe?") and watch it re-ask rather than record. Say *"I don't know"* and
   watch it check whether you mean *"not aware of any"* — different answers on
   a TDS. Say *"can you just show me the buttons"* and it hands over without
   arguing.
7. **Contradict yourself.** Answer *yes* to the HOA question and *no* to the one
   about written rules. A quiet note appears on that card. It does not block.
8. **Finish, and read the review screen.** Both sides of each contradiction are
   quoted back in your own words — including what you actually said out loud if
   it came from voice. Choose *"Both are right"* and it is recorded, not
   corrected.

### As the agent

Sign in at `/agent/login` with the credentials the seed printed.

1. The list shows every seller with derived status, progress, and how many
   things need you. Nothing about status is stored — it is computed from the
   answers.
2. Open **Marcus**. The top three tiles are the actual work: what he could not
   answer, what does not line up, what he set aside. Below that, every answer
   with **where it came from** — tapped, spoken, or filled by you — and his own
   words underneath.
3. **New disclosure** creates a seller, prefills the property details they
   cannot reasonably know, and issues a link. The link is shown once.
4. **"Send a fresh link"** revokes the old one, so only ever one works.

### The end-to-end PDF

```bash
npm run docuseal:fill "Marcus Oyelaran"
```

Writes `filled-tds-marcus.pdf`. Page 1 has the checkboxes and header, page 2 has
Section C with the numbered shared explain box, page 3 has the signatures.

### Things worth trying to break

- Open a seller link with a character changed &mdash; you get the expired-link
  screen, not an error.
- Sign out, then visit `/agent` &mdash; you are redirected, not shown data.
- With the browser in dark mode, reload anything. Both themes are designed;
  `npm run contrast:check` asserts every colour pair in both.

## Check it

```bash
npm run check        # typecheck, registry, flow, form projection, WCAG contrast
npm run db:check     # upsert vs audit trail, answer statuses, conflicts, credentials
npm run voice:check  # the voice tool contract, against the real route handler
```

`npm run check` needs no environment at all — the registry and flow engine have
no external dependencies. The other two need `DATABASE_URL`.

These are `assert`-based scripts, not print-outs: each is the smallest thing
that fails if the logic breaks. Several of the bugs described in the write-up
were found by writing them.

```bash
npm run docuseal:template   # dry run: report which fields place and which don't
npm run docuseal:create     # build the template in DocuSeal from the blank PDF
npm run docuseal:fill "Marcus Oyelaran"   # a real filled, signed PDF
```

## Repo map

```
docs/
  DECISIONS.md         ← the write-up. Routing, defended; the brief's questions answered.
  REGISTRY.md          Registry-level design notes.
  BUILD_PLAN.md        The tasks, with acceptance criteria and what each one found.
CLAUDE.md              Operating brief and hard rules.

src/tds/               Pure. No network, no React, no database.
  types.ts             Question, Answer, Gate, FollowUp, DocuSealMapping
  registry.ts          The form itself — 89 questions, translations, voice prompts
  flow.ts              Gates, next-question, follow-ups, progress, resume, validation
  conflicts.ts         20 cross-answer rules with seller-facing messages
  form-view.ts         Registry → form projection (chip vs Yes/No, landing group)
  voice.ts             Registry → the voice agent's brief
  docuseal.ts          Field mapping, submission builder, signer fields

src/db/                Persistence. The only place that knows about rows.
  schema.ts            7 tables. answers is state; answer_events is append-only history.
  answers.ts           loadAnswers() / writeAnswer() — the single write path
  crypto.ts            scrypt passwords, SHA-256 magic-link tokens
  requests.ts          Magic-link resolution
  sessions.ts          Modality preference (not position — that's derived)
  conflicts.ts         Which contradictions the seller stood by

src/app/
  s/[token]/           The seller. Welcome-back, chapters, voice, review.
  api/answers          Read and write answers (both modalities)
  api/voice/session    Mints an ephemeral OpenAI token
  api/voice/tool       Executes voice tool calls server-side
  api/conflicts        Standing by a contradiction, or changing your mind

scripts/
  validate.ts          Registry integrity — run before any registry commit
  smoke.ts             Gates, follow-ups, progress, conflicts, field mapping
  form-check.ts        Chip/Yes-No split, group reachability, deferral
  db-check.ts          Persistence and audit trail
  voice-check.ts       The voice tool contract
  seed.ts              One agent, two deals, two magic links
  extract_boxes.py     Pulls all 117 checkbox glyphs out of the blank PDF
  prepare_pdf.py       Strips the [City]/[County] placeholder tokens
  build-template.ts    Matches glyphs to the registry, creates the DocuSeal template
  fill-pdf.ts          Seeded answers → submission → filled PDF

assets/
  ca-tds-blank.pdf     The source form, as supplied
  ca-tds-template.pdf  Prepared base, placeholder tokens removed
  tds-boxes.json       Extracted glyph positions, regenerable
```

## The core idea

One declarative registry. The form renderer, the voice agent's tool schemas, the
progress meter, the conflict engine and the DocuSeal field map are all
projections of it.

*"Start in one path, finish in the other"* sounds like a sync problem. It isn't:
there is a single answer store and two input adapters writing to it, and
position is derived from the answers rather than stored. There is nothing to
sync, so switching mid-question costs nothing to support.

## Status

| | |
|---|---|
| Registry, flow, conflicts | 89 questions, 20 rules, zero validator errors |
| Persistence | Supabase + Drizzle, append-only audit trail |
| Seller form path | Phone-first, 9 grouped rooms, live gating |
| DocuSeal | Template generated from the PDF's own glyphs — 140/144 fields |
| Voice | OpenAI Realtime over WebRTC, server-owned queue |
| Resume, handoff, progress | Position derived; chapters and minutes |
| Conflicts | Inline notes and a review screen; standing-by recorded |
| Agent view | Signed-cookie auth, CSRF, derived status, full review |
| Design system | Semantic tokens, both themes, contrast asserted |

All eight tasks in [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) are complete. Known
gaps are enumerated in [`docs/DECISIONS.md`](docs/DECISIONS.md) §9 rather than
left to be discovered.
