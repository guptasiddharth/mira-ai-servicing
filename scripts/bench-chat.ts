/**
 * End-to-end conversational benchmark against a running server (npm run dev).
 * Plays scripted multi-turn customer journeys through /api/chat and reports
 * per-turn latency (TTFT, total, tools) plus a p50/p95 summary.
 *
 *   npm run bench:chat                # default http://localhost:3000
 *   BASE_URL=https://... npm run bench:chat
 */
import { percentile } from "@/platform/observability/metrics";
import type { AgentEvent } from "@/platform/agent/events";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const JOURNEYS: { customer: string; workflow: string; name: string; turns: string[] }[] = [
  {
    customer: "CUST-1001",
    workflow: "loan-servicing",
    name: "EMI increase → prepayment → book it",
    turns: [
      "My EMI increased this month. Why? And if I make a ₹50,000 prepayment today, how much interest would I save?",
      "What if I reduce the EMI instead?",
      "Ok, go with reducing tenure. Book the 50k prepayment.",
      "Yes, go ahead.",
    ],
  },
  {
    customer: "CUST-1002",
    workflow: "loan-servicing",
    name: "Failed payments → dispute",
    turns: ["Show me the payments that failed in the last six months and explain what happened.", "The September one wasn't my fault. Can you get that charge reversed?", "Yes please."],
  },
  {
    customer: "CUST-1003",
    workflow: "loan-servicing",
    name: "Foreclosure eligibility & options",
    turns: ["Am I eligible for foreclosure without a penalty?", "Based on my current loan and applicable terms, what are my options?"],
  },
  {
    customer: "CUST-1002",
    workflow: "card-servicing",
    name: "Card: duplicate charge (2nd workflow)",
    turns: ["I think I was charged twice for a food order yesterday. Can you check?", "Yes, dispute the duplicate one.", "Confirm."],
  },
];

async function login(customerId: string): Promise<string> {
  const form = new FormData();
  form.set("customerId", customerId);
  form.set("otp", "123456");
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", body: form, redirect: "manual" });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error(`Login failed (${res.status})`);
  return cookie.split(";")[0];
}

interface TurnResult {
  journey: string;
  turn: number;
  ttft: number | null;
  total: number;
  tools: string[];
  toolMs: number;
  answer: string;
}

async function runTurn(cookie: string, workflowId: string, history: { role: "user" | "assistant"; text: string }[], turnId: string) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ workflowId, turnId, messages: history }),
  });
  if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);
  let ttft: number | null = null;
  let text = "";
  const tools: string[] = [];
  let toolMs = 0;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const e = JSON.parse(buf.slice(0, i)) as AgentEvent;
      buf = buf.slice(i + 1);
      if (e.type === "text") {
        ttft ??= Math.round(performance.now() - t0);
        text += e.delta;
      }
      if (e.type === "tool_result") tools.push(`${e.result.name}${e.result.ok ? "" : "✗"}`);
      if (e.type === "done") toolMs = e.timings.toolMs;
      if (e.type === "error") text += `[ERROR ${e.message}]`;
    }
  }
  return { ttft, total: Math.round(performance.now() - t0), tools, toolMs, text };
}

const results: TurnResult[] = [];
for (const j of JOURNEYS) {
  const cookie = await login(j.customer);
  const history: { role: "user" | "assistant"; text: string }[] = [];
  console.log(`\n━━ ${j.name} (${j.customer}, ${j.workflow})`);
  for (const [n, utterance] of j.turns.entries()) {
    history.push({ role: "user", text: utterance });
    const r = await runTurn(cookie, j.workflow, history, `bench-${Date.now()}-${n}`);
    history.push({ role: "assistant", text: r.text });
    results.push({ journey: j.name, turn: n + 1, ttft: r.ttft, total: r.total, tools: r.tools, toolMs: r.toolMs, answer: r.text });
    console.log(`  [${n + 1}] ${utterance}`);
    console.log(`      ttft ${r.ttft}ms · total ${r.total}ms · tools ${r.tools.join(", ") || "none"} (${r.toolMs}ms)`);
    console.log(`      → ${r.text.replace(/\s+/g, " ").slice(0, 260)}${r.text.length > 260 ? "…" : ""}`);
  }
}

const ttfts = results.map((r) => r.ttft).filter((x): x is number => x !== null).sort((a, b) => a - b);
const totals = results.map((r) => r.total).sort((a, b) => a - b);
const withTools = results.filter((r) => r.tools.length).map((r) => r.total).sort((a, b) => a - b);
const noTools = results.filter((r) => !r.tools.length).map((r) => r.ttft ?? r.total).sort((a, b) => a - b);
console.log("\n━━ Summary (ms)");
console.table({
  "TTFT (all turns)": { n: ttfts.length, p50: percentile(ttfts, 50), p95: percentile(ttfts, 95) },
  "TTFT (answered from context, no tools)": { n: noTools.length, p50: percentile(noTools, 50), p95: percentile(noTools, 95) },
  "Full turn (with tools)": { n: withTools.length, p50: percentile(withTools, 50), p95: percentile(withTools, 95) },
  "Full turn (all)": { n: totals.length, p50: percentile(totals, 50), p95: percentile(totals, 95) },
});
