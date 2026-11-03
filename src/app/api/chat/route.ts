import { z } from "zod";
import { registry } from "@/capabilities/registry";
import type { AgentEvent } from "@/platform/agent/events";
import { runTextTurn } from "@/platform/agent/runtime";
import { flushState } from "@/platform/state/flush";
import { handle, HttpError, rateLimit, requireSession, toolContext } from "@/server/http";
import { getWorkflow } from "@/workflows";

export const maxDuration = 60;

const Body = z.object({
  workflowId: z.string(),
  turnId: z.string().max(64),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .min(1)
    .max(60),
});

/** Text channel: streams AgentEvents as NDJSON. Stateless — history comes from the client. */
export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  rateLimit(`chat:${session.sid}`);
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { workflowId, turnId, messages } = parsed.data;
  const workflow = getWorkflow(workflowId);
  const ctx = toolContext(session, workflow.id, "text", turnId);
  const history = messages.slice(-24).filter((m) => m.text.trim());

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runTextTurn({ workflow, registry, history, ctx, emit, loadContext: () => workflow.loadContext(ctx), signal: req.signal });
      } catch (err) {
        console.error("[chat] turn failed", err);
        const msg = String((err as Error)?.message ?? err);
        emit({
          type: "error",
          message: msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") ? "The AI model is rate-limited right now (free tier). Please retry in a few seconds." : "Sorry — I couldn't complete that. Please try again.",
        });
      } finally {
        await flushState();
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});
