# Build Plan

Ordered. Each task is independently shippable and has acceptance criteria. Work
one at a time; run `npm run validate && npm run smoke` after anything that
touches `src/tds/`.

Rough effort split to aim for: **40% seller experience, 25% voice, 20% DocuSeal,
15% agent view.**

---

## ✅ 0. Question registry — DONE

89 questions, 135 DocuSeal fields, gates, follow-ups, progress, resume, 19
conflict rules, field mapping. See `docs/REGISTRY.md`.

---

## ✅ 1. Database and seed — DONE

**Goal:** persistence for everything the registry produces.

Tables: `agents`, `deals`, `disclosure_requests`, `answers`, `sessions`.
`answers` unique on `(deal_id, question_id)`.

**Acceptance**
- [x] Drizzle schema + migration runs clean
- [x] Seed script creates one agent, one deal, one disclosure request with token
- [x] Answer upsert helper that records `source`, `confidence`, `verbatim`
- [x] Every answer mutation writes an audit row (who, what, when, from where)

Verified against a live Supabase instance: `npm run db:migrate && npm run
db:seed && npm run db:check`. The seeded mid-flow deal reports 35%, an agent
queue of two, one deferred question, and three detected conflicts — all read
back out of the database, not from memory.

**Gotcha:** store the seller token *hashed*. The plaintext exists only in the
link you email.

---

## ✅ 2. Seller form path — "What's in the home" — DONE

**Goal:** one chapter, end to end, real answers in the DB.

This chapter is 46 visible questions across 9 groups and it's the first thing a
seller touches. It's where the "ninety seconds, not torture" claim either holds
up or doesn't. Everything needed is exported: `groupsInChapter`, `isVisible`,
`questionsInChapter`, option lists.

**Acceptance**
- [x] Renders from the registry — zero hardcoded labels
- [x] Grouped by `group`, tappable grid, thumb-reachable on mobile
- [x] Gated questions appear/disappear live (`A.garage` → `A.garage_type`)
- [x] Optimistic local write, then server; survives a hard refresh mid-chapter
- [x] Mic affordance on every question (can be a no-op stub for now)

Verified in a 375px browser against the seeded deal: nine groups walked end to
end, taps persisted with `source: "form"`, tapping Fireplace revealed both its
gated chip and its gated text field without a round trip, and a hard refresh
landed back on the right group with state intact.

**Interaction:** tap-what-you-have chips, then one confirm per group that turns
untapped chips into an explicit `false`. Booleans phrased as questions in the
registry ("Is there a child-resistant barrier?") get an explicit Yes/No instead
— derived from the label, not a hardcoded list. `scripts/form-check.ts` asserts
that split, and that every group stays reachable.

**Do not** build a scrolling replica of the PDF page. Chunk it.

---

## ✅ 3. DocuSeal template + first filled PDF — DONE

**Goal:** get an ugly, real, filled PDF out before the UI is pretty. This is the
integration most likely to eat a day you didn't budget.

Two routes, use both:
- **Section C** → programmatic. Extract the 16 row baselines from
  `assets/ca-tds-blank.pdf` with pdfplumber or PyMuPDF, replace the placeholders
  in `SECTION_C_GEOMETRY`, and `sectionCTemplateFields()` generates all 32
  checkbox fields for `create_template_from_pdf`.
- **Section A grid + signature blocks** → place by hand in the DocuSeal template
  builder. Irregular layout, not worth automating.

**Acceptance**
- [x] Template exists in DocuSeal Test Mode — #5513507, 127 live fields
- [x] `expectedFieldNames()` diffed against the real template — **zero fields in
      the template unknown to the registry**, and the 8 registry fields with no
      slot are enumerated and explained below
- [x] `buildSubmission()` produces a submission with seller values prefilled and
      locked readonly
- [x] A downloaded PDF shows correct checkboxes for a seeded answer set
- [x] Section C's shared explain box renders numbered per-question explanations
      — verified reading `13. Foothill Terrace Homeowners Association. Dues are
      about $240 a month.`

**The whole template is generated, not hand-placed.** Every checkbox on the TDS
is a `□` glyph with a real position in the PDF content stream.
`scripts/extract_boxes.py` pulls all 117 out with their trailing label;
`scripts/build-template.ts` matches them to the registry and posts
`create_template_from_pdf`. 127 of 135 fields place automatically. Field *names*
always come from the registry's `docuseal` mapping — only geometry is resolved
in the script.

Matching is positional wherever labels are unreliable: the 16 Section C rows and
all 8 option groups are matched in reading order against registry order, because
the registry's option labels are seller-facing ("Yes, I live here") while the
form says "is". Plain checkboxes match by label, exact before prefix, longest
first — a loose prefix match let "Pool" claim the box belonging to "Pool/Spa
Heater".

**The supplied PDF is not the official C.A.R. form.** It is a paraphrased
regeneration: header fields are literal `[City]` / `[County]` / `[Date]` tokens
inline in a sentence rather than blank lines, and four checkboxes present on the
real form are simply absent from it. `scripts/prepare_pdf.py` strips those
tokens to produce the template base, since a field placed over one renders on
top of it and both become unreadable.

**The 8 fields with no slot**, all confirmed by rendering the page:
`a_fireplace`, `a_exhaust_fans`, `a_220_wiring` — no checkbox exists on this
form, only an "in ______" blank, which their location text fields do fill.
`property_address`, `property_address_p2/p3`, `date_p2/p3` — this version has no
street-address line and no per-page footers.

**Gotcha:** Test Mode has its own separate API key. Don't pay for anything.

---

## 4. Voice path — "Things you know about" (Section C)

**Goal:** the hardest and most impressive piece. Sixteen questions that are
unintelligible as written, asked conversationally.

Server mints an ephemeral Realtime token; browser connects over WebRTC. Agent
gets `voiceToolSchemas()`. Server owns the queue via `nextQuestion()`.

**Acceptance**
- [ ] Entirely in-browser — no phone numbers, no telephony
- [ ] Agent asks using `voicePrompt`, explains using `plainEnglish` + `examples`
- [ ] Every write passes `validateAnswer()`; confidence < 0.75 → re-ask
- [ ] `record_explanation` fires immediately after a yes, before the next question
- [ ] `mark_unknown` probes the "don't know" vs "not aware" distinction first
- [ ] `switch_to_form` hands off instantly, no pushback
- [ ] Live transcript visible on screen — the seller should see what's being recorded

**Gotcha:** the agent must not add facts the seller didn't state when drafting
explanations. Put that in the system prompt explicitly.

---

## 5. Handoff, resume, progress

**Goal:** the three seller-experience requirements that make or break this.

**Acceptance**
- [ ] Switch modality mid-chapter, no work lost, no re-asking answered questions
- [ ] Close the tab at question 20, reopen via link, land back on 20 with
      `resume()`'s welcome-back copy
- [ ] Progress shows chapters and `"About N minutes left"`, never "field 87 of 150"
- [ ] Skipped questions return at the end — "come back to it" has to mean something

---

## 6. Agent view

**Goal:** the other half of the product.

**Acceptance**
- [ ] Email + password login, session cookie, CSRF on mutations
- [ ] Create seller / deal; fill the `agentOnlyQuestions()` (county, legal
      description, substituted disclosures)
- [ ] Send disclosure request; see status (not started / in progress / submitted)
- [ ] Review submitted answers with the seller's `verbatim` alongside
- [ ] `agentQueue()` — the "I don't know" and "flag for agent" list
- [ ] Link to the filled DocuSeal form

---

## 7. Conflicts and unknowns in the UI

**Acceptance**
- [ ] `conflictsFor()` renders a quiet inline note on the current question
- [ ] `detectConflicts()` renders review cards before signing, hard ones first
- [ ] Both conflicting answers quoted verbatim, "which is right?" framing
- [ ] Hard conflicts are dismissible with a recorded acknowledgement — a seller
      who insists both are right is allowed to be right
- [ ] Nothing ever blocks

---

## 8. Write-up

**Treat as a real deliverable, not a footnote.** The brief says *"Then defend
it."* This is probably a third of the grade.

**Acceptance**
- [ ] The routing decision, with criteria and the question-by-question table
- [ ] How the two paths stay consistent (one store, two adapters, nothing to sync)
- [ ] How each of their five failure modes is handled
- [ ] Auth explained — including why sellers get magic links, not accounts
- [ ] **What you skipped and why.** They asked for deliberate choices. A stated
      omission reads as senior; a silent gap reads as unfinished.

---

## Deliberately out of scope

Buyer and selling-agent signature routing. Multi-unit per-unit branching.
Attach-additional-sheets overflow. Co-seller divergent answers. Real-time
collaboration. Say all of this in the write-up.
