import type { PendingActionView } from "@/platform/actions/store";
import type { Span } from "@/platform/observability/trace";
import type { Source, ToolView } from "@/platform/tools/types";

/**
 * Wire protocol between the agent runtime and the UI (NDJSON over a streaming
 * response for text; produced client-side for voice). Both channels render
 * through the same event model, so the experience is identical.
 */

export interface ToolCallEvent {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultEvent {
  callId: string;
  name: string;
  ok: boolean;
  latencyMs: number;
  spans: Span[];
  sources: Source[];
  error?: { code: string; message: string };
  action?: PendingActionView;
  view?: ToolView;
  /** Set when a voice tool call was cancelled because the customer interrupted. */
  cancelled?: boolean;
}

export interface TurnTimings {
  /** Request received → first token of the answer streamed. */
  ttftMs: number | null;
  totalMs: number;
  contextMs: number;
  llmMs: number;
  toolMs: number;
  steps: number;
  model: string;
}

export type AgentEvent =
  | { type: "turn_start"; turnId: string }
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCallEvent }
  | { type: "tool_result"; result: ToolResultEvent }
  | { type: "done"; timings: TurnTimings }
  | { type: "error"; message: string };
