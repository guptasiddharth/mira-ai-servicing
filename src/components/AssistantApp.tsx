"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { chatReducer, newId, type ChatMessage } from "@/components/chat/model";
import { Logo } from "@/components/Logo";
import { OpsPanel } from "@/components/ops/OpsPanel";
import { AccountPanels } from "@/components/panels/AccountPanels";
import { Icon } from "@/components/ui/Icon";
import { useVoiceSession } from "@/components/voice/useVoiceSession";
import { VoiceStage } from "@/components/voice/VoiceStage";
import { readEvents, reportMetric } from "@/lib/client/stream";
import type { PendingActionView } from "@/platform/actions/store";
import type { Panel } from "@/platform/workflows/types";
import type { WorkflowSummary } from "@/workflows";

interface Props {
  customer: { id: string; name: string; firstName: string; city: string; segment: string; customerSince: string };
  workflows: WorkflowSummary[];
}

const WORKFLOW_ICON: Record<string, string> = { "loan-servicing": "loan", "card-servicing": "card" };

export function AssistantApp({ customer, workflows }: Props) {
  const [workflowId, setWorkflowId] = useState(workflows[0].id);
  const workflow = workflows.find((w) => w.id === workflowId) ?? workflows[0];
  const [state, dispatch] = useReducer(chatReducer, { messages: [], actions: {} }, (s) => chatReducer(s, { type: "reset", greeting: workflow.greeting }));
  const [busy, setBusy] = useState(false);
  const [panels, setPanels] = useState<Panel[] | null>(null);
  const [showOps, setShowOps] = useState(false);
  const messagesRef = useRef<ChatMessage[]>(state.messages);
  messagesRef.current = state.messages;
  const abortRef = useRef<AbortController | null>(null);

  const refreshPanels = useCallback(async () => {
    try {
      const res = await fetch(`/api/account?workflow=${workflowId}`, { cache: "no-store" });
      if (res.status === 401) return void (window.location.href = "/");
      setPanels(((await res.json()) as { panels: Panel[] }).panels);
    } catch {
      /* keep last good panels */
    }
  }, [workflowId]);

  useEffect(() => {
    setPanels(null);
    void refreshPanels();
  }, [refreshPanels]);

  const getTranscript = useCallback(() => messagesRef.current.filter((m) => m.id !== "greeting").map((m) => ({ role: m.role, text: m.text })), []);
  const voice = useVoiceSession({ workflowId, dispatch, getTranscript, onDataChanged: refreshPanels });

  const switchWorkflow = (id: string) => {
    if (id === workflowId) return;
    abortRef.current?.abort();
    setWorkflowId(id);
    const next = workflows.find((w) => w.id === id)!;
    dispatch({ type: "reset", greeting: next.greeting });
  };

  const sendText = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      if (voice.active && voice.sendText(text)) return;

      const userId = newId("u");
      const asstId = newId("a");
      const turnId = newId("t");
      dispatch({ type: "add", message: { id: userId, role: "user", channel: "text", text } });
      dispatch({ type: "add", message: { id: asstId, role: "assistant", channel: "text", pending: true } });
      setBusy(true);

      const history = [...messagesRef.current.filter((m) => m.id !== "greeting" && m.text.trim()).map((m) => ({ role: m.role, text: m.text })), { role: "user" as const, text }];
      const controller = new AbortController();
      abortRef.current = controller;
      const t0 = performance.now();
      let firstToken = true;
      let changedData = false;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workflowId, turnId, messages: history.slice(-24) }),
          signal: controller.signal,
        });
        if (res.status === 401) return void (window.location.href = "/");
        if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);

        for await (const e of readEvents(res)) {
          if (e.type === "text") {
            if (firstToken) {
              firstToken = false;
              const ttft = Math.round(performance.now() - t0);
              dispatch({ type: "patch", id: asstId, patch: { clientTtftMs: ttft } });
              reportMetric("chat.client_ttft_ms", ttft);
            }
            dispatch({ type: "append_text", id: asstId, delta: e.delta });
          } else if (e.type === "tool_call") dispatch({ type: "tool_call", id: asstId, call: e.call });
          else if (e.type === "tool_result") {
            dispatch({ type: "tool_result", id: asstId, result: e.result });
            if (e.result.action) changedData = true;
          } else if (e.type === "done") dispatch({ type: "patch", id: asstId, patch: { timings: e.timings } });
          else if (e.type === "error") dispatch({ type: "patch", id: asstId, patch: { error: e.message } });
        }
      } catch (err) {
        if (!controller.signal.aborted) dispatch({ type: "patch", id: asstId, patch: { error: err instanceof Error ? err.message : "Request failed" } });
      } finally {
        dispatch({ type: "patch", id: asstId, patch: { pending: false } });
        setBusy(false);
        if (changedData) void refreshPanels();
      }
    },
    [busy, refreshPanels, voice, workflowId],
  );

  const decideAction = useCallback(
    async (action: PendingActionView, decision: "confirm" | "cancel") => {
      dispatch({ type: "action", action: { ...action, status: decision === "confirm" ? "confirmed" : "cancelled", reference: decision === "confirm" ? "…" : undefined } });
      const res = await fetch(`/api/actions/${action.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, workflowId }) });
      const body = (await res.json()) as { action?: PendingActionView; error?: { message: string } };
      if (body.action) dispatch({ type: "action", action: body.action });
      else dispatch({ type: "action", action: { ...action, status: "failed", error: body.error?.message } });
      void refreshPanels();
      if (res.ok && decision === "confirm" && body.action?.reference && !voice.active) {
        dispatch({ type: "add", message: { id: newId("sys"), role: "assistant", channel: "text", text: `Done — your **${body.action.title.toLowerCase()}** is submitted. Reference **${body.action.reference}**.` } });
      }
    },
    [refreshPanels, voice.active, workflowId],
  );

  const started = state.messages.some((m) => m.id !== "greeting");

  return (
    <div className="app-bg flex h-dvh flex-col">
      <header className="relative z-10 flex items-center gap-3 border-b border-slate-200/70 bg-white/70 px-4 py-2.5 backdrop-blur-xl">
        <Logo />
        <nav className="ml-2 flex rounded-xl bg-slate-100/80 p-1 sm:ml-6">
          {workflows.map((w) => (
            <button
              key={w.id}
              onClick={() => switchWorkflow(w.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${w.id === workflowId ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              title={w.description}
            >
              <Icon name={WORKFLOW_ICON[w.id] ?? "sparkles"} className="h-3.5 w-3.5" />
              {w.shortName}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-100 md:inline-flex">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" /> 6 systems connected
          </span>
          <button
            onClick={() => setShowOps((v) => !v)}
            className={`hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition sm:inline-flex ${showOps ? "border-brand-200 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            <Icon name="activity" className="h-3.5 w-3.5" /> Ops & latency
          </button>
          <form action="/api/auth/logout" method="post">
            <button className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900">Sign out</button>
          </form>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-r border-slate-200/70 bg-white/40 p-4 backdrop-blur lg:block">
          <AccountPanels customer={customer} panels={panels} onRefresh={refreshPanels} />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {(voice.active || voice.status === "connecting") && (
            <VoiceStage agentName={workflow.agent.name} status={voice.status} micLevel={voice.level} getOutputLevel={voice.getOutputLevel} messages={state.messages} lastLatency={voice.lastLatency} error={voice.error} onEnd={voice.stop} />
          )}
          <MessageList
            messages={state.messages}
            actions={state.actions}
            onDecide={decideAction}
            agent={workflow.agent}
            welcome={{ firstName: customer.firstName, workflowName: workflow.name, starters: workflow.starters, panels, onPick: sendText, onVoice: voice.start }}
          />
          <Composer
            suggestions={started ? workflow.starters : []}
            busy={busy}
            onSend={sendText}
            voice={voice}
            placeholder={voice.active ? "Speak — or type to the voice assistant…" : `Ask about your ${workflow.shortName.toLowerCase()}…`}
          />
        </main>

        {showOps && (
          <aside className="hidden w-[380px] shrink-0 overflow-y-auto border-l border-slate-200/70 bg-white/80 p-4 backdrop-blur md:block">
            <OpsPanel messages={state.messages} />
          </aside>
        )}
      </div>
    </div>
  );
}
