"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Orb } from "@/components/ui/Orb";
import type { Panel } from "@/platform/workflows/types";

/** Time-of-day greeting from the customer's own clock (client-only, so SSR in a UTC region can't mismatch). */
function useGreeting() {
  const [word, setWord] = useState("Hello");
  useEffect(() => {
    const h = new Date().getHours();
    setWord(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");
  }, []);
  return word;
}

/** First-run hero: who the assistant is, what it already knows, what it can do. */
export function Welcome({
  agent,
  firstName,
  workflowName,
  starters,
  panels,
  onPick,
  onVoice,
}: {
  agent: { name: string; title: string };
  firstName: string;
  workflowName: string;
  starters: { label: string; prompt: string; description?: string; icon?: string }[];
  panels: Panel[] | null;
  onPick: (prompt: string) => void;
  onVoice: () => void;
}) {
  const greeting = useGreeting();
  const snapshot = panels?.find((p) => p.stats)?.stats?.slice(0, 3) ?? [];
  return (
    <div className="msg-in flex flex-col items-center pt-6 text-center sm:pt-10">
      <Orb size={84} state="idle" />
      <h1 className="mt-5 text-[28px] font-semibold tracking-tight text-slate-900">
        {greeting}, {firstName}.
      </h1>
      <p className="mt-1.5 max-w-md text-[15px] text-slate-500">
        I&apos;m <span className="font-medium text-slate-700">{agent.name}</span>, your {agent.title} at Kestrel Finance. I already have your accounts open — ask me anything, by text or voice.
      </p>

      {snapshot.length > 0 && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {snapshot.map((s) => (
            <span key={s.label} className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[12.5px] text-slate-600 shadow-sm backdrop-blur">
              <span className="text-slate-400">{s.label}</span> <span className="font-semibold tabular-nums text-slate-800">{s.value}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-2">
        {starters.map((s, i) => (
          <button
            key={s.label}
            onClick={() => onPick(s.prompt)}
            style={{ animationDelay: `${80 + i * 60}ms` }}
            className="tile-in group flex gap-3 text-left rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-50 to-violet-50 text-brand-600 ring-1 ring-brand-100 transition group-hover:from-brand-500 group-hover:to-violet-500 group-hover:text-white">
              <Icon name={s.icon ?? "sparkles"} className="h-4.5 w-4.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-slate-800">{s.label}</span>
              {s.description && <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">{s.description}</span>}
            </span>
          </button>
        ))}
      </div>

      <button onClick={onVoice} className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-[13px] font-medium text-white shadow-lg transition hover:bg-slate-800">
        <Icon name="mic" className="h-4 w-4" />
        Prefer to talk? Start a voice conversation
      </button>
      <p className="mt-2 text-[11.5px] text-slate-400">Interrupt me any time · switch between voice and text freely</p>
    </div>
  );
}
