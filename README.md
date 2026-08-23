# TDS Agents

A California **Transfer Disclosure Statement**, completed by the seller **by
voice or by form — their choice, switchable mid-question** — and pushed to
DocuSeal as a filled, signable PDF.

**Live:** <https://tds-agents.vercel.app>

**The application lives in [`loqol-tds/`](loqol-tds/).**

```bash
cd loqol-tds
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed      # prints the agent login and two seller links
npm run dev
```

| Where to look | What it is |
|---|---|
| **[`loqol-tds/README.md`](loqol-tds/README.md)** | Setup, environment, and a 15-minute walkthrough of every path |
| **[`loqol-tds/docs/DECISIONS.md`](loqol-tds/docs/DECISIONS.md)** | The write-up — the voice/form routing decision, defended |
| [`loqol-tds/docs/REGISTRY.md`](loqol-tds/docs/REGISTRY.md) | Registry-level design notes |
