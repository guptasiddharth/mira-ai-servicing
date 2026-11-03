import { z } from "zod";
import { customerTag, data, gateway, resolveCard } from "@/capabilities/data";
import { logInteraction } from "@/capabilities/tools/shared";
import { CARD_POLICY } from "@/enterprise/data/policies";
import { cardsApi, serviceOpsApi } from "@/enterprise/systems";
import type { CardTransaction } from "@/enterprise/types";
import { daysBetween, today } from "@/lib/dates";
import { formatDate, inr } from "@/lib/format";
import { BusinessRuleError, NotFoundError } from "@/platform/errors";
import { defineAction, defineTool } from "@/platform/tools/types";

/**
 * Credit-card servicing capabilities — the "second use case". Only these
 * card-specific tools and the Card Platform adapter are new; runtime, voice,
 * gateway, actions, security, observability and UI are reused as-is.
 */

const cardIdParam = z.string().optional().describe("Card ID or last 4 digits. Omit to use the customer's card.");

/** Deterministic duplicate detection: same merchant + amount within 10 minutes. */
export function flagDuplicates(txns: CardTransaction[]): Set<string> {
  const flagged = new Set<string>();
  const minutes = (t: CardTransaction) => new Date(`${t.date}T${t.time}:00Z`).getTime() / 60000;
  for (let i = 0; i < txns.length; i++)
    for (let j = i + 1; j < txns.length; j++) {
      const a = txns[i];
      const b = txns[j];
      if (a.merchant === b.merchant && a.amount === b.amount && Math.abs(minutes(a) - minutes(b)) <= 10) {
        flagged.add(a.id);
        flagged.add(b.id);
      }
    }
  return flagged;
}

export const getCardSummary = defineTool({
  kind: "read",
  name: "get_card_summary",
  description: "Credit card status, limit, available limit, outstanding, minimum due, statement & due dates, reward points.",
  params: z.object({ cardId: cardIdParam }),
  async run({ cardId }, ctx) {
    const [c, customer] = await Promise.all([resolveCard(ctx, cardId), data.customer(ctx.customerId)]);
    return {
      view: {
        kind: "card_summary",
        data: {
          cardId: c.id,
          variant: c.variant,
          last4: c.last4,
          holder: customer.name,
          status: c.status,
          limit: c.creditLimit,
          available: c.availableLimit,
          outstanding: c.outstanding,
          minDue: c.minimumDue,
          dueDate: c.dueDate,
          statementDate: c.statementDate,
          points: c.rewardPoints,
        },
      },
      data: {
        cardId: c.id,
        card: `${c.variant} ending ${c.last4}`,
        status: c.status,
        creditLimit: inr(c.creditLimit),
        availableLimit: inr(c.availableLimit),
        totalOutstanding: inr(c.outstanding),
        minimumDue: inr(c.minimumDue),
        statementDate: formatDate(c.statementDate),
        paymentDueDate: formatDate(c.dueDate),
        rewardPoints: c.rewardPoints,
      },
      sources: [{ system: "cards", ref: c.id, label: `Card •${c.last4}` }],
    };
  },
});

export const getCardTransactions = defineTool({
  kind: "read",
  name: "get_card_transactions",
  description: "Recent card transactions with automatic flags for possible duplicate charges.",
  params: z.object({ days: z.number().int().min(1).max(90).default(30), cardId: cardIdParam }),
  async run({ days, cardId }, ctx) {
    const c = await resolveCard(ctx, cardId);
    const txns = await data.cardTransactions(ctx.customerId, c.id, days);
    const dupes = flagDuplicates(txns);
    return {
      view: {
        kind: "card_transactions",
        data: { last4: c.last4, days, items: txns.map((t) => ({ id: t.id, date: t.date, time: t.time, merchant: t.merchant, category: t.category, amount: t.amount, status: t.status, duplicate: dupes.has(t.id) })) },
      },
      data: {
        card: `•${c.last4}`,
        period: `Last ${days} days`,
        transactions: txns.map((t) => ({
          transactionId: t.id,
          date: formatDate(t.date),
          time: t.time,
          merchant: t.merchant,
          category: t.category,
          amount: inr(t.amount),
          status: t.status,
          flag: dupes.has(t.id) ? "possible_duplicate" : undefined,
        })),
        possibleDuplicates: dupes.size ? [...dupes] : [],
      },
      sources: [{ system: "cards", ref: c.id, label: `Card •${c.last4} transactions` }],
    };
  },
});

const disputeParams = z.object({
  transactionId: z.string(),
  reason: z.enum(["duplicate_charge", "not_recognised", "goods_not_received", "incorrect_amount", "other"]),
  note: z.string().optional(),
});

export const raiseCardDispute = defineAction({
  kind: "action",
  name: "raise_card_dispute",
  description: "Dispute a card transaction (duplicate, unrecognised, not received). Provisional credit applies for smaller amounts.",
  params: disputeParams,
  async prepare({ transactionId, reason, note }, ctx) {
    const c = await resolveCard(ctx);
    const txns = await data.cardTransactions(ctx.customerId, c.id, 90);
    const t = txns.find((x) => x.id.toLowerCase() === transactionId.toLowerCase());
    if (!t) throw new NotFoundError(`Transaction ${transactionId} not found on this customer's card.`);
    if (t.status !== "posted") throw new BusinessRuleError(`Transaction is already ${t.status}.`, ["POL-CC-001"]);
    if (daysBetween(t.date, today()) > CARD_POLICY.disputeWindowDays) throw new BusinessRuleError(`Disputes must be raised within ${CARD_POLICY.disputeWindowDays} days.`, ["POL-CC-001"]);
    const provisional = t.amount <= CARD_POLICY.provisionalCreditMaxAmount;
    return {
      title: "Card transaction dispute",
      summary: `Dispute ${inr(t.amount)} at ${t.merchant} on ${formatDate(t.date)} as ${reason.replaceAll("_", " ")}.`,
      details: {
        Transaction: `${t.id} · ${t.merchant} · ${formatDate(t.date)} ${t.time}`,
        Amount: inr(t.amount),
        Reason: reason.replaceAll("_", " "),
        "Provisional credit": provisional ? `Yes — ${inr(t.amount)} within 1 working day` : "No (amount above limit)",
        Resolution: `Within ${CARD_POLICY.disputeSlaDays} days`,
      },
      payload: { transactionId: t.id, amount: t.amount, merchant: t.merchant, reason, note, provisional },
      sources: [{ system: "cards", ref: t.id, label: `Txn ${t.id}` }, { system: "policy", ref: "POL-CC-001", label: "Card disputes" }],
    };
  },
  async commit(p: { transactionId: string; amount: number; merchant: string; reason: string; note?: string; provisional: boolean }, ctx) {
    await gateway.write("cards", "markDisputed", (s) => cardsApi.markDisputed(p.transactionId, s), { idempotencyKey: ctx.actionId });
    const sr = await gateway.write(
      "service_ops",
      "createRequest",
      (s) =>
        serviceOpsApi.createRequest(
          { customerId: ctx.customerId, type: "CARD_DISPUTE", priority: "normal", summary: `Dispute ${inr(p.amount)} at ${p.merchant} (${p.reason.replaceAll("_", " ")})`, details: p, idempotencyKey: ctx.actionId },
          s,
        ),
      { idempotencyKey: ctx.actionId, invalidateTags: [customerTag(ctx.customerId)] },
    );
    await logInteraction(ctx.customerId, `Card dispute ${sr.id} raised for ${p.transactionId}.`);
    return {
      reference: sr.id,
      data: { reference: sr.id, provisionalCredit: p.provisional ? inr(p.amount) : "not applicable", expectedResolutionBy: formatDate(sr.slaDueDate) },
      sources: [{ system: "service_ops", ref: sr.id, label: "Card dispute" }],
    };
  },
});

const blockParams = z.object({
  reason: z.enum(["lost", "stolen", "suspected_fraud", "damaged"]),
  replace: z.boolean().default(true),
  cardId: cardIdParam,
});

export const blockCard = defineAction({
  kind: "action",
  name: "block_card",
  description: "Immediately and permanently block a card (lost, stolen, fraud, damaged) and optionally order a replacement.",
  params: blockParams,
  async prepare({ reason, replace, cardId }, ctx) {
    const c = await resolveCard(ctx, cardId);
    if (c.status === "blocked") throw new BusinessRuleError("This card is already blocked.", ["POL-CC-002"]);
    const free = reason === "stolen" || reason === "suspected_fraud";
    const fee = free ? "Free (fraud/theft)" : `${inr(CARD_POLICY.replacementFee)} + GST`;
    return {
      title: "Block card",
      summary: `Permanently block ${c.variant} •${c.last4} (${reason.replaceAll("_", " ")})${replace ? " and send a replacement" : ""}.`,
      details: {
        Card: `${c.variant} •${c.last4}`,
        Reason: reason.replaceAll("_", " "),
        Effect: "Card stops working immediately — this cannot be undone",
        Replacement: replace ? `${fee}, delivered in ${CARD_POLICY.replacementDeliveryDays} working days` : "Not requested",
      },
      payload: { cardId: c.id, last4: c.last4, reason, replace },
      sources: [{ system: "policy", ref: "POL-CC-002", label: "Blocking & replacement" }],
    };
  },
  async commit(p: { cardId: string; last4: string; reason: string; replace: boolean }, ctx) {
    await gateway.write("cards", "blockCard", (s) => cardsApi.blockCard(p.cardId, s), { idempotencyKey: ctx.actionId, invalidateTags: [customerTag(ctx.customerId)] });
    const sr = await gateway.write(
      "service_ops",
      "createRequest",
      (s) => serviceOpsApi.createRequest({ customerId: ctx.customerId, type: "CARD_BLOCK", priority: "high", summary: `Card •${p.last4} blocked (${p.reason})${p.replace ? ", replacement ordered" : ""}`, details: p, idempotencyKey: ctx.actionId }, s),
      { idempotencyKey: ctx.actionId, invalidateTags: [customerTag(ctx.customerId)] },
    );
    await logInteraction(ctx.customerId, `Card •${p.last4} blocked via assistant (${sr.id}).`);
    return { reference: sr.id, data: { reference: sr.id, cardStatus: "blocked", replacement: p.replace ? "ordered" : "not requested" }, sources: [{ system: "cards", ref: p.cardId, label: "Card Platform" }] };
  },
});

export const cardTools = [getCardSummary, getCardTransactions, raiseCardDispute, blockCard];
