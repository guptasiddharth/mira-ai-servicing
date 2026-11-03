import { addMonths, type ISODate } from "@/lib/dates";

/**
 * Deterministic loan maths. The LLM never does arithmetic — every number a
 * customer hears comes from these pure, unit-tested functions.
 */

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function monthlyRate(annualRatePct: number): number {
  return annualRatePct / 1200;
}

/** Standard reducing-balance EMI, rounded to the nearest rupee (industry practice). */
export function computeEmi(principal: number, annualRatePct: number, months: number): number {
  if (months <= 0) throw new Error("months must be positive");
  if (principal <= 0) return 0;
  const r = monthlyRate(annualRatePct);
  if (r === 0) return Math.round(principal / months);
  const f = Math.pow(1 + r, months);
  return Math.round((principal * r * f) / (f - 1));
}

export interface RatePeriod {
  effectiveFrom: ISODate;
  annualRate: number;
  reason: string;
}

export interface Installment {
  n: number;
  dueDate: ISODate;
  annualRate: number;
  openingBalance: number;
  emi: number;
  interest: number;
  principal: number;
  closingBalance: number;
  /** True when a rate reset caused the EMI to be recalculated at this installment. */
  rateReset: boolean;
}

export function rateOn(periods: RatePeriod[], date: ISODate): RatePeriod {
  const sorted = [...periods].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let current = sorted[0];
  for (const p of sorted) if (p.effectiveFrom <= date) current = p;
  return current;
}

/**
 * Builds a full repayment schedule. For floating-rate loans the EMI is
 * recalculated on the outstanding balance over the remaining tenure whenever
 * the applicable rate changes (tenure held constant — see policy POL-PL-005).
 */
export function buildSchedule(input: {
  principal: number;
  tenureMonths: number;
  firstDueDate: ISODate;
  ratePeriods: RatePeriod[];
}): Installment[] {
  const { principal, tenureMonths, firstDueDate, ratePeriods } = input;
  const rows: Installment[] = [];
  let balance = principal;
  let rate = rateOn(ratePeriods, firstDueDate).annualRate;
  let emi = computeEmi(principal, rate, tenureMonths);

  for (let n = 1; n <= tenureMonths && balance > 0.005; n++) {
    const dueDate = addMonths(firstDueDate, n - 1);
    const applicable = rateOn(ratePeriods, dueDate).annualRate;
    const rateReset = applicable !== rate;
    if (rateReset) {
      rate = applicable;
      emi = computeEmi(balance, rate, tenureMonths - n + 1);
    }
    const interest = round2(balance * monthlyRate(rate));
    const isLast = n === tenureMonths || emi - interest >= balance;
    const principalPart = isLast ? round2(balance) : round2(emi - interest);
    const closing = round2(balance - principalPart);
    rows.push({
      n,
      dueDate,
      annualRate: rate,
      openingBalance: round2(balance),
      emi: isLast ? round2(principalPart + interest) : emi,
      interest,
      principal: principalPart,
      closingBalance: closing,
      rateReset,
    });
    balance = closing;
  }
  return rows;
}

export interface Payoff {
  months: number;
  totalInterest: number;
  totalPaid: number;
}

/** Month-end outstanding balances (index 0 = today) when paying a fixed EMI — for charts. */
export function balanceSeries(balance: number, annualRatePct: number, emi: number): number[] {
  const r = monthlyRate(annualRatePct);
  const out = [round2(balance)];
  let b = balance;
  while (b > 0.005 && out.length < 1200) {
    b = Math.max(0, round2(b - (emi - round2(b * r))));
    out.push(b);
  }
  return out;
}

/** Projects how long a balance takes to clear at a fixed EMI, and the interest paid along the way. */
export function projectPayoff(balance: number, annualRatePct: number, emi: number): Payoff {
  const r = monthlyRate(annualRatePct);
  if (balance <= 0) return { months: 0, totalInterest: 0, totalPaid: 0 };
  if (emi <= balance * r) throw new Error("EMI does not cover monthly interest");
  let months = 0;
  let totalInterest = 0;
  let totalPaid = 0;
  let b = balance;
  while (b > 0.005 && months < 1200) {
    const interest = round2(b * r);
    const principalPart = Math.min(b, emi - interest);
    totalInterest += interest;
    totalPaid += principalPart + interest;
    b = round2(b - principalPart);
    months++;
  }
  return { months, totalInterest: round2(totalInterest), totalPaid: round2(totalPaid) };
}
