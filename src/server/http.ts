import { NextResponse } from "next/server";
import { getSession, type Session } from "@/platform/security/session";
import { flushState } from "@/platform/state/flush";
import type { ToolContext } from "@/platform/tools/types";

/** Shared helpers for route handlers. */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new HttpError(401, "Not signed in");
  return s;
}

export function toolContext(session: Session, workflowId: string, channel: "text" | "voice", turnId: string): ToolContext {
  return { customerId: session.customerId, sessionId: session.sid, workflowId, channel, turnId };
}

/** Per-session token bucket — protects the LLM quota and backends from runaway clients. */
const buckets = new Map<string, { tokens: number; updated: number }>();
export function rateLimit(key: string, perMinute = 40) {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, updated: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.updated) / 60_000) * perMinute);
  b.updated = now;
  if (b.tokens < 1) throw new HttpError(429, "Too many requests — please slow down.");
  b.tokens -= 1;
  buckets.set(key, b);
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error("[api] unhandled", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    } finally {
      // Streaming routes flush again when their stream completes.
      await flushState();
    }
  };
}
