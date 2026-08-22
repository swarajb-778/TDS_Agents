# Handoff

Written for whoever picks this up next, human or otherwise. `README.md` says
how to run it and `docs/DECISIONS.md` defends the design. This file is the
part neither of those carries: what is actually true right now, what is
unproven, and what has already bitten.

---

## Where things stand

All eight tasks in `docs/BUILD_PLAN.md` are complete, plus four things the
brief did not ask for: signing in-product, tokenless seller sessions, agent
account lifecycle, and chapter URLs.

Three check suites, all green, all `assert`-based with no framework:

```bash
npm run check        # typecheck, registry, flow, form projection, WCAG contrast — needs NO env
npm run db:check     # persistence, audit trail, auth timing, throttling, signing state
npm run voice:check  # the voice tool contract, driven against the real handler
```

`npm run check` passing on a clean clone with no `.env` is deliberate: the
registry and flow engine have no external dependencies.

---

## The five things that took the longest to learn

Read these before changing anything in the relevant area. Each cost real time
and each is easy to undo by accident.

### 1. Position is derived, never stored

`nextQuestion(answers)` is a pure function of the answer set. There is no
cursor. This is what makes closing the tab safe, modality switching free, and
resume trivial.

Chapter URLs did **not** change this. `/disclosure` renders nothing at all —
it loads answers, works out where the seller belongs, and redirects. The URL
is a *view* of the derived position, not a rival source of truth. If you find
yourself storing "current question" anywhere, stop.

### 2. `@theme` inside a media query does not do what it looks like

Tailwind v4's `@theme` is a build-time directive. Nesting it in
`@media (prefers-color-scheme: dark)` does not make it conditional — Tailwind
hoists both blocks and the second overwrites the first. The app shipped
permanently dark and nobody noticed, because the browser being tested in
happened to be dark.

Dark tokens now override through a plain `:root` rule *inside* the media
query. `npm run contrast:check` parses the real values out of `globals.css`
and asserts sixteen pairs in both themes, so this cannot silently regress.

### 3. The Realtime API allows exactly one open response

A second `response.create` is **rejected**, not queued. The client used to
send one per tool call from inside `response.function_call_arguments.done` —
which fires while the response that made the call is still open. The answer
was written, the agent went silent, and only the seller speaking restarted it.

`src/tds/voice-turns.ts` is a pure reducer that owns this: one create per
turn, never while a response is open, refused creates retried on
`response.done`. Do not send `response.create` from anywhere else.

### 4. Transcribers hallucinate on silence

Whisper was trained on subtitled video. Five seconds of room tone returns
`ご視聴ありがとうございました` — "thank you for watching" — three runs out of
three. Pinning `language: "en"` reduces it to `". "`. Adding a transcription
`prompt` makes it markedly **worse**, because it primes the model to produce a
well-formed sentence.

Three layers defend this: `near_field` noise reduction, a tuned VAD, and
`isLikelyHallucination()` filtering the display. Do not remove any one of them
on the grounds that the others cover it.

### 5. A blank answer is not an invitation to fill it in

At signing, only fields that came out of the interview *with a value* were
locked. Every blank one stayed editable, so DocuSeal walked the seller through
each of them — a second pass at the form, in the form's own language.

All 135 interview fields are now locked whether or not they carry a value.
The 9 signature/initial/date fields stay open. `voice-check` asserts this.

---

## What has never been verified

Be honest about this with whoever asks. Both are first-contact paths.

**A live spoken conversation.** No microphone exists in any environment this
was built in. The tool contract, prompt, turn reducer, hallucination filter
and token minting are all tested; nobody has talked to it. A scripted-
conversation harness was used to hunt for bugs from text and then deliberately
removed — its findings live on as assertions in `voice-check.ts`.

**A DocuSeal signing session driven to completion.** The webhook is properly
tested (valid accepted; replay, tamper and forged signatures all rejected;
unknown submission ignored rather than trusted) and the state machine is
asserted. Nobody has actually signed.

---

## Environment and standing caveats

- **`DOCUSEAL_WEBHOOK_SECRET` in `.env` is a local test value.** Replace with
  the real `whsec_…` from Console → Webhooks → Security before anything real.
- **Email is a log-only seam.** `src/mail/send.ts` prints to the server console
  and keeps an in-memory outbox. Signup and password-reset links appear in the
  `npm run dev` terminal. A real provider is a one-file swap, marked where.
- **Rate limiting is in-memory**, so the budget is per instance. Correct for
  one deployable and commented as such; behind several, an attacker gets the
  limit times the instance count.
- **Supabase session pooler, port 5432.** Not 6543 — `drizzle-kit migrate`
  needs prepared statements. The pool is capped and reused via `globalThis`
  because hot reload otherwise exhausts the 15-client limit.
- **4 of 144 PDF fields have no slot.** The supplied PDF is a paraphrased TDS,
  not the official C.A.R. form — it is missing four checkboxes the real form
  has, and its header fields are literal `[City]` tokens inline in prose.
  Enumerated in `BUILD_PLAN.md` §3.

---

## Deliberately not built

Stated so a gap reads as a decision rather than an oversight:

Buyer and selling-agent signature routing — a TDS is completed at listing,
before an offer exists, so there is no buyer to sign. The acknowledgement of
receipt is a second submission at offer time. Multi-unit per-unit branching.
Attach-additional-sheets overflow. Co-seller divergent answers. Real-time
collaboration.

---

## Working style that paid off

- **Verify, do not assert.** Most bugs in this repo were found by rendering
  the result, curling the endpoint, or measuring the timing — not by reading.
  Several were found by writing the assertion that would catch them.
- **Every non-trivial rule leaves one runnable check**, framework-free, in
  `scripts/`. That is why the suites read like sentences.
- **The registry is the single source of truth.** Where the UI needed a
  judgement the registry did not carry — chip versus explicit Yes/No — it was
  derived from registry data (`isPresenceChip()` reads the label's own
  phrasing) rather than by adding a list of ids.
- **Never block the seller.** Conflicts are notes. "I don't know" is an
  answer. Skipping defers rather than refusing. An abandoned session is worse
  than an inconsistent one, and every dead end has a working way out.
