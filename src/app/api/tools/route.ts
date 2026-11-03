import { NextResponse } from "next/server";
import { z } from "zod";
import { registry } from "@/capabilities/registry";
import type { ToolResultEvent } from "@/platform/agent/events";
import { metrics } from "@/platform/observability/metrics";
import { handle, HttpError, rateLimit, requireSession, toolContext } from "@/server/http";
import { getWorkflow } from "@/workflows";

const Body = z.object({
  workflowId: z.string(),
  turnId: z.string().max(64),
  callId: z.string().max(128),
  name: z.string().max(64),
  args: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Voice channel tool execution. The Live model's function calls are relayed
 * here by the browser and run through the exact same registry, authorisation
 * and gateway as the text channel.
 */
export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  rateLimit(`tools:${session.sid}`, 120);
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { workflowId, turnId, callId, name, args } = parsed.data;
  const workflow = getWorkflow(workflowId);
  const ex = await registry.execute(name, args, toolContext(session, workflow.id, "voice", turnId), workflow.tools);
  metrics.observe("voice.tool_ms", ex.latencyMs);
  const event: ToolResultEvent = { callId, name: ex.name, ok: ex.ok, latencyMs: ex.latencyMs, spans: ex.spans, sources: ex.sources, error: ex.error, action: ex.action, view: ex.view };
  return NextResponse.json({ response: ex.result, event });
});
