import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from "@google/genai";
import { metrics } from "@/platform/observability/metrics";

/**
 * Model configuration and routing in one place. Swapping providers means
 * replacing this module and the runtime's stream loop — tools, workflows and
 * UI are untouched.
 */

const textModels = (process.env.GEMINI_TEXT_MODELS || process.env.GEMINI_TEXT_MODEL || "gemini-3.6-flash,gemini-3.5-flash,gemini-3-flash-preview,gemini-flash-latest,gemini-2.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const llmConfig = {
  /** Ordered preference list; the router fails over on rate limits / overload. */
  textModels,
  textModel: textModels[0],
  liveModel: process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live",
  liveVoice: process.env.GEMINI_LIVE_VOICE || "Kore",
  liveApiVersion: process.env.GEMINI_LIVE_API_VERSION || "v1alpha",
  asyncVoiceTools: process.env.VOICE_ASYNC_TOOLS !== "false",
  /** Minimal thinking keeps time-to-first-token small; correctness comes from tools, not reasoning depth. */
  thinkingLevel: (process.env.GEMINI_THINKING_LEVEL?.toUpperCase() as ThinkingLevel) || ThinkingLevel.MINIMAL,
};

const minimalUnsupported = new Set<string>();

/** Gemini 3.x uses thinking levels; 2.5 models use a token budget (0 = off). Some models reject MINIMAL. */
export function thinkingFor(model: string): ThinkingConfig {
  if (model.startsWith("gemini-2.5")) return { thinkingBudget: 0 };
  return { thinkingLevel: minimalUnsupported.has(model) && llmConfig.thinkingLevel === ThinkingLevel.MINIMAL ? ThinkingLevel.LOW : llmConfig.thinkingLevel };
}

/** Returns true if the error was "thinking level not supported" — caller should retry the same model. */
export function adaptThinking(model: string, err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  if (msg.includes("Thinking level") && msg.includes("not supported") && !minimalUnsupported.has(model)) {
    minimalUnsupported.add(model);
    return true;
  }
  return false;
}

let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set — copy .env.example to .env.local");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

// ───────────────────────────── Model router ─────────────────────────────

const g = globalThis as unknown as { __kestrelModelCooldown?: Map<string, number> };
const cooldownUntil: Map<string, number> = (g.__kestrelModelCooldown ??= new Map());

/** Models in preference order, skipping any that are cooling down after a rate limit. */
export function availableModels(preferred?: string): string[] {
  const now = Date.now();
  const ordered = preferred ? [preferred, ...textModels.filter((m) => m !== preferred)] : textModels;
  const ready = ordered.filter((m) => (cooldownUntil.get(m) ?? 0) <= now);
  // If everything is cooling down, try the one that frees up soonest rather than failing outright.
  return ready.length ? ready : [...ordered].sort((a, b) => (cooldownUntil.get(a) ?? 0) - (cooldownUntil.get(b) ?? 0)).slice(0, 1);
}

/** Classifies provider errors: rate limits/overload are failover-able, others are not. */
export function classifyLlmError(err: unknown): { failover: boolean; cooldownMs: number } {
  const msg = String((err as Error)?.message ?? err);
  const status = (err as { status?: number })?.status;
  if (status === 429 || msg.includes("RESOURCE_EXHAUSTED") || msg.includes('"code":429')) {
    const m = msg.match(/retryDelay\\?"?:\s*\\?"(\d+)s/);
    return { failover: true, cooldownMs: (m ? Number(m[1]) : 20) * 1000 };
  }
  if (status === 503 || status === 500 || msg.includes("UNAVAILABLE") || msg.includes("overloaded")) return { failover: true, cooldownMs: 10_000 };
  if (status === 404 || msg.includes("NOT_FOUND")) return { failover: true, cooldownMs: 10 * 60_000 };
  return { failover: false, cooldownMs: 0 };
}

export function markCooldown(model: string, ms: number) {
  cooldownUntil.set(model, Date.now() + ms);
  metrics.increment(`llm.failover.${model}`);
}
