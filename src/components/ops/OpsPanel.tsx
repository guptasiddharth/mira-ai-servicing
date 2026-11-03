"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatMessage } from "@/components/chat/model";
import type { AuditEntry } from "@/platform/observability/audit";
import type { HistogramSummary } from "@/platform/observability/metrics";

interface OpsData {
  metrics: { histograms: HistogramSummary[]; counters: Record<string, number> };
  breakers: { system: string; state: "closed" | "open" | "half_open"; consecutiveFailures: number }[];
  chaosMode: string;
  systems: { id: string; label: string; baseLatencyMs: number; failureRate: number }[];
  audit: AuditEntry[];
}

const KEY_METRICS: [string, string][] = [
  ["chat.client_ttft_ms", "Text · time to first token (client)"],
  ["chat.ttft_ms", "Text · time to first token (server)"],
  ["chat.turn_ms", "Text · full turn"],
  ["chat.context_ms", "Context prefetch"],
  ["voice.response_ms", "Voice · end of speech → first audio"],
  ["voice.tool_ms", "Voice · tool execution"],
  ["voice.session_setup_ms", "Voice · session setup"],
];

const MODES = [
  { id: "normal", label: "Realistic", hint: "varied latency, occasional 503s" },
  { id: "no_faults", label: "Healthy", hint: "no failures" },
  { id: "degraded", label: "Degraded", hint: "2.5× latency, 5× failures" },
  { id: "payments_outage", label: "Payments down", hint: "100% failure → circuit breaker" },
];

/** Engineering view: live latency percentiles, backend health, chaos controls and audit trail. */
export function OpsPanel({ messages }: { messages: ChatMessage[] }) {
  const [data, setData] = useState<OpsData | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/ops", { cache: "no-store" });
    if (res.ok) setData((await res.json()) as OpsData);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  const post = async (body: object) => {
    await fetch("/api/ops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    void load();
  };

  const h = (name: string) => data?.metrics.histograms.find((x) => x.name === name);
  const backend = data?.metrics.histograms.filter((x) => x.name.startsWith("backend.")) ?? [];
  const c = data?.metrics.counters ?? {};
  const lastTurn = [...messages].reverse().find((m) => m.timings || m.voiceLatencyMs);

  return (
    <div className="space-y-5 text-[12.5px]">
      <section>
        <Title>Simulated backend conditions</Title>
        <div className="grid grid-cols-2 gap-1.5">
          {MODES.map((m) => (
            <button key={m.id} onClick={() => post({ op: "chaos", mode: m.id })} className={`rounded-lg border px-2.5 py-1.5 text-left transition ${data?.chaosMode === m.id ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}>
              <div className="font-medium">{m.label}</div>
              <div className="text-[10.5px] text-slate-500">{m.hint}</div>
            </button>
          ))}
        </div>
        <button onClick={() => post({ op: "reset" })} className="mt-2 text-[11px] text-slate-400 hover:text-red-600">
          Reset demo data & metrics
        </button>
      </section>

      {lastTurn && (
        <section>
          <Title>Last turn</Title>
          <div className="rounded-lg bg-slate-50 p-2.5 font-mono text-[11.5px] leading-relaxed text-slate-700">
            {lastTurn.timings && (
              <>
                <div>model: {lastTurn.timings.model}</div>
                <div>
                  first token: {lastTurn.clientTtftMs ?? lastTurn.timings.ttftMs}ms · total: {lastTurn.timings.totalMs}ms
                </div>
                <div>
                  context: {lastTurn.timings.contextMs}ms · llm: {lastTurn.timings.llmMs}ms · tools: {lastTurn.timings.toolMs}ms · steps: {lastTurn.timings.steps}
                </div>
              </>
            )}
            {lastTurn.voiceLatencyMs !== undefined && <div>voice response: {lastTurn.voiceLatencyMs}ms</div>}
            {lastTurn.tools.map((t) => (
              <div key={t.callId} className="text-slate-500">
                ↳ {t.name} {t.result ? `${t.result.latencyMs}ms` : "…"} [{t.result?.spans.map((s) => `${s.system}${s.cached ? ":cache" : `:${s.latencyMs}ms`}${s.attempts > 1 ? `×${s.attempts}` : ""}`).join(", ")}]
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <Title>Conversation latency (p50 / p95, ms)</Title>
        <table className="w-full">
          <tbody>
            {KEY_METRICS.map(([k, label]) => {
              const m = h(k);
              return (
                <tr key={k} className="border-b border-slate-100">
                  <td className="py-1 pr-2 text-slate-600">{label}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{m ? `${m.p50} / ${m.p95}` : "—"}</td>
                  <td className="py-1 pl-2 text-right text-[10.5px] text-slate-400">{m ? `n=${m.count}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <Title>Enterprise systems</Title>
        <table className="w-full">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-slate-400">
              <th className="pb-1 font-medium">System</th>
              <th className="pb-1 text-right font-medium">p50/p95</th>
              <th className="pb-1 text-right font-medium">calls</th>
              <th className="pb-1 text-right font-medium">retry</th>
              <th className="pb-1 text-right font-medium">cache</th>
              <th className="pb-1 text-right font-medium">circuit</th>
            </tr>
          </thead>
          <tbody>
            {data?.systems.map((s) => {
              const m = backend.find((b) => b.name === `backend.${s.id}_ms`);
              const br = data.breakers.find((b) => b.system === s.id);
              return (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="py-1 text-slate-700">{s.label}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{m ? `${m.p50}/${m.p95}` : "—"}</td>
                  <td className="py-1 text-right tabular-nums">{c[`backend.${s.id}.calls`] ?? 0}</td>
                  <td className="py-1 text-right tabular-nums">{c[`backend.${s.id}.retries`] ?? 0}</td>
                  <td className="py-1 text-right tabular-nums">{c[`backend.${s.id}.cache_hits`] ?? 0}</td>
                  <td className="py-1 text-right">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${br?.state === "open" ? "bg-red-100 text-red-700" : br?.state === "half_open" ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{br?.state ?? "closed"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <Title>Audit trail (this customer)</Title>
        <ul className="space-y-1 font-mono text-[10.5px] text-slate-600">
          {data?.audit.length === 0 && <li className="text-slate-400">No events yet.</li>}
          {data?.audit.map((a, i) => (
            <li key={i} className="truncate" title={a.detail}>
              <span className="text-slate-400">{a.ts.slice(11, 19)}</span> <span className={a.event.startsWith("action") ? "text-brand-700" : a.event === "tool.denied" ? "text-red-600" : ""}>{a.event}</span> {a.name} <span className="text-slate-400">[{a.channel}]</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</h3>;
}
