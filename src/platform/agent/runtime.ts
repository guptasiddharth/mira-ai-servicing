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
/** A model that hasn't produced its first chunk by now is treated as stalled and failed over. */
const FIRST_CHUNK_TIMEOUT_MS = Number(process.env.LLM_FIRST_CHUNK_TIMEOUT_MS) || 9_000;
/** Stop trying further models once the turn has used this much time (function limit is 60 s). */
const TURN_BUDGET_MS = 45_000;

class LlmStallError extends Error {
  constructor(model: string) {
    super(`${model} produced no output within ${FIRST_CHUNK_TIMEOUT_MS} ms`);
  }
}

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
      if (!candidate || (lastError && performance.now() - t0 > TURN_BUDGET_MS)) throw lastError ?? new Error("No model available");
      tried.add(candidate);
      if (candidate !== model && steps > 1) detachSignatures(contents);
      // Per-attempt abort: fires on client disconnect OR when the model stalls before its first chunk.
      const attempt = new AbortController();
      const abortSignal = signal ? AbortSignal.any([signal, attempt.signal]) : attempt.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stall = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          attempt.abort();
          reject(new LlmStallError(candidate));
        }, FIRST_CHUNK_TIMEOUT_MS);
      });
      try {
        const work = (async () => {
            const stream = await gemini().models.generateContentStream({
              model: candidate,
              contents,
              config: {
                systemInstruction,
                tools: [{ functionDeclarations }],
                temperature: 0.2,
                thinkingConfig: thinkingFor(candidate),
                abortSignal,
              },
            });
            const it = stream[Symbol.asyncIterator]();
            return { it, head: await it.next() };
          })();
        work.catch(() => {}); // a loser of the race must not surface as an unhandled rejection
        const first = await Promise.race([work, stall]);
        clearTimeout(timer);
        model = candidate;
        return (async function* () {
          if (!first.head.done) yield first.head.value;
          for (;;) {
            const next = await first.it.next();
            if (next.done) return;
            yield next.value;
          }
        })();
      } catch (err) {
        clearTimeout(timer);
        if (signal?.aborted) throw err;
        if (err instanceof LlmStallError) {
          metrics.increment("llm.stall_failover");
          console.warn(JSON.stringify({ type: "llm", event: "stall_failover", model: candidate }));
          markCooldown(candidate, 60_000);
          lastError = err;
          continue;
        }
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
