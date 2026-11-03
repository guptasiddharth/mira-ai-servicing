"use client";

import { SYSTEM_SHORT } from "@/components/chat/model";
import { Icon } from "@/components/ui/Icon";
import type { Source } from "@/platform/tools/types";

/** Source records + policy clauses behind an answer. Hover a clause to read it. */
export function Citations({ sources }: { sources: Source[] }) {
  const policy = sources.filter((s) => s.system === "policy");
  const records = sources.filter((s) => s.system !== "policy");
  if (!policy.length && !records.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {records.map((s) => (
        <span key={`${s.system}-${s.ref}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-slate-600">
          <Icon name="database" className="h-3 w-3 text-slate-400" />
          <span className="text-slate-400">{SYSTEM_SHORT[s.system] ?? s.system}</span> {s.label.replace(/^Loan /, "")}
        </span>
      ))}
      {policy.map((p) => (
        <span key={p.ref} className="group relative inline-flex cursor-help items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 font-mono text-[10.5px] text-violet-700 ring-1 ring-violet-100">
          <Icon name="book" className="h-3 w-3" />
          {p.ref}
          {p.detail && (
            <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-slate-200 bg-white p-3 font-sans text-[12px] leading-relaxed text-slate-600 opacity-0 shadow-xl transition group-hover:opacity-100">
              <span className="mb-1 block font-semibold text-slate-800">{p.label}</span>
              {p.detail}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
