import { NextResponse } from "next/server";
import { handle, requireSession, toolContext } from "@/server/http";
import { getWorkflow } from "@/workflows";

/** Account panels for the active workflow (rendered generically by the UI shell). */
export const GET = handle(async (req: Request) => {
  const session = await requireSession();
  const workflow = getWorkflow(new URL(req.url).searchParams.get("workflow"));
  const panels = await workflow.loadPanels(toolContext(session, workflow.id, "text", "panels"));
  return NextResponse.json({ panels }, { headers: { "cache-control": "no-store" } });
});
