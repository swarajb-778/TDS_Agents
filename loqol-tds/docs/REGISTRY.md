# TDS Question Registry

The declarative spec for the California Transfer Disclosure Statement. Every
question on the form, declared once, with its plain-English translation, its
voice prompt, its follow-up rules, and its PDF field mapping.

Everything else in the app is a projection of this:

```
                    src/tds/registry.ts
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   Form renderer      Voice agent           DocuSeal
   (type, options,   (voicePrompt +        (docuseal
    group, gates)     tool schemas)         mapping)
        │                   │                   │
        └────────┬──────────┘                   │
                 ▼                              │
          answers table ────────────────────────┘
     (deal_id, question_id, value, status,
      source, confidence, verbatim, updated_at)
```

**89 questions → 135 DocuSeal fields.** Section C's 32 checkbox fields are
generated programmatically from geometry; the rest are placed in the template
builder.

## Files

| File | What it holds |
|---|---|
| `types.ts` | Question, Answer, Gate, FollowUp, DocuSealMapping, ConflictRule |
| `registry.ts` | The form itself — chapters, all questions, translations, voice prompts |
| `flow.ts` | Gates, next-question, follow-up synthesis, progress, resume, voice tool schemas, write validation |
| `conflicts.ts` | 19 cross-answer rules with seller-facing messages |
| `docuseal.ts` | Field mapping, submission builder, Section C template geometry |

```bash
npx tsc --noEmit          # typecheck
node scripts/smoke.js     # exercises gates, progress, conflicts, field mapping
```

`validateRegistry()` catches dangling gate references, enum questions with no
options, duplicate ids, and voice-first questions missing a voice prompt. Run it
in CI.

---

## The routing decision

> *"A seller should never feel like they're being made to use the wrong tool for
> the question in front of them."*

### Criteria

**Form** when the seller already knows the answer without thinking, the answer
space is closed and small, and speed dominates. Forty checkboxes read aloud is
torture; forty taps in a grouped grid is ninety seconds.

**Voice** when the seller may not understand what's being asked, when the honest
answer is "sort of" and has to be negotiated into a yes or no, when a bare "yes"
is worthless without narrative, or when recall benefits from prompting. Typing a
paragraph on a phone at 10pm is the worst interaction in the product.

### Applied

| Chapter | TDS | Route | Why |
|---|---|---|---|
| Your property | Header, I | **Agent** | Nobody knows their own legal description. Sellers shouldn't be asked. |
| Living situation | II | Form | One tap, zero ambiguity. |
| What's in the home | II.A | **Form** | Mechanical, closed, visual. Grouped by where things physically live so the seller walks the house in their head. |
| Anything not working | II.A gate | **Voice** | A memory task over forty items they just ticked. Memory tasks want prompting. |
| The building itself | II.B | **Voice-led, form-confirmed** | "Significant defect" is a judgment word. Seller talks, agent extracts components, seller *sees the boxes tick* and confirms. |
| Things you know about | II.C | **Voice** | Unintelligible as written. The translation is the product. |
| Two things to confirm | II.D | Neither | Covenants about closing day, not questions. Read and acknowledge. |

### Escape hatches

`defaultModality` decides where the seller *lands*, not where they're stuck.
Every form question carries a mic affordance ("not sure — talk me through it").
Every voice question carries `switch_to_form`, and the agent is instructed not
to talk them out of it. The override is remembered for the session.

Two questions get an escape hatch by design rather than as a fallback:
`A.water_heater_type` and `A.water_conserving_fixtures` are closed enums a lot
of homeowners genuinely can't answer, so they ship with `allowUnknown: true` and
an identification hint in the voice prompt.

### The one hybrid

Section B is the only place both paths run on the same question, and it's
deliberate. Voice handles `B.gate` because the seller has to be talked through
what "significant" means. **Form** handles `B.components` — because a seller
should see sixteen checkboxes tick and be able to untick one, not have to
remember what the agent said it heard. `B.explain` is voice-captured and
form-approved: speech is roughly four times faster than thumb-typing, but the
seller reads and edits the final text before it goes on the form.

---

## Design decisions worth arguing with

**Chapter order is not PDF order.** The PDF opens with legal description and
county — the worst possible first question. We open with the appliance
checklist: easy, momentum-building, and it primes recall for Sections B and C by
walking the seller through their house. Emotionally loaded questions (admitting
your house has problems) come after trust is established, not first.

**The shared explain boxes are a printing constraint, not a data model.**
Section C gives sixteen questions one text box. Asking a seller to explain all
their yeses at the end produces mush — by then they've forgotten which was
which. We capture `C.7.explanation` at the moment of the yes and compose the
shared box at render time, numbered so a buyer's agent can match explanation to
question.

**"I don't know" is a first-class answer.** Not a validation failure. And on a
TDS it's often legitimately "No — not aware of any," since the form asks about
the *seller's knowledge*. `mark_unknown` instructs the agent to surface that
distinction rather than silently coercing either way. True unknowns route to the
agent's queue — which is what the agent view is for.

**Contradictions never block and never auto-correct.** Detection runs on every
write. Conflicts touching the current question get a quiet inline note; the rest
wait for the review screen. Both answers are quoted back with "which is right?",
never "you made an error" — the seller isn't wrong, the form is confusing. Even
hard conflicts are dismissible: a seller who insists both answers are right is
allowed to be right, and we record the acknowledgement.

**The model does not own the state machine.** `flow.ts` owns the queue; the
voice agent gets tools and calls them. Every write is validated against the
registry's type and confidence threshold before it touches the store. On a legal
disclosure, "the model decided to skip C.9" is not an acceptable audit entry.

**Progress is chapters and minutes, not "field 87 of 150."** A seller with no
defects has a genuinely shorter form than one with defects, so a raw field count
lies. `progress()` counts only visible questions and sums `estimatedSeconds` on
what's left.

**Position is derived, not stored.** `nextQuestion(answers)` is a pure function
of the answer set. That's what makes closing the tab safe and makes modality
handoff free — voice and form call the same function and get the same answer.
There is nothing to sync because there is only one store.

**At disclosure time there is no buyer.** The TDS has buyer signature and
initial lines, but it's completed at listing, before any offer exists. Buyer
roles are declared in `docuseal.ts` and deliberately left unassigned; the
acknowledgement of receipt is a second submission later.

---

## What's deliberately not here

- Buyer and selling-agent signature routing (see above)
- Multi-unit duplex/triplex per-unit variants — the header flag exists, the
  per-unit branching doesn't
- Attach-additional-sheets overflow when an explanation exceeds the box
- Co-seller divergence: both sellers sign, but they answer as one voice
- Real Section A / signature-block coordinates — `SECTION_C_GEOMETRY` shows the
  pattern with placeholder values; the rest is template-builder work

## Wiring it up

```ts
import { nextQuestion, progress, makeAnswer, validateAnswer } from "./tds/flow";
import { detectConflicts } from "./tds/conflicts";
import { buildSubmission, expectedFieldNames } from "./tds/docuseal";

// one write path, both modalities
const check = validateAnswer(questionId, value, confidence);
if (!check.ok) return { reAsk: check.reason };
answers[questionId] = makeAnswer(questionId, value, "voice", { verbatim });

const next = nextQuestion(answers, questionId);
const inline = conflictsFor(questionId, answers);

// at signing
await docuseal.createSubmission(
  buildSubmission({ templateId, answers, sellers, listingAgent })
);
```

Diff `expectedFieldNames()` against the field names in your DocuSeal template.
It's the fastest way to catch a typo before it silently drops an answer.
