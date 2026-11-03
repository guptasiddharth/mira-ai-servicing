import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped tracing. The Integration Gateway records a span for every
 * backend call into whatever trace is active, so tools never have to thread
 * a tracer through their code.
 */

export interface Span {
  system: string;
  operation: string;
  latencyMs: number;
  attempts: number;
  cached: boolean;
  outcome: "ok" | "error";
  error?: string;
}

class TraceCollector {
  readonly spans: Span[] = [];
}

const storage = new AsyncLocalStorage<TraceCollector>();

export async function withTrace<T>(fn: () => Promise<T>): Promise<{ result: T; spans: Span[] }> {
  const collector = new TraceCollector();
  const result = await storage.run(collector, fn);
  return { result, spans: collector.spans };
}

export function recordSpan(span: Span) {
  storage.getStore()?.spans.push(span);
}
