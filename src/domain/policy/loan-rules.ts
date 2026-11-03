import { LOAN_POLICY } from "@/enterprise/data/policies";

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * Deterministic business-rule evaluation. Every decision returns the clause IDs
 * it relied on so answers are verifiable ("per POL-PL-001 …").
 */

export interface LoanFacts {
  rateType: "fixed" | "floating";
  emisPaid: number;
  outstandingPrincipal: number;
  partPrepaymentsThisFY: number;
}

export interface RuleFinding {
  ruleId: string;
  message: string;
}

export interface PrepaymentDecision {
  allowed: boolean;
  violations: RuleFinding[];
  chargeRatePct: number;
  gstPct: number;
  maxAllowedAmount: number;
  appliedRules: string[];
}

export function evaluatePartPrepayment(f: LoanFacts, amount: number): PrepaymentDecision {
  const P = LOAN_POLICY;
  const violations: RuleFinding[] = [];
  const maxAllowedAmount = Math.floor((f.outstandingPrincipal * P.maxPartPrepaymentPctOfOutstanding) / 100);

  if (f.emisPaid < P.lockInEmis) {
    violations.push({
      ruleId: "POL-PL-001",
      message: `Lock-in: ${P.lockInEmis} EMIs must be paid before prepayment; ${f.emisPaid} paid so far.`,
    });
  }
  if (amount < P.minPartPrepayment) {
    violations.push({ ruleId: "POL-PL-002", message: `Minimum part-prepayment is ${rupees(P.minPartPrepayment)}.` });
  }
  if (amount > maxAllowedAmount) {
    violations.push({
      ruleId: "POL-PL-002",
      message: `A single part-prepayment cannot exceed ${P.maxPartPrepaymentPctOfOutstanding}% of outstanding (${rupees(maxAllowedAmount)}).`,
    });
  }
  if (f.partPrepaymentsThisFY >= P.maxPartPrepaymentsPerFY) {
    violations.push({
      ruleId: "POL-PL-002",
      message: `Maximum of ${P.maxPartPrepaymentsPerFY} part-prepayments per financial year already used.`,
    });
  }

  const chargeRatePct = f.rateType === "floating" ? P.floatingChargePct : P.fixedPartPrepaymentChargePct;
  return {
    allowed: violations.length === 0,
    violations,
    chargeRatePct,
    gstPct: P.gstPct,
    maxAllowedAmount,
    appliedRules: ["POL-PL-001", "POL-PL-002", f.rateType === "floating" ? "POL-PL-003" : "POL-PL-004", "POL-PL-007"],
  };
}

export interface ForeclosureDecision {
  allowed: boolean;
  penaltyFree: boolean;
  chargeRatePct: number;
  gstPct: number;
  reasons: RuleFinding[];
  /** EMI count after which foreclosure becomes allowed / penalty-free (if not already). */
  allowedAfterEmis?: number;
  penaltyFreeAfterEmis?: number;
  appliedRules: string[];
}

export function evaluateForeclosure(f: LoanFacts): ForeclosureDecision {
  const P = LOAN_POLICY;
  const reasons: RuleFinding[] = [];
  const inLockIn = f.emisPaid < P.lockInEmis;
  if (inLockIn) {
    reasons.push({
      ruleId: "POL-PL-001",
      message: `Foreclosure is available after ${P.lockInEmis} EMIs; ${f.emisPaid} paid so far.`,
    });
  }

  if (f.rateType === "floating") {
    reasons.push({ ruleId: "POL-PL-003", message: "Floating-rate loan: no foreclosure charges apply." });
    return {
      allowed: !inLockIn,
      penaltyFree: true,
      chargeRatePct: 0,
      gstPct: P.gstPct,
      reasons,
      allowedAfterEmis: inLockIn ? P.lockInEmis : undefined,
      appliedRules: ["POL-PL-001", "POL-PL-003"],
    };
  }

  const slab = P.fixedForeclosureSlabs.find((s) => f.emisPaid <= s.maxEmisPaid)!;
  const penaltyFreeSlab = P.fixedForeclosureSlabs.find((s) => s.chargePct === 0)!;
  const penaltyFreeAfter = (P.fixedForeclosureSlabs[P.fixedForeclosureSlabs.indexOf(penaltyFreeSlab) - 1]?.maxEmisPaid ?? 0) + 1;
  reasons.push({
    ruleId: "POL-PL-004",
    message:
      slab.chargePct === 0
        ? "Fixed-rate loan past 36 EMIs: no foreclosure charge."
        : `Fixed-rate loan with ${f.emisPaid} EMIs paid: foreclosure charge is ${slab.chargePct}% of outstanding plus GST.`,
  });
  return {
    allowed: !inLockIn,
    penaltyFree: slab.chargePct === 0,
    chargeRatePct: slab.chargePct,
    gstPct: P.gstPct,
    reasons,
    allowedAfterEmis: inLockIn ? P.lockInEmis : undefined,
    penaltyFreeAfterEmis: slab.chargePct === 0 ? undefined : penaltyFreeAfter,
    appliedRules: ["POL-PL-001", "POL-PL-004"],
  };
}

/** Bounce-charge reversal eligibility (POL-PL-008). */
export function evaluateBounceReversal(failureCategory: "customer" | "technical", daysSinceTxn: number) {
  const P = LOAN_POLICY;
  const withinWindow = daysSinceTxn <= P.disputeWindowDays;
  const reversible = failureCategory === "technical";
  return {
    canDispute: withinWindow,
    likelyReversal: withinWindow && reversible,
    reason: !withinWindow
      ? `Outside the ${P.disputeWindowDays}-day dispute window.`
      : reversible
        ? "Failure was bank-side/technical — bounce charge is eligible for reversal."
        : "Failure was due to insufficient funds — charge is generally not reversible, but a review can still be requested.",
    ruleId: "POL-PL-008",
    slaWorkingDays: P.disputeSlaWorkingDays,
  };
}
