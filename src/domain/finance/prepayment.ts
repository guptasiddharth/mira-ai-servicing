import { computeEmi, projectPayoff, round2 } from "./amortization";

export interface PrepaymentInput {
  outstanding: number;
  annualRate: number;
  currentEmi: number;
  amount: number;
  /** Charge as % of the prepaid amount (from policy). */
  chargeRatePct: number;
  gstPct: number;
}

export interface PrepaymentOption {
  emi: number;
  months: number;
  totalInterest: number;
  interestSaved: number;
  netSaving: number;
}

export interface PrepaymentSimulation {
  baseline: { emi: number; months: number; totalInterest: number };
  newOutstanding: number;
  charges: { base: number; gst: number; total: number };
  reduceTenure: PrepaymentOption & { monthsSaved: number };
  reduceEmi: PrepaymentOption & { emiReduction: number };
}

/**
 * Compares the two standard ways a part-prepayment can be applied:
 *  - reduce tenure (EMI unchanged, loan closes earlier)  — maximises interest saved
 *  - reduce EMI    (tenure unchanged, lower monthly outgo)
 */
export function simulatePrepayment(i: PrepaymentInput): PrepaymentSimulation {
  if (i.amount <= 0) throw new Error("Prepayment amount must be positive");
  if (i.amount >= i.outstanding) throw new Error("Amount covers the full outstanding — this is a foreclosure");

  const baseline = projectPayoff(i.outstanding, i.annualRate, i.currentEmi);
  const newOutstanding = round2(i.outstanding - i.amount);

  const chargeBase = round2((i.amount * i.chargeRatePct) / 100);
  const chargeGst = round2((chargeBase * i.gstPct) / 100);
  const chargeTotal = round2(chargeBase + chargeGst);

  const tenure = projectPayoff(newOutstanding, i.annualRate, i.currentEmi);
  const tenureSaved = round2(baseline.totalInterest - tenure.totalInterest);

  const newEmi = computeEmi(newOutstanding, i.annualRate, baseline.months);
  const emiPath = projectPayoff(newOutstanding, i.annualRate, newEmi);
  const emiSaved = round2(baseline.totalInterest - emiPath.totalInterest);

  return {
    baseline: { emi: i.currentEmi, months: baseline.months, totalInterest: baseline.totalInterest },
    newOutstanding,
    charges: { base: chargeBase, gst: chargeGst, total: chargeTotal },
    reduceTenure: {
      emi: i.currentEmi,
      months: tenure.months,
      monthsSaved: baseline.months - tenure.months,
      totalInterest: tenure.totalInterest,
      interestSaved: tenureSaved,
      netSaving: round2(tenureSaved - chargeTotal),
    },
    reduceEmi: {
      emi: newEmi,
      emiReduction: i.currentEmi - newEmi,
      months: emiPath.months,
      totalInterest: emiPath.totalInterest,
      interestSaved: emiSaved,
      netSaving: round2(emiSaved - chargeTotal),
    },
  };
}
