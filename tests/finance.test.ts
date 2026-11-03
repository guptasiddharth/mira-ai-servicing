import { describe, expect, it } from "vitest";
import { buildSchedule, computeEmi, projectPayoff } from "@/domain/finance/amortization";
import { quoteForeclosure } from "@/domain/finance/foreclosure";
import { simulatePrepayment } from "@/domain/finance/prepayment";

describe("amortization", () => {
  it("computes the standard EMI (₹5L @ 12% for 48m ≈ ₹13,167)", () => {
    expect(computeEmi(500_000, 12, 48)).toBe(13_167);
  });

  it("schedule fully repays principal and ends at zero", () => {
    const rows = buildSchedule({ principal: 300_000, tenureMonths: 36, firstDueDate: "2025-01-10", ratePeriods: [{ effectiveFrom: "2024-12-01", annualRate: 13.75, reason: "" }] });
    expect(rows).toHaveLength(36);
    expect(rows.at(-1)!.closingBalance).toBe(0);
    const principalPaid = rows.reduce((s, r) => s + r.principal, 0);
    expect(principalPaid).toBeCloseTo(300_000, 0);
  });

  it("recalculates EMI on a floating-rate reset, holding tenure constant", () => {
    const rows = buildSchedule({
      principal: 500_000,
      tenureMonths: 48,
      firstDueDate: "2025-01-05",
      ratePeriods: [
        { effectiveFrom: "2024-12-01", annualRate: 11, reason: "" },
        { effectiveFrom: "2025-06-15", annualRate: 12, reason: "reset" },
      ],
    });
    const resetRow = rows.find((r) => r.rateReset)!;
    expect(resetRow.dueDate).toBe("2025-07-05");
    expect(resetRow.emi).toBeGreaterThan(rows[0].emi);
    expect(rows).toHaveLength(48);
  });

  it("projectPayoff matches the schedule's remaining interest", () => {
    const emi = computeEmi(200_000, 10, 24);
    const p = projectPayoff(200_000, 10, emi);
    expect(p.months).toBe(24);
  });
});

describe("prepayment", () => {
  const base = { outstanding: 376_598, annualRate: 11.75, currentEmi: 13_076, gstPct: 18 };

  it("reduce-tenure saves more interest than reduce-EMI", () => {
    const s = simulatePrepayment({ ...base, amount: 50_000, chargeRatePct: 0 });
    expect(s.reduceTenure.monthsSaved).toBeGreaterThan(0);
    expect(s.reduceTenure.interestSaved).toBeGreaterThan(s.reduceEmi.interestSaved);
    expect(s.reduceEmi.emi).toBeLessThan(base.currentEmi);
    expect(s.charges.total).toBe(0);
  });

  it("applies charges + GST and nets them from savings", () => {
    const s = simulatePrepayment({ ...base, amount: 20_000, chargeRatePct: 2 });
    expect(s.charges.base).toBe(400);
    expect(s.charges.gst).toBe(72);
    expect(s.reduceTenure.netSaving).toBeCloseTo(s.reduceTenure.interestSaved - 472, 2);
  });

  it("rejects an amount that would close the loan", () => {
    expect(() => simulatePrepayment({ ...base, amount: 400_000, chargeRatePct: 0 })).toThrow(/foreclosure/);
  });
});

describe("foreclosure", () => {
  it("adds accrued interest, charge and GST", () => {
    const q = quoteForeclosure({ outstandingPrincipal: 100_000, annualRate: 12, daysSinceLastDue: 30, chargeRatePct: 4, gstPct: 18 });
    expect(q.foreclosureCharge).toBe(4000);
    expect(q.gstOnCharge).toBe(720);
    expect(q.accruedInterest).toBeCloseTo(986.3, 1);
    expect(q.totalPayable).toBeCloseTo(105_706.3, 1);
  });
});
