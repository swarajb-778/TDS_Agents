# Decisions, defended

The brief asks for a voice/form routing decision and then says: *"Then defend
it."* This is that. It also answers the six seller-experience questions the
brief raises, explains the auth model, and states what I deliberately did not
build.

Numbers here are generated from the code, not remembered: 89 questions, 144
DocuSeal fields of which 140 are placed, 20 conflict rules, 18 follow-ups, 15
gated questions, 28 questions where "I don't know" is a legitimate answer.

---

## 1. The one decision everything else falls out of

Before any UI, there is a **declarative question registry** —
[`src/tds/registry.ts`](../src/tds/registry.ts). Every question on the TDS,
declared once, with its plain-English translation, its voice prompt, its
follow-up rule, its gate, and its PDF field name.

Everything downstream is a projection of it:

```
                    src/tds/registry.ts
                            │
     ┌──────────────┬───────┴───────┬──────────────┐
     ▼              ▼               ▼              ▼
Form renderer   Voice agent    Conflict rules   DocuSeal
(type, options, (voicePrompt,  (question ids)   (field map)
 group, gates)   tool schemas)
     │              │               │              │
     └──────┬───────┘               │              │
            ▼                       │              │
      answers table ◄───────────────┴──────────────┘
   (deal_id, question_id, value, status,
    source, confidence, verbatim, updated_at)
```

This is not architecture for its own sake. It is what makes the rest of this
document cheap:

- **"Switchable mid-flow" stops being a sync problem.** There is one answer
  store and two input adapters writing to it. Nothing to reconcile, because
  nothing is duplicated.
- **Conditional structure stops being scattered `if`s.** Section B's gate over
  sixteen components, Section C's shared explain box, Section A's
  "not in operating condition" gate — all `gatedBy` / `followUp` declarations.
- **The PDF mapping has no per-question special cases.**
  [`toFieldValues()`](../src/tds/docuseal.ts) is a pure function over the answer
  set.

The rule I held to throughout: **never hardcode a question, label, option, or
field name anywhere else.** Where the UI needed a judgement the registry didn't
carry — chip versus explicit Yes/No — I derived it from registry data rather
than adding a list of ids. See §2.4.

---

## 2. The routing decision

### 2.1 Criteria, chosen before looking at the questions

So the result is defensible rather than vibes.

**Form when:**

- The seller already knows the answer without thinking about it
- The answer space is closed and small
- Speed dominates — forty checkboxes read aloud is torture; forty taps in a
  grouped grid is ninety seconds
- Scanning a list aids recall better than being asked one at a time

**Voice when:**

- The seller may not understand what is being asked
- The honest answer is "sort of", and has to be negotiated into a yes or no
- A bare "yes" is worthless without narrative — and typing a paragraph on a
  phone at 10pm is the single worst interaction in the product
- Recall benefits from prompting and follow-up

### 2.2 Applied

| Chapter | TDS | Questions | Route | Why |
|---|---|---|---|---|
| Your property | Header / I | 8 | **Agent** | Nobody knows their own legal property description. Asking a seller for it is how you lose them in the first thirty seconds. |
| Living situation | II | 1 | Form | One tap, zero ambiguity. |
| What's in the home | II.A | 55 | **Form** | Mechanical, closed, visual. Grouped by where things physically live, so the seller walks the house in their head. |
| Anything not working | II.A gate | 2 | **Voice** | A memory task over forty items they just ticked. Memory tasks want prompting. |
| The building itself | II.B | 4 | **Voice-led, form-confirmed** | "Significant defect" is a judgement word. See §2.5. |
| Things you know about | II.C | 17 | **Voice** | Unintelligible as written. The translation *is* the product. |
| Two things to confirm | II.D | 2 | Neither | Covenants about closing day, not questions. Read and acknowledge. |

Net: **61 form, 20 voice, 8 agent-only.**

### 2.3 Question by question, where it gets interesting

The chapter table hides the actual argument, which happens inside Section A.
Two examples of the same chapter splitting:

**`A.dishwasher` → form.** The label is a noun. The seller knows. One tap.

**`A.water_heater_type` → form, but `allowUnknown: true`.** A closed enum
(gas/solar/electric) that a lot of homeowners genuinely cannot answer. Routing
it to voice would be worse — the agent can't see the label on the tank either.
So it ships with "Not sure" as a first-class option and an identification hint
in the voice prompt for sellers who do switch.

**`A.pool_child_barrier` → form, but explicit Yes/No, never a chip.** This is a
child-safety question with legal weight. "Tap if you have a child-resistant
barrier" is not something anyone should be signing under penalty of perjury.

**`C.3` ("encroachments, easements or similar matters") → voice.** Nobody
outside the trade knows what that means. The registry carries the translation:
*"Does a neighbour's fence, shed or driveway cross onto your land? Does anyone
have a legal right to cross your property — a utility company, a neighbour?"*
The plain-English gloss and concrete examples are the highest-value fields in
the whole registry.

### 2.4 Chip versus explicit Yes/No, derived not hardcoded

Inside "What's in the home", 41 of 55 questions are **presence chips** — tap
what you have — and the rest get explicit controls. That split is derived from
the registry's own phrasing:

> Inventory items are nouns (`"Dishwasher"`). Real questions end in a question
> mark (`"Is there a child-resistant barrier?"`).

`isPresenceChip()` in [`form-view.ts`](../src/tds/form-view.ts) is that one
line. No list of ids, and if someone rewords a label into a question it moves
automatically. `scripts/form-check.ts` asserts the split, including that the
three safety questions never become chips.

**The confirm is load-bearing.** Each group ends with "that's everything here",
which turns untapped chips into an explicit `false`. Without it, "the seller
says there is no sauna" and "the seller never reached this group" would be
indistinguishable in the database — unacceptable on a document signed under
penalty, and it would give the progress meter nothing to count.

### 2.5 The one hybrid

Section B is the only place both paths run on the same question, deliberately.

- **`B.gate` → voice.** The seller has to be talked through what "significant"
  means.
- **`B.components` → form.** The seller should *see* sixteen checkboxes tick and
  be able to untick one — not have to remember what the agent said it heard.
- **`B.explain` → voice-captured, form-approved.** Speech is roughly four times
  faster than thumb-typing, but the seller reads and edits the final text before
  it goes on the form.

### 2.6 Modality is a default, not a jail

`defaultModality` decides where the seller *lands*, not where they are stuck.

- Every form question carries a mic affordance ("Rather say it out loud?").
- Every voice screen carries "Just show me the buttons" — **in every state**,
  not only mid-call. A seller who blocks the microphone would otherwise be
  stranded on a screen whose only control needs a microphone.
- The voice agent's system prompt says, verbatim: *"Do not talk them out of it,
  do not ask why, do not offer to keep going."*
- The choice is remembered — but only when it is an actual choice. See §4.6.

---

## 3. How the two paths stay consistent

There is one table, `answers`, unique on `(deal_id, question_id)`, and one write
function: `writeAnswer()` in [`src/db/answers.ts`](../src/db/answers.ts). Both
modalities call it. Both read the same `AnswerMap`.

**Position is derived, never stored.** `nextQuestion(answers)` is a pure
function of the answer set. Voice and form ask the same function and get the
same answer, so there is no cursor that can disagree with the data. This is also
what makes closing the tab free rather than a feature.

**Switching pulls the map back first.** `switchTo()` refetches before rendering
the other path, so neither side can re-ask something the other just answered.
Verified end to end: the voice agent recorded `C.2` mid-chapter, the seller took
the escape hatch, and the form rendered that answer already selected.

**Every write records where it came from.** `source` (which modality), plus
`confidence` and `verbatim` for voice. `answer_events` is append-only and
written in the same transaction as the state change — a state change without its
audit row is not possible. This is a legal document; the audit trail is not
optional.

---

## 4. The six things the brief asked about

### 4.1 What order should questions come in?

**Not PDF order.** The PDF opens with legal description and county, which is the
worst possible first question and the reason those 8 fields belong to the agent.

The flow opens with the appliance checklist: easy, fast, momentum-building — and
it primes recall for Sections B and C by mentally walking the seller through
their house. Emotionally loaded questions (admitting your house has problems)
come after trust is established, not first.

Within "What's in the home", groups are ordered by **where things physically
live**: kitchen, heating, safety, media, outside, water, garage, pool, roof.

### 4.2 "I don't understand this question"

Every question carries `plainEnglish`, `whyWeAsk` and `examples`. In the form
these render under the label; in voice the agent has them in its brief and is
told to *"give a concrete example rather than a definition — 'a neighbour's
fence that crosses onto your land' beats 'an encroachment'."*

One guardrail, stated in the prompt: this is explanation, not legal advice. The
fallback is always to flag it for the agent.

### 4.3 "I don't know"

A first-class answer status, not a validation failure. 28 questions carry
`allowUnknown`, and the form shows "Not sure" as a real option beside Yes and
No. Unknowns route to `agentQueue()`.

**The part worth arguing:** the TDS asks what the *seller is aware of*. "I don't
know" is very often legitimately "no — not aware of any", and sellers conflate
the two constantly. The voice agent is instructed to check before recording:

> *"Just so I get this right — do you mean you're not aware of any, or that you
> genuinely aren't sure?"*

Surfacing that distinction, rather than silently coercing either way, is the
single highest-leverage thing in the voice prompt.

### 4.4 Contradictions

20 rules, 8 hard and 12 soft, evaluated on every write. Three rules govern the
handling:

1. **Never block.** A conflict is a note, never a modal. An abandoned session is
   worse than an inconsistent one — the inconsistent one can be fixed at review.
2. **Never auto-correct.** The seller owns this document and signs it under
   penalty. Silently "fixing" an answer is the worst thing this system could do.
3. **Quote both answers back.** Never "you made an error" — the seller isn't
   wrong, the form is confusing.

They surface twice: a quiet inline note on the question just answered, and a
review screen before signing with hard conflicts first, quoting both sides in
the seller's own terms — including their `verbatim` where it came from voice:

> **Is there an HOA?** You said: yes
> *"Yeah there's an HOA, Foothill Terrace something."*
> **Any written rules attached to the property?** You said: no

Then two buttons: *Change an answer*, or **Both are right**.

**Acknowledging settles the question; it does not edit the answer.** A seller who
insists both are right is allowed to be right. The contradiction stays in the
data and stays visible to their agent — all that changes is the seller stops
being asked. `db-check.ts` asserts the answer is untouched afterwards and the
rule still fires.

### 4.5 How do they know how much is left?

Chapters and minutes, never "field 87 of 150". A raw field count would lie:
15 questions are gated, so a seller with no defects has a genuinely shorter form
than one with defects. `progress()` counts only currently-visible questions and
sums `estimatedSeconds` on what remains — about 13 minutes for a full pass.

The header shows one segment per chapter plus *"About 8 minutes left"*.

**Skipping is real.** "Come back to this" sets `status: "skipped"`, and
`nextQuestion()` holds those back until nothing new remains. Two bugs worth
naming, because both were found by building this rather than by reasoning about
it:

- Originally, skipped questions were treated as unanswered, so tapping "come
  back to this" handed the seller the same question straight back. Skipping was
  a no-op, and a broken promise is worse than no button.
- Fixing that created the opposite trap: skip the *last* outstanding question
  and it returns forever. `inDeferralPass()` detects that state and offers
  *"that's everything I can answer — leave the rest for my agent"*.

### 4.6 What happens if they close the tab?

Nothing is lost, because nothing was ever only in the browser. Every answer is
written on the interaction that produced it — optimistic locally, then to the
server — and position is derived from the answers.

Re-entry through the same link lands on `resume()`'s welcome-back copy, which
names the place rather than a percentage:

> *"Welcome back — you were on 'Things you know about'. About 8 minutes left.
> Pick up there, or review what you've done so far."*

Plus, if anything was set aside: *"1 thing you asked to come back to is still
waiting — it'll come round again at the end."*

**The modality preference is remembered — but only when it was a choice.** An
earlier version persisted "form" on every routine write, which meant working
through the form-only chapters would silently opt a seller out of voice for
Section C, exactly where voice earns its place. Preference is now recorded only
on an explicit switch, and the absence of a session row means "never chose"
rather than "chose form".

A failed write leaves the answer on screen and says so, rather than blocking:
*"Couldn't reach the server just now. Your answers are still here — keep going
and we'll save them."*

---

## 5. Auth

**Agent: email + password.** Password hashed with `scrypt` from `node:crypto`
(salted, `timingSafeEqual` comparison) — a real KDF with no native dependency to
fight. Session as an httpOnly, `Secure`, `SameSite=Lax` cookie, CSRF token on
mutations.

**Seller: no account, no password.** An opaque 256-bit token from the CSPRNG,
delivered as a magic link, **stored only as a SHA-256 hash**, scoped to exactly
one disclosure request, expiring in 14 days and reissuable by the agent.

Two things worth defending:

*Why no account:* a stressed seller at 10pm will not create one, and forcing it
is where you lose them. This is the same pattern DocuSign and DocuSeal use for
signers.

*Why SHA-256 and not scrypt for the token:* a KDF exists to make guessing a
low-entropy secret expensive. This token is 256 random bits — there is nothing
to guess, and scrypt would only add latency to every page load. Hashing at all
is what matters: a leaked database must not yield working magic links.

**Authorisation:** every row is scoped `agent_id → deal_id`. The seller token
grants read/write on one deal's answers and nothing else. Both voice routes
reject an unknown token with a generic 401 — verified, along with the fact that
the standing `OPENAI_API_KEY` never appears in the client payload.

**Keys never reach the browser.** Realtime sessions use a server-minted
ephemeral token (`ek_…`, 10-minute expiry), issued only to a caller holding a
valid magic link.

---

## 6. Voice: the model does not own the state machine

Worth stating separately because it is the part most likely to be built badly.

`flow.ts` owns the question queue. The model gets five tools; every call is
executed **server-side** by `/api/voice/tool`, which validates through
`writeAnswer()` and replies with the next question from `nextQuestion()`. The
system prompt says *"You do not decide what comes next"* — but the contract does
not depend on the model honouring it.

`scripts/voice-check.ts` calls that route handler directly with the calls a
model would make, and asserts it cannot:

- write below the 0.75 confidence threshold (rejected, and re-asked)
- write a value the registry's type rejects, **however confident it claims to
  be** — `value: "probably"` at `confidence: 0.99` is still refused
- invent a question id
- skip a follow-up: a `yes` on `C.13` queue-jumps to `C.13.explanation`
- change any answer by switching the seller to the form

Two prompt rules are stated as absolutes rather than preferences:

> **Never write down a fact the seller did not say.** Do not add a cause, a
> date, a cost, or a severity they did not give you. Thin and true beats
> complete and invented.

and the "not aware" check in §4.3.

The seller sees a live transcript and a running list of what has been written
down. They should never have to wonder what is being recorded about them.

---

## 7. DocuSeal

The supplied PDF is flat. The plan was to script Section C's 32 checkboxes and
place the rest by hand.

**That turned out to be unnecessary.** The TDS is flat but not opaque: every
checkbox on it is a `□` glyph with a real position in the content stream.
`scripts/extract_boxes.py` pulls all 117 out with the label following each, and
`scripts/build-template.ts` matches them against the registry and posts
`create_template_from_pdf`.

**140 of 144 fields place automatically, with zero fields in the template
unknown to the registry** — which is the diff that matters, because a typo'd
field name fails *silently*: the submission succeeds and the answer vanishes.

Matching is positional wherever labels are unreliable — the 16 Section C rows
and all 8 option groups match in reading order against registry order, because
registry option labels are seller-facing ("Yes, I live here") where the form says
"is". Plain checkboxes match by label, exact before prefix and longest first: a
loose prefix match let `"Pool"` claim the box belonging to `"Pool/Spa Heater"`.

**The supplied PDF is not the official C.A.R. form.** It is a paraphrased
regeneration. Header fields are literal `[City]` / `[County]` / `[Date]` tokens
*inline in a sentence* rather than blank lines, so a field placed over one
renders on top of it and both become unreadable — `scripts/prepare_pdf.py`
strips them. Four checkboxes present on the real form are simply absent from
this one; I rendered each region to confirm rather than assume.

Section C's shared explain box is the design payoff. The PDF gives sixteen
questions one text box. Asking a seller to explain all their yeses at the end
produces mush — by then they have forgotten which was which. Explanations are
captured per question at the moment of the yes and composed at render time,
numbered:

> `13. Foothill Terrace Homeowners Association. Dues are about $240 a month.`

**Signers:** three roles get fields — Seller 1, Seller 2, Listing Agent —
signature, date, printed name, plus seller initials. The buyer acknowledgement
block and the selling agent's line are deliberately **unassigned**: a TDS is
completed at listing, before an offer exists, and the buyer signs the
acknowledgement of receipt later as a second submission. That is a domain fact,
not a gap.

---

## 8. The interface

Two surfaces, two users, one system. A stressed non-technical person completing
a legal document on a phone at 10pm, and a professional reading what they
submitted on a desktop. Neither is helped by anything fashionable.

### 8.1 Where the style came from, and where I overrode it

I ran the product through a design-system generator. Querying it on "real
estate" returned a **luxury marketing landing page** — Exaggerated Minimalism,
`clamp(3rem, 10vw, 12rem)` headings, Cinzel display serif. That is a plausible
answer for a brokerage's homepage and an actively hostile one for a form.

Querying the actual product type — form completion under stress, plain
language, accessibility — returned **"Accessible & Ethical"**: the profile for
government, healthcare and legal-compliance products. High contrast, 16px+
body, visible focus, 44px targets, motion that can be turned off, WCAG AAA.
That is the system this is built on.

Two of its recommendations I did not take:

**Orange `#F97316` as the call-to-action.** Amber already means one thing in
this product: *two of your answers disagree, have a look.* An orange submit
button would put the one signal that matters into competition with every button
on the screen. Warm colour is reserved; the primary is a deep teal, which also
leaves the whole warm half of the spectrum free.

**A second font family for the dashboard.** The real requirement was tabular
figures so data columns do not jitter. `font-variant-numeric: tabular-nums`
gives that from the one font already loaded.

### 8.2 Tokens, and why contrast is a test rather than a claim

Components never write a raw hex. `globals.css` defines semantic tokens —
`canvas`, `surface`, `ink`, `ink-muted`, `brand`, `attention`, `danger` — and
both themes are designed rather than inverted. Dark mode is not decoration
here: the brief's seller is doing this *"at 10pm after work"*, so a phone in a
dark room is the actual usage context.

`npm run contrast:check` parses the real values out of `globals.css` and asserts
sixteen foreground/background pairs against WCAG **in both themes**. It is a
test because contrast is the first accessibility rule and the easiest to get
wrong by eye — a dark palette that looks fine can sit at 2:1.

It caught three failures immediately: input borders at 2.13:1 and 1.93:1 against
the 3:1 minimum for non-text UI, and hint text at 4.22:1 against 4.5:1. All
three would have shipped.

### 8.3 Four bugs found by looking rather than assuming

**Light mode never shipped.** Tailwind v4's `@theme` is a build-time directive;
nesting it inside `@media` does not make it conditional. Tailwind hoisted both
blocks and the dark one overwrote the light one, so the compiled CSS contained
no `prefers-color-scheme` rule at all. It looked correct only because the test
browser happened to be in dark mode. Dark now overrides through a plain `:root`
rule inside the media query, and the compiled output was checked for both.

**The login page redirected to itself.** `/agent/login` sat inside the layout
that sends unauthenticated visitors to `/agent/login`. Infinite loop; login was
unreachable. Fixed with a route group so the guard covers the app pages only.

**Connection pool exhaustion.** Every hot reload opened a fresh Postgres pool
against Supabase's fifteen-client session pooler. The same shape hurts in
production, where each serverless instance opens its own against the same
fifteen. Capped at five, idle-timed, and reused across reloads.

**The escape hatches were the hardest things to tap.** *"Leave the rest for my
agent"*, *"rather say it out loud"*, *"come back to this"* — the affordances a
struggling seller most needs — rendered as 20px inline links against a 44px
minimum. Their hit areas now extend past their visual bounds.

### 8.4 What the interface does not do

No theme toggle: the OS preference is respected and nothing overrides it. No
animation beyond 150–200ms state transitions, all of which stop under
`prefers-reduced-motion`. No icon library — the few affordances are words,
because words survive translation, screen readers, and a seller who has never
seen this product before.

---

## 9. What I skipped, and why

The brief asks for deliberate choices about what to handle and what to skip. A
stated omission reads as a decision; a silent gap reads as unfinished.

**Not built:**

- **The agent view.** The largest remaining piece. The brief ranks it below the
  seller experience, and I ran the tasks in grade-impact order. The pieces it
  needs already exist and are tested — `agentQueue()`, `reviewConflicts()`,
  `answerHistory()`, `agentOnlyQuestions()`, and every answer's `verbatim`.
- **Buyer and selling-agent signature routing.** See §7 — there is no buyer at
  disclosure time.
- **Multi-unit duplex/triplex per-unit branching.** The header flag exists; the
  branching does not. A four-unit TDS is four disclosures, and modelling that
  properly is a bigger change than it looks.
- **Attach-additional-sheets overflow** when an explanation exceeds the box.
- **Co-seller divergence.** Both sellers sign, but they answer as one voice.
- **Real-time collaboration.**

**Known gaps, enumerated rather than hidden:**

- 4 of 144 fields have no slot on the supplied PDF: `a_fireplace`,
  `a_exhaust_fans`, `a_220_wiring` (no checkbox exists on the real form either —
  only an "in ______" blank, which their location text fields do fill) and
  `property_address` (page 1 of this regeneration has no address line, though
  pages 2 and 3 repeat one and the answer is mirrored into both).
- Header fields render at 6pt because this PDF puts them mid-sentence.
- **A live spoken conversation is untested.** The browser available during
  development blocks microphone capture, so WebRTC negotiation and real speech
  are unverified. Everything server-side — prompt, tool contract, token minting,
  auth rejection, mic-denied fallback, the voice→form handoff — is verified.

---

## 10. How to check any of this

```bash
npm run check        # typecheck, registry, flow, form projection, contrast
npm run db:check     # upsert, audit trail, statuses, conflicts, credentials
npm run voice:check  # the voice tool contract, against the real route handler
npm run docuseal:fill "Marcus Oyelaran"   # a real filled, signed PDF
```

The checks are assertions, not print-outs. They are deliberately the smallest
thing that fails if the logic breaks — no framework, no fixtures. Several of the
bugs described in this document were found by writing them.
