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

## 2. Seller form path — "What's in the home" only

**Goal:** one chapter, end to end, real answers in the DB.

This chapter is 46 visible questions across 9 groups and it's the first thing a
seller touches. It's where the "ninety seconds, not torture" claim either holds
up or doesn't. Everything needed is exported: `groupsInChapter`, `isVisible`,
`questionsInChapter`, option lists.

**Acceptance**
- [ ] Renders from the registry — zero hardcoded labels
- [ ] Grouped by `group`, tappable grid, thumb-reachable on mobile
- [ ] Gated questions appear/disappear live (`A.garage` → `A.garage_type`)
- [ ] Optimistic local write, then server; survives a hard refresh mid-chapter
- [ ] Mic affordance on every question (can be a no-op stub for now)

**Do not** build a scrolling replica of the PDF page. Chunk it.

---

## 3. DocuSeal template + first filled PDF — DE-RISK HERE

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
- [ ] Template exists in DocuSeal Test Mode
- [ ] `expectedFieldNames()` diffed against the real template, zero mismatches
- [ ] `buildSubmission()` produces a submission with seller values prefilled and
      locked readonly
- [ ] A downloaded PDF shows correct checkboxes for a seeded answer set
- [ ] Section C's shared explain box renders numbered per-question explanations

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
