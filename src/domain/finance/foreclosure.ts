import { monthlyRate, round2 } from "./amortization";

export interface ForeclosureQuoteInput {
  outstandingPrincipal: number;
  annualRate: number;
  /** Days elapsed since the last EMI due date — interest accrues daily on the outstanding. */
  daysSinceLastDue: number;
  chargeRatePct: number;
  gstPct: number;
  pendingCharges?: number;
}

export interface ForeclosureQuote {
  outstandingPrincipal: number;
  accruedInterest: number;
  foreclosureCharge: number;
  gstOnCharge: number;
  pendingCharges: number;
  totalPayable: number;
}

export function quoteForeclosure(i: ForeclosureQuoteInput): ForeclosureQuote {
  const dailyRate = (monthlyRate(i.annualRate) * 12) / 365;
  const accruedInterest = round2(i.outstandingPrincipal * dailyRate * Math.max(0, i.daysSinceLastDue));
  const foreclosureCharge = round2((i.outstandingPrincipal * i.chargeRatePct) / 100);
  const gstOnCharge = round2((foreclosureCharge * i.gstPct) / 100);
  const pendingCharges = round2(i.pendingCharges ?? 0);
  return {
    outstandingPrincipal: round2(i.outstandingPrincipal),
    accruedInterest,
    foreclosureCharge,
    gstOnCharge,
    pendingCharges,
    totalPayable: round2(i.outstandingPrincipal + accruedInterest + foreclosureCharge + gstOnCharge + pendingCharges),
  };
}
