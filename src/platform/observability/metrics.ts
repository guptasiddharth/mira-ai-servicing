import { kv, type BatchOp } from "@/platform/state/kv";

/**
 * Metrics: bounded histograms (p50/p95/p99) and counters.
 *
 * Calls are synchronous and cheap (buffered in-process); `flush()` ships the
 * buffer to the shared store in one pipelined round trip at the end of each
 * request, so the Ops panel aggregates across every serverless instance.
 * In production this would be OpenTelemetry → Prometheus/Datadog; the
 * observe / increment / snapshot interface is what the rest of the code uses.
 */

const MAX_SAMPLES = 1000;
const NAMES_KEY = "m:names";
const COUNTERS_KEY = "m:counters";
const histKey = (name: string) => `m:h:${name}`;

export interface HistogramSummary {
  name: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  max: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarize(name: string, values: number[]): HistogramSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    name,
    count: sorted.length,
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
    avg: sorted.length ? Math.round(sum / sorted.length) : 0,
    max: Math.round(sorted.at(-1) ?? 0),
  };
}

class MetricsStore {
  private histograms = new Map<string, number[]>();
  private counters = new Map<string, number>();
  private pending: BatchOp[] = [];
  private newNames = new Set<string>();

  observe(name: string, value: number) {
    const arr = this.histograms.get(name) ?? [];
    arr.push(value);
    if (arr.length > MAX_SAMPLES) arr.shift();
    this.histograms.set(name, arr);
    if (kv.kind === "redis") {
      this.pending.push({ op: "lpush", key: histKey(name), value: Math.round(value), max: MAX_SAMPLES });
      this.newNames.add(name);
    }
  }

  increment(name: string, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
    if (kv.kind === "redis") this.pending.push({ op: "hincrby", key: COUNTERS_KEY, field: name, by });
  }

  /** Ship buffered samples to the shared store (no-op in memory mode). Never throws. */
  async flush() {
    if (kv.kind !== "redis" || (!this.pending.length && !this.newNames.size)) return;
    const ops: BatchOp[] = [...this.pending.splice(0), ...[...this.newNames].map((member) => ({ op: "sadd" as const, key: NAMES_KEY, member }))];
    this.newNames.clear();
    await kv.batch(ops).catch((e) => console.warn("[metrics] flush failed", String(e)));
  }

  async snapshot() {
    if (kv.kind !== "redis") {
      return {
        histograms: [...this.histograms.entries()].map(([n, v]) => summarize(n, v)).sort((a, b) => a.name.localeCompare(b.name)),
        counters: Object.fromEntries([...this.counters.entries()].sort()),
      };
    }
    const names = (await kv.smembers(NAMES_KEY)).sort();
    const [lists, counters] = await Promise.all([kv.lrangeMany<number>(names.map(histKey), 0, MAX_SAMPLES - 1), kv.hgetall(COUNTERS_KEY)]);
    return {
      histograms: names.map((n, i) => summarize(n, (lists[i] ?? []).map(Number))),
      counters: Object.fromEntries(Object.entries(counters).sort()),
    };
  }

  async reset() {
    this.histograms.clear();
    this.counters.clear();
    this.pending = [];
    if (kv.kind === "redis") {
      const names = await kv.smembers(NAMES_KEY);
      await kv.del(NAMES_KEY, COUNTERS_KEY, ...names.map(histKey));
    }
  }
}

const g = globalThis as unknown as { __kestrelMetrics?: MetricsStore };
export const metrics: MetricsStore = (g.__kestrelMetrics ??= new MetricsStore());
