"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "@/components/ui/Icon";
import type { Source } from "@/platform/tools/types";

const CITE = /\[((?:POL-[A-Z]+-\d+)(?:\s*,\s*POL-[A-Z]+-\d+)*)\]/g;

/**
 * Answer renderer with a citation guard: every [POL-…] the model writes becomes
 * an inline chip, verified against the sources the tools actually returned.
 * A clause ID that no tool produced is flagged as unverified.
 */
export function Markdown({ text, sources }: { text: string; sources: Source[] }) {
  const linked = text.replace(CITE, (_, ids: string) =>
    ids
      .split(",")
      .map((id) => `[${id.trim()}](#cite-${id.trim()})`)
      .join(" "),
  );
  const byRef = new Map(sources.filter((s) => s.system === "policy").map((s) => [s.ref, s]));
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          if (href?.startsWith("#cite-")) {
            const id = href.slice(6);
            const src = byRef.get(id);
            return src ? (
              <span className="group relative mx-0.5 inline-flex cursor-help items-center gap-0.5 rounded-md bg-violet-50 px-1 py-px align-baseline font-mono text-[10.5px] font-medium text-violet-700 ring-1 ring-violet-100">
                <Icon name="book" className="h-2.5 w-2.5" />
                {id}
                {src.detail && (
                  <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-slate-200 bg-white p-3 font-sans text-[12px] font-normal leading-relaxed text-slate-600 opacity-0 shadow-xl transition group-hover:opacity-100">
                    <span className="mb-1 block font-semibold text-slate-800">{src.label}</span>
                    {src.detail}
                  </span>
                )}
              </span>
            ) : (
              <span title="This reference was not returned by any system in this answer — treat with caution." className="mx-0.5 inline-flex cursor-help items-center gap-0.5 rounded-md bg-amber-50 px-1 py-px align-baseline font-mono text-[10.5px] font-medium text-amber-700 ring-1 ring-amber-200">
                <Icon name="alert" className="h-2.5 w-2.5" />
                {id} · unverified
              </span>
            );
          }
          return (
            <a href={href} className="text-brand-600 underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {linked}
    </ReactMarkdown>
  );
}
