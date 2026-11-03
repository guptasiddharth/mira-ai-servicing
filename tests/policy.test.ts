import { describe, expect, it } from "vitest";
import { evaluateBounceReversal, evaluateForeclosure, evaluatePartPrepayment } from "@/domain/policy/loan-rules";

const facts = { rateType: "floating" as const, emisPaid: 14, outstandingPrincipal: 376_598, partPrepaymentsThisFY: 0 };

describe("part-prepayment rules", () => {
  it("allows a valid floating-rate prepayment with nil charges", () => {
    const d = evaluatePartPrepayment(facts, 50_000);
    expect(d.allowed).toBe(true);
    expect(d.chargeRatePct).toBe(0);
    expect(d.appliedRules).toContain("POL-PL-003");
  });

  it("enforces lock-in (POL-PL-001)", () => {
    const d = evaluatePartPrepayment({ ...facts, emisPaid: 4 }, 50_000);
    expect(d.allowed).toBe(false);
    expect(d.violations.map((v) => v.ruleId)).toContain("POL-PL-001");
  });

  it("caps a single prepayment at 25% of outstanding (POL-PL-002)", () => {
    const d = evaluatePartPrepayment({ ...facts, outstandingPrincipal: 148_584 }, 50_000);
    expect(d.allowed).toBe(false);
    expect(d.maxAllowedAmount).toBe(37_146);
  });

  it("charges 2% on fixed-rate loans (POL-PL-004)", () => {
    expect(evaluatePartPrepayment({ ...facts, rateType: "fixed" }, 20_000).chargeRatePct).toBe(2);
  });

  it("limits prepayments per financial year", () => {
    expect(evaluatePartPrepayment({ ...facts, partPrepaymentsThisFY: 2 }, 20_000).allowed).toBe(false);
  });
});

describe("foreclosure rules", () => {
  it("floating rate is penalty-free once out of lock-in", () => {
    const d = evaluateForeclosure(facts);
    expect(d).toMatchObject({ allowed: true, penaltyFree: true, chargeRatePct: 0 });
  });

  it("fixed rate slabs: 4% → 2% → nil", () => {
    expect(evaluateForeclosure({ ...facts, rateType: "fixed", emisPaid: 20 }).chargeRatePct).toBe(4);
    expect(evaluateForeclosure({ ...facts, rateType: "fixed", emisPaid: 30 }).chargeRatePct).toBe(2);
    expect(evaluateForeclosure({ ...facts, rateType: "fixed", emisPaid: 36 }).penaltyFree).toBe(true);
    expect(evaluateForeclosure({ ...facts, rateType: "fixed", emisPaid: 20 }).penaltyFreeAfterEmis).toBe(36);
  });

  it("lock-in blocks foreclosure and says when it opens", () => {
    const d = evaluateForeclosure({ ...facts, emisPaid: 4 });
    expect(d.allowed).toBe(false);
    expect(d.allowedAfterEmis).toBe(6);
  });
});

describe("bounce charge reversal (POL-PL-008)", () => {
  it("technical failures within window are reversible", () => {
    expect(evaluateBounceReversal("technical", 30).likelyReversal).toBe(true);
  });
  it("insufficient funds can be disputed but not likely reversed", () => {
    const r = evaluateBounceReversal("customer", 30);
    expect(r.canDispute).toBe(true);
    expect(r.likelyReversal).toBe(false);
  });
  it("outside 90 days cannot be disputed", () => {
    expect(evaluateBounceReversal("technical", 120).canDispute).toBe(false);
  });
});
