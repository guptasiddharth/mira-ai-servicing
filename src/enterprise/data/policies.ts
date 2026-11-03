/**
 * Policy Knowledge system — Kestrel Finance (fictional) product policy book.
 *
 * Machine-readable parameters (LOAN_POLICY / CARD_POLICY) and the human-readable
 * clauses are generated from ONE source, so the rules engine and the text the
 * assistant cites can never disagree.
 */

export const LOAN_POLICY = {
  version: "PL-3.2",
  effectiveFrom: "2026-04-01",
  lockInEmis: 6,
  minPartPrepayment: 10_000,
  maxPartPrepaymentPctOfOutstanding: 25,
  maxPartPrepaymentsPerFY: 2,
  floatingChargePct: 0,
  fixedPartPrepaymentChargePct: 2,
  fixedForeclosureSlabs: [
    { maxEmisPaid: 23, chargePct: 4 },
    { maxEmisPaid: 35, chargePct: 2 },
    { maxEmisPaid: Infinity, chargePct: 0 },
  ],
  gstPct: 18,
  bounceCharge: 500,
  disputeWindowDays: 90,
  disputeSlaWorkingDays: 7,
  rateResetNoticeDays: 30,
} as const;

export const CARD_POLICY = {
  version: "CC-2.4",
  effectiveFrom: "2026-04-01",
  disputeWindowDays: 60,
  disputeSlaDays: 30,
  provisionalCreditMaxAmount: 10_000,
  replacementFee: 200,
  replacementDeliveryDays: "5–7",
  gstPct: 18,
  monthlyInterestPct: 3.5,
} as const;

export interface PolicyClause {
  id: string;
  product: "personal_loan" | "credit_card" | "general";
  title: string;
  text: string;
  version: string;
  tags: string[];
}

const L = LOAN_POLICY;
const C = CARD_POLICY;

export const POLICY_CLAUSES: PolicyClause[] = [
  {
    id: "POL-PL-001",
    product: "personal_loan",
    title: "Lock-in period for prepayment and foreclosure",
    text: `Part-prepayment and foreclosure are permitted only after the borrower has paid ${L.lockInEmis} EMIs. Requests received before that are declined.`,
    version: L.version,
    tags: ["prepayment", "foreclosure", "lock-in", "eligibility"],
  },
  {
    id: "POL-PL-002",
    product: "personal_loan",
    title: "Part-prepayment limits",
    text: `Minimum part-prepayment is ₹${L.minPartPrepayment.toLocaleString("en-IN")}. A single part-prepayment may not exceed ${L.maxPartPrepaymentPctOfOutstanding}% of principal outstanding, and at most ${L.maxPartPrepaymentsPerFY} part-prepayments are allowed per financial year (April–March). Larger amounts must be processed as foreclosure.`,
    version: L.version,
    tags: ["prepayment", "limits", "part payment"],
  },
  {
    id: "POL-PL-003",
    product: "personal_loan",
    title: "Charges on floating-rate loans",
    text: "No prepayment or foreclosure charges apply to floating-rate personal loans availed by individual borrowers, in line with regulatory guidance.",
    version: L.version,
    tags: ["prepayment", "foreclosure", "charges", "floating", "penalty"],
  },
  {
    id: "POL-PL-004",
    product: "personal_loan",
    title: "Charges on fixed-rate loans",
    text: `Fixed-rate loans: part-prepayment attracts ${L.fixedPartPrepaymentChargePct}% of the amount prepaid. Foreclosure attracts 4% of principal outstanding if fewer than 24 EMIs are paid, 2% if 24–35 EMIs are paid, and nil after 36 EMIs. GST at ${L.gstPct}% applies on all charges.`,
    version: L.version,
    tags: ["prepayment", "foreclosure", "charges", "fixed", "penalty", "gst"],
  },
  {
    id: "POL-PL-005",
    product: "personal_loan",
    title: "Floating rate resets and EMI recalculation",
    text: `Floating-rate loans are linked to the Kestrel Lending Rate (KLR) and reset quarterly. On a reset the EMI is recalculated on the outstanding principal for the remaining tenure (tenure is held constant). Customers are notified at least ${L.rateResetNoticeDays} days before the revised EMI is debited.`,
    version: L.version,
    tags: ["emi", "rate", "reset", "floating", "increase", "change", "klr"],
  },
  {
    id: "POL-PL-006",
    product: "personal_loan",
    title: "Dishonoured EMI (bounce) charges",
    text: `A bounce charge of ₹${L.bounceCharge} plus GST is levied for every EMI presentation that fails. Customers may pay the overdue EMI through UPI or net banking to avoid further charges.`,
    version: L.version,
    tags: ["bounce", "failed", "payment", "charges", "nach", "mandate"],
  },
  {
    id: "POL-PL-007",
    product: "personal_loan",
    title: "How part-prepayments are applied",
    text: "By default a part-prepayment reduces the remaining tenure and keeps the EMI unchanged. The customer may instead choose to keep the tenure and reduce the EMI.",
    version: L.version,
    tags: ["prepayment", "tenure", "emi", "options"],
  },
  {
    id: "POL-PL-008",
    product: "personal_loan",
    title: "Payment disputes and charge reversals",
    text: `Payment disputes can be raised within ${L.disputeWindowDays} days of the transaction. Where an EMI failure is attributable to a bank-side or technical error (not insufficient funds), the bounce charge is reversed. Disputes are resolved within ${L.disputeSlaWorkingDays} working days.`,
    version: L.version,
    tags: ["dispute", "reversal", "bounce", "technical", "failed", "refund"],
  },
  {
    id: "POL-PL-009",
    product: "personal_loan",
    title: "Statements and certificates",
    text: "Repayment statements and interest certificates are free and are emailed to the registered address within 24 hours of request.",
    version: L.version,
    tags: ["statement", "certificate", "documents"],
  },
  {
    id: "POL-CC-001",
    product: "credit_card",
    title: "Card transaction disputes",
    text: `Card transaction disputes must be raised within ${C.disputeWindowDays} days of the transaction date. For disputed amounts up to ₹${C.provisionalCreditMaxAmount.toLocaleString("en-IN")} a provisional credit is applied while the dispute is investigated. Resolution within ${C.disputeSlaDays} days.`,
    version: C.version,
    tags: ["dispute", "card", "chargeback", "duplicate", "fraud", "provisional credit"],
  },
  {
    id: "POL-CC-002",
    product: "credit_card",
    title: "Blocking and replacing a card",
    text: `Cards can be blocked instantly at no cost. A replacement card costs ₹${C.replacementFee} plus GST and is delivered in ${C.replacementDeliveryDays} working days. Cards blocked due to suspected fraud are replaced free of charge.`,
    version: C.version,
    tags: ["block", "lost", "stolen", "replacement", "fraud", "card"],
  },
  {
    id: "POL-CC-003",
    product: "credit_card",
    title: "Interest on revolving balance",
    text: `Paying less than the total amount due attracts interest of ${C.monthlyInterestPct}% per month on the revolving balance from the transaction date. Paying the minimum due keeps the account in good standing but interest still applies.`,
    version: C.version,
    tags: ["interest", "minimum due", "revolving", "card", "finance charges"],
  },
  {
    id: "POL-GN-001",
    product: "general",
    title: "Service request turnaround",
    text: "Service requests are acknowledged instantly with a reference number. Standard requests are resolved within 3 working days; escalations are assigned to a senior specialist within 4 business hours.",
    version: "GN-1.0",
    tags: ["service", "request", "ticket", "escalation", "sla"],
  },
];
