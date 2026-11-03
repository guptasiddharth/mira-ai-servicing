import { z } from "zod";
import { customerTag, data, gateway, resolveLoan } from "@/capabilities/data";
import { logInteraction } from "@/capabilities/tools/shared";
import { balanceSeries, computeEmi, rateOn, round2 } from "@/domain/finance/amortization";
import { quoteForeclosure } from "@/domain/finance/foreclosure";
import { simulatePrepayment } from "@/domain/finance/prepayment";
import { evaluateBounceReversal, evaluateForeclosure, evaluatePartPrepayment, type LoanFacts } from "@/domain/policy/loan-rules";
import { LOAN_POLICY, POLICY_CLAUSES } from "@/enterprise/data/policies";
import type { LoanView } from "@/enterprise/systems";
import { loansApi, serviceOpsApi } from "@/enterprise/systems";
import { addMonths, daysBetween, financialYearStart, today } from "@/lib/dates";
import { formatDate, inr, maskEmail, maskPhone, pct } from "@/lib/format";
import { BusinessRuleError, NotFoundError } from "@/platform/errors";
import { defineAction, defineTool, type Source } from "@/platform/tools/types";
import type { EmiChangeView, ForeclosureView, LoanOverviewView, PaymentsView, PrepaymentView, ScheduleView } from "@/capabilities/views";

/** Loan-servicing capabilities. All maths and rules are deterministic code. */

const loanIdParam = z.string().optional().describe("Loan ID. Omit to use the customer's active loan.");
const loanSource = (l: LoanView): Source => ({ system: "loans", ref: l.id, label: `Loan ${l.id}` });
const policySource = (id: string, label: string): Source => ({ system: "policy", ref: id, label, detail: POLICY_CLAUSES.find((c) => c.id === id)?.text });

function loanFacts(l: LoanView): LoanFacts {
  const fy = financialYearStart(today());
  return {
    rateType: l.rateType,
    emisPaid: l.emisPaid,
    outstandingPrincipal: l.outstandingPrincipal,
    partPrepaymentsThisFY: l.partPrepayments.filter((p) => p.date >= fy).length,
  };
}

export const getLoanDetails = defineTool({
  kind: "read",
  name: "get_loan_details",
  description: "Current loan position: outstanding principal, interest rate & history, EMI, EMIs paid/remaining, next due date, mandate.",
  params: z.object({ loanId: loanIdParam }),
  async run({ loanId }, ctx) {
    const l = await resolveLoan(ctx, loanId);
    return {
      data: {
        loanId: l.id,
        product: l.productName,
        sanctionedAmount: inr(l.principal),
        disbursedOn: formatDate(l.disbursedOn),
        rateType: l.rateType,
        currentRate: pct(l.currentRate),
        currentEmi: inr(l.currentEmi),
        tenureMonths: l.tenureMonths,
        emisPaid: l.emisPaid,
        emisRemaining: l.emisRemaining,
        outstandingPrincipal: inr(l.outstandingPrincipal, 2),
        nextDue: l.nextInstallment ? { date: formatDate(l.nextInstallment.dueDate), amount: inr(l.nextInstallment.emi), installment: l.nextInstallment.n } : null,
        lastPaid: l.lastPaidInstallment ? { date: formatDate(l.lastPaidInstallment.dueDate), amount: inr(l.lastPaidInstallment.emi) } : null,
        rateHistory: l.ratePeriods.map((r) => ({ from: formatDate(r.effectiveFrom), rate: pct(r.annualRate), reason: r.reason })),
        autoDebit: `${l.mandate.type} from ${l.mandate.bank} a/c ${l.mandate.accountMasked}`,
      },
      sources: [loanSource(l)],
      view: {
        kind: "loan_overview",
        data: {
          loanId: l.id,
          product: l.productName,
          rateType: l.rateType,
          rate: l.currentRate,
          emi: l.currentEmi,
          principal: l.principal,
          outstanding: l.outstandingPrincipal,
          emisPaid: l.emisPaid,
          tenure: l.schedule.length,
          nextDue: l.nextInstallment ? { date: l.nextInstallment.dueDate, amount: l.nextInstallment.emi } : undefined,
          rateHistory: l.ratePeriods.map((r) => ({ from: r.effectiveFrom, rate: r.annualRate, reason: r.reason })),
          autoDebit: `${l.mandate.type} · ${l.mandate.bank} ${l.mandate.accountMasked}`,
        } satisfies LoanOverviewView,
      },
    };
  },
});

export const getRepaymentSchedule = defineTool({
  kind: "read",
  name: "get_repayment_schedule",
  description: "Upcoming (or past) instalments with principal/interest split and balance after each.",
  params: z.object({
    loanId: loanIdParam,
    from: z.enum(["next", "start"]).default("next"),
    count: z.number().int().min(1).max(24).default(6),
  }),
  async run({ loanId, from, count }, ctx) {
    const l = await resolveLoan(ctx, loanId);
    const start = from === "next" ? l.emisPaid : 0;
    const rows = l.schedule.slice(start, start + count).map((r) => ({
      installment: r.n,
      dueDate: formatDate(r.dueDate),
      emi: inr(r.emi),
      principal: inr(r.principal, 2),
      interest: inr(r.interest, 2),
      balanceAfter: inr(r.closingBalance, 2),
      rate: pct(r.annualRate),
      status: r.n <= l.emisPaid ? "paid" : "upcoming",
    }));
    const view: ScheduleView = {
      loanId: l.id,
      rows: l.schedule.slice(start, start + count).map((r) => ({ n: r.n, date: r.dueDate, emi: r.emi, principal: r.principal, interest: r.interest, balance: r.closingBalance, status: r.n <= l.emisPaid ? "paid" : "upcoming" })),
    };
    return { data: { loanId: l.id, totalInstallments: l.schedule.length, rows }, sources: [loanSource(l)], view: { kind: "schedule", data: view } };
  },
});

export const explainEmiChange = defineTool({
  kind: "read",
  name: "explain_emi_change",
  description:
    "Explains why the EMI changed between instalments (rate resets, prepayments) by comparing the schedule, with the exact before/after numbers.",
  params: z.object({ loanId: loanIdParam }),
  async run({ loanId }, ctx) {
    const l = await resolveLoan(ctx, loanId);
    const last = l.lastPaidInstallment;
    if (!last || last.n < 2) return { data: { message: "Not enough instalments yet to compare." }, sources: [loanSource(l)] };
    const prev = l.schedule[last.n - 2];
    const next = l.nextInstallment;

    // Find the most recent instalment where the EMI actually changed.
    let changeAt = last;
    for (let i = last.n - 1; i >= 1; i--) {
      if (l.schedule[i].emi !== l.schedule[i - 1].emi && l.schedule[i].rateReset) {
        changeAt = l.schedule[i];
        break;
      }
    }
    const before = l.schedule[changeAt.n - 2];
    const period = rateOn(l.ratePeriods, changeAt.dueDate);
    const drivers = changeAt.rateReset
      ? [
          {
            type: "floating_rate_reset",
            effectiveFrom: formatDate(period.effectiveFrom),
            rateBefore: pct(before.annualRate),
            rateAfter: pct(changeAt.annualRate),
            reason: period.reason,
            mechanism: `EMI recalculated on outstanding ${inr(changeAt.openingBalance, 2)} over the remaining ${l.tenureMonths - changeAt.n + 1} months; tenure unchanged.`,
          },
        ]
      : [];
    const clauses = await data.policyClauses(["POL-PL-005"]);

    return {
      data: {
        loanId: l.id,
        rateType: l.rateType,
        comparison: {
          previous: { installment: before.n, dueDate: formatDate(before.dueDate), emi: inr(before.emi), rate: pct(before.annualRate) },
          changed: { installment: changeAt.n, dueDate: formatDate(changeAt.dueDate), emi: inr(changeAt.emi), rate: pct(changeAt.annualRate) },
          difference: inr(changeAt.emi - before.emi),
          differencePct: pct(round2(((changeAt.emi - before.emi) / before.emi) * 100)),
        },
        mostRecentTwo: { previous: inr(prev.emi), latest: inr(last.emi), changedThisMonth: prev.emi !== last.emi },
        drivers: drivers.length ? drivers : [{ type: "none", note: "No rate reset — EMI difference may be due to charges in the debit, not the EMI itself." }],
        nextEmi: next ? { dueDate: formatDate(next.dueDate), emi: inr(next.emi) } : null,
        policy: clauses.map((c) => ({ id: c.id, text: c.text })),
      },
      sources: [loanSource(l), policySource("POL-PL-005", "Floating rate resets")],
      view: {
        kind: "emi_change",
        data: {
          loanId: l.id,
          rateType: l.rateType,
          previous: { n: before.n, dueDate: before.dueDate, emi: before.emi, rate: before.annualRate },
          current: { n: changeAt.n, dueDate: changeAt.dueDate, emi: changeAt.emi, rate: changeAt.annualRate },
          delta: changeAt.emi - before.emi,
          deltaPct: round2(((changeAt.emi - before.emi) / before.emi) * 100),
          reset: changeAt.rateReset ? { effectiveFrom: period.effectiveFrom, reason: period.reason, outstandingAtReset: changeAt.openingBalance, remainingMonths: l.tenureMonths - changeAt.n + 1 } : undefined,
          history: l.schedule.slice(0, l.emisPaid + 1).map((r) => ({ n: r.n, label: r.dueDate, emi: r.emi, rate: r.annualRate })),
          nextEmi: next ? { dueDate: next.dueDate, emi: next.emi } : undefined,
        } satisfies EmiChangeView,
      },
    };
  },
});

export const getPaymentHistory = defineTool({
  kind: "read",
  name: "get_payment_history",
  description:
    "EMI payment attempts from the Payments system, including failed/bounced debits with reason, whether it was later paid, charges levied, and dispute/reversal eligibility.",
  params: z.object({
    months: z.number().int().min(1).max(24).default(6),
    onlyFailed: z.boolean().default(false),
  }),
  latency: "slow",
  async run({ months, onlyFailed }, ctx) {
    const all = await data.payments(ctx.customerId, 24);
    const since = addMonths(today(), -months);
    const inWindow = all.filter((p) => p.attemptDate >= since);
    const failed = inWindow.filter((p) => p.status === "failed");
    const list = (onlyFailed ? failed : inWindow).map((p) => {
      const recovered = all.find((x) => x.installmentNo === p.installmentNo && x.loanId === p.loanId && x.status === "success");
      const base = {
        paymentId: p.id,
        date: formatDate(p.attemptDate),
        installment: p.installmentNo,
        amount: inr(p.amount),
        channel: p.channel,
        status: p.status,
      };
      if (p.status !== "failed" || !p.failure) return base;
      const rev = evaluateBounceReversal(p.failure.category, daysBetween(p.attemptDate, today()));
      return {
        ...base,
        failureCode: p.failure.code,
        failureReason: p.failure.reason,
        failureCategory: p.failure.category === "technical" ? "bank-side / technical" : "insufficient funds (customer side)",
        bounceCharge: p.chargesLevied ? inr(p.chargesLevied.amount + p.chargesLevied.gst) + " (incl. GST)" : null,
        subsequentlyPaid: recovered ? `Yes — ${formatDate(recovered.attemptDate)} via ${recovered.channel}` : "No — overdue",
        dispute: { canDispute: rev.canDispute, chargeReversalLikely: rev.likelyReversal, assessment: rev.reason },
      };
    });
    const totalCharges = failed.reduce((s, p) => s + (p.chargesLevied ? p.chargesLevied.amount + p.chargesLevied.gst : 0), 0);
    const view: PaymentsView = {
      period: `Last ${months} months`,
      attempts: inWindow.length,
      failed: failed.length,
      chargesTotal: totalCharges,
      items: (onlyFailed ? failed : inWindow).map((p) => {
        const recovered = all.find((x) => x.installmentNo === p.installmentNo && x.loanId === p.loanId && x.status === "success");
        const rev = p.failure ? evaluateBounceReversal(p.failure.category, daysBetween(p.attemptDate, today())) : undefined;
        return {
          id: p.id,
          date: p.attemptDate,
          installment: p.installmentNo,
          amount: p.amount,
          channel: p.channel,
          status: p.status,
          failureReason: p.failure?.reason,
          failureCode: p.failure?.code,
          category: p.failure?.category,
          charge: p.chargesLevied ? p.chargesLevied.amount + p.chargesLevied.gst : undefined,
          recoveredOn: p.status === "failed" ? recovered?.attemptDate : undefined,
          recoveredVia: p.status === "failed" ? recovered?.channel : undefined,
          canDispute: rev?.canDispute,
          reversalLikely: rev?.likelyReversal,
        };
      }),
    };
    return {
      data: {
        period: `Last ${months} months (since ${formatDate(since)})`,
        summary: { attempts: inWindow.length, failed: failed.length, bounceChargesTotal: inr(totalCharges) },
        payments: list,
      },
      sources: [
        { system: "payments", ref: "history", label: "Payments history" },
        ...(failed.length ? [policySource("POL-PL-006", "Bounce charges"), policySource("POL-PL-008", "Payment disputes")] : []),
      ],
      view: { kind: "payments", data: view },
    };
  },
});

export const simulatePrepaymentTool = defineTool({
  kind: "read",
  name: "simulate_prepayment",
  description:
    "Calculates the exact effect of a part-prepayment: eligibility under policy, charges, and interest saved for 'reduce tenure' vs 'reduce EMI'. Use for any 'what if I pay X extra' question.",
  params: z.object({
    amount: z.number().positive().describe("Prepayment amount in rupees"),
    loanId: loanIdParam,
  }),
  async run({ amount, loanId }, ctx) {
    const l = await resolveLoan(ctx, loanId);
    const facts = loanFacts(l);
    if (amount >= l.outstandingPrincipal) {
      return {
        data: { note: `Amount ${inr(amount)} covers the full outstanding ${inr(l.outstandingPrincipal, 2)} — this is a foreclosure. Use check_foreclosure.` },
        sources: [loanSource(l)],
      };
    }
    const decision = evaluatePartPrepayment(facts, amount);
    const sim = (amt: number) =>
      simulatePrepayment({ outstanding: l.outstandingPrincipal, annualRate: l.currentRate, currentEmi: l.currentEmi, amount: amt, chargeRatePct: decision.chargeRatePct, gstPct: decision.gstPct });
    const fmt = (s: ReturnType<typeof sim>) => ({
      charges: inr(s.charges.total, 2),
      newOutstanding: inr(s.newOutstanding, 2),
      reduceTenure: {
        emi: inr(s.reduceTenure.emi),
        remainingMonths: s.reduceTenure.months,
        monthsSaved: s.reduceTenure.monthsSaved,
        interestSaved: inr(s.reduceTenure.interestSaved),
        netSavingAfterCharges: inr(s.reduceTenure.netSaving),
      },
      reduceEmi: {
        newEmi: inr(s.reduceEmi.emi),
        emiReducedBy: inr(s.reduceEmi.emiReduction),
        remainingMonths: s.reduceEmi.months,
        interestSaved: inr(s.reduceEmi.interestSaved),
        netSavingAfterCharges: inr(s.reduceEmi.netSaving),
      },
    });
    const s = sim(amount);
    const alt = !decision.allowed && decision.violations.every((v) => v.message.includes("cannot exceed")) && decision.maxAllowedAmount >= LOAN_POLICY.minPartPrepayment;

    const clauses = await data.policyClauses(decision.appliedRules);
    const reducedEmi = computeEmi(s.newOutstanding, l.currentRate, s.baseline.months);
    const view: PrepaymentView = {
      loanId: l.id,
      amount,
      eligible: decision.allowed,
      violations: decision.violations,
      maxAllowed: decision.maxAllowedAmount,
      rate: l.currentRate,
      charges: s.charges.total,
      baseline: { emi: l.currentEmi, months: s.baseline.months, interest: s.baseline.totalInterest, outstanding: l.outstandingPrincipal },
      reduceTenure: s.reduceTenure,
      reduceEmi: s.reduceEmi,
      series: {
        baseline: balanceSeries(l.outstandingPrincipal, l.currentRate, l.currentEmi),
        reduceTenure: balanceSeries(s.newOutstanding, l.currentRate, l.currentEmi),
        reduceEmi: balanceSeries(s.newOutstanding, l.currentRate, reducedEmi),
      },
      startDate: today(),
    };
    return {
      view: { kind: "prepayment", data: view },
      data: {
        loanId: l.id,
        amount: inr(amount),
        eligible: decision.allowed,
        violations: decision.violations,
        currentPosition: {
          outstanding: inr(l.outstandingPrincipal, 2),
          rate: pct(l.currentRate),
          emi: inr(l.currentEmi),
          remainingMonths: s.baseline.months,
          remainingInterest: inr(s.baseline.totalInterest),
        },
        projection: fmt(s),
        defaultApplication: "reduce_tenure (POL-PL-007)",
        maxAllowedSinglePrepayment: inr(decision.maxAllowedAmount),
        alternativeAtMaxAllowed: alt ? { amount: inr(decision.maxAllowedAmount), ...fmt(sim(decision.maxAllowedAmount)) } : undefined,
        policy: clauses.map((c) => ({ id: c.id, title: c.title })),
      },
      sources: [loanSource(l), ...clauses.map((c) => policySource(c.id, c.title))],
    };
  },
});

export const checkForeclosure = defineTool({
  kind: "read",
  name: "check_foreclosure",
  description:
    "Foreclosure (full closure) eligibility, whether it is penalty-free, the exact payoff amount today, and when it becomes allowed/penalty-free if not now.",
  params: z.object({ loanId: loanIdParam }),
  async run({ loanId }, ctx) {
    const l = await resolveLoan(ctx, loanId);
    const decision = evaluateForeclosure(loanFacts(l));
    const lastDue = l.lastPaidInstallment?.dueDate ?? l.disbursedOn;
    const quote = quoteForeclosure({
      outstandingPrincipal: l.outstandingPrincipal,
      annualRate: l.currentRate,
      daysSinceLastDue: daysBetween(lastDue, today()),
      chargeRatePct: decision.chargeRatePct,
      gstPct: decision.gstPct,
    });
    const remainingInterest = l.schedule.slice(l.emisPaid).reduce((s, r) => s + r.interest, 0);
    const dateForEmi = (n?: number) => (n && l.schedule[n - 1] ? formatDate(l.schedule[n - 1].dueDate) : undefined);
    const clauses = await data.policyClauses(decision.appliedRules);
    const futureInterest = round2(remainingInterest);
    const view: ForeclosureView = {
      loanId: l.id,
      rateType: l.rateType,
      emisPaid: l.emisPaid,
      tenure: l.schedule.length,
      allowedNow: decision.allowed,
      penaltyFree: decision.penaltyFree,
      chargePct: decision.chargeRatePct,
      allowedFrom: decision.allowedAfterEmis ? { emi: decision.allowedAfterEmis, date: l.schedule[decision.allowedAfterEmis - 1]?.dueDate } : undefined,
      penaltyFreeFrom: decision.penaltyFreeAfterEmis ? { emi: decision.penaltyFreeAfterEmis, date: l.schedule[decision.penaltyFreeAfterEmis - 1]?.dueDate } : undefined,
      checks: [
        { label: `Lock-in of ${LOAN_POLICY.lockInEmis} EMIs completed`, ok: l.emisPaid >= LOAN_POLICY.lockInEmis, ruleId: "POL-PL-001", note: `${l.emisPaid} EMIs paid` },
        {
          label: "No foreclosure penalty",
          ok: decision.penaltyFree,
          ruleId: l.rateType === "floating" ? "POL-PL-003" : "POL-PL-004",
          note: l.rateType === "floating" ? "Floating-rate loan" : `${decision.chargeRatePct}% of outstanding + GST`,
        },
      ],
      quote: { principal: quote.outstandingPrincipal, interest: quote.accruedInterest, charge: quote.foreclosureCharge, gst: quote.gstOnCharge, total: quote.totalPayable },
      futureInterest,
      netBenefit: round2(remainingInterest - quote.accruedInterest - quote.foreclosureCharge - quote.gstOnCharge),
    };
    return {
      view: { kind: "foreclosure", data: view },
      data: {
        loanId: l.id,
        rateType: l.rateType,
        emisPaid: l.emisPaid,
        allowedNow: decision.allowed,
        penaltyFree: decision.penaltyFree,
        foreclosureChargeRate: pct(decision.chargeRatePct),
        reasons: decision.reasons,
        allowedFrom: decision.allowedAfterEmis ? `after EMI #${decision.allowedAfterEmis} (${dateForEmi(decision.allowedAfterEmis)})` : undefined,
        penaltyFreeFrom: decision.penaltyFreeAfterEmis ? `after EMI #${decision.penaltyFreeAfterEmis} (${dateForEmi(decision.penaltyFreeAfterEmis)})` : undefined,
        payoffQuoteToday: {
          outstandingPrincipal: inr(quote.outstandingPrincipal, 2),
          accruedInterest: inr(quote.accruedInterest, 2),
          foreclosureCharge: inr(quote.foreclosureCharge, 2),
          gstOnCharge: inr(quote.gstOnCharge, 2),
          totalPayable: inr(quote.totalPayable, 2),
          validFor: "today only",
        },
        futureInterestAvoided: inr(remainingInterest),
        netBenefitOfClosingNow: inr(remainingInterest - quote.accruedInterest - quote.foreclosureCharge - quote.gstOnCharge),
        policy: clauses.map((c) => ({ id: c.id, text: c.text })),
      },
      sources: [loanSource(l), ...clauses.map((c) => policySource(c.id, c.title))],
    };
  },
});

// ───────────────────────────────── Actions ─────────────────────────────────

const prepayParams = z.object({
  amount: z.number().positive(),
  applyAs: z.enum(["reduce_tenure", "reduce_emi"]).default("reduce_tenure"),
  loanId: loanIdParam,
});
interface PrepayPayload {
  loanId: string;
  amount: number;
  applyAs: "reduce_tenure" | "reduce_emi";
  charges: number;
  summary: string;
}

export const requestPartPrepayment = defineAction({
  kind: "action",
  name: "request_part_prepayment",
  description: "Book a part-prepayment request. Customer pays via a secure link sent to their registered mobile; it is applied within 2 working days.",
  params: prepayParams,
  async prepare({ amount, applyAs, loanId }, ctx) {
    const [l, customer] = await Promise.all([resolveLoan(ctx, loanId), data.customer(ctx.customerId)]);
    const decision = evaluatePartPrepayment(loanFacts(l), amount);
    if (!decision.allowed) throw new BusinessRuleError(decision.violations.map((v) => v.message).join(" "), decision.violations.map((v) => v.ruleId));
    const s = simulatePrepayment({ outstanding: l.outstandingPrincipal, annualRate: l.currentRate, currentEmi: l.currentEmi, amount, chargeRatePct: decision.chargeRatePct, gstPct: decision.gstPct });
    const effect =
      applyAs === "reduce_tenure"
        ? `EMI stays ${inr(l.currentEmi)}, loan ends ${s.reduceTenure.monthsSaved} months earlier, saving ${inr(s.reduceTenure.interestSaved)} interest`
        : `EMI drops to ${inr(s.reduceEmi.emi)} (−${inr(s.reduceEmi.emiReduction)}), saving ${inr(s.reduceEmi.interestSaved)} interest`;
    const summary = `Part-prepay ${inr(amount)} on ${l.id} — ${effect}.`;
    return {
      title: "Part-prepayment request",
      summary,
      details: {
        Loan: l.id,
        Amount: inr(amount),
        "Apply as": applyAs === "reduce_tenure" ? "Reduce tenure" : "Reduce EMI",
        Effect: effect,
        Charges: s.charges.total ? inr(s.charges.total, 2) : "Nil",
        "Payment link": `SMS to ${maskPhone(customer.phone)}`,
      },
      payload: { loanId: l.id, amount, applyAs, charges: s.charges.total, summary } satisfies PrepayPayload,
      sources: [loanSource(l), policySource("POL-PL-002", "Part-prepayment limits")],
    };
  },
  async commit(p: PrepayPayload, ctx) {
    const sr = await gateway.write(
      "service_ops",
      "createRequest",
      (s) =>
        serviceOpsApi.createRequest(
          { customerId: ctx.customerId, type: "PREPAYMENT", priority: "normal", summary: p.summary, details: { loanId: p.loanId, amount: p.amount, applyAs: p.applyAs, charges: p.charges }, idempotencyKey: ctx.actionId },
          s,
        ),
      { idempotencyKey: ctx.actionId },
    );
    await gateway.write("loans", "registerPartPrepayment", (s) => loansApi.registerPartPrepayment(p.loanId, p.amount, sr.id, today(), s), {
      idempotencyKey: ctx.actionId,
      invalidateTags: [customerTag(ctx.customerId)],
    });
    await logInteraction(ctx.customerId, `Part-prepayment ${inr(p.amount)} booked (${sr.id}) via assistant.`);
    return {
      reference: sr.id,
      data: { reference: sr.id, status: sr.status, nextStep: "Payment link sent by SMS; prepayment applied within 2 working days of payment.", expectedBy: formatDate(sr.slaDueDate) },
      sources: [{ system: "service_ops", ref: sr.id, label: "Prepayment request" }],
    };
  },
});

const disputeParams = z.object({
  paymentId: z.string().describe("paymentId of the FAILED attempt from get_payment_history"),
  reason: z.string().min(3).describe("Customer's reason in their words"),
});
interface DisputePayload {
  paymentId: string;
  reason: string;
  charge: number;
  technical: boolean;
  date: string;
}

export const raisePaymentDispute = defineAction({
  kind: "action",
  name: "raise_payment_dispute",
  description: "Dispute a failed EMI debit and request reversal of its bounce charge.",
  params: disputeParams,
  async prepare({ paymentId, reason }, ctx) {
    const payments = await data.payments(ctx.customerId, 24);
    const p = payments.find((x) => x.id.toLowerCase() === paymentId.toLowerCase());
    if (!p) throw new NotFoundError(`Payment ${paymentId} not found on this customer's account.`);
    if (p.status !== "failed" || !p.failure) throw new BusinessRuleError("Only failed payments with charges can be disputed.", ["POL-PL-008"]);
    const rev = evaluateBounceReversal(p.failure.category, daysBetween(p.attemptDate, today()));
    if (!rev.canDispute) throw new BusinessRuleError(rev.reason, ["POL-PL-008"]);
    const charge = p.chargesLevied ? p.chargesLevied.amount + p.chargesLevied.gst : 0;
    return {
      title: "Payment dispute",
      summary: `Dispute the failed EMI debit of ${formatDate(p.attemptDate)} and request reversal of the ${inr(charge)} bounce charge.`,
      details: {
        Payment: `${p.id} · ${formatDate(p.attemptDate)} · ${inr(p.amount)}`,
        "Failure reason": `${p.failure.reason} (${p.failure.code})`,
        "Charge to reverse": inr(charge),
        Assessment: rev.reason,
        Resolution: `Within ${rev.slaWorkingDays} working days`,
      },
      payload: { paymentId: p.id, reason, charge, technical: p.failure.category === "technical", date: p.attemptDate } satisfies DisputePayload,
      sources: [{ system: "payments", ref: p.id, label: `Payment ${p.id}` }, policySource("POL-PL-008", "Payment disputes")],
    };
  },
  async commit(p: DisputePayload, ctx) {
    const sr = await gateway.write(
      "service_ops",
      "createRequest",
      (s) =>
        serviceOpsApi.createRequest(
          {
            customerId: ctx.customerId,
            type: "PAYMENT_DISPUTE",
            priority: p.technical ? "high" : "normal",
            summary: `Bounce charge reversal for ${p.paymentId} (${formatDate(p.date)})`,
            details: { paymentId: p.paymentId, reason: p.reason, chargeAmount: p.charge, failureCategory: p.technical ? "technical" : "customer" },
            idempotencyKey: ctx.actionId,
          },
          s,
        ),
      { idempotencyKey: ctx.actionId, invalidateTags: [customerTag(ctx.customerId)] },
    );
    await logInteraction(ctx.customerId, `Payment dispute ${sr.id} raised for ${p.paymentId}.`);
    return {
      reference: sr.id,
      data: { reference: sr.id, status: sr.status, priority: sr.priority, expectedResolutionBy: formatDate(sr.slaDueDate) },
      sources: [{ system: "service_ops", ref: sr.id, label: "Dispute" }],
    };
  },
});

const statementParams = z.object({
  period: z.enum(["last_6_months", "last_12_months", "since_inception"]).default("last_12_months"),
  loanId: loanIdParam,
});

export const requestStatement = defineAction({
  kind: "action",
  name: "request_statement",
  description: "Email a repayment statement for the loan to the registered email address.",
  params: statementParams,
  async prepare({ period, loanId }, ctx) {
    const [l, c] = await Promise.all([resolveLoan(ctx, loanId), data.customer(ctx.customerId)]);
    return {
      title: "Repayment statement",
      summary: `Email the ${period.replaceAll("_", " ")} repayment statement for ${l.id} to ${maskEmail(c.email)}.`,
      details: { Loan: l.id, Period: period.replaceAll("_", " "), "Send to": maskEmail(c.email), Delivery: "Within 24 hours", Charges: "Free" },
      payload: { loanId: l.id, period },
      sources: [policySource("POL-PL-009", "Statements")],
    };
  },
  async commit(p: { loanId: string; period: string }, ctx) {
    const sr = await gateway.write(
      "service_ops",
      "createRequest",
      (s) => serviceOpsApi.createRequest({ customerId: ctx.customerId, type: "STATEMENT", priority: "normal", summary: `Repayment statement (${p.period}) for ${p.loanId}`, details: p, idempotencyKey: ctx.actionId }, s),
      { idempotencyKey: ctx.actionId, invalidateTags: [customerTag(ctx.customerId)] },
    );
    return { reference: sr.id, data: { reference: sr.id, delivery: "Email within 24 hours" }, sources: [{ system: "service_ops", ref: sr.id, label: "Statement request" }] };
  },
});

export const loanTools = [
  getLoanDetails,
  getRepaymentSchedule,
  explainEmiChange,
  getPaymentHistory,
  simulatePrepaymentTool,
  checkForeclosure,
  requestPartPrepayment,
  raisePaymentDispute,
  requestStatement,
];

