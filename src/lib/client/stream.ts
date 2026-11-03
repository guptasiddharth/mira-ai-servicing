import type { AgentEvent } from "@/platform/agent/events";

/** Reads an NDJSON stream of AgentEvents. */
export async function* readEvents(res: Response): AsyncGenerator<AgentEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as AgentEvent;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as AgentEvent;
}

export function reportMetric(name: string, value: number) {
  void fetch("/api/ops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "client_metric", name, value: Math.round(value) }) }).catch(() => {});
}
