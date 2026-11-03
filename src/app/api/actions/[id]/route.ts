import { NextResponse } from "next/server";
import { z } from "zod";
import { registry } from "@/capabilities/registry";
import { handle, HttpError, requireSession, toolContext } from "@/server/http";

const Body = z.object({ decision: z.enum(["confirm", "cancel"]), workflowId: z.string() });

/** Customer pressed Confirm / Cancel on an action card — the strongest form of consent. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession();
  const { id } = await params;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const ctx = toolContext(session, parsed.data.workflowId, "text", `ui-${Date.now()}`);
  const ex = parsed.data.decision === "confirm" ? await registry.confirmAction(id, ctx, "ui") : await registry.cancelAction(id, ctx);
  return NextResponse.json({ ok: ex.ok, result: ex.result, action: ex.action, error: ex.error, latencyMs: ex.latencyMs, spans: ex.spans }, { status: ex.ok ? 200 : 409 });
});
