# Loqol TDS

A California **Transfer Disclosure Statement**, completed by the seller **by
voice or by form — their choice, switchable mid-question** — and pushed to
DocuSeal as a filled, signable PDF. A listing agent creates the deal, sends a
link, and reviews what comes back.

**Live:** <https://tds-agents.vercel.app> — start at `/`, which offers a
sign-in. Seed credentials are below.

Use that address, not the per-deployment one Vercel shows after a build
(`tds-agents-<hash>-<team>.vercel.app`). Those sit behind Vercel's SSO, so
anyone not signed in to the owning account is bounced to a Vercel login — and
they pin to a single build, so they stop tracking `main`.

**→ [`docs/DECISIONS.md`](docs/DECISIONS.md) is the write-up.** The voice/form
routing decision and its defence, the six seller-experience questions from the
brief answered one by one, the auth model, and what was deliberately skipped.
**Start there** — this file is just how to run and test it.

---

## Quick start

```bash
npm install
cp .env.example .env      # see "Environment" below
npm run db:migrate
npm run db:seed           # prints the agent login and two seller links
npm run dev
```

Then open <http://localhost:3000>. The root routes you by who you already
are: signed-in agent to the dashboard, live seller session to wherever they left
off, and anyone else to a sign-in.

`npm run db:seed` prints everything you need:

```
Agent login   agent@loqol.test / loqol-demo-2026

Magic links (plaintext token shown once, only the hash is stored):
  Dana Reyes (not started)   http://localhost:3000/s/…
  Marcus Oyelaran (mid-flow) http://localhost:3000/s/…
```

**Open the seller links in a phone-sized window.** The seller flow is
phone-first; the agent dashboard is desktop-first.

**Keep the `npm run dev` terminal visible.** Email is a deliberate log-only
seam — signup and password-reset links print there rather than being sent.

### Testing against the deployed app

The seed talks to whatever `DATABASE_URL` points at, so pointing it at the
production database seeds production. Only the token's *hash* is stored, so the
origin in the printed link is cosmetic:

```bash
APP_URL=https://tds-agents.vercel.app npm run db:seed
```

That prints magic links that work against the deployed app. Without `APP_URL`
the links say `localhost` — the tokens are still valid, you just have to swap
the origin yourself.

**Open seller links in a private window.** The root sends a signed-in agent to
their dashboard even if a seller cookie is also present (an agent bounced into a
stale seller session would have to sign out to reach their own deals). Testing
both roles in one window is the only situation where that shows.

---

## Environment

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres. Supabase users: the **session pooler**, port **5432**. Not 6543 — `drizzle-kit migrate` needs prepared statements. |
| `AUTH_SECRET` | Any long random string. Signs agent and seller session cookies. |
| `OPENAI_API_KEY` | Server-side only. The browser gets a short-lived ephemeral token. |
| `DOCUSEAL_API_KEY` | Test Mode key. |
| `DOCUSEAL_TDS_TEMPLATE_ID` | Created by `npm run docuseal:create`. |
| `DOCUSEAL_WEBHOOK_SECRET` | From Console → Webhooks → Security → HMAC. Signature verification **fails closed** without it. |

`.env.example` documents each with the reasoning.

---

## How to test it

Roughly fifteen minutes end to end. Ordered the way the product is actually
used: the agent creates everything, the seller only ever receives a link.

### 1 — Agent

Sign in at **`/agent/login`**.

1. The deal list shows each seller with **derived** status and progress —
   nothing about status is stored, it is computed from the answers.
2. **New disclosure** → seller name, email, address, then the property details
   the seller cannot reasonably know: county, legal description. *Nobody knows
   their own legal property description; asking a seller for it is how you lose
   them in the first thirty seconds.*
3. **The magic link is shown once.** Copy it.
4. **`/agent/signup`** — try an email that already exists. You get the *same*
   response as a new one, and the owner is mailed a sign-in link instead. A
   distinguishable signup is an account-enumeration oracle. Same for
   **`/agent/forgot-password`** with a known vs unknown address.

### 2 — Seller

Open a link **in a phone-sized window**.

1. **Watch the address bar.** It changes to `/disclosure` and the token
   disappears — it is exchanged for an httpOnly cookie, so it never persists in
   history, screenshots, or a `Referer` header.
2. **"What's in the home"** — tap what the house has, then **"That's everything
   here."** That confirm turns untapped chips into an explicit *no*; without it,
   "there is no sauna" and "never reached this group" would be indistinguishable
   in the database.
3. **Tap "Fireplace"** — two more questions appear with no reload.
4. **Tap "Come back to this"** — it is *not* re-asked immediately; it returns
   once nothing new is left.
5. **Close the tab and reopen the link** — you land back in place. Position is
   derived from your answers, not stored.

### 3 — Voice

Continue to **"Anything not working"**, press **Start talking**, allow the mic.

Worth trying deliberately:

- **Hedge** — *"I think so, maybe?"* → it re-asks rather than recording a
  low-confidence answer.
- **Say "I don't know"** → it checks whether you mean *"no, not aware of any."*
  On a TDS those are different answers and sellers conflate them constantly.
- **Say "just show me the buttons"** → hands over immediately, no argument, and
  lands on **the question you were just discussing** with anything you already
  said shown as answered.
- **Deny the microphone** → the escape hatch is present in *every* state.

### 4 — Contradictions

Answer **yes** to the HOA question and **no** to written rules. A quiet note
appears. **Nothing blocks.**

At review, both sides are quoted back **in your own words** — including what you
actually said out loud. Choose **"Both are right"** and it is recorded, not
corrected: the contradiction stays visible to the agent, you just stop being
asked.

### 5 — Signing, and back to the agent

Sign. Afterwards you get **"I need to change something"** — it does not let you
edit a signed legal document; it flags the deal for the agent.

Reopen the deal as the agent: three tiles are the actual work — **couldn't
answer / don't line up / set aside** — then every answer with **where it came
from** (tapped, spoken, or filled by you) and the seller's own recorded words.

### Things worth trying to break

- Change a character in a seller link → *"this link looks incomplete"*, never a 404
- Sign out, visit `/agent` → redirected, not shown data
- `/disclosure/c/features?q=not-a-question` → 200, nothing marked
- Reload anything in dark mode → both themes are designed, not inverted

---

## The checks

```bash
npm run check        # typecheck, registry, flow, form projection, WCAG contrast, cold start
npm run db:check     # persistence, audit trail, auth timing, throttling, signing
npm run voice:check  # the voice tool contract, against the real handler
```

**51 assertions.** `assert`-based scripts, no framework — each is the smallest
thing that fails if the logic breaks. Most of the bugs described in the write-up
were found by writing them.

`npm run check` needs **no environment at all** — the registry and flow engine
have no external dependencies, and the last of its checks exists to keep that
true: it imports the database module from a directory with no `.env` and
asserts the import survives. A throw at module scope is invisible locally and
fails `next build` on every CI machine. The other two suites need
`DATABASE_URL`.

```bash
npm run docuseal:template               # dry run: which fields place, which don't
npm run docuseal:create                 # build the template from the blank PDF
npm run docuseal:fill "Marcus Oyelaran" # a real filled, signed PDF
```

---

## How it is put together

One **declarative registry** — 89 questions, each with its plain-English
translation, voice prompt, follow-up rule, gate and PDF field name. Everything
else is a projection of it.

```
                    src/tds/registry.ts
                            │
     ┌──────────────┬───────┴───────┬──────────────┐
     ▼              ▼               ▼              ▼
Form renderer   Voice agent    Conflict rules   DocuSeal
     │              │               │              │
     └──────┬───────┘               │              │
            ▼                       │              │
      answers table ◄───────────────┴──────────────┘
```

*"Start in one path, finish in the other"* sounds like a sync problem. It isn't:
one answer store, two input adapters, and position **derived** from the answers
rather than stored. There is nothing to sync, which is why switching
mid-question costs nothing.

**61 form · 20 voice · 8 agent-only. 144 DocuSeal fields, 140 placed. 20
conflict rules.**

```
src/tds/          Pure. No network, no React, no database.
  registry.ts       The form itself
  flow.ts           Gates, next-question, follow-ups, progress, resume
  conflicts.ts      20 cross-answer rules with seller-facing messages
  form-view.ts      Registry → form projection
  voice.ts          Registry → the voice agent's brief
  voice-turns.ts    The Realtime response lifecycle, as a pure reducer
  docuseal.ts       Field mapping, submission builder, signer fields

src/db/           Persistence. answers is state; answer_events is history.
src/app/
  s/[token]/        Token exchange only — sets a cookie, redirects
  disclosure/       The seller, tokenless. Dispatcher, chapters, review, sign
  agent/            The agent. Deals, review, account
  api/              One write path for both modalities; voice tools; webhooks

scripts/          The checks, the seed, and the DocuSeal template builder
assets/           The blank TDS, and the prepared template base
```

---

## Known limits

Stated so a gap reads as a decision rather than an oversight.

- **4 of 144 PDF fields have no slot.** The supplied PDF is a paraphrased TDS,
  not the official C.A.R. form — it is missing four checkboxes the real form has
  and puts header fields inline in prose. Each confirmed by rendering the page.
- **Email is a log-only seam.** A real provider is a one-file swap.
- **Rate limiting is in-memory**, so the budget is per instance.
- **Not built, deliberately:** buyer and selling-agent signature routing (a TDS
  is completed at listing, before an offer exists — the acknowledgement of
  receipt is a second submission later), multi-unit per-unit branching,
  attach-additional-sheets overflow, co-seller divergent answers.

## Deploying

One Next.js deployable. On Vercel, set the **Root Directory** to `loqol-tds` —
the app is nested one level below the repository root.

Set the environment variables above, then run `npm run db:migrate` against the
production database. Three of them fail in ways that are hard to read from the
symptom:

- **`APP_URL`** must match the deployed origin. It is what magic links are built
  from, so a stale value sends sellers to localhost.
- **`DOCUSEAL_WEBHOOK_SECRET`** must be the real `whsec_…`. Signature
  verification fails closed, so a wrong value looks like a silent webhook.
- **`DATABASE_URL`** must be the session pooler, port **5432**.

Nothing is required at *build* time — the build imports every route module, and
none of them touch the database until a request arrives.
