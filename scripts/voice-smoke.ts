/**
 * Verifies the Gemini Live path end-to-end without a browser:
 * ephemeral token (locked config) → connect → text turn → tool call → tool response → audio.
 */
import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";
import { registry } from "@/capabilities/registry";
import { buildSystemInstruction } from "@/platform/agent/prompt";
import { llmConfig } from "@/platform/llm/gemini";
import { loanServicing } from "@/workflows/loan-servicing";
import { setChaosMode } from "@/enterprise/simulator";
import { today } from "@/lib/dates";

await setChaosMode("no_faults");
const ctx = { customerId: "CUST-1001", sessionId: "s", workflowId: loanServicing.id, channel: "voice" as const, turnId: "t1" };
const context = await loanServicing.loadContext(ctx);
const config = {
  responseModalities: [Modality.AUDIO],
  systemInstruction: buildSystemInstruction({ workflow: loanServicing, context, channel: "voice", today: today() }),
  tools: [{ functionDeclarations: registry.declarations(loanServicing.tools, { asyncSlowTools: llmConfig.asyncVoiceTools }) }],
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: llmConfig.liveVoice } } },
  inputAudioTranscription: {},
  outputAudioTranscription: {},
};
const server = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const now = Date.now();
const t0 = performance.now();
const token = await server.authTokens.create({
  config: { uses: 1, expireTime: new Date(now + 600_000).toISOString(), newSessionExpireTime: new Date(now + 60_000).toISOString(), liveConnectConstraints: { model: llmConfig.liveModel, config }, httpOptions: { apiVersion: llmConfig.liveApiVersion } },
});
console.log("token", token.name?.slice(0, 20), Math.round(performance.now() - t0), "ms");

const client = new GoogleGenAI({ apiKey: token.name!, httpOptions: { apiVersion: llmConfig.liveApiVersion } });
let audioBytes = 0;
let firstAudio = 0;
let sent = 0;
let transcript = "";
const done = new Promise<void>((resolve) => setTimeout(resolve, 25000));
const session = await client.live.connect({
  model: llmConfig.liveModel,
  config: { responseModalities: [Modality.AUDIO] },
  callbacks: {
    onmessage: async (m: LiveServerMessage) => {
      if (m.setupComplete) console.log("setupComplete");
      const parts = m.serverContent?.modelTurn?.parts ?? [];
      for (const p of parts) if (p.inlineData?.data) { audioBytes += p.inlineData.data.length; if (!firstAudio) { firstAudio = performance.now() - sent; console.log("first audio after", Math.round(firstAudio), "ms", p.inlineData.mimeType); } }
      if (m.serverContent?.outputTranscription?.text) transcript += m.serverContent.outputTranscription.text;
      if (m.serverContent?.turnComplete) { console.log("turnComplete; transcript:", transcript); }
      if (m.toolCall) {
        for (const fc of m.toolCall.functionCalls ?? []) {
          console.log("toolCall", fc.name, JSON.stringify(fc.args), fc.id);
          const ex = await registry.execute(fc.name!, fc.args, ctx, loanServicing.tools);
          session.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: ex.result }] });
          console.log("sent tool response", ex.ok, ex.latencyMs, "ms");
        }
      }
      if (m.toolCallCancellation) console.log("cancelled", m.toolCallCancellation.ids);
    },
    onerror: (e) => console.log("error", e.message),
    onclose: (e) => console.log("close", e.code, e.reason),
  },
});
sent = performance.now();
session.sendClientContent({ turns: [{ role: "user", parts: [{ text: "If I prepay twenty thousand rupees, how much would my tenure reduce?" }] }], turnComplete: true });
await done;
console.log("audio b64 bytes", audioBytes);
session.close();
process.exit(0);
