import { createSeed } from "@/enterprise/data/seed";
import type { EnterpriseDatabase } from "@/enterprise/types";
import { today } from "@/lib/dates";
import { kv } from "@/platform/state/kv";

/**
 * Network simulator for the customer's backend systems. Each system has its
 * own latency profile and failure rate so the platform's resilience layer
 * (timeouts, retries, circuit breakers, caching) is exercised for real.
 *
 * The systems' data lives in the shared state store, so every serverless
 * instance sees the same records (e.g. a ticket created on one instance shows
 * up on another). Each instance keeps a local copy and only re-reads when the
 * shared version number changes.
 */

export type SystemId = "crm" | "loans" | "payments" | "policy" | "service_ops" | "cards";

export interface SystemProfile {
  label: string;
  baseLatencyMs: number;
  jitterMs: number;
  /** Probability of a slow (tail-latency) response. */
  tailRate: number;
  tailLatencyMs: number;
  failureRate: number;
}

export const SYSTEM_LABELS: Record<SystemId, string> = {
  crm: "Customer CRM",
  loans: "Loan Management",
  payments: "Payments",
  policy: "Policy Knowledge",
  service_ops: "Service Operations",
  cards: "Card Platform",
};

const NORMAL: Record<SystemId, SystemProfile> = {
  crm: { label: SYSTEM_LABELS.crm, baseLatencyMs: 90, jitterMs: 60, tailRate: 0.03, tailLatencyMs: 600, failureRate: 0.02 },
  loans: { label: SYSTEM_LABELS.loans, baseLatencyMs: 180, jitterMs: 120, tailRate: 0.05, tailLatencyMs: 900, failureRate: 0.03 },
  payments: { label: SYSTEM_LABELS.payments, baseLatencyMs: 450, jitterMs: 300, tailRate: 0.08, tailLatencyMs: 1600, failureRate: 0.08 },
  policy: { label: SYSTEM_LABELS.policy, baseLatencyMs: 40, jitterMs: 30, tailRate: 0.01, tailLatencyMs: 300, failureRate: 0.01 },
  service_ops: { label: SYSTEM_LABELS.service_ops, baseLatencyMs: 300, jitterMs: 200, tailRate: 0.05, tailLatencyMs: 1200, failureRate: 0.05 },
  cards: { label: SYSTEM_LABELS.cards, baseLatencyMs: 200, jitterMs: 120, tailRate: 0.04, tailLatencyMs: 900, failureRate: 0.03 },
};

export const CHAOS_MODES = ["normal", "degraded", "payments_outage", "no_faults"] as const;
export type ChaosMode = (typeof CHAOS_MODES)[number];

export function profilesFor(mode: ChaosMode): Record<SystemId, SystemProfile> {
  const p = structuredClone(NORMAL);
  if (mode === "no_faults") {
    for (const s of Object.values(p)) {
      s.failureRate = 0;
      s.tailRate = 0;
    }
  }
  if (mode === "degraded") {
    for (const s of Object.values(p)) {
      s.baseLatencyMs *= 2.5;
      s.failureRate = Math.min(0.35, s.failureRate * 5);
      s.tailRate *= 3;
    }
  }
  if (mode === "payments_outage") p.payments.failureRate = 1;
  return p;
}

// ───────────────────────────── Shared state ─────────────────────────────

const CHAOS_KEY = "sim:chaos";
const dbKey = () => `sim:db:${today()}`;
const versionKey = () => `sim:dbv:${today()}`;
const DB_TTL_S = 3 * 24 * 3600;
const VERSION_CHECK_MS = 300;
const CHAOS_CHECK_MS = 2000;

interface Local {
  db?: EnterpriseDatabase;
  version: number;
  versionCheckedAt: number;
  mode: ChaosMode;
  modeCheckedAt: number;
}
const g = globalThis as unknown as { __kestrelSim?: Local };
const local: Local = (g.__kestrelSim ??= { version: -1, versionCheckedAt: 0, mode: "normal", modeCheckedAt: 0 });

/** Current system-of-record data (read path). */
export async function getDb(): Promise<EnterpriseDatabase> {
  if (kv.kind === "memory") {
    if (!local.db || local.db.asOf !== today()) local.db = createSeed();
    return local.db;
  }
  const now = Date.now();
  if (local.db && local.db.asOf === today() && now - local.versionCheckedAt < VERSION_CHECK_MS) return local.db;
  const version = (await kv.get<number>(versionKey())) ?? 0;
  local.versionCheckedAt = now;
  if (!local.db || local.version !== version || local.db.asOf !== today()) {
    local.db = (await kv.get<EnterpriseDatabase>(dbKey())) ?? createSeed();
    local.version = version;
  }
  return local.db;
}

/** Apply a write to the system-of-record data and publish it to all instances. */
export async function mutateDb<T>(fn: (d: EnterpriseDatabase) => T): Promise<T> {
  if (kv.kind === "memory") return fn(await getDb());
  // Read-modify-write on the latest shared copy. Demo-grade: last writer wins
  // on truly concurrent writes; real systems of record own their own consistency.
  const fresh = (await kv.get<EnterpriseDatabase>(dbKey())) ?? createSeed();
  const result = fn(fresh);
  await kv.set(dbKey(), fresh, DB_TTL_S);
  local.version = await kv.incr(versionKey());
  local.versionCheckedAt = Date.now();
  local.db = fresh;
  return result;
}

export async function getChaosMode(): Promise<ChaosMode> {
  if (kv.kind === "memory") return local.mode;
  if (Date.now() - local.modeCheckedAt > CHAOS_CHECK_MS) {
    local.mode = (await kv.get<ChaosMode>(CHAOS_KEY)) ?? "normal";
    local.modeCheckedAt = Date.now();
  }
  return local.mode;
}

export async function setChaosMode(mode: ChaosMode) {
  local.mode = mode;
  local.modeCheckedAt = Date.now();
  await kv.set(CHAOS_KEY, mode);
}

export async function resetData() {
  local.db = undefined;
  local.version = -1;
  await kv.del(dbKey(), versionKey());
}

// ───────────────────────────── Simulated network ─────────────────────────────

export class UpstreamError extends Error {
  constructor(
    public readonly system: SystemId,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function networkHop(system: SystemId, signal?: AbortSignal) {
  const p = profilesFor(await getChaosMode())[system];
  const latency = Math.random() < p.tailRate ? p.tailLatencyMs + Math.random() * p.jitterMs : p.baseLatencyMs + Math.random() * p.jitterMs;
  await sleep(latency, signal);
  if (Math.random() < p.failureRate) throw new UpstreamError(system, 503, `${p.label} returned 503 Service Unavailable`);
}

/**
 * A read against a system of record as if it were a remote call: pays a
 * sampled latency, may fail, and returns a deep copy so callers can never
 * mutate system state by accident.
 */
export async function remote<T>(system: SystemId, fn: (database: EnterpriseDatabase) => T, signal?: AbortSignal): Promise<T> {
  await networkHop(system, signal);
  return structuredClone(fn(await getDb()));
}

/** A write against a system of record (same network behaviour, persisted for all instances). */
export async function remoteWrite<T>(system: SystemId, fn: (database: EnterpriseDatabase) => T, signal?: AbortSignal): Promise<T> {
  await networkHop(system, signal);
  return structuredClone(await mutateDb(fn));
}
