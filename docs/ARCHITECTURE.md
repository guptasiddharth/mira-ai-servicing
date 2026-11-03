# Architecture & engineering decisions

## 1. Design principles

1. **The LLM orchestrates; code computes.** The model decides *what* to look up and *how to explain it*. Balances, EMIs, savings, eligibility and charges come from deterministic, unit-tested functions. The model is told never to do arithmetic.
2. **Every answer is verifiable.** Tool results carry `sources` (system + record) and policy clause IDs. The UI shows them under each answer, along with the trace of systems that were hit.
3. **One platform, many workflows and channels.** Text and voice share the same tools, authorisation, gateway and transcript. A new use case is a *manifest* plus any genuinely new domain tools.
4. **Assume the backends are slow and flaky.** Every system call goes through one gateway that owns timeouts, retries, circuit breaking, caching and idempotency.
5. **Identity is never the model's decision.** `customerId` comes only from the signed session. Every tool checks object ownership, and actions need explicit confirmation.

## 2. System overview

```mermaid
flowchart LR
  subgraph Browser
    UI[Chat + Account panels + Ops]
    V[Voice engine<br/>mic 16k PCM / speaker 24k]
  end
  subgraph "Next.js (stateless API)"
    CHAT[/api/chat<br/>Agent runtime/]
    VS[/api/voice/session<br/>locked ephemeral token/]
    TOOLS[/api/tools/]
    ACT[/api/actions/:id/]
    REG[Tool Registry & Executor<br/>allow-list · validation · 2-phase actions · audit]
    GW[Integration Gateway<br/>timeout · retry · breaker · cache · singleflight · idempotency]
    DOM[Domain engines<br/>amortization · prepayment · foreclosure · policy rules]
  end
  subgraph "Systems of record (simulated)"
    CRM[(CRM)] LMS[(Loan Mgmt)] PAY[(Payments)] POL[(Policy)] SOP[(Service Ops)] CARD[(Cards)]
  end
  GEM[(Gemini Flash<br/>text)]
  LIVE[(Gemini Live<br/>native audio)]

  UI -- NDJSON stream --> CHAT --> GEM
  CHAT --> REG
  V <-- audio WebSocket --> LIVE
  V -- function calls --> TOOLS --> REG
  UI --> VS --> LIVE
  UI --> ACT --> REG
  REG --> DOM
  REG --> GW --> CRM & LMS & PAY & POL & SOP & CARD
```

### Text turn

1. The client sends the transcript (text and voice turns alike) to `/api/chat`. The server is stateless.
2. The runtime loads **customer context** (CRM, loans, recent payments and open requests, fetched in parallel and cached by the gateway). It then builds the system instruction: platform guardrails + workflow rules + context + any **pending actions**.
3. Plan → act → observe loop (max 6 steps). All function calls from a step run **in parallel** through the registry. Tool events stream to the UI as they happen (the chips appear live), followed by the answer tokens.
4. A `done` event carries timings (TTFT, LLM, tools, context, steps, model), which are also recorded as metrics.

### Voice turn

1. `/api/voice/session` builds the same instruction (channel = voice, plus the recent transcript for continuity) and the same tool declarations. It then mints a **single-use, 30-minute ephemeral token whose model, prompt and tools are locked server-side**. The API key never reaches the browser, and the client can't alter the prompt.
2. The browser streams 16 kHz PCM straight to Gemini Live and plays 24 kHz audio back. Keeping our servers out of the audio path removes a network hop, which is the single biggest voice-latency decision.
3. Function calls are relayed to `/api/tools`, so they take exactly the same path as text (session auth → registry → gateway).
4. **Barge-in:** server VAD sends `interrupted` → the client flushes queued audio immediately and marks the reply as interrupted. **Changing intent:** a `toolCallCancellation` aborts the in-flight HTTP call and marks the chip as cancelled.
5. **Slow backends:** tools marked `latency: "slow"` (Payments) are declared `NON_BLOCKING`. The model keeps talking ("let me pull that up…") and the result is delivered with `scheduling: WHEN_IDLE`. The voice prompt also requires a short spoken acknowledgement before any tool call.
6. Client-side end-of-speech → first-audio latency is measured on every reply and reported to the metrics store.

## 3. Query engine: why this isn't RAG, and how it works

The example questions ("Why did my EMI change?", "What if I prepay ₹50,000?", "Am I eligible for penalty-free foreclosure?") need **customer data + business rules + arithmetic + conversation state**. Document retrieval can't produce a correct EMI delta or interest saving, so the engine is layered:

| Layer | Implementation | Why |
|---|---|---|
| Context prefetch | `workflow.loadContext()`: profile, loans, last payments and open requests, loaded in parallel at session start and cached | Common questions ("next EMI?", "last payment?") are answered with **zero tool calls** (~1.3s in voice) |
| Typed tools | 17 tools with zod schemas; arguments validated before execution | The model can only ask for things that exist, in valid shapes |
| Deterministic maths | `domain/finance/*`: reducing-balance EMI, schedule with floating resets, payoff projection, prepayment (reduce tenure vs EMI), foreclosure quote with accrued interest and GST | Exact, testable numbers |
| Rules engine | `domain/policy/loan-rules.ts`: lock-in, prepayment caps, FY limits, fixed/floating charge slabs, bounce-reversal eligibility. Returns `ruleId`s | Explainable decisions plus "what *is* allowed" alternatives |
| Policy text | Clause book generated from the **same parameters** the rules engine uses; keyword search with clause IDs | Citations can never drift from the rules |
| Explanations as data | e.g. `explain_emi_change` returns the before/after instalment, rate change, reset reason and mechanism | The model narrates facts; it doesn't infer them |

A vector store would add value for long-tail FAQ content. It would be one more tool behind the same registry, not the core.

## 4. Integrations and actions

**Integration Gateway** (`platform/integrations/gateway.ts`), configured per system to match its SLOs (`capabilities/data.ts`):

- Per-call **timeout** via `AbortController` (the simulator honours abort, as a real HTTP client would).
- **Retries** with exponential backoff and jitter. Reads are idempotent; writes carry an idempotency key, so they are safe to retry too.
- **Circuit breaker** per system (opens after N consecutive failures, then half-open probe). Failures are mapped to `SYSTEM_UNAVAILABLE`, which the model is instructed to handle honestly.
- **Read-through cache** with per-customer tags, invalidated on any write for that customer. **Singleflight** coalesces identical concurrent reads.
- Every call records a **span** into the request trace (AsyncLocalStorage) and latency/retry/error **metrics**.

**Two-phase actions** (`platform/tools/registry.ts`):

- `prepare()` validates against policy and computes a preview, with no side effects. A `PendingAction` is stored, and the UI renders a confirmation card.
- Confirmation comes either from the **Confirm button** or the customer saying yes. In the second case the model calls `confirm_action`. That is **rejected if it happens in the same turn the action was prepared**, so the model can't confirm on the customer's behalf. Pending actions are injected into the next turn's prompt from server state, never from the client.
- `commit()` runs through gateway writes with the action ID as the idempotency key. Double-confirming returns the original reference. A CRM interaction note is written so human agents see what the assistant did.

Implemented operations: part-prepayment request, payment dispute (bounce-charge reversal), repayment statement, generic service ticket, card dispute, card block/replace.

## 5. The reusable platform capability

**What's reusable:** Agent Runtime · Tool Registry & Executor · Integration Gateway · Two-phase Actions · Context prefetch · Voice channel · Observability · Session/authz · UI shell (generic panels, action cards, trace chips, ops view).

**What a workflow provides** (`platform/workflows/types.ts`):

```ts
interface WorkflowManifest {
  id, name, agent: { name, title },          // e.g. Mira · "AI Loan Specialist"
  persona, rules[], tools[], starters[], greeting,
  loadContext(ctx) → CustomerContext,   // what the assistant "already knows"
  loadPanels(ctx)  → Panel[]            // generic account panels for the UI
}
```

**Proof: Credit Card Servicing** (`workflows/card-servicing.ts`)

| | Lines | Notes |
|---|---|---|
| Manifest | ~125 | persona, rules, tool allow-list, context, panels |
| New tools | ~175 | card summary, transactions with deterministic duplicate detection, dispute (action), block (action) |
| New adapter | ~40 | Card Platform API |
| **Reused unchanged** | ~2,500 | platform (1.3k), UI shell (1.3k), shared tools (profile, policy search, service requests, tickets), voice, gateway, auth, metrics |

Collections, insurance or onboarding would follow the same pattern. The next step for the platform is moving manifests into a database or admin UI, with per-tenant tool catalogues and evaluation suites.

## 6. Security controls

| Concern | Control |
|---|---|
| Identity | HMAC-signed, httpOnly session cookie. `customerId` is injected into every tool context from the session only |
| Object-level authorisation | `resolveLoan` / `resolveCard` / payment lookups verify ownership. A request for another customer's loan returns `FORBIDDEN` (tested) |
| Tool scoping | Per-workflow allow-list enforced at execution, not just in the prompt (tested) |
| Input validation | zod on every tool argument and every API body |
| Consequential actions | Two-phase with explicit confirmation, no same-turn self-confirmation, 10-minute expiry, idempotent |
| Secrets | API key server-only. Voice uses single-use ephemeral tokens with locked model, prompt and tools |
| Data minimisation | Context sent to the model masks phone and email; PAN is never sent. Audit and log output is PII-redacted |
| Abuse | Per-session rate limits on chat, voice and tool endpoints |
| Audit | Append-only audit of reads, denials, prepared, confirmed and cancelled actions (visible in the Ops panel) |

The production gaps are listed in §8.

## 7. Scaling toward 1,000 concurrent conversations

- **API tier is stateless.** Conversation history travels with the request, and context is rebuilt from cache, so instances scale horizontally behind a load balancer (Vercel Fluid Compute or Kubernetes).
- **Voice audio never touches our servers.** With 1,000 live calls, our tier only sees tool calls (a few per minute per call). The heavy media path is the provider's.
- **Backend protection:** caching, singleflight and breakers keep fan-out bounded. `npm run bench` drives **1,000 concurrent conversations (6,000 tool calls)** through the real registry and gateway against the fault-injecting simulators: 0 failed calls after retries in realistic mode, p95 tool-turn 1.4s (see the performance report).
- **The real bottleneck is LLM throughput.** 1,000 conversations at about one turn per 20s is ~50 turns/s, or ~100 model requests/s. That needs a paid tier with provisioned throughput, multi-region or multi-provider routing (the model router is the seam), and prompt or context caching for the large static system prefix.
- **Shared state is already externalised** (deployed on Vercel + Upstash Redis): pending actions, a cross-instance confirm claim, system-of-record mutations, chaos mode, metrics and audit all live in Redis behind `platform/state/kv.ts`. Gateway caches, circuit breakers and rate limits stay per instance, as in a real fleet. Next: systems of record become real APIs, and audit goes to an append-only store.

## 8. Trade-offs and what I'd do next

| Decision | Trade-off | Next step |
|---|---|---|
| Speech-to-speech Live model (vs STT → LLM → TTS) | Lowest latency and natural barge-in, but less control over the voice and transcription. Two models (text vs live) can phrase things differently | Keep the pipeline pluggable. Add a cascaded mode (Deepgram, LLM, Cartesia/ElevenLabs) for languages or voices the Live model handles poorly, and for telephony |
| Browser connects directly to Gemini Live | Fewer hops, and no media servers to run | Telephony (SIP/PSTN) needs a media bridge (LiveKit/Pipecat or Twilio/Exotel media streams) that reuses the same tool relay |
| Stateless text API, transcript from the client | Simple horizontal scale | Server-side conversation store for audit/QA and cross-device continuity |
| Redis-backed state behind a 1-file interface (memory fallback) | Works on serverless today; zero infrastructure locally | Postgres for durable records; OpenTelemetry → Grafana/Datadog for metrics |
| Keyword policy search | Deterministic and explainable with ~13 clauses | Hybrid search when the corpus grows; still cited by clause ID |
| Low thinking level | Faster TTFT; maths is in tools anyway | Route hard multi-step questions to a higher thinking level or a stronger model |
| Mock OTP | Demo convenience | Bank IdP (OIDC) plus step-up auth (OTP/biometric) before money-moving actions |

**Also next:** an evaluation harness (golden conversations scored for numeric accuracy, citation presence and correct refusals) run in CI; human hand-off with the conversation summary attached to the ticket; Hindi and Hinglish voice; Vertex AI in an Indian region for data residency; prompt-injection hardening on any free-text fields that come back from systems.

## 9. Known limitations (honest list)

- The free Gemini tier (5 RPM, 20 RPD per model) caps how much can be demoed; the model router softens but doesn't remove this.
- Voice latency is measured client-side (last voiced mic frame → first audio chunk), which includes the server's end-of-speech detection window. That is the latency the customer actually feels, but it isn't directly comparable to server-side numbers.
- The synthetic data model simplifies real lending (no broken-period interest, no moratoria, no penal-interest accrual on overdue EMIs).
- The simulated systems of record are one Redis document with last-writer-wins on truly concurrent writes. That's fine for a demo; real systems of record own their own consistency.
