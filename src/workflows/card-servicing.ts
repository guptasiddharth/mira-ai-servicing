import { data } from "@/capabilities/data";
import { flagDuplicates } from "@/capabilities/tools/cards";
import { formatDate, inr, maskPhone } from "@/lib/format";
import type { Panel, WorkflowManifest } from "@/platform/workflows/types";
import { loadInParallel, makeContext } from "@/workflows/context";

/**
 * Second use case built on the same platform. New code for this workflow:
 * this manifest + 4 card tools + the Card Platform adapter. Everything else
 * (runtime, voice, gateway, actions, auth, metrics, UI shell) is reused.
 */
export const cardServicing: WorkflowManifest = {
  id: "card-servicing",
  name: "Credit Card Servicing",
  shortName: "Cards",
  description: "Card balance & dues, transaction review, disputes, and blocking a lost card.",
  agent: { name: "Mira", title: "AI Card Specialist" },
  persona:
    "You are Mira, Kestrel Finance's AI Card Specialist — an AI employee who handles credit-card servicing end to end. You are calm, reassuring and fast — especially when a customer is worried about fraud.",
  rules: [
    "If the customer mentions a lost/stolen card or fraud, prioritise blocking the card before anything else.",
    "When reviewing transactions, point out any entries flagged possible_duplicate and offer to dispute them.",
    "Explain minimum due vs total due using POL-CC-003 when the customer asks how much to pay.",
  ],
  tools: [
    "get_customer_profile",
    "get_card_summary",
    "get_card_transactions",
    "search_policy",
    "get_service_requests",
    "raise_card_dispute",
    "block_card",
    "create_service_ticket",
  ],
  starters: [
    { label: "What do I owe?", icon: "card", description: "Total due, minimum due and due date", prompt: "How much do I owe on my card and when is it due?" },
    { label: "Charged twice?", icon: "copy", description: "Find duplicate charges and dispute them", prompt: "I think I was charged twice for a food order yesterday. Can you check?" },
    { label: "Lost my card", icon: "lock", description: "Block it instantly and order a replacement", prompt: "I've lost my credit card, please block it." },
  ],
  greeting: (firstName) => `Hi ${firstName}, Mira here. I have your credit card in front of me — what can I do for you?`,

  async loadContext(ctx) {
    const { values, degraded } = await loadInParallel({
      customer: () => data.customer(ctx.customerId),
      cards: () => data.cards(ctx.customerId),
      serviceRequests: () => data.serviceRequests(ctx.customerId),
    });
    const card = values.cards?.[0];
    const txns = card ? await data.cardTransactions(ctx.customerId, card.id, 30).catch(() => undefined) : undefined;
    const dupes = txns ? flagDuplicates(txns) : new Set<string>();
    return makeContext(
      {
        customer: values.customer && { name: values.customer.name, firstName: values.customer.firstName, registeredMobile: maskPhone(values.customer.phone) },
        cards: values.cards?.map((c) => ({
          cardId: c.id,
          card: `${c.variant} •${c.last4}`,
          status: c.status,
          outstanding: inr(c.outstanding),
          minimumDue: inr(c.minimumDue),
          dueDate: formatDate(c.dueDate),
          availableLimit: inr(c.availableLimit),
        })),
        recentTransactions: txns?.slice(0, 6).map((t) => ({ transactionId: t.id, date: formatDate(t.date), merchant: t.merchant, amount: inr(t.amount), status: t.status, flag: dupes.has(t.id) ? "possible_duplicate" : undefined })),
        openServiceRequests: values.serviceRequests?.filter((r) => r.status !== "closed").map((r) => ({ reference: r.id, type: r.type, summary: r.summary, status: r.status })),
      },
      [{ system: "cards", ref: card?.id ?? "-", label: "Card Platform" }],
      [...degraded, ...(card && !txns ? ["card transactions"] : [])],
    );
  },

  async loadPanels(ctx) {
    const { values } = await loadInParallel({ cards: () => data.cards(ctx.customerId), srs: () => data.serviceRequests(ctx.customerId) });
    const panels: Panel[] = [];
    for (const c of values.cards ?? []) {
      const txns = await data.cardTransactions(ctx.customerId, c.id, 30).catch(() => []);
      const dupes = flagDuplicates(txns);
      panels.push({
        id: c.id,
        progress: { value: c.outstanding, max: c.creditLimit, label: "Limit used", tone: c.outstanding / c.creditLimit > 0.7 ? "warn" : "default" },
        title: c.variant,
        subtitle: `•••• ${c.last4} · ${c.status === "blocked" ? "BLOCKED" : "Active"}`,
        source: "Card Platform",
        stats: [
          { label: "Total due", value: inr(c.outstanding) },
          { label: "Minimum due", value: inr(c.minimumDue) },
          { label: "Due date", value: formatDate(c.dueDate) },
          { label: "Available", value: inr(c.availableLimit), tone: c.status === "blocked" ? "bad" : "default" },
        ],
      });
      panels.push({
        id: `${c.id}-txns`,
        title: "Recent transactions",
        source: "Card Platform",
        list: {
          items: txns.slice(0, 6).map((t) => ({
            primary: t.merchant,
            secondary: `${formatDate(t.date)} ${t.time}${dupes.has(t.id) ? " · possible duplicate" : ""}${t.status !== "posted" ? ` · ${t.status}` : ""}`,
            value: inr(t.amount),
            tone: t.status === "disputed" ? "warn" : dupes.has(t.id) ? "bad" : "default",
          })),
        },
      });
    }
    if (!values.cards?.length) panels.push({ id: "no-card", title: "Credit card", source: "Card Platform", error: "No credit card on this profile." });
    panels.push({
      id: "requests",
      title: "Service requests",
      source: "Service Operations",
      list: {
        items: (values.srs ?? []).slice(0, 5).map((r) => ({ primary: `${r.id} · ${r.type.replace("_", " ").toLowerCase()}`, secondary: r.summary, value: r.status, tone: r.status === "resolved" ? "good" : "warn" })),
        empty: "No open requests.",
      },
    });
    return panels;
  },
};
