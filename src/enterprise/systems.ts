import { buildSchedule, rateOn, type Installment } from "@/domain/finance/amortization";
import { POLICY_CLAUSES, type PolicyClause } from "@/enterprise/data/policies";
import { remote, remoteWrite } from "@/enterprise/simulator";
import type {
  Card,
  CardTransaction,
  Customer,
  EnterpriseDatabase,
  Interaction,
  LoanRecord,
  Payment,
  ServiceRequest,
  ServiceRequestType,
} from "@/enterprise/types";
import { addDays, type ISODate } from "@/lib/dates";

/**
 * Remote APIs of the customer's five (+1) systems of record. Each call goes
 * through `remote()` so it pays realistic latency and can fail. These are the
 * only functions that touch the database — the platform reaches them through
 * the Integration Gateway.
 */

// ───────────────────────────── Customer CRM ─────────────────────────────
export const crmApi = {
  getCustomer: (customerId: string, signal?: AbortSignal) =>
    remote("crm", (d) => d.customers.find((c) => c.id === customerId) ?? null, signal) as Promise<Customer | null>,

  listInteractions: (customerId: string, limit = 5, signal?: AbortSignal) =>
    remote(
      "crm",
      (d) => d.interactions.filter((i) => i.customerId === customerId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit),
      signal,
    ) as Promise<Interaction[]>,

  logInteraction: (entry: Omit<Interaction, "id">, signal?: AbortSignal) =>
    remoteWrite(
      "crm",
      (d) => {
        const rec = { ...entry, id: `INT-${9000 + d.interactions.length + 1}` };
        d.interactions.push(rec);
        return rec;
      },
      signal,
    ),
};

// ──────────────────────────── Loan Management ───────────────────────────
export interface LoanView extends LoanRecord {
  currentRate: number;
  currentEmi: number;
  emisPaid: number;
  emisRemaining: number;
  outstandingPrincipal: number;
  lastPaidInstallment: Installment | null;
  nextInstallment: Installment | null;
  schedule: Installment[];
}

function toLoanView(d: EnterpriseDatabase, loan: LoanRecord): LoanView {
  const schedule = buildSchedule({
    principal: loan.principal,
    tenureMonths: loan.tenureMonths,
    firstDueDate: loan.firstDueDate,
    ratePeriods: loan.ratePeriods,
  });
  const paidNos = new Set(d.payments.filter((p) => p.loanId === loan.id && p.status === "success").map((p) => p.installmentNo));
  const emisPaid = paidNos.size;
  const last = emisPaid > 0 ? schedule[emisPaid - 1] : null;
  const next = schedule[emisPaid] ?? null;
  return {
    ...loan,
    currentRate: rateOn(loan.ratePeriods, d.asOf).annualRate,
    currentEmi: next?.emi ?? last?.emi ?? 0,
    emisPaid,
    emisRemaining: schedule.length - emisPaid,
    outstandingPrincipal: last ? last.closingBalance : loan.principal,
    lastPaidInstallment: last,
    nextInstallment: next,
    schedule,
  };
}

export const loansApi = {
  listLoans: (customerId: string, signal?: AbortSignal) =>
    remote("loans", (d) => d.loans.filter((l) => l.customerId === customerId).map((l) => toLoanView(d, l)), signal),

  getLoan: (loanId: string, signal?: AbortSignal) =>
    remote(
      "loans",
      (d) => {
        const l = d.loans.find((x) => x.id === loanId);
        return l ? toLoanView(d, l) : null;
      },
      signal,
    ),

  registerPartPrepayment: (loanId: string, amount: number, requestId: string, date: ISODate, signal?: AbortSignal) =>
    remoteWrite(
      "loans",
      (d) => {
        const l = d.loans.find((x) => x.id === loanId);
        if (!l) throw new Error("Loan not found");
        l.partPrepayments.push({ date, amount, requestId });
        return { loanId, amount, requestId };
      },
      signal,
    ),
};

// ─────────────────────────────── Payments ───────────────────────────────
export const paymentsApi = {
  listPayments: (
    customerId: string,
    filter: { loanId?: string; since?: ISODate; status?: Payment["status"] } = {},
    signal?: AbortSignal,
  ) =>
    remote(
      "payments",
      (d) =>
        d.payments
          .filter(
            (p) =>
              p.customerId === customerId &&
              (!filter.loanId || p.loanId === filter.loanId) &&
              (!filter.since || p.attemptDate >= filter.since) &&
              (!filter.status || p.status === filter.status),
          )
          .sort((a, b) => b.attemptDate.localeCompare(a.attemptDate)),
      signal,
    ),

  getPayment: (paymentId: string, signal?: AbortSignal) =>
    remote("payments", (d) => d.payments.find((p) => p.id === paymentId) ?? null, signal),
};

// ─────────────────────────── Policy Knowledge ───────────────────────────
const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9₹%\s-]/g, " ").split(/\s+/).filter((t) => t.length > 2);

export const policyApi = {
  search: (query: string, product?: PolicyClause["product"], limit = 3, signal?: AbortSignal) =>
    remote(
      "policy",
      () => {
        const q = tokenize(query);
        return POLICY_CLAUSES.filter((c) => !product || c.product === product || c.product === "general")
          .map((c) => {
            const title = tokenize(c.title);
            const text = tokenize(c.text);
            const tags = c.tags.flatMap(tokenize);
            const score = q.reduce(
              (s, t) =>
                s +
                (tags.some((x) => x.startsWith(t) || t.startsWith(x)) ? 3 : 0) +
                (title.some((x) => x.startsWith(t)) ? 2 : 0) +
                text.filter((x) => x.startsWith(t)).length * 0.5,
              0,
            );
            return { clause: c, score };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((r) => r.clause);
      },
      signal,
    ),

  getClauses: (ids: string[], signal?: AbortSignal) =>
    remote("policy", () => POLICY_CLAUSES.filter((c) => ids.includes(c.id)), signal),
};

// ────────────────────────── Service Operations ──────────────────────────
const SLA_DAYS: Record<ServiceRequestType, number> = {
  PREPAYMENT: 2,
  PAYMENT_DISPUTE: 9,
  STATEMENT: 1,
  GENERAL: 3,
  CARD_DISPUTE: 30,
  CARD_BLOCK: 0,
};

export const serviceOpsApi = {
  createRequest: (
    input: Pick<ServiceRequest, "customerId" | "type" | "summary" | "details" | "priority"> & { idempotencyKey: string },
    signal?: AbortSignal,
  ) =>
    remoteWrite(
      "service_ops",
      (d) => {
        const existing = d.serviceRequests.find((r) => r.details.idempotencyKey === input.idempotencyKey);
        if (existing) return existing;
        const sr: ServiceRequest = {
          id: `SR-${(250_000 + d.serviceRequests.length + 1).toString()}`,
          customerId: input.customerId,
          type: input.type,
          status: input.type === "CARD_BLOCK" ? "resolved" : "open",
          priority: input.priority,
          createdAt: new Date().toISOString(),
          slaDueDate: addDays(d.asOf, SLA_DAYS[input.type]),
          summary: input.summary,
          details: { ...input.details, idempotencyKey: input.idempotencyKey },
          channel: "assistant",
        };
        d.serviceRequests.push(sr);
        return sr;
      },
      signal,
    ),

  listRequests: (customerId: string, signal?: AbortSignal) =>
    remote(
      "service_ops",
      (d) => d.serviceRequests.filter((r) => r.customerId === customerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      signal,
    ),
};

// ───────────────────────────── Card Platform ────────────────────────────
export const cardsApi = {
  listCards: (customerId: string, signal?: AbortSignal) =>
    remote("cards", (d) => d.cards.filter((c) => c.customerId === customerId), signal) as Promise<Card[]>,

  listTransactions: (cardId: string, sinceDays: number, signal?: AbortSignal) =>
    remote(
      "cards",
      (d) =>
        d.cardTransactions
          .filter((t) => t.cardId === cardId && t.date >= addDays(d.asOf, -sinceDays))
          .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)),
      signal,
    ) as Promise<CardTransaction[]>,

  getTransaction: (txnId: string, signal?: AbortSignal) =>
    remote("cards", (d) => d.cardTransactions.find((t) => t.id === txnId) ?? null, signal),

  markDisputed: (txnId: string, signal?: AbortSignal) =>
    remoteWrite(
      "cards",
      (d) => {
        const t = d.cardTransactions.find((x) => x.id === txnId);
        if (t) t.status = "disputed";
        return t ?? null;
      },
      signal,
    ),

  blockCard: (cardId: string, signal?: AbortSignal) =>
    remoteWrite(
      "cards",
      (d) => {
        const c = d.cards.find((x) => x.id === cardId);
        if (c) c.status = "blocked";
        return c ?? null;
      },
      signal,
    ),
};
