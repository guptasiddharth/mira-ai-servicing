import { Redis } from "@upstash/redis";

/**
 * Shared state for horizontally-scaled deployments.
 *
 * Serverless instances don't share memory, so anything that must survive
 * across requests (pending actions, system-of-record mutations, chaos mode,
 * metrics, audit) goes through this interface:
 *   • "redis"  — Upstash Redis over HTTPS (no connection pool; serverless-friendly)
 *   • "memory" — single-process Map, for local dev, tests and benchmarks
 *
 * Selected automatically from env (KV_REST_API_URL / UPSTASH_REDIS_REST_URL),
 * or forced with STATE_STORE=memory|redis.
 */

export type BatchOp =
  | { op: "lpush"; key: string; value: unknown; max: number; ttlSeconds?: number }
  | { op: "hincrby"; key: string; field: string; by: number }
  | { op: "sadd"; key: string; member: string };

export interface KV {
  readonly kind: "memory" | "redis";
  get<T>(key: string): Promise<T | null>;
  mget<T>(keys: string[]): Promise<(T | null)[]>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  incr(key: string): Promise<number>;
  lrange<T>(key: string, start: number, stop: number): Promise<T[]>;
  /** Many list reads in one round trip. */
  lrangeMany<T>(keys: string[], start: number, stop: number): Promise<T[][]>;
  hgetall(key: string): Promise<Record<string, number>>;
  smembers(key: string): Promise<string[]>;
  /** Fire-and-forget style writes, pipelined into one round trip on Redis. */
  batch(ops: BatchOp[]): Promise<void>;
}

const PREFIX = "kestrel:";
const k = (key: string) => PREFIX + key;

class MemoryKV implements KV {
  readonly kind = "memory" as const;
  private data = new Map<string, { value: unknown; expires?: number }>();

  private read(key: string) {
    const e = this.data.get(key);
    if (e?.expires && e.expires < Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e?.value;
  }
  private write(key: string, value: unknown, ttlSeconds?: number) {
    this.data.set(key, { value, expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined });
  }

  async get<T>(key: string) {
    const v = this.read(k(key));
    return v === undefined ? null : (structuredClone(v) as T);
  }
  async mget<T>(keys: string[]) {
    return Promise.all(keys.map((key) => this.get<T>(key)));
  }
  async set(key: string, value: unknown, ttlSeconds?: number) {
    this.write(k(key), structuredClone(value), ttlSeconds);
  }
  async del(...keys: string[]) {
    for (const key of keys) this.data.delete(k(key));
  }
  async incr(key: string) {
    const n = ((this.read(k(key)) as number) ?? 0) + 1;
    this.write(k(key), n);
    return n;
  }
  async lrange<T>(key: string, start: number, stop: number) {
    const list = (this.read(k(key)) as T[]) ?? [];
    return list.slice(start, stop === -1 ? undefined : stop + 1);
  }
  async lrangeMany<T>(keys: string[], start: number, stop: number) {
    return Promise.all(keys.map((key) => this.lrange<T>(key, start, stop)));
  }
  async hgetall(key: string) {
    return { ...((this.read(k(key)) as Record<string, number>) ?? {}) };
  }
  async smembers(key: string) {
    return [...((this.read(k(key)) as Set<string>) ?? new Set<string>())];
  }
  async batch(ops: BatchOp[]) {
    for (const o of ops) {
      if (o.op === "lpush") {
        const list = ((this.read(k(o.key)) as unknown[]) ?? []).slice(0, o.max - 1);
        this.write(k(o.key), [o.value, ...list], o.ttlSeconds);
      } else if (o.op === "hincrby") {
        const h = (this.read(k(o.key)) as Record<string, number>) ?? {};
        h[o.field] = (h[o.field] ?? 0) + o.by;
        this.write(k(o.key), h);
      } else {
        const s = (this.read(k(o.key)) as Set<string>) ?? new Set<string>();
        s.add(o.member);
        this.write(k(o.key), s);
      }
    }
  }
}

class RedisKV implements KV {
  readonly kind = "redis" as const;
  constructor(private readonly r: Redis) {}

  get<T>(key: string) {
    return this.r.get<T>(k(key));
  }
  async mget<T>(keys: string[]) {
    return keys.length ? this.r.mget<(T | null)[]>(...keys.map(k)) : [];
  }
  async set(key: string, value: unknown, ttlSeconds?: number) {
    if (ttlSeconds) await this.r.set(k(key), value, { ex: ttlSeconds });
    else await this.r.set(k(key), value);
  }
  async del(...keys: string[]) {
    if (keys.length) await this.r.del(...keys.map(k));
  }
  incr(key: string) {
    return this.r.incr(k(key));
  }
  lrange<T>(key: string, start: number, stop: number) {
    return this.r.lrange<T>(k(key), start, stop);
  }
  async lrangeMany<T>(keys: string[], start: number, stop: number) {
    if (!keys.length) return [];
    const p = this.r.pipeline();
    for (const key of keys) p.lrange(k(key), start, stop);
    return (await p.exec()) as T[][];
  }
  async hgetall(key: string) {
    const h = await this.r.hgetall<Record<string, number>>(k(key));
    return Object.fromEntries(Object.entries(h ?? {}).map(([f, v]) => [f, Number(v)]));
  }
  smembers(key: string) {
    return this.r.smembers(k(key));
  }
  async batch(ops: BatchOp[]) {
    if (!ops.length) return;
    const p = this.r.pipeline();
    for (const o of ops) {
      if (o.op === "lpush") {
        p.lpush(k(o.key), o.value);
        p.ltrim(k(o.key), 0, o.max - 1);
        if (o.ttlSeconds) p.expire(k(o.key), o.ttlSeconds);
      } else if (o.op === "hincrby") p.hincrby(k(o.key), o.field, o.by);
      else p.sadd(k(o.key), o.member);
    }
    await p.exec();
  }
}

function create(): KV {
  const forced = process.env.STATE_STORE;
  const hasRedis = !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
  if (forced === "memory" || (!hasRedis && forced !== "redis")) return new MemoryKV();
  return new RedisKV(Redis.fromEnv());
}

const g = globalThis as unknown as { __kestrelKV?: KV };
export const kv: KV = (g.__kestrelKV ??= create());
