import { flushAudit } from "@/platform/observability/audit";
import { metrics } from "@/platform/observability/metrics";

/** Ship buffered telemetry to the shared store before a serverless request ends. */
export async function flushState() {
  await Promise.all([metrics.flush(), flushAudit()]);
}
