"use client";

import { Icon } from "@/components/ui/Icon";
import { Pill, Stat, Widget } from "@/components/views/Widget";
import type { CardSummaryView, CardTransactionsView } from "@/capabilities/views";
import { formatDate, inr } from "@/lib/format";

export function CardSummary({ d }: { d: CardSummaryView }) {
  const used = d.limit - d.available;
  const util = used / d.limit;
  return (
    <Widget icon="card" title="Your credit card" subtitle={`Statement ${formatDate(d.statementDate)}`} source="Card Platform" accent="violet">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className={`relative h-[120px] w-[200px] shrink-0 overflow-hidden rounded-2xl p-3.5 text-white shadow-lg ${d.status === "blocked" ? "bg-slate-500 grayscale" : "bg-gradient-to-br from-slate-900 via-indigo-900 to-brand-700"}`}>
          <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10" />
          <div className="absolute -bottom-12 -left-6 h-28 w-28 rounded-full bg-violet-400/20" />
          <div className="relative flex items-center justify-between text-[11px] font-semibold tracking-wide">
            <span>{d.variant}</span>
            {d.status === "blocked" && <span className="rounded bg-rose-500 px-1.5 text-[9px]">BLOCKED</span>}
          </div>
          <div className="relative mt-3 h-6 w-8 rounded-md bg-gradient-to-br from-amber-200 to-amber-400" />
          <div className="relative mt-2 font-mono text-[13px] tracking-[0.2em]">•••• •••• •••• {d.last4}</div>
          <div className="relative mt-0.5 text-[10px] uppercase tracking-wider text-white/70">{d.holder}</div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3">
          <Stat label="Total due" value={inr(d.outstanding)} big />
          <Stat label="Minimum due" value={inr(d.minDue)} hint={`by ${formatDate(d.dueDate)}`} />
          <Stat label="Available" value={inr(d.available)} />
          <Stat label="Reward points" value={d.points.toLocaleString("en-IN")} />
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[11px] text-slate-500">
          <span>Limit used</span>
          <span className="tabular-nums">
            {inr(used)} of {inr(d.limit)} · {Math.round(util * 100)}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-100">
          <div className={`h-2 rounded-full ${util > 0.7 ? "bg-amber-500" : "bg-violet-500"}`} style={{ width: `${util * 100}%` }} />
        </div>
      </div>
    </Widget>
  );
}

export function CardTransactions({ d }: { d: CardTransactionsView }) {
  const dupes = d.items.filter((t) => t.duplicate).length;
  return (
    <Widget icon="copy" title="Card transactions" subtitle={`•${d.last4} · last ${d.days} days`} source="Card Platform" accent={dupes ? "amber" : "violet"}>
      {dupes > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-amber-200/70">
          <Icon name="alert" className="h-4 w-4" />
          {dupes} charges look like duplicates — same merchant and amount within 10 minutes.
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {d.items.map((t) => (
          <li key={t.id} className={`flex items-center gap-3 py-2 ${t.duplicate ? "-mx-2 rounded-lg bg-amber-50/60 px-2" : ""}`}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-[12px] font-semibold text-slate-600">{t.merchant[0]}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-slate-800">{t.merchant}</div>
              <div className="text-[11px] text-slate-400">
                {formatDate(t.date)} {t.time} · {t.category}
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[13px] font-semibold tabular-nums">{inr(t.amount)}</span>
              {t.duplicate && <Pill tone="amber">possible duplicate</Pill>}
              {t.status !== "posted" && <Pill tone="brand">{t.status}</Pill>}
            </div>
          </li>
        ))}
      </ul>
    </Widget>
  );
}
