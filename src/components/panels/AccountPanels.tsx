"use client";

import { Icon } from "@/components/ui/Icon";
import { Ring } from "@/components/views/Widget";
import type { Panel, Tone } from "@/platform/workflows/types";

const TONE: Record<Tone, string> = {
  default: "text-slate-800",
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-rose-600",
};
const RING: Record<Tone, string> = { default: "#2f6fed", good: "#059669", warn: "#d97706", bad: "#e11d48" };

/** Customer card + generic, workflow-defined panels — new workflows get this UI for free. */
export function AccountPanels({
  customer,
  panels,
  onRefresh,
}: {
  customer: { name: string; id: string; city: string; segment: string; customerSince: string };
  panels: Panel[] | null;
  onRefresh: () => void;
}) {
  const initials = customer.name
    .split(" ")
    .map((n) => n[0])
    .join("");
  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-brand-800 p-4 text-white shadow-lg">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-violet-500 text-[14px] font-semibold ring-2 ring-white/20">{initials}</div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{customer.name}</div>
            <div className="text-[11.5px] text-white/60">
              {customer.segment} · {customer.city}
            </div>
          </div>
        </div>
        <div className="relative mt-3 flex items-center justify-between gap-2 text-[11px] text-white/55">
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Icon name="shield" className="h-3 w-3" /> OTP verified
          </span>
          <span className="whitespace-nowrap">Since {customer.customerSince}</span>
        </div>
      </section>

      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Live from systems of record</h2>
        <button onClick={onRefresh} className="text-[11px] text-slate-400 hover:text-brand-600">
          Refresh
        </button>
      </div>

      {!panels && [0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200/60" />)}

      {panels?.map((p) => (
        <section key={p.id} className="panel-in rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="whitespace-nowrap text-[14px] font-semibold text-slate-800">{p.title}</h3>
              {p.subtitle && <div className="truncate text-[11.5px] text-slate-500">{p.subtitle}</div>}
            </div>
            {p.progress ? (
              <Ring value={p.progress.value} max={p.progress.max} size={46} stroke={5} color={RING[p.progress.tone ?? "default"]}>
                <span className="text-[10.5px] font-semibold tabular-nums">{Math.round((p.progress.value / p.progress.max) * 100)}%</span>
              </Ring>
            ) : (
              <span className="shrink-0 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">{p.source}</span>
            )}
          </div>
          {p.progress && (
            <div className="mt-0.5 text-[10.5px] text-slate-400">
              {p.progress.label} · {p.source}
            </div>
          )}
          {p.error && <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-700">{p.error}</div>}
          {p.stats && (
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
              {p.stats.map((s) => (
                <div key={s.label}>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{s.label}</div>
                  <div className={`text-[16px] font-semibold tabular-nums tracking-tight ${TONE[s.tone ?? "default"]}`}>{s.value}</div>
                  {s.hint && <div className="text-[10.5px] text-amber-600">{s.hint}</div>}
                </div>
              ))}
            </div>
          )}
          {p.list && (
            <>
              {!p.stats && <div className="mt-1" />}
              <ul className="mt-2 space-y-1">
                {p.list.items.length === 0 && <li className="py-1.5 text-xs text-slate-400">{p.list.empty ?? "Nothing here yet."}</li>}
                {p.list.items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 hover:bg-slate-50">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${it.tone === "bad" ? "bg-rose-500" : it.tone === "good" ? "bg-emerald-500" : it.tone === "warn" ? "bg-amber-500" : "bg-slate-300"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-slate-700">{it.primary}</div>
                      {it.secondary && <div className="truncate text-[11px] text-slate-400">{it.secondary}</div>}
                    </div>
                    {it.value && <div className={`shrink-0 text-[12.5px] font-medium tabular-nums ${TONE[it.tone ?? "default"]}`}>{it.value}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
