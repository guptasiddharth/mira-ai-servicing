import { Modality, type LiveConnectConfig } from "@google/genai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { registry } from "@/capabilities/registry";
import { today } from "@/lib/dates";
import { actionStore } from "@/platform/actions/store";
import { buildSystemInstruction } from "@/platform/agent/prompt";
import { gemini, llmConfig } from "@/platform/llm/gemini";
import { metrics } from "@/platform/observability/metrics";
import { handle, HttpError, rateLimit, requireSession, toolContext } from "@/server/http";
import { getWorkflow } from "@/workflows";

const Body = z.object({
  workflowId: z.string(),
  transcript: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(40).default([]),
});

/**
 * Mints a short-lived, single-use Gemini Live token whose model, system
 * instruction and tool set are LOCKED server-side. The browser streams audio
 * directly to Gemini (lowest latency) but can't change the prompt or tools,
 * and never sees the API key. Tool calls are executed via /api/tools.
 */
export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  rateLimit(`voice:${session.sid}`, 10);
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const workflow = getWorkflow(parsed.data.workflowId);
  const ctx = toolContext(session, workflow.id, "voice", "voice-setup");

  const t0 = performance.now();
  const context = await workflow.loadContext(ctx);
  const pendingActions = (await actionStore.pendingFor(session.sid, workflow.id)).map((a) => ({ actionId: a.id, title: a.title, summary: a.summary }));
  const systemInstruction = buildSystemInstruction({ workflow, context, channel: "voice", today: today(), recentTranscript: parsed.data.transcript.slice(-12), pendingActions });

  const config: LiveConnectConfig = {
    responseModalities: [Modality.AUDIO],
    systemInstruction,
    tools: [{ functionDeclarations: registry.declarations(workflow.tools, { asyncSlowTools: llmConfig.asyncVoiceTools }) }],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: llmConfig.liveVoice } } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
  };

  const now = Date.now();
  const token = await gemini().authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      liveConnectConstraints: { model: llmConfig.liveModel, config },
      httpOptions: { apiVersion: llmConfig.liveApiVersion },
    },
  });
  metrics.observe("voice.session_setup_ms", Math.round(performance.now() - t0));

  return NextResponse.json({
    token: token.name,
    model: llmConfig.liveModel,
    apiVersion: llmConfig.liveApiVersion,
    asyncTools: (config.tools?.[0] as { functionDeclarations: { name?: string; behavior?: string }[] }).functionDeclarations.filter((d) => d.behavior).map((d) => d.name),
  });
});
