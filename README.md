# Mira — an AI loan & card specialist over text and live voice

Mira is an AI customer-service agent for consumer lending. It runs on a small, reusable "AI employee" platform. Customers of a lender (the fictional **Kestrel Finance**) use one conversation, typed or spoken, to understand their loan, get exact customer-specific answers, and complete service requests across several backend systems. A second use case (**credit-card servicing**) runs on the same platform with no core changes.

> **Grounded by design.** The model **orchestrates**; it never does the maths. Every number comes from deterministic, unit-tested code: amortization, prepayment and foreclosure calculations, plus a policy rules engine that cites clause IDs. The data comes from typed, authorised and resilient integrations. There is no vector database in the critical path.

| | |
|---|---|
| **Customer UI** | Next.js app: account panels, chat with tool trace and citations, live voice, action confirmation cards |
| **Query engine** | Prefetched customer context + typed tools + deterministic calculators + rules engine. Answers cite `POL-*` clauses and source records |
| **Voice** | Gemini Live (native audio) streams browser ⇄ model. Barge-in, topic changes, async tools for slow backends, shared transcript with text |
| **Integrations** | 5 (+1) simulated systems with realistic latency and failures, behind an Integration Gateway (timeouts, retries, circuit breakers, cache, idempotency) |
| **Actions** | Two-phase prepare → confirm (UI button or "yes, go ahead"), idempotent commit, CRM write-back, audit trail |
| **Platform capability** | Workflow manifests + shared tool registry + gateway + agent runtime. The card-servicing workflow reuses everything |
| **Evidence** | Live Ops panel (p50/p95 per metric, per-system health, chaos controls), a 1,000-conversation backend benchmark, and an end-to-end chat benchmark |

**How the assistant communicates:**
- **Narrative + generative UI.** Every tool returns a typed `view` alongside the data the model sees. The UI renders it as a rich, verified card: EMI-change comparison and step chart, three-way prepayment comparison with a balance-over-time chart, failed-payment timeline with reversal eligibility, foreclosure checklist with milestone track and payoff breakdown, credit-card visual, duplicate-charge scanner. The model writes the short takeaway; the card carries the numbers.
- **"How I got this" reasoning trail.** While working, it shows live steps ("Checking the Payments system…", "Running the prepayment calculator…"). When done, it collapses to *Verified answer · 2 systems · 2 calculations · 5 policies*, which expands into a per-system latency waterfall (cache hits, retries, failures).
- **Citation guard.** Inline `[POL-…]` references become chips you can hover to read the clause, verified against what the tools actually returned. A clause ID the model made up is flagged *unverified* in the UI and counted server-side (`guard.unverified_citations`).
- **Action tickets** with a visible two-phase stepper: *Prepared → Your confirmation → Submitted · SR-…*.
- **Voice stage.** An audio-reactive orb (your mic level while you talk, the assistant's voice while it speaks), live captions, what it's checking right now, and measured reply latency. Voice answers render the same cards as text.

Docs: **[Architecture & decisions](docs/ARCHITECTURE.md)** · **[Performance report](docs/PERFORMANCE.md)**

---

## Quick start

Requirements: Node 22+, Chrome (for voice), and a Gemini API key (free at <https://aistudio.google.com/apikey>).

```bash
npm install
cp .env.example .env.local        # set GEMINI_API_KEY and SESSION_SECRET
npm run dev                       # http://localhost:3000
```

Sign in as any demo customer (OTP `123456`). **Use headphones for voice**, so the assistant doesn't hear itself and barge-in stays clean.

```bash
npm test             # 32 unit tests: maths, policy rules, gateway resilience, authz, two-phase actions
npm run bench        # 1,000 concurrent conversations through tools + gateway + simulated systems (no LLM)
npm run bench:chat   # scripted multi-turn journeys through /api/chat against the running server (uses LLM quota)
npm run smoke:voice  # headless Gemini Live check: locked token → tool call → audio
```

> **Free-tier note:** Gemini's free tier allows about 5 requests/min and **20 requests/day per model**. A turn that uses tools makes 2 requests. The runtime fails over across a chain of models (`GEMINI_TEXT_MODELS`) to stretch this, but for a live demo, enable billing on the AI Studio project. It costs cents.

---

## Demo script (≈8 minutes)

| # | Persona | Say or type | What it shows |
|---|---|---|---|
| 1 | **Priya** (floating rate) | "My EMI increased this month. Why? And if I make a ₹50,000 prepayment today, how much interest would I save?" | Two tools in parallel (`explain_emi_change` + `simulate_prepayment`), exact ₹ figures, rate-reset driver, `[POL-PL-005]` citations, reduce-tenure vs reduce-EMI table |
| 2 | Priya | "What if I reduce the EMI instead?" → "OK, book it with reduced tenure" → **Confirm** | Context carried across turns; two-phase action card; SR reference; account panel updates |
| 3 | Priya, **voice** | "What's my next EMI?" → "Actually, check my last payment first." → "Okay, now tell me whether paying ₹20,000 extra would reduce my tenure." | Answers from prefetched context (~1.3s), topic changes, barge-in, live tool call, measured voice latency on each reply |
| 4 | **Rahul** (fixed rate) | "Show me the payments that failed in the last six months and explain what happened." → "The September one wasn't my fault — reverse that charge" → "Yes please" | Failure classification (technical vs insufficient funds), reversal eligibility under POL-PL-008, dispute raised |
| 5 | Rahul | "Can I prepay ₹50,000?" | Rule engine blocks it (25% cap, POL-PL-002) and offers the maximum allowed amount with numbers |
| 6 | **Ananya** (4 EMIs) | "Am I eligible for foreclosure without a penalty?" → "What are my options?" | Lock-in reasoning with the exact eligibility date; options analysis |
| 7 | Rahul → **Cards** tab | "I think I was charged twice for a food order yesterday." → "Dispute the duplicate" → "Confirm" | **Second workflow on the same platform**: deterministic duplicate detection, card dispute with provisional credit |
| 8 | Ops panel | Switch to **Payments down**, then ask about failed payments | Circuit breaker opens, the assistant degrades gracefully and offers a ticket; other systems unaffected |

Switch between text and voice mid-conversation at any point. Both channels share one transcript, so nothing has to be repeated.

---

## Project structure

```
src/
  platform/            ← reusable, domain-agnostic platform (the "AI employee" runtime)
    agent/             text agent runtime (plan → parallel tools → answer), prompt builder, event protocol
    llm/               model config + rate-limit-aware model router
    tools/             tool contract, registry/executor (allow-list, validation, two-phase actions), zod→Gemini schema
    integrations/      Integration Gateway (timeouts, retries, breaker, cache, singleflight, idempotency)
    actions/           pending-action store for prepare → confirm
    observability/     metrics (p50/p95), request tracing (AsyncLocalStorage), audit log + PII redaction
    security/          HMAC-signed session
    workflows/         Workflow Manifest contract + generic Panel model
  domain/              deterministic business logic: amortization, prepayment, foreclosure, policy rules
  enterprise/          simulated systems of record (CRM, Loans, Payments, Policy, Service Ops, Cards) + latency/fault simulator
  capabilities/        integration adapters + tools (shared, loans, cards) registered into one registry
  workflows/           loan-servicing.ts, card-servicing.ts  ← adding a use case = adding a manifest
  app/                 Next.js pages + API routes (chat, voice session, tools, actions, account, ops, auth)
  components/          UI shell: chat, action cards, account panels, voice engine, ops panel
tests/                 vitest suites
scripts/               bench-backend, bench-chat, smoke-tools, voice-smoke
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | — | Required. Stays server-side; the browser only receives short-lived, config-locked voice tokens |
| `SESSION_SECRET` | — | HMAC key for the session cookie (required in production) |
| `GEMINI_TEXT_MODELS` | `gemini-3.6-flash,gemini-3.5-flash,…` | Ordered failover chain for the text agent |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live` | Live (voice) model |
| `GEMINI_LIVE_VOICE` | `Kore` | Prebuilt voice |
| `GEMINI_THINKING_LEVEL` | `minimal` | Kept low: correctness comes from tools, not model reasoning |
| `VOICE_ASYNC_TOOLS` | `true` | Run slow tools (e.g. Payments) as NON_BLOCKING in voice so the assistant keeps talking |
| `DEMO_TODAY` | today | Pin the simulated bank's date for reproducible demos |

## Live deployment

**https://kestrel-assist.vercel.app** · Vercel (Fluid Compute), functions pinned to **Mumbai (`bom1`)**, shared state in **Upstash Redis (`bom1`)**.

Serverless instances don't share memory, so everything that must survive across requests goes through a small state interface (`src/platform/state/kv.ts`). It uses Upstash Redis when `KV_REST_API_URL` is present, otherwise in-memory (local dev, tests, benchmarks; force it with `STATE_STORE=memory`):

| Shared (Redis) | Per instance (by design) |
|---|---|
| Pending actions + cross-instance confirm claim · simulated systems-of-record data (versioned; each instance re-reads only on change) · chaos mode · metrics (one pipelined write per request, so the Ops panel aggregates across instances) · audit log | Gateway read cache · circuit breakers · rate limits · LLM model cooldowns (as in a real fleet) |

To redeploy:

```bash
vercel link                                   # once
vercel integration add upstash/upstash-kv --billing-plan free --meta primaryRegion=bom1   # once
vercel env add GEMINI_API_KEY production --sensitive   # + SESSION_SECRET, GEMINI_TEXT_MODELS, GEMINI_LIVE_MODEL
vercel deploy --prod
```

> Before a live demo, open the URL a minute early: the first request after a long idle period is a cold start (~10s). In the Ops panel, use **Reset demo data & metrics** to start clean.
