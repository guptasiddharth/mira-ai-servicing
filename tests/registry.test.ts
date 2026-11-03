import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/capabilities/registry";
import { setChaosMode } from "@/enterprise/simulator";
import { cardServicing } from "@/workflows/card-servicing";
import { loanServicing } from "@/workflows/loan-servicing";

process.env.AUDIT_STDOUT = "false";
const ctx = (customerId: string, turnId = "t1") => ({ customerId, sessionId: "sess", workflowId: loanServicing.id, channel: "text" as const, turnId });

beforeAll(async () => {
  await setChaosMode("no_faults");
});

describe("tool registry — security & execution", () => {
  it("blocks access to another customer's loan (object-level authz)", async () => {
    const r = await registry.execute("get_loan_details", { loanId: "LN-PL-17733" }, ctx("CUST-1001"), loanServicing.tools);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("FORBIDDEN");
  });

  it("enforces the workflow tool allow-list", async () => {
    const r = await registry.execute("block_card", { reason: "lost" }, ctx("CUST-1002"), loanServicing.tools);
    expect(r.error?.code).toBe("NOT_ALLOWED");
  });

  it("validates model-supplied arguments", async () => {
    const r = await registry.execute("simulate_prepayment", { amount: -5 }, ctx("CUST-1001"), loanServicing.tools);
    expect(r.error?.code).toBe("INVALID_ARGUMENTS");
  });

  it("returns spans and sources for verifiable answers", async () => {
    const r = await registry.execute("explain_emi_change", {}, ctx("CUST-1001"), loanServicing.tools);
    expect(r.ok).toBe(true);
    expect(r.spans.map((s) => s.system)).toContain("loans");
    expect(r.sources.map((s) => s.ref)).toContain("POL-PL-005");
  });

  it("two-phase actions: no same-turn self-confirmation, idempotent commit", async () => {
    const prep = await registry.execute("raise_payment_dispute", { paymentId: "PMT-17733-19A", reason: "bank error" }, ctx("CUST-1002"), loanServicing.tools);
    expect(prep.ok).toBe(true);
    const actionId = prep.action!.id;

    const sameTurn = await registry.confirmAction(actionId, ctx("CUST-1002", "t1"), "assistant");
    expect(sameTurn.error?.code).toBe("CONFIRMATION_REQUIRED");

    const otherCustomer = await registry.confirmAction(actionId, ctx("CUST-1001", "t2"), "ui");
    expect(otherCustomer.ok).toBe(false);

    const ok = await registry.confirmAction(actionId, ctx("CUST-1002", "t2"), "assistant");
    expect(ok.ok).toBe(true);
    const again = await registry.confirmAction(actionId, ctx("CUST-1002", "t3"), "ui");
    expect(again.result.reference).toBe(ok.result.reference);
  });

  it("refuses actions that break policy, with clause IDs", async () => {
    const r = await registry.execute("request_part_prepayment", { amount: 50_000 }, ctx("CUST-1003"), loanServicing.tools);
    expect(r.error?.code).toBe("BUSINESS_RULE");
    expect(JSON.stringify(r.result)).toContain("POL-PL-001");
  });

  it("second workflow reuses shared tools and adds its own", () => {
    const shared = cardServicing.tools.filter((t) => loanServicing.tools.includes(t));
    expect(shared).toEqual(expect.arrayContaining(["get_customer_profile", "search_policy", "create_service_ticket"]));
    expect(registry.declarations(cardServicing.tools).map((d) => d.name)).toContain("confirm_action");
  });
});
