# Performance report

All figures were measured on this codebase (MacBook, local `next dev`, Gemini **free tier** over the public internet). Reproduce them with `npm run bench`, `npm run bench:chat`, the Ops panel (live p50/p95), or by speaking to the app.

## 1. Live voice (Gemini Live `gemini-3.8-live`, real speech)

Measured client-side from the **last voiced microphone frame to the first audio chunk played**, so it includes end-of-speech detection. This is what the customer feels.

| Turn (spoken) | Path | Voice response |
|---|---|---|
| "What's my next EMI?" | answered from prefetched context | **1,341 ms** |
| "Actually, check my last payment first." (topic change; next question barged in) | context | **1,412 ms** |
| "Now tell me whether paying ₹20,000 extra would reduce my tenure." | `simulate_prepayment` tool (233 ms incl. Loans + Policy) | **3,062 ms** |
| Voice session setup (context load + locked token mint) | server | 999 ms |
| Headless smoke test: typed prompt → first audio | model speaks an acknowledgement *before* the tool call | 907 ms |

**What keeps voice responsive:**
- Audio goes browser ⇄ Gemini directly; our servers handle only tool calls.
- Context is prefetched, so the most common questions need no tool call.
- The model gives a spoken acknowledgement before slow work.
- Slow tools run `NON_BLOCKING` with `WHEN_IDLE` delivery.
- Tools are parallel and cached (the voice tool p50 is in the hundreds of ms).

## 2. Text chat (`/api/chat`, streamed)

`npm run bench:chat` plays 4 journeys / 12 turns (EMI change → prepayment → book, failed payments → dispute, foreclosure options, card duplicate → dispute). All 12 turns completed correctly, including next-turn confirmations.

| Condition | TTFT p50 | Full turn p50 | Notes |
|---|---|---|---|
| Fresh quota (`gemini-3.6-flash`) | 3.3 s | 4.5 s | Tool turns need 2 model calls (plan → answer); tools themselves take < 10 ms (cached) |
| Turn answered from context (no tools) | 1.8–2.6 s | 2.7–3.3 s | single model call |
| Single UI turn on `gemini-3-flash-preview` | 3.1 s | 4.1 s | 2 parallel tools, 3 ms |
| Free-tier quota exhausted mid-run (failover chain active) | 7.5 s | 7.8 s | includes 429 round-trips and slower fallback models |

Model probe: one planning step to the first function call, using the full production prompt and 15 tools.

| Model | thinking=minimal | thinking=low |
|---|---|---|
| gemini-3-flash-preview | **1.30 s** | 1.72 s |
| gemini-3.5-flash-lite | 4.44 s | 6.29 s |

**Reading these numbers:**
- Almost all text latency is model time on a shared free tier. Our own overhead (context load, tool execution, gateway) is single-digit ms once cached, and around 400 ms cold.
- The UI shows tool chips the moment the model plans a call, so the customer sees progress well before the first token.
- On a paid tier with no failover, plus prompt caching of the large static system prefix, the planning step should drop to about 1 s and full tool turns to about 2–2.5 s. Those are estimates, not measurements.

## 3. Backend: 1,000 concurrent conversations (`npm run bench`)

Each conversation is a distinct customer (seed data cloned, so no cross-customer cache benefit). Each runs 4 turns that mirror real model behaviour (loan details → EMI change + prepayment in parallel → failed payments → foreclosure + policy). All calls go through the real registry → gateway → fault-injecting simulators.

### Realistic mode (per-system latency profiles, 1–8% failure rates)

`1000 conversations · 6,000 tool calls · wall 5.1 s · 0 failed after retries`

| | p50 | p95 | p99 |
|---|---|---|---|
| Tool turn (parallel tools) | 409 ms | 1,385 ms | 1,843 ms |

| System | Uncached calls | p50 | p95 | p99 | Retries absorbed | Errors surfaced | Cache hits |
|---|---|---|---|---|---|---|---|
| Loan Management | 1,000 | 826 | 1,386 | 1,786 | 29 | 0 | 3,000 |
| Payments | 1,000 | 701 | 1,782 | 2,502 | 105 | 0 | 0 |
| Policy | 6 | 156 | 674 | 674 | 0 | 0 | 2,442 (+1,552 coalesced) |

The first loan read per conversation pays the backend cost; every later tool in that conversation is served from cache in about 1 ms (EMI change p50 1 ms, prepayment p50 1 ms).

### Degraded mode (2.5× latency, 5× failure rates)

`6,000 tool calls · 0.82% failed after retries` (Payments: 444 retries absorbed, 46 surfaced). Tool turn p50 649 ms, p95 3.0 s. The circuit breakers correctly stayed closed: the failures were intermittent, not a sustained outage.

### Payments outage (100% failure)

The Payments breaker **opened**. Only the payments-dependent tool failed (1,000 of 6,000 calls), and every other tool kept working: blast-radius isolation. Tool turn p95 **fell** to 1.2 s because calls fail fast instead of hanging. In the app, the assistant tells the customer that Payments is unavailable, shares what it knows from other systems, and offers a ticket.

## 4. Where the latency budget goes (tool turn, text)

```
client → server            ~20 ms
context (cached)           ~1 ms      (cold: ~400 ms, 4 systems in parallel)
LLM step 1: plan tools     ~1.3–3 s   ← dominant
tools (parallel, cached)   ~1–250 ms
LLM step 2: answer         ~1–2 s     (streamed; first token ≈ start of this step)
```

**Next optimisations, in order of impact:**
1. Paid tier or provisioned throughput, so there are no 429s or failover penalties.
2. Context caching for the static prompt prefix (~3–4k tokens).
3. Speculative prefetch: for intents classified from the first tokens, warm the likely tools while the model plans.
4. Single-step answers for intents fully covered by context (already happens naturally: no-tool turns take one model call).
