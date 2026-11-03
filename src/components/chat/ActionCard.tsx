"use client";

import { Icon } from "@/components/ui/Icon";
import type { PendingActionView } from "@/platform/actions/store";

/**
 * Action ticket. Nothing changes in any system until the customer confirms —
 * the stepper makes the two-phase contract visible: Prepared → Confirm → Submitted.
 */
export function ActionCard({ action, onDecide }: { action: PendingActionView; onDecide: (a: PendingActionView, d: "confirm" | "cancel") => void }) {
  const s = action.status;
  const submitted = s === "confirmed" && action.reference && action.reference !== "…";
  const steps = [
    { label: "Prepared", state: "done" },
    { label: "Your confirmation", state: s === "pending" ? "active" : s === "confirmed" ? "done" : "stopped" },
    { label: submitted ? `Submitted · ${action.reference}` : "Submitted", state: submitted ? "done" : s === "confirmed" ? "active" : "todo" },
  ];

  return (
    <div className={`widget-in overflow-hidden rounded-2xl border bg-white shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)] ${submitted ? "border-emerald-200" : s === "pending" ? "border-brand-200" : "border-slate-200"}`}>
      <div className={`flex items-center gap-3 px-4 py-3 ${submitted ? "bg-emerald-50/70" : s === "pending" ? "bg-gradient-to-r from-brand-50 to-violet-50" : "bg-slate-50"}`}>
        <span className={`grid h-8 w-8 place-items-center rounded-xl ${submitted ? "bg-emerald-500 text-white" : "bg-white text-brand-600 shadow-sm"}`}>
          <Icon name={submitted ? "check" : "ticket"} className="h-4 w-4" strokeWidth={submitted ? 3 : 2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-slate-800">{action.title}</div>
          <div className="truncate text-[12px] text-slate-500">{action.summary}</div>
        </div>
      </div>

      <ol className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-[11.5px]">
        {steps.map((st, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1.5">
            <span
              className={`grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full text-[9px] font-bold ${
                st.state === "done" ? "bg-emerald-500 text-white" : st.state === "active" ? "bg-brand-600 text-white ring-4 ring-brand-100" : st.state === "stopped" ? "bg-slate-300 text-white" : "bg-slate-100 text-slate-400"
              }`}
            >
              {st.state === "done" ? <Icon name="check" className="h-2.5 w-2.5" strokeWidth={4} /> : i + 1}
            </span>
            <span className={`truncate ${st.state === "active" ? "font-medium text-brand-700" : st.state === "done" ? "text-slate-700" : "text-slate-400"}`}>{st.label}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 shrink-0 bg-slate-200" />}
          </li>
        ))}
      </ol>

      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 px-4 py-3 text-[13px]">
        {Object.entries(action.details).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-medium text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>

      {s === "pending" ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-2.5">
          <button onClick={() => onDecide(action, "confirm")} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-[13px] font-medium text-white shadow-sm transition hover:bg-brand-700">
            <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} /> Confirm
          </button>
          <button onClick={() => onDecide(action, "cancel")} className="rounded-xl px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <span className="ml-auto text-[11.5px] text-slate-400">or just say “yes, go ahead”</span>
        </div>
      ) : s === "cancelled" || s === "expired" || s === "failed" ? (
        <div className={`border-t px-4 py-2 text-[12.5px] font-medium ${s === "failed" ? "border-rose-100 bg-rose-50 text-rose-700" : "border-slate-100 text-slate-500"}`}>{s === "failed" ? action.error ?? "Failed" : s === "expired" ? "Expired — ask again to re-create" : "Cancelled — nothing was changed"}</div>
      ) : null}
    </div>
  );
}
