"use client";

import { LineChart } from "@/components/charts/LineChart";
import { Icon } from "@/components/ui/Icon";
import { Pill, Ring, Stat, Widget } from "@/components/views/Widget";
import type { EmiChangeView, ForeclosureView, LoanOverviewView, PaymentsView, PrepaymentView, ScheduleView } from "@/capabilities/views";
import { formatDate, inr, inrShort, pct } from "@/lib/format";

/** Validated categorical palette (dataviz validator: all checks pass, light mode). */
const C = { current: "#d97706", tenure: "#2f6fed", emi: "#0d9488" };

const monthLabel = (iso: string, plus = 0) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + plus);
  return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
};

// ─────────────────────────────── EMI change ───────────────────────────────
export function EmiChange({ d }: { d: EmiChangeView }) {
  const up = d.delta > 0;
  const hist = d.history.slice(-10);
  const min = Math.min(...hist.map((h) => h.emi));
  return (
    <Widget icon="trend" title="Why your EMI changed" subtitle={`Loan ${d.loanId} · ${d.rateType} rate`} source="Loan Management" accent="amber">
      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded-xl bg-slate-50 px-3.5 py-2.5">
          <div className="text-[10.5px] uppercase tracking-wide text-slate-400">EMI #{d.previous.n} · {formatDate(d.previous.dueDate)}</div>
          <div className="text-xl font-semibold tabular-nums text-slate-700">{inr(d.previous.emi)}</div>
          <div className="text-[11.5px] text-slate-500">at {pct(d.previous.rate)}</div>
        </div>
        <div className="flex flex-col items-center text-slate-300">
          <Icon name="send" className="h-5 w-5" />
          <Pill tone={up ? "amber" : "emerald"}>
            {up ? "+" : ""}
            {inr(d.delta)} ({up ? "+" : ""}
            {pct(d.deltaPct)})
          </Pill>
        </div>
        <div className="rounded-xl bg-amber-50/70 px-3.5 py-2.5 ring-1 ring-amber-200/60">
          <div className="text-[10.5px] uppercase tracking-wide text-amber-700/70">EMI #{d.current.n} · {formatDate(d.current.dueDate)}</div>
          <div className="text-xl font-semibold tabular-nums text-slate-900">{inr(d.current.emi)}</div>
          <div className="text-[11.5px] text-amber-800">at {pct(d.current.rate)}</div>
        </div>
      </div>

      {d.reset && (
        <div className="mt-3 flex gap-3 rounded-xl border border-slate-200 p-3">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
            <Icon name="activity" className="h-3.5 w-3.5" />
          </span>
          <div className="text-[13px] leading-snug">
            <div className="font-medium text-slate-800">Floating-rate reset on {formatDate(d.reset.effectiveFrom)}</div>
            <div className="text-slate-600">{d.reset.reason}.</div>
            <div className="mt-1 text-[12px] text-slate-500">
              EMI recalculated on {inr(d.reset.outstandingAtReset)} over the remaining {d.reset.remainingMonths} months — your tenure did not change.
            </div>
          </div>
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1 text-[11.5px] font-medium text-slate-500">EMI per instalment</div>
        <LineChart
          ariaLabel="EMI by instalment"
          step
          height={150}
          minY={Math.floor((min * 0.97) / 100) * 100}
          series={[{ key: "emi", label: "EMI", color: C.tenure, values: hist.map((h) => h.emi) }]}
          formatY={(v) => inr(v)}
          formatX={(i) => `${monthLabel(hist[i]?.label ?? hist[0].label)}`}
        />
      </div>
    </Widget>
  );
}

// ─────────────────────────────── Prepayment ───────────────────────────────
export function Prepayment({ d }: { d: PrepaymentView }) {
  const options = [
    { key: "current", label: "Keep as is", color: C.current, emi: d.baseline.emi, months: d.baseline.months, interest: d.baseline.interest, saved: 0, extra: null as string | null },
    { key: "tenure", label: "Reduce tenure", color: C.tenure, emi: d.reduceTenure.emi, months: d.reduceTenure.months, interest: d.baseline.interest - d.reduceTenure.interestSaved, saved: d.reduceTenure.interestSaved, extra: `${d.reduceTenure.monthsSaved} months sooner`, best: true },
    { key: "emi", label: "Reduce EMI", color: C.emi, emi: d.reduceEmi.emi, months: d.reduceEmi.months, interest: d.baseline.interest - d.reduceEmi.interestSaved, saved: d.reduceEmi.interestSaved, extra: `${inr(d.reduceEmi.emiReduction)}/mo lower` },
  ];
  return (
    <Widget icon="calculator" title={`Prepaying ${inr(d.amount)}`} subtitle={`Loan ${d.loanId} · ${pct(d.rate)} · charges ${d.charges ? inr(d.charges, 2) : "nil"}`} source="Calculated" accent="brand">
      {!d.eligible && (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
          <div className="flex items-center gap-1.5 font-medium">
            <Icon name="alert" className="h-3.5 w-3.5" /> Not permitted as requested
          </div>
          {d.violations.map((v, i) => (
            <div key={i}>
              {v.message} <span className="font-mono text-[10.5px] text-rose-500">[{v.ruleId}]</span>
            </div>
          ))}
          {d.maxAllowed >= 10_000 && <div className="mt-1 font-medium">Largest permitted today: {inr(d.maxAllowed)}</div>}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <div key={o.key} className={`relative rounded-xl border p-3 ${o.best ? "border-brand-200 bg-brand-50/50 ring-1 ring-brand-200" : "border-slate-200"}`}>
            {o.best && <span className="absolute -top-2 right-2 rounded-full bg-brand-600 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-white">Saves most</span>}
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
              <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
              {o.label}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Stat label="EMI" value={inr(o.emi)} />
              <Stat label="Months left" value={o.months} />
            </div>
            <div className="mt-2 border-t border-slate-100 pt-2">
              {o.saved > 0 ? (
                <>
                  <div className="text-[10.5px] uppercase tracking-wide text-slate-400">Interest saved</div>
                  <div className="text-[17px] font-semibold tabular-nums text-emerald-700">{inr(o.saved)}</div>
                  <div className="text-[11px] text-slate-500">{o.extra}</div>
                </>
              ) : (
                <>
                  <div className="text-[10.5px] uppercase tracking-wide text-slate-400">Interest to pay</div>
                  <div className="text-[17px] font-semibold tabular-nums text-slate-700">{inr(o.interest)}</div>
                  <div className="text-[11px] text-slate-500">no change</div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="mb-1 text-[11.5px] font-medium text-slate-500">Outstanding balance over time</div>
        <LineChart
          ariaLabel="Outstanding balance by month for each option"
          series={[
            { key: "current", label: "Keep as is", color: C.current, values: d.series.baseline, endLabel: `${d.baseline.months} mo` },
            { key: "emi", label: "Reduce EMI", color: C.emi, values: d.series.reduceEmi },
            { key: "tenure", label: "Reduce tenure", color: C.tenure, values: d.series.reduceTenure, endLabel: `${d.reduceTenure.months} mo` },
          ]}
          formatY={inrShort}
          formatX={(i) => (i === 0 ? "Today" : monthLabel(d.startDate, i))}
        />
      </div>
    </Widget>
  );
}

// ──────────────────────────────── Payments ────────────────────────────────
export function Payments({ d }: { d: PaymentsView }) {
  return (
    <Widget icon="activity" title="Payment history" subtitle={d.period} source="Payments" accent={d.failed ? "rose" : "emerald"}>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label="Debit attempts" value={d.attempts} />
        <Stat label="Failed" value={d.failed} tone={d.failed ? "bad" : "good"} />
        <Stat label="Bounce charges" value={inr(d.chargesTotal)} tone={d.chargesTotal ? "warn" : "default"} />
      </div>
      <ol className="relative space-y-2.5 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-slate-200">
        {d.items.map((p) => {
          const failed = p.status === "failed";
          return (
            <li key={p.id} className="relative flex gap-3">
              <span className={`relative z-10 mt-0.5 grid h-[23px] w-[23px] shrink-0 place-items-center rounded-full ring-4 ring-white ${failed ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-600"}`}>
                <Icon name={failed ? "x" : "check"} className="h-3 w-3" strokeWidth={3} />
              </span>
              <div className={`min-w-0 flex-1 rounded-xl px-3 py-2 ${failed ? "border border-rose-100 bg-rose-50/40" : ""}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <div className="text-[13px] font-medium text-slate-800">
                    {formatDate(p.date)} · EMI #{p.installment} <span className="font-normal text-slate-400">via {p.channel}</span>
                  </div>
                  <div className="text-[13px] font-semibold tabular-nums">{inr(p.amount)}</div>
                </div>
                {failed ? (
                  <div className="mt-1 space-y-1 text-[12px]">
                    <div className="text-slate-700">
                      <span className="font-medium text-rose-700">{p.status === "failed" ? "Failed" : ""}:</span> {p.failureReason} <span className="font-mono text-[10.5px] text-slate-400">{p.failureCode}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Pill tone={p.category === "technical" ? "amber" : "slate"}>{p.category === "technical" ? "Bank-side technical error" : "Insufficient funds"}</Pill>
                      {p.charge ? <Pill tone="rose">Bounce charge {inr(p.charge)}</Pill> : null}
                      {p.recoveredOn && (
                        <Pill tone="emerald">
                          Paid {formatDate(p.recoveredOn)} via {p.recoveredVia}
                        </Pill>
                      )}
                      {p.reversalLikely ? <Pill tone="brand">Charge reversal likely</Pill> : p.canDispute ? <Pill>Can be disputed</Pill> : <Pill>Outside dispute window</Pill>}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11.5px] text-emerald-700">Successful</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Widget>
  );
}

// ─────────────────────────────── Foreclosure ──────────────────────────────
export function Foreclosure({ d }: { d: ForeclosureView }) {
  const status = d.allowedNow ? (d.penaltyFree ? { t: "Eligible now · no penalty", tone: "emerald" as const } : { t: `Eligible now · ${d.chargePct}% charge`, tone: "amber" as const }) : { t: "Not yet eligible", tone: "rose" as const };
  const milestones = [
    ...(d.allowedFrom ? [{ at: d.allowedFrom.emi, label: `Allowed · ${formatDate(d.allowedFrom.date)}` }] : [{ at: 6, label: "Lock-in done" }]),
    ...(d.penaltyFreeFrom ? [{ at: d.penaltyFreeFrom.emi, label: `Penalty-free · ${formatDate(d.penaltyFreeFrom.date)}` }] : []),
  ];
  const quoteRows: [string, number][] = [
    ["Outstanding principal", d.quote.principal],
    ["Interest accrued since last EMI", d.quote.interest],
    ["Foreclosure charge", d.quote.charge],
    ["GST on charge", d.quote.gst],
  ];
  return (
    <Widget icon="shield" title="Foreclosure check" subtitle={`Loan ${d.loanId} · ${d.rateType} rate`} source="Policy engine" accent={status.tone === "emerald" ? "emerald" : status.tone === "amber" ? "amber" : "rose"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Pill tone={status.tone}>
          <Icon name={d.allowedNow ? "check" : "clock"} className="h-3 w-3" strokeWidth={3} />
          {status.t}
        </Pill>
        <span className="text-[11.5px] text-slate-500">
          {d.emisPaid} of {d.tenure} EMIs paid
        </span>
      </div>

      <div className="relative mb-9 mt-5 h-2 rounded-full bg-slate-100">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-500 to-indigo-500" style={{ width: `${(d.emisPaid / d.tenure) * 100}%` }} />
        <div className="absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-brand-600 shadow" style={{ left: `${(d.emisPaid / d.tenure) * 100}%` }} title="You are here" />
        {milestones.map((m) => (
          <div key={m.label} className="absolute top-3 -translate-x-1/2 text-center" style={{ left: `${(m.at / d.tenure) * 100}%` }}>
            <div className="mx-auto h-2 w-px bg-slate-400" />
            <div className="whitespace-nowrap text-[10px] text-slate-500">{m.label}</div>
          </div>
        ))}
      </div>

      <ul className="space-y-1.5">
        {d.checks.map((c) => (
          <li key={c.label} className="flex items-center gap-2 text-[13px]">
            <span className={`grid h-5 w-5 place-items-center rounded-full ${c.ok ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"}`}>
              <Icon name={c.ok ? "check" : "x"} className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className="text-slate-800">{c.label}</span>
            <span className="text-slate-400">· {c.note}</span>
            <span className="ml-auto font-mono text-[10.5px] text-slate-400">{c.ruleId}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{d.allowedNow ? "Payoff amount today" : "Indicative payoff today"}</div>
          {quoteRows.map(([k, v]) => (
            <div key={k} className="flex justify-between text-[12.5px] text-slate-600">
              <span>{k}</span>
              <span className="tabular-nums">{inr(v, 2)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-[14px] font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{inr(d.quote.total, 2)}</span>
          </div>
        </div>
        <div className="flex flex-col justify-center rounded-xl bg-emerald-50 px-4 py-3 text-center ring-1 ring-emerald-100">
          <div className="text-[10.5px] uppercase tracking-wide text-emerald-700/70">Future interest avoided</div>
          <div className="text-xl font-semibold tabular-nums text-emerald-700">{inr(d.netBenefit)}</div>
          <div className="text-[11px] text-emerald-700/70">net of charges</div>
        </div>
      </div>
    </Widget>
  );
}

// ──────────────────────────────── Overview ────────────────────────────────
export function LoanOverview({ d }: { d: LoanOverviewView }) {
  const repaid = d.principal - d.outstanding;
  return (
    <Widget icon="loan" title={d.product} subtitle={`${d.loanId} · ${d.autoDebit}`} source="Loan Management">
      <div className="flex items-center gap-4">
        <Ring value={repaid} max={d.principal} size={76}>
          <div>
            <div className="text-[15px] font-semibold">{Math.round((repaid / d.principal) * 100)}%</div>
            <div className="text-[9px] uppercase tracking-wide text-slate-400">repaid</div>
          </div>
        </Ring>
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Outstanding" value={inr(d.outstanding)} />
          <Stat label="EMI" value={inr(d.emi)} />
          <Stat label="Rate" value={pct(d.rate)} hint={d.rateType} />
          <Stat label="Next due" value={d.nextDue ? formatDate(d.nextDue.date) : "—"} hint={`${d.emisPaid}/${d.tenure} paid`} />
        </div>
      </div>
      {d.rateHistory.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {d.rateHistory.map((r, i) => (
            <div key={i} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11.5px]" title={r.reason}>
              <span className="font-semibold">{pct(r.rate)}</span> <span className="text-slate-500">from {formatDate(r.from)}</span>
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}

// ──────────────────────────────── Schedule ────────────────────────────────
export function Schedule({ d }: { d: ScheduleView }) {
  return (
    <Widget icon="clock" title="Repayment schedule" subtitle={`Loan ${d.loanId}`} source="Loan Management">
      <div className="mb-2 flex gap-4 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: C.tenure }} /> Principal
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: C.current }} /> Interest
        </span>
      </div>
      <div className="space-y-1.5">
        {d.rows.map((r) => (
          <div key={r.n} className="grid grid-cols-[64px_1fr_76px] items-center gap-3 text-[12px]" title={`Principal ${inr(r.principal, 2)} · Interest ${inr(r.interest, 2)}`}>
            <div className="text-slate-500">
              #{r.n} <span className="text-slate-400">{monthLabel(r.date)}</span>
            </div>
            <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
              <div className="rounded-l-full" style={{ width: `${(r.principal / r.emi) * 100}%`, background: C.tenure }} />
              <div className="rounded-r-full" style={{ width: `${(r.interest / r.emi) * 100}%`, background: C.current }} />
            </div>
            <div className="text-right font-medium tabular-nums">{inr(r.emi)}</div>
          </div>
        ))}
      </div>
    </Widget>
  );
}
