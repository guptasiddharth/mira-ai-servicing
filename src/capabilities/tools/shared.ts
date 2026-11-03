import { z } from "zod";
import { customerTag, data, gateway } from "@/capabilities/data";
import { crmApi, serviceOpsApi } from "@/enterprise/systems";
import { formatDate, maskEmail, maskPhone } from "@/lib/format";
import { today } from "@/lib/dates";
import { defineAction, defineTool } from "@/platform/tools/types";

/** Tools reused unchanged by every workflow (loans, cards, …). */

export const getCustomerProfile = defineTool({
  kind: "read",
  name: "get_customer_profile",
  description: "Customer profile from CRM (contact details masked) and the most recent support interactions.",
  params: z.object({}),
  async run(_args, ctx) {
    const [c, interactions] = await Promise.all([data.customer(ctx.customerId), data.interactions(ctx.customerId)]);
    return {
      data: {
        name: c.name,
        city: c.city,
        segment: c.segment,
        customerSince: formatDate(c.customerSince),
        registeredMobile: maskPhone(c.phone),
        registeredEmail: maskEmail(c.email),
        kyc: c.kycStatus,
        products: { loans: c.loanIds, cards: c.cardIds },
        recentInteractions: interactions.map((i) => ({ date: formatDate(i.date), channel: i.channel, summary: i.summary })),
      },
      sources: [{ system: "crm", ref: c.id, label: "CRM profile" }],
    };
  },
});

export const searchPolicy = defineTool({
  kind: "read",
  name: "search_policy",
  description:
    "Search the bank's official product policy book (prepayment, foreclosure, charges, rate resets, disputes, card rules). Returns clause IDs to cite.",
  params: z.object({
    query: z.string().min(2).describe("What to look up, e.g. 'foreclosure charges fixed rate'"),
    product: z.enum(["personal_loan", "credit_card"]).optional(),
  }),
  async run({ query, product }) {
    const clauses = await data.policySearch(query, product);
    return {
      data: clauses.length ? clauses.map((c) => ({ id: c.id, title: c.title, text: c.text, version: c.version })) : { message: "No matching policy clause found." },
      sources: clauses.map((c) => ({ system: "policy", ref: c.id, label: c.title, detail: c.text })),
      view: clauses.length ? { kind: "policy", data: { clauses: clauses.map((c) => ({ id: c.id, title: c.title, text: c.text })) } } : undefined,
    };
  },
});

export const getServiceRequests = defineTool({
  kind: "read",
  name: "get_service_requests",
  description: "List the customer's service requests (tickets, disputes, prepayment requests) with status and SLA.",
  params: z.object({}),
  async run(_args, ctx) {
    const srs = await data.serviceRequests(ctx.customerId);
    return {
      data: srs.length
        ? srs.map((r) => ({ reference: r.id, type: r.type, status: r.status, summary: r.summary, raised: formatDate(r.createdAt), expectedBy: formatDate(r.slaDueDate) }))
        : { message: "No service requests on record." },
      sources: [{ system: "service_ops", ref: "requests", label: "Service Operations" }],
      view: srs.length
        ? { kind: "service_requests", data: { items: srs.map((r) => ({ reference: r.id, type: r.type, status: r.status, summary: r.summary, raised: r.createdAt, expectedBy: r.slaDueDate })) } }
        : undefined,
    };
  },
});

const ticketParams = z.object({
  category: z.enum(["loan", "card", "payment", "documents", "complaint", "other"]),
  description: z.string().min(5).describe("Clear summary of the customer's issue in their words"),
  priority: z.enum(["normal", "high"]).default("normal"),
});

export const createServiceTicket = defineAction({
  kind: "action",
  name: "create_service_ticket",
  description: "Create a ticket for a specialist team when the request can't be completed here, or the customer asks for a human.",
  params: ticketParams,
  async prepare(args) {
    return {
      title: "Create service ticket",
      summary: `Raise a ${args.priority}-priority ${args.category} ticket: "${args.description}"`,
      details: { Category: args.category, Priority: args.priority, Issue: args.description, "Expected response": args.priority === "high" ? "Within 4 business hours" : "Within 3 working days" },
      payload: args,
      sources: [{ system: "policy", ref: "POL-GN-001", label: "Service request turnaround" }],
    };
  },
  async commit(p: z.infer<typeof ticketParams>, ctx) {
    const sr = await gateway.write(
      "service_ops",
      "createRequest",
      (s) => serviceOpsApi.createRequest({ customerId: ctx.customerId, type: "GENERAL", summary: p.description, priority: p.priority, details: { category: p.category }, idempotencyKey: ctx.actionId }, s),
      { idempotencyKey: ctx.actionId, invalidateTags: [customerTag(ctx.customerId)] },
    );
    await logInteraction(ctx.customerId, `Ticket ${sr.id} raised via assistant: ${p.description}`);
    return {
      reference: sr.id,
      data: { reference: sr.id, status: sr.status, expectedBy: formatDate(sr.slaDueDate) },
      sources: [{ system: "service_ops", ref: sr.id, label: "Service request" }],
    };
  },
});

/** Best-effort CRM note so human agents see the assistant's work (never blocks the customer). */
export async function logInteraction(customerId: string, summary: string) {
  try {
    await gateway.write("crm", "logInteraction", (s) => crmApi.logInteraction({ customerId, date: today(), channel: "assistant", summary }, s), {
      idempotencyKey: `${customerId}:${summary}`,
      invalidateTags: [customerTag(customerId)],
    });
  } catch {
    /* non-critical */
  }
}

export const sharedTools = [getCustomerProfile, searchPolicy, getServiceRequests, createServiceTicket];
