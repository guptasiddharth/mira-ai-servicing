import { data } from "@/capabilities/data";
import { formatDate, inr, maskEmail, maskPhone, pct } from "@/lib/format";
import type { Panel, WorkflowManifest } from "@/platform/workflows/types";
import { loadInParallel, makeContext } from "@/workflows/context";

export const loanServicing: WorkflowManifest = {
  id: "loan-servicing",
  name: "Personal Loan Servicing",
  shortName: "Loans",
  description: "EMIs, rate resets, prepayment & foreclosure, failed payments and disputes.",
  agent: { name: "Mira", title: "AI Loan Specialist" },
  persona:
    "You are Mira, Kestrel Finance's AI Loan Specialist — an AI employee who handles personal-loan servicing end to end. You are warm, precise and efficient — like the best relationship manager the customer has ever spoken to.",
  rules: [
    "For 'why did my EMI change' questions use explain_emi_change; for 'what if I prepay' use simulate_prepayment; for closure use check_foreclosure. Never estimate these yourself.",
    "When showing prepayment results, compare 'reduce tenure' vs 'reduce EMI' and recommend reduce tenure when the customer's goal is saving interest.",
    "If a prepayment amount breaks a policy limit, explain the limit and proactively offer the largest permitted amount (alternativeAtMaxAllowed) or foreclosure.",
    "For failed payments, explain each failure in plain language, say whether it was later paid, and if a bounce charge looks reversible offer to raise a dispute.",
    "For 'what are my options' questions, fetch loan details and foreclosure status (in parallel) and present prepayment, foreclosure and keep-as-is options with numbers.",
  ],
  tools: [
    "get_customer_profile",
    "get_loan_details",
    "get_repayment_schedule",
    "explain_emi_change",
    "get_payment_history",
    "simulate_prepayment",
    "check_foreclosure",
    "search_policy",
    "get_service_requests",
    "request_part_prepayment",
    "raise_payment_dispute",
    "request_statement",
    "create_service_ticket",
  ],
  starters: [
    { label: "Why did my EMI go up?", icon: "trend", description: "Explain the change and what a ₹50,000 prepayment saves", prompt: "My EMI increased this month. Why? And if I make a ₹50,000 prepayment today, how much interest would I save?" },
    { label: "Failed payments", icon: "alert", description: "What bounced in the last 6 months, and can charges be reversed?", prompt: "Show me the payments that failed in the last six months and explain what happened." },
    { label: "Foreclose without penalty?", icon: "shield", description: "Eligibility, exact payoff amount and dates", prompt: "Am I eligible for foreclosure without a penalty?" },
    { label: "My options", icon: "compass", description: "Prepay, foreclose or continue — compared with numbers", prompt: "Based on my current loan and applicable terms, what are my options?" },
  ],
  greeting: (firstName) => `Hi ${firstName}, I'm Mira. I have your personal loan open — how can I help today?`,

  async loadContext(ctx) {
    const { values, degraded } = await loadInParallel({
      customer: () => data.customer(ctx.customerId),
      loans: () => data.loans(ctx.customerId),
      payments: () => data.payments(ctx.customerId, 3),
      serviceRequests: () => data.serviceRequests(ctx.customerId),
    });
    const { customer, loans, payments, serviceRequests } = values;
    return makeContext(
      {
        customer: customer && {
          name: customer.name,
          firstName: customer.firstName,
          city: customer.city,
          customerSince: formatDate(customer.customerSince),
          registeredMobile: maskPhone(customer.phone),
          registeredEmail: maskEmail(customer.email),
        },
        loans: loans?.map((l) => ({
          loanId: l.id,
          product: l.productName,
          rateType: l.rateType,
          currentRate: pct(l.currentRate),
          currentEmi: inr(l.currentEmi),
          previousEmi: l.emisPaid >= 2 ? inr(l.schedule[l.emisPaid - 2].emi) : null,
          emisPaid: l.emisPaid,
          emisRemaining: l.emisRemaining,
          outstandingPrincipal: inr(l.outstandingPrincipal, 2),
          nextDue: l.nextInstallment && { date: formatDate(l.nextInstallment.dueDate), amount: inr(l.nextInstallment.emi) },
        })),
        recentPayments: payments?.slice(0, 4).map((p) => ({
          paymentId: p.id,
          date: formatDate(p.attemptDate),
          amount: inr(p.amount),
          channel: p.channel,
          status: p.status,
          failureReason: p.failure?.reason,
        })),
        openServiceRequests: serviceRequests?.filter((r) => r.status === "open" || r.status === "in_progress").map((r) => ({ reference: r.id, type: r.type, summary: r.summary })),
      },
      [{ system: "crm", ref: ctx.customerId, label: "CRM" }],
      degraded,
    );
  },

  async loadPanels(ctx) {
    const { values, degraded } = await loadInParallel({
      loans: () => data.loans(ctx.customerId),
      payments: () => data.payments(ctx.customerId, 6),
      srs: () => data.serviceRequests(ctx.customerId),
    });
    const panels: Panel[] = [];
    for (const l of values.loans ?? []) {
      panels.push({
        id: l.id,
        progress: { value: l.emisPaid, max: l.schedule.length, label: "EMIs paid" },
        title: "Personal Loan",
        subtitle: `${l.id} · ${l.rateType === "floating" ? "Floating" : "Fixed"} ${pct(l.currentRate)}`,
        source: "Loan Management",
        stats: [
          { label: "Outstanding", value: inr(l.outstandingPrincipal) },
          { label: "Current EMI", value: inr(l.currentEmi), hint: l.lastPaidInstallment?.rateReset ? "Revised after rate reset" : undefined, tone: l.lastPaidInstallment?.rateReset ? "warn" : "default" },
          { label: "Next due", value: l.nextInstallment ? formatDate(l.nextInstallment.dueDate) : "—" },
          { label: "EMIs paid", value: `${l.emisPaid} / ${l.schedule.length}` },
        ],
      });
    }
    if (degraded.includes("loans")) panels.push({ id: "loans-error", title: "Personal Loan", source: "Loan Management", error: "Loan system is slow to respond — retrying shortly." });

    panels.push({
      id: "payments",
      title: "Recent payments",
      source: "Payments",
      error: degraded.includes("payments") ? "Payments system unavailable right now." : undefined,
      list: {
        items: (values.payments ?? []).slice(0, 6).map((p) => ({
          primary: `${formatDate(p.attemptDate)} · ${p.channel}`,
          secondary: p.failure ? p.failure.reason : `EMI #${p.installmentNo}`,
          value: inr(p.amount),
          tone: p.status === "failed" ? "bad" : "good",
        })),
        empty: "No payments in the last 6 months.",
      },
    });

    panels.push({
      id: "requests",
      title: "Service requests",
      source: "Service Operations",
      error: degraded.includes("srs") ? "Service Operations unavailable right now." : undefined,
      list: {
        items: (values.srs ?? []).slice(0, 5).map((r) => ({ primary: `${r.id} · ${r.type.replace("_", " ").toLowerCase()}`, secondary: r.summary, value: r.status, tone: r.status === "resolved" ? "good" : "warn" })),
        empty: "No open requests.",
      },
    });
    return panels;
  },
};
