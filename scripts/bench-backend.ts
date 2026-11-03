/**
 * Backend load benchmark (no LLM, no quota): N concurrent conversations each
 * run a realistic servicing sequence through the real tool registry, gateway
 * and simulated enterprise systems (with latency + failures enabled).
 *
 *   npm run bench                       # 1000 conversations, realistic faults
 *   CONVERSATIONS=200 MODE=degraded npm run bench
 */
import { registry } from "@/capabilities/registry";
import { gateway } from "@/capabilities/data";
import { getDb, setChaosMode, type ChaosMode } from "@/enterprise/simulator";
import { metrics, summarize } from "@/platform/observability/metrics";
import { loanServicing } from "@/workflows/loan-servicing";

process.env.AUDIT_STDOUT = "false";
const N = Number(process.env.CONVERSATIONS ?? 1000);
const MODE = (process.env.MODE ?? "normal") as ChaosMode;
await setChaosMode(MODE);

// Clone the three personas into N distinct customers so every conversation
// hits the backends for real (no cross-customer cache/coalescing benefit).
const database = await getDb();
const seeds = [...database.customers];
const CUSTOMERS: string[] = [];
for (let i = 0; i < N; i++) {
  const base = seeds[i % seeds.length];
  const id = `${base.id}-B${i}`;
  const loanMap = new Map(base.loanIds.map((l) => [l, `${l}-B${i}`]));
  database.customers.push({ ...base, id, loanIds: [...loanMap.values()] });
  for (const l of database.loans.filter((x) => x.customerId === base.id)) database.loans.push({ ...structuredClone(l), id: loanMap.get(l.id)!, customerId: id });
  for (const p of database.payments.filter((x) => x.customerId === base.id)) database.payments.push({ ...p, id: `${p.id}-B${i}`, customerId: id, loanId: loanMap.get(p.loanId)! });
  CUSTOMERS.push(id);
}
// A typical multi-turn conversation's tool usage (what the model calls).
const SCRIPT: [string, Record<string, unknown>][][] = [
  [["get_loan_details", {}]],
  [["explain_emi_change", {}], ["simulate_prepayment", { amount: 20000 }]],
  [["get_payment_history", { months: 6, onlyFailed: true }]],
  [["check_foreclosure", {}], ["search_policy", { query: "foreclosure charges" }]],
];

const perTool = new Map<string, number[]>();
const perTurn: number[] = [];
let ok = 0;
let failed = 0;

async function conversation(i: number) {
  const customerId = CUSTOMERS[i % CUSTOMERS.length];
  for (const [turnNo, turn] of SCRIPT.entries()) {
    const ctx = { customerId, sessionId: `bench-${i}`, workflowId: loanServicing.id, channel: "text" as const, turnId: `t${turnNo}` };
    const t0 = performance.now();
    const results = await Promise.all(turn.map(([name, args]) => registry.execute(name, args, ctx, loanServicing.tools)));
    perTurn.push(performance.now() - t0);
    for (const r of results) {
      (perTool.get(r.name) ?? perTool.set(r.name, []).get(r.name)!).push(r.latencyMs);
      if (r.ok) ok++;
      else failed++;
    }
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: N }, (_, i) => conversation(i)));
const wall = performance.now() - started;

console.log(`\n${N} concurrent conversations · ${SCRIPT.length} turns each · backend mode "${MODE}" · wall ${(wall / 1000).toFixed(1)}s`);
console.log(`Tool calls: ${ok + failed} · succeeded ${ok} · failed after retries ${failed} (${((failed / (ok + failed)) * 100).toFixed(2)}%)\n`);

console.log("Tool-turn latency (all tools of a turn in parallel), ms");
console.table([summarize("turn", perTurn)].map(({ name, ...r }) => ({ name, ...r })));

console.log("Per tool, ms");
console.table([...perTool.entries()].map(([n, v]) => summarize(n, v)));

const snap = await metrics.snapshot();
console.log("Per enterprise system (uncached calls), ms + counters");
console.table(
  snap.histograms
    .filter((h) => h.name.startsWith("backend."))
    .map((h) => {
      const sys = h.name.slice(8, -3);
      const c = (k: string) => snap.counters[`backend.${sys}.${k}`] ?? 0;
      return { system: sys, calls: h.count, p50: h.p50, p95: h.p95, p99: h.p99, retries: c("retries"), errors: c("errors"), cacheHits: c("cache_hits"), coalesced: c("coalesced"), shortCircuited: c("short_circuited") };
    }),
);
console.log("Circuit breakers:", gateway.breakerStates().map((b) => `${b.system}=${b.state}`).join(" "));
process.exit(0);
