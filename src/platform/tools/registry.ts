import { Behavior, type FunctionDeclaration } from "@google/genai";
import { z } from "zod";
import { actionStore, toView, type PendingActionView } from "@/platform/actions/store";
import { kv } from "@/platform/state/kv";
import { AccessDeniedError, BusinessRuleError, NotFoundError } from "@/platform/errors";
import { GatewayError } from "@/platform/integrations/gateway";
import { audit } from "@/platform/observability/audit";
import { metrics } from "@/platform/observability/metrics";
import { withTrace, type Span } from "@/platform/observability/trace";
import { zodToGeminiSchema } from "@/platform/tools/schema";
import type { Source, ToolContext, ToolDefinition, ToolView } from "@/platform/tools/types";

/**
 * Tool Registry & Executor — the platform's execution layer.
 *
 * Every tool call from any workflow or channel goes through `execute()`,
 * which enforces: workflow allow-list → argument validation → tracing →
 * two-phase actions → uniform error mapping → metrics + audit.
 */

export interface ToolExecution {
  name: string;
  ok: boolean;
  /** Payload returned to the model. */
  result: Record<string, unknown>;
  sources: Source[];
  spans: Span[];
  latencyMs: number;
  action?: PendingActionView;
  view?: ToolView;
  error?: { code: string; message: string };
}

const BUILTIN = {
  confirm: "confirm_action",
  cancel: "cancel_action",
} as const;

export const BUILTIN_TOOL_NAMES = Object.values(BUILTIN);

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(...defs: ToolDefinition[]) {
    for (const d of defs) {
      if (this.tools.has(d.name)) throw new Error(`Duplicate tool ${d.name}`);
      this.tools.set(d.name, d);
    }
    return this;
  }

  has(name: string) {
    return this.tools.has(name) || (BUILTIN_TOOL_NAMES as readonly string[]).includes(name);
  }

  /** Gemini function declarations for a workflow's tool set (+ built-ins when it has actions). */
  declarations(names: string[], opts: { asyncSlowTools?: boolean } = {}): FunctionDeclaration[] {
    const decls: FunctionDeclaration[] = names.map((n) => {
      const t = this.tools.get(n);
      if (!t) throw new Error(`Unknown tool ${n}`);
      const decl: FunctionDeclaration = {
        name: t.name,
        description: t.kind === "action" ? `[ACTION — requires customer confirmation] ${t.description}` : t.description,
        parameters: zodToGeminiSchema(t.params),
      };
      if (opts.asyncSlowTools && t.latency === "slow" && t.kind === "read") decl.behavior = Behavior.NON_BLOCKING;
      return decl;
    });
    if (names.some((n) => this.tools.get(n)?.kind === "action")) {
      decls.push(
        {
          name: BUILTIN.confirm,
          description:
            "Execute a previously prepared action. Call ONLY after the customer has explicitly agreed (e.g. 'yes', 'go ahead') in a message AFTER the action was prepared.",
          parameters: zodToGeminiSchema(z.object({ actionId: z.string().describe("ID returned when the action was prepared") })),
        },
        {
          name: BUILTIN.cancel,
          description: "Cancel a prepared action the customer no longer wants.",
          parameters: zodToGeminiSchema(z.object({ actionId: z.string() })),
        },
      );
    }
    return decls;
  }

  async execute(name: string, rawArgs: unknown, ctx: ToolContext, allowed: string[]): Promise<ToolExecution> {
    const started = performance.now();
    const base = { name, sources: [] as Source[], spans: [] as Span[] };
    const done = (e: Omit<ToolExecution, "latencyMs" | "name">): ToolExecution => {
      const latencyMs = Math.round(performance.now() - started);
      metrics.observe(`tool.${name}_ms`, latencyMs);
      metrics.increment(`tool.${name}.${e.ok ? "ok" : "error"}`);
      return { ...e, name, latencyMs };
    };

    if (name === BUILTIN.confirm || name === BUILTIN.cancel) {
      const parsed = z.object({ actionId: z.string() }).safeParse(rawArgs);
      if (!parsed.success) return done({ ...base, ok: false, result: { error: "actionId is required" }, error: { code: "INVALID_ARGUMENTS", message: "actionId is required" } });
      return name === BUILTIN.confirm
        ? this.confirmAction(parsed.data.actionId, ctx, "assistant")
        : this.cancelAction(parsed.data.actionId, ctx);
    }

    const tool = this.tools.get(name);
    if (!tool || !allowed.includes(name)) {
      audit({ sessionId: ctx.sessionId, customerId: ctx.customerId, channel: ctx.channel, event: "tool.denied", name });
      return done({ ...base, ok: false, result: { error: `Tool ${name} is not available in this workflow.` }, error: { code: "NOT_ALLOWED", message: "Tool not permitted" } });
    }

    const parsed = tool.params.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return done({ ...base, ok: false, result: { error: `Invalid arguments — ${message}` }, error: { code: "INVALID_ARGUMENTS", message } });
    }

    try {
      if (tool.kind === "read") {
        const { result, spans } = await withTrace(() => tool.run(parsed.data, ctx));
        audit({ sessionId: ctx.sessionId, customerId: ctx.customerId, channel: ctx.channel, event: "tool.read", name });
        return done({ ok: true, result: { output: result.data }, sources: result.sources ?? [], spans, view: result.view });
      }

      const { result: preview, spans } = await withTrace(() => tool.prepare(parsed.data, ctx));
      const action = await actionStore.create({
        toolName: tool.name,
        workflowId: ctx.workflowId,
        customerId: ctx.customerId,
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        title: preview.title,
        summary: preview.summary,
        details: preview.details,
        payload: preview.payload,
      });
      audit({ sessionId: ctx.sessionId, customerId: ctx.customerId, channel: ctx.channel, event: "action.prepared", name, detail: `${action.id} ${preview.summary}` });
      return done({
        ok: true,
        result: {
          status: "awaiting_customer_confirmation",
          actionId: action.id,
          title: preview.title,
          summary: preview.summary,
          details: preview.details,
          instruction: "Summarise this for the customer and ask them to confirm. Do not call confirm_action until they explicitly agree.",
        },
        sources: preview.sources ?? [],
        spans,
        action: toView(action),
      });
    } catch (err) {
      return done({ ...base, ...this.mapError(err) });
    }
  }

  /** Commit a prepared action. `via: "ui"` = customer pressed Confirm; `"assistant"` = verbal/typed confirmation. */
  async confirmAction(actionId: string, ctx: ToolContext, via: "ui" | "assistant"): Promise<ToolExecution> {
    const started = performance.now();
    const fail = (code: string, message: string): ToolExecution => ({
      name: BUILTIN.confirm,
      ok: false,
      result: { error: message },
      sources: [],
      spans: [],
      latencyMs: Math.round(performance.now() - started),
      error: { code, message },
    });

    const action = await actionStore.get(actionId);
    if (!action || action.customerId !== ctx.customerId || action.sessionId !== ctx.sessionId) return fail("NOT_FOUND", "No such pending action.");
    if (action.status === "confirmed") {
      // Idempotent: confirming twice returns the original outcome.
      return { name: BUILTIN.confirm, ok: true, result: { status: "already_completed", reference: action.reference }, sources: [], spans: [], latencyMs: 0, action: toView(action) };
    }
    if (action.status !== "pending") return fail("NOT_PENDING", `Action is ${action.status}.`);
    if (via === "assistant" && action.turnId === ctx.turnId) {
      return fail("CONFIRMATION_REQUIRED", "The customer has not confirmed yet. Ask them to confirm first.");
    }

    const tool = this.tools.get(action.toolName);
    if (!tool || tool.kind !== "action") return fail("NOT_FOUND", "Action handler missing.");

    // Cross-instance claim: a UI click and a spoken "yes" can arrive together on different instances.
    if ((await kv.incr(`act:claim:${actionId}`)) > 1) {
      const latest = await actionStore.get(actionId);
      if (latest?.status === "confirmed") return { name: BUILTIN.confirm, ok: true, result: { status: "already_completed", reference: latest.reference }, sources: [], spans: [], latencyMs: 0, action: toView(latest) };
      return fail("IN_PROGRESS", "This request is already being submitted.");
    }

    try {
      const { result, spans } = await withTrace(() => tool.commit(action.payload, { ...ctx, workflowId: action.workflowId, actionId }));
      const confirmed = await actionStore.update(actionId, { status: "confirmed", reference: result.reference });
      audit({ sessionId: ctx.sessionId, customerId: ctx.customerId, channel: ctx.channel, event: "action.confirmed", name: action.toolName, detail: `${actionId} via ${via} → ${result.reference}` });
      metrics.increment(`action.${action.toolName}.confirmed`);
      return {
        name: BUILTIN.confirm,
        ok: true,
        result: { status: "completed", reference: result.reference, output: result.data },
        sources: result.sources ?? [],
        spans,
        latencyMs: Math.round(performance.now() - started),
        action: toView(confirmed ?? { ...action, status: "confirmed", reference: result.reference }),
      };
    } catch (err) {
      const mapped = this.mapError(err);
      // Leave the action pending on transient failures so it can be retried.
      const failed = err instanceof GatewayError ? action : await actionStore.update(actionId, { status: "failed", error: mapped.error?.message });
      // Release the claim so a transient failure can be retried.
      if (err instanceof GatewayError) await kv.del(`act:claim:${actionId}`);
      audit({ sessionId: ctx.sessionId, customerId: ctx.customerId, channel: ctx.channel, event: "action.failed", name: action.toolName, detail: `${actionId} ${mapped.error?.message}` });
      return { name: BUILTIN.confirm, ...mapped, latencyMs: Math.round(performance.now() - started), action: toView(failed ?? action) };
    }
  }

  async cancelAction(actionId: string, ctx: ToolContext): Promise<ToolExecution> {
    const action = await actionStore.get(actionId);
    if (!action || action.customerId !== ctx.customerId) {
      return { name: BUILTIN.cancel, ok: false, result: { error: "No such action" }, sources: [], spans: [], latencyMs: 0, error: { code: "NOT_FOUND", message: "No such action" } };
    }
    const updated = action.status === "pending" ? await actionStore.update(actionId, { status: "cancelled" }) : action;
    audit({ sessionId: ctx.sessionId, customerId: ctx.customerId, channel: ctx.channel, event: "action.cancelled", name: action.toolName, detail: actionId });
    return { name: BUILTIN.cancel, ok: true, result: { status: "cancelled" }, sources: [], spans: [], latencyMs: 0, action: toView(updated ?? action) };
  }

  private mapError(err: unknown): Omit<ToolExecution, "latencyMs" | "name"> {
    const base = { sources: [] as Source[], spans: [] as Span[] };
    if (err instanceof GatewayError) {
      return {
        ...base,
        ok: false,
        result: {
          error: "SYSTEM_UNAVAILABLE",
          system: err.system,
          message: `The ${err.system.replace("_", " ")} system is temporarily unavailable (${err.code}). Tell the customer, share anything you already know, and offer to retry or raise a ticket.`,
        },
        error: { code: err.code, message: err.message },
      };
    }
    if (err instanceof AccessDeniedError) return { ...base, ok: false, result: { error: "FORBIDDEN", message: err.message }, error: { code: "FORBIDDEN", message: err.message } };
    if (err instanceof BusinessRuleError) return { ...base, ok: false, result: { error: "NOT_PERMITTED_BY_POLICY", message: err.message, policy: err.ruleIds }, error: { code: "BUSINESS_RULE", message: err.message } };
    if (err instanceof NotFoundError) return { ...base, ok: false, result: { error: "NOT_FOUND", message: err.message }, error: { code: "NOT_FOUND", message: err.message } };
    console.error("[tool] unexpected error", err);
    return { ...base, ok: false, result: { error: "INTERNAL_ERROR", message: "Something went wrong while processing this request." }, error: { code: "INTERNAL", message: String(err) } };
  }
}
