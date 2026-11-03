"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/components/chat/model";
import { Icon } from "@/components/ui/Icon";
import { Orb, type OrbState } from "@/components/ui/Orb";
import type { VoiceStatus } from "@/components/voice/useVoiceSession";

const LABEL: Record<VoiceStatus, string> = {
  idle: "",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Working on it",
  speaking: "Speaking",
  error: "Voice unavailable",
};

const RUNNING_LABEL: Record<string, string> = {
  get_payment_history: "Checking Payments",
  simulate_prepayment: "Running the prepayment calculator",
  check_foreclosure: "Evaluating foreclosure rules",
  explain_emi_change: "Comparing your EMI history",
  get_loan_details: "Fetching your loan",
  get_card_transactions: "Scanning card transactions",
  search_policy: "Looking up policy",
};

/**
 * Live call surface: an audio-reactive orb (mic level while you speak, the
 * assistant's own output level while it talks), live captions, what it's
 * checking right now, and measured response latency.
 */
export function VoiceStage({
  status,
  micLevel,
  getOutputLevel,
  messages,
  lastLatency,
  error,
  onEnd,
  agentName,
}: {
  agentName: string;
  status: VoiceStatus;
  micLevel: number;
  getOutputLevel: () => number;
  messages: ChatMessage[];
  lastLatency: number | null;
  error: string | null;
  onEnd: () => void;
}) {
  const orb = useRef<HTMLDivElement>(null);
  const mic = useRef(micLevel);
  mic.current = micLevel;
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const s = statusRef.current;
      const raw = s === "speaking" ? getOutputLevel() * 3.2 : s === "listening" ? mic.current * 9 : 0;
      smooth += (Math.min(1, raw) - smooth) * 0.25;
      orb.current?.style.setProperty("--level", smooth.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getOutputLevel]);

  const last = [...messages].reverse().find((m) => m.channel === "voice" && m.text);
  const running = [...messages].reverse().find((m) => m.tools.some((t) => t.status === "running"))?.tools.find((t) => t.status === "running");
  const orbState: OrbState = status === "speaking" ? "speaking" : status === "thinking" || status === "connecting" ? "thinking" : status === "listening" ? "listening" : "idle";
  const caption = last ? (last.text.length > 160 ? "…" + last.text.slice(-160) : last.text) : "Ask me anything about your account — I'm listening.";

  return (
    <div className="stage-in relative mx-auto mt-3 w-full max-w-[52rem] px-4">
      <div className="relative flex items-center gap-5 overflow-hidden rounded-3xl border border-white/60 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-5 py-4 text-white shadow-[0_20px_50px_-20px_rgba(49,46,129,0.7)]">
        <div className="pointer-events-none absolute -left-10 -top-16 h-48 w-48 rounded-full bg-brand-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-10 h-48 w-48 rounded-full bg-violet-500/25 blur-3xl" />
        <Orb ref={orb} size={76} state={orbState} className="relative shrink-0" />
        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
            <span className={`h-1.5 w-1.5 rounded-full ${status === "error" ? "bg-rose-400" : "bg-emerald-400 live-dot"}`} />
            {agentName} · {error ?? LABEL[status]}
            {running && status !== "speaking" && <span className="normal-case tracking-normal text-brand-200">· {RUNNING_LABEL[running.name] ?? "Checking your account"}…</span>}
          </div>
          <p className={`mt-1.5 line-clamp-2 text-[15.5px] leading-snug ${last?.role === "user" ? "text-white/70 italic" : "text-white"}`}>
            {last?.role === "user" && <span className="not-italic text-white/40">You: </span>}
            {caption}
          </p>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-white/45">
            <span>Interrupt any time</span>
            <span>·</span>
            <span>Same tools & data as chat</span>
            {lastLatency !== null && (
              <>
                <span>·</span>
                <span className="font-mono text-emerald-300/80">last reply {lastLatency}ms</span>
              </>
            )}
          </div>
        </div>
        <button onClick={onEnd} className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-rose-500 text-white shadow-lg transition hover:bg-rose-600" aria-label="End voice conversation">
          <Icon name="phoneOff" className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
