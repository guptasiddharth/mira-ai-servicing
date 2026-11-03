import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Stateless signed session (HMAC-SHA256). The customer identity used by every
 * tool comes ONLY from here — the model can never choose whose data to read.
 */

export const SESSION_COOKIE = "kestrel_session";
const MAX_AGE_S = 60 * 60 * 2;

export interface Session {
  sid: string;
  customerId: string;
  iat: number;
  exp: number;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (16+ chars)");
    return "dev-only-insecure-session-secret";
  }
  return s;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function encodeSession(customerId: string): { token: string; session: Session } {
  const now = Math.floor(Date.now() / 1000);
  const session: Session = { sid: randomUUID(), customerId, iat: now, exp: now + MAX_AGE_S };
  const payload = b64(JSON.stringify(session));
  return { token: `${payload}.${sign(payload)}`, session };
}

export function decodeSession(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    return s.exp > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_S,
};
