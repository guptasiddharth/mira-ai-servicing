"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { VoiceStatus } from "@/components/voice/useVoiceSession";

interface VoiceControls {
  status: VoiceStatus;
  active: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function Composer({
  suggestions,
  busy,
  onSend,
  voice,
  placeholder,
}: {
  suggestions: { label: string; prompt: string }[];
  busy: boolean;
  onSend: (text: string) => void;
  voice: VoiceControls;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-[#f4f6fb] to-transparent" />
      <div className="mx-auto max-w-[52rem] px-4 pb-4 pt-1">
        {suggestions.length > 0 && !voice.active && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {suggestions.map((s) => (
              <button key={s.label} onClick={() => onSend(s.prompt)} disabled={busy} className="shrink-0 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[12px] text-slate-600 backdrop-blur transition hover:border-brand-200 hover:text-brand-700 disabled:opacity-50">
                {s.label}
              </button>
            ))}
          </div>
        )}
        {voice.error && !voice.active && <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">{voice.error}</div>}

        <div className="flex items-end gap-2 rounded-[22px] border border-slate-200 bg-white p-1.5 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)] focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100/70">
          <button
            onClick={voice.active ? voice.stop : voice.start}
            disabled={voice.status === "connecting"}
            aria-label={voice.active ? "End voice conversation" : "Start voice conversation"}
            title={voice.active ? "End voice conversation" : "Talk to the assistant (headphones recommended)"}
            className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl transition ${voice.active ? "bg-violet-600 text-white" : "bg-gradient-to-br from-violet-500 to-brand-600 text-white shadow-md hover:shadow-lg"}`}
          >
            {voice.active && <span className="pulse-ring absolute inset-0 rounded-2xl bg-violet-500" />}
            <Icon name="mic" className="relative h-[18px] w-[18px]" />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={placeholder}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[14.5px] outline-none placeholder:text-slate-400"
          />
          <button onClick={submit} disabled={busy || !text.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-900 text-white transition hover:bg-slate-700 disabled:bg-slate-100 disabled:text-slate-300" aria-label="Send">
            <Icon name="send" className="h-[18px] w-[18px]" />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-400">Every figure is computed from your live account data and bank policy · actions always need your confirmation</p>
      </div>
    </div>
  );
}
