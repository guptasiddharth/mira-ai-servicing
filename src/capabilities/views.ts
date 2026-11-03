/**
 * Generative-UI view contracts for the capability tools. Numbers are raw
 * (rupees, %, months) — the client formats them. Type-only: imported by
 * server tools (to build) and client widgets (to render).
 */

export interface EmiChangeView {
  loanId: string;
  rateType: "fixed" | "floating";
  previous: { n: number; dueDate: string; emi: number; rate: number };
  current: { n: number; dueDate: string; emi: number; rate: number };
  delta: number;
  deltaPct: number;
  reset?: { effectiveFrom: string; reason: string; outstandingAtReset: number; remainingMonths: number };
  history: { n: number; label: string; emi: number; rate: number }[];
  nextEmi?: { dueDate: string; emi: number };
}

export interface PrepaymentView {
  loanId: string;
  amount: number;
  eligible: boolean;
  violations: { ruleId: string; message: string }[];
  maxAllowed: number;
  rate: number;
  charges: number;
  baseline: { emi: number; months: number; interest: number; outstanding: number };
  reduceTenure: { emi: number; months: number; monthsSaved: number; interestSaved: number; netSaving: number };
  reduceEmi: { emi: number; emiReduction: number; months: number; interestSaved: number; netSaving: number };
  series: { baseline: number[]; reduceTenure: number[]; reduceEmi: number[] };
  startDate: string;
}

export interface PaymentsView {
  period: string;
  attempts: number;
  failed: number;
  chargesTotal: number;
  items: {
    id: string;
    date: string;
    installment: number;
    amount: number;
    channel: string;
    status: "success" | "failed" | "pending";
    failureReason?: string;
    failureCode?: string;
    category?: "customer" | "technical";
    charge?: number;
    recoveredOn?: string;
    recoveredVia?: string;
    canDispute?: boolean;
    reversalLikely?: boolean;
  }[];
}

export interface ForeclosureView {
  loanId: string;
  rateType: "fixed" | "floating";
  emisPaid: number;
  tenure: number;
  allowedNow: boolean;
  penaltyFree: boolean;
  chargePct: number;
  allowedFrom?: { emi: number; date: string };
  penaltyFreeFrom?: { emi: number; date: string };
  checks: { label: string; ok: boolean; ruleId: string; note: string }[];
  quote: { principal: number; interest: number; charge: number; gst: number; total: number };
  futureInterest: number;
  netBenefit: number;
}

export interface LoanOverviewView {
  loanId: string;
  product: string;
  rateType: "fixed" | "floating";
  rate: number;
  emi: number;
  principal: number;
  outstanding: number;
  emisPaid: number;
  tenure: number;
  nextDue?: { date: string; amount: number };
  rateHistory: { from: string; rate: number; reason: string }[];
  autoDebit: string;
}

export interface ScheduleView {
  loanId: string;
  rows: { n: number; date: string; emi: number; principal: number; interest: number; balance: number; status: "paid" | "upcoming" }[];
}

export interface PolicyView {
  clauses: { id: string; title: string; text: string }[];
}

export interface ServiceRequestsView {
  items: { reference: string; type: string; status: string; summary: string; raised: string; expectedBy: string }[];
}

export interface CardSummaryView {
  cardId: string;
  variant: string;
  last4: string;
  holder: string;
  status: "active" | "blocked";
  limit: number;
  available: number;
  outstanding: number;
  minDue: number;
  dueDate: string;
  statementDate: string;
  points: number;
}

export interface CardTransactionsView {
  last4: string;
  days: number;
  items: { id: string; date: string; time: string; merchant: string; category: string; amount: number; status: string; duplicate: boolean }[];
}

export type CapabilityView =
  | { kind: "emi_change"; data: EmiChangeView }
  | { kind: "prepayment"; data: PrepaymentView }
  | { kind: "payments"; data: PaymentsView }
  | { kind: "foreclosure"; data: ForeclosureView }
  | { kind: "loan_overview"; data: LoanOverviewView }
  | { kind: "schedule"; data: ScheduleView }
  | { kind: "policy"; data: PolicyView }
  | { kind: "service_requests"; data: ServiceRequestsView }
  | { kind: "card_summary"; data: CardSummaryView }
  | { kind: "card_transactions"; data: CardTransactionsView };
