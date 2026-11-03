import type { Content, FunctionCall, Part } from "@google/genai";
import type { AgentEvent, TurnTimings } from "@/platform/agent/events";
import { actionStore } from "@/platform/actions/store";
import { buildSystemInstruction, type TranscriptLine } from "@/platform/agent/prompt";
import { adaptThinking, availableModels, classifyLlmError, gemini, markCooldown, thinkingFor } from "@/platform/llm/gemini";
import { metrics } from "@/platform/observability/metrics";
import type { ToolRegistry } from "@/platform/tools/registry";
import type { ToolContext } from "@/platform/tools/types";
import type { CustomerContext, WorkflowManifest } from "@/platform/workflows/types";
import { today } from "@/lib/dates";

/**
 * Agent Runtime (text channel). A bounded plan → act → observe loop:
 * the model plans tool calls, the platform executes them IN PARALLEL through
 * the registry, results are fed back, and the final answer streams to the UI.
 */

const MAX_STEPS = 6;

export function findCitations(text: string): string[] {
  return [...new Set(text.match(/POL-[A-Z]+-\d+/g) ?? [])];
}

/**
 * When failing over to a different model mid-turn, earlier thought signatures
 * belong to the old model. Drop thought parts and mark function calls with the
 * documented validator-skip signature so the new model accepts the history.
 */
function detachSignatures(contents: Content[]) {
  for (const c of contents) {
    c.parts = (c.parts ?? []).filter((p) => !p.thought);
    for (const p of c.parts) {
      if (p.functionCall) p.thoughtSignature = "skip_thought_signature_validator";
      else delete p.thoughtSignature;
    }
  }
}

export async function runTextTurn(opts: {
  workflow: WorkflowManifest;
  registry: ToolRegistry;
  history: TranscriptLine[];
  ctx: ToolContext;
  emit: (e: AgentEvent) => void;
  loadContext: () => Promise<CustomerContext>;
  signal?: AbortSignal;
}): Promise<TurnTimings> {
  const { workflow, registry, history, ctx, emit, signal } = opts;
  const t0 = performance.now();
  let ttft: number | null = null;
  let answerText = "";
  const citedSources = new Set<string>();
  let llmMs = 0;
  let toolMs = 0;
  let steps = 0;

  emit({ type: "turn_start", turnId: ctx.turnId });

  const tc = performance.now();
  const context = await opts.loadContext();
  const contextMs = Math.round(performance.now() - tc);

  const pendingActions = (await actionStore.pendingFor(ctx.sessionId, workflow.id)).map((a) => ({ actionId: a.id, title: a.title, summary: a.summary }));
  const systemInstruction = buildSystemInstruction({ workflow, context, channel: "text", today: today(), pendingActions });
  const functionDeclarations = registry.declarations(workflow.tools);
  const contents: Content[] = history.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] }));

  let model = availableModels()[0];

  /** Opens a stream on the turn's pinned model, failing over on rate limits / overload. */
  const openStream = async () => {
    const tried = new Set<string>();
    let lastError: unknown;
    for (;;) {
      const candidate = availableModels(model).find((m) => !tried.has(m));
      if (!candidate) throw lastError;
      tried.add(candidate);
      try {
        const stream = await gemini().models.generateContentStream({
          model: candidate,
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations }],
            temperature: 0.2,
            thinkingConfig: thinkingFor(candidate),
            abortSignal: signal,
          },
        });
        if (candidate !== model) {
          if (steps > 1) detachSignatures(contents);
          model = candidate;
        }
        return stream;
      } catch (err) {
        if (adaptThinking(candidate, err)) {
          tried.delete(candidate);
          continue;
        }
        const { failover, cooldownMs } = classifyLlmError(err);
        if (!failover) throw err;
        markCooldown(candidate, cooldownMs);
        lastError = err;
      }
    }
  };

  for (steps = 1; steps <= MAX_STEPS; steps++) {
    const ts = performance.now();
    const stream = await openStream();

    const modelParts: Part[] = [];
    const calls: FunctionCall[] = [];
    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        modelParts.push(part);
        if (part.functionCall) calls.push(part.functionCall);
        else if (part.text && !part.thought) {
          if (ttft === null) ttft = Math.round(performance.now() - t0);
          answerText += part.text;
          emit({ type: "text", delta: part.text });
        }
      }
    }
    llmMs += performance.now() - ts;
    contents.push({ role: "model", parts: modelParts });
    if (calls.length === 0) break;

    // Execute all tool calls from this step concurrently.
    const tt = performance.now();
    const executions = await Promise.all(
      calls.map(async (call, i) => {
        const callId = call.id ?? `${ctx.turnId}-${steps}-${i}`;
        const args = (call.args ?? {}) as Record<string, unknown>;
        emit({ type: "tool_call", call: { callId, name: call.name!, args } });
        const ex = await registry.execute(call.name!, args, ctx, workflow.tools);
        for (const s of ex.sources) citedSources.add(s.ref);
        emit({
          type: "tool_result",
          result: { callId, name: ex.name, ok: ex.ok, latencyMs: ex.latencyMs, spans: ex.spans, sources: ex.sources, error: ex.error, action: ex.action, view: ex.view },
        });
        return { call, ex };
      }),
    );
    toolMs += performance.now() - tt;

    contents.push({
      role: "user",
      parts: executions.map(({ call, ex }) => ({
        functionResponse: { id: call.id, name: call.name, response: ex.result },
      })),
    });
  }

  const timings: TurnTimings = {
    ttftMs: ttft,
    totalMs: Math.round(performance.now() - t0),
    contextMs,
    llmMs: Math.round(llmMs),
    toolMs: Math.round(toolMs),
    steps: Math.min(steps, MAX_STEPS),
    model,
  };
  // Citation guard: every [POL-…] the model cites must come from a tool result this turn or earlier context.
  const unverified = findCitations(answerText).filter((id) => !citedSources.has(id) && !JSON.stringify(history).includes(id));
  if (unverified.length) {
    metrics.increment("guard.unverified_citations", unverified.length);
    console.warn(JSON.stringify({ type: "guard", event: "unverified_citation", ids: unverified, turnId: ctx.turnId }));
  }
  if (ttft !== null) metrics.observe("chat.ttft_ms", ttft);
  metrics.observe("chat.turn_ms", timings.totalMs);
  metrics.observe("chat.llm_ms", timings.llmMs);
  metrics.observe("chat.context_ms", contextMs);
  emit({ type: "done", timings });
  return timings;
}
