import { NextResponse } from "next/server";
import { z } from "zod";
import { gateway } from "@/capabilities/data";
import { CHAOS_MODES, getChaosMode, profilesFor, resetData, setChaosMode, SYSTEM_LABELS } from "@/enterprise/simulator";
import { recentAudit } from "@/platform/observability/audit";
import { metrics } from "@/platform/observability/metrics";
import { handle, HttpError, requireSession } from "@/server/http";

/** Ops panel: live latency metrics, breaker states, audit trail, and chaos controls (demo only). */
export const GET = handle(async () => {
  const session = await requireSession();
  const mode = await getChaosMode();
  const [snapshot, audit] = await Promise.all([metrics.snapshot(), recentAudit(session.customerId, 15)]);
  return NextResponse.json(
    {
      metrics: snapshot,
      breakers: gateway.breakerStates(),
      chaosMode: mode,
      systems: Object.entries(profilesFor(mode)).map(([id, p]) => ({ id, label: SYSTEM_LABELS[id as keyof typeof SYSTEM_LABELS], baseLatencyMs: Math.round(p.baseLatencyMs), failureRate: p.failureRate })),
      audit,
    },
    { headers: { "cache-control": "no-store" } },
  );
});

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("chaos"), mode: z.enum(CHAOS_MODES) }),
  z.object({ op: z.literal("reset") }),
  z.object({ op: z.literal("client_metric"), name: z.enum(["voice.response_ms", "voice.first_audio_ms", "chat.client_ttft_ms", "voice.interruptions"]), value: z.number().min(0).max(120_000) }),
]);

export const POST = handle(async (req: Request) => {
  await requireSession();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const b = parsed.data;
  if (b.op === "chaos") await setChaosMode(b.mode);
  if (b.op === "reset") await Promise.all([resetData(), metrics.reset()]);
  if (b.op === "client_metric") {
    if (b.name === "voice.interruptions") metrics.increment(b.name, b.value);
    else metrics.observe(b.name, b.value);
  }
  return NextResponse.json({ ok: true });
});
