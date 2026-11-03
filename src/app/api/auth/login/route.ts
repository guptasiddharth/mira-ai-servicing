import { NextResponse } from "next/server";
import { z } from "zod";
import { data } from "@/capabilities/data";
import { getDb } from "@/enterprise/simulator";
import { audit } from "@/platform/observability/audit";
import { encodeSession, SESSION_COOKIE, sessionCookieOptions } from "@/platform/security/session";
import { handle, HttpError } from "@/server/http";
import { loanServicing } from "@/workflows/loan-servicing";

const DEMO_OTP = "123456";
const Body = z.object({ customerId: z.string(), otp: z.string() });

/**
 * Demo login: pick a customer persona + mock OTP. In production this is the
 * bank's existing IdP (OIDC) with step-up auth for sensitive actions.
 */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const parsed = Body.safeParse({ customerId: form.get("customerId"), otp: form.get("otp") });
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  if (parsed.data.otp !== DEMO_OTP) return NextResponse.redirect(new URL("/?error=otp", req.url), 303);
  if (!(await getDb()).customers.some((c) => c.id === parsed.data.customerId)) throw new HttpError(404, "Unknown customer");

  const { token, session } = encodeSession(parsed.data.customerId);
  audit({ sessionId: session.sid, customerId: session.customerId, channel: "web", event: "auth.login", name: "otp" });

  // Warm the context cache so the first question is answered from prefetched data.
  void loanServicing.loadContext({ customerId: session.customerId, sessionId: session.sid, workflowId: loanServicing.id, channel: "text", turnId: "warmup" }).catch(() => {});
  void data.payments(session.customerId, 24).catch(() => {});

  const res = NextResponse.redirect(new URL("/assistant", req.url), 303);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
});
