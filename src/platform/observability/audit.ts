import { kv, type BatchOp } from "@/platform/state/kv";

/**
 * Append-only audit trail for customer-data access and actions, plus PII
 * redaction for anything that leaves the process (logs, traces, UI debug panes).
 * Entries are buffered and flushed to the shared store with the request's
 * metrics, and also emitted as structured JSON logs.
 */

const PATTERNS: [RegExp, (m: string) => string][] = [
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, (m) => m.slice(0, 2) + "XXXXX" + m.slice(-1)], // PAN
  [/\+?91[\s-]?\d{5}[\s-]?\d{5}\b/g, (m) => m.slice(0, 4) + " XXXXX " + m.replace(/\D/g, "").slice(-3).padStart(5, "X")], // phone
  [/\b([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-z]{2,})\b/g, (m) => m[0] + "***@" + m.split("@")[1]], // email
];

export function redact(input: string): string {
  return PATTERNS.reduce((s, [re, fn]) => s.replace(re, fn), input);
}

export interface AuditEntry {
  ts: string;
  sessionId: string;
  customerId: string;
  channel: string;
  event: "tool.read" | "tool.denied" | "action.prepared" | "action.confirmed" | "action.cancelled" | "action.failed" | "auth.login";
  name: string;
  detail?: string;
}

const MAX = 100;
const auditKey = (customerId: string) => `audit:${customerId}`;
const g = globalThis as unknown as { __kestrelAudit?: { log: AuditEntry[]; pending: BatchOp[] } };
const state = (g.__kestrelAudit ??= { log: [], pending: [] });

export function audit(entry: Omit<AuditEntry, "ts">) {
  const e: AuditEntry = { ...entry, ts: new Date().toISOString(), detail: entry.detail ? redact(entry.detail) : undefined };
  state.log.push(e);
  if (state.log.length > MAX * 5) state.log.shift();
  if (kv.kind === "redis") state.pending.push({ op: "lpush", key: auditKey(e.customerId), value: e, max: MAX, ttlSeconds: 7 * 24 * 3600 });
  if (process.env.AUDIT_STDOUT !== "false") console.log(JSON.stringify({ type: "audit", ...e }));
}

export async function flushAudit() {
  if (kv.kind !== "redis" || !state.pending.length) return;
  await kv.batch(state.pending.splice(0)).catch((err) => console.warn("[audit] flush failed", String(err)));
}

export async function recentAudit(customerId: string, limit = 30): Promise<AuditEntry[]> {
  if (kv.kind === "redis") return kv.lrange<AuditEntry>(auditKey(customerId), 0, limit - 1);
  return state.log.filter((e) => e.customerId === customerId).slice(-limit).reverse();
}
