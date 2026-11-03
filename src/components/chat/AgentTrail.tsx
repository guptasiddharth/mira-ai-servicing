"use client";

import { useState } from "react";
import { SYSTEM_SHORT, TOOL_LABELS, type ToolActivity } from "@/components/chat/model";
import { Icon } from "@/components/ui/Icon";
import type { TurnTimings } from "@/platform/agent/events";
import type { Source } from "@/platform/tools/types";

/**
 * "How I got this" — the assistant's working, made visible. While a turn runs
 * it shows live steps (understanding → which systems it's checking → what it's
 * calculating → composing). When done it collapses into a verification summary
 * that expands into a per-system latency waterfall.
 */

const KIND: Record<string, { icon: string; running: string; done: string; kind: "lookup" | "calc" | "policy" | "action" }> = {
  get_customer_profile: { icon: "user", running: "Reading your CRM profile", done: "Read CRM profile", kind: "lookup" },
  get_loan_details: { icon: "database", running: "Fetching your loan position", done: "Fetched loan position", kind: "lookup" },
  get_repayment_schedule: { icon: "clock", running: "Pulling your repayment schedule", done: "Pulled repayment schedule", kind: "lookup" },
  explain_emi_change: { icon: "trend", running: "Comparing your EMI history", done: "Compared EMI history & rate resets", kind: "calc" },
  get_payment_history: { icon: "activity", running: "Checking the Payments system", done: "Checked payment attempts", kind: "lookup" },
  simulate_prepayment: { icon: "calculator", running: "Running the prepayment calculator", done: "Calculated prepayment scenarios", kind: "calc" },
  check_foreclosure: { icon: "shield", running: "Evaluating foreclosure rules", done: "Evaluated foreclosure eligibility", kind: "calc" },
  search_policy: { icon: "book", running: "Looking up bank policy", done: "Looked up policy", kind: "policy" },
  get_service_requests: { icon: "ticket", running: "Checking your service requests", done: "Checked service requests", kind: "lookup" },
  get_card_summary: { icon: "card", running: "Fetching your card account", done: "Fetched card account", kind: "lookup" },
  get_card_transactions: { icon: "copy", running: "Scanning card transactions", done: "Scanned transactions for duplicates", kind: "calc" },
  confirm_action: { icon: "send", running: "Submitting your request", done: "Submitted request", kind: "action" },
  cancel_action: { icon: "x", running: "Cancelling", done: "Cancelled request", kind: "action" },
};
const meta = (name: string) => KIND[name] ?? { icon: "sparkles", running: `Preparing ${TOOL_LABELS[name] ?? name}`, done: `Prepared ${TOOL_LABELS[name] ?? name}`, kind: "action" as const };

export function AgentTrail({ tools, pending, hasText, timings, sources }: { tools: ToolActivity[]; pending: boolean; hasText: boolean; timings?: TurnTimings; sources: Source[] }) {
  const [open, setOpen] = useState(false);

  if (pending && !hasText) {
    const allDone = tools.length > 0 && tools.every((t) => t.status !== "running");
    return (
      <div className="trail-in rounded-2xl border border-brand-100 bg-gradient-to-br from-white to-brand-50/40 px-3.5 py-2.5 shadow-sm">
        <Step running={tools.length === 0} icon="sparkles" label={tools.length === 0 ? "Understanding your request" : "Understood your request"} />
        {tools.map((t) => (
          <Step key={t.callId} running={t.status === "running"} failed={t.status === "error"} cancelled={t.status === "cancelled"} icon={meta(t.name).icon} label={t.status === "running" ? meta(t.name).running : meta(t.name).done} detail={t.result ? stepDetail(t) : undefined} />
        ))}
        {allDone && <Step running icon="sparkles" label="Composing your answer" />}
      </div>
    );
  }

  if (tools.length === 0) return null;

  const spans = tools.flatMap((t) => t.result?.spans ?? []);
  const systems = [...new Set(spans.map((s) => s.system))];
  const calcs = tools.filter((t) => meta(t.name).kind === "calc").length;
  const policies = new Set(sources.filter((s) => s.system === "policy").map((s) => s.ref)).size;
  const failed = tools.some((t) => t.status === "error");
  const retries = spans.reduce((s, x) => s + Math.max(0, x.attempts - 1), 0);
  const maxMs = Math.max(1, ...spans.map((s) => s.latencyMs));

  return (
    <div className="trail-in">
      <button onClick={() => setOpen((o) => !o)} className="group flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-1 py-1 text-left text-[12px] text-slate-500 hover:bg-white/70">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${failed ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
          <Icon name={failed ? "alert" : "check"} className="h-3 w-3" strokeWidth={3} />
          {failed ? "Partially verified" : "Verified answer"}
        </span>
        {systems.length > 0 && <Chip icon="database">{systems.length} {systems.length === 1 ? "system" : "systems"}</Chip>}
        {calcs > 0 && <Chip icon="calculator">{calcs} {calcs === 1 ? "calculation" : "calculations"}</Chip>}
        {policies > 0 && <Chip icon="book">{policies} {policies === 1 ? "policy" : "policies"}</Chip>}
        {retries > 0 && <Chip icon="bolt">{retries} auto-retr{retries === 1 ? "y" : "ies"}</Chip>}
        {timings && <span className="font-mono text-[11px] text-slate-400">{(timings.totalMs / 1000).toFixed(1)}s</span>}
        <span className="ml-auto inline-flex items-center gap-0.5 text-[11.5px] text-brand-600 opacity-80 group-hover:opacity-100">
          How I got this <Icon name="chevron" className={`h-3 w-3 transition ${open ? "rotate-90" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          {tools.map((t) => (
            <div key={t.callId}>
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-slate-700">
                <span className="grid h-5 w-5 place-items-center rounded-md bg-slate-100 text-slate-500">
                  <Icon name={meta(t.name).icon} className="h-3 w-3" />
                </span>
                {meta(t.name).done}
                <span className="ml-auto font-mono text-[11px] font-normal text-slate-400">{t.result ? `${t.result.latencyMs}ms` : "—"}</span>
              </div>
              <div className="ml-7 mt-1 space-y-1">
                {(t.result?.spans ?? []).map((s, i) => (
                  <div key={i} className="grid grid-cols-[92px_1fr_70px] items-center gap-2 text-[11px]">
                    <span className="truncate text-slate-500">
                      {SYSTEM_SHORT[s.system] ?? s.system}
                      <span className="text-slate-300">.{s.operation}</span>
                    </span>
                    <span className="h-1.5 rounded-full bg-slate-100">
                      <span
                        className={`block h-1.5 rounded-full ${s.outcome === "error" ? "bg-rose-400" : s.cached ? "bg-emerald-400" : s.attempts > 1 ? "bg-amber-400" : "bg-brand-500"}`}
                        style={{ width: s.cached ? "4px" : `${Math.max(3, (s.latencyMs / maxMs) * 100)}%` }}
                      />
                    </span>
                    <span className="text-right font-mono text-slate-400">{s.cached ? "cache" : `${s.latencyMs}ms`}{s.attempts > 1 ? ` ×${s.attempts}` : ""}</span>
                  </div>
                ))}
                {t.result?.error && <div className="text-[11px] text-rose-600">{t.result.error.code.toLowerCase().replaceAll("_", " ")}: {t.result.error.message}</div>}
              </div>
            </div>
          ))}
          {timings && (
            <div className="border-t border-slate-100 pt-2 font-mono text-[10.5px] text-slate-400">
              {timings.model} · context {timings.contextMs}ms · model {timings.llmMs}ms · tools {timings.toolMs}ms (parallel) · {timings.steps} steps
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function stepDetail(t: ToolActivity) {
  const r = t.result!;
  const sys = [...new Set(r.spans.map((s) => SYSTEM_SHORT[s.system] ?? s.system))].join(" + ");
  const cached = r.spans.length > 0 && r.spans.every((s) => s.cached);
  return `${sys}${sys ? " · " : ""}${cached ? "instant (cached)" : `${r.latencyMs}ms`}`;
}

function Step({ running, failed, cancelled, icon, label, detail }: { running?: boolean; failed?: boolean; cancelled?: boolean; icon: string; label: string; detail?: string }) {
  return (
    <div className="step-in flex items-center gap-2.5 py-1 text-[12.5px]">
      <span
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
          running ? "bg-brand-100 text-brand-600" : failed ? "bg-amber-100 text-amber-700" : cancelled ? "bg-slate-100 text-slate-400" : "bg-emerald-100 text-emerald-600"
        }`}
      >
        {running ? <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" /> : <Icon name={failed ? "alert" : cancelled ? "x" : "check"} className="h-3 w-3" strokeWidth={3} />}
      </span>
      <Icon name={icon} className="h-3.5 w-3.5 text-slate-400" />
      <span className={`${running ? "shimmer-text font-medium" : cancelled ? "text-slate-400 line-through" : "text-slate-700"}`}>{label}</span>
      {detail && <span className="font-mono text-[10.5px] text-slate-400">{detail}</span>}
    </div>
  );
}

function Chip({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-slate-500">
      <Icon name={icon} className="h-3 w-3 text-slate-400" />
      {children}
    </span>
  );
}
