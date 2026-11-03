"use client";

import { useEffect, useRef } from "react";
import { ActionCard } from "@/components/chat/ActionCard";
import { AgentTrail } from "@/components/chat/AgentTrail";
import { Citations } from "@/components/chat/Citations";
import { Markdown } from "@/components/chat/Markdown";
import type { ChatMessage } from "@/components/chat/model";
import { Welcome } from "@/components/chat/Welcome";
import { Icon } from "@/components/ui/Icon";
import { Orb } from "@/components/ui/Orb";
import { ViewRenderer } from "@/components/views/ViewRenderer";
import type { PendingActionView } from "@/platform/actions/store";
import type { Source } from "@/platform/tools/types";
import type { Panel } from "@/platform/workflows/types";

export function MessageList({
  messages,
  actions,
  onDecide,
  agent,
  welcome,
}: {
  messages: ChatMessage[];
  actions: Record<string, PendingActionView>;
  onDecide: (a: PendingActionView, d: "confirm" | "cancel") => void;
  agent: { name: string; title: string };
  welcome: { firstName: string; workflowName: string; starters: { label: string; prompt: string; description?: string; icon?: string }[]; panels: Panel[] | null; onPick: (prompt: string) => void; onVoice: () => void };
}) {
  const end = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  const conversation = messages.filter((m) => m.id !== "greeting");
  // Citations are verified against everything any tool returned in this conversation.
  const knownSources = messages.flatMap((m) => m.sources);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, last?.text, last?.tools.length, last?.tools.filter((t) => t.status !== "running").length]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[52rem] flex-col gap-6 px-4 py-6">
        {conversation.length === 0 ? (
          <Welcome {...welcome} agent={agent} />
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <UserBubble key={m.id} m={m} />
            ) : (
              <AssistantMessage key={m.id} m={m} agent={agent} knownSources={knownSources} actions={m.actionIds.map((id) => actions[id]).filter(Boolean)} onDecide={onDecide} />
            ),
          )
        )}
        <div ref={end} />
      </div>
    </div>
  );
}

function UserBubble({ m }: { m: ChatMessage }) {
  return (
    <div className="msg-in flex flex-col items-end gap-1">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-br from-brand-600 to-indigo-600 px-4 py-2.5 text-[14.5px] leading-relaxed text-white shadow-[0_6px_20px_-8px_rgba(47,111,237,0.6)]">
        {m.channel === "voice" && <Icon name="mic" className="-mt-0.5 mr-1.5 inline h-3.5 w-3.5 opacity-70" />}
        {m.text || <span className="opacity-70">…</span>}
      </div>
    </div>
  );
}

function AssistantMessage({ m, agent, knownSources, actions, onDecide }: { m: ChatMessage; agent: { name: string; title: string }; knownSources: Source[]; actions: PendingActionView[]; onDecide: (a: PendingActionView, d: "confirm" | "cancel") => void }) {
  const views = m.tools.filter((t) => t.status === "ok" && t.result?.view).map((t) => ({ id: t.callId, view: t.result!.view! }));
  const working = m.pending && !m.text;
  const fromContext = !m.pending && m.tools.length === 0 && m.id !== "greeting" && !m.error && !!m.text && (m.timings || m.voiceLatencyMs !== undefined);

  return (
    <div className="msg-in flex gap-3">
      <div className="pt-0.5">
        <Orb size={30} state={m.pending ? "thinking" : "idle"} />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="font-semibold text-slate-700">{agent.name}</span>
          <span className="rounded-full bg-gradient-to-r from-brand-50 to-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-brand-100">{agent.title}</span>
          {m.channel === "voice" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
              <Icon name="mic" className="h-2.5 w-2.5" /> spoken
            </span>
          )}
          {fromContext && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400" title="Answered from your account snapshot loaded at sign-in — no backend call needed">
              <Icon name="bolt" className="h-3 w-3 text-amber-500" /> instant · from your account snapshot
            </span>
          )}
        </div>

        {(m.tools.length > 0 || working) && <AgentTrail tools={m.tools} pending={m.pending} hasText={!!m.text} timings={m.timings} sources={m.sources} />}

        {m.text && (
          <div className={`text-[14.5px] leading-relaxed text-slate-800 ${m.channel === "voice" ? "rounded-2xl rounded-tl-md bg-white/80 px-4 py-3 ring-1 ring-slate-200/70" : ""}`}>
            <div className="prose-chat">
              <Markdown text={m.text} sources={knownSources} />
            </div>
            {m.pending && m.channel === "text" && <span className="caret" />}
            {m.interrupted && (
              <div className="mt-1 inline-flex items-center gap-1 text-[11px] italic text-slate-400">
                <Icon name="activity" className="h-3 w-3" /> you interrupted — switched to your new request
              </div>
            )}
          </div>
        )}

        {m.error && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            <Icon name="alert" className="h-4 w-4" /> {m.error}
          </div>
        )}

        {views.length > 0 && (
          <div className="space-y-3">
            {views.map((v) => (
              <ViewRenderer key={v.id} view={v.view} />
            ))}
          </div>
        )}

        {actions.map((a) => (
          <ActionCard key={a.id} action={a} onDecide={onDecide} />
        ))}

        {(m.sources.length > 0 || m.timings || m.voiceLatencyMs !== undefined) && !m.pending && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Citations sources={m.sources} />
            <span className="ml-auto font-mono text-[10.5px] text-slate-400">
              {m.timings && `first token ${m.clientTtftMs ?? m.timings.ttftMs}ms`}
              {m.voiceLatencyMs !== undefined && `responded in ${m.voiceLatencyMs}ms`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
