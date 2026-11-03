import type { SystemId } from "@/enterprise/simulator";
import { cardsApi, crmApi, loansApi, paymentsApi, policyApi, serviceOpsApi } from "@/enterprise/systems";
import { addMonths, today } from "@/lib/dates";
import { AccessDeniedError, NotFoundError } from "@/platform/errors";
import { IntegrationGateway, type SystemPolicy } from "@/platform/integrations/gateway";
import type { ToolContext } from "@/platform/tools/types";

/**
 * Integration adapters: typed, cached, resilient access to each system of
 * record via the platform gateway. Policies reflect each system's SLOs.
 */

const POLICIES: Record<SystemId, SystemPolicy> = {
  crm: { timeoutMs: 800, retries: 2, backoffBaseMs: 60, cacheTtlMs: 120_000, breakerThreshold: 5, breakerCooldownMs: 15_000 },
  loans: { timeoutMs: 1_500, retries: 2, backoffBaseMs: 80, cacheTtlMs: 30_000, breakerThreshold: 5, breakerCooldownMs: 15_000 },
  payments: { timeoutMs: 2_200, retries: 2, backoffBaseMs: 120, cacheTtlMs: 30_000, breakerThreshold: 5, breakerCooldownMs: 15_000 },
  policy: { timeoutMs: 600, retries: 1, backoffBaseMs: 40, cacheTtlMs: 600_000, breakerThreshold: 5, breakerCooldownMs: 10_000 },
  service_ops: { timeoutMs: 1_800, retries: 2, backoffBaseMs: 100, cacheTtlMs: 5_000, breakerThreshold: 5, breakerCooldownMs: 15_000 },
  cards: { timeoutMs: 1_200, retries: 2, backoffBaseMs: 80, cacheTtlMs: 30_000, breakerThreshold: 5, breakerCooldownMs: 15_000 },
};

const g = globalThis as unknown as { __kestrelGateway?: IntegrationGateway };
export const gateway: IntegrationGateway = (g.__kestrelGateway ??= new IntegrationGateway(POLICIES));

/** Cache tag for everything belonging to one customer — invalidated after any write. */
export const customerTag = (customerId: string) => `customer:${customerId}`;

export const data = {
  customer: async (customerId: string) => {
    const c = await gateway.read("crm", "getCustomer", (s) => crmApi.getCustomer(customerId, s), { cacheKey: `customer:${customerId}`, tags: [customerTag(customerId)] });
    if (!c) throw new NotFoundError("Customer not found");
    return c;
  },
  interactions: (customerId: string) =>
    gateway.read("crm", "listInteractions", (s) => crmApi.listInteractions(customerId, 5, s), { cacheKey: `interactions:${customerId}`, tags: [customerTag(customerId)] }),
  loans: (customerId: string) =>
    gateway.read("loans", "listLoans", (s) => loansApi.listLoans(customerId, s), { cacheKey: `loans:${customerId}`, tags: [customerTag(customerId)] }),
  payments: (customerId: string, months = 12) => {
    const since = addMonths(today(), -months);
    return gateway.read("payments", "listPayments", (s) => paymentsApi.listPayments(customerId, { since }, s), {
      cacheKey: `payments:${customerId}:${since}`,
      tags: [customerTag(customerId)],
    });
  },
  serviceRequests: (customerId: string) =>
    gateway.read("service_ops", "listRequests", (s) => serviceOpsApi.listRequests(customerId, s), { cacheKey: `srs:${customerId}`, tags: [customerTag(customerId)] }),
  policySearch: (query: string, product?: "personal_loan" | "credit_card") =>
    gateway.read("policy", "search", (s) => policyApi.search(query, product, 3, s), { cacheKey: `search:${product}:${query.toLowerCase()}` }),
  policyClauses: (ids: string[]) =>
    gateway.read("policy", "getClauses", (s) => policyApi.getClauses(ids, s), { cacheKey: `clauses:${[...ids].sort().join(",")}` }),
  cards: (customerId: string) =>
    gateway.read("cards", "listCards", (s) => cardsApi.listCards(customerId, s), { cacheKey: `cards:${customerId}`, tags: [customerTag(customerId)] }),
  cardTransactions: (customerId: string, cardId: string, days: number) =>
    gateway.read("cards", "listTransactions", (s) => cardsApi.listTransactions(cardId, days, s), {
      cacheKey: `txns:${cardId}:${days}`,
      tags: [customerTag(customerId)],
    }),
};

/**
 * Object-level authorisation: resolves the loan the customer is talking about
 * and guarantees it belongs to the authenticated customer.
 */
export async function resolveLoan(ctx: ToolContext, loanId?: string) {
  const loans = await data.loans(ctx.customerId);
  if (loanId) {
    const loan = loans.find((l) => l.id.toLowerCase() === loanId.toLowerCase());
    if (!loan) throw new AccessDeniedError(`Loan ${loanId} is not linked to this customer.`);
    return loan;
  }
  const active = loans.filter((l) => l.status === "active");
  if (active.length === 0) throw new NotFoundError("The customer has no active loans.");
  return active[0];
}

export async function resolveCard(ctx: ToolContext, cardId?: string) {
  const cards = await data.cards(ctx.customerId);
  if (cardId) {
    const card = cards.find((c) => c.id.toLowerCase() === cardId.toLowerCase() || c.last4 === cardId);
    if (!card) throw new AccessDeniedError(`Card ${cardId} is not linked to this customer.`);
    return card;
  }
  if (cards.length === 0) throw new NotFoundError("The customer has no credit cards.");
  return cards[0];
}
