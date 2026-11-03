import { metrics } from "@/platform/observability/metrics";
import { recordSpan } from "@/platform/observability/trace";

/**
 * Integration Gateway — the single path from the AI layer to any enterprise
 * system. It owns the cross-cutting reliability concerns so individual tools
 * (and every future workflow) get them for free:
 *
 *   • per-system timeouts            • retries with exponential backoff + jitter
 *   • circuit breakers               • read-through cache with tag invalidation
 *   • request coalescing (singleflight) • idempotent writes
 *   • latency/attempt metrics + per-request trace spans
 */

export interface SystemPolicy {
  timeoutMs: number;
  retries: number;
  backoffBaseMs: number;
  cacheTtlMs: number;
  breakerThreshold: number;
  breakerCooldownMs: number;
}

export type GatewayErrorCode = "TIMEOUT" | "UPSTREAM_ERROR" | "CIRCUIT_OPEN";

export class GatewayError extends Error {
  constructor(
    public readonly system: string,
    public readonly operation: string,
    public readonly code: GatewayErrorCode,
    message: string,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

interface BreakerState {
  consecutiveFailures: number;
  openUntil: number;
}

interface CacheEntry {
  value: unknown;
  expires: number;
  tags: string[];
}

export interface ReadOptions {
  cacheKey?: string;
  tags?: string[];
  ttlMs?: number;
}

export interface WriteOptions {
  idempotencyKey: string;
  invalidateTags?: string[];
}

export interface BreakerSnapshot {
  system: string;
  state: "closed" | "open" | "half_open";
  consecutiveFailures: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class IntegrationGateway {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<unknown>>();
  private breakers = new Map<string, BreakerState>();
  private completedWrites = new Map<string, unknown>();

  constructor(
    private readonly policies: Record<string, SystemPolicy>,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private policy(system: string): SystemPolicy {
    const p = this.policies[system];
    if (!p) throw new Error(`No gateway policy for system "${system}"`);
    return p;
  }

  /** Idempotent read with caching and coalescing. */
  async read<T>(system: string, operation: string, fn: (signal: AbortSignal) => Promise<T>, opts: ReadOptions = {}): Promise<T> {
    const policy = this.policy(system);
    const ttl = opts.ttlMs ?? policy.cacheTtlMs;
    const key = opts.cacheKey ? `${system}:${opts.cacheKey}` : undefined;

    if (key && ttl > 0) {
      const hit = this.cache.get(key);
      if (hit && hit.expires > this.now()) {
        metrics.increment(`backend.${system}.cache_hits`);
        recordSpan({ system, operation, latencyMs: 0, attempts: 0, cached: true, outcome: "ok" });
        return structuredClone(hit.value) as T;
      }
      const pending = this.inflight.get(key);
      if (pending) {
        metrics.increment(`backend.${system}.coalesced`);
        return structuredClone(await pending) as T;
      }
    }

    const promise = this.execute(system, operation, fn, policy);
    if (key) this.inflight.set(key, promise);
    try {
      const value = await promise;
      if (key && ttl > 0) this.cache.set(key, { value, expires: this.now() + ttl, tags: opts.tags ?? [] });
      return value;
    } finally {
      if (key) this.inflight.delete(key);
    }
  }

  /**
   * Write with an idempotency key: retries are safe because the upstream
   * receives the same key, and a repeated call returns the first result.
   */
  async write<T>(system: string, operation: string, fn: (signal: AbortSignal) => Promise<T>, opts: WriteOptions): Promise<T> {
    const idemKey = `${system}:${operation}:${opts.idempotencyKey}`;
    if (this.completedWrites.has(idemKey)) {
      metrics.increment(`backend.${system}.idempotent_replays`);
      return this.completedWrites.get(idemKey) as T;
    }
    const value = await this.execute(system, operation, fn, this.policy(system));
    this.completedWrites.set(idemKey, value);
    for (const tag of opts.invalidateTags ?? []) this.invalidate(tag);
    return value;
  }

  invalidate(tag: string) {
    for (const [k, v] of this.cache) if (v.tags.includes(tag)) this.cache.delete(k);
  }

  breakerStates(): BreakerSnapshot[] {
    return Object.keys(this.policies).map((system) => {
      const b = this.breakers.get(system);
      const open = !!b && b.openUntil > this.now();
      const halfOpen = !!b && b.openUntil > 0 && b.openUntil <= this.now();
      return { system, state: open ? "open" : halfOpen ? "half_open" : "closed", consecutiveFailures: b?.consecutiveFailures ?? 0 };
    });
  }

  private async execute<T>(system: string, operation: string, fn: (signal: AbortSignal) => Promise<T>, policy: SystemPolicy): Promise<T> {
    const started = performance.now();
    const breaker = this.breakers.get(system) ?? { consecutiveFailures: 0, openUntil: 0 };
    this.breakers.set(system, breaker);

    const finish = (outcome: "ok" | "error", attempts: number, error?: string) => {
      const latencyMs = Math.round(performance.now() - started);
      metrics.observe(`backend.${system}_ms`, latencyMs);
      metrics.increment(`backend.${system}.calls`);
      if (outcome === "error") metrics.increment(`backend.${system}.errors`);
      if (attempts > 1) metrics.increment(`backend.${system}.retries`, attempts - 1);
      recordSpan({ system, operation, latencyMs, attempts, cached: false, outcome, error });
    };

    if (breaker.openUntil > this.now()) {
      metrics.increment(`backend.${system}.short_circuited`);
      finish("error", 0, "circuit open");
      throw new GatewayError(system, operation, "CIRCUIT_OPEN", `${system} circuit is open`, 0);
    }
    const halfOpen = breaker.openUntil > 0;
    const maxAttempts = halfOpen ? 1 : policy.retries + 1;

    let lastError: unknown;
    let attempt = 0;
    for (attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new TimeoutError(policy.timeoutMs)), policy.timeoutMs);
      try {
        const value = await fn(controller.signal);
        clearTimeout(timer);
        breaker.consecutiveFailures = 0;
        breaker.openUntil = 0;
        finish("ok", attempt);
        return value;
      } catch (err) {
        clearTimeout(timer);
        lastError = controller.signal.aborted ? controller.signal.reason : err;
        breaker.consecutiveFailures++;
        if (breaker.consecutiveFailures >= policy.breakerThreshold || halfOpen) {
          breaker.openUntil = this.now() + policy.breakerCooldownMs;
          metrics.increment(`backend.${system}.breaker_opened`);
          break;
        }
        if (attempt < maxAttempts) {
          const backoff = policy.backoffBaseMs * 2 ** (attempt - 1);
          await sleep(backoff + Math.random() * backoff);
        }
      }
    }

    const attempts = Math.min(attempt, maxAttempts);
    const isTimeout = lastError instanceof TimeoutError;
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    finish("error", attempts, message);
    throw new GatewayError(system, operation, isTimeout ? "TIMEOUT" : "UPSTREAM_ERROR", message, attempts);
  }
}
