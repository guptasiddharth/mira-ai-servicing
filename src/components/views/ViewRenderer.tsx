"use client";

import { Icon } from "@/components/ui/Icon";
import { CardSummary, CardTransactions } from "@/components/views/CardViews";
import { EmiChange, Foreclosure, LoanOverview, Payments, Prepayment, Schedule } from "@/components/views/LoanViews";
import { Pill, Widget } from "@/components/views/Widget";
import type { CapabilityView, PolicyView, ServiceRequestsView } from "@/capabilities/views";
import type { ToolView } from "@/platform/tools/types";
import { formatDate } from "@/lib/format";

/**
 * View registry: maps a tool's `view.kind` to a widget. A new workflow can
 * reuse these or register its own; unknown kinds render nothing (the text
 * answer still stands on its own).
 */
export function ViewRenderer({ view }: { view: ToolView }) {
  const v = view as CapabilityView;
  switch (v.kind) {
    case "emi_change":
      return <EmiChange d={v.data} />;
    case "prepayment":
      return <Prepayment d={v.data} />;
    case "payments":
      return <Payments d={v.data} />;
    case "foreclosure":
      return <Foreclosure d={v.data} />;
    case "loan_overview":
      return <LoanOverview d={v.data} />;
    case "schedule":
      return <Schedule d={v.data} />;
    case "policy":
      return <Policy d={v.data} />;
    case "service_requests":
      return <ServiceRequests d={v.data} />;
    case "card_summary":
      return <CardSummary d={v.data} />;
    case "card_transactions":
      return <CardTransactions d={v.data} />;
    default:
      return null;
  }
}

function Policy({ d }: { d: PolicyView }) {
  return (
    <Widget icon="book" title="Policy clauses applied" source="Policy Knowledge" accent="violet">
      <div className="space-y-2">
        {d.clauses.map((c) => (
          <details key={c.id} className="group rounded-xl border border-slate-200 px-3 py-2 open:bg-slate-50/60">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-slate-800">
              <span className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[10.5px] text-violet-700">{c.id}</span>
              {c.title}
              <Icon name="chevron" className="ml-auto h-3.5 w-3.5 text-slate-400 transition group-open:rotate-90" />
            </summary>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">{c.text}</p>
          </details>
        ))}
      </div>
    </Widget>
  );
}

function ServiceRequests({ d }: { d: ServiceRequestsView }) {
  return (
    <Widget icon="ticket" title="Your service requests" source="Service Operations">
      <ul className="divide-y divide-slate-100">
        {d.items.map((r) => (
          <li key={r.reference} className="flex items-center gap-3 py-2">
            <span className="font-mono text-[12px] font-semibold text-slate-700">{r.reference}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-600">{r.summary}</span>
            <span className="text-[11px] text-slate-400">by {formatDate(r.expectedBy)}</span>
            <Pill tone={r.status === "resolved" ? "emerald" : "amber"}>{r.status}</Pill>
          </li>
        ))}
      </ul>
    </Widget>
  );
}
