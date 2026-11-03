"use client";

import { FunctionResponseScheduling, GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { newId, type ChatAction, type ChatMessage } from "@/components/chat/model";
import { MicRecorder, PcmPlayer } from "@/components/voice/audio";
import { reportMetric } from "@/lib/client/stream";
import type { ToolResultEvent } from "@/platform/agent/events";

/**
 * Live voice channel. Audio streams browser ⇄ Gemini Live directly (lowest
 * latency); tool calls are relayed to /api/tools so they hit the same
 * registry, authorisation and gateway as text. Transcripts land in the same
 * conversation model, so the customer can switch between voice and text freely.
 */

export type VoiceStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

const SPEECH_RMS = 0.025;

export function useVoiceSession(opts: {
  workflowId: string;
  dispatch: Dispatch<ChatAction>;
  getTranscript: () => Pick<ChatMessage, "role" | "text">[];
  onDataChanged: () => void;
}) {
  const { workflowId, dispatch, getTranscript, onDataChanged } = opts;
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastLatency, setLastLatency] = useState<number | null>(null);

  const r = useRef({
    session: null as Session | null,
    mic: null as MicRecorder | null,
    player: null as PcmPlayer | null,
    userMsgId: null as string | null,
    assistantMsgId: null as string | null,
    /** Message holding tool chips from the model's last turn; the spoken answer that follows joins it. */
    toolMsgId: null as string | null,
    /** The spoken answer after a tool call continues the acknowledgement — needs a separating space. */
    joinSpace: false,
    turn: 0,
    lastVoiceAt: 0,
    awaitingFirstAudio: false,
    asyncTools: new Set<string>(),
    inflight: new Map<string, AbortController>(),
    active: false,
  });

  const ensureAssistant = useCallback(() => {
    const s = r.current;
    if (!s.assistantMsgId && s.toolMsgId) {
      s.assistantMsgId = s.toolMsgId;
      s.joinSpace = true;
      dispatch({ type: "patch", id: s.assistantMsgId, patch: { pending: true } });
    }
    if (!s.assistantMsgId) {
      s.assistantMsgId = newId("va");
      dispatch({ type: "add", message: { id: s.assistantMsgId, role: "assistant", channel: "voice", pending: true } });
    }
    return s.assistantMsgId;
  }, [dispatch]);

  const runTool = useCallback(
    async (fc: { id?: string; name?: string; args?: Record<string, unknown> }) => {
      const s = r.current;
      const msgId = ensureAssistant();
      s.toolMsgId = msgId;
      const callId = fc.id ?? newId("call");
      const name = fc.name ?? "unknown";
      dispatch({ type: "tool_call", id: msgId, call: { callId, name, args: fc.args ?? {} } });
      setStatus("thinking");
      const controller = new AbortController();
      s.inflight.set(callId, controller);
      try {
        const res = await fetch("/api/tools", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workflowId, turnId: `v${s.turn}`, callId, name, args: fc.args ?? {} }),
          signal: controller.signal,
        });
        const body = (await res.json()) as { response: Record<string, unknown>; event: ToolResultEvent };
        if (!res.ok) throw new Error((body as unknown as { error: string }).error);
        dispatch({ type: "tool_result", id: msgId, result: body.event });
        if (body.event.action) onDataChanged();
        s.session?.sendToolResponse({
          functionResponses: [
            {
              id: fc.id,
              name,
              response: body.response,
              ...(s.asyncTools.has(name) ? { scheduling: FunctionResponseScheduling.WHEN_IDLE } : {}),
            },
          ],
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        dispatch({ type: "tool_result", id: msgId, result: { callId, name, ok: false, latencyMs: 0, spans: [], sources: [], error: { code: "CLIENT", message: String(e) } } });
        s.session?.sendToolResponse({ functionResponses: [{ id: fc.id, name, response: { error: "Tool execution failed. Apologise and offer a ticket." } }] });
      } finally {
        s.inflight.delete(callId);
      }
    },
    [dispatch, ensureAssistant, onDataChanged, workflowId],
  );

  const onMessage = useCallback(
    (m: LiveServerMessage) => {
      const s = r.current;
      const sc = m.serverContent;

      if (sc?.inputTranscription?.text) {
        if (!s.userMsgId) {
          s.turn += 1;
          s.toolMsgId = null;
          s.userMsgId = newId("vu");
          // If the model already started answering this turn, keep the transcript in order.
          dispatch({ type: "add", message: { id: s.userMsgId, role: "user", channel: "voice" }, beforeId: s.assistantMsgId ?? undefined });
        }
        dispatch({ type: "append_text", id: s.userMsgId, delta: sc.inputTranscription.text });
      }

      if (sc?.interrupted) {
        s.player?.flush();
        if (s.assistantMsgId) dispatch({ type: "patch", id: s.assistantMsgId, patch: { interrupted: true, pending: false } });
        s.assistantMsgId = null;
        s.userMsgId = null;
        reportMetric("voice.interruptions", 1);
        setStatus("listening");
      }

      for (const part of sc?.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          const id = ensureAssistant();
          if (s.awaitingFirstAudio && s.lastVoiceAt) {
            const latency = performance.now() - s.lastVoiceAt;
            if (latency > 50 && latency < 20_000) {
              setLastLatency(Math.round(latency));
              dispatch({ type: "patch", id, patch: { voiceLatencyMs: Math.round(latency) } });
              reportMetric("voice.response_ms", latency);
            }
            s.awaitingFirstAudio = false;
          }
          s.player?.enqueue(part.inlineData.data);
          setStatus("speaking");
        }
      }

      if (sc?.outputTranscription?.text) {
        const id = ensureAssistant();
        const s2 = r.current;
        dispatch({ type: "append_text", id, delta: (s2.joinSpace ? " " : "") + sc.outputTranscription.text });
        s2.joinSpace = false;
      }

      if (sc?.turnComplete) {
        if (s.assistantMsgId) dispatch({ type: "patch", id: s.assistantMsgId, patch: { pending: false } });
        s.assistantMsgId = null;
        s.userMsgId = null;
        setTimeout(() => {
          if (r.current.active && !r.current.player?.playing) setStatus("listening");
        }, 300);
      }

      if (m.toolCall?.functionCalls) for (const fc of m.toolCall.functionCalls) void runTool(fc);

      if (m.toolCallCancellation?.ids) {
        for (const id of m.toolCallCancellation.ids) s.inflight.get(id)?.abort();
        dispatch({ type: "tool_cancelled", callIds: m.toolCallCancellation.ids });
      }

      if (m.goAway) setError("Voice session is about to time out — tap the mic to reconnect.");
    },
    [dispatch, ensureAssistant, runTool],
  );

  const stop = useCallback(() => {
    const s = r.current;
    s.active = false;
    s.mic?.stop();
    s.player?.close();
    s.session?.close();
    for (const c of s.inflight.values()) c.abort();
    s.inflight.clear();
    if (s.assistantMsgId) dispatch({ type: "patch", id: s.assistantMsgId, patch: { pending: false } });
    Object.assign(s, { session: null, mic: null, player: null, userMsgId: null, assistantMsgId: null });
    setStatus("idle");
    setLevel(0);
  }, [dispatch]);

  const start = useCallback(async () => {
    const s = r.current;
    if (s.active) return;
    setError(null);
    setStatus("connecting");
    try {
      s.player = new PcmPlayer();
      await s.player.resume();

      const transcript = getTranscript()
        .filter((m) => m.text.trim())
        .slice(-12);
      const res = await fetch("/api/voice/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workflowId, transcript }) });
      const cfg = (await res.json()) as { token: string; model: string; apiVersion: string; asyncTools: string[]; error?: string };
      if (!res.ok) throw new Error(cfg.error ?? "Could not start voice session");
      s.asyncTools = new Set(cfg.asyncTools);

      const ai = new GoogleGenAI({ apiKey: cfg.token, httpOptions: { apiVersion: cfg.apiVersion } });
      s.session = await ai.live.connect({
        model: cfg.model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onmessage: onMessage,
          onerror: (e) => {
            setError(e.message || "Voice connection error");
            setStatus("error");
          },
          onclose: () => {
            if (r.current.active) stop();
          },
        },
      });
      s.active = true;

      s.mic = new MicRecorder();
      await s.mic.start((pcm, rms) => {
        const st = r.current;
        if (!st.active || !st.session) return;
        st.session.sendRealtimeInput({ audio: { data: pcm, mimeType: "audio/pcm;rate=16000" } });
        setLevel(rms);
        if (rms > SPEECH_RMS && !st.player?.playing) {
          st.lastVoiceAt = performance.now();
          st.awaitingFirstAudio = true;
        }
      });
      setStatus("listening");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      stop();
      setStatus("error");
    }
  }, [getTranscript, onMessage, stop, workflowId]);

  /** Typed input while a call is live goes into the same voice session. */
  const sendText = useCallback(
    (text: string) => {
      const s = r.current;
      if (!s.session) return false;
      s.player?.flush();
      s.turn += 1;
      s.assistantMsgId = null;
      s.userMsgId = null;
      s.toolMsgId = null;
      dispatch({ type: "add", message: { id: newId("vu"), role: "user", channel: "voice", text } });
      s.lastVoiceAt = performance.now();
      s.awaitingFirstAudio = true;
      s.session.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
      setStatus("thinking");
      return true;
    },
    [dispatch],
  );

  const getOutputLevel = useCallback(() => r.current.player?.level() ?? 0, []);

  useEffect(() => () => stop(), [stop]);
  // A workflow switch ends the call (new prompt + tools).
  useEffect(() => {
    if (r.current.active) stop();
  }, [workflowId, stop]);

  return { status, level, error, lastLatency, active: status !== "idle" && status !== "error", start, stop, sendText, getOutputLevel };
}
